/** Which pages to draw for the pages currently on screen. Pages are 1-based. */
export type VisibleRange = { first: number; last: number };

export type RenderPlan = {
  /** Pages to draw, most important first: on-screen pages, then neighbours. */
  render: number[];
  /** Pages whose canvases may stay; everything else is released. */
  keep: { first: number; last: number };
};

export const RENDER_AHEAD = 2;
export const KEEP_AROUND = 4;

export function renderPlan(
  visible: VisibleRange | null,
  numPages: number,
  ahead = RENDER_AHEAD,
  keepAround = KEEP_AROUND,
): RenderPlan {
  if (numPages <= 0) return { render: [], keep: { first: 1, last: 0 } };
  const first = Math.min(numPages, Math.max(1, visible?.first ?? 1));
  const last = Math.min(numPages, Math.max(first, visible?.last ?? first));
  const render: number[] = [];
  for (let page = first; page <= last; page++) render.push(page);
  for (let step = 1; step <= ahead; step++) {
    if (last + step <= numPages) render.push(last + step);
    if (first - step >= 1) render.push(first - step);
  }
  return {
    render,
    keep: {
      first: Math.max(1, first - keepAround),
      last: Math.min(numPages, last + keepAround),
    },
  };
}

/** Pages on screen from page boxes in scroll-content coordinates. */
export function visibleRange(
  pages: { top: number; bottom: number }[],
  viewTop: number,
  viewBottom: number,
): VisibleRange | null {
  let first = -1;
  let last = -1;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    if (page.bottom > viewTop && page.top < viewBottom) {
      if (first < 0) first = index;
      last = index;
    } else if (first >= 0) {
      break;
    }
  }
  return first < 0 ? null : { first: first + 1, last: last + 1 };
}

/** Canvas resolution multiplier: device pixels, capped so a page stays under the pixel budget. */
export function outputScaleFor(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixels = 16_777_216,
): number {
  const dpr = Math.max(1, devicePixelRatio || 1);
  const area = Math.max(1, cssWidth * cssHeight);
  return Math.max(0.5, Math.min(dpr, Math.sqrt(maxPixels / area)));
}
