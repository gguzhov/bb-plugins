// Pure logic of the touchbar plugin: no SDK, no I/O. Tested in tests/.
import type { CardState, Snapshot, SnapshotCard, SnapshotStage, SnapshotSummary, TicketStatus } from "./contract.ts";

export interface TurnEvent {
  type: string;
  createdAt: number;
  seq?: number;
}

/** Turn intervals collected from turn/started and turn/completed events. */
export interface TurnTracker {
  /** Finished turns as [start, end] in epoch ms. */
  intervals: Array<[number, number]>;
  /** Start of the turn that has not completed yet. */
  openStart: number | null;
}

export const MAX_INTERVALS = 500;

export function newTracker(): TurnTracker {
  return { intervals: [], openStart: null };
}

/**
 * Feed events in ascending order. A repeated start keeps the first one; a
 * completion without a start is ignored; an end before its start is ignored.
 */
export function applyTurnEvents(tracker: TurnTracker, events: readonly TurnEvent[]): void {
  for (const event of events) {
    if (!Number.isFinite(event.createdAt)) continue;
    if (event.type === "turn/started") {
      if (tracker.openStart === null) tracker.openStart = event.createdAt;
    } else if (event.type === "turn/completed") {
      if (tracker.openStart === null) continue;
      if (event.createdAt >= tracker.openStart) {
        tracker.intervals.push([tracker.openStart, event.createdAt]);
      }
      tracker.openStart = null;
    }
  }
  if (tracker.intervals.length > MAX_INTERVALS) {
    tracker.intervals.splice(0, tracker.intervals.length - MAX_INTERVALS);
  }
}

export interface WorkTime {
  workMs: number;
  runningSince: number | null;
}

/** Sum of finished turns clipped to the plan's start, plus the running turn's start. */
export function workTime(tracker: TurnTracker, planStart: number): WorkTime {
  let workMs = 0;
  for (const [start, end] of tracker.intervals) {
    const from = Math.max(start, planStart);
    if (end > from) workMs += end - from;
  }
  const runningSince = tracker.openStart === null ? null : Math.max(tracker.openStart, planStart);
  return { workMs, runningSince };
}

export function computeWork(events: readonly TurnEvent[], planStart: number): WorkTime {
  const tracker = newTracker();
  applyTurnEvents(tracker, events);
  return workTime(tracker, planStart);
}

// --- plan -> card ---

export type StepStatus = "pending" | "active" | "review" | "done" | "error" | "skipped";
export type PlanState = "running" | "needs_input" | "error" | "done";

export interface PlanLike {
  title: string;
  state: PlanState;
  note?: string | null;
  startedAt: number;
  updatedAt: number;
  stages: Array<{
    name?: string;
    steps: Array<{
      title: string;
      status: StepStatus;
      points?: number;
      owner?: string;
      agent?: string;
      startedAt?: number;
      reviewAt?: number;
      doneAt?: number;
    }>;
  }>;
}

export const MAX_NOTE = 200;
export const MAX_TICKET_TITLE = 120;
export const MAX_CARD_TICKETS = 60;
export const ETA_MIN_DONE = 2;
export const ETA_MIN_WORK_MS = 300_000;

/** Cut to `max` characters; a longer text ends with "…" (total length still `max`). */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

export function cleanNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;
  const t = note.trim();
  return t === "" ? null : truncate(t, MAX_NOTE);
}

/** Sum of the finished turns that fall inside [from, to]. */
export function workWithin(intervals: ReadonlyArray<readonly [number, number]>, from: number, to: number): number {
  let total = 0;
  for (const [start, end] of intervals) {
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (b > a) total += b - a;
  }
  return total;
}

/**
 * Agent work inside one ticket's span: from its first move into work to the
 * moment it was done, handed in for review, or `now` while it is still open.
 * 0 for a ticket that never started.
 */
export function ticketWorkMs(
  step: { status: StepStatus; startedAt?: number; reviewAt?: number; doneAt?: number },
  intervals: ReadonlyArray<readonly [number, number]>,
  now: number,
): number {
  if (typeof step.startedAt !== "number") return 0;
  let to = now;
  if (step.status === "done" && typeof step.doneAt === "number") to = step.doneAt;
  else if (step.status === "review" && typeof step.reviewAt === "number") to = step.reviewAt;
  return workWithin(intervals, step.startedAt, to);
}

