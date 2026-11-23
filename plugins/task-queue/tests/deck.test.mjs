import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pillsMode } from "../deck-opt-out.ts";

test("режим плашек liquid-glass: auto — на телефоне и сенсорных экранах, явный выбор побеждает", () => {
  assert.equal(pillsMode(null, true), true);
  assert.equal(pillsMode(null, false), false);
  assert.equal(pillsMode("pills", false), true);
  assert.equal(pillsMode("cards", true), false);
  assert.equal(pillsMode("stack", true), false);
});

// Соседний плагин лежит рядом под одним из двух имён: в папке автора это
// bb-plugin-background-peek, в общем репозитории плагинов — background-peek.
// Если плагин установлен один, сравнивать не с чем, и тест пропускается.
const SIBLING_COPIES = ["../../bb-plugin-background-peek/deck-opt-out.ts", "../../background-peek/deck-opt-out.ts"]
  .map((path) => new URL(path, import.meta.url))
  .filter((url) => existsSync(url));

test("копия хука в background-peek совпадает", { skip: SIBLING_COPIES.length === 0 && "рядом нет background-peek" }, () => {
  const here = readFileSync(new URL("../deck-opt-out.ts", import.meta.url), "utf8");
  for (const url of SIBLING_COPIES) assert.equal(readFileSync(url, "utf8"), here);
});
