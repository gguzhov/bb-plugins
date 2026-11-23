import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveAbsolutePath, revealCommand } from "./finder.ts";

describe("resolveAbsolutePath", () => {
  it("joins workspace files under the environment folder", () => {
    assert.equal(
      resolveAbsolutePath(
        {
          kind: "workspace",
          path: "docs/resume.pdf",
          environmentPath: "/Users/me/project",
          threadId: "thr_1",
        },
        "/Users/me",
      ),
      path.resolve("/Users/me/project/docs/resume.pdf"),
    );
  });

  it("rejects workspace paths that escape the environment", () => {
    assert.throws(
      () =>
        resolveAbsolutePath(
          {
            kind: "workspace",
            path: "../secret.pdf",
            environmentPath: "/Users/me/project",
            threadId: "thr_1",
          },
          "/Users/me",
        ),
      /Invalid path/,
    );
  });

  it("keeps host files absolute", () => {
    assert.equal(
      resolveAbsolutePath(
        {
          kind: "host",
          path: "/tmp/file.pdf",
          environmentPath: null,
          threadId: "thr_1",
        },
        "/Users/me",
      ),
      path.resolve("/tmp/file.pdf"),
    );
  });

  it("joins thread-storage files under ~/.bb/thread-storage", () => {
    assert.equal(
      resolveAbsolutePath(
        {
          kind: "thread-storage",
          path: "Artifacts/file.pdf",
          environmentPath: null,
          threadId: "thr_1",
        },
        "/Users/me",
      ),
      path.resolve("/Users/me/.bb/thread-storage/thr_1/Artifacts/file.pdf"),
    );
  });
});

describe("revealCommand", () => {
  it("reveals the file in Finder on macOS", () => {
    assert.deepEqual(revealCommand("darwin", "/tmp/file.pdf"), {
      command: "open",
      args: ["-R", "/tmp/file.pdf"],
    });
  });
});
