import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_NAMES_EN, DICT, displayAgentName, resolveLang } from "./i18n.ts";
import { AGENT_NAMES } from "./agent-names.ts";

test("language: pinned values win; auto is Russian only for a ru page or browser", () => {
 assert.equal(resolveLang("ru", ["en-US"]), "ru");
 assert.equal(resolveLang("en", ["ru-RU"]), "en");
 assert.equal(resolveLang("auto", ["en", "ru-RU"]), "ru");
 assert.equal(resolveLang("auto", ["ru"]), "ru");
 assert.equal(resolveLang("auto", ["en-GB", "de-DE"]), "en");
 assert.equal(resolveLang("auto", ["rus-like", null, ""]), "en");
 assert.equal(resolveLang(undefined, []), "en");
});

test("both dictionaries have the same keys and no empty strings", () => {
 const keys = (o: object) => Object.keys(o).sort();
 assert.deepEqual(keys(DICT.ru), keys(DICT.en));
 for (const lang of ["en", "ru"] as const) for (const [k, v] of Object.entries(DICT[lang])) if (typeof v === "string") assert.ok(v.trim(), lang + "." + k);
 assert.deepEqual(keys(DICT.ru.action), keys(DICT.en.action));
});

test("English text has no Cyrillic, Russian plural forms are right", () => {
 for (const [k, v] of Object.entries(DICT.en)) if (typeof v === "string") assert.doesNotMatch(v, /[А-Яа-яЁё]/, k);
 assert.equal(DICT.en.files(1), "1 file");
 assert.equal(DICT.en.files(3), "3 files");
 assert.equal(DICT.ru.files(2), "2 файла");
 assert.equal(DICT.ru.files(11), "11 файлов");
 assert.equal(DICT.en.more(8), "8 more");
});

test("English executor names follow the same launch order as the shared Russian list", () => {
 assert.equal(AGENT_NAMES_EN.length, AGENT_NAMES.length);
 assert.equal(displayAgentName("Неон", 1, "en"), "Neon");
 assert.equal(displayAgentName("Неон 2", AGENT_NAMES.length + 1, "en"), "Neon 2");
 assert.equal(displayAgentName("Неон", 1, "ru"), "Неон");
 assert.equal(displayAgentName(undefined, 3, "en"), undefined);
});
