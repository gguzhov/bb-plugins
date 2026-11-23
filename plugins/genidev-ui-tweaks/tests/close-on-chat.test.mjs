import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldClose, shouldCloseOnKey } from "../close-on-chat.ts";

const base = { button: 0, modifiers: false, defaultPrevented: false, moved: 0, selection: "", panelOpen: true, inTimeline: true, inPanel: false, interactive: false, inComposerOrHeader: false, inPopup: false };
const f = (over) => ({ ...base, ...over });

test("свободное место ленты при открытой панели — закрыть", () => assert.equal(shouldClose(base), true));
test("панель закрыта или лист на 375 — ничего не делать", () => assert.equal(shouldClose(f({ panelOpen: false })), false));
test("ссылка, кнопка, поле, карточка над полем, шапка — не закрывать", () => {
  assert.equal(shouldClose(f({ interactive: true })), false);
  assert.equal(shouldClose(f({ inComposerOrHeader: true })), false);
});
test("выделение текста и перетаскивание — не закрывать", () => {
  assert.equal(shouldClose(f({ selection: "слово" })), false);
  assert.equal(shouldClose(f({ selection: "  " })), true);
  assert.equal(shouldClose(f({ moved: 5 })), false);
  assert.equal(shouldClose(f({ moved: 4 })), true);
});
test("не основная кнопка, модификаторы, defaultPrevented — не закрывать", () => {
  assert.equal(shouldClose(f({ button: 1 })), false);
  assert.equal(shouldClose(f({ button: 2 })), false);
  assert.equal(shouldClose(f({ modifiers: true })), false);
  assert.equal(shouldClose(f({ defaultPrevented: true })), false);
});
test("меню, диалог, навигатор сообщений; нажатие внутри панели или вне чата — не закрывать", () => {
  assert.equal(shouldClose(f({ inPopup: true })), false);
  assert.equal(shouldClose(f({ inPanel: true })), false);
  assert.equal(shouldClose(f({ inTimeline: false })), false);
});
test("Escape: закрыть только вне поля ввода и без открытых окон", () => {
  const k = { key: "Escape", modifiers: false, defaultPrevented: false, panelOpen: true, focusInField: false, popupOpen: false };
  assert.equal(shouldCloseOnKey(k), true);
  assert.equal(shouldCloseOnKey({ ...k, focusInField: true }), false);
  assert.equal(shouldCloseOnKey({ ...k, popupOpen: true }), false);
  assert.equal(shouldCloseOnKey({ ...k, panelOpen: false }), false);
  assert.equal(shouldCloseOnKey({ ...k, key: "Enter" }), false);
  assert.equal(shouldCloseOnKey({ ...k, defaultPrevented: true }), false);
});
