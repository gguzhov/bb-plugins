import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePdfUrl } from "./pdf-source.ts";

const ids = {
  threadId: "thr_1",
  environmentId: "env_1",
  projectId: "proj_1",
};

describe("resolvePdfUrl", () => {
  it("routes workspace, host, and thread-storage PDFs", () => {
    assert.equal(
      resolvePdfUrl("docs/a report.pdf", { kind: "workspace", ...ids }),
      "/api/v1/environments/env_1/files/docs/a%20report.pdf",
    );
    assert.equal(
      resolvePdfUrl("/tmp/a report.pdf", { kind: "host", ...ids }),
      "/api/v1/threads/thr_1/host-files/tmp/a%20report.pdf",
    );
    assert.equal(
      resolvePdfUrl("exports/a report.pdf", { kind: "thread-storage", ...ids }),
      "/api/v1/threads/thr_1/thread-storage/files/exports/a%20report.pdf",
    );
  });
});

describe("isFileAccessError", () => {
  it("recognises the errors pdf.js raises when bb stops serving the file address", async () => {
    const { isFileAccessError } = await import("./pdf-source.ts");
    assert.equal(isFileAccessError("MissingPDFException"), true);
    assert.equal(isFileAccessError("UnexpectedResponseException"), true);
    assert.equal(isFileAccessError("InvalidPDFException"), false);
    assert.equal(isFileAccessError(undefined), false);
  });
});
