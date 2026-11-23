// Нажатие на свободное место области чата закрывает открытую правую панель.
// Чистая функция решения (shouldClose) отделена от сбора фактов из DOM (factsFromEvent), чтобы её можно было
// проверить тестами без браузера.

/** Что известно о нажатии к моменту события click. */
export interface ClickFacts {
  /** Кнопка мыши (0 — основная). */
  button: number;
  /** Нажат Shift, Ctrl, Alt или Cmd. */
  modifiers: boolean;
  /** Событие уже обработано кем-то (preventDefault). */
  defaultPrevented: boolean;
  /** Сдвиг указателя между pointerdown и click, px. */
  moved: number;
  /** Текст выделения после отпускания кнопки. */
  selection: string;
  /** Правая панель открыта и стоит рядом с чатом (не полноэкранный лист). */
  panelOpen: boolean;
  /** Нажатие внутри области чата [data-panel-id="thread-detail-timeline-panel"]. */
  inTimeline: boolean;
  /** Нажатие внутри самой панели. */
  inPanel: boolean;
  /** Нажатие на интерактивном элементе или внутри него. */
  interactive: boolean;
  /** Нажатие в поле ввода, карточках над ним, шапке треда. */
  inComposerOrHeader: boolean;
  /** Нажатие внутри меню, диалога, поповера или навигатора сообщений, либо такое окно было открыто при нажатии. */
  inPopup: boolean;
}

/** Сдвиг больше этого — перетаскивание, а не нажатие. */
export const DRAG_PX = 4;

export function shouldClose(f: ClickFacts): boolean {
  if (!f.panelOpen) return false;
  if (f.button !== 0 || f.modifiers || f.defaultPrevented) return false;
  if (f.moved > DRAG_PX) return false;
  if (f.selection.trim() !== "") return false;
  if (!f.inTimeline || f.inPanel) return false;
  if (f.interactive || f.inComposerOrHeader || f.inPopup) return false;
  return true;
}

/** Нажатие на клавишу: Escape закрывает панель, если фокус не в поле ввода и нет открытых окон. */
export function shouldCloseOnKey(k: {
  key: string;
  modifiers: boolean;
  defaultPrevented: boolean;
  panelOpen: boolean;
  focusInField: boolean;
  popupOpen: boolean;
}): boolean {
  return k.key === "Escape" && !k.modifiers && !k.defaultPrevented && k.panelOpen && !k.focusInField && !k.popupOpen;
}

export const INTERACTIVE =
  'a,button,input,textarea,select,summary,label,[contenteditable]:not([contenteditable="false"]),' +
  '[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],' +
  '[tabindex]:not([tabindex="-1"])';
export const COMPOSER_OR_HEADER = "[data-app-composer],[data-follow-up-composer],[data-promptbox],header";
export const POPUP =
  '[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"],[data-radix-popper-content-wrapper],' +
  "[data-thread-toc],[data-bb-portaled-overlay]";
export const TIMELINE = '[data-panel-id="thread-detail-timeline-panel"]';
export const PANEL = '[data-panel-id="thread-detail-secondary-panel"]';
export const OPEN_ASIDE = '[data-panel-id="thread-detail-secondary-panel"] > aside[aria-hidden="false"]';
export const CLOSE_BUTTON = '[data-testid="thread-secondary-panel-top-chrome"] button[aria-label^="Hide right panel"]';

/** Открыта ли панель рядом с чатом (на 375 px вместо неё полноэкранный лист в body — тогда false). */
export function panelOpen(doc: Document): boolean {
  const aside = doc.querySelector(OPEN_ASIDE);
  if (aside === null) return false;
  const panel = aside.parentElement;
  return panel !== null && panel.getBoundingClientRect().width > 0;
}

/** Открыто ли где-то меню, диалог или поповер. */
export function popupOpen(doc: Document): boolean {
  return doc.querySelector('[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"],[data-radix-popper-content-wrapper]') !== null;
}

/** Ставит слушатели на документ; возвращает функцию снятия. */
export function installCloseOnChat(doc: Document): () => void {
  let down: { x: number; y: number; popup: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, popup: popupOpen(doc) };
  };
  const onClick = (e: MouseEvent) => {
    const start = down;
    down = null;
    // Дешёвые проверки первыми: при закрытой панели больше ничего не считается.
    if (start === null || !panelOpen(doc)) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target === null) return;
    const facts: ClickFacts = {
      button: e.button,
      modifiers: e.shiftKey || e.ctrlKey || e.altKey || e.metaKey,
      defaultPrevented: e.defaultPrevented,
      moved: Math.hypot(e.clientX - start.x, e.clientY - start.y),
      selection: doc.getSelection()?.toString() ?? "",
      panelOpen: true,
      inTimeline: target.closest(TIMELINE) !== null,
      inPanel: target.closest(PANEL) !== null,
      interactive: target.closest(INTERACTIVE) !== null,
      inComposerOrHeader: target.closest(COMPOSER_OR_HEADER) !== null,
      inPopup: start.popup || target.closest(POPUP) !== null,
    };
    if (shouldClose(facts)) doc.querySelector<HTMLButtonElement>(CLOSE_BUTTON)?.click();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const active = doc.activeElement;
    const ok = shouldCloseOnKey({
      key: e.key,
      modifiers: e.shiftKey || e.ctrlKey || e.altKey || e.metaKey,
      defaultPrevented: e.defaultPrevented,
      panelOpen: panelOpen(doc),
      focusInField: active !== null && active.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') !== null,
      popupOpen: popupOpen(doc),
    });
    if (ok) doc.querySelector<HTMLButtonElement>(CLOSE_BUTTON)?.click();
  };
  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey);
  return () => {
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("keydown", onKey);
  };
}
