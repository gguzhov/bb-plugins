import test from "node:test";
import assert from "node:assert/strict";
import { PlanError, applyOp, describe, parseOp, progress, readStored, summary, withMetrics } from "../plan.ts";
import { duration, planMetrics, stageMetrics } from "../metrics.ts";
import { createPlanCli, createPlanService, runPlanTool } from "../plan-service.ts";

const MIN = 60_000;
const run = (plans, op, now = 1000) => applyOp(plans, parseOp(op), now);
const statuses = (plan) => plan.stages.flatMap((stage) => stage.steps.map((step) => `${step.code ?? step.title}:${step.status}`));
const ticket = (plan, key) => plan.stages.flatMap((s) => s.steps).find((s) => s.code === key || s.title === key);

const epics = {
  id: "w",
  title: "Wave",
  epics: [
    { name: "Cards", tickets: [{ title: "Patient card", code: "CS", points: 3, owner: "Sonnet 5.5", criteria: 6 }, { title: "Lists", code: "DI", points: 2, criteria: 4 }] },
    { name: "Release", tickets: [{ title: "Ship", code: "SH", points: 5 }, { title: "Report" }] },
  ],
};

// ── Ticket 1: model and ops ─────────────────────────────────────────────────

test("epics/tickets are synonyms of stages/steps; new fields are kept", () => {
  const { plan } = run([], epics);
  assert.equal(plan.stages.length, 2);
  assert.deepEqual(statuses(plan), ["CS:active", "DI:pending", "SH:pending", "Report:pending"]);
  const cs = ticket(plan, "CS");
  assert.equal(cs.points, 3);
  assert.equal(cs.owner, "Sonnet 5.5");
  assert.equal(cs.criteria, 6);
  assert.equal(cs.startedAt, 1000);
  const flat = run([], { id: "f", title: "F", tickets: ["One"] }).plan;
  assert.deepEqual(statuses(flat), ["One:active"]);
  assert.throws(() => parseOp({ id: "x", title: "X", stages: [{ name: "a", steps: ["b"] }], epics: [] }), /send one of/);
  assert.throws(() => parseOp({ id: "x", title: "X", tickets: [{ title: "a", points: 4 }] }), /points must be one of 1, 2, 3, 5, 8, 13/);
  assert.throws(() => parseOp({ id: "x", title: "X", tickets: [{ title: "a", code: "TOOLONG" }] }), /code is longer than 6/);
  assert.throws(() => parseOp({ id: "x", title: "X", tickets: [{ title: "a", criteria: 51 }] }), /criteria must be a whole number from 0 to 50/);
  assert.throws(() => parseOp({ id: "x", title: "X", tickets: [{ title: "a", owner: "x".repeat(41) }] }), /owner is longer than 40/);
});

test("a plan of one epic with one ticket is valid and shown", () => {
  const { plan } = run([], { id: "one", title: "Fix", epics: [{ name: "Fix", tickets: [{ title: "Fix the bug" }] }] });
  assert.equal(summary(plan), "one: 0/1, running, active: Fix the bug");
  const { plan: closed } = run([plan], { id: "one", accept: [{ ticket: "Fix the bug", confirmed: 3, total: 3 }] });
  assert.equal(closed.state, "done");
  assert.equal(summary(closed), "one: 1/1, done, accepted 100%");
});

test("accepted is ignored on create unless the ticket is done", () => {
  const { plan } = run([], {
    id: "a",
    title: "A",
    tickets: [
      { title: "x", status: "done", criteria: 4, accepted: 3 },
      { title: "y", criteria: 4, accepted: 4 },
    ],
  });
  assert.equal(ticket(plan, "x").accepted, 3);
  assert.equal(ticket(plan, "y").accepted, undefined);
  assert.throws(() => parseOp({ id: "a", title: "A", tickets: [{ title: "x", status: "done", criteria: 2, accepted: 3 }] }), /more than its criteria/);
  // Read-only fields sent by the agent are dropped.
  const { plan: again } = run([], { id: "b", title: "B", tickets: [{ title: "x", rework: 9, doneAt: 5 }] });
  assert.equal(ticket(again, "x").rework, undefined);
  assert.equal(ticket(again, "x").doneAt, undefined);
});

