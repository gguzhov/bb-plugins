import { test } from "node:test";
import assert from "node:assert/strict";
import { agentName, ordinals, stripCodes } from "./agent-names.ts";
test("имена по порядку запуска: Неон, Глитч, … после круга — с номером", () => {
 assert.equal(agentName(1), "Неон"); assert.equal(agentName(3), "Шифр"); assert.equal(agentName(45), "Неон 2");
 assert.deepEqual([...ordinals([{ id: "b", startedAt: 2 }, { id: "a", startedAt: 1 }]).entries()], [["a", 1], ["b", 2]]);
 assert.equal(stripCodes("PZ PS · PDF: масштаб"), "PDF: масштаб");
});
