import test from "node:test";
import assert from "node:assert/strict";
import { applyEvents, deriveSubagents, executorCounts, executorSummary, emptyLog, formatDuration, formatTokens, formatCalls, metaParts, modelLabel, parseDetail, resolveModel, sortExecutors, cardRows, ticketCode, threadState, type Executor, type ThreadEvent } from "./agents.ts";

let seq = 0;
const ev = (type: string, at: number, item: Record<string, unknown>): ThreadEvent => ({ seq: ++seq, type, createdAt: at, data: { item } });
const delegation = (id: string, label: string, detail: string, at: number) => ev("item/started", at, { type: "delegation", id, childRef: "toolu_" + id, label, status: "pending", background: false, presentation: { detail } });
const launched = (id: string, at: number) => ev("item/completed", at, { type: "delegation", id, childRef: "toolu_" + id, label: "x", status: "completed", summary: "Async agent launched successfully." });
const run = (id: string, family: string, parent: string, at: number, extra: Record<string, unknown> = {}) => ev(extra.taskStatus && extra.taskStatus !== "running" ? "item/backgroundTask/completed" : "item/started", at, { type: "backgroundTask", id, familyId: family, taskType: "local_agent", description: "desc " + family, status: "pending", taskStatus: "running", parentToolCallId: parent, ...extra });
const sendMessage = (id: string, to: string, at: number) => ev("item/started", at, { type: "toolCall", id, tool: "SendMessage", arguments: { to } });

function history(): ThreadEvent[] {
 seq = 0;
 return [
  delegation("d1", "R19 Сравнение с курортами", "general-purpose agent · model sonnet", 1000),
  run("r1", "famA", "d1", 1001),
  launched("d1", 1001),
  ev("item/backgroundTask/progress", 2000, { type: "backgroundTask", id: "r1", familyId: "famA", taskType: "local_agent", taskStatus: "running", usage: { totalTokens: 5000, toolUses: 3, durationMs: 999 } }),
  run("r1", "famA", "d1", 61001, { taskStatus: "completed", status: "completed", usage: { totalTokens: 90000, toolUses: 10, durationMs: 60000 }, summary: "Готово: таблица цен" }),
  // Resumed twice through SendMessage: still one row.
  sendMessage("s1", "famA", 70000),
  run("r2", "famA", "s1", 70001),
  run("r2", "famA", "s1", 100001, { taskStatus: "completed", usage: { totalTokens: 95000, toolUses: 4, durationMs: 30000 }, summary: "Поправил" }),
  sendMessage("s2", "famA", 200000),
  run("r3", "famA", "s2", 200001),
  { seq: ++seq, type: "client/turn/requested", createdAt: 299000, data: { execution: { model: "claude-sonnet-5-5" } } },
  delegation("d2", "Без модели", "general-purpose agent", 300000),
  run("r4", "famB", "d2", 300001),
  run("r4", "famB", "d2", 400001, { taskStatus: "failed", usage: { totalTokens: 1000, toolUses: 1, durationMs: 100000 } }),
  // Foreground launch without a background run.
  delegation("d3", "Explore", "Explore agent · model haiku", 500000),
  ev("item/completed", 520000, { type: "delegation", id: "d3", childRef: "toolu_d3", label: "Explore", status: "completed", summary: "Нашёл три файла" }),
  // A subagent's own nested launch is not an executor of this thread.
  ev("item/started", 510000, { type: "delegation", id: "d4", childRef: "toolu_d4", label: "nested", status: "pending", parentToolCallId: "d3" }),
 ];
}

test("history yields one row per launch; resumed agent is not duplicated and runs again", () => {
 const list = deriveSubagents(applyEvents(emptyLog(), history()));
 assert.equal(list.length, 3);
 const a = list.find(x => x.id === "agent:famA")!;
 assert.equal(a.state, "running");
 assert.equal(a.title, "R19 Сравнение с курортами");
 assert.equal(a.toolUses, 14);
 assert.equal(a.tokens, 95000);
 assert.equal(a.durationMs, 90000);
 assert.equal(a.activeSince, 200001);
 assert.equal(a.summary, "Поправил");
 assert.equal(list.find(x => x.id === "agent:famB")!.state, "error");
 assert.equal(list.find(x => x.id === "delegation:d3")!.summary, "Нашёл три файла");
});

test("re-reading the same events never double counts", () => {
 const events = history();
 const log = applyEvents(emptyLog(), events);
 applyEvents(log, events);
 const restored = applyEvents(JSON.parse(JSON.stringify(log)), events);
 assert.deepEqual(deriveSubagents(restored), deriveSubagents(applyEvents(emptyLog(), events)));
});

