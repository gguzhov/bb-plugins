// NM: agents tied to tickets by name, no codes in what the owner or the agent reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp, describe, parseOp, readStored, summary } from "../plan.ts";
import { linkAgents } from "../hint.ts";
import { ticketView } from "../format.ts";

const run = (plans, raw, now = 1000) => applyOp(plans, parseOp(raw), now);
const agent = (title, id) => ({ kind: "agent", title, id, command: null, running: [] });
const create = {
  id: "nm",
  title: "Имена",
  epics: [{ name: "Очередь 1", tickets: [{ title: "Масштаб щипком", code: "PZ" }, { title: "Плашка агента" }, { title: "Навык", agent: "Правка навыка" }] }],
};

test("start с agent, assign и agent при создании: агент записан у тикета; старая форма start работает", () => {
  let { plans, plan } = run([], create);
  assert.equal(plan.stages[0].steps[2].agent, "Правка навыка");
  ({ plans, plan } = run(plans, { id: "nm", start: [{ ticket: "Масштаб щипком", agent: "PDF: масштаб" }, "Плашка агента"] }));
  assert.equal(plan.stages[0].steps[0].agent, "PDF: масштаб");
  assert.equal(plan.stages[0].steps[0].status, "active");
  assert.equal(plan.stages[0].steps[1].agent, undefined);
  assert.equal(plan.stages[0].steps[1].status, "active");
  ({ plans, plan } = run(plans, { id: "nm", assign: [{ ticket: "Плашка агента", agent: "thr_abc123" }] }));
  assert.equal(plan.stages[0].steps[1].agent, "thr_abc123");
  assert.throws(() => run(plans, { id: "nm", assign: ["Плашка агента"] }), /assign\[0\] must be \{ticket, agent\}/);
  // A ticket is found by the title the card shows (codes cut off) too.
  const coded = run([], { id: "c", title: "C", tickets: [{ title: "Облегчение плагинов LT", code: "LT" }] }).plans;
  assert.equal(run(coded, { id: "c", assign: [{ ticket: "облегчение плагинов", agent: "x" }] }).plan.stages[0].steps[0].agent, "x");
  // Old plan by code still works.
  ({ plan } = run(plans, { id: "nm", review: ["PZ"] }));
  assert.equal(plan.stages[0].steps[0].status, "review");
  // Agent is kept on resend and in storage.
  ({ plans, plan } = run(plans, create));
  assert.equal(plan.stages[0].steps[0].agent, "PDF: масштаб");
  assert.equal(readStored({ plans })[0].stages[0].steps[0].agent, "PDF: масштаб");
});

test("привязка: явный agent (без регистра и крайних пробелов, по id), один агент на несколько тикетов, несколько агентов на тикет", () => {
  let { plans } = run([], create);
  ({ plans } = run(plans, { id: "nm", start: [{ ticket: "Масштаб щипком", agent: "  pdf: МАСШТАБ " }, { ticket: "Плашка агента", agent: "PDF: масштаб" }, { ticket: "Навык", agent: "thr_child1" }] }));
  const plan = plans[0];
  const [a, b, c] = plan.stages[0].steps;
  const x = agent("PDF: масштаб", "fam1");
  const y = agent("Дочерний тред", "thr_child1");
  const z = agent("Чужой", "fam9");
  const r = linkAgents(plan, [x, y, z]);
  assert.deepEqual(r.byTicket.get(a), [x]);
  assert.deepEqual(r.byTicket.get(b), [x]);
  assert.deepEqual(r.byTicket.get(c), [y]);
  assert.deepEqual(r.unlinked, [z]);
  // two agents named on one ticket via two starts — the latest assignment wins, so use the same name twice
  const two = linkAgents({ stages: [{ name: "", steps: [{ title: "T", status: "active", agent: "Общий" }] }] }, [agent("Общий", "1"), agent("общий", "2")]);
  assert.equal(two.byTicket.get(two.byTicket.keys().next().value).length, 2);
});

test("запасные правила: код в названии агента для старых планов, затем один тикет и один агент", () => {
  const old = { title: "Крестик", code: "UX", status: "active" };
  const free = { title: "Без агента", status: "active" };
  let r = linkAgents({ stages: [{ name: "", steps: [old] }] }, [agent("UX · Крестик")]);
  assert.equal(r.byTicket.get(old).length, 1);
  r = linkAgents({ stages: [{ name: "", steps: [{ title: "Явный", status: "active", agent: "Неон-задача" }, free] }] }, [agent("Неон-задача", "1"), agent("Безымянный", "2")]);
  assert.equal(r.byTicket.get(free).length, 1, "один свободный тикет и один оставшийся агент");
  r = linkAgents({ stages: [{ name: "", steps: [free, { title: "Ещё", status: "active" }] }] }, [agent("Безымянный")]);
  assert.equal(r.byTicket.size, 0);
  assert.equal(r.unlinked.length, 1);
});

test("коды не видны: название без кода, ответы команды и plan show называют агентов именами", () => {
  assert.equal(ticketView({ title: "PF · Замер скорости", code: "PF" }).name, "Замер скорости");
  assert.equal(ticketView({ title: "Замер скорости PF", code: "PF" }).name, "Замер скорости");
  assert.equal(ticketView({ title: "PDF: отчёт", code: "RP" }).name, "PDF: отчёт");
  let { plans } = run([], create);
  ({ plans } = run(plans, { id: "nm", start: [{ ticket: "PZ", agent: "PDF: масштаб" }] }));
  const label = (step) => (step.agent === "PDF: масштаб" ? "Неон" : null);
  const line = summary(plans[0], 2000, label);
  assert.match(line, /active: Масштаб щипком \(Неон\)/);
  assert.doesNotMatch(line, /\bPZ\b/);
  const text = describe(plans[0], 2000, false, label);
  assert.match(text, /\[>\] Масштаб щипком \(Неон\)/);
  assert.doesNotMatch(text, /\bPZ\b/);
});
