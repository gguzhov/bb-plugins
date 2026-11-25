import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTurnEvents, buildCard, buildSnapshot, cardState, computeWork, newTracker,
  pickCandidates, planCounts, retainDone, sortCards, workTime,
  cleanNote, cleanTitle, buildStages, estimateEta, truncate, ticketWorkMs, workWithin,
} from "../lib/logic.ts";

const S = (t) => ({ type: "turn/started", createdAt: t });
const C = (t) => ({ type: "turn/completed", createdAt: t });

test("ходы до плана дают 0, пересекающий план обрезан, после плана целиком", () => {
  const w = computeWork([S(0), C(100), S(150), C(300), S(400), C(450)], 200);
  assert.equal(w.workMs, 100 + 50);
  assert.equal(w.runningSince, null);
});

test("незавершённый ход даёт runningSince, обрезанный по началу плана", () => {
  assert.deepEqual(computeWork([S(100), C(150), S(180)], 200), { workMs: 0, runningSince: 200 });
  assert.deepEqual(computeWork([S(100), C(150), S(500)], 200), { workMs: 0, runningSince: 500 });
});

test("непарные и повторные события не ломают расчёт", () => {
  const w = computeWork([C(50), S(100), S(120), C(200), C(220), S(300), C(250)], 0);
  assert.equal(w.workMs, 100);
  assert.equal(w.runningSince, null);
  assert.deepEqual(computeWork([], 0), { workMs: 0, runningSince: null });
  assert.ok(computeWork([{ type: "turn/started", createdAt: NaN }, S(5)], 0).workMs >= 0);
});

test("накопление по частям даёт тот же результат", () => {
  const t = newTracker();
  applyTurnEvents(t, [S(10), C(20), S(30)]);
  applyTurnEvents(t, [C(50), S(60)]);
  assert.deepEqual(workTime(t, 0), { workMs: 30, runningSince: 60 });
});

const plan = (state, statuses, extra = {}) => ({
  title: "P", state, startedAt: 1, updatedAt: 5,
  stages: [{ steps: statuses.slice(0, 2).map((s, i) => ({ title: `a${i}`, status: s })) },
           { steps: statuses.slice(2).map((s, i) => ({ title: `b${i}`, status: s })) }],
  ...extra,
});

test("счёт и текущий тикет: done и skipped выполнены, active раньше error раньше review", () => {
  const c = planCounts(plan("running", ["done", "skipped", "review", "error", "pending"]));
  assert.deepEqual(c, { done: 2, total: 5, current: "b1" });
  assert.equal(planCounts(plan("running", ["done", "review", "active", "pending"])).current, "b0");
  assert.equal(planCounts(plan("running", ["done", "pending"])).current, null);
});

test("состояния карточки", () => {
  assert.equal(cardState("needs_input", true), "waiting");
  assert.equal(cardState("error", true), "error");
  assert.equal(cardState("done", true), "done");
  assert.equal(cardState("running", true), "working");
  assert.equal(cardState("running", false), "idle");
});

const card = (id, state, updatedAt) => ({
  threadId: id, project: "p", title: "t", planTitle: "x", done: 0, total: 1, remaining: 1,
  current: null, state, workMs: 0, runningSince: null, updatedAt,
});

test("порядок: working, waiting, error, idle, done; внутри свежие первыми; лимит", () => {
  const cards = [card("d", "done", 9), card("i", "idle", 1), card("w1", "working", 1), card("e", "error", 5),
    card("q", "waiting", 2), card("w2", "working", 7), card("i2", "idle", 4)];
  assert.deepEqual(sortCards(cards).map((c) => c.threadId), ["w2", "w1", "q", "e", "i2", "i", "d"]);
  const snap = buildSnapshot(cards, 3, 123);
  assert.equal(snap.generatedAt, 123);
  assert.deepEqual(snap.cards.map((c) => c.threadId), ["w2", "w1", "q"]);
});

test("итог: проекты в работе и задачи факт/план считаются до обрезки списка", () => {
  const mk = (id, project, state, done, total) => ({ ...card(id, state, 1), project, done, total, remaining: total - done });
  const cards = [mk("a", "P1", "working", 2, 6), mk("b", "P1", "working", 1, 4), mk("c", "P2", "waiting", 5, 5),
    mk("d", "P3", "idle", 0, 3), mk("e", "P2", "working", 3, 9), mk("f", "P4", "error", 1, 2)];
  const snap = buildSnapshot(cards, 2, 5);
  assert.equal(snap.cards.length, 2);
  assert.deepEqual(snap.summary, {
    projectsWorking: 2, projects: 4, threads: 6, threadsWorking: 3, threadsWaiting: 1, threadsError: 1,
    done: 12, total: 29, tasksInWorking: 19, doneInWorking: 6,
  });
  assert.deepEqual(buildSnapshot([], 5, 1).summary, {
    projectsWorking: 0, projects: 0, threads: 0, threadsWorking: 0, threadsWaiting: 0, threadsError: 0,
    done: 0, total: 0, tasksInWorking: 0, doneInWorking: 0,
  });
});

