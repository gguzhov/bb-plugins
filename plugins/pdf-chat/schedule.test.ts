import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { outputScaleFor, renderPlan, visibleRange } from "./schedule.ts";
import { ByteCache } from "./pdf-loader.ts";

describe("renderPlan", () => {
  it("draws on-screen pages first, then neighbours, and keeps a small window", () => {
    const plan = renderPlan({ first: 10, last: 11 }, 30);
    assert.deepEqual(plan.render, [10, 11, 12, 9, 13, 8]);
    assert.deepEqual(plan.keep, { first: 6, last: 15 });
  });
  it("starts at page 1 before anything is visible", () => {
    assert.deepEqual(renderPlan(null, 30).render, [1, 2, 3]);
  });
  it("stays inside the document at both ends", () => {
    assert.deepEqual(renderPlan({ first: 30, last: 30 }, 30).render, [30, 29, 28]);
    assert.deepEqual(renderPlan({ first: 1, last: 1 }, 1).render, [1]);
    assert.deepEqual(renderPlan({ first: 1, last: 1 }, 0).render, []);
  });
  it("draws only a few of a 30-page document at open", () => {
    const plan = renderPlan({ first: 1, last: 1 }, 30);
    assert.ok(plan.render.length <= 3);
  });
});

describe("visibleRange", () => {
  const pages = Array.from({ length: 5 }, (_, i) => ({ top: i * 1000, bottom: i * 1000 + 980 }));
  it("finds pages crossing the viewport", () => {
    assert.deepEqual(visibleRange(pages, 900, 2100), { first: 1, last: 3 });
    assert.deepEqual(visibleRange(pages, 990, 995), null);
  });
});

describe("outputScaleFor", () => {
  it("uses the device pixel ratio for normal pages", () => {
    assert.equal(outputScaleFor(600, 800, 2), 2);
  });
  it("caps huge zoomed pages to the pixel budget", () => {
    const scale = outputScaleFor(3000, 4200, 2);
    assert.ok(scale < 2);
    assert.ok(3000 * 4200 * scale * scale <= 16_777_216 + 1);
  });
});

describe("ByteCache", () => {
  it("keeps a bounded number of documents, least recently used out first", () => {
    const cache = new ByteCache(2, 1000);
    const entry = (url: string, size = 10) => ({ url, bytes: new Uint8Array(size), etag: null, lastModified: null });
    cache.set(entry("a"));
    cache.set(entry("b"));
    cache.get("a");
    cache.set(entry("c"));
    assert.deepEqual(cache.urls(), ["a", "c"]);
    cache.set(entry("big", 2000));
    assert.equal(cache.get("big"), null);
  });
});
