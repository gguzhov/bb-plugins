// What a project is doing right now, from the sidebar's live thread list.
//
// Five states, the first match wins (a higher state hides the lower ones):
//   "error"   a thread ended its turn with an error and the owner has not opened it:
//             `status === "error"` and `isUnread`, or the row indicator `unread-error`.
//             On live data (24.11.2026) bb left `indicator` at "none" for threads with
//             status "error" and isUnread true, so the indicator alone would miss them.
//   "waiting" a thread is blocked on the owner: `hasPendingInteraction` (an approval,
//             a question, a plan that waits for a decision) or the indicator
//             `waiting-for-input`.
//   "working" a thread is in a running turn: status starting, active or stopping.
//   "done"    a thread ended its turn successfully and the owner has not opened it:
//             the row indicator `unread-success`.
//   "idle"    none of the above.
//
// "Unread" is bb's own flag (`isUnread`, or the `unread-*` indicator); the plugin
// does not compare timestamps itself.
// Threads bb keeps out of its own list (isHidden) and archived ones are ignored.

export type ProjectState = "idle" | "done" | "working" | "waiting" | "error";

/** The thread fields this module reads (a subset of PluginSidebarThread). */
export interface ThreadSignal {
  projectId: string;
  status: string;
  indicator: string;
  isUnread: boolean;
  hasPendingInteraction: boolean;
  isHidden: boolean;
  isArchived: boolean;
}

/** Higher number wins. */
export const STATE_RANK: Readonly<Record<ProjectState, number>> = { idle: 0, done: 1, working: 2, waiting: 3, error: 4 };

export const STATE_NAMES = Object.keys(STATE_RANK) as ProjectState[];

export function isProjectState(value: unknown): value is ProjectState {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATE_RANK, value);
}

const RUNNING = new Set(["starting", "active", "stopping"]);

export function threadState(thread: ThreadSignal): ProjectState {
  if (thread.isHidden || thread.isArchived) return "idle";
  if (thread.indicator === "unread-error" || (thread.status === "error" && thread.isUnread)) return "error";
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "waiting";
  if (RUNNING.has(thread.status)) return "working";
  if (thread.indicator === "unread-success") return "done";
  return "idle";
}

/** The state that wins among several. */
export function strongest(states: readonly ProjectState[]): ProjectState {
  return states.reduce<ProjectState>((best, state) => (STATE_RANK[state] > STATE_RANK[best] ? state : best), "idle");
}

/** Projects that are not idle; a project missing from the map is idle. */
export function projectStates(threads: readonly ThreadSignal[]): Map<string, ProjectState> {
  const states = new Map<string, ProjectState>();
  for (const thread of threads) {
    const state = threadState(thread);
    if (state === "idle") continue;
    const current = states.get(thread.projectId) ?? "idle";
    if (STATE_RANK[state] > STATE_RANK[current]) states.set(thread.projectId, state);
  }
  return states;
}

/**
 * Manual debug switch. Off unless the owner writes this key in localStorage:
 *   localStorage.setItem("genidev-project-icons:debug-state", '{"<projectId>":"error"}')
 * Values: "error", "waiting", "working", "done", "idle". It is read on start and on every
 * `storage` event (other tabs fire it themselves; in the same tab dispatch
 * `new StorageEvent("storage", { key })` after setItem). Remove the key to turn it off.
 */
export const DEBUG_KEY = "genidev-project-icons:debug-state";

export function parseDebugStates(raw: string | null): Map<string, ProjectState> {
  const states = new Map<string, ProjectState>();
  if (!raw) return states;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return states;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return states;
  for (const [projectId, state] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (isProjectState(state)) states.set(projectId.slice(0, 160), state);
  }
  return states;
}

/** Real states with the debug overrides on top ("idle" in the override forces idle). */
export function withOverrides(real: Map<string, ProjectState>, overrides: Map<string, ProjectState>): Map<string, ProjectState> {
  if (overrides.size === 0) return real;
  const merged = new Map(real);
  for (const [projectId, state] of overrides) {
    if (state === "idle") merged.delete(projectId);
    else merged.set(projectId, state);
  }
  return merged;
}