/** Plan queues with tickets, at most `cap` tickets in total; returns how many were left out. */
export function buildStages(
  plan: PlanLike,
  cap = MAX_CARD_TICKETS,
  intervals: ReadonlyArray<readonly [number, number]> = [],
  now = 0,
): { stages: SnapshotStage[]; hiddenTickets: number } {
  let left = cap;
  let hidden = 0;
  const stages: SnapshotStage[] = [];
  for (const stage of plan.stages) {
    const take = stage.steps.slice(0, Math.max(0, left));
    hidden += stage.steps.length - take.length;
    left -= take.length;
    if (take.length === 0 && stage.steps.length > 0) continue;
    stages.push({
      name: stage.name ?? "",
      tickets: take.map((s) => ({
        title: truncate(s.title, MAX_TICKET_TITLE),
        status: s.status as TicketStatus,
        owner: s.owner && s.owner.trim() !== "" ? s.owner : null,
        agent: s.agent && s.agent.trim() !== "" ? truncate(s.agent.trim(), 60) : null,
        agentIcon: null,
        startedAt: typeof s.startedAt === "number" ? s.startedAt : null,
        doneAt: s.status === "done" && typeof s.doneAt === "number" ? s.doneAt : null,
        workMs: ticketWorkMs(s, intervals, now),
      })),
    });
  }
  return { stages, hiddenTickets: hidden };
}

/**
 * Work time left in ms at the moment `now`: (work so far / points done) x points left.
 * Null when fewer than 2 tickets are done, under 5 minutes worked, nothing left or the plan is done.
 */
export function estimateEta(plan: PlanLike, work: WorkTime, now: number): number | null {
  if (plan.state === "done") return null;
  let doneCount = 0;
  let donePoints = 0;
  let leftPoints = 0;
  let leftCount = 0;
  for (const stage of plan.stages) {
    for (const s of stage.steps) {
      const pts = typeof s.points === "number" && s.points > 0 ? s.points : 1;
      if (s.status === "done") {
        doneCount++;
        donePoints += pts;
      } else if (s.status !== "skipped") {
        leftCount++;
        leftPoints += pts;
      }
    }
  }
  if (doneCount < ETA_MIN_DONE || leftCount === 0) return null;
  const spent = work.workMs + (work.runningSince === null ? 0 : Math.max(0, now - work.runningSince));
  if (spent < ETA_MIN_WORK_MS) return null;
  return Math.round((spent / donePoints) * leftPoints);
}

