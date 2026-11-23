import { describe, expect, it } from "vitest";
import { CSV_MAX_BYTES } from "./csv";
import {
  readCsvFile,
  resolveCsvRead,
  type CsvFileLookups,
  type OpenerSource,
} from "./open-target";

const workspace: OpenerSource = {
  kind: "workspace",
  threadId: "thr_1",
  environmentId: "env_1",
  projectId: "proj_1",
};

function lookups(overrides: Partial<CsvFileLookups> = {}): CsvFileLookups {
  return {
    environment: async () => ({ path: "/repo", hostId: "host_1" }),
    project: async () => ({
      sources: [{ hostId: "host_1", path: "/work" }],
    }),
    primaryHostId: async () => "host_1",
    threadStorage: async () => ({
      hostId: "host_2",
      storageRootPath: "/threads/thr_1",
    }),
    ...overrides,
  };
}

describe("resolveCsvRead", () => {
  it("reads a workspace file inside the environment root", async () => {
    await expect(resolveCsvRead(workspace, "reports/people.csv", lookups())).resolves.toEqual({
      path: "/repo/reports/people.csv",
      rootPath: "/repo",
      hostId: "host_1",
    });
  });

  it("rejects paths that leave the workspace", async () => {
    await expect(
      resolveCsvRead(workspace, "../secret.csv", lookups()),
    ).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      resolveCsvRead(workspace, "/etc/passwd", lookups()),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("reads a project file on the selected host", async () => {
    await expect(
      resolveCsvRead(
        {
          kind: "workspace",
          threadId: null,
          environmentId: null,
          projectId: "proj_1",
          experimental_hostId: "host_9",
        },
        "people.csv",
        lookups({
          project: async () => ({
            sources: [{ hostId: "host_9", path: "/work" }],
          }),
        }),
      ),
    ).resolves.toEqual({
      path: "/work/people.csv",
      rootPath: "/work",
      hostId: "host_9",
    });
  });

  it("refuses a project with more than one workspace on the host", async () => {
    await expect(
      resolveCsvRead(
        {
          kind: "workspace",
          threadId: null,
          environmentId: null,
          projectId: "proj_1",
        },
        "people.csv",
        lookups({
          project: async () => ({
            sources: [
              { hostId: "host_1", path: "/one" },
              { hostId: "host_1", path: "/two" },
            ],
          }),
        }),
      ),
    ).rejects.toThrow(/multiple workspaces/);
  });

  it("reads a host file and a thread-storage file", async () => {
    await expect(
      resolveCsvRead(
        {
          kind: "host",
          threadId: null,
          environmentId: null,
          projectId: null,
          experimental_hostId: "host_9",
        },
        "/data/people.csv",
        lookups(),
      ),
    ).resolves.toEqual({
      path: "/data/people.csv",
      rootPath: "/data",
      hostId: "host_9",
    });
    await expect(
      resolveCsvRead(
        {
          kind: "thread-storage",
          threadId: "thr_1",
          environmentId: null,
          projectId: null,
        },
        "notes/people.csv",
        lookups(),
      ),
    ).resolves.toEqual({
      path: "/threads/thr_1/notes/people.csv",
      rootPath: "/threads/thr_1",
      hostId: "host_2",
    });
  });
});

describe("readCsvFile", () => {
  it("returns utf-8 text and decodes base64 utf-8", async () => {
    const text = await readCsvFile(workspace, "people.csv", lookups(), async () => ({
      content: "name\nAda\n",
      contentEncoding: "utf8",
      sizeBytes: 9,
    }));
    expect(text.content).toBe("name\nAda\n");

    const encoded = await readCsvFile(
      workspace,
      "people.csv",
      lookups(),
      async () => ({
        content: Buffer.from("name\nAda\n", "utf8").toString("base64"),
        contentEncoding: "base64",
        sizeBytes: 9,
      }),
    );
    expect(encoded.content).toBe("name\nAda\n");
  });

  it("refuses binary and oversized files", async () => {
    await expect(
      readCsvFile(workspace, "people.csv", lookups(), async () => ({
        content: Buffer.from([0, 1, 2]).toString("base64"),
        contentEncoding: "base64",
        sizeBytes: 3,
      })),
    ).rejects.toThrow(/UTF-8/);
    await expect(
      readCsvFile(workspace, "people.csv", lookups(), async () => ({
        content: "name\nAda\n",
        contentEncoding: "utf8",
        sizeBytes: CSV_MAX_BYTES + 1,
      })),
    ).rejects.toThrow(/2 MB/);
  });
});