test("карточка строится строго по договору, без лишних полей", () => {
  const c = buildCard({ threadId: "t", project: "Pr", title: "T", threadActive: true, threadUpdatedAt: 9,
    plan: plan("running", ["done", "active", "pending"]), work: { workMs: 5, runningSince: 7 } });
  assert.deepEqual(Object.keys(c).sort(), ["current", "done", "planTitle", "project", "remaining", "runningSince",
    "state", "threadId", "title", "total", "updatedAt", "workMs",
    "note", "etaMs", "stages", "hiddenTickets", "icon"].sort());
  assert.equal(c.remaining, c.total - c.done);
  assert.equal(c.state, "working");
  assert.equal(c.updatedAt, 9);
});

test("кандидаты: активные или свежие, не больше max, новые первыми", () => {
  const now = 100 * 3_600_000;
  const th = [
    { id: "old", status: "idle", updatedAt: 0 },
    { id: "oldActive", status: "active", updatedAt: 1 },
    { id: "new", status: "idle", updatedAt: now - 1000 },
    { id: "mid", status: "idle", updatedAt: now - 3_600_000 },
  ];
  assert.deepEqual(pickCandidates(th, now, 24).map((t) => t.id), ["new", "mid", "oldActive"]);
  assert.equal(pickCandidates(th, now, 24, 1).length, 1);
});

test("готовая карточка держится 10 минут после последнего показа и пропадает", () => {
  const kept = new Map([["a", { card: card("a", "done", 1), seenAt: 1000 }]]);
  assert.equal(retainDone(kept, new Set(), 1000 + 599_000).length, 1);
  assert.equal(retainDone(kept, new Set(["a"]), 1000 + 1).length, 0);
  assert.equal(retainDone(kept, new Set(), 1000 + 601_000).length, 0);
  assert.equal(kept.size, 0);
});

const mk = (state, specs, extra = {}) => ({ title: "P", state, startedAt: 0, updatedAt: 1,
  stages: [{ name: "Q", steps: specs.map(([status, points], i) => ({ title: `t${i}`, status, points })) }], ...extra });
const MIN = 60_000;

test("версия сводки 2", () => {
  assert.equal(buildSnapshot([], 5, 1).version, 2);
});

test("note: обрезка до 200 с многоточием, пусто и отсутствует это null", () => {
  assert.equal(cleanNote("ждём ответа"), "ждём ответа");
  const long = cleanNote("я".repeat(300));
  assert.equal([...long].length, 200);
  assert.ok(long.endsWith("…"));
  assert.equal(cleanNote("я".repeat(200)), "я".repeat(200));
  assert.equal(cleanNote(""), null);
  assert.equal(cleanNote("  "), null);
  assert.equal(cleanNote(null), null);
  assert.equal(cleanNote(undefined), null);
  const p = plan("needs_input", ["done", "pending"], { note: "вопрос" });
  const c = buildCard({ threadId: "t", project: "", title: "T", threadActive: false, threadUpdatedAt: 1, plan: p, work: { workMs: 0, runningSince: null } });
  assert.equal(c.note, "вопрос");
  assert.equal(buildCard({ threadId: "t", project: "", title: "T", threadActive: false, threadUpdatedAt: 1, plan: plan("running", ["done"]), work: { workMs: 0, runningSince: null } }).note, null);
});

test("прогноз: формула с баллами, без баллов это 1", () => {
  // сделано 2+3=5 баллов за 10 мин, осталось 8+1=9 баллов
  const p = mk("running", [["done", 2], ["done", 3], ["active", 8], ["pending"]]);
  assert.equal(estimateEta(p, { workMs: 10 * MIN, runningSince: null }, 0), Math.round((10 * MIN / 5) * 9));
  // идущий ход входит: 6 мин + 4 мин идёт
  assert.equal(estimateEta(p, { workMs: 6 * MIN, runningSince: 1000 }, 1000 + 4 * MIN), 10 * MIN / 5 * 9);
  // без баллов: 2 сделано, 3 осталось, 10 мин => 15 мин
  assert.equal(estimateEta(mk("running", [["done"], ["done"], ["pending"], ["error"], ["review"]]), { workMs: 10 * MIN, runningSince: null }, 0), 15 * MIN);
  // округление
  assert.equal(estimateEta(mk("running", [["done"], ["done"], ["done"], ["pending"]]), { workMs: 5 * MIN + 1, runningSince: null }, 0), Math.round((5 * MIN + 1) / 3));
});

