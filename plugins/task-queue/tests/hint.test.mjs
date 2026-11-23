import test from "node:test";
import assert from "node:assert/strict";
import { agentCodes, epicHint, headerCurrent, linkAgents, unlinkedLine, nowDoing, planHints, ruDuration, spendLine, ticketHint } from "../hint.ts";
import { applyOp, describe, parseOp, progress, readStored, withMetrics } from "../plan.ts";

const MIN = 60_000;
const NOW = 100 * MIN;
const hint = (step, extra = {}) => ticketHint(step, { now: NOW, waiting: false, ...extra });
const base = { title: "MQ стройка 6 кварталов", code: "MQ", owner: "Opus 5.5", createdAt: 60 * MIN };

// ── Times in words ─────────────────────────────────────────────────────────

test("ruDuration: seconds, minutes, hours with two-digit minutes", () => {
  assert.equal(ruDuration(45_000), "45 с");
  assert.equal(ruDuration(12 * MIN), "12 мин");
  assert.equal(ruDuration(65 * MIN), "1 ч 05 мин");
  assert.equal(ruDuration(-5), "0 с");
});

// ── Ticket hint for every status, with and without desc / createdAt ─────────

test("queued: time in the queue from createdAt; without createdAt no time is made up", () => {
  const h = hint({ ...base, status: "pending", desc: "Стройка по кварталам параметром." });
  assert.equal(h.title, "Стройка по кварталам параметром.");
  assert.equal(h.state, "В очереди 40 мин · делает Opus 5.5");
  assert.equal(h.now, null);
  const old = hint({ title: "Старый тикет", status: "pending" });
  assert.equal(old.title, "Старый тикет");
  assert.equal(old.state, "В очереди");
});

test("running: time in work, time it waited before, who does it, what the agent does now", () => {
  const step = { ...base, status: "active", startedAt: 92 * MIN };
  const agent = { kind: "agent", title: "MQ · стройка", command: null, running: [] };
  const h = hint(step, { agent });
  assert.equal(h.title, "MQ стройка 6 кварталов");
  assert.equal(h.state, "В работе 8 мин · до этого ждал в очереди 32 мин · делает Opus 5.5");
  assert.equal(h.now, "Сейчас: думает");
  const busy = hint(step, { agent: { ...agent, running: [{ label: "Running command", text: "npm test", icon: "Terminal", tool: "Bash" }] } });
  assert.equal(busy.now, "Сейчас: выполняет команду npm test");
  const noCreated = hint({ title: "T", status: "active", startedAt: 92 * MIN, owner: "lead Fable 5.2" });
  assert.equal(noCreated.state, "В работе 8 мин · делает ведущий (Fable 5.2)");
  // Started the moment it was made: no "ждал в очереди 0 с".
  assert.equal(hint({ title: "T", status: "active", createdAt: 92 * MIN, startedAt: 92 * MIN }).state, "В работе 8 мин");
});

test("waiting, rework, review, done, failed, cancelled", () => {
  assert.equal(hint({ ...base, status: "active", startedAt: 92 * MIN }, { waiting: true }).state, "Ждёт ответа владельца · в работе 8 мин · делает Opus 5.5");
  assert.equal(
    hint({ ...base, status: "active", startedAt: 81 * MIN, rework: 1, reworkAt: 98 * MIN }).state,
    "Возвращён на доработку 2 мин назад · всего в работе 19 мин · делает Opus 5.5",
  );
  assert.equal(hint({ title: "T", status: "active", startedAt: 81 * MIN, rework: 2 }).state, "Возвращён на доработку 2 раза · всего в работе 19 мин");
  assert.equal(
    hint({ ...base, status: "review", startedAt: 82 * MIN, reviewAt: 97 * MIN }).state,
    "Сдан на приёмку 3 мин назад · работа заняла 15 мин · делает Opus 5.5",
  );
  assert.equal(
    hint({ title: "T", status: "done", startedAt: 70 * MIN, doneAt: 91 * MIN, criteria: 6, accepted: 5, rework: 1 }).state,
    "Принят · работа заняла 21 мин · подтверждено 5 из 6 критериев · возвращался 1 раз",
  );
  assert.equal(hint({ title: "T", status: "done" }).state, "Готов");
  assert.equal(hint({ title: "T", status: "error" }).state, "Ошибка: работа остановлена");
  assert.equal(hint({ title: "T", status: "skipped", desc: "Не нужно." }).title, "Не нужно.");
  assert.equal(hint({ title: "T", status: "skipped" }).state, "Отменён: делать не будут");
  // An agent is only mentioned for a ticket in work.
  assert.equal(hint({ title: "T", status: "done" }, { agent: { kind: "agent", title: "", command: null, running: [] } }).now, null);
});

