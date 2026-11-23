import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutTextItem } from "./text-layer.ts";

describe("layoutTextItem", () => {
  // A4 page at scale 1: viewport flips y.
  const vt = [1, 0, 0, -1, 0, 842];
  it("places horizontal text by its top-left corner in page percent", () => {
    const layout = layoutTextItem(
      { str: "Итого", transform: [12, 0, 0, 12, 59.5, 742], width: 40, height: 12, fontName: "f1" },
      { fontFamily: "sans-serif", ascent: 0.75 },
      vt,
      595,
      842,
    );
    assert.equal(layout.fontHeight, 12);
    assert.equal(layout.angleDeg, 0);
    assert.ok(Math.abs(layout.leftPct - 10) < 1e-9);
    assert.ok(Math.abs(layout.topPct - (100 * (100 - 9)) / 842) < 1e-9);
    assert.equal(layout.targetWidth, 40);
  });
  it("falls back to a default ascent", () => {
    const layout = layoutTextItem(
      { str: "x", transform: [10, 0, 0, 10, 0, 842], width: 5, height: 10, fontName: "f" },
      undefined,
      vt,
      595,
      842,
    );
    assert.ok(Math.abs(layout.topPct - (100 * -8) / 842) < 1e-9);
  });
});
