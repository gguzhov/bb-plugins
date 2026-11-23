import test from "node:test";
import assert from "node:assert/strict";
import { PlanError, applyOp, cardVisible, parseOp, parseOpText, progress, readStored, summary, visiblePlan } from "../plan.ts";
import { createPlanCli, createPlanService, runPlanTool } from "../plan-service.ts";

const create = {
  id: "wave",
  title: "Wave",
  stages: [
    { name: "Server", steps: [{ title: "Release", status: "done" }, { title: "Check server" }] },
    { name: "Queue", steps: [{ title: "Patient card" }, { title: "Lists" }, { title: "Payments" }] },
  ],
};
const statuses = (plan) => plan.stages.flatMap((stage) => stage.steps.map((step) => `${step.title}:${step.status}`));
const run = (plans, op, now = 1000) => applyOp(plans, parseOp(op), now);

test("create makes the first open step current and keeps given statuses", () => {
  const { plan, plans } = run([], create);
  assert.equal(plans.length, 1);
  assert.equal(plan.state, "running");
  assert.equal(plan.startedAt, 1000);
  assert.deepEqual(statuses(plan), [
    "Release:done",
    "Check server:active",
    "Patient card:pending",
    "Lists:pending",
    "Payments:pending",
  ]);
  assert.equal(summary(plan), "wave: 1/5, running, active: Check server");
  const flat = run([], { id: "f", title: "Flat", steps: [{ title: "A" }, "B"] }).plan;
  assert.equal(flat.stages.length, 1);
  assert.equal(flat.stages[0].name, "");
  assert.deepEqual(statuses(flat), ["A:active", "B:pending"]);
});

test("next closes the current step and opens the following one", () => {
  let { plans } = run([], create);
  ({ plans } = run(plans, { id: "wave", next: true }, 2000));
  assert.deepEqual(statuses(plans[0]).slice(1, 3), ["Check server:done", "Patient card:active"]);
  assert.equal(plans[0].updatedAt, 2000);
  assert.equal(plans[0].startedAt, 1000);
});

test("done with active marks steps, earlier current steps count as done, titles ignore case", () => {
  let { plans } = run([], create);
  ({ plans } = run(plans, { id: "wave", done: ["patient CARD"], active: "lists" }));
  assert.deepEqual(statuses(plans[0]), [
    "Release:done",
    "Check server:done",
    "Patient card:done",
    "Lists:active",
    "Payments:pending",
  ]);
  // done on the current step alone moves on, as next does.
  ({ plans } = run(plans, { id: "wave", done: ["Lists"] }));
  assert.equal(progress(plans[0]).current.title, "Payments");
});

test("failed marks an error with its note, next closes it, state ops set the state", () => {
  let { plans } = run([], create);
  ({ plans } = run(plans, { id: "wave", failed: "Check server", note: "502 from nginx" }));
  assert.equal(plans[0].state, "error");
  assert.equal(plans[0].note, "502 from nginx");
  assert.equal(progress(plans[0]).current.status, "error");
  ({ plans } = run(plans, { id: "wave", next: true }));
  assert.equal(plans[0].state, "running");
  assert.equal(plans[0].note, null);
  assert.deepEqual(statuses(plans[0]).slice(1, 3), ["Check server:done", "Patient card:active"]);
  ({ plans } = run(plans, { id: "wave", state: "needs_input", note: "Which server?" }));
  assert.equal(plans[0].state, "needs_input");
  assert.equal(plans[0].note, "Which server?");
  ({ plans } = run(plans, { id: "wave", state: "done" }, 5000));
  assert.equal(plans[0].state, "done");
  assert.equal(plans[0].finishedAt, 5000);
});

test("finishing every step finishes the plan", () => {
  let { plans } = run([], create);
  ({ plans } = run(plans, { id: "wave", done: ["Check server", "Patient card", "Lists"], skipped: ["Payments"] }, 7000));
  assert.equal(plans[0].state, "done");
  assert.equal(plans[0].finishedAt, 7000);
  assert.equal(progress(plans[0]).done, 5);
  assert.equal(progress(plans[0]).current, null);
});

test("an unknown step or plan is refused with what exists, and nothing changes", () => {
  const { plans } = run([], create);
  assert.throws(
    () => run(plans, { id: "wave", done: ["Check server", "Deploy"] }),
    (error) =>
      error instanceof PlanError &&
      error.code === "unknown_step" &&
      error.message.includes('no step "Deploy"') &&
      error.message.includes('"Patient card"'),
  );
  assert.equal(progress(plans[0]).current.title, "Check server");
  assert.throws(() => run(plans, { id: "other", next: true }), (error) => error.code === "unknown_plan" && error.message.includes('"wave"'));
});

test("malformed ops are refused before anything is stored", () => {
  assert.throws(() => parseOp({ id: "a", nxt: true }), /unknown field "nxt"/);
  assert.throws(() => parseOp({ id: "a" }), /changes nothing/);
  assert.throws(() => parseOp({ next: true }), /id must be a string/);
  assert.throws(() => parseOp({ id: "a", state: "paused" }), /state must be one of/);
  assert.throws(() => parseOp({ id: "a", title: "T", steps: [{ title: "x", status: "started" }] }), /status must be one of/);
  assert.throws(() => parseOpText("{id:1}"), /not valid JSON/);
  assert.throws(() => run([], { id: "a", steps: ["x"] }), /needs a title/);
  assert.equal(parseOp({ id: "a", state: "working" }).state, "running");
});

