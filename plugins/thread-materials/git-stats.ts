// Everything in a working folder that is not on GitHub yet, as exact line
// counts. Runs on the environment's host (host.ts) and in tests. Read-only:
// the only git subcommands used are listed in GIT_COMMANDS.
import { execFile } from "node:child_process";
import { open, lstat } from "node:fs/promises";
import { join } from "node:path";

export type GitCommit = { hash: string; subject: string };
export type FileCount = { path: string; added: number | null; removed: number | null };
export type GitChanges =
 | { kind: "ok"; branch: string; base: "upstream" | "merge-base" | "head"; baseRef: string | null; added: number; removed: number; files: number; uncommitted: { added: number; removed: number; files: number }; unpushedCommits: number; truncated: boolean; elapsedMs: number; top?: FileCount[]; recentCommits?: GitCommit[] }
 | { kind: "not-git" }
 | { kind: "error"; message: string };

export const GIT_COMMANDS = ["rev-parse", "symbolic-ref", "merge-base", "rev-list", "diff", "ls-files", "log"] as const;
export const UNTRACKED_FILE_LIMIT = 2000;
export const UNTRACKED_BYTES_LIMIT = 1024 * 1024;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

type Options = { timeoutMs?: number; untrackedLimit?: number };

function git(cwd: string, args: string[], deadline: number): Promise<{ ok: boolean; out: string }> {
 if (!(GIT_COMMANDS as readonly string[]).includes(args[0])) throw new Error("git " + args[0] + " is not allowed");
 const timeout = Math.max(500, deadline - Date.now());
 return new Promise(resolve => {
  execFile("git", ["-c", "core.quotepath=off", "--no-optional-locks", ...args], { cwd, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } }, (error, stdout) => {
   resolve({ ok: !error, out: String(stdout) });
  });
 });
}

/** `git diff --numstat -z` -> per-path counts; binary files have null counts. */
export function parseNumstat(out: string): Map<string, { added: number | null; removed: number | null }> {
 const result = new Map<string, { added: number | null; removed: number | null }>();
 for (const entry of out.split("\0")) {
  const m = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(entry.replace(/^\n/, ""));
  if (!m) continue;
  result.set(m[3], { added: m[1] === "-" ? null : Number(m[1]), removed: m[2] === "-" ? null : Number(m[2]) });
 }
 return result;
}

/** Lines in a new text file, the way `git diff --numstat` counts them; null for binary or oversized files. */
async function untrackedLines(path: string): Promise<number | null> {
 try {
  const info = await lstat(path);
  if (!info.isFile() || info.size > UNTRACKED_BYTES_LIMIT) return null;
  if (info.size === 0) return 0;
  const file = await open(path, "r");
  try {
   const buffer = Buffer.alloc(info.size);
   await file.read(buffer, 0, info.size, 0);
   if (buffer.subarray(0, 8000).includes(0)) return null;
   let lines = 0;
   for (const byte of buffer) if (byte === 10) lines++;
   if (buffer[buffer.length - 1] !== 10) lines++;
   return lines;
  } finally {
   await file.close();
  }
 } catch {
  return null;
 }
}

/** The files with the most changed lines (binary last), at most `limit`. */
export function topFiles(tracked: Map<string, { added: number | null; removed: number | null }>, untracked: readonly [string, number | null][], limit = 5): FileCount[] {
 const all = new Map<string, FileCount>();
 for (const [path, v] of tracked) all.set(path, { path, added: v.added, removed: v.removed });
 for (const [path, lines] of untracked) if (!all.has(path)) all.set(path, { path, added: lines, removed: lines === null ? null : 0 });
 const weight = (f: FileCount) => f.added === null && f.removed === null ? -1 : (f.added ?? 0) + (f.removed ?? 0);
 return [...all.values()].sort((a, b) => weight(b) - weight(a) || a.path.localeCompare(b.path)).slice(0, limit);
}

const sum = (m: Map<string, { added: number | null; removed: number | null }>) => {
 let added = 0, removed = 0;
 for (const v of m.values()) { added += v.added ?? 0; removed += v.removed ?? 0; }
 return { added, removed };
};

