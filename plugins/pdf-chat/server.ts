import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { openCommand, resolveAbsolutePath, revealCommand, type FinderFileSource } from "./finder.ts";
import { pdfChatRpcContract } from "./rpc.ts";

function run(command: string, args: string[], failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(failure));
    });
  });
}

/** pdf.js parses documents in this worker; the app loads it from the plugin's HTTP route. */
let workerSource: Promise<string> | null = null;
function loadWorkerSource(): Promise<string> {
  workerSource ??= (async () => {
    const resolver = createRequire(import.meta.url);
    const file = resolver.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
    return readFile(file, "utf8");
  })().catch((error: unknown) => {
    workerSource = null;
    throw error;
  });
  return workerSource;
}

export default function plugin(bb: BbPluginApi) {
  async function absolutePathFor(input: {
    path: string;
    kind: FinderFileSource["kind"];
    environmentId: string | null;
    threadId: string | null;
  }): Promise<string> {
    let environmentPath: string | null = null;
    if (input.kind === "workspace") {
      if (!input.environmentId) {
        throw new Error("This workspace has no local folder on this Mac.");
      }
      const environment = await bb.sdk.environments.get({ environmentId: input.environmentId });
      environmentPath = environment.path;
    }
    const absPath = resolveAbsolutePath(
      { kind: input.kind, path: input.path, environmentPath, threadId: input.threadId },
      homedir(),
    );
    if (!existsSync(absPath)) {
      throw new Error("This file is not on this Mac.");
    }
    return absPath;
  }

  bb.rpc.register(pdfChatRpcContract, {
    async revealInFinder(input) {
      const { command, args } = revealCommand(process.platform, await absolutePathFor(input));
      await run(command, args, "Finder could not open this file.");
      return { ok: true as const };
    },
    async openInDefaultApp(input) {
      const { command, args } = openCommand(process.platform, await absolutePathFor(input));
      await run(command, args, "No app could open this file.");
      return { ok: true as const };
    },
  });

  bb.http.route("GET", "/pdf.worker.mjs", async () => {
    try {
      const body = await loadWorkerSource();
      return new Response(body, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=86400",
        },
      });
    } catch {
      return new Response("pdf.js worker is missing", { status: 404 });
    }
  });
}
