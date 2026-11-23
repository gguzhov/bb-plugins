// На телефоне (и на любом экране в режиме «pills») плагин liquid-glass превращает каждую карточку над полем
// ввода в маленькую плашку в ряду и прячет саму карточку (data-lg-dock-hidden, display: none). Штатный способ
// исключить элемент из его колоды — атрибут data-lg-dock-ui на элементе стопки (так он помечает свои узлы;
// функция isUi в его composer-dock.ts). Мы ставим его на свой элемент стопки только когда liquid-glass
// показывает плашки: тогда наша карточка остаётся карточкой на всю ширину поля ввода, его ряд плашек для
// остальных карточек не меняется. На десктопе в режимах cards/stack ничего не меняется.
import { useEffect, useState } from "react";

const MODE_KEY = "liquid-glass:composer-dock";
const MODE_EVENT = "liquid-glass:composer-dock-change";
const COMPACT_MEDIA = "(max-width: 767px), (pointer: coarse)";
export const DECK_UI = "data-lg-dock-ui";

/** Чистое правило: показывает ли liquid-glass плашки при таком режиме и такой ширине. */
export function pillsMode(stored: string | null, compact: boolean): boolean {
  if (stored === "pills") return true;
  if (stored === "cards" || stored === "stack") return false;
  return compact;
}

function readPills(): boolean {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(MODE_KEY);
  } catch {
    stored = null;
  }
  const compact = typeof window.matchMedia === "function" && window.matchMedia(COMPACT_MEDIA).matches;
  return pillsMode(stored, compact);
}

/** Режим плашек liquid-glass сейчас; следит за шириной и за переключением режима. */
export function usePillsMode(): boolean {
  const [pills, setPills] = useState(readPills);
  useEffect(() => {
    const update = () => setPills(readPills());
    const media = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_MEDIA) : null;
    media?.addEventListener("change", update);
    window.addEventListener(MODE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      media?.removeEventListener("change", update);
      window.removeEventListener(MODE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return pills;
}

/** Элемент стопки над полем ввода, в котором лежит карточка (прямой потомок [data-app-composer] > .grid). */
export function stackItemOf(card: Element): Element | null {
  const grid = card.closest("[data-app-composer] > .grid");
  if (grid === null) return null;
  let item: Element = card;
  while (item.parentElement !== null && item.parentElement !== grid) item = item.parentElement;
  return item.parentElement === grid ? item : null;
}

/** Пока включён режим плашек — исключает карточку из колоды liquid-glass; снимает метку, когда режим другой или карточка ушла. */
export function useDeckOptOut(card: { current: Element | null }, on: boolean, shown: boolean): void {
  useEffect(() => {
    if (!on || !shown || card.current === null) return;
    const item = stackItemOf(card.current);
    if (item === null || item.hasAttribute(DECK_UI)) return;
    item.setAttribute(DECK_UI, "");
    rescanDeck();
    return () => {
      item.removeAttribute(DECK_UI);
      rescanDeck();
    };
  }, [on, shown, card]);
}

/** liquid-glass re-reads its deck on its own mode event (it does not watch attribute changes). */
export function rescanDeck(): void {
  window.dispatchEvent(new Event(MODE_EVENT));
}
