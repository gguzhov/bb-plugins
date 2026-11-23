import test from "node:test";
import assert from "node:assert/strict";
import { counts, mergePlans, reportText, sameCount } from "../migrate.ts";
import { applyOp, parseOp, readStored } from "../plan.ts";
import { createPlanCli, createPlanService } from "../plan-service.ts";

const plan = (id, updatedAt, tickets = ["A", "B"]) => ({
  ...applyOp([], parseOp({ id, title: id, tickets }), updatedAt).plan,
});

test("merge adds missing plans, keeps the newer one by id, stays sorted and capped", () => {
  const here = [plan("a", 5000), plan("b", 1000)];
  const old = [plan("b", 2000, ["X", "Y", "Z"]), plan("c", 3000), { ...plan("a", 4000), title: "older" }];
  const merged = mergePlans(here, old);
  assert.deepEqual(merged.map((p) => p.id), ["b", "c", "a"]);
  assert.equal(merged.find((p) => p.id === "a").title, "a");
  assert.equal(merged.find((p) => p.id === "b").stages[0].steps.length, 3);
  const many = Array.from({ length: 12 }, (_, i) => plan(`p${i}`, 1000 + i));
  assert.equal(mergePlans([], many).length, 10);
  assert.equal(mergePlans([], many)[0].id, "p2");
});

test("a real stored row moves whole: counts, statuses, acceptance and times are equal after", async () => {
  // Shape as background-peek 0.5 stores it.
  let { plans } = applyOp([], parseOp({ id: "w", title: "Волна v5", epics: [{ name: "Волна 1", tickets: [{ title: "Card", code: "CS", criteria: 4, owner: "Sonnet 5.5", points: 3 }, "Lists"] }] }), 1000);
  ({ plans } = applyOp(plans, parseOp({ id: "w", accept: [{ ticket: "CS", confirmed: 3 }] }), 2000));
  const stored = JSON.parse(JSON.stringify({ plans }));
  const rows = new Map();
  const service = createPlanService({
    store: { load: async (id) => rows.get(id), save: async (id, v) => (v === null ? rows.delete(id) : rows.set(id, JSON.parse(JSON.stringify(v)))) },
  });
  const old = readStored(stored);
  const after = await service.replace("thr_1", (current) => mergePlans(current, old));
  assert.deepEqual(counts(old), counts(after));
  assert.equal(sameCount(old, after), 1);
  assert.deepEqual(readStored(rows.get("thr_1")), old);
  const card = after[0].stages[0].steps[0];
  assert.equal(card.accepted, 3);
  assert.equal(card.doneAt, 2000);
  // Running it again changes nothing.
  const again = await service.replace("thr_1", (current) => mergePlans(current, old));
  assert.deepEqual(again, after);
  const text = reportText([{ threadId: "thr_1", before: counts(old), after: counts(after), same: 1 }], "Moved");
  assert.match(text, /thr_1\s+1\/2\s+->\s+1\/2\s+1\/1 ok/);
});

test("the command is named task-queue and offers migrate only when the server passes it", async () => {
  const service = createPlanService({ store: { load: async () => undefined, save: async () => {} } });
  const cli = createPlanCli(service);
  assert.equal(cli.name, "task-queue");
  let r = await cli.run(["migrate"], {});
  assert.notEqual(r.exitCode, 0);
  const withMigrate = createPlanCli(service, async (id) => id, Date.now, async (again) => `ran again=${again}\n`);
  r = await withMigrate.run(["migrate", "--again"], {});
  assert.equal(r.stdout, "ran again=true\n");
});
