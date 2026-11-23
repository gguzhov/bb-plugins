// The thread's background work as the card shows it: read from the thread's
// timeline (activity.ts), with each command's launch line and the last lines
// of its output. No SDK imports: server.ts passes the timeline reader and the
// file reader, so tests drive it with plain functions.
import { open } from "node:fs/promises";
import { buildActivities, tailLines, type Activity, type Row } from "./activity.ts";

/** One background item as the card gets it (the output file path stays on the server). */
export interface ActivityItem {
  id: string;
  kind: "agent" | "command" | "other";
  label: string;
  title: string;
  icon: string | null;
  startedAt: number | null;
  tokens: number | null;
  toolUses: number | null;
  command: string | null;
  /** Last lines the command printed; empty when it printed nothing or the file is out of reach. */
  output: string[];
  running: Activity["running"];
}

/** Segments read on every refresh. */
export const SEGMENTS = "3";
/** One-off deeper read for a command started long before those segments. */
export const DEEP_SEGMENTS = "40";
/** Cards asking about the same thread within this window share one timeline read. */
export const CACHE_MS = 1500;
export const OUTPUT_LINES = 4;
const MAX_COMMAND = 600;
const TAIL_BYTES = 8192;
const MAX_CACHED_THREADS = 50;
const MAX_LAUNCHES = 300;

/**
 * Only the task output files a provider writes under the temp directory are
 * read: the path comes out of timeline text, so it is not trusted as is.
 */
const SAFE_OUTPUT = /^(?:\/private)?\/tmp\/[\w.-]+\/[^\0]*\/tasks\/[\w-]+\.output$/;

export function safeOutputPath(path: string): boolean {
  return SAFE_OUTPUT.test(path) && !path.includes("..");
}

/** The last lines of a task output file; nothing for a path outside the provider's temp folders. */
export async function readTail(path: string, lines: number): Promise<string[]> {
  if (!safeOutputPath(path) || lines <= 0) return [];
  try {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat();
      const length = Math.min(size, TAIL_BYTES);
      if (length === 0) return [];
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      let text = buffer.toString("utf8");
      // A read that starts mid-file starts mid-line: drop the partial first line.
      if (size > length) text = text.slice(text.indexOf("\n") + 1);
      return tailLines(text, lines);
    } finally {
      await file.close();
    }
  } catch {
    return [];
  }
}

type Launch = { command: string | null; outputPath: string | null };

export interface ActivitySource {
  read(threadId: string): Promise<ActivityItem[]>;
  clear(): void;
}

export function createActivitySource(options: {
  /** The thread's timeline with nested rows, `segments` segments deep. */
  timeline: (threadId: string, segments: string) => Promise<unknown>;
  tail?: (path: string, lines: number) => Promise<string[]>;
  outputLines?: number;
  now?: () => number;
  warn?: (message: string) => void;
}): ActivitySource {
  const tail = options.tail ?? readTail;
  const lines = options.outputLines ?? OUTPUT_LINES;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; items: Promise<ActivityItem[]> }>();
  /** What started each background command, kept so an old launch is looked up once. */
  const launches = new Map<string, Launch | null>();

  async function activities(threadId: string, segments: string): Promise<Activity[]> {
    return buildActivities((await options.timeline(threadId, segments)) as Row);
  }

  function remember(items: Activity[]): void {
    for (const item of items) {
      if (item.kind === "command" && item.command !== null) launches.set(item.id, { command: item.command, outputPath: item.outputPath });
    }
    while (launches.size > MAX_LAUNCHES) {
      const oldest = launches.keys().next().value;
      if (oldest === undefined) break;
      launches.delete(oldest);
    }
  }

  async function load(threadId: string): Promise<ActivityItem[]> {
    const items = await activities(threadId, SEGMENTS);
    remember(items);
    const unknown = items.filter((item) => item.kind === "command" && item.command === null && !launches.has(item.id));
    if (unknown.length > 0) {
      try {
        remember(await activities(threadId, DEEP_SEGMENTS));
      } catch (error) {
        options.warn?.(`deep timeline read failed: ${String(error)}`);
      }
      for (const item of unknown) if (!launches.has(item.id)) launches.set(item.id, null);
    }
    return Promise.all(
      items.map(async ({ outputPath, ...item }) => {
        const launch = item.kind === "command" ? (launches.get(item.id) ?? null) : null;
        const command = item.command ?? launch?.command ?? null;
        const path = outputPath ?? launch?.outputPath ?? null;
        return {
          ...item,
          command: command !== null && command.length > MAX_COMMAND ? `${command.slice(0, MAX_COMMAND - 1)}…` : command,
          output: path !== null && lines > 0 ? await tail(path, lines) : [],
        };
      }),
    );
  }

  return {
    async read(threadId) {
      const at = now();
      const cached = cache.get(threadId);
      if (cached !== undefined && at - cached.at < CACHE_MS) return cached.items;
      const items = load(threadId);
      cache.set(threadId, { at, items });
      if (cache.size > MAX_CACHED_THREADS) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      try {
        return await items;
      } catch (error) {
        cache.delete(threadId);
        throw error;
      }
    },
    clear() {
      cache.clear();
      launches.clear();
    },
  };
}