test("no service words in any hint: pt, done by, code:", () => {
  const steps = [
    { ...base, status: "pending", points: 8 },
    { ...base, status: "active", points: 8, startedAt: 90 * MIN },
    { ...base, status: "review", points: 8, startedAt: 90 * MIN, reviewAt: 95 * MIN },
    { ...base, status: "done", points: 8, criteria: 3, accepted: 3, startedAt: 90 * MIN, doneAt: 95 * MIN },
  ];
  for (const step of steps) {
    const h = hint(step);
    assert.doesNotMatch(`${h.title} ${h.state}`, /\bpt\b|done by|code:/);
  }
});

test("epic, plan pills and the closed header in words", () => {
  const stage = { steps: [{ title: "A", status: "done", criteria: 4, accepted: 4 }, { title: "B", status: "done", criteria: 1, accepted: 0 }, { title: "C", status: "pending" }] };
  assert.equal(epicHint(stage), "Готово 2 из 3 тикетов, приёмка 80%");
  assert.equal(epicHint({ steps: [{ title: "A", status: "pending" }] }), "Готово 0 из 1 тикета");
  const plan = { stages: [stage], state: "running", startedAt: NOW - 21 * MIN, finishedAt: null };
  const h = planHints(plan, NOW);
  assert.equal(h.count, "Готово 2 из 3 тикетов");
  assert.match(h.time, /^План в работе 21 мин, начат в \d\d:\d\d$/);
  assert.equal(h.eta(19 * MIN), "Осталось примерно 19 мин — по темпу уже принятых тикетов");
  assert.equal(h.acceptance, "Приёмка 80%: ведущий подтвердил 4 из 5 критериев у принятых тикетов");
  const two = { stages: [{ steps: [{ title: "ON одна карточка", code: "ON", status: "active" }, { title: "DS", code: "DS", status: "active" }] }], state: "running" };
  assert.equal(headerCurrent(two, progress(two).current), "2 тикета в работе");
  const one = { stages: [{ steps: [{ title: "ON одна карточка", status: "active" }] }], state: "running" };
  assert.equal(headerCurrent(one, progress(one).current), "одна карточка");
});

test("agent lines: what it does, time and tokens without calls, the more row", () => {
  assert.equal(nowDoing({ kind: "command", title: "", command: "npm run build", running: [] }), "выполняет команду npm run build");
  assert.equal(nowDoing({ kind: "agent", title: "", command: null, running: [{ label: "Read file", text: "a.ts", icon: "File", tool: "Read" }] }), "вызывает Read a.ts");
  assert.equal(spendLine({ startedAt: NOW - 12 * MIN, tokens: 959_000 }, NOW), "12 мин · 959k токенов");
  assert.equal(unlinkedLine([]), null);
  assert.equal(
    unlinkedLine([{ kind: "agent", title: "PF · Замер", name: "Шифр", command: null, running: [] }, { kind: "command", title: "", command: "npm test", running: [] }]),
    "Ещё работают без тикета: Шифр (Замер), команда npm test",
  );
});

// ── ON: tying agents to tickets ────────────────────────────────────────────

const agent = (title) => ({ kind: "agent", title, command: null, running: [] });
const planOf = (steps) => ({ stages: [{ name: "", steps }] });

test("agentCodes reads codes at the start of a name", () => {
  assert.deepEqual(agentCodes("UX SM · Крестик"), ["UX", "SM"]);
  assert.deepEqual(agentCodes("TQ MG QN FL PR · План отдельным плагином"), ["TQ", "MG", "QN", "FL", "PR"]);
  assert.deepEqual(agentCodes("M1 fix DSCR, finish audit fixes"), []);
  assert.deepEqual(agentCodes("ON: одна карточка"), ["ON"]);
});

