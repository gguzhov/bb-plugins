import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActivitySource, readTail, safeOutputPath } from "../activity-source.ts";
import { linkAgents } from "../hint.ts";

const launchRow = (id, command, at, path) => ({
  id,
  kind: "work",
  workKind: "command",
  command,
  createdAt: at,
  output: `Command running in background with ID: ${id}. Output is being written to: ${path}. You will be notified.`,
});

const timeline = {
  rows: [
    {
      id: "turn",
      kind: "turn",
      children: [
        {
          id: "d1",
          workKind: "delegation",
          background: true,
          description: "Write release notes",
          childRows: [{ id: "c1", kind: "work", workKind: "command", status: "pending", toolName: "Bash", command: "git log --oneline" }],
        },
        launchRow("b1", "npm run build", 1000, "/tmp/claude-1/p/tasks/b1.output"),
        launchRow("b2", "npm test", 2000, "/tmp/claude-1/p/tasks/b2.output"),
      ],
    },
  ],
  activeBackgroundCommands: [
    { id: "a1", taskType: "local_agent", description: "Write release notes", startedAt: 500 },
    { id: "b1", taskType: "local_bash", description: "Build the app", startedAt: 1001 },
    { id: "b2", taskType: "local_bash", description: "Run the tests", startedAt: 2002 },
  ],
};

test("the source reads the timeline itself: agents with their running steps, commands with launch line and output tail", async () => {
  const calls = [];
  const source = createActivitySource({
    timeline: async (threadId, segments) => {
      calls.push([threadId, segments]);
      return timeline;
    },
    tail: async (path, lines) => [`${path.split("/").pop()} ok`, `lines ${lines}`],
  });
  const items = await source.read("thr_1");
  assert.deepEqual(calls, [["thr_1", "3"]]);
  assert.deepEqual(items.map((item) => [item.kind, item.title]), [
    ["agent", "Write release notes"],
    ["command", "Build the app"],
    ["command", "Run the tests"],
  ]);
  assert.equal(items[0].running[0].text, "git log --oneline");
  assert.deepEqual(items[0].output, []);
  assert.equal(items[1].command, "npm run build");
  assert.deepEqual(items[1].output, ["b1.output ok", "lines 4"]);
  // The output file path never leaves the server.
  assert.equal("outputPath" in items[1], false);
});

test("two reads within the cache window share one timeline read; a later one reads again", async () => {
  let clock = 0;
  let reads = 0;
  const source = createActivitySource({
    timeline: async () => {
      reads += 1;
      return timeline;
    },
    tail: async () => [],
    now: () => clock,
  });
  await Promise.all([source.read("thr_1"), source.read("thr_1")]);
  clock = 1000;
  await source.read("thr_1");
  assert.equal(reads, 1);
  clock = 2000;
  await source.read("thr_1");
  assert.equal(reads, 2);
});

test("a command launched before the recent segments is looked up once in a deeper read", async () => {
  const segments = [];
  const recent = { rows: [], activeBackgroundCommands: [{ id: "b1", taskType: "local_bash", description: "Build the app", startedAt: 1001 }] };
  let clock = 0;
  const source = createActivitySource({
    timeline: async (_id, depth) => {
      segments.push(depth);
      return depth === "3" ? recent : timeline;
    },
    tail: async () => [],
    now: () => (clock += 5000),
  });
  assert.equal((await source.read("t"))[0].command, "npm run build");
  assert.equal((await source.read("t"))[0].command, "npm run build");
  assert.deepEqual(segments, ["3", "40", "3"]);
});

test("a failed read is not cached", async () => {
  let fail = true;
  const source = createActivitySource({
    timeline: async () => {
      if (fail) throw new Error("down");
      return timeline;
    },
    tail: async () => [],
  });
  await assert.rejects(source.read("t"));
  fail = false;
  assert.equal((await source.read("t")).length, 3);
});

test("only provider task output files under the temp folder are read", async () => {
  assert.equal(safeOutputPath("/tmp/claude-501/p/s/tasks/b1.output"), true);
  assert.equal(safeOutputPath("/private/tmp/claude-501/p/tasks/x-1.output"), true);
  assert.equal(safeOutputPath("/etc/passwd"), false);
  assert.equal(safeOutputPath("/tmp/claude-501/../../etc/tasks/x.output"), false);
  assert.equal(safeOutputPath("/tmp/claude-501/p/tasks/x.txt"), false);
  assert.deepEqual(await readTail("/etc/hosts", 4), []);

  const root = mkdtempSync(join(tmpdir(), "tq-"));
  // Only paths under /tmp pass; the test writes there when the temp dir is elsewhere.
  const base = root.startsWith("/tmp/") || root.startsWith("/private/tmp/") ? root : mkdtempSync("/tmp/tq-");
  mkdirSync(join(base, "p", "tasks"), { recursive: true });
  const file = join(base, "p", "tasks", "t1.output");
  writeFileSync(file, `${"x".repeat(9000)}\nline one\n\nline two\nline three\n`);
  assert.deepEqual(await readTail(file, 2), ["line two", "line three"]);
  assert.equal(readFileSync(file, "utf8").length > 8192, true);
});

test("a background command tied to a ticket by its description shows under that ticket", () => {
  const plan = {
    stages: [
      {
        name: "Queue 1",
        steps: [
          { title: "Build", status: "active", agent: "Build the app" },
          { title: "Notes", status: "active", agent: "Write release notes" },
          { title: "Later", status: "pending" },
        ],
      },
    ],
  };
  const items = [
    { id: "a1", kind: "agent", title: "Write release notes", command: null, running: [] },
    { id: "b1", kind: "command", title: "Build the app", command: "npm run build", running: [] },
    { id: "b3", kind: "command", title: "Lint", command: "npm run lint", running: [] },
  ];
  const { byTicket, unlinked } = linkAgents(plan, items);
  const [build, notes] = plan.stages[0].steps;
  assert.deepEqual(byTicket.get(build).map((item) => item.id), ["b1"]);
  assert.deepEqual(byTicket.get(notes).map((item) => item.id), ["a1"]);
  assert.deepEqual(unlinked.map((item) => item.id), ["b3"]);
});
