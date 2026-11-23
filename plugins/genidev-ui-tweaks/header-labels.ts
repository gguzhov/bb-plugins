// Подсказка у кнопок шапки, свёрнутых в значок (header-collapse.css): у git-кнопки вроде Commit нет aria-label
// и title, её имя — только текст. Когда текст скрыт (размер шрифта 0), при наведении или фокусе ставим title
// с этим текстом; когда подпись снова видна — снимаем свой title. Без наблюдателей и таймеров: один
// делегированный слушатель pointerover и один focusin на документе.

/** Кнопки шапки, которые могут свернуться в значок. */
export const COLLAPSIBLE = "[data-thread-header-responsive-action] button:not([aria-label])";
const MARK = "data-genidev-ui-tweaks-title";

/** Что делать с подсказкой: поставить текст, снять свою или ничего. Чистая функция для тестов. */
export function titleAction(f: { text: string; labelHidden: boolean; hasOwnTitle: boolean; hasForeignTitle: boolean }): { set: string } | "remove" | null {
  const text = f.text.trim().replace(/\s+/g, " ");
  if (f.hasForeignTitle) return null;
  if (f.labelHidden && text !== "") return { set: text };
  return f.hasOwnTitle ? "remove" : null;
}

export function installHeaderLabels(doc: Document): () => void {
  const onEnter = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest(COLLAPSIBLE);
    if (!(button instanceof HTMLElement)) return;
    const view = doc.defaultView;
    const labelHidden = view !== null && parseFloat(view.getComputedStyle(button).fontSize) === 0;
    const own = button.hasAttribute(MARK);
    const action = titleAction({
      text: button.textContent ?? "",
      labelHidden,
      hasOwnTitle: own,
      hasForeignTitle: !own && button.hasAttribute("title"),
    });
    if (action === null) return;
    if (action === "remove") {
      button.removeAttribute("title");
      button.removeAttribute(MARK);
      return;
    }
    button.setAttribute("title", action.set);
    button.setAttribute(MARK, "");
  };
  doc.addEventListener("pointerover", onEnter, true);
  doc.addEventListener("focusin", onEnter, true);
  return () => {
    doc.removeEventListener("pointerover", onEnter, true);
    doc.removeEventListener("focusin", onEnter, true);
  };
}
