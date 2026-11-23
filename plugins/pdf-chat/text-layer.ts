/**
 * Selectable text over a drawn page.
 *
 * pdf.js's own TextLayer measures every span on a canvas attached to
 * document.body; each font change there forces a style recalculation of the
 * whole bb window, which froze bb for seconds on text-heavy PDFs. This builder
 * measures on a detached OffscreenCanvas and works in short slices that yield
 * to input. Positions are percentages and font sizes follow --scale-factor, so
 * the layer stays aligned at every zoom without rebuilding.
 */

export type TextItemLike = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
};

export type TextStyleLike = { fontFamily: string; ascent?: number; descent?: number; vertical?: boolean };

export type SpanLayout = {
  leftPct: number;
  topPct: number;
  fontHeight: number;
  angleDeg: number;
  targetWidth: number;
};

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

/** Where one text item sits on a page, from the page's scale-1 viewport transform. */
export function layoutTextItem(
  item: TextItemLike,
  style: TextStyleLike | undefined,
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number,
): SpanLayout {
  const tx = multiply(viewportTransform, item.transform);
  let angle = Math.atan2(tx[1]!, tx[0]!);
  if (style?.vertical) angle += Math.PI / 2;
  const fontHeight = Math.hypot(tx[2]!, tx[3]!);
  let ascentRatio = 0.8;
  if (style?.ascent) ascentRatio = style.ascent;
  else if (style?.descent) ascentRatio = 1 + style.descent;
  const fontAscent = fontHeight * ascentRatio;
  let left: number;
  let top: number;
  if (angle === 0) {
    left = tx[4]!;
    top = tx[5]! - fontAscent;
  } else {
    left = tx[4]! + fontAscent * Math.sin(angle);
    top = tx[5]! - fontAscent * Math.cos(angle);
  }
  return {
    leftPct: (100 * left) / pageWidth,
    topPct: (100 * top) / pageHeight,
    fontHeight,
    angleDeg: (angle * 180) / Math.PI,
    targetWidth: style?.vertical ? item.height : item.width,
  };
}

let measureContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
function measurer(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (measureContext) return measureContext;
  if (typeof OffscreenCanvas !== "undefined") {
    measureContext = new OffscreenCanvas(1, 1).getContext("2d");
  } else {
    // Detached canvas: never in the document, so font changes do not restyle bb.
    measureContext = document.createElement("canvas").getContext("2d");
  }
  return measureContext;
}

const SLICE_MS = 8;

const nextSlice = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function buildTextLayer(
  container: HTMLElement,
  items: TextItemLike[],
  styles: Record<string, TextStyleLike>,
  viewportTransform: number[],
  pageWidth: number,
  pageHeight: number,
  signal: { cancelled: boolean },
): Promise<void> {
  const ctx = measurer();
  let lastFont = "";
  let sliceStart = performance.now();
  // Built detached and attached once: every attach restyles, so one is cheapest.
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < items.length; index++) {
    if (signal.cancelled) return;
    const item = items[index]!;
    if (item.str) {
      const style = styles[item.fontName];
      const layout = layoutTextItem(item, style, viewportTransform, pageWidth, pageHeight);
      const span = document.createElement("span");
      span.textContent = item.str;
      span.setAttribute("role", "presentation");
      span.style.left = `${layout.leftPct.toFixed(3)}%`;
      span.style.top = `${layout.topPct.toFixed(3)}%`;
      span.style.fontSize = `calc(var(--scale-factor) * ${layout.fontHeight.toFixed(2)}px)`;
      const family = style?.fontFamily || "sans-serif";
      span.style.fontFamily = family;
      let transform = "";
      if (layout.angleDeg !== 0) transform = `rotate(${layout.angleDeg}deg) `;
      if (ctx && item.str.length > 0 && layout.targetWidth > 0 && layout.fontHeight > 0) {
        const font = `${layout.fontHeight.toFixed(2)}px ${family}`;
        if (font !== lastFont) {
          ctx.font = font;
          lastFont = font;
        }
        const measured = ctx.measureText(item.str).width;
        if (measured > 0) transform += `scaleX(${(layout.targetWidth / measured).toFixed(4)})`;
      }
      if (transform) span.style.transform = transform.trim();
      fragment.append(span);
    }
    if (item.hasEOL) fragment.append(document.createElement("br"));
    if (performance.now() - sliceStart > SLICE_MS) {
      await nextSlice();
      sliceStart = performance.now();
    }
  }
  if (signal.cancelled) return;
  container.append(fragment);
  const end = document.createElement("div");
  end.className = "endOfContent";
  container.append(end);
}