test("a run bb no longer reports alive reads as stopped", () => {
 const log = applyEvents(emptyLog(), history());
 assert.equal(deriveSubagents(log, new Set()).find(x => x.id === "agent:famA")!.state, "stopped");
 assert.equal(deriveSubagents(log, new Set(["r3"])).find(x => x.id === "agent:famA")!.state, "running");
});

test("model source: actual, then requested, then the leader's", () => {
 const log = applyEvents(emptyLog(), history());
 const list = deriveSubagents(log);
 const requested = resolveModel(list.find(x => x.id === "agent:famA")!, "claude-fable-5-2")!;
 assert.deepEqual([requested.label, requested.source, requested.inherited], ["Sonnet 5.5", "requested", false]);
 const inherited = resolveModel(list.find(x => x.id === "agent:famB")!, "claude-fable-5-2")!;
 // The leader's model at launch time wins over its current one.
 assert.deepEqual([inherited.label, inherited.source, inherited.inherited], ["как у ведущего (Sonnet 5.5)", "inherited", true]);
 assert.equal(resolveModel({ ...list.find(x => x.id === "agent:famB")!, leaderModel: null }, "claude-fable-5-2")!.label, "как у ведущего (Fable 5.2)");
 assert.equal(inherited.hint, "Модель при запуске не указана: исполнитель взял модель ведущего");
 // A model reported by the run itself wins over the launch parameter.
 applyEvents(log, [ev("item/backgroundTask/progress", 210000, { type: "backgroundTask", id: "r3", familyId: "famA", taskType: "local_agent", taskStatus: "running", model: "claude-opus-5-5" })]);
 const actual = resolveModel(deriveSubagents(log).find(x => x.id === "agent:famA")!, "claude-fable-5-2")!;
 assert.deepEqual([actual.label, actual.source], ["Opus 5.5", "actual"]);
 assert.equal(resolveModel({ model: null, modelSource: "inherited" }, null), null);
});

test("model names come from one dictionary; unknown ids stay as they are", () => {
 assert.equal(modelLabel("claude-opus-5-5"), "Opus 5.5");
 assert.equal(modelLabel("claude-sonnet-5-5[1m]"), "Sonnet 5.5");
 assert.equal(modelLabel("haiku"), "Haiku 5.5");
 assert.equal(modelLabel("fable"), "Fable 5.2");
 assert.equal(modelLabel("gpt-9-astra"), "gpt-9-astra");
 assert.deepEqual(parseDetail("Explore agent · model haiku"), { agentType: "Explore", model: "haiku" });
 assert.deepEqual(parseDetail("model opus"), { agentType: null, model: "opus" });
 assert.deepEqual(parseDetail("general-purpose agent"), { agentType: "general-purpose", model: null });
});

const ex = (id: string, state: Executor["state"], startedAt: number, endedAt: number | null): Executor => ({ id, title: id, kind: "subagent", state, threadId: null, model: null, modelSource: "inherited", startedAt, endedAt, activeSince: state === "running" ? startedAt : null, durationMs: null, toolUses: null, tokens: null, summary: null, agentType: null });
test("running first (newest first), then finished by end time, newest first", () => {
 const sorted = sortExecutors([ex("doneOld", "done", 1, 10), ex("runOld", "running", 5, null), ex("err", "error", 2, 30), ex("runNew", "running", 50, null), ex("stop", "stopped", 3, 20)]);
 assert.deepEqual(sorted.map(x => x.id), ["runNew", "runOld", "err", "stop", "doneOld"]);
});

test("failed come right after running, newest first; names and ids stay as they were", () => {
 const list = [ex("done", "done", 1, 90), ex("errOld", "error", 2, 10), ex("run", "running", 5, null), ex("errNew", "error", 3, 40)].map((x, i) => ({ ...x, ordinal: i + 1, name: "n" + (i + 1) }));
 const sorted = sortExecutors(list);
 assert.deepEqual(sorted.map(x => x.id), ["run", "errNew", "errOld", "done"]);
 assert.deepEqual(sorted.map(x => x.name).sort(), ["n1", "n2", "n3", "n4"]);
 assert.equal(sorted.find(x => x.id === "errNew")!.name, "n4");
});

test("card: one row is given to a failed executor when none fits in three", () => {
 const sorted = sortExecutors([ex("r1", "running", 1, null), ex("r2", "running", 2, null), ex("r3", "running", 3, null), ex("r4", "running", 4, null), ex("bad", "error", 1, 10), ex("ok", "done", 1, 20)]);
 const { shown, rest } = cardRows(sorted, 3);
 assert.deepEqual(shown.map(x => x.id), ["r4", "r3", "bad"]);
 assert.equal(rest, 3);
 // a failed row already among the first three: nothing is displaced
 assert.deepEqual(cardRows(sortExecutors([ex("r1", "running", 1, null), ex("bad", "error", 1, 10), ex("ok", "done", 1, 20), ex("ok2", "done", 1, 5)]), 3).shown.map(x => x.id), ["r1", "bad", "ok"]);
 // no failed: plain first three
 assert.deepEqual(cardRows(sortExecutors([ex("a", "running", 1, null), ex("b", "done", 1, 5), ex("c", "done", 1, 4), ex("d", "done", 1, 3)]), 3).shown.map(x => x.id), ["a", "b", "c"]);
});