test("resending the plan keeps finished steps by title; a finished plan sent again starts over", () => {
  let { plans } = run([], create);
  ({ plans } = run(plans, { id: "wave", next: true }));
  const grown = { id: "wave", stages: [...create.stages, { name: "Release", steps: [{ title: "Ship" }] }] };
  ({ plans } = run(plans, { ...grown, stages: grown.stages.map((s) => ({ ...s, steps: s.steps.map(({ title }) => ({ title })) })) }, 3000));
  assert.deepEqual(statuses(plans[0]).slice(0, 3), ["Release:done", "Check server:done", "Patient card:active"]);
  assert.equal(plans[0].startedAt, 1000);
  ({ plans } = run(plans, { id: "wave", state: "done" }, 4000));
  const bare = { id: "wave", title: "Wave", steps: [{ title: "Release" }, { title: "Ship" }] };
  ({ plans } = run(plans, bare, 9000));
  assert.deepEqual(statuses(plans[0]), ["Release:active", "Ship:pending"]);
  assert.equal(plans[0].startedAt, 9000);
});

test("the card shows the latest open plan, and a finished one only for 30 s", () => {
  let { plans } = run([], create, 1000);
  ({ plans } = run(plans, { id: "second", title: "Second", steps: ["A"] }, 2000));
  assert.equal(visiblePlan(plans, 2500).plan.id, "second");
  assert.equal(visiblePlan(plans, 2500).hideInMs, null);
  ({ plans } = run(plans, { id: "second", next: true }, 3000));
  assert.equal(plans.at(-1).state, "done");
  assert.equal(visiblePlan(plans, 3000).hideInMs, 30_000);
  assert.equal(visiblePlan(plans, 32_999).plan.id, "second");
  assert.equal(visiblePlan(plans, 33_000), null);
  assert.equal(visiblePlan([], 0), null);
});

test("the card is up for background work or a shown plan, not past a finished plan's hide time", () => {
  assert.equal(cardVisible(0, null, 0), false);
  assert.equal(cardVisible(2, null, 0), true);
  assert.equal(cardVisible(0, { hideAt: null }, 99), true);
  assert.equal(cardVisible(0, { hideAt: 100 }, 99), true);
  assert.equal(cardVisible(0, { hideAt: 100 }, 100), false);
  assert.equal(cardVisible(1, { hideAt: 100 }, 500), true);
});

test("stored values are read loosely", () => {
  assert.deepEqual(readStored(null), []);
  assert.deepEqual(readStored({ plans: [{ id: 1 }, "x"] }), []);
  const [plan] = readStored({ plans: [{ id: "a", title: "A", stages: [{ name: "S", steps: [{ title: "x", status: "bogus" }, { title: "y", status: "done" }] }], state: "working" }] });
  assert.equal(plan.state, "running");
  assert.deepEqual(statuses(plan), ["y:done"]);
});

function memoryService() {
  const rows = new Map();
  const changed = [];
  let clock = 1000;
  const service = createPlanService({
    store: {
      load: async (threadId) => rows.get(threadId),
      save: async (threadId, value) => {
        if (value === null) rows.delete(threadId);
        else rows.set(threadId, JSON.parse(JSON.stringify(value)));
      },
    },
    now: () => (clock += 1000),
    onChange: (threadId) => changed.push(threadId),
  });
  return { service, rows, changed };
}

test("bb task-queue plan: create, move, show, refuse, clear", async () => {
  const { service, rows, changed } = memoryService();
  const cli = createPlanCli(service);
  const ctx = { threadId: "thr_a" };

  let result = await cli.run(["plan", JSON.stringify(create)], ctx);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "wave: 1/5, running, active: Check server");
  assert.deepEqual(changed, ["thr_a"]);

  // A JSON op split by the shell into several words is joined back.
  result = await cli.run(["plan", '{"id":"wave",', '"next":true}'], ctx);
  assert.equal(result.stdout.trim(), "wave: 2/5, running, active: Patient card");

  result = await cli.run(["plan", "--thread", "thr_b", JSON.stringify({ id: "x", title: "X", steps: ["One"] })], {});
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(rows.has("thr_b"));

  result = await cli.run(["plan", JSON.stringify({ id: "wave", done: ["Nope"] })], ctx);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /no step "Nope".*"Patient card"/);

  result = await cli.run(["plan", JSON.stringify({ id: "wave", next: true })], {});
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /no thread/);

  result = await cli.run(["plan", "show", "--json"], ctx);
  const shown = JSON.parse(result.stdout);
  assert.equal(shown.threadId, "thr_a");
  assert.equal(shown.plans[0].id, "wave");
  assert.equal(progress(shown.plans[0]).current.title, "Patient card");

  result = await cli.run(["plan", "show"], ctx);
  assert.match(result.stdout, /Wave \(wave: 2\/5/);
  assert.match(result.stdout, /\[>\] Patient card/);

  result = await cli.run(["plan", "clear"], ctx);
  assert.equal(result.stdout.trim(), "Removed 1 plan.");
  assert.equal(rows.has("thr_a"), false);
  result = await cli.run(["plan", "show"], ctx);
  assert.equal(result.stdout.trim(), "No plan in this thread.");
});

test("the agent tool answers with the summary or the refusal", async () => {
  const { service } = memoryService();
  assert.equal(await runPlanTool(service, "thr_t", create), "wave: 1/5, running, active: Check server");
  const refused = await runPlanTool(service, "thr_t", { id: "wave", active: "Missing" });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /no step "Missing"/);
});

test("quick ops on one thread run in order", async () => {
  const { service } = memoryService();
  await service.apply("thr_q", create);
  await Promise.all([1, 2, 3, 4].map(() => service.apply("thr_q", { id: "wave", next: true })));
  const [plan] = await service.list("thr_q");
  assert.equal(plan.state, "done");
  assert.equal(progress(plan).done, 5);
});
