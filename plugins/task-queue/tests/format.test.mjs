import test from "node:test";
import assert from "node:assert/strict";
import { compactNumber, elapsed, elapsedShort, ticketTitle } from "../format.ts";

test("ticket code is split off the end of the title", () => {
  assert.deepEqual(ticketTitle("Карточка пациента CS"), { code: "CS", extra: [], name: "Карточка пациента" });
  assert.deepEqual(ticketTitle("Справочники DI DP"), { code: "DI", extra: ["DP"], name: "Справочники" });
  assert.deepEqual(ticketTitle("Плюс справа AD"), { code: "AD", extra: [], name: "Плюс справа" });
});

test("a title without a code stays whole", () => {
  assert.deepEqual(ticketTitle("Выпуск Next.js"), { code: null, extra: [], name: "Выпуск Next.js" });
  assert.deepEqual(ticketTitle("Сервер после апгрейда"), { code: null, extra: [], name: "Сервер после апгрейда" });
  assert.equal(ticketTitle("CS").code, null);
  assert.equal(ticketTitle("A").code, null);
  assert.equal(ticketTitle("Оплаты ABCDE").code, null);
});

test("well-known acronyms are not ticket codes", () => {
  assert.deepEqual(ticketTitle("Версия API"), { code: null, extra: [], name: "Версия API" });
  assert.equal(ticketTitle("Разбор SQL").code, null);
  // an acronym before a real code is part of the name
  assert.deepEqual(ticketTitle("Документация API CS"), { code: "CS", extra: [], name: "Документация API" });
});

test("short elapsed time drops seconds after a minute", () => {
  const t = 1_000_000;
  assert.equal(elapsedShort(t, t + 45_000), "45s");
  assert.equal(elapsedShort(t, t + 19 * 60_000 + 14_000), "19m");
  assert.equal(elapsedShort(t, t + 65 * 60_000), "1h 5m");
  assert.equal(elapsedShort(null, t), "");
  assert.equal(elapsedShort(t, t - 5000), "0s");
});

test("long elapsed time keeps seconds", () => {
  const t = 1_000_000;
  assert.equal(elapsed(t, t + 145_000), "2m 25s");
  assert.equal(elapsed(t, t + 7_500_000), "2h 5m");
});

test("tokens are compact", () => {
  assert.equal(compactNumber(950), "950");
  assert.equal(compactNumber(1234), "1.2k");
  assert.equal(compactNumber(163_400), "163k");
  assert.equal(compactNumber(9_960), "10k");
});
