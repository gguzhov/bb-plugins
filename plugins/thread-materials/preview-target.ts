export type PreviewTarget =
  | { kind: "thread-storage"; threadId: string; path: string }
  | { kind: "host"; hostId: string; path: string };

export type PreviewLocation = { kind: "line"; line: number; column: number | null };

export type PreviewPayload = { target: PreviewTarget; location: PreviewLocation | null };

type PreviewItem = { href: string; storage?: boolean; hostId?: string; originThreadId?: string };

const lineAndColumn = /^(.*):(\d{1,6}):(\d{1,6})$/;
const lineOnly = /^(.*):(\d{1,6})$/;

function splitLocation(href: string): { path: string; location: PreviewLocation | null } | null {
  const match = lineAndColumn.exec(href) ?? lineOnly.exec(href);
  if (!match || !match[1].includes(".")) return { path: href, location: null };
  const line = Number(match[2]);
  const column = match[3] ? Number(match[3]) : null;
  if (line < 1 || (column !== null && column < 1)) return null;
  return { path: match[1], location: { kind: "line", line, column } };
}

function safePath(path: string): boolean {
  return path.length > 0 && !path.includes("\0") && !path.split("/").includes("..");
}

export function sidecarPath(path: string): string | null {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  if (!name.startsWith("._")) return null;
  const real = name.slice(2);
  if (!real || !safePath(real)) return null;
  parts[parts.length - 1] = real;
  const next = parts.join("/");
  return safePath(next) ? next : null;
}

export function previewRequest(item: PreviewItem, threadId: string, hostId: string | null): PreviewPayload | null {
  if (/^https?:\/\//i.test(item.href)) return null;
  const split = splitLocation(item.href);
  if (!split || !safePath(split.path)) return null;
  const path = sidecarPath(split.path) ?? split.path;
  if (item.storage) {
    const owner = item.originThreadId || threadId;
    if (!owner) return null;
    return { target: { kind: "thread-storage", threadId: owner, path }, location: split.location };
  }
  const host = item.hostId || hostId;
  if (!host || !path.startsWith("/")) return null;
  return { target: { kind: "host", hostId: host, path }, location: split.location };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTarget(value: unknown): value is PreviewTarget {
  if (!isRecord(value) || typeof value.path !== "string" || !safePath(value.path)) return false;
  if (value.kind === "thread-storage") return typeof value.threadId === "string" && value.threadId.length > 0;
  if (value.kind === "host") return typeof value.hostId === "string" && value.hostId.length > 0 && value.path.startsWith("/");
  return false;
}

function isLocation(value: unknown): value is PreviewLocation | null {
  if (value === null) return true;
  if (!isRecord(value) || value.kind !== "line" || typeof value.line !== "number" || value.line < 1) return false;
  return value.column === null || (typeof value.column === "number" && value.column >= 1);
}

export function isPreviewPayload(value: unknown): value is PreviewPayload {
  return isRecord(value) && isTarget(value.target) && isLocation(value.location);
}
