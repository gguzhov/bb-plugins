import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { overlapsVertically, placePopover, unionBox } from "./popover.ts";

describe("placePopover", () => {
  const popover = { width: 300, height: 220 };
  const viewport = { width: 1200, height: 800 };

  it("sits fully above the selection when there is room", () => {
    const union = { top: 400, bottom: 430, left: 80, right: 400 };
    const placed = placePopover(union, viewport, popover);
    assert.equal(placed.place, "above");
    assert.equal(placed.y, 388);
    assert.equal(overlapsVertically({ top: placed.y - 220, bottom: placed.y, left: 0, right: 0 }, union), false);
  });

  it("sits fully below when the selection is near the top", () => {
    const union = { top: 40, bottom: 72, left: 80, right: 400 };
    const placed = placePopover(union, viewport, popover);
    assert.equal(placed.place, "below");
    assert.equal(placed.y, 84);
    assert.ok(placed.y >= union.bottom);
  });

  it("does not pull a below placement up onto the text", () => {
    const union = { top: 500, bottom: 700, left: 40, right: 200 };
    const placed = placePopover(union, { width: 800, height: 760 }, popover);
    assert.ok(placed.place === "above" || placed.y >= union.bottom);
    if (placed.place === "below") {
      assert.ok(placed.y >= union.bottom);
    }
  });
});

describe("unionBox", () => {
  it("reads DOMRect-like getters, not only own properties", () => {
    class RectLike {
      get top() { return 10; }
      get bottom() { return 20; }
      get left() { return 5; }
      get right() { return 50; }
    }
    assert.deepEqual(unionBox([new RectLike()]), { top: 10, bottom: 20, left: 5, right: 50 });
  });
});

import { placeInView } from "./popover.ts";

describe("placeInView in a narrow pane", () => {
  const bar = { width: 190, height: 32 };
  const pop = { width: 320, height: 220 };
  for (const paneWidth of [420, 560, 720]) {
    const view = { left: 0, top: 300, width: paneWidth, height: 600 };
    for (const [name, left, right] of [
      ["left edge", 12, 120],
      ["right edge", paneWidth - 140, paneWidth - 12],
      ["middle", paneWidth / 2 - 60, paneWidth / 2 + 60],
    ] as const) {
      for (const [where, top, bottom] of [["top", 310, 330], ["bottom", 860, 880], ["middle", 560, 580]] as const) {
        it(`keeps bar and popover inside a ${paneWidth}px pane: ${name}, ${where}`, () => {
          const selection = { left, right, top, bottom };
          for (const size of [bar, pop]) {
            const w = Math.min(size.width, paneWidth - 16);
            const placed = placeInView(selection, right, view, size);
            assert.ok(placed.x >= 8 - 1e-9, `x ${placed.x}`);
            assert.ok(placed.x + w <= paneWidth - 8 + 1e-9, `right ${placed.x + w}`);
            assert.ok(placed.y >= view.top + 8 - 1e-9, `top ${placed.y}`);
            assert.ok(placed.y + size.height <= view.top + view.height - 8 + 1e-9, `bottom`);
          }
        });
      }
    }
  }

  it("flips above when the selection is at the bottom of the view", () => {
    const placed = placeInView({ left: 40, right: 200, top: 860, bottom: 880 }, 200, { left: 0, top: 300, width: 420, height: 600 }, bar);
    assert.equal(placed.place, "above");
  });
});
