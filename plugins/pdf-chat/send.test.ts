import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pdfQuote, selectionText, sendQuote } from "./quote.ts";
import { placeInView, popoverKeyAction } from "./popover.ts";

describe("selectionText", () => {
  it("keeps lines, collapses spacing and normalizes full-width digits", () => {
    assert.equal(selectionText("Сводка  отчёта\nраздел ２ на ２３.１１.２０２６\n\n  итог  "), "Сводка отчёта\nраздел 2 на 23.11.2026\nитог");
  });
});

describe("sendQuote", () => {
  const fake = (text: string, fail = false) => {
    const log: string[] = [];
    let draft = { text, mentions: [] as unknown[], attachments: [] as unknown[] };
    return {
      log,
      get draftText() {
        return draft.text;
      },
      composer: {
        get draft() {
          return draft;
        },
        replace(next: typeof draft) {
          draft = { ...next };
          log.push(`replace:${next.text}`);
        },
        async submit(options: { experimental_mode: "queue-if-active" }) {
          log.push(`submit:${draft.text}:${options.experimental_mode}`);
          if (fail) throw new Error("offline");
          draft = { text: "", mentions: [], attachments: [] };
        },
      },
    };
  };
  it("sends only the quote and the prompt", async () => {
    const f = fake("");
    const block = pdfQuote("pdf-test/fin.pdf", 1, "Потрачено на материалы", "Проверь сумму");
    await sendQuote(f.composer, block);
    assert.deepEqual(f.log, [
      `replace:${block}`,
      "submit:PDF: pdf-test/fin.pdf\nPage 1\n> Потрачено на материалы\n\nПроверь сумму:queue-if-active",
    ]);
  });
  it("sends a quote with an empty prompt", async () => {
    const f = fake("");
    await sendQuote(f.composer, pdfQuote("a.pdf", 2, "Итого"));
    assert.equal(f.log[1], "submit:PDF: a.pdf\nPage 2\n> Итого:queue-if-active");
  });
  it("puts back what the user was typing, also when sending fails", async () => {
    const ok = fake("half-written note");
    await sendQuote(ok.composer, "Q");
    assert.equal(ok.draftText, "half-written note");
    const bad = fake("draft", true);
    await assert.rejects(sendQuote(bad.composer, "Q"), /offline/);
    assert.equal(bad.draftText, "draft");
  });
});

describe("popoverKeyAction", () => {
  it("Enter sends, Shift+Enter is a new line, Escape closes, IME is left alone", () => {
    assert.equal(popoverKeyAction({ key: "Enter", shiftKey: false }), "send");
    assert.equal(popoverKeyAction({ key: "Enter", shiftKey: true }), "newline");
    assert.equal(popoverKeyAction({ key: "Escape", shiftKey: false }), "close");
    assert.equal(popoverKeyAction({ key: "Enter", shiftKey: false, isComposing: true }), null);
    assert.equal(popoverKeyAction({ key: "a", shiftKey: false }), null);
  });
});

describe("placeInView", () => {
  const view = { left: 0, top: 0, width: 480, height: 780 };
  const size = { width: 320, height: 220 };
  const inside = (p: { x: number; y: number }, w = size.width, h = size.height, v = view) =>
    p.x >= v.left + 8 - 1e-9 && p.x + w <= v.left + v.width - 8 + 1e-9 && p.y >= v.top + 8 - 1e-9 && p.y + h <= v.top + v.height - 8 + 1e-9;

  it("goes below the selection when there is room", () => {
    const p = placeInView({ top: 100, bottom: 140, left: 40, right: 300 }, 300, view, size);
    assert.equal(p.place, "below");
    assert.equal(p.y, 148);
    assert.ok(inside(p));
    assert.equal(p.overlaps, false);
  });
  it("flips above near the bottom edge of the panel", () => {
    const p = placeInView({ top: 700, bottom: 740, left: 40, right: 300 }, 300, view, size);
    assert.equal(p.place, "above");
    assert.ok(inside(p));
    assert.equal(p.overlaps, false);
  });
  it("shifts left at the right edge and right at the left edge", () => {
    const right = placeInView({ top: 100, bottom: 120, left: 400, right: 470 }, 470, view, size);
    assert.equal(right.x, 480 - 8 - 320);
    const left = placeInView({ top: 100, bottom: 120, left: 0, right: 20 }, 20, view, size);
    assert.equal(left.x, 8);
  });
  it("works in scrolled content coordinates", () => {
    const scrolled = { left: 0, top: 5000, width: 480, height: 780 };
    const p = placeInView({ top: 5700, bottom: 5740, left: 40, right: 300 }, 200, scrolled, size);
    assert.equal(p.place, "above");
    assert.ok(inside(p, size.width, size.height, scrolled));
  });
  it("fits a narrow phone-width panel", () => {
    const narrow = { left: 0, top: 0, width: 300, height: 600 };
    const p = placeInView({ top: 50, bottom: 70, left: 10, right: 290 }, 290, narrow, size);
    assert.equal(p.x, 8);
    assert.ok(p.y >= 78);
  });
  it("stays inside the view when the selection is taller than the view", () => {
    const p = placeInView({ top: -100, bottom: 900, left: 10, right: 400 }, 200, view, size);
    assert.ok(inside(p));
    assert.equal(p.overlaps, true);
  });
});

describe("sendQuote waits for bb to accept the new draft", () => {
  it("does not submit while bb still reports the composer as blocked", async () => {
    let blockedChecks = 0;
    const log: string[] = [];
    let draft = { text: "", mentions: [] as unknown[], attachments: [] as unknown[] };
    const composer = {
      get draft() {
        return draft;
      },
      get isSubmittingBlocked() {
        blockedChecks++;
        return blockedChecks < 3;
      },
      replace(next: typeof draft) {
        draft = { ...next };
      },
      async submit() {
        log.push(`submit after ${blockedChecks} checks`);
      },
    };
    await sendQuote(composer, "Q");
    assert.deepEqual(log, ["submit after 3 checks"]);
  });
});
