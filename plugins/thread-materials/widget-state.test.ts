import test from "node:test";
import assert from "node:assert/strict";
import { chipSummary, gitChipText, placePopover, readState, toggle, visibleRows, writeState, WIDGET_ROWS } from "./widget-state.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

test("accordion: a chip opens its section and closes the previous one; the same chip closes it", () => {
 let s = { open: null } as ReturnType<typeof toggle>;
 s = toggle(s, "agents"); assert.equal(s.open, "agents");
 s = toggle(s, "result"); assert.equal(s.open, "result");
 s = toggle(s, "result"); assert.equal(s.open, null);
});

test("state is saved per thread and survives a reload (a new read from the same storage)", () => {
 const store = memory();
 writeState(store, "thr_a", { open: "source" });
 writeState(store, "thr_b", { open: null });
 assert.deepEqual(readState(store, "thr_a"), { open: "source" });
 assert.deepEqual(readState(store, "thr_b"), { open: null });
 assert.deepEqual(readState(store, "thr_new"), { open: null });
});

test("broken or unknown saved values fall back to closed; a throwing storage does not break the widget", () => {
 const store = memory();
 store.setItem("thread-materials:widget:thr_x", "{not json");
 assert.deepEqual(readState(store, "thr_x"), { open: null });
 store.setItem("thread-materials:widget:thr_y", JSON.stringify({ open: "invalid" }));
 assert.deepEqual(readState(store, "thr_y"), { open: null });
 const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
 assert.deepEqual(readState(bad, "thr_z"), { open: null });
 assert.doesNotThrow(() => writeState(bad, "thr_z", { open: "agents" }));
});

test("an open section shows at most WIDGET_ROWS rows, the rest goes to the N more line", () => {
 const list = Array.from({ length: 13 }, (_, i) => i);
 const { shown, rest } = visibleRows(list);
 assert.equal(shown.length, WIDGET_ROWS);
 assert.equal(rest, 13 - WIDGET_ROWS);
 assert.deepEqual(visibleRows([1, 2]), { shown: [1, 2], rest: 0 });
});

test("chips count running and total executors and materials groups", () => {
 const chips = chipSummary({ executors: [{ state: "running" }, { state: "done" }, { state: "running" }], materials: [{ group: "result" }] });
 assert.deepEqual(chips.agents, { running: 2, total: 3, enabled: true });
 assert.deepEqual(chips.result, { count: 1, enabled: true });
 assert.deepEqual(chips.source, { count: 0, enabled: false });
});

test("git chip text, with ≥ when some files were not counted", () => {
 assert.equal(gitChipText({ added: 120, removed: 30, files: 3, truncated: false }), "+120 −30 · 3");
 assert.equal(gitChipText({ added: 1, removed: 0, files: 1, truncated: true }), "≥+1 ≥−0 · ≥1");
});

test("hover card goes under its anchor, above it when there is no room, and stays inside the viewport", () => {
 const vp = { width: 400, height: 600 };
 assert.deepEqual(placePopover({ top: 10, bottom: 40, left: 300, right: 390 }, { width: 200, height: 100 }, vp), { top: 46, left: 190 });
 assert.deepEqual(placePopover({ top: 550, bottom: 580, left: 10, right: 100 }, { width: 200, height: 100 }, vp), { top: 444, left: 8 });
 const wide = placePopover({ top: 10, bottom: 40, left: 0, right: 30 }, { width: 380, height: 50 }, vp);
 assert.ok(wide.left >= 8 && wide.left + 380 <= 400 - 8 + 0.5);
});