test("start puts two tickets in work without closing the others; addressed by code", () => {
  let { plans } = run([], epics, 1000);
  ({ plans } = run(plans, { id: "w", start: ["di", "sh"] }, 2000));
  assert.deepEqual(statuses(plans[0]), ["CS:active", "DI:active", "SH:active", "Report:pending"]);
  assert.equal(ticket(plans[0], "DI").startedAt, 2000);
  assert.equal(summary(plans[0]), "w: 0/4, running, active: Patient card, Lists, Ship");
  // The old active op keeps its old meaning: earlier current tickets count as done.
  const old = run(plans, { id: "w", active: "Report" }, 3000).plan;
  assert.deepEqual(statuses(old), ["CS:done", "DI:done", "SH:done", "Report:active"]);
});

test("review hands a ticket in; accept closes it with its criteria, full and short form", () => {
  let { plans } = run([], epics, 1000);
  ({ plans } = run(plans, { id: "w", start: ["DI"], review: ["CS"] }, 2000));
  assert.equal(ticket(plans[0], "CS").status, "review");
  assert.equal(ticket(plans[0], "CS").reviewAt, 2000);
  assert.equal(summary(plans[0]), "w: 0/4, running, active: Lists · review: Patient card");
  ({ plans } = run(plans, { id: "w", accept: [{ ticket: "CS", confirmed: 5, total: 6 }] }, 3000));
  const cs = ticket(plans[0], "CS");
  assert.equal(cs.status, "done");
  assert.equal(cs.accepted, 5);
  assert.equal(cs.criteria, 6);
  assert.equal(cs.doneAt, 3000);
  // Short form: every stored criterion confirmed. Total missing: the stored criteria count.
  ({ plans } = run(plans, { id: "w", accept: ["lists"] }, 4000));
  assert.equal(ticket(plans[0], "DI").accepted, 4);
  assert.equal(ticket(plans[0], "DI").criteria, 4);
  assert.equal(summary(plans[0]), "w: 2/4, running, active: Ship · accepted 90%");
  ({ plans } = run(plans, { id: "w", accept: [{ ticket: "SH", confirmed: 2, total: 2 }] }, 5000));
  assert.equal(ticket(plans[0], "SH").accepted, 2);
});

test("accept with confirmed over total, or with no criteria known, is refused and changes nothing", () => {
  const { plans } = run([], epics);
  assert.throws(() => run(plans, { id: "w", accept: [{ ticket: "CS", confirmed: 7, total: 6 }] }), /confirmed \(7\) is more than total \(6\)/);
  assert.throws(() => run(plans, { id: "w", accept: [{ ticket: "CS", confirmed: 7 }] }), (e) => e instanceof PlanError && /confirmed \(7\) is more than its 6 criteria/.test(e.message));
  assert.throws(() => run(plans, { id: "w", accept: ["SH"] }), /has no criteria/);
  assert.equal(ticket(plans[0], "CS").status, "active");
});

test("rework counts a return, clears acceptance and puts the ticket back in work", () => {
  let { plans } = run([], epics, 1000);
  ({ plans } = run(plans, { id: "w", accept: [{ ticket: "CS", confirmed: 6 }] }, 2000));
  ({ plans } = run(plans, { id: "w", rework: [{ ticket: "cs", note: "button overlaps at 375" }] }, 3000));
  let cs = ticket(plans[0], "CS");
  assert.equal(cs.status, "active");
  assert.equal(cs.rework, 1);
  assert.equal(cs.accepted, undefined);
  assert.equal(cs.doneAt, undefined);
  assert.equal(cs.startedAt, 1000);
  assert.equal(plans[0].note, "Patient card: button overlaps at 375");
  ({ plans } = run(plans, { id: "w", review: ["CS"] }, 4000));
  ({ plans } = run(plans, { id: "w", rework: ["CS"] }, 5000));
  cs = ticket(plans[0], "CS");
  assert.equal(cs.rework, 2);
  assert.throws(() => run(plans, { id: "w", rework: ["SH"] }), /is pending; rework takes a ticket in review or done/);
});

