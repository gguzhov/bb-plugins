import test from "node:test";
import assert from "node:assert/strict";
import { buildActivities, tailLines, toStep } from "../activity.ts";

const child = (id, extra) => ({ id, kind: "work", workKind: "command", status: "completed", ...extra });
const timeline = {
  rows: [
    {
      id: "turn",
      kind: "turn",
      children: [
        {
          id: "d-old",
          workKind: "delegation",
          background: true,
          description: "Research",
          childRows: [child("old-1", { command: "ls" })],
        },
        {
          id: "d-new",
          workKind: "delegation",
          background: true,
          description: "Research",
          childRows: [
            { id: "t1", kind: "system", operationKind: "reasoning", status: "completed", detail: "Plan  the\nsearch" },
            child("c1", { command: "grep x", exitCode: 2 }),
            child("c2", { description: "Count files", command: "ls | wc -l" }),
            child("c3", {
              status: "pending",
              command: "sleep 9",
              presentation: { label: { pending: "Running command", completed: "Ran command" }, icon: { glyph: "Terminal" }, title: "sleep 9" },
            }),
          ],
        },
        { id: "d-fg", workKind: "delegation", background: false, description: "Research", childRows: [child("fg")] },
      ],
    },
  ],
  activeBackgroundCommands: [
    {
      id: "a1",
      taskType: "local_agent",
      description: "Research",
      startedAt: 100,
      usage: { totalTokens: 2400, toolUses: 3 },
      presentation: { label: { pending: "Running background agent" }, icon: { glyph: "UserRound" } },
    },
    { id: "a2", taskType: "local_bash", description: "Dev server", startedAt: 50, usage: null },
    { id: "a3", taskType: "local_agent", description: "Unknown agent" },
  ],
};

test("an agent lists only the work in progress, a command its launch line", () => {
  const withLaunch = {
    ...timeline,
    rows: [
      ...timeline.rows,
      { id: "far", kind: "work", workKind: "command", command: "other", createdAt: 9000, output: "Command running in background with ID: z. Output is being written to: /tmp/claude-1/p/tasks/z.output." },
      { id: "launch", kind: "work", workKind: "command", command: "npm run dev", createdAt: 52, output: "Command running in background with ID: b1. Output is being written to: /private/tmp/claude-501/p/s/tasks/b1.output. You will be notified." },
    ],
  };
  const [agent, command, orphan] = buildActivities(withLaunch);
  assert.equal(agent.kind, "agent");
  assert.equal(agent.label, "Running background agent");
  assert.equal(agent.tokens, 2400);
  assert.equal(agent.toolUses, 3);
  assert.deepEqual(agent.running, [{ id: "c3", icon: "Terminal", label: "Running command", text: "sleep 9", status: "pending" }]);
  assert.equal(command.kind, "command");
  assert.equal(command.label, "Running background command");
  assert.equal(command.command, "npm run dev");
  assert.equal(command.outputPath, "/private/tmp/claude-501/p/s/tasks/b1.output");
  assert.deepEqual(orphan.running, []);
  const [, bare] = buildActivities(timeline);
  assert.equal(bare.command, null);
  assert.equal(bare.outputPath, null);
});

test("an empty or malformed timeline yields nothing", () => {
  assert.deepEqual(buildActivities({}), []);
  assert.deepEqual(buildActivities({ rows: "x", activeBackgroundCommands: [null, 3] }), []);
});

test("thoughts are flattened and long text is clipped", () => {
  assert.equal(toStep({ id: "t", kind: "system", operationKind: "reasoning", status: "completed", detail: "a\n  b" }).text, "a b");
  assert.equal(toStep({ id: "l", kind: "work", command: "y".repeat(900) }).text.length, 400);
  assert.equal(toStep({ kind: "work" }), null);
});

test("output tail keeps the last printed lines", () => {
  assert.deepEqual(tailLines("a\n\nb\r\n10%\r50%\r100%\n\u001b[32mok\u001b[0m  \n", 3), ["b", "100%", "ok"]);
  assert.deepEqual(tailLines("", 3), []);
  assert.equal(tailLines("x".repeat(500), 1)[0].length, 240);
});