test("time, calls and tokens always carry a unit", () => {
 assert.equal(formatDuration(42_000), "42 с");
 assert.equal(formatDuration(4 * 60_000 + 20_000), "4 мин");
 assert.equal(formatDuration(65 * 60_000), "1 ч 5 мин");
 assert.equal(formatDuration(120 * 60_000), "2 ч");
 assert.equal(formatTokens(950), "950 токенов");
 assert.equal(formatTokens(1), "1 токен");
 assert.equal(formatTokens(1234), "1.2k токенов");
 assert.equal(formatTokens(120_400), "120k токенов");
 assert.equal(formatTokens(1_250_000), "1.3M токенов");
 assert.equal(formatCalls(1), "1 вызов");
 assert.equal(formatCalls(3), "3 вызова");
 assert.equal(formatCalls(56), "56 вызовов");
 assert.equal(formatCalls(11), "11 вызовов");
 const x = { ...ex("a", "running", 1000, null), durationMs: 60_000, toolUses: 56, tokens: 120_000 };
 assert.deepEqual(metaParts(x, 1000 + 180_000), ["4 мин", "120k токенов"]);
 assert.deepEqual(metaParts(ex("b", "done", 1, 2), 5), []);
});

test("ticket codes split off the title", () => {
 assert.deepEqual(ticketCode("R19 Сравнение с курортами"), { code: "R19", name: "Сравнение с курортами" });
 assert.deepEqual(ticketCode("M1 fix DSCR"), { code: "M1", name: "fix DSCR" });
 assert.deepEqual(ticketCode("BUH-06 receipt editing"), { code: "BUH-06", name: "receipt editing" });
 assert.equal(ticketCode("T1b deck skeleton").code, null);
 assert.equal(ticketCode("API docs refresh").code, null);
 assert.equal(ticketCode("Group A: slides").code, null);
});

test("child thread runtime status maps to a state", () => {
 assert.equal(threadState("active"), "running");
 assert.equal(threadState("idle"), "done");
 assert.equal(threadState("error"), "error");
 assert.equal(threadState("interrupted"), "stopped");
});

import { actionText, applyActions, elapsedMs, formatClock } from "./agents.ts";

test("current action: the latest tool call started inside a launch, by its launch id", () => {
 const ev = (seq: number, item: Record<string, unknown>, at = seq * 1000): ThreadEvent => ({ seq, type: "item/started", createdAt: at, data: { item } });
 const acts = applyActions({}, [
  ev(1, { type: "fileRead", id: "r1", path: "/w/docs/plan.md", parentToolCallId: "d1" }),
  ev(2, { type: "commandExecution", id: "c1", command: "npm test\nsecond line", parentToolCallId: "d1" }),
  ev(3, { type: "fileChange", id: "f1", changes: [{ path: "/w/src/a.ts" }], parentToolCallId: "d2" }),
  ev(4, { type: "agentMessage", id: "m1", parentToolCallId: "d2" }),
  ev(5, { type: "commandExecution", id: "top", command: "ls" }),
 ]);
 assert.deepEqual(acts.d1, { kind: "command", detail: "npm test", at: 2000 });
 assert.deepEqual(acts.d2, { kind: "edit", detail: "a.ts", at: 3000 });
 assert.equal(Object.keys(acts).length, 2);
 assert.equal(actionText(acts.d1, "en"), "Running · npm test");
 assert.equal(actionText(acts.d2, "ru"), "Правит · a.ts");
 assert.equal(actionText(null, "en"), null);
});

test("the action reaches a running executor and is dropped once it finishes", () => {
 const log = emptyLog();
 applyEvents(log, [
  { seq: 1, type: "item/started", createdAt: 1000, data: { item: { type: "delegation", id: "d1", label: "Write the report", status: "pending" } } },
  { seq: 2, type: "item/started", createdAt: 1000, data: { item: { type: "backgroundTask", id: "b1", familyId: "f1", taskType: "local_agent", taskStatus: "running", parentToolCallId: "d1" } } },
 ]);
 const actions = { d1: { kind: "read", detail: "notes.md", at: 1500 } };
 assert.deepEqual(deriveSubagents(log, undefined, actions)[0].action, actions.d1);
 applyEvents(log, [{ seq: 3, type: "item/backgroundTask/completed", createdAt: 5000, data: { item: { type: "backgroundTask", id: "b1", familyId: "f1", taskType: "local_agent", taskStatus: "completed", parentToolCallId: "d1" } } }]);
 assert.equal(deriveSubagents(log, undefined, actions)[0].action, undefined);
});