test("an unknown ticket is refused with the list, codes included", () => {
  const { plans } = run([], epics);
  assert.throws(
    () => run(plans, { id: "w", start: ["ZZ"] }),
    (e) => e.code === "unknown_step" && e.message.includes('no step "ZZ"') && e.message.includes('"Patient card"') && !e.message.includes("(CS)"),
  );
});

test("done without accept leaves acceptance empty: it does not count in the acceptance figure", () => {
  let { plans } = run([], epics);
  ({ plans } = run(plans, { id: "w", done: ["CS"] }));
  assert.equal(ticket(plans[0], "CS").accepted, undefined);
  assert.equal(planMetrics(plans[0], 2000).acceptance, null);
});

test("compatibility: a plan moved only by the old ops gives the same statuses and lines as v0.4", () => {
  // Lines and statuses recorded from v0.4.0 (commit 74a0233) with the same calls.
  const create = {
    id: "wave",
    title: "Wave",
    stages: [
      { name: "Server", steps: [{ title: "Release", status: "done" }, { title: "Check server" }] },
      { name: "Queue", steps: [{ title: "Patient card CS" }, { title: "Lists DI DP" }, { title: "Payments" }] },
    ],
  };
  const calls = [
    [create, "wave: 1/5, running, active: Check server"],
    [{ id: "wave", next: true }, "wave: 2/5, running, active: Patient card"],
    [{ id: "wave", failed: "Patient card CS", note: "502" }, "wave: 2/5, error, failed: Patient card, note: 502"],
    [{ id: "wave", done: ["Patient card CS"], active: "Lists DI DP" }, "wave: 3/5, running, active: Lists"],
    [{ id: "wave", state: "needs_input", note: "Which?" }, "wave: 3/5, needs_input, active: Lists, note: Which?"],
    [{ id: "wave", done: ["Lists DI DP"] }, "wave: 4/5, running, active: Payments"],
    [{ id: "wave", next: true }, "wave: 5/5, done"],
  ];
  let plans = [];
  let t = 1000;
  for (const [op, line] of calls) {
    ({ plans } = run(plans, op, (t += 1000)));
    assert.equal(summary(plans[0]), line);
  }
  assert.deepEqual(statuses(plans[0]), ["Release:done", "Check server:done", "Patient card CS:done", "Lists DI DP:done", "Payments:done"]);
});

test("a stored v0.4 plan without the new fields reads and shows", () => {
  const stored = {
    plans: [
      {
        id: "wave-v5",
        title: "Волна v5",
        stages: [
          { name: "Сервер", steps: [{ title: "Выпуск Next.js", status: "done" }] },
          { name: "Отчёт", steps: [{ title: "UX-ревью", status: "active" }, { title: "Правки", status: "pending" }] },
        ],
        state: "running",
        note: null,
        startedAt: 1000,
        updatedAt: 2000,
        finishedAt: null,
      },
    ],
  };
  const [plan] = readStored(stored);
  assert.deepEqual(plan, stored.plans[0]);
  assert.equal(summary(plan), "wave-v5: 1/3, running, active: UX-ревью");
  const text = describe(plan, 3000);
  // Stored as "Волна v5"; plan show prints it as "Очередь v5" (task-queue 1.0).
  assert.equal(plan.title, "Волна v5");
  assert.match(text, /^Очередь v5 \(wave-v5: 1\/3, running, active: UX-ревью\)/);
  assert.match(text, /\[>\] UX-ревью$/m);
  assert.match(text, /Metrics: progress 33% · accepted n\/a · velocity n\/a · ETA n\/a · cycle n\/a · first-pass n\/a · WIP 1/);
  // An old op on it still works.
  const { plan: moved } = applyOp([plan], parseOp({ id: "wave-v5", next: true }), 4000);
  assert.deepEqual(statuses(moved), ["Выпуск Next.js:done", "UX-ревью:done", "Правки:active"]);
});

