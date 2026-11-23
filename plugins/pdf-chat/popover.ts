export type Box = { top: number; bottom: number; left: number; right: number };

export type PopoverPlacement = {
  x: number;
  y: number;
  place: "above" | "below";
};

const GAP = 12;

export function unionBox(boxes: Iterable<{ top: number; bottom: number; left: number; right: number }>): Box | null {
  let union: Box | null = null;
  for (const box of boxes) {
    union = union
      ? {
          top: Math.min(union.top, box.top),
          bottom: Math.max(union.bottom, box.bottom),
          left: Math.min(union.left, box.left),
          right: Math.max(union.right, box.right),
        }
      : { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  }
  return union;
}

export function placePopover(
  union: Box,
  viewport: { width: number; height: number },
  popover: { width: number; height: number },
  gap = GAP,
): PopoverPlacement {
  const spaceAbove = union.top;
  const spaceBelow = viewport.height - union.bottom;
  const need = popover.height + gap;
  const place: "above" | "below" =
    spaceAbove >= need || (spaceAbove >= spaceBelow && spaceAbove > gap)
      ? "above"
      : "below";
  const x = Math.min(
    Math.max(8, union.left),
    Math.max(8, viewport.width - popover.width - 8),
  );
  const y =
    place === "above"
      ? Math.max(8, union.top - gap)
      : Math.min(viewport.height - 8, union.bottom + gap);
  return { x, y, place };
}

export function overlapsVertically(a: Box, b: Box): boolean {
  return a.top < b.bottom && a.bottom > b.top;
}

export type View = { left: number; top: number; width: number; height: number };

export type Placement = { x: number; y: number; place: "above" | "below"; overlaps: boolean };

/**
 * Place a box next to a selection inside the visible part of a scroll container.
 * All values are in the container's content coordinates. Prefers below the
 * selection, flips above, and when neither fits takes the roomier side and
 * stays inside the view (then it may overlap the selection).
 */
export function placeInView(
  selection: Box,
  anchorX: number,
  view: View,
  size: { width: number; height: number },
  gap = 8,
  margin = 8,
): Placement {
  const viewTop = view.top + margin;
  const viewBottom = view.top + view.height - margin;
  const viewLeft = view.left + margin;
  const viewRight = view.left + view.width - margin;
  const below = selection.bottom + gap;
  const above = selection.top - gap - size.height;
  let place: "above" | "below";
  let y: number;
  if (below + size.height <= viewBottom && below >= viewTop) {
    place = "below";
    y = below;
  } else if (above >= viewTop && above + size.height <= viewBottom) {
    place = "above";
    y = above;
  } else {
    const roomBelow = viewBottom - Math.max(viewTop, selection.bottom);
    const roomAbove = Math.min(viewBottom, selection.top) - viewTop;
    place = roomBelow >= roomAbove ? "below" : "above";
    y = place === "below" ? Math.max(viewTop, below) : above;
    y = Math.min(Math.max(y, viewTop), Math.max(viewTop, viewBottom - size.height));
  }
  const width = Math.min(size.width, Math.max(0, viewRight - viewLeft));
  const x = Math.min(Math.max(anchorX - width / 2, viewLeft), Math.max(viewLeft, viewRight - width));
  const overlaps =
    y < selection.bottom && y + size.height > selection.top && x < selection.right && x + width > selection.left;
  return { x, y, place, overlaps };
}

export type PopoverKey = "send" | "newline" | "close" | null;

export function popoverKeyAction(event: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): PopoverKey {
  if (event.isComposing) return null;
  if (event.key === "Escape") return "close";
  if (event.key !== "Enter") return null;
  if (event.shiftKey) return "newline";
  if (event.altKey) return null;
  return "send";
}
