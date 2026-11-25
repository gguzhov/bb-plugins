import test from "node:test";
import assert from "node:assert/strict";
import { explainError, resetText, sanitizeError } from "./agent-error.ts";
import { applyEvents, deriveSubagents, emptyLog, type ThreadEvent } from "./agents.ts";

// Real text from the log of thr_hu3udcsjbr (item/backgroundTask/completed, item.error).
const REAL = "Agent terminated early due to an API error: You've hit your weekly limit · resets 7am (Europe/Moscow) (error type rate_limit, HTTP 429, request id req_011ChKkuWKTFHsdU6vkjPThv, model sent to the API: claude-opus-5-5)";

test("real weekly-limit text: limit with reset time, ru and en", () => {
 const ru = explainError(REAL, "ru"), en = explainError(REAL, "en");
 assert.equal(ru.kind, "limit");
 assert.equal(ru.text, "Кончился лимит модели · сброс в 7:00 по Москве");
 assert.equal(en.text, "Model limit reached · resets at 7:00 AM Moscow time");
 assert.doesNotMatch(ru.full, /req_|request id/);
 assert.match(ru.full, /weekly limit/);
 assert.ok(ru.full.length <= 500);
});

test("limit without a reset time, other wordings", () => {
 assert.equal(explainError("usage limit reached", "ru").text, "Кончился лимит модели");
 assert.equal(explainError("Rate limit exceeded", "en").text, "Model limit reached");
 assert.equal(explainError("API Error: 429 Too Many Requests", "ru").kind, "limit");
 assert.equal(resetText("resets 3:30pm (Europe/Berlin)", "ru"), "сброс в 15:30 (Europe/Berlin)");
 assert.equal(resetText("resets 12am (UTC)", "en"), "resets at 12:00 AM UTC");
 assert.equal(resetText("no time here", "ru"), null);
});

test("context size", () => {
 assert.equal(explainError("prompt is too long: 212000 tokens > 200000 maximum", "ru").text, "Превышен размер контекста");
 assert.equal(explainError("Context window exceeded", "en").text, "Context size exceeded");
});

test("stopped by the user or the lead", () => {
 assert.equal(explainError("Agent was interrupted by user", "ru").text, "Остановлен пользователем или ведущим");
 assert.equal(explainError("Task stopped by the lead", "en").text, "Stopped by the user or the lead");
});

test("network and service", () => {
 assert.equal(explainError("API Error: HTTP 503 Service Unavailable", "ru").text, "Сеть или сервис недоступны");
 assert.equal(explainError("request timed out", "en").text, "Network or service unavailable");
 assert.equal(explainError("connect ECONNRESET", "en").kind, "network");
});

test("unknown error: first 120 characters, no ids, no prefix", () => {
 const r = explainError("Agent terminated early due to an API error: weird failure " + "x ".repeat(100) + " (request id req_abc123)", "ru");
 assert.equal(r.kind, "other");
 assert.ok(r.text.length <= 120 && r.text.endsWith("…") && r.text.startsWith("weird failure"));
 assert.doesNotMatch(r.full, /req_abc123/);
});

test("nothing recorded: no invented reason", () => {
 for (const v of [null, undefined, "", "   "]) {
  assert.deepEqual(explainError(v, "ru"), { kind: "none", text: "Причина не записана", full: "" });
  assert.equal(explainError(v, "en").text, "Reason not recorded");
 }
});

test("sanitize: paths, keys and ids are removed, full text capped at 500", () => {
 const s = sanitizeError("failed at /Users/ivan/secret/project/file.ts with key sk-ant-api03-ABCDEFGHIJKL and Bearer abcdefghijkl1234, request id req_011ChKkuWKTFHsdU6vkjPThv");
 assert.doesNotMatch(s, /Users|ivan|sk-ant|abcdefghijkl|req_/);
 assert.ok(explainError("boom " + "word ".repeat(300), "en").full.length <= 500);
});

test("the log field: failed backgroundTask error reaches the executor", () => {
 const events: ThreadEvent[] = [
  { seq: 1, type: "item/started", createdAt: 1000, data: { item: { type: "delegation", id: "d1", childRef: "toolu_1", label: "Робот", status: "pending", presentation: { detail: "general-purpose agent · model opus" } } } },
  { seq: 2, type: "item/backgroundTask/completed", createdAt: 2000, data: { item: { type: "backgroundTask", id: "r1", familyId: "f1", taskType: "local_agent", description: "Робот", status: "failed", taskStatus: "failed", summary: REAL, error: REAL, parentToolCallId: "d1" } } },
 ];
 const [x] = deriveSubagents(applyEvents(emptyLog(), events));
 assert.equal(x.state, "error");
 assert.equal(explainError(x.error, "ru").text, "Кончился лимит модели · сброс в 7:00 по Москве");
 assert.doesNotMatch(x.error ?? "", /req_/);
});

test("a failed run's summary that repeats the error is dropped (reason shown once)", () => {
 const events: ThreadEvent[] = [
  { seq: 1, type: "item/backgroundTask/completed", createdAt: 2000, data: { item: { type: "backgroundTask", id: "r1", familyId: "f1", taskType: "local_agent", description: "A", status: "failed", taskStatus: "failed", summary: REAL, error: REAL, parentToolCallId: "d1" } } },
 ];
 const [x] = deriveSubagents(applyEvents(emptyLog(), events));
 assert.equal(x.summary, null);
});
