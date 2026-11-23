import { afterEach, describe, expect, it } from "vitest";
import { experimental_PluginRpcCallError } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const file = {
  content: "name,city\nAda,Paris\n",
  contentEncoding: "utf8" as const,
  mimeType: "text/csv",
  path: "/repo/people.csv",
  sha256: "abc",
  sizeBytes: 20,
};

describe("readCsv rpc", () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await dispose?.();
    dispose = null;
  });

  it("reads a workspace CSV through the file API", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "csv-table" });
    dispose = () => harness.lifecycle.dispose();
    await plugin(bb);
    harness.inspection.sdk.stub("environments.get", async () => ({
      path: "/repo",
      hostId: "host_1",
    }));
    harness.inspection.sdk.stub("files.read", async () => file);

    const result = await harness.behavior.callRpc("readCsv", {
      path: "people.csv",
      source: {
        kind: "workspace",
        threadId: null,
        environmentId: "env_1",
        projectId: "proj_1",
      },
    });

    expect(result).toEqual({ content: file.content, sizeBytes: file.sizeBytes });
    expect(harness.inspection.sdk.callsTo("files.read")).toEqual([
      [
        {
          hostId: "host_1",
          path: "/repo/people.csv",
          rootPath: "/repo",
        },
      ],
    ]);
  });

  it("rejects a path that escapes the workspace", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "csv-table" });
    dispose = () => harness.lifecycle.dispose();
    await plugin(bb);
    harness.inspection.sdk.stub("environments.get", async () => ({
      path: "/repo",
      hostId: "host_1",
    }));
    harness.inspection.sdk.stub("files.read", async () => file);

    await expect(
      harness.behavior.callRpc("readCsv", {
        path: "../secret.csv",
        source: {
          kind: "workspace",
          threadId: null,
          environmentId: "env_1",
          projectId: null,
        },
      }),
    ).rejects.toBeInstanceOf(experimental_PluginRpcCallError);
    expect(harness.inspection.sdk.callsTo("files.read")).toEqual([]);
  });
});
