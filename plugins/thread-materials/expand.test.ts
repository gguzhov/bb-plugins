import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceLines, applyEvents, deriveSubagents, emptyLog, summaryPreview, ticketCodes, type PlanTicket, type ThreadEvent } from "./agents.ts";

const tickets: PlanTicket[] = [
 { code: "TQ", status: "done", accepted: 17, criteria: 17, startedAt: 1000, plan: "bb-ui2", planUpdatedAt: 50 },
 { code: "MG", status: "review", plan: "bb-ui2", planUpdatedAt: 50 },
 { code: "QN", status: "active", plan: "bb-ui2", planUpdatedAt: 50 },
 { code: "RL", status: "done", accepted: 3, criteria: 4, startedAt: 100, plan: "bb-setup", planUpdatedAt: 10 },
 { code: "RL", status: "active", startedAt: 9000, plan: "one-card", planUpdatedAt: 90 },
];

test("codes: several before the dot, one with a space, none", () => {
 assert.deepEqual(ticketCodes("TQ MG QN FL PR · План отдельным плагином"), { codes: ["TQ", "MG", "QN", "FL", "PR"], name: "План отдельным плагином" });
 assert.deepEqual(ticketCodes("R19 Сравнение с курортами"), { codes: ["R19"], name: "Сравнение с курортами" });
 assert.deepEqual(ticketCodes("Thread-materials panel redesign"), { codes: [], name: "Thread-materials panel redesign" });
 assert.deepEqual(ticketCodes("API SQL · что-то").codes, []);
});

test("acceptance: accepted, in review, in work, unknown code", () => {
 const lines = acceptanceLines("TQ MG QN XX · План", tickets, 1000);
 assert.deepEqual(lines, ["TQ · принят, подтверждено 17 из 17 критериев", "MG · сдан, ждёт приёмки", "QN · в работе"]);
});

test("acceptance: the ticket started closest to the agent wins when a code repeats", () => {
 assert.deepEqual(acceptanceLines("RL · x", tickets, 120), ["RL · принят, подтверждено 3 из 4 критериев"]);
 assert.deepEqual(acceptanceLines("RL · x", tickets, 8800), ["RL · в работе"]);
 assert.deepEqual(acceptanceLines("RL · x", tickets, null), ["RL · в работе"]);
});

test("acceptance: no plan data or no code gives no lines", () => {
 assert.deepEqual(acceptanceLines("TQ · x", undefined, 1), []);
 assert.deepEqual(acceptanceLines("TQ · x", [], 1), []);
 assert.deepEqual(acceptanceLines("Без кода", tickets, 1), []);
});

test("summary: short stays whole, long lines and long text are cut", () => {
 assert.deepEqual(summaryPreview("Готово.\nВторая строка"), { head: "Готово.\nВторая строка", truncated: false });
 const many = Array.from({ length: 9 }, (_, i) => "строка " + i).join("\n");
 const a = summaryPreview(many);
 assert.equal(a.head.split("\n").length, 5);
 assert.equal(a.truncated, true);
 const b = summaryPreview("слово ".repeat(200));
 assert.equal(b.truncated, true);
 assert.ok(b.head.length <= 421 && b.head.endsWith("…"));
});

test("launch anchors to the message before it", () => {
 const log = emptyLog();
 const e = (seq: number, type: string, item: Record<string, unknown>): ThreadEvent => ({ seq, type, createdAt: seq * 1000, data: { item } });
 applyEvents(log, [
  e(10, "item/completed", { type: "agentMessage", id: "m1", text: "Запускаю" }),
  e(11, "item/started", { type: "delegation", id: "d1", childRef: "toolu_1", label: "X", status: "pending" }),
  e(15, "item/completed", { type: "agentMessage", id: "m2", text: "Дальше" }),
  e(16, "item/completed", { type: "delegation", id: "d1", childRef: "toolu_1", label: "X", status: "completed", summary: "ok" }),
 ]);
 assert.equal(deriveSubagents(log)[0].launchSeq, 10);
});

test("launch seq is kept from the first event and survives later ones", () => {
 const log = emptyLog();
 const e = (seq: number, type: string, item: Record<string, unknown>): ThreadEvent => ({ seq, type, createdAt: seq * 1000, data: { item } });
 applyEvents(log, [
  e(41, "item/started", { type: "delegation", id: "d1", childRef: "toolu_1", label: "X · Задача", status: "pending", presentation: { detail: "general-purpose agent · model sonnet" } }),
  e(44, "item/completed", { type: "delegation", id: "d1", childRef: "toolu_1", label: "X · Задача", status: "completed", summary: "Итог работы" }),
 ]);
 const [x] = deriveSubagents(log);
 assert.equal(x.launchSeq, 41);  // no message before it: falls back to the launch event itself
 assert.equal(x.summary, "Итог работы");
});

test("no result recorded leaves the summary empty", () => {
 const log = emptyLog();
 applyEvents(log, [{ seq: 5, type: "item/started", createdAt: 1, data: { item: { type: "delegation", id: "d2", childRef: "toolu_2", label: "Y", status: "pending" } } }]);
 assert.equal(deriveSubagents(log)[0].summary, null);
});
