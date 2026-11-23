import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anchoredScroll, stepZoom, wheelZoomFactor, zoomKey } from "./zoom.ts";
import { clampScale, fitWidthScale, MAX_SCALE, MIN_SCALE } from "./viewer.ts";

describe("wheelZoomFactor", () => {
  it("zooms in on negative delta (pinch out) and out on positive", () => {
    assert.ok(wheelZoomFactor(-10) > 1);
    assert.ok(wheelZoomFactor(10) < 1);
    assert.equal(wheelZoomFactor(0), 1);
  });
  it("is symmetric so pinching back returns to the same scale", () => {
    assert.ok(Math.abs(wheelZoomFactor(-7) * wheelZoomFactor(7) - 1) < 1e-12);
  });
  it("caps a mouse-wheel notch and handles line mode", () => {
    assert.equal(wheelZoomFactor(-1000), wheelZoomFactor(-60));
    assert.equal(wheelZoomFactor(-3, 1), wheelZoomFactor(-48));
  });
});

describe("clampScale and fitWidthScale", () => {
  it("keeps zoom within 25%..500%", () => {
    assert.equal(clampScale(0.01), MIN_SCALE);
    assert.equal(clampScale(99), MAX_SCALE);
    assert.equal(clampScale(Number.NaN), 1);
  });
  it("fits the page width to the panel", () => {
    assert.ok(Math.abs(fitWidthScale(595, 456) - 456 / 595) < 1e-12);
  });
});

describe("stepZoom", () => {
  it("moves to the next preset step", () => {
    assert.equal(stepZoom(1, 1), 1.1);
    assert.equal(stepZoom(1, -1), 0.9);
    assert.equal(stepZoom(1.84, 1), 2);
    assert.equal(stepZoom(1.84, -1), 1.75);
    assert.equal(stepZoom(5, 1), 5);
    assert.equal(stepZoom(0.25, -1), 0.25);
  });
});

describe("anchoredScroll", () => {
  it("keeps the point under the cursor in place when the page grows", () => {
    const before = { left: 100, top: 50, width: 400, height: 560 };
    // Page doubled around its own top-left; the point 25%/50% into the page must stay at (200, 330).
    const after = { left: 100, top: 50, width: 800, height: 1120 };
    const scroll = anchoredScroll(before, after, { x: 200, y: 330 }, { left: 0, top: 0 });
    assert.deepEqual(scroll, { left: 100, top: 280 });
  });
  it("accounts for a page that also moved (centering)", () => {
    const before = { left: 300, top: 0, width: 200, height: 280 };
    const after = { left: 200, top: 0, width: 400, height: 560 };
    const scroll = anchoredScroll(before, after, { x: 400, y: 140 }, { left: 10, top: 20 });
    assert.deepEqual(scroll, { left: 10, top: 160 });
  });
});

describe("zoomKey", () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
    zoomKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });
  it("maps Cmd/Ctrl + = - 0", () => {
    assert.equal(key("=", { metaKey: true }), "in");
    assert.equal(key("+", { ctrlKey: true }), "in");
    assert.equal(key("-", { metaKey: true }), "out");
    assert.equal(key("0", { metaKey: true }), "fit");
    assert.equal(key("=", {}), null);
    assert.equal(key("=", { metaKey: true, altKey: true }), null);
  });
});
