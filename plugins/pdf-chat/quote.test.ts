import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pdfQuote, selectionPageNumber } from "./quote.ts";

describe("pdfQuote", () => {
  it("quotes selected lines with path and page", () => {
    assert.equal(
      pdfQuote("docs/spec.pdf", 3, "Hello\nWorld"),
      "PDF: docs/spec.pdf\nPage 3\n> Hello\n> World",
    );
  });

  it("appends a remark after the quote", () => {
    assert.equal(
      pdfQuote("docs/spec.pdf", 1, "Hello", "Make this shorter"),
      "PDF: docs/spec.pdf\nPage 1\n> Hello\n\nMake this shorter",
    );
  });
});

describe("selectionPageNumber", () => {
  it("returns 1 without a page ancestor", () => {
    assert.equal(selectionPageNumber(null), 1);
  });
});

import { copySelectionText } from "./quote.ts";

describe("copySelectionText", () => {
  it("writes the same normalized text the quote uses", async () => {
    const written: string[] = [];
    const ok = await copySelectionText("  Tidal   notes\r\n\n  second   line ", { writeText: async (t) => void written.push(t) });
    assert.equal(ok, true);
    assert.deepEqual(written, ["Tidal notes\nsecond line"]);
  });
  it("reports failure when the clipboard refuses or is missing", async () => {
    assert.equal(await copySelectionText("x", { writeText: async () => { throw new Error("denied"); } }), false);
    assert.equal(await copySelectionText("x", undefined), false);
    assert.equal(await copySelectionText("  \n ", { writeText: async () => {} }), false);
  });
});