export async function gitChanges(cwd: string, options: Options = {}): Promise<GitChanges> {
 const started = Date.now();
 const deadline = started + (options.timeoutMs ?? 10000);
 const limit = options.untrackedLimit ?? UNTRACKED_FILE_LIMIT;
 const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"], deadline);
 if (!inside.ok || inside.out.trim() !== "true") return { kind: "not-git" };
 const root = (await git(cwd, ["rev-parse", "--show-toplevel"], deadline)).out.trim() || cwd;
 const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"], deadline);
 const hasHead = head.ok && !!head.out.trim();
 const symbolic = await git(root, ["symbolic-ref", "--short", "-q", "HEAD"], deadline);
 const branch = symbolic.ok && symbolic.out.trim() ? symbolic.out.trim() : hasHead ? head.out.trim().slice(0, 7) : "HEAD";

 // Base: the fork point with the branch on the server; without one, with origin's default branch; else HEAD.
 let base: "upstream" | "merge-base" | "head" = "head", baseRef: string | null = null, baseSha = hasHead ? head.out.trim() : EMPTY_TREE;
 if (hasHead) {
  const upstream = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], deadline);
  const candidate = upstream.ok && upstream.out.trim() ? { ref: upstream.out.trim(), kind: "upstream" as const } : null;
  const fallback = candidate ? null : await git(root, ["rev-parse", "--abbrev-ref", "--verify", "-q", "refs/remotes/origin/HEAD"], deadline);
  const target = candidate ?? (fallback?.ok && fallback.out.trim() ? { ref: fallback.out.trim(), kind: "merge-base" as const } : null);
  if (target) {
   const mb = await git(root, ["merge-base", "HEAD", target.ref], deadline);
   if (mb.ok && mb.out.trim()) { base = target.kind; baseRef = target.ref; baseSha = mb.out.trim(); }
  }
 }

 // Final state of the working folder (index + work tree) against the base: a file changed in a commit and again on disk counts once.
 const [total, uncommitted, untrackedList, commits, history] = await Promise.all([
  git(root, ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", baseSha], deadline),
  hasHead ? git(root, ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "HEAD"], deadline) : Promise.resolve({ ok: true, out: "" }),
  git(root, ["ls-files", "--others", "--exclude-standard", "-z"], deadline),
  hasHead && baseSha !== head.out.trim() ? git(root, ["rev-list", "--count", baseSha + "..HEAD"], deadline) : Promise.resolve({ ok: true, out: "0" }),
  hasHead ? git(root, ["log", "--no-show-signature", "--no-notes", "--encoding=UTF-8", "-z", "-n", "20", "--format=%h%x00%s", head.out.trim(), "--"], deadline) : Promise.resolve({ ok: true, out: "" }),
 ]);
 if (!total.ok || !untrackedList.ok) return { kind: "error", message: Date.now() >= deadline ? "git did not answer in time" : "git diff failed" };
 const recentCommits: GitCommit[] = [];
 if (history.ok) {
  const fields = history.out.split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) {
   if (fields[i]) recentCommits.push({ hash: fields[i]!, subject: fields[i + 1]!.slice(0, 240) });
  }
 }
 const tracked = parseNumstat(total.out);
 const local = parseNumstat(uncommitted.out);
 const untracked = untrackedList.out.split("\0").filter(Boolean);
 const truncated = untracked.length > limit;
 const counted = untracked.slice(0, limit);
 const lines = await Promise.all(counted.map(p => untrackedLines(join(root, p))));
 const newLines = lines.reduce<number>((s, n) => s + (n ?? 0), 0);
 const t = sum(tracked), u = sum(local);
 const files = new Set([...tracked.keys(), ...counted]).size;
 return {
  kind: "ok", branch, base, baseRef,
  added: t.added + newLines, removed: t.removed, files,
  uncommitted: { added: u.added + newLines, removed: u.removed, files: new Set([...local.keys(), ...counted]).size },
  unpushedCommits: Number(commits.out.trim()) || 0,
  recentCommits: history.ok ? recentCommits : undefined,
  truncated,
  elapsedMs: Date.now() - started,
  top: topFiles(tracked, counted.map((p, i) => [p, lines[i] ?? null] as [string, number | null])),
 };
}
