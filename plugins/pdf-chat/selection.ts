import { unionBox, type Box } from "./popover.ts";

export type Highlight = { left: number; top: number; width: number; height: number };

export function boxFromDomRect(rect: { top: number; bottom: number; left: number; right: number }): Box {
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

export function verticalOverlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

export function horizontalOverlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

export function padBox(box: Box, padX: number, padY = 0): Box {
  return {
    top: box.top - padY,
    bottom: box.bottom + padY,
    left: box.left - padX,
    right: box.right + padX,
  };
}

/** Keep text-layer spans that sit on the selected line(s), including letters the drag missed. */
export function spansOnSelectedLines<T extends { box: Box; text: string }>(
  seed: Box,
  spans: T[],
): T[] {
  const line = Math.max(10, seed.bottom - seed.top);
  const padded = padBox(seed, line, line * 0.15);
  return spans.filter((span) => {
    if (!span.text) return false;
    const height = Math.max(1, span.box.bottom - span.box.top);
    const vert = verticalOverlap(padded, span.box);
    if (vert < Math.min(height, line) * 0.35) return false;
    return horizontalOverlap(padded, span.box) > 0;
  });
}

export function textFromSpanItems(spans: { text: string }[]): string {
  return spans
    .map((span) => span.text)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function highlightsFromBoxes(
  boxes: Box[],
  origin: { left: number; top: number; scrollLeft: number; scrollTop: number },
): Highlight[] {
  return boxes
    .filter((box) => box.right - box.left > 1 && box.bottom - box.top > 1)
    .map((box) => ({
      left: box.left - origin.left + origin.scrollLeft - 1,
      top: box.top - origin.top + origin.scrollTop - 2,
      width: box.right - box.left + 2,
      height: box.bottom - box.top + 4,
    }));
}

export function collectTextLayerSpans(page: HTMLElement): { el: HTMLElement; box: Box; text: string }[] {
  return [...page.querySelectorAll(".textLayer span")].flatMap((node) => {
    if (!(node instanceof HTMLElement)) return [];
    if (node.classList.contains("markedContent")) return [];
    const text = node.textContent ?? "";
    if (!text) return [];
    const rect = node.getBoundingClientRect();
    if (rect.width < 0.5 && rect.height < 0.5) return [];
    return [{ el: node, box: boxFromDomRect(rect), text }];
  });
}

export function capturePdfSelection(
  range: Range,
  root: HTMLElement,
  scroller: HTMLElement,
): { text: string; highlights: Highlight[]; union: Box } | null {
  const raw = range.toString();
  const seed = unionBox([...range.getClientRects()].map(boxFromDomRect));
  if (!seed) return null;
  const page =
    range.startContainer instanceof Element
      ? range.startContainer.closest(".pdf-chat-page")
      : range.startContainer.parentElement?.closest(".pdf-chat-page");
  const spanItems = page instanceof HTMLElement ? collectTextLayerSpans(page) : [];
  const matched = spansOnSelectedLines(seed, spanItems);
  const text = textFromSpanItems(matched) || raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const boxes = matched.length > 0 ? matched.map((span) => span.box) : [seed];
  const origin = scroller.getBoundingClientRect();
  const highlights = highlightsFromBoxes(boxes, {
    left: origin.left,
    top: origin.top,
    scrollLeft: scroller.scrollLeft,
    scrollTop: scroller.scrollTop,
  });
  const union = unionBox(boxes) ?? seed;
  return { text, highlights, union };
}

/** Client rects of a range grouped onto the page they fall on, as percentages of that page. */
export function rangeHighlights(
  rects: { left: number; top: number; width: number; height: number }[],
  pages: { el: HTMLElement; box: { left: number; top: number; width: number; height: number } }[],
): { el: HTMLElement; left: number; top: number; width: number; height: number }[] {
  const out: { el: HTMLElement; left: number; top: number; width: number; height: number }[] = [];
  for (const rect of rects) {
    if (rect.width < 1 || rect.height < 1) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const page = pages.find(
      ({ box }) => cx >= box.left && cx <= box.left + box.width && cy >= box.top && cy <= box.top + box.height,
    );
    if (!page || page.box.width <= 0 || page.box.height <= 0) continue;
    out.push({
      el: page.el,
      left: ((rect.left - page.box.left) / page.box.width) * 100,
      top: ((rect.top - page.box.top) / page.box.height) * 100,
      width: (rect.width / page.box.width) * 100,
      height: (rect.height / page.box.height) * 100,
    });
  }
  return out;
}

/**
 * Client rects of the selected text only. Range.getClientRects() also returns
 * the boxes of whole elements the range passes through (text layers, pages),
 * which would make the selection look as tall as the page.
 */
export function textRectsOfRange(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const rects: DOMRect[] = [];
  const addNode = (node: Text) => {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end <= start) return;
    const part = document.createRange();
    part.setStart(node, start);
    part.setEnd(node, end);
    for (const rect of part.getClientRects()) if (rect.width >= 1 && rect.height >= 1) rects.push(rect);
  };
  if (root.nodeType === Node.TEXT_NODE) {
    addNode(root as Text);
    return rects;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node)) addNode(node as Text);
  }
  return rects;
}