test("link by code; several codes; a code of a ticket not in work does not tie", () => {
  const ux = { title: "Крестик", code: "UX", status: "active" };
  const sm = { title: "Плавность", code: "SM", status: "review" };
  const q = { title: "Очередь", code: "QQ", status: "pending" };
  const a = agent("UX SM · Крестик и плавность");
  const b = agent("QQ · ждёт");
  const { byTicket, unlinked } = linkAgents(planOf([ux, sm, q]), [a, b]);
  assert.deepEqual(byTicket.get(ux), [a]);
  assert.deepEqual(byTicket.get(sm), [a]);
  assert.equal(byTicket.get(q), undefined);
  assert.deepEqual(unlinked, [b]);
});

test("link by the only ticket in work when exactly one agent runs; codes read off old titles too", () => {
  const t = { title: "дома, ФОТ и выручка", owner: "Opus 5.5", status: "active" };
  const a = agent("M1 fix DSCR, finish audit fixes");
  let r = linkAgents(planOf([{ title: "LD", status: "done" }, t]), [a]);
  assert.deepEqual(r.byTicket.get(t), [a]);
  assert.deepEqual(r.unlinked, []);
  // Two agents, or two tickets in work: no guess.
  r = linkAgents(planOf([t]), [a, agent("Другой")]);
  assert.equal(r.byTicket.size, 0);
  assert.equal(r.unlinked.length, 2);
  r = linkAgents(planOf([t, { title: "x", status: "active" }]), [a]);
  assert.equal(r.byTicket.size, 0);
  // Old-style title with a leading code ties by that code.
  const legacy = { title: "MQ стройка, 8 б., Opus 5.5", status: "active" };
  r = linkAgents(planOf([legacy, { title: "y", status: "active" }]), [agent("MQ · стройка")]);
  assert.equal(r.byTicket.get(legacy).length, 1);
});

test("no match: nothing tied, everything in the more row; commands never tie", () => {
  const t = { title: "A", code: "AA", status: "active" };
  const r = linkAgents(planOf([t, { title: "B", code: "BB", status: "active" }]), [agent("ZZ · чужое"), { kind: "command", title: "AA · npm", command: "npm", running: [] }]);
  assert.equal(r.byTicket.size, 0);
  assert.equal(r.unlinked.length, 2);
});

// ── DS: desc and describe ──────────────────────────────────────────────────

test("desc on create, describe to change or clear, kept on resend and storage, shown by plan show --full", () => {
  let { plans, plan } = applyOp(
    [],
    parseOp({ id: "d", title: "D", tickets: [{ title: "Карточка", code: "CS", desc: "Карточка пациента с вкладками." }, { title: "Списки" }] }),
    1000,
  );
  assert.equal(plan.stages[0].steps[0].desc, "Карточка пациента с вкладками.");
  assert.equal(plan.stages[0].steps[0].createdAt, 1000);
  ({ plans, plan } = applyOp(plans, parseOp({ id: "d", describe: [{ ticket: "Списки", desc: "Справочники врачей." }] }), 2000));
  assert.equal(plan.stages[0].steps[1].desc, "Справочники врачей.");
  ({ plans, plan } = applyOp(plans, parseOp({ id: "d", tickets: ["Карточка", "Списки", "Новый"] }), 3000));
  assert.equal(plan.stages[0].steps[0].desc, "Карточка пациента с вкладками.");
  assert.equal(plan.stages[0].steps[0].createdAt, 1000);
  assert.equal(plan.stages[0].steps[2].createdAt, 3000);
  const [read] = readStored(JSON.parse(JSON.stringify({ plans })));
  assert.equal(read.stages[0].steps[1].desc, "Справочники врачей.");
  assert.equal(withMetrics(read, 4000).stages[0].steps[0].desc, "Карточка пациента с вкладками.");
  assert.doesNotMatch(describe(read, 4000), /Справочники врачей/);
  assert.match(describe(read, 4000, true), /^ {2}\[ \] Списки\n {6}Справочники врачей\.$/m);
  ({ plan } = applyOp([read], parseOp({ id: "d", describe: [{ ticket: "CS", desc: null }] }), 5000));
  assert.equal(plan.stages[0].steps[0].desc, undefined);
  assert.throws(() => parseOp({ id: "d", describe: [{ ticket: "CS", desc: "x".repeat(301) }] }), /longer than 300/);
  assert.throws(() => applyOp([read], parseOp({ id: "d", describe: [{ ticket: "Nope", desc: "x" }] }), 6000), /no step "Nope"/);
  // An old plan without desc: the hint shows the title.
  assert.equal(ticketHint({ title: "Старое название", status: "pending" }, { now: 0, waiting: false }).title, "Старое название");
});
