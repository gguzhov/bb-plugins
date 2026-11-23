import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { TWEAKS, runAnchors, tweakStatus, statusText, formatReport } from "../anchors.ts";
import { CLOSE_BUTTON, TIMELINE, PANEL, OPEN_ASIDE } from "../close-on-chat.ts";
import { parseReport } from "../check-protocol.ts";
import { createCheckService } from "../check-service.ts";

const doc = (present) => ({ querySelector: (s) => (present.has(s) ? {} : null) });
const all = new Set(TWEAKS.flatMap((t) => t.anchors.flatMap((a) => [a.selector, ...(typeof a.when === "string" ? [a.when] : [])])));

test("всё найдено: все правки работают, код 0", () => {
  const r = runAnchors(doc(all));
  assert.ok(r.every((t) => tweakStatus(t) === "ok"));
  assert.equal(formatReport(r).exitCode, 0);
});

test("обязательный якорь пропал при выполненном условии — якорь не найден, код 1", () => {
  const minus = new Set(all);
  minus.delete(TWEAKS.find((t) => t.id === "panel-close").anchors[0].selector);
  const r = runAnchors(doc(minus));
  const t = r.find((x) => x.id === "panel-close");
  assert.equal(tweakStatus(t), "broken");
  assert.match(statusText(t), /якорь не найден: .*Hide right panel/);
  const rep = formatReport(r);
  assert.equal(rep.exitCode, 1);
  assert.match(rep.text, /Крестик закрытия панели\s+якорь не найден/);
});

test("якорь состояния без условия — не проверено, не ошибка", () => {
  const r = runAnchors(doc(new Set([".bb-app-shell"])));
  const pin = r.find((x) => x.id === "pin-icon");
  assert.equal(tweakStatus(pin), "unchecked");
  assert.match(statusText(pin), /^не проверено: /);
  // тред и панель закрыты: условия не выполнены, всё что зависит от них не ошибка
  const panel = r.find((x) => x.id === "panel-close");
  assert.equal(tweakStatus(panel), "unchecked");
  assert.match(statusText(panel), /панель закрыта/);
  assert.equal(formatReport(r).exitCode, 0);
});

test("обязательный якорь без условия (.bb-app-shell) при пустом документе — ошибка", () => {
  const r = runAnchors(doc(new Set()));
  assert.equal(tweakStatus(r.find((x) => x.id === "send-label")), "broken");
});

test("в манифесте нет повторных id и пустых списков якорей", () => {
  assert.equal(new Set(TWEAKS.map((t) => t.id)).size, TWEAKS.length);
  for (const t of TWEAKS) assert.ok(t.anchors.length > 0, t.id);
});

// Покрытие: каждый ключевой признак разметки bb в css плагина есть в селекторах манифеста
// (иначе правку добавили, а в самопроверку не внесли, и манифест устарел).
const IGNORED_ATTRS = new Set(["data-state", "data-dragging"]); // состояния, а не части разметки
function tokens(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Set();
  for (const m of text.matchAll(/\[(data-[\w-]+|aria-label)\s*([~^$*|]?=)?\s*(?:"([^"]*)")?[^\]]*\]/g)) {
    if (m[1] === "aria-label") {
      if (m[3]) out.add(m[3]);
    } else if (!IGNORED_ATTRS.has(m[1])) out.add(m[1]);
  }
  for (const m of text.matchAll(/\.(bb-[\w-]+)/g)) out.add("." + m[1]);
  for (const m of text.matchAll(/\[id\^="([^"]+)"\]/g)) out.add(m[1]);
  return out;
}
const manifestText = (files) =>
  TWEAKS.filter((t) => t.css.some((c) => files.includes(c)))
    .flatMap((t) => t.anchors.map((a) => a.selector))
    .join("\n");

test("каждый файл стилей принадлежит правке из манифеста", () => {
  const owned = new Set(TWEAKS.flatMap((t) => t.css));
  for (const f of readdirSync(new URL("../styles/", import.meta.url))) assert.ok(owned.has(f), `styles/${f} не входит ни в одну правку манифеста`);
  for (const f of owned) readFileSync(new URL(`../styles/${f}`, import.meta.url)); // файл из манифеста существует
});

test("манифест покрывает ключевые атрибуты и подписи из css-файлов", () => {
  for (const file of readdirSync(new URL("../styles/", import.meta.url))) {
    const css = readFileSync(new URL(`../styles/${file}`, import.meta.url), "utf8");
    const covered = manifestText([file]);
    for (const token of tokens(css)) assert.ok(covered.includes(token), `${file}: «${token}» не покрыт манифестом`);
  }
});

test("селекторы close-on-chat.ts покрыты правкой «Закрытие по клику на чат»", () => {
  const sels = TWEAKS.find((t) => t.id === "close-on-chat").anchors.map((a) => a.selector);
  for (const s of [CLOSE_BUTTON, TIMELINE, OPEN_ASIDE]) assert.ok(sels.includes(s), s);
  assert.ok(PANEL.includes("thread-detail-secondary-panel"));
});

test("parseReport принимает свой отчёт и отвергает мусор", () => {
  const good = { id: "a", results: runAnchors(doc(new Set())) };
  assert.deepEqual(parseReport(JSON.parse(JSON.stringify(good))), good);
  assert.equal(parseReport(null), null);
  assert.equal(parseReport({ id: 5, results: [] }), null);
  assert.equal(parseReport({ id: null, results: [{ id: "x", title: "y", anchors: [{ selector: "a", status: "boom" }] }] }), null);
});

test("сервис проверки: ответ окна, снимок при молчании, ошибка без окон; таймер снят", async () => {
  let asked = null;
  const svc = createCheckService((id) => (asked = id), { waitMs: 30, newId: () => "r1" });
  const none = await svc.run();
  assert.equal(none.exitCode, 2);
  const good = runAnchors(doc(all));
  svc.report({ id: null, results: good });
  const stale = await svc.run();
  assert.equal(stale.exitCode, 0);
  assert.match(stale.text, /не ответило/);
  const p = svc.run();
  setTimeout(() => svc.report({ id: asked, results: runAnchors(doc(new Set())) }), 5);
  const live = await p;
  assert.equal(live.exitCode, 1);
  assert.doesNotMatch(live.text, /не ответило/);
});
