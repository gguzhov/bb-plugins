import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DICTIONARY, agentDisplayName, duration, resolveLang } from "../i18n.ts";
import { epicHint, headerCurrent, nowDoing, planHints, spendLine, ticketHint, unlinkedLine } from "../hint.ts";
import { applyOp, parseOp, progress } from "../plan.ts";

const CYRILLIC = /[А-Яа-яЁё]/;
const MIN = 60_000;

/** Every string a dictionary gives, functions called with sample arguments. */
function strings(dict) {
  const out = [];
  const visit = (value) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      for (const args of [[2, 5, 3, "x", "y", false], [1, 1, null, null, null, true], [["a", "b"]]]) {
        try {
          out.push(String(value(...args)));
        } catch {
          // Not the arguments this phrase takes.
        }
      }
    } else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(dict);
  return out;
}

test("language setting: en and ru win; auto is Russian when the page or browser is, English otherwise", () => {
  assert.equal(resolveLang("en", ["ru-RU"]), "en");
  assert.equal(resolveLang("ru", ["en-US"]), "ru");
  assert.equal(resolveLang("auto", ["ru-RU", "en"]), "ru");
  assert.equal(resolveLang("auto", ["", null, "RU"]), "ru");
  assert.equal(resolveLang("auto", ["en", "ru-RU"]), "ru");
  assert.equal(resolveLang("auto", ["en-GB", "de"]), "en");
  assert.equal(resolveLang("auto", []), "en");
  assert.equal(resolveLang(undefined, ["de-DE"]), "en");
  assert.equal(resolveLang("fr", ["ru"]), "ru");
});

test("both dictionaries have the same keys; English has no Russian, Russian is Russian", () => {
  const keys = (dict) => Object.keys(dict).sort();
  assert.deepEqual(keys(DICTIONARY.en), keys(DICTIONARY.ru));
  for (const key of Object.keys(DICTIONARY.en)) {
    const en = DICTIONARY.en[key];
    if (en && typeof en === "object") assert.deepEqual(Object.keys(en).sort(), Object.keys(DICTIONARY.ru[key]).sort(), key);
  }
  for (const line of strings(DICTIONARY.en)) assert.equal(CYRILLIC.test(line), false, line);
  for (const word of Object.values(DICTIONARY.ru.stepWord)) assert.equal(CYRILLIC.test(word), true, word);
  for (const word of Object.values(DICTIONARY.ru.planWord)) assert.equal(CYRILLIC.test(word), true, word);
});

test("the card files print no Russian of their own: every phrase comes from the dictionary", () => {
  for (const file of ["../app.tsx", "../hint.ts", "../server.ts", "../plan-service.ts"]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
      .map((line) => line.replace(/\/\/.*$/, "").replace(/\/\*\*.*\*\//, ""))
      .join("\n");
    // The fallback agent names (server) and the old epic word are data, not phrases.
    const phrases = code.replace(/const FALLBACK = \[[^\]]*\];/, "").replace('ru: "Русский"', "");
    assert.equal(CYRILLIC.test(phrases), false, `${file}: ${phrases.match(new RegExp(`.*${CYRILLIC.source}.*`))?.[0]}`);
  }
});

test("durations and agent names in both languages", () => {
  assert.equal(duration(45_000, "en"), "45 s");
  assert.equal(duration(12 * MIN, "en"), "12 min");
  assert.equal(duration(65 * MIN, "en"), "1 h 05 min");
  assert.equal(duration(65 * MIN, "ru"), "1 ч 05 мин");
  assert.equal(agentDisplayName("Неон", "en"), "Neon");
  assert.equal(agentDisplayName("Глитч 2", "en"), "Glitch 2");
  assert.equal(agentDisplayName("Неон", "ru"), "Неон");
  assert.equal(agentDisplayName("Custom name", "en"), "Custom name");
});

test("hints in English read as English, in Russian as before", () => {
  const NOW = 10 * 60 * MIN;
  const step = { title: "Ship", status: "active", owner: "Lead: Opus 5.5", createdAt: NOW - 30 * MIN, startedAt: NOW - 12 * MIN };
  assert.equal(ticketHint(step, { now: NOW, waiting: false, lang: "en" }).state, "In progress for 12 min · queued 18 min before that · done by the lead (Opus 5.5)");
  assert.equal(ticketHint(step, { now: NOW, waiting: false }).state, "В работе 12 мин · до этого ждал в очереди 18 мин · делает ведущий (Opus 5.5)");
  const done = { title: "A", status: "done", accepted: 4, criteria: 5, startedAt: 0, doneAt: 3 * MIN };
  assert.equal(ticketHint(done, { now: NOW, waiting: false, lang: "en" }).state, "Accepted · the work took 3 min · 4 of 5 criteria confirmed");
  assert.equal(epicHint({ steps: [done, { title: "B", status: "pending" }] }, "en"), "1 of 2 tickets done, 80% accepted");
  assert.equal(epicHint({ steps: [{ title: "B", status: "pending" }] }, "en"), "0 of 1 ticket done");
  assert.equal(nowDoing({ kind: "command", title: "", command: "npm test", running: [] }, "en"), "running npm test");
  assert.equal(nowDoing({ kind: "agent", title: "", command: null, running: [] }, "en"), "thinking");
  assert.equal(spendLine({ startedAt: NOW - 12 * MIN, tokens: 959_000 }, NOW, "en"), "12 min · 959k tokens");
  assert.equal(
    unlinkedLine([{ kind: "agent", title: "Notes", name: "Шифр", command: null, running: [] }, { kind: "command", title: "", command: "npm test", running: [] }], "en"),
    "Also running, not tied to a ticket: Cipher (Notes), command npm test",
  );
  const { plan } = applyOp([], parseOp({ id: "p", title: "P", tickets: ["A", "B"] }), 0);
  const two = applyOp([plan], parseOp({ id: "p", start: ["A", "B"] }), 1000).plan;
  assert.equal(headerCurrent(two, progress(two).current, "en"), "2 tickets in progress");
  const hints = planHints(two, 2 * MIN, "en");
  assert.equal(hints.state, "The plan is in progress");
  assert.equal(hints.count, "0 of 2 tickets done");
  assert.match(hints.time, /^In progress for 2 min, started at \d\d:\d\d$/);
});
