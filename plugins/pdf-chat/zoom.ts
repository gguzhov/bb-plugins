/** Pure zoom math: wheel and pinch deltas, keyboard steps, and keeping a point under the cursor. */

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

const LINE_PX = 16;
const PAGE_PX = 400;
const MAX_STEP_PX = 60;
const SENSITIVITY = 0.01;

/**
 * Multiplier for one wheel event. A macOS trackpad pinch arrives as small
 * ctrl+wheel deltas; a mouse wheel with Cmd/Ctrl arrives as large ones, so each
 * event is capped to keep one notch from jumping too far.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  let px = deltaY;
  if (deltaMode === 1) px *= LINE_PX;
  else if (deltaMode === 2) px *= PAGE_PX;
  if (!Number.isFinite(px)) return 1;
  px = Math.max(-MAX_STEP_PX, Math.min(MAX_STEP_PX, px));
  return Math.exp(-px * SENSITIVITY);
}

/** Next keyboard zoom step up (+1) or down (-1) from the current scale. */
export function stepZoom(scale: number, direction: 1 | -1, steps = ZOOM_STEPS): number {
  if (direction > 0) {
    for (const step of steps) if (step > scale * 1.01) return step;
    return steps[steps.length - 1]!;
  }
  for (let index = steps.length - 1; index >= 0; index--) {
    if (steps[index]! < scale / 1.01) return steps[index]!;
  }
  return steps[0]!;
}

export type Rect = { left: number; top: number; width: number; height: number };

/**
 * New scroll offsets that keep the document point under `pointer` in place after
 * the anchor page changes from `before` to `after` (all in client coordinates).
 */
export function anchoredScroll(
  before: Rect,
  after: Rect,
  pointer: { x: number; y: number },
  scroll: { left: number; top: number },
): { left: number; top: number } {
  const fx = before.width > 0 ? (pointer.x - before.left) / before.width : 0;
  const fy = before.height > 0 ? (pointer.y - before.top) / before.height : 0;
  return {
    left: scroll.left + (after.left + fx * after.width - pointer.x),
    top: scroll.top + (after.top + fy * after.height - pointer.y),
  };
}

export type ZoomKey = "in" | "out" | "fit" | null;

/** Cmd/Ctrl + "+", "-" or "0". */
export function zoomKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): ZoomKey {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  if (event.key === "0") return "fit";
  return null;
}
