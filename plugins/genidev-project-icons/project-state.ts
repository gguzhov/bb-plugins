// What a project is doing right now, from the sidebar's live thread list.
//
// "waiting": a thread of the project is blocked on the owner. bb sets
//   `hasPendingInteraction` while the agent waits on an approval or a question
//   (that includes a plan that waits for a decision), and resolves the row
//   indicator to "waiting-for-input" for the same case. Either one counts.
//   Unread results ("unread-success" / "unread-error") do NOT count.
// "working": a thread is in a running turn: status starting, active or stopping.
// "waiting" wins over "working"; otherwise the project is "idle".
//
// Threads bb keeps out of its own list (isHidden) and archived ones are ignored.

export type ProjectState = "idle" | "working" | "waiting";

/** The thread fields this module reads (a subset of PluginSidebarThread). */
export interface ThreadSignal {
  projectId: string;
  status: string;
  indicator: string;
  hasPendingInteraction: boolean;
  isHidden: boolean;
  isArchived: boolean;
}

const RUNNING = new Set(["starting", "active", "stopping"]);

export function threadState(thread: ThreadSignal): ProjectState {
  if (thread.isHidden || thread.isArchived) return "idle";
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "waiting";
  if (RUNNING.has(thread.status)) return "working";
  return "idle";
}

/** Projects that are not idle; a project missing from the map is idle. */
export function projectStates(threads: readonly ThreadSignal[]): Map<string, ProjectState> {
  const states = new Map<string, ProjectState>();
  for (const thread of threads) {
    const state = threadState(thread);
    if (state === "idle" || states.get(thread.projectId) === "waiting") continue;
    states.set(thread.projectId, state);
  }
  return states;
}

/**
 * Manual debug switch. Off unless the owner writes this key in localStorage:
 *   localStorage.setItem("genidev-project-icons:debug-state", '{"<projectId>":"working"}')
 * Values: "working", "waiting", "idle". It is read on start and on every
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
    if (state === "working" || state === "waiting" || state === "idle") states.set(projectId.slice(0, 160), state);
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
