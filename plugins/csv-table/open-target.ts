import {
  experimental_PluginRpcRefusal,
  experimental_getRelativeHostPath as relativeHostPath,
  experimental_joinHostPath as joinHostPath,
  experimental_normalizeHostPath as normalizeHostPath,
  experimental_resolveHostPath as resolveHostPath,
  experimental_getHostPathDirname as hostPathDirname,
} from "@get-bb/plugin-sdk";
import { CSV_MAX_BYTES } from "./csv";
import type { OpenerSource } from "./contract";

export type { OpenerSource };

export interface ResolvedCsvRead {
  path: string;
  rootPath: string;
  hostId?: string;
}

export interface CsvFileLookups {
  environment(
    environmentId: string,
  ): Promise<{ path: string | null; hostId: string }>;
  project(
    projectId: string,
  ): Promise<{ sources: Array<{ hostId: string; path: string }> }>;
  primaryHostId(): Promise<string | null>;
  threadStorage(
    threadId: string,
  ): Promise<{ hostId: string; storageRootPath: string }>;
}

export interface CsvFileReadResult {
  content: string;
  contentEncoding: "base64" | "utf8";
  sizeBytes: number;
}

export interface CsvFileContent {
  content: string;
  sizeBytes: number;
}

export async function readCsvFile(
  source: OpenerSource,
  filePath: string,
  lookups: CsvFileLookups,
  read: (args: ResolvedCsvRead) => Promise<CsvFileReadResult>,
): Promise<CsvFileContent> {
  const target = await resolveCsvRead(source, filePath, lookups);
  const file = await read(target);
  if (file.sizeBytes > CSV_MAX_BYTES || file.content.length > CSV_MAX_BYTES) {
    throw refusal(
      `This CSV is larger than 2 MB, so the table viewer did not open it.`,
    );
  }
  const content = csvText(file);
  if (content.length > CSV_MAX_BYTES) {
    throw refusal(
      `This CSV is larger than 2 MB, so the table viewer did not open it.`,
    );
  }
  return { content, sizeBytes: file.sizeBytes };
}

export async function resolveCsvRead(
  source: OpenerSource,
  filePath: string,
  lookups: CsvFileLookups,
): Promise<ResolvedCsvRead> {
  if (source.kind === "host") {
    const path = requireAbsolute(filePath);
    const rootPath = hostPathDirname(path);
    if (rootPath === null) {
      throw refusal("Host file paths must be absolute.");
    }
    const hostId =
      source.experimental_hostId ??
      (source.environmentId === null
        ? undefined
        : (await lookups.environment(source.environmentId)).hostId);
    return hostId === undefined ? { path, rootPath } : { path, rootPath, hostId };
  }

  if (source.kind === "workspace" && source.environmentId) {
    const environment = await lookups.environment(source.environmentId);
    if (!environment.path) {
      throw refusal("This environment has no workspace path.");
    }
    return confined(environment.path, filePath, environment.hostId);
  }

  if (source.kind === "workspace" && source.projectId) {
    const hostId =
      source.experimental_hostId ?? (await lookups.primaryHostId()) ?? undefined;
    if (hostId === undefined) {
      throw refusal("This bb has no server machine yet.");
    }
    const project = await lookups.project(source.projectId);
    const matches = project.sources.filter((item) => item.hostId === hostId);
    const projectSource = matches[0];
    if (projectSource === undefined) {
      throw refusal(
        source.experimental_hostId
          ? "This project has no workspace on the selected host."
          : "This project has no workspace on the server machine.",
      );
    }
    if (matches.length > 1) {
      throw refusal("This project has multiple workspaces on that host.");
    }
    return confined(projectSource.path, filePath, hostId);
  }

  if (source.kind === "thread-storage") {
    if (!source.threadId) {
      throw refusal("Thread-storage files require a thread.");
    }
    const storage = await lookups.threadStorage(source.threadId);
    return confined(storage.storageRootPath, filePath, storage.hostId);
  }

  throw refusal("CSV table can open workspace, host, and thread-storage files.");
}

function confined(
  rootPath: string,
  filePath: string,
  hostId: string,
): ResolvedCsvRead {
  const root = requireAbsolute(rootPath);
  const relative = requireRelative(filePath);
  const path = joinHostPath({ rootPath: root, relativePath: relative });
  if (
    path === null ||
    relativeHostPath({ rootPath: root, candidatePath: path }) === null
  ) {
    throw refusal("CSV paths must stay inside their folder.");
  }
  return { path, rootPath: root, hostId };
}

function requireAbsolute(value: string): string {
  const normalized = normalizeHostPath(value);
  if (normalized === null) {
    throw refusal("Host file paths must be absolute.");
  }
  return normalized;
}

function requireRelative(value: string): string {
  const raw = value.replace(/\\/g, "/");
  if (
    normalizeHostPath(raw) !== null ||
    resolveHostPath({ rootPath: "/", path: raw }) === null ||
    raw.split("/").includes("..")
  ) {
    throw refusal("CSV paths must stay inside their folder.");
  }
  return raw.replace(/^\.\//u, "");
}

function csvText(file: CsvFileReadResult): string {
  if (file.contentEncoding === "utf8") {
    if (file.content.includes("\u0000")) {
      throw refusal("This file is not UTF-8 text, so it cannot be shown as a table.");
    }
    return file.content;
  }
  const bytes = Buffer.from(file.content, "base64");
  if (
    bytes.includes(0) ||
    Buffer.byteLength(bytes.toString("utf8")) !== bytes.length
  ) {
    throw refusal("This file is not UTF-8 text, so it cannot be shown as a table.");
  }
  return bytes.toString("utf8");
}

function refusal(message: string): experimental_PluginRpcRefusal {
  return new experimental_PluginRpcRefusal({ code: "invalid", message });
}
