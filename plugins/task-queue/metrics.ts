// Agile figures for a plan, worked out from the times the plan stores. Pure
// functions: the agent never computes them, the server and the card do.
// A figure without enough data is null ("no data"), never 0, NaN or Infinity.
import type { Plan, PlanStage, PlanStep } from "./plan.ts";
import { ticketView } from "./format.ts";

export interface Metrics {
  /** Done points / all points, skipped tickets left out. */
  progress: number | null;
  pointsDone: number;
  pointsTotal: number;
  /** Confirmed criteria / criteria, over done tickets the lead accepted. */
  acceptance: number | null;
  /** Done points per hour since the first ticket started. */
  velocity: number | null;
  /** Points left / velocity, in ms; only with 2+ tickets done and 5+ minutes gone. */
  etaMs: number | null;
  /** Mean doneAt − startedAt over done tickets. */
  cycleMs: number | null;
  /** Done tickets never sent back / done tickets (those done while times were kept). */
  firstPass: number | null;
  /** Tickets in work or in review. */
  wip: number;
  /** Done tickets / tickets, skipped ones left out. */
  done: number;
  total: number;
}

export interface StageMetrics {
  progress: number | null;
  acceptance: number | null;
  done: number;
  total: number;
}

const HOUR = 3_600_000;
export const ETA_MIN_DONE = 2;
export const ETA_MIN_MS = 5 * 60_000;

/** Size: the field, else the one an old-style title carries ("3 б."), else 1. */
const points = (step: PlanStep) => step.points ?? ticketView(step).points ?? 1;
const ratio = (part: number, whole: number) => (whole > 0 && Number.isFinite(part / whole) ? part / whole : null);

function volume(steps: readonly PlanStep[]) {
  const counted = steps.filter((step) => step.status !== "skipped");
  const done = counted.filter((step) => step.status === "done");
  const pointsTotal = counted.reduce((sum, step) => sum + points(step), 0);
  const pointsDone = done.reduce((sum, step) => sum + points(step), 0);
  return { counted, done, pointsTotal, pointsDone };
}

function acceptanceOf(done: readonly PlanStep[]): number | null {
  let confirmed = 0;
  let criteria = 0;
  for (const step of done) {
    if (step.accepted === undefined || step.criteria === undefined) continue;
    confirmed += step.accepted;
    criteria += step.criteria;
  }
  return ratio(confirmed, criteria);
}

export function stageMetrics(stage: Pick<PlanStage, "steps">): StageMetrics {
  const { counted, done, pointsTotal, pointsDone } = volume(stage.steps);
  return { progress: ratio(pointsDone, pointsTotal), acceptance: acceptanceOf(done), done: done.length, total: counted.length };
}

export function planMetrics(plan: Pick<Plan, "stages" | "state" | "finishedAt">, now: number): Metrics {
  const steps = plan.stages.flatMap((stage) => stage.steps);
  const { counted, done, pointsTotal, pointsDone } = volume(steps);

  // Only tickets that became done while the plan tracked times count toward speed.
  const timed = done.filter((step) => step.doneAt !== undefined);
  const starts = steps.map((step) => step.startedAt).filter((t): t is number => t !== undefined);
  const from = starts.length === 0 ? null : Math.min(...starts);
  const until = plan.state === "done" && plan.finishedAt !== null ? plan.finishedAt : now;
  const spent = from === null ? 0 : until - from;
  const timedPoints = timed.reduce((sum, step) => sum + points(step), 0);
  const perHour = spent > 0 && timedPoints > 0 ? timedPoints / (spent / HOUR) : null;
  const velocity = perHour !== null && Number.isFinite(perHour) ? perHour : null;

  const left = pointsTotal - pointsDone;
  const eta =
    velocity !== null && timed.length >= ETA_MIN_DONE && spent >= ETA_MIN_MS ? (left / velocity) * HOUR : null;

  const cycles = done
    .filter((step) => step.startedAt !== undefined && step.doneAt !== undefined && step.doneAt >= step.startedAt)
    .map((step) => step.doneAt! - step.startedAt!);
  const cycle = cycles.length === 0 ? null : cycles.reduce((a, b) => a + b, 0) / cycles.length;

  return {
    progress: ratio(pointsDone, pointsTotal),
    pointsDone,
    pointsTotal,
    acceptance: acceptanceOf(done),
    velocity,
    etaMs: eta !== null && Number.isFinite(eta) ? eta : null,
    cycleMs: cycle,
    firstPass: ratio(timed.filter((step) => (step.rework ?? 0) === 0).length, timed.length),
    wip: steps.filter((step) => step.status === "active" || step.status === "review").length,
    done: done.length,
    total: counted.length,
  };
}

/** 0.917 -> 92. */
export function percent(value: number): number {
  return Math.round(value * 100);
}

/** 40 min -> "40m", 95 min -> "1h 35m", 30 s -> "<1m". */
export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${h}h` : `${h}h ${minutes % 60}m`;
}

/** Points per hour: one decimal under 10, whole above. */
export function rate(perHour: number): string {
  return perHour >= 10 ? String(Math.round(perHour)) : String(Math.round(perHour * 10) / 10);
}