const MENTION = /@thread:thr_[A-Za-z0-9]+(?:#msg=\d+)?/g;

/** Thread title without thread mentions; the original when nothing is left. */
export function cleanTitle(title: string): string {
  let t = title.replace(/^\s*Continue from\s+(?=@thread:thr_[A-Za-z0-9]+)/i, "");
  t = t.replace(MENTION, " ").replace(/\s+/g, " ").trim();
  return t === "" ? title : t;
}

export function planCounts(plan: PlanLike): { done: number; total: number; current: string | null } {
  const steps = plan.stages.flatMap((stage) => stage.steps);
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const pick =
    steps.find((s) => s.status === "active") ??
    steps.find((s) => s.status === "error") ??
    steps.find((s) => s.status === "review") ??
    null;
  return { done, total: steps.length, current: pick?.title ?? null };
}

export function cardState(planState: PlanState, threadActive: boolean): CardState {
  if (planState === "needs_input") return "waiting";
  if (planState === "error") return "error";
  if (planState === "done") return "done";
  return threadActive ? "working" : "idle";
}

export interface CardInput {
  threadId: string;
  project: string;
  title: string;
  threadActive: boolean;
  threadUpdatedAt: number;
  plan: PlanLike;
  work: WorkTime;
  /** Server clock for the forecast; defaults to threadUpdatedAt. */
  now?: number;
  /** Finished turns of the thread, for the per-ticket work time. */
  intervals?: ReadonlyArray<readonly [number, number]>;
}

export function buildCard(input: CardInput): SnapshotCard {
  const { plan } = input;
  const { done, total, current } = planCounts(plan);
  return {
    threadId: input.threadId,
    project: input.project,
    title: cleanTitle(input.title),
    planTitle: plan.title,
    done,
    total,
    remaining: total - done,
    current,
    state: cardState(plan.state, input.threadActive),
    workMs: input.work.workMs,
    runningSince: input.work.runningSince,
    updatedAt: Math.max(plan.updatedAt, input.threadUpdatedAt),
    note: cleanNote(plan.note),
    etaMs: estimateEta(plan, input.work, input.now ?? input.threadUpdatedAt),
    ...buildStages(plan, MAX_CARD_TICKETS, input.intervals ?? [], input.now ?? input.threadUpdatedAt),
    icon: null,
  };
}

const ORDER: Record<CardState, number> = { working: 0, waiting: 1, error: 2, idle: 3, done: 4 };

export function sortCards(cards: readonly SnapshotCard[]): SnapshotCard[] {
  return [...cards].sort(
    (a, b) => ORDER[a.state] - ORDER[b.state] || b.updatedAt - a.updatedAt || a.threadId.localeCompare(b.threadId),
  );
}

/** Totals over every card, counted before the card limit cuts the list. */
export function summarize(cards: readonly SnapshotCard[]): SnapshotSummary {
  const projects = new Set<string>();
  const projectsWorking = new Set<string>();
  const summary: SnapshotSummary = {
    projectsWorking: 0,
    projects: 0,
    threads: cards.length,
    threadsWorking: 0,
    threadsWaiting: 0,
    threadsError: 0,
    done: 0,
    total: 0,
    tasksInWorking: 0,
    doneInWorking: 0,
  };
  for (const card of cards) {
    projects.add(card.project);
    if (card.state === "working") {
      projectsWorking.add(card.project);
      summary.threadsWorking += 1;
      summary.tasksInWorking += card.total;
      summary.doneInWorking += card.done;
    } else if (card.state === "waiting") summary.threadsWaiting += 1;
    else if (card.state === "error") summary.threadsError += 1;
    summary.done += card.done;
    summary.total += card.total;
  }
  summary.projects = projects.size;
  summary.projectsWorking = projectsWorking.size;
  return summary;
}

export function buildSnapshot(cards: readonly SnapshotCard[], limit: number, now: number, iconUrl: string | null = null): Snapshot {
  return {
    version: 2,
    summary: summarize(cards),
    iconUrl,
    generatedAt: now,
    cards: sortCards(cards).slice(0, Math.max(0, limit)),
  };
}

/** Candidate threads: active now or changed within recentHours, newest first, at most `max`. */
export interface CandidateThread {
  id: string;
  status: string;
  updatedAt: number;
}
export function pickCandidates<T extends CandidateThread>(
  threads: readonly T[],
  now: number,
  recentHours: number,
  max = 40,
): T[] {
  const since = now - recentHours * 3_600_000;
  return threads
    .filter((t) => t.status === "active" || t.updatedAt >= since)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
}

/** Finished plans task-queue stopped serving stay in the snapshot this long. */
export const DONE_KEEP_MS = 600_000;

export interface KeptCard {
  card: SnapshotCard;
  /** Last time task-queue still served this plan. */
  seenAt: number;
}

/**
 * Cards of finished plans that task-queue no longer serves: kept for
 * DONE_KEEP_MS after the last time they were served. Returns the cards to add
 * and drops expired entries from `kept` in place.
 */
export function retainDone(
  kept: Map<string, KeptCard>,
  liveIds: ReadonlySet<string>,
  now: number,
  keepMs = DONE_KEEP_MS,
): SnapshotCard[] {
  const out: SnapshotCard[] = [];
  for (const [id, entry] of [...kept]) {
    if (now - entry.seenAt > keepMs) kept.delete(id);
    else if (!liveIds.has(id)) out.push(entry.card);
  }
  return out;
}
