/**
 * The snapshot the touchbar plugin serves and the native notch app draws.
 * One shape for `bb touchbar snapshot --json` and for
 * GET /api/v1/plugins/touchbar/http/snapshot (auth: token).
 *
 * The native app (native/) decodes exactly these fields. Change them in both
 * places or not at all.
 */

/**
 * What the card says about the thread right now:
 * - working: the agent is in a turn (thread status active);
 * - waiting: the plan waits for the owner (plan state needs_input);
 * - error:   the plan state is error;
 * - done:    every ticket is finished (plan state done);
 * - idle:    the plan is open, nobody is working.
 */
export type CardState = "working" | "waiting" | "error" | "done" | "idle";

/**
 * A picture from the project icons plugin (genidev-project-icons).
 * The image is `${Snapshot.iconUrl}?id=${id}`; a frame is the same address
 * with `&frame=${name}`.
 */
export interface SnapshotIcon {
  id: string;
  /**
   * Extra frames this icon has besides the base one, any of:
   * "left", "right" (eyes while working), "puzzled" (waits for the owner),
   * "alert" (error), "happy" (done). May be empty.
   */
  frames: string[];
  /** true when the owner chose this icon for the project; false when it was picked automatically. */
  chosen: boolean;
}

/** Status of one ticket of the plan, as task-queue keeps it. */
export type TicketStatus = "pending" | "active" | "review" | "done" | "error" | "skipped";

export interface SnapshotTicket {
  /** Ticket title, at most 120 characters (longer ones end with "…"). */
  title: string;
  status: TicketStatus;
  /** Who does it, e.g. "Sonnet 5.5"; null when the plan does not say. */
  owner: string | null;

  // ── Added after version 2. The native app decodes them as optional. ──

  /** When the ticket first went into work, epoch ms; null when it never started. */
  startedAt: number | null;
  /** When it became done, epoch ms; null while it is not done. */
  doneAt: number | null;
  /**
   * Milliseconds the agent really worked while this ticket was in work: the
   * thread's finished turns cut to the ticket's span (from startedAt to
   * doneAt; for a ticket handed in for review, to that hand-in; for one still
   * open, to now). The turn still running is NOT in here: for a ticket with
   * status "active" the app adds now - max(card.runningSince, startedAt)
   * when card.runningSince is not null. 0 when the ticket never started.
   */
  workMs: number;

  // ── Added with project icons. The native app decodes them as optional. ──

  /** Who works on the ticket as the plan names it (a subagent's name or description); null when nobody is named. */
  agent: string | null;
  /** A picture for that executor, picked automatically and kept stable per executor name; null without an executor or without icons. */
  agentIcon: SnapshotIcon | null;
}

export interface SnapshotStage {
  /** Queue name, e.g. "Очередь 2: …"; empty for a plan sent as one flat list. */
  name: string;
  tickets: SnapshotTicket[];
}

export interface SnapshotCard {
  threadId: string;
  /** Project name as bb shows it, e.g. "Global GG AI". */
  project: string;
  /**
   * Thread title (its fallback when the title is empty), with thread mentions
   * like "@thread:thr_abc123" removed.
   */
  title: string;
  /** Title of the thread's plan. */
  planTitle: string;
  /** Finished tickets: done or skipped. */
  done: number;
  /** All tickets of the plan. */
  total: number;
  /** total - done. */
  remaining: number;
  /** The ticket in work now, null when there is none. */
  current: string | null;
  state: CardState;
  /**
   * Milliseconds the agent really worked on this plan: the sum of the thread's
   * finished turns, each clipped to start no earlier than the plan's start.
   * The turn still running is NOT in here.
   */
  workMs: number;
  /**
   * Start of the turn that is running now (epoch ms, clipped to the plan's
   * start), or null when no turn runs. The time to show is
   * workMs + (now - runningSince).
   */
  runningSince: number | null;
  /** Latest change of the plan or the thread, epoch ms. */
  updatedAt: number;

  // ── Added in snapshot version 2. The native app decodes them as optional. ──

  /**
   * Why the plan waits or failed (the plan's note), at most 200 characters;
   * null when there is none.
   */
  note: string | null;
  /**
   * Estimated work time left, in ms, measured at generatedAt:
   * (work time so far / points done) × points left. Null when fewer than 2
   * tickets are done, less than 5 minutes are worked, or nothing is left.
   */
  etaMs: number | null;
  /**
   * The plan's queues with their tickets, in plan order. At most 60 tickets
   * per card in total; the rest are counted in hiddenTickets.
   */
  stages: SnapshotStage[];
  /** Tickets left out of stages because of the 60-ticket cap, usually 0. */
  hiddenTickets: number;

  // ── Added with project icons. The native app decodes it as optional. ──

  /**
   * The picture of this thread: its project's icon when the owner chose one,
   * otherwise one picked automatically for the thread and kept stable.
   * Null when the icons plugin is off or its library is empty.
   */
  icon: SnapshotIcon | null;
}

/**
 * The whole picture for the calm (collapsed) strip, counted over every thread
 * that has a plan, before the card limit cuts the list.
 */
export interface SnapshotSummary {
  /** Distinct projects with at least one thread in state working. */
  projectsWorking: number;
  /** Distinct projects among all threads with a plan. */
  projects: number;
  /** Threads with a plan. */
  threads: number;
  threadsWorking: number;
  threadsWaiting: number;
  threadsError: number;
  /** Finished tickets over all those threads ("fact"). */
  done: number;
  /** All tickets over all those threads ("plan"). */
  total: number;

  // ── Added later. The native app decodes them as optional. ──

  /** All tickets of the threads that are in state working right now. */
  tasksInWorking: number;
  /** Finished tickets of those working threads. */
  doneInWorking: number;
}

export interface Snapshot {
  /** Shape version: 2 since tickets, note and etaMs were added. */
  version: 2;
  /** Totals for the calm strip. Added later than version 2 itself: the native app decodes it as optional. */
  summary: SnapshotSummary;
  /**
   * Address of the icons plugin's image route on this machine, without query,
   * e.g. "http://127.0.0.1:38886/api/v1/plugins/genidev-project-icons/http/icon".
   * Null when the icons plugin is off. Added with project icons; optional for the native app.
   */
  iconUrl: string | null;
  /** Server clock when the snapshot was built, epoch ms. */
  generatedAt: number;
  /**
   * Threads that have a plan, the one to show first at index 0:
   * working, then waiting, then error, then idle, then done; inside a group
   * the most recently updated first.
   */
  cards: SnapshotCard[];
}