test("the new fields survive storage and a resend keeps them by title", () => {
  let { plans } = run([], epics, 1000);
  ({ plans } = run(plans, { id: "w", accept: [{ ticket: "CS", confirmed: 5 }] }, 2000));
  const [read] = readStored(JSON.parse(JSON.stringify({ plans })));
  assert.equal(ticket(read, "CS").accepted, 5);
  assert.equal(ticket(read, "CS").doneAt, 2000);
  const resend = { id: "w", stages: [{ name: "Cards", steps: [{ title: "Patient card" }, { title: "Lists" }] }] };
  const { plan } = run([read], resend, 3000);
  assert.equal(ticket(plan, "Patient card").accepted, 5);
  assert.equal(ticket(plan, "Patient card").code, "CS");
  assert.equal(ticket(plan, "Patient card").points, 3);
});

test("the agent tool and the command take the new JSON and answer in one line", async () => {
  const rows = new Map();
  let clock = 0;
  const service = createPlanService({
    store: { load: async (id) => rows.get(id), save: async (id, v) => (v === null ? rows.delete(id) : rows.set(id, JSON.parse(JSON.stringify(v)))) },
    now: () => (clock += MIN),
  });
  const cli = createPlanCli(service, async (id) => id, () => clock);
  const ctx = { threadId: "thr_x" };
  assert.equal(await runPlanTool(service, "thr_x", epics), "w: 0/4, running, active: Patient card");
  assert.equal(await runPlanTool(service, "thr_x", { id: "w", start: ["DI"] }), "w: 0/4, running, active: Patient card, Lists");
  let r = await cli.run(["plan", JSON.stringify({ id: "w", review: ["CS"] })], ctx);
  assert.equal(r.stdout.trim(), "w: 0/4, running, active: Lists · review: Patient card");
  r = await cli.run(["plan", JSON.stringify({ id: "w", accept: [{ ticket: "CS", confirmed: 5, total: 6 }] })], ctx);
  assert.equal(r.stdout.trim(), "w: 1/4, running, active: Lists · accepted 83%");
  assert.equal(r.stdout.split("\n").filter(Boolean).length, 1);
  r = await cli.run(["plan", "show", "--json"], ctx);
  const shown = JSON.parse(r.stdout).plans[0];
  assert.equal(shown.metrics.wip, 1);
  assert.equal(shown.metrics.acceptance, 5 / 6);
  assert.equal(shown.stages[0].metrics.done, 1);
  assert.equal(shown.stages[0].metrics.total, 2);
  assert.equal(shown.stages[1].metrics.progress, 0);
  assert.equal(shown.stages[0].steps[0].code, "CS");
  r = await cli.run(["plan", "show"], ctx);
  assert.match(r.stdout, /Metrics: progress 27% · accepted 83% · velocity [\d.]+ pt\/h · ETA n\/a · cycle 3m · first-pass 100% · WIP 1/);
  assert.match(r.stdout, /\[x\] Patient card \(3 pt, Sonnet 5\.5, accepted 5\/6\)/);
  const refused = await runPlanTool(service, "thr_x", { id: "w", accept: [{ ticket: "DI", confirmed: 9, total: 4 }] });
  assert.equal(refused.isError, true);
});

// ── Ticket 2: metrics ──────────────────────────────────────────────────────

function fixture(extra = {}) {
  return {
    state: "running",
    finishedAt: null,
    stages: [
      {
        name: "One",
        steps: [
          { title: "A", status: "done", points: 3, startedAt: 0, doneAt: 10 * MIN, criteria: 6, accepted: 5 },
          { title: "B", status: "done", points: 2, startedAt: 5 * MIN, doneAt: 25 * MIN, criteria: 4, accepted: 4, rework: 1 },
          { title: "C", status: "active", points: 5, startedAt: 20 * MIN },
        ],
      },
      {
        name: "Two",
        steps: [
          { title: "D", status: "review", startedAt: 22 * MIN },
          { title: "E", status: "skipped", points: 8 },
          { title: "F", status: "pending" },
        ],
      },
    ],
    ...extra,
  };
}

