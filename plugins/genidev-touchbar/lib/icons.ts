// Picking project icons for threads and executors. Pure functions, no bb calls.
import type { Snapshot, SnapshotCard, SnapshotIcon, SnapshotStage } from "./contract.ts";

/** One picture of the icons library: id and the extra frames it has. */
export interface LibraryEntry {
  id: string;
  frames: string[];
}

export const FRAME_ORDER = ["left", "right", "puzzled", "alert", "happy"] as const;
export const PIN_TTL_MS = 30 * 24 * 3600_000;
export const MAX_AGENT = 60;

/** A thread's automatic icon, kept between requests and restarts. */
export interface Pin {
  iconId: string;
  seenAt: number;
}

/** Stable 32-bit FNV-1a hash. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const toIcon = (entry: LibraryEntry, chosen: boolean): SnapshotIcon => ({
  id: entry.id,
  frames: [...entry.frames],
  chosen,
});

/** Library entry by stable hash of `key`, skipping ids in `taken` while any is free. */
export function pickFromLibrary(key: string, library: readonly LibraryEntry[], taken: ReadonlySet<string>): LibraryEntry | null {
  const n = library.length;
  if (n === 0) return null;
  const start = hashString(key) % n;
  for (let i = 0; i < n; i++) {
    const entry = library[(start + i) % n];
    if (!taken.has(entry.id)) return entry;
  }
  return library[start];
}

export interface ThreadIconInput {
  threadId: string;
  /** Icon the owner chose for this thread's project, or null. */
  projectIconId: string | null;
}

export interface ThreadIconResult {
  icons: Map<string, SnapshotIcon>;
  /** Pins after this round: current ones kept, new ones added, stale ones dropped. */
  pins: Map<string, Pin>;
  /** Thread ids whose pin was added or changed, or whose seenAt moved by a day or more; they need saving. */
  dirty: string[];
  /** Thread ids whose pin is dropped as older than 30 days. */
  removed: string[];
}

/**
 * Icons for the threads of one snapshot. The owner's choice for the project wins.
 * Others keep their pin while it is still in the library; new ones take the hash
 * pick that no other automatic thread has, repeating only when the library is used up.
 */
export function assignThreadIcons(
  threads: readonly ThreadIconInput[],
  library: readonly LibraryEntry[],
  oldPins: ReadonlyMap<string, Pin>,
  now: number,
): ThreadIconResult {
  const icons = new Map<string, SnapshotIcon>();
  const pins = new Map<string, Pin>();
  const dirty: string[] = [];
  const removed: string[] = [];
  const byId = new Map(library.map((e) => [e.id, e] as const));
  const present = new Set(threads.map((t) => t.threadId));

  for (const [id, pin] of oldPins) {
    if (present.has(id)) pins.set(id, pin);
    else if (now - pin.seenAt > PIN_TTL_MS) removed.push(id);
    else pins.set(id, pin);
  }
  if (library.length === 0) return { icons, pins, dirty, removed };

  const taken = new Set<string>();
  const pending: ThreadIconInput[] = [];
  for (const t of threads) {
    const chosen = t.projectIconId !== null ? byId.get(t.projectIconId) : undefined;
    if (chosen !== undefined) {
      icons.set(t.threadId, toIcon(chosen, true));
      continue;
    }
    const pin = pins.get(t.threadId);
    const kept = pin !== undefined ? byId.get(pin.iconId) : undefined;
    if (pin !== undefined && kept !== undefined) {
      icons.set(t.threadId, toIcon(kept, false));
      taken.add(kept.id);
      if (now - pin.seenAt >= 24 * 3600_000) {
        pins.set(t.threadId, { iconId: pin.iconId, seenAt: now });
        dirty.push(t.threadId);
      }
    } else {
      pending.push(t);
    }
  }
  pending.sort((a, b) => (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0));
  for (const t of pending) {
    const entry = pickFromLibrary(t.threadId, library, taken)!;
    taken.add(entry.id);
    icons.set(t.threadId, toIcon(entry, false));
    pins.set(t.threadId, { iconId: entry.id, seenAt: now });
    dirty.push(t.threadId);
  }
  return { icons, pins, dirty, removed };
}

/** Executor text as the ticket shows it: trimmed, at most 60 characters, null when empty. */
export function cleanAgent(agent: string | null | undefined): string | null {
  if (agent === undefined || agent === null) return null;
  const text = agent.trim();
  if (text === "") return null;
  return text.length > MAX_AGENT ? text.slice(0, MAX_AGENT) : text;
}

/** Icon of an executor: stable per thread and executor text, not stored. */
export function agentIcon(threadId: string, agent: string | null, library: readonly LibraryEntry[]): SnapshotIcon | null {
  if (agent === null || library.length === 0) return null;
  const entry = pickFromLibrary(`${threadId}\u0000${agent}`, library, new Set());
  return entry === null ? null : toIcon(entry, false);
}

/** Adds the thread icon and executor icons to a card built without them. */
export function decorateCard(card: SnapshotCard, icon: SnapshotIcon | null, library: readonly LibraryEntry[]): SnapshotCard {
  const stages: SnapshotStage[] = card.stages.map((stage) => ({
    ...stage,
    tickets: stage.tickets.map((t) => {
      const agent = cleanAgent(t.agent);
      return { ...t, agent, agentIcon: agentIcon(card.threadId, agent, library) };
    }),
  }));
  return { ...card, icon, stages };
}

export function iconLabel(icon: SnapshotIcon | null): string {
  return icon === null ? "" : ` [${icon.id}${icon.chosen ? "*" : ""}]`;
}

export type { Snapshot };