test("прогноз: skipped не считается; четыре случая null", () => {
  const w = { workMs: 10 * MIN, runningSince: null };
  assert.equal(estimateEta(mk("running", [["done"], ["done"], ["skipped"], ["pending"]]), w, 0), 5 * MIN);
  assert.equal(estimateEta(mk("running", [["done"], ["skipped"], ["pending"]]), w, 0), null); // выполнено < 2
  assert.equal(estimateEta(mk("running", [["done"], ["done"], ["pending"]]), { workMs: 5 * MIN - 1, runningSince: null }, 0), null); // < 5 мин
  assert.notEqual(estimateEta(mk("running", [["done"], ["done"], ["pending"]]), { workMs: 5 * MIN, runningSince: null }, 0), null);
  assert.equal(estimateEta(mk("running", [["done"], ["done"], ["skipped"]]), w, 0), null); // нечего ждать
  assert.equal(estimateEta(mk("done", [["done"], ["done"], ["pending"]]), w, 0), null); // план done
});

test("этапы: порядок, owner, обрезка заголовков; 70 тикетов дают 60 и hidden 10", () => {
  const steps = Array.from({ length: 70 }, (_, i) => ({ title: i === 0 ? "x".repeat(150) : `t${i}`, status: "pending", owner: i === 1 ? "Opus 5.5" : undefined }));
  const p = { ...plan("running", []), stages: [{ name: "A", steps: steps.slice(0, 30) }, { name: "B", steps: steps.slice(30) }] };
  const { stages, hiddenTickets } = buildStages(p);
  assert.equal(hiddenTickets, 10);
  assert.equal(stages.reduce((n, s) => n + s.tickets.length, 0), 60);
  assert.deepEqual(stages.map((s) => [s.name, s.tickets.length]), [["A", 30], ["B", 30]]);
  assert.equal([...stages[0].tickets[0].title].length, 120);
  assert.ok(stages[0].tickets[0].title.endsWith("…"));
  assert.equal(stages[0].tickets[1].owner, "Opus 5.5");
  assert.equal(stages[0].tickets[2].owner, null);
  assert.equal(truncate("a".repeat(120), 120), "a".repeat(120));
  // очередь без тикетов после лимита не появляется
  const q = { ...plan("running", []), stages: [{ steps: steps.slice(0, 60) }, { name: "C", steps: steps.slice(60) }] };
  const r = buildStages(q);
  assert.equal(r.stages.length, 1);
  assert.equal(r.stages[0].name, "");
  assert.equal(r.hiddenTickets, 10);
});

test("заголовок: упоминания убираются", () => {
  assert.equal(cleanTitle("Continue from @thread:thr_cwr5r3c3ag надо доработать все пожелания"), "надо доработать все пожелания");
  assert.equal(cleanTitle("Сделай  @thread:thr_abc123#msg=42   отчёт @thread:thr_x1 "), "Сделай отчёт");
  assert.equal(cleanTitle("Обычный заголовок"), "Обычный заголовок");
  assert.equal(cleanTitle("@thread:thr_abc123"), "@thread:thr_abc123");
  assert.equal(cleanTitle("Continue from @thread:thr_abc123"), "Continue from @thread:thr_abc123");
  assert.equal(cleanTitle("  Continue from тест  "), "Continue from тест");
});

test("время на задачу: работа агента внутри срока задачи", () => {
  // Ходы: 100–200, 300–400, 1000–1100.
  const intervals = [[100, 200], [300, 400], [1000, 1100]];
  assert.equal(workWithin(intervals, 150, 350), 100); // 150–200 и 300–350
  assert.equal(workWithin(intervals, 500, 900), 0);
  // Готовая: считается до doneAt, ночной простой между ходами не входит.
  assert.equal(ticketWorkMs({ status: "done", startedAt: 150, doneAt: 1050 }, intervals, 5000), 50 + 100 + 50);
  // На проверке: до сдачи.
  assert.equal(ticketWorkMs({ status: "review", startedAt: 100, reviewAt: 350 }, intervals, 5000), 100 + 50);
  // В работе: до текущего момента, идущий ход сюда не входит.
  assert.equal(ticketWorkMs({ status: "active", startedAt: 300 }, intervals, 5000), 100 + 100);
  // Не начиналась.
  assert.equal(ticketWorkMs({ status: "pending" }, intervals, 5000), 0);
  const { stages } = buildStages({ title: "p", state: "running", startedAt: 0, updatedAt: 0, stages: [{ name: "Q", steps: [
    { title: "a", status: "done", startedAt: 150, doneAt: 1050 },
    { title: "b", status: "pending" },
  ] }] }, 60, intervals, 5000);
  assert.deepEqual(stages[0].tickets, [
    { title: "a", status: "done", owner: null, agent: null, agentIcon: null, startedAt: 150, doneAt: 1050, workMs: 200 },
    { title: "b", status: "pending", owner: null, agent: null, agentIcon: null, startedAt: null, doneAt: null, workMs: 0 },
  ]);
});