test("metrics by hand: progress, acceptance, velocity, ETA, cycle, first pass, WIP", () => {
  const m = planMetrics(fixture(), 60 * MIN);
  // points: 3+2+5+1+1 = 12 (E skipped), done 3+2 = 5
  assert.equal(m.pointsTotal, 12);
  assert.equal(m.pointsDone, 5);
  assert.equal(m.progress, 5 / 12);
  // (5+4)/(6+4)
  assert.equal(m.acceptance, 0.9);
  // 5 points in the hour since A started
  assert.equal(m.velocity, 5);
  // 7 points left at 5 pt/h = 1.4 h = 84 min
  assert.equal(m.etaMs, 84 * MIN);
  assert.equal(duration(m.etaMs), "1h 24m");
  // (10 + 20) / 2 min
  assert.equal(m.cycleMs, 15 * MIN);
  // A first time, B reworked once
  assert.equal(m.firstPass, 0.5);
  assert.equal(m.wip, 2);
  assert.equal(m.done, 2);
  assert.equal(m.total, 5);
  // A finished plan is measured up to its finish.
  assert.equal(planMetrics(fixture({ state: "done", finishedAt: 30 * MIN }), 999 * MIN).velocity, 10);
});

test("epic metrics: progress by points and acceptance", () => {
  const [one, two] = fixture().stages.map(stageMetrics);
  assert.deepEqual(one, { progress: 5 / 10, acceptance: 0.9, done: 2, total: 3 });
  assert.deepEqual(two, { progress: 0, acceptance: null, done: 0, total: 2 });
});

test("edges: empty plan, no points, nothing accepted, too early for ETA; never NaN or Infinity", () => {
  const empty = planMetrics({ state: "running", finishedAt: null, stages: [] }, 1000);
  assert.deepEqual(empty, {
    progress: null, pointsDone: 0, pointsTotal: 0, acceptance: null, velocity: null, etaMs: null,
    cycleMs: null, firstPass: null, wip: 0, done: 0, total: 0,
  });
  // No points anywhere: each ticket counts as 1.
  const plain = { state: "running", finishedAt: null, stages: [{ name: "", steps: [{ title: "a", status: "done" }, { title: "b", status: "pending" }, { title: "c", status: "pending" }, { title: "d", status: "active", startedAt: 0 }] }] };
  const m = planMetrics(plain, 10 * MIN);
  assert.equal(m.progress, 1 / 4);
  // a was done without times: no speed, no forecast.
  assert.equal(m.velocity, null);
  assert.equal(m.etaMs, null);
  assert.equal(m.cycleMs, null);
  assert.equal(m.acceptance, null);
  // Nothing accepted.
  const none = planMetrics({ state: "running", finishedAt: null, stages: [{ name: "", steps: [{ title: "a", status: "active", startedAt: 0 }] }] }, 60 * MIN);
  assert.equal(none.velocity, null);
  assert.equal(none.etaMs, null);
  assert.equal(none.firstPass, null);
  // Two done but under five minutes: no forecast yet; one done after an hour: none either.
  const early = fixture();
  assert.equal(planMetrics(early, 4 * MIN).etaMs, null);
  const one = fixture();
  one.stages[0].steps[1].status = "active";
  assert.equal(planMetrics(one, 60 * MIN).etaMs, null);
  // Zero time spent: no division by zero.
  const instant = { state: "running", finishedAt: null, stages: [{ name: "", steps: [{ title: "a", status: "done", startedAt: 5, doneAt: 5 }] }] };
  assert.equal(planMetrics(instant, 5).velocity, null);
  // All skipped, criteria 0.
  const skipped = { state: "done", finishedAt: 1, stages: [{ name: "", steps: [{ title: "a", status: "skipped" }, { title: "b", status: "done", criteria: 0, accepted: 0 }] }] };
  const s = planMetrics(skipped, 9);
  assert.equal(s.acceptance, null);
  for (const value of [...Object.values(empty), ...Object.values(m), ...Object.values(none), ...Object.values(s)]) {
    assert.ok(value === null || Number.isFinite(value), `bad value ${value}`);
  }
  const text = describe({ id: "e", title: "E", note: null, startedAt: 0, updatedAt: 0, ...skipped }, 9);
  assert.doesNotMatch(text, /NaN|Infinity/);
});

test("withMetrics adds metrics to the plan and every epic", () => {
  const plan = { id: "p", title: "P", note: null, startedAt: 0, updatedAt: 0, ...fixture() };
  const out = withMetrics(plan, 60 * MIN);
  assert.equal(out.metrics.wip, 2);
  assert.equal(out.stages[1].metrics.total, 2);
  assert.equal(progress(out).current.title, "C");
});