test("live clock and elapsed time; English units", () => {
 assert.equal(formatClock(65_000), "1:05");
 assert.equal(formatClock(3_725_000), "1:02:05");
 assert.equal(elapsedMs({ state: "running", activeSince: 1000, durationMs: 2000, startedAt: 0, kind: "subagent" }, 4000), 5000);
 assert.equal(elapsedMs({ state: "running", activeSince: null, durationMs: null, startedAt: 1000, kind: "thread" }, 61_000), 60_000);
 assert.equal(elapsedMs({ state: "done", activeSince: null, durationMs: null, startedAt: 1, kind: "subagent" }, 9), null);
 assert.equal(formatDuration(42_000, "en"), "42 s");
 assert.equal(formatDuration(65 * 60_000, "en"), "1 h 5 min");
 assert.equal(formatTokens(1, "en"), "1 token");
 assert.equal(formatTokens(120_400, "en"), "120k tokens");
 assert.equal(formatCalls(1, "en"), "1 tool call");
 assert.equal(resolveModel({ model: null, modelSource: "inherited", leaderModel: "claude-opus-5-5" }, null, "en")?.label, "same as lead (Opus 5.5)");
});

test("executorCounts and executorSummary: sets of states, both languages, both forms", () => {
 const mk = (...states: Executor["state"][]) => states.map(state => ({ state }));
 const text = (list: ReturnType<typeof mk>, lang: "ru" | "en", form: "short" | "long") => executorSummary(executorCounts(list), lang, form).map(p => p.text).join(" · ");
 const idle = mk("done", "done", "done", "done", "done");
 assert.deepEqual(executorCounts(idle), { running: 0, done: 5, error: 0, stopped: 0, total: 5 });
 assert.equal(text(idle, "ru", "short"), "5 завершили");
 assert.equal(text(idle, "en", "short"), "5 finished");
 assert.equal(text(idle, "ru", "long"), "Завершили 5");
 const busy = mk("running", "running", "done", "done", "done", "done", "done");
 assert.equal(text(busy, "ru", "short"), "2 в работе · 5 завершили");
 assert.equal(text(busy, "en", "short"), "2 running · 5 finished");
 assert.equal(text(busy, "ru", "long"), "В работе 2 · Завершили 5");
 assert.equal(text(busy, "en", "long"), "Running 2 · Finished 5");
 const bad = mk("running", "done", "error");
 assert.equal(text(bad, "ru", "short"), "1 в работе · 1 завершили · 1 с ошибкой");
 assert.equal(text(bad, "ru", "long"), "В работе 1 · Завершили 1 · С ошибкой 1");
 assert.equal(text(bad, "en", "long"), "Running 1 · Finished 1 · Failed 1");
 assert.deepEqual(executorSummary(executorCounts(bad), "ru").map(p => p.state), ["running", "done", "error"]);
 assert.equal(text(mk("stopped"), "ru", "short"), "1 остановлен");
 assert.equal(text(mk("stopped", "stopped"), "ru", "short"), "2 остановлено");
 assert.equal(text(mk("stopped"), "en", "short"), "1 stopped");
 assert.deepEqual(executorCounts([]), { running: 0, done: 0, error: 0, stopped: 0, total: 0 });
 assert.deepEqual(executorSummary(executorCounts([]), "ru"), []);
});

import { executorDeleteAction, visibleExecutors, executorCounts as countVisible } from "./agents.ts";
test("deletion policy distinguishes live subagents and child threads", () => {
 assert.equal(executorDeleteAction({kind:"thread",threadId:"thr_test",state:"running"}),"delete-thread");
 assert.equal(executorDeleteAction({kind:"subagent",threadId:null,state:"running"}),"blocked");
 for(const state of ["done","error","stopped"] as const) assert.equal(executorDeleteAction({kind:"subagent",threadId:null,state}),"hide");
});
test("persisted hidden identities filter all counter inputs without mutating rows", () => {
 const rows=[{id:"a",state:"done" as const},{id:"b",state:"running" as const},{id:"c",state:"error" as const}];
 const hidden=JSON.parse(JSON.stringify(["a","c"]));
 assert.deepEqual(countVisible(visibleExecutors(rows,hidden)),{total:1,running:1,done:0,error:0,stopped:0});
 assert.equal(rows.length,3);
 assert.deepEqual(visibleExecutors(rows,hidden),visibleExecutors(rows,hidden));
});
