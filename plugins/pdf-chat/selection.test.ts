import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  highlightsFromBoxes,
  spansOnSelectedLines,
  textFromSpanItems,
} from "./selection.ts";

describe("spansOnSelectedLines", () => {
  it("includes the first and last letters the drag missed on the same line", () => {
    const seed = { top: 40, bottom: 58, left: 120, right: 480 };
    const spans = [
      { text: "п", box: { top: 40, bottom: 58, left: 96, right: 108 } },
      { text: "розрачность процедур", box: { top: 40, bottom: 58, left: 108, right: 400 } },
      { text: " показатель", box: { top: 40, bottom: 58, left: 470, right: 560 } },
      { text: "other line", box: { top: 80, bottom: 98, left: 96, right: 300 } },
    ];
    const matched = spansOnSelectedLines(seed, spans);
    assert.deepEqual(
      matched.map((span) => span.text),
      ["п", "розрачность процедур", " показатель"],
    );
    assert.equal(
      textFromSpanItems(matched),
      "прозрачность процедур показатель",
    );
  });
});

describe("highlightsFromBoxes", () => {
  it("covers the full span box, not a mid-glyph slice", () => {
    const highlights = highlightsFromBoxes(
      [{ top: 100, bottom: 120, left: 50, right: 350 }],
      { left: 10, top: 20, scrollLeft: 0, scrollTop: 0 },
    );
    assert.equal(highlights.length, 1);
    assert.equal(highlights[0]?.width, 302);
    assert.equal(highlights[0]?.left, 39);
  });
});
