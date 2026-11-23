import test from "node:test";
import assert from "node:assert/strict";
import { isPreviewPayload, previewRequest, sidecarPath } from "./preview-target.ts";

test("local file keeps its host and drops a trailing line", () => {
  assert.deepEqual(previewRequest({ href: "/work/report.md:12:3", hostId: "host_a" }, "thr_a", null), {
    target: { kind: "host", hostId: "host_a", path: "/work/report.md" },
    location: { kind: "line", line: 12, column: 3 },
  });
});

test("attachment stays in the thread that received it", () => {
  assert.deepEqual(previewRequest({ href: "Attachments/image.png", storage: true, originThreadId: "thr_src" }, "thr_now", "host_a"), {
    target: { kind: "thread-storage", threadId: "thr_src", path: "Attachments/image.png" },
    location: null,
  });
});

test("web links and missing hosts are not files", () => {
  assert.equal(previewRequest({ href: "https://example.com/a.pdf" }, "thr_a", "host_a"), null);
  assert.equal(previewRequest({ href: "/work/report.pdf" }, "thr_a", null), null);
  assert.equal(previewRequest({ href: "/tmp/../secret.pdf" }, "thr_a", "host_a"), null);
  assert.equal(previewRequest({ href: "notes.md" }, "thr_a", "host_a"), null);
});

test("macOS sidecar names open the real file", () => {
  assert.equal(sidecarPath("bb-plugin-csv-table/._components.json"), "bb-plugin-csv-table/components.json");
  assert.equal(sidecarPath("bb-plugin-csv-table/components.json"), null);
  assert.deepEqual(previewRequest({ href: "/work/._report.json", hostId: "host_a" }, "thr_a", null), {
    target: { kind: "host", hostId: "host_a", path: "/work/report.json" },
    location: null,
  });
});

test("preview payload rejects a rewritten path", () => {
  assert.equal(isPreviewPayload({ target: { kind: "host", hostId: "host_a", path: "/work/report.pdf" }, location: null }), true);
  assert.equal(isPreviewPayload({ target: { kind: "host", hostId: "host_a", path: "/tmp/../secret" }, location: null }), false);
});
