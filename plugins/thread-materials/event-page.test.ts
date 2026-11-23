import test from "node:test";
import assert from "node:assert/strict";
import { readEventPage } from "./event-page.ts";

const limitError = new Error("HTTP 413: Event response exceeds the 8 MiB limit");

test("shrinks an oversized event batch without changing its cursor", async () => {
 const attempted: number[] = [];
 const page = await readEventPage(async limit => {
  attempted.push(limit);
  if (limit > 25) throw limitError;
  return [201, 204];
 }, 100);
 assert.deepEqual(attempted, [100, 50, 25]);
 assert.deepEqual(page, { rows: [201, 204], limit: 25 });
});

test("an oversized single event reports partial data; unrelated errors still surface", async () => {
 assert.equal(await readEventPage(async () => { throw limitError; }, 2), null);
 await assert.rejects(() => readEventPage(async () => { throw new Error("Forbidden"); }, 2), /Forbidden/);
});
