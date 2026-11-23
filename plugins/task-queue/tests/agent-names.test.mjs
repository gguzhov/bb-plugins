import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { AGENT_NAMES, agentName, ordinals, stripCodes } from "../agent-names.ts";

test("номер → имя: первый круг, второй круг, после исчерпания — имя и номер круга", () => {
  assert.equal(agentName(1), "Неон");
  assert.equal(agentName(2), "Глитч");
  assert.equal(agentName(3), "Шифр");
  assert.equal(agentName(27), "Лазер");
  assert.equal(agentName(28), "Магма");
  assert.equal(agentName(AGENT_NAMES.length), "Бит");
  assert.equal(agentName(AGENT_NAMES.length + 1), "Неон 2");
  assert.equal(agentName(2 * AGENT_NAMES.length + 2), "Глитч 3");
  assert.equal(agentName(0), "Неон");
  assert.equal(new Set(AGENT_NAMES).size, AGENT_NAMES.length);
});

test("порядковые номера по истории запусков, равные моменты — по seq, затем по id", () => {
  const m = ordinals([
    { id: "b", startedAt: 200 },
    { id: "a", startedAt: 100 },
    { id: "d", startedAt: 300, seq: 9 },
    { id: "c", startedAt: 300, seq: 5 },
    { id: "x", startedAt: null },
  ]);
  assert.deepEqual([...m.entries()], [["a", 1], ["b", 2], ["c", 3], ["d", 4], ["x", 5]]);
});

test("коды в начале названия агента убираются, обычные названия остаются", () => {
  assert.equal(stripCodes("PZ PS · PDF: масштаб щипком"), "PDF: масштаб щипком");
  assert.equal(stripCodes("UX · Крестик закрытия"), "Крестик закрытия");
  assert.equal(stripCodes("PDF: масштаб"), "PDF: масштаб");
  assert.equal(stripCodes("Замер скорости"), "Замер скорости");
});

test("копия модуля в thread-materials совпадает с этой", () => {
  const here = readFileSync(new URL("../agent-names.ts", import.meta.url), "utf8");
  const there = new URL("../../bb-plugin-thread-materials/agent-names.ts", import.meta.url);
  if (!existsSync(there)) return;
  assert.equal(readFileSync(there, "utf8"), here);
});
