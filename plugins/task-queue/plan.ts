// The lead agent's work plan, shown in the Working Thread card above the composer.
// Pure functions only: no SDK or zod imports, so the frontend can import the
// helpers it needs and tests can run them with plain `node --test`.
//
// Words: the card says epic and ticket; the stored shape and the old JSON keep
// `stages` and `steps`, and `epics` / `tickets` are accepted as synonyms.
import { queueName, ticketView } from "./format.ts";
import { duration, planMetrics, percent, rate, stageMetrics, type Metrics, type StageMetrics } from "./metrics.ts";

export type StepStatus = "pending" | "active" | "review" | "done" | "error" | "skipped";
export type PlanState = "running" | "needs_input" | "error" | "done";

export interface PlanStep {
  title: string;
  status: StepStatus;
  /** Old ticket code, 1-6 characters: optional, never shown; old plans are still addressed by it. */
  code?: string;
  /** Who works on the ticket: the subagent's name as given at launch (its description) or a child thread id thr_…. */
  agent?: string;
  /** Size: 1, 2, 3, 5, 8 or 13. Counts as 1 when missing. */
  points?: number;
  /** Who does it, e.g. "Sonnet 5.5". */
  owner?: string;
  /** What gets done and what comes of it, one or two sentences in the user's language; the card's hover text. */
  desc?: string;
  /** Acceptance criteria, 0-50. */
  criteria?: number;
  /** Criteria the lead confirmed; set only by `accept`, only on a done ticket. */
  accepted?: number;
  /** Times the ticket went back for rework. */
  rework?: number;
  /** When the ticket first appeared in the plan; missing on tickets made before task-queue 1.1. */
  createdAt?: number;
  /** First move into work. */
  startedAt?: number;
  /** Last time it was sent back for rework. */
  reworkAt?: number;
  /** Last hand-in for review. */
  reviewAt?: number;
  /** When it became done. */
  doneAt?: number;
}
export interface PlanStage {
  /** Empty for a plan sent as one flat `steps` list. */
  name: string;
  steps: PlanStep[];
}
export interface Plan {
  id: string;
  title: string;
  stages: PlanStage[];
  state: PlanState;
  /** Why the plan waits or failed; it lasts until the next op. */
  note: string | null;
  startedAt: number;
  updatedAt: number;
  /** When the plan reached `done`; the card hides it a while after. */
  finishedAt: number | null;
}

/** A refusal the agent can act on: the message names what to fix. */
export class PlanError extends Error {
  readonly code: string;
  constructor(message: string, code = "invalid_op") {
    super(message);
    this.name = "PlanError";
    this.code = code;
  }
}

export const STEP_STATUSES: readonly StepStatus[] = ["pending", "active", "review", "done", "error", "skipped"];
export const POINTS: readonly number[] = [1, 2, 3, 5, 8, 13];
const STATE_ALIASES: Record<string, PlanState> = {
  running: "running",
  working: "running",
  needs_input: "needs_input",
  error: "error",
  failed: "error",
  done: "done",
};
const OP_KEYS = [
  "id", "title", "stages", "epics", "steps", "tickets",
  "next", "done", "skipped", "active", "failed", "note", "state",
  "start", "review", "accept", "rework", "describe", "assign",
];

export const LIMITS = {
  id: 80,
  title: 120,
  note: 300,
  code: 6,
  owner: 40,
  agent: 120,
  desc: 300,
  criteria: 50,
  stages: 12,
  steps: 100,
  /** Plans kept per thread; the least recently updated one goes first. */
  plansPerThread: 10,
} as const;

/** Realtime channel the server publishes `{ threadId }` on after a thread's plans changed. */
export const PLAN_CHANNEL = "plan";

/** A finished plan stays in the card this long. */
export const DONE_VISIBLE_MS = 30_000;

// ── Parsing ──────────────────────────────────────────────────────────────────

interface StepInput {
  title: string;
  status: StepStatus | null;
  code?: string;
  agent?: string;
  points?: number;
  owner?: string;
  desc?: string;
  criteria?: number;
  accepted?: number;
}
interface StageInput {
  name: string;
  steps: StepInput[];
}
export interface AcceptInput {
  ticket: string;
  /** Null: every criterion confirmed. */
  confirmed: number | null;
  total: number | null;
}
export interface ReworkInput {
  ticket: string;
  note: string | null;
}
/** `start` and `assign` items: a ticket and, optionally, the agent working on it. */
export interface AgentInput {
  ticket: string;
  /** Null: the ticket starts without a named agent (the lead does it, or the old rules tie one). */
  agent: string | null;
}
export interface DescribeInput {
  ticket: string;
  /** Null clears the description. */
  desc: string | null;
}
export interface PlanOp {
  id: string;
  title: string | null;
  stages: StageInput[] | null;
  next: boolean;
  done: string[];
  skipped: string[];
  active: string | null;
  failed: string | null;
  note: string | null;
  state: PlanState | null;
  start: AgentInput[];
  assign: AgentInput[];
  review: string[];
  accept: AcceptInput[];
  rework: ReworkInput[];
  describe: DescribeInput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new PlanError(`${field} must be a string`);
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat === "") throw new PlanError(`${field} must not be empty`);
  if (flat.length > max) throw new PlanError(`${field} is longer than ${max} characters`);
  return flat;
}

function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PlanError(`${field} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function titles(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list)) throw new PlanError(`${field} must be a step title or a list of them`);
  return list.map((item, index) => text(item, `${field}[${index}]`, LIMITS.title));
}

function stepInput(value: unknown, field: string): StepInput {
  if (typeof value === "string") return { title: text(value, field, LIMITS.title), status: null };
  if (!isRecord(value)) throw new PlanError(`${field} must be {title, status?}`);
  const title = text(value.title, `${field}.title`, LIMITS.title);
  let status: StepStatus | null = null;
  if (value.status !== undefined && value.status !== null) {
    if (typeof value.status !== "string" || !STEP_STATUSES.includes(value.status as StepStatus)) {
      throw new PlanError(`${field}.status must be one of ${STEP_STATUSES.join(", ")}`);
    }
    status = value.status as StepStatus;
  }
  const step: StepInput = { title, status };
  const given = (key: string) => value[key] !== undefined && value[key] !== null;
  if (given("code")) step.code = text(value.code, `${field}.code`, LIMITS.code);
  if (given("agent")) step.agent = text(value.agent, `${field}.agent`, LIMITS.agent);
  if (given("points")) {
    if (typeof value.points !== "number" || !POINTS.includes(value.points)) {
      throw new PlanError(`${field}.points must be one of ${POINTS.join(", ")}`);
    }
    step.points = value.points;
  }
  if (given("owner")) step.owner = text(value.owner, `${field}.owner`, LIMITS.owner);
  if (given("desc")) step.desc = text(value.desc, `${field}.desc`, LIMITS.desc);
  if (given("criteria")) step.criteria = int(value.criteria, `${field}.criteria`, 0, LIMITS.criteria);
  if (given("accepted")) {
    step.accepted = int(value.accepted, `${field}.accepted`, 0, LIMITS.criteria);
    if (step.criteria !== undefined && step.accepted > step.criteria) {
      throw new PlanError(`${field}.accepted (${step.accepted}) is more than its criteria (${step.criteria})`);
    }
  }
  return step;
}

function stepsInput(value: unknown, field: string): StepInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new PlanError(`${field} must be a non-empty list`);
  return value.map((step, index) => stepInput(step, `${field}[${index}]`));
}

/** `{name, steps}` or `{name, tickets}`. */
function stageSteps(stage: Record<string, unknown>, field: string): StepInput[] {
  if (stage.steps !== undefined && stage.tickets !== undefined) {
    throw new PlanError(`${field}: send either steps or tickets, not both`);
  }
  return stage.tickets !== undefined
    ? stepsInput(stage.tickets, `${field}.tickets`)
    : stepsInput(stage.steps, `${field}.steps`);
}

function acceptInput(value: unknown): AcceptInput[] {
  if (value === undefined) return [];
  const list = typeof value === "string" || isRecord(value) ? [value] : value;
  if (!Array.isArray(list)) throw new PlanError('accept must be a list such as ["T1"] or [{"ticket":"T1","confirmed":5,"total":6}]');
  return list.map((item, index) => {
    const field = `accept[${index}]`;
    if (typeof item === "string") return { ticket: text(item, field, LIMITS.title), confirmed: null, total: null };
    if (!isRecord(item)) throw new PlanError(`${field} must be a ticket or {ticket, confirmed, total?}`);
    const ticket = text(item.ticket, `${field}.ticket`, LIMITS.title);
    const total = item.total === undefined || item.total === null ? null : int(item.total, `${field}.total`, 0, LIMITS.criteria);
    const confirmed =
      item.confirmed === undefined || item.confirmed === null ? null : int(item.confirmed, `${field}.confirmed`, 0, LIMITS.criteria);
    if (confirmed !== null && total !== null && confirmed > total) {
      throw new PlanError(`${field}: confirmed (${confirmed}) is more than total (${total})`);
    }
    return { ticket, confirmed, total };
  });
}

function reworkInput(value: unknown): ReworkInput[] {
  if (value === undefined) return [];
  const list = typeof value === "string" || isRecord(value) ? [value] : value;
  if (!Array.isArray(list)) throw new PlanError('rework must be a list such as ["T1"] or [{"ticket":"T1","note":"..."}]');
  return list.map((item, index) => {
    const field = `rework[${index}]`;
    if (typeof item === "string") return { ticket: text(item, field, LIMITS.title), note: null };
    if (!isRecord(item)) throw new PlanError(`${field} must be a ticket or {ticket, note?}`);
    return {
      ticket: text(item.ticket, `${field}.ticket`, LIMITS.title),
      note: item.note === undefined || item.note === null ? null : text(item.note, `${field}.note`, LIMITS.note),
    };
  });
}

/** `["T1"]`, `"T1"`, `[{"ticket":"T1","agent":"Масштаб щипком"}]` or a mix; `requireAgent` for assign. */
function agentInput(value: unknown, key: string, requireAgent: boolean): AgentInput[] {
  if (value === undefined) return [];
  const list = typeof value === "string" || isRecord(value) ? [value] : value;
  if (!Array.isArray(list)) throw new PlanError(`${key} must be a list such as ["Тикет"] or [{"ticket":"Тикет","agent":"название субагента"}]`);
  return list.map((item, index) => {
    const field = `${key}[${index}]`;
    if (typeof item === "string") {
      if (requireAgent) throw new PlanError(`${field} must be {ticket, agent}`);
      return { ticket: text(item, field, LIMITS.title), agent: null };
    }
    if (!isRecord(item)) throw new PlanError(`${field} must be a ticket or {ticket, agent}`);
    const ticket = text(item.ticket, `${field}.ticket`, LIMITS.title);
    const agent = item.agent === undefined || item.agent === null ? null : text(item.agent, `${field}.agent`, LIMITS.agent);
    if (requireAgent && agent === null) throw new PlanError(`${field}.agent is required`);
    return { ticket, agent };
  });
}

function describeInput(value: unknown): DescribeInput[] {
  if (value === undefined) return [];
  const list = isRecord(value) ? [value] : value;
  if (!Array.isArray(list)) throw new PlanError('describe must be a list such as [{"ticket":"T1","desc":"..."}]');
  return list.map((item, index) => {
    const field = `describe[${index}]`;
    if (!isRecord(item)) throw new PlanError(`${field} must be {ticket, desc}`);
    const ticket = text(item.ticket, `${field}.ticket`, LIMITS.title);
    if (item.desc === null || item.desc === "") return { ticket, desc: null };
    return { ticket, desc: text(item.desc, `${field}.desc`, LIMITS.desc) };
  });
}

/** Reads one op from untrusted JSON (a CLI argument or a tool call). */
export function parseOp(raw: unknown): PlanOp {
  if (!isRecord(raw)) throw new PlanError("the op must be a JSON object such as {\"id\":\"task\",\"next\":true}");
  const unknown = Object.keys(raw).filter((key) => !OP_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new PlanError(`unknown field ${unknown.map((key) => `"${key}"`).join(", ")}; allowed: ${OP_KEYS.join(", ")}`);
  }
  const id = text(raw.id, "id", LIMITS.id);

  const sent = ["stages", "epics", "steps", "tickets"].filter((key) => raw[key] !== undefined);
  if (sent.length > 1) throw new PlanError(`send one of stages, epics, steps or tickets, not ${sent.join(" and ")}`);
  const stagesKey = raw.stages !== undefined ? "stages" : raw.epics !== undefined ? "epics" : null;
  const stepsKey = raw.steps !== undefined ? "steps" : raw.tickets !== undefined ? "tickets" : null;

  let stages: StageInput[] | null = null;
  if (stagesKey !== null) {
    const list = raw[stagesKey];
    if (!Array.isArray(list) || list.length === 0) throw new PlanError(`${stagesKey} must be a non-empty list`);
    if (list.length > LIMITS.stages) throw new PlanError(`a plan has at most ${LIMITS.stages} stages`);
    stages = list.map((stage, index) => {
      if (!isRecord(stage)) throw new PlanError(`${stagesKey}[${index}] must be {name, steps}`);
      return {
        name: text(stage.name, `${stagesKey}[${index}].name`, LIMITS.title),
        steps: stageSteps(stage, `${stagesKey}[${index}]`),
      };
    });
  } else if (stepsKey !== null) {
    stages = [{ name: "", steps: stepsInput(raw[stepsKey], stepsKey) }];
  }
  if (stages !== null) {
    const count = stages.reduce((sum, stage) => sum + stage.steps.length, 0);
    if (count > LIMITS.steps) throw new PlanError(`a plan has at most ${LIMITS.steps} steps`);
  }

  if (raw.next !== undefined && typeof raw.next !== "boolean") throw new PlanError("next must be true");
  let state: PlanState | null = null;
  if (raw.state !== undefined) {
    const value = typeof raw.state === "string" ? STATE_ALIASES[raw.state] : undefined;
    if (value === undefined) throw new PlanError("state must be one of running, needs_input, error, done");
    state = value;
  }
  const op: PlanOp = {
    id,
    title: raw.title === undefined ? null : text(raw.title, "title", LIMITS.title),
    stages,
    next: raw.next === true,
    done: titles(raw.done, "done"),
    skipped: titles(raw.skipped, "skipped"),
    active: raw.active === undefined ? null : text(raw.active, "active", LIMITS.title),
    failed: raw.failed === undefined ? null : text(raw.failed, "failed", LIMITS.title),
    note: raw.note === undefined || raw.note === null ? null : text(raw.note, "note", LIMITS.note),
    state,
    start: agentInput(raw.start, "start", false),
    assign: agentInput(raw.assign, "assign", true),
    review: titles(raw.review, "review"),
    accept: acceptInput(raw.accept),
    rework: reworkInput(raw.rework),
    describe: describeInput(raw.describe),
  };
  const changes =
    op.stages !== null ||
    op.title !== null ||
    op.next ||
    op.done.length > 0 ||
    op.skipped.length > 0 ||
    op.active !== null ||
    op.failed !== null ||
    op.state !== null ||
    op.start.length > 0 ||
    op.assign.length > 0 ||
    op.review.length > 0 ||
    op.accept.length > 0 ||
    op.rework.length > 0 ||
    op.describe.length > 0;
  if (!changes) {
    throw new PlanError(
      "the op changes nothing: send stages to create the plan, or next, done, active, start, assign, review, accept, rework, describe, failed or state to move it",
    );
  }
  return op;
}

/** Reads an op sent as JSON text (the CLI argument). */
export function parseOpText(source: string): PlanOp {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new PlanError(`the op is not valid JSON (${error instanceof Error ? error.message : String(error)}); wrap it in single quotes`);
  }
  return parseOp(raw);
}

// ── Applying ops ─────────────────────────────────────────────────────────────

/** Step titles compare without case or extra spaces. */
export function titleKey(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function allSteps(plan: { stages: readonly { steps: readonly PlanStep[] }[] }): PlanStep[] {
  return plan.stages.flatMap((stage) => stage.steps);
}

/** The ticket's old code: the one sent, else the one its title starts or ends with, else null. Only for addressing, never shown. */
export function stepCode(step: Pick<PlanStep, "title" | "code" | "points" | "owner" | "criteria">): string | null {
  return step.code ?? ticketView(step).code;
}

const isOpen = (step: PlanStep) =>
  step.status === "pending" || step.status === "active" || step.status === "review" || step.status === "error";
const isFinished = (step: PlanStep) => step.status === "done" || step.status === "skipped";

function stepList(plan: Plan): string {
  const list = allSteps(plan).map((step) => `"${ticketView(step).name}"`);
  return list.join(", ");
}

/** The step with this title or code; with one used twice, the one still open. */
function findStep(plan: Plan, title: string): PlanStep {
  const key = titleKey(title);
  const steps = allSteps(plan);
  let matches = steps.filter((step) => titleKey(step.title) === key);
  // The title as the card shows it (codes cut off): what the owner and the lead read.
  if (matches.length === 0) matches = steps.filter((step) => titleKey(ticketView(step).name) === key);
  if (matches.length === 0) matches = steps.filter((step) => { const code = stepCode(step); return code !== null && titleKey(code) === key; });
  const step = matches.find(isOpen) ?? matches[0];
  if (step === undefined) {
    throw new PlanError(`plan "${plan.id}" has no step "${title}". Steps: ${stepList(plan)}`, "unknown_step");
  }
  return step;
}

/** Moves a step to a status and keeps its times and acceptance in step with it. */
function setStatus(step: PlanStep, status: StepStatus, now: number): void {
  const was = step.status;
  if (was !== "done" && status === "done") step.doneAt = now;
  if (status !== "done") {
    delete step.doneAt;
    delete step.accepted;
  }
  if (status === "active" || status === "review") step.startedAt ??= now;
  if (status === "review" && was !== "review") step.reviewAt = now;
  if (status === "pending") {
    delete step.startedAt;
    delete step.reviewAt;
  }
  step.status = status;
}

/** Makes the first open step after `from` current, wrapping to the first one left open. */
function activateAfter(steps: PlanStep[], from: number, now: number): void {
  const next =
    steps.slice(from + 1).find((step) => step.status === "pending" || step.status === "error") ??
    steps.find((step) => step.status === "pending" || step.status === "error");
  if (next !== undefined) setStatus(next, "active", now);
}

function advance(plan: Plan, now: number): void {
  const steps = allSteps(plan);
  let index = steps.findIndex((step) => step.status === "active");
  // No current step: the first one not finished, a failed one included, is the one closed.
  if (index < 0) index = steps.findIndex((step) => step.status === "pending" || step.status === "error");
  if (index < 0) return;
  setStatus(steps[index]!, "done", now);
  activateAfter(steps, index, now);
}

function buildStages(input: StageInput[], previous: Plan | null, restart: boolean, now: number): PlanStage[] {
  // Steps sent without a status keep what the plan already had under that title.
  const known = new Map<string, PlanStep[]>();
  if (previous !== null && !restart) {
    for (const step of allSteps(previous)) {
      const key = titleKey(step.title);
      known.set(key, [...(known.get(key) ?? []), step]);
    }
  }
  return input.map((stage) => ({
    name: stage.name,
    steps: stage.steps.map((sent) => {
      const kept = known.get(titleKey(sent.title))?.shift();
      const step: PlanStep = { title: sent.title, status: kept?.status ?? "pending" };
      // A ticket new to the plan is stamped now; a kept one keeps its stamp, or stays without one.
      if (kept === undefined) step.createdAt = now;
      // Read-only fields come from the plan as it was; the agent cannot set them.
      if (kept !== undefined) {
        for (const key of ["code", "agent", "points", "owner", "desc", "criteria", "accepted", "rework", "createdAt", "startedAt", "reworkAt", "reviewAt", "doneAt"] as const) {
          if (kept[key] !== undefined) (step as unknown as Record<string, unknown>)[key] = kept[key];
        }
      }
      if (sent.code !== undefined) step.code = sent.code;
      if (sent.agent !== undefined) step.agent = sent.agent;
      if (sent.points !== undefined) step.points = sent.points;
      if (sent.owner !== undefined) step.owner = sent.owner;
      if (sent.desc !== undefined) step.desc = sent.desc;
      if (sent.criteria !== undefined) step.criteria = sent.criteria;
      if (sent.status !== null && sent.status !== step.status) setStatus(step, sent.status, now);
      if (step.status === "done" && sent.accepted !== undefined) step.accepted = sent.accepted;
      if (step.accepted !== undefined && (step.criteria === undefined || step.accepted > step.criteria)) {
        throw new PlanError(`step "${step.title}": accepted needs criteria at least as large`);
      }
      return step;
    }),
  }));
}

function clonePlan(plan: Plan): Plan {
  return { ...plan, stages: plan.stages.map((stage) => ({ ...stage, steps: stage.steps.map((step) => ({ ...step })) })) };
}

function label(step: PlanStep): string {
  return `"${ticketView(step).name}"`;
}

/**
 * Applies one op to a thread's plans and returns the new list (most recently
 * updated last) with the plan it touched. The input list is not mutated, and a
 * refusal leaves it as it was.
 */
export function applyOp(plans: readonly Plan[], op: PlanOp, now: number): { plans: Plan[]; plan: Plan } {
  const index = plans.findIndex((plan) => plan.id === op.id);
  const previous = index >= 0 ? plans[index]! : null;
  let plan: Plan;

  if (op.stages !== null) {
    if (previous === null && op.title === null) throw new PlanError("a new plan needs a title");
    const restart = previous !== null && previous.state === "done" && op.stages.every((stage) => stage.steps.every((step) => step.status === null));
    plan = {
      id: op.id,
      title: op.title ?? previous!.title,
      stages: buildStages(op.stages, previous, restart, now),
      state: "running",
      note: null,
      startedAt: previous === null || restart ? now : previous.startedAt,
      updatedAt: now,
      finishedAt: null,
    };
    const steps = allSteps(plan);
    if (!steps.some((step) => step.status === "active" || step.status === "review")) {
      const first = steps.find((step) => step.status === "pending");
      if (first !== undefined) setStatus(first, "active", now);
    }
  } else {
    if (previous === null) {
      const ids = plans.map((item) => `"${item.id}"`).join(", ");
      throw new PlanError(
        `no plan "${op.id}" in this thread${ids === "" ? "" : ` (plans: ${ids})`}; create it first with {"id","title","stages"}`,
        "unknown_plan",
      );
    }
    plan = clonePlan(previous);
    if (op.title !== null) plan.title = op.title;
  }

  const steps = allSteps(plan);
  // Resolve every title before changing anything, so a refusal leaves the plan as it was.
  const doneSteps = op.done.map((title) => findStep(plan, title));
  const skippedSteps = op.skipped.map((title) => findStep(plan, title));
  const failedStep = op.failed === null ? null : findStep(plan, op.failed);
  const activeStep = op.active === null ? null : findStep(plan, op.active);
  const startSteps = op.start.map((item) => ({ step: findStep(plan, item.ticket), agent: item.agent }));
  const assignSteps = op.assign.map((item) => ({ step: findStep(plan, item.ticket), agent: item.agent }));
  const reviewSteps = op.review.map((title) => findStep(plan, title));
  const reworkSteps = op.rework.map((item) => ({ step: findStep(plan, item.ticket), note: item.note }));
  const acceptSteps = op.accept.map((item) => ({ ...item, step: findStep(plan, item.ticket) }));
  const describeSteps = op.describe.map((item) => ({ step: findStep(plan, item.ticket), desc: item.desc }));
  for (const { step } of reworkSteps) {
    if (step.status !== "review" && step.status !== "done") {
      throw new PlanError(`ticket ${label(step)} is ${step.status}; rework takes a ticket in review or done`);
    }
  }
  const acceptance = acceptSteps.map(({ step, confirmed, total }) => {
    const criteria = total ?? step.criteria ?? null;
    if (criteria === null) {
      throw new PlanError(
        `ticket ${label(step)} has no criteria; send {"ticket":"${step.title}","confirmed":n,"total":m}`,
      );
    }
    const accepted = confirmed ?? criteria;
    if (accepted > criteria) {
      throw new PlanError(`ticket ${label(step)}: confirmed (${accepted}) is more than its ${criteria} criteria`);
    }
    return { step, criteria, accepted };
  });

  for (const { step, desc } of describeSteps) {
    if (desc === null) delete step.desc;
    else step.desc = desc;
  }
  let closedCurrent = -1;
  for (const step of doneSteps) {
    if (step.status === "active") closedCurrent = Math.max(closedCurrent, steps.indexOf(step));
    setStatus(step, "done", now);
  }
  for (const step of skippedSteps) {
    if (step.status === "active") closedCurrent = Math.max(closedCurrent, steps.indexOf(step));
    setStatus(step, "skipped", now);
  }
  if (failedStep !== null) setStatus(failedStep, "error", now);
  for (const { step } of reworkSteps) {
    setStatus(step, "active", now);
    step.rework = (step.rework ?? 0) + 1;
    step.reworkAt = now;
  }
  for (const { step, agent } of startSteps) {
    setStatus(step, "active", now);
    if (agent !== null) step.agent = agent;
  }
  for (const { step, agent } of assignSteps) if (agent !== null) step.agent = agent;
  for (const step of reviewSteps) setStatus(step, "review", now);
  for (const { step, criteria, accepted } of acceptance) {
    setStatus(step, "done", now);
    step.criteria = criteria;
    step.accepted = accepted;
  }
  if (activeStep !== null) {
    // Steps that were current before this one count as done; pending and failed ones stay.
    for (const step of steps) if (step !== activeStep && step.status === "active") setStatus(step, "done", now);
    setStatus(activeStep, "active", now);
  } else if (op.next) {
    advance(plan, now);
  } else if (
    closedCurrent >= 0 &&
    failedStep === null &&
    startSteps.length === 0 &&
    !steps.some((step) => step.status === "active" || step.status === "review")
  ) {
    // Closing the current step moves on, as next does.
    activateAfter(steps, closedCurrent, now);
  }

  const previousState = previous?.state ?? null;
  plan.state =
    op.state ??
    (steps.every(isFinished) ? "done" : failedStep !== null ? "error" : "running");
  const reworkNotes = reworkSteps.filter((item) => item.note !== null).map((item) => `${ticketView(item.step).name}: ${item.note}`);
  plan.note = op.note ?? (reworkNotes.length > 0 ? reworkNotes.join("; ").slice(0, LIMITS.note) : null);
  plan.updatedAt = now;
  if (plan.state === "done") {
    plan.finishedAt = previousState === "done" && op.stages === null ? (plan.finishedAt ?? now) : now;
  } else {
    plan.finishedAt = null;
  }

  const rest = plans.filter((item) => item.id !== op.id);
  const next = [...rest, plan];
  while (next.length > LIMITS.plansPerThread) next.shift();
  return { plans: next, plan };
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface PlanProgress {
  /** Finished steps: done or skipped. */
  done: number;
  total: number;
  /** The step the card names: current, else failed, else in review, else the next one waiting. */
  current: PlanStep | null;
  /** Index of the stage holding `current`, -1 without one. */
  stageIndex: number;
}

export function progress(plan: Pick<Plan, "stages" | "state">): PlanProgress {
  const steps = allSteps(plan);
  const done = steps.filter(isFinished).length;
  const pick =
    steps.find((step) => step.status === "active") ??
    steps.find((step) => step.status === "error") ??
    steps.find((step) => step.status === "review") ??
    (plan.state === "done" ? null : steps.find((step) => step.status === "pending")) ??
    null;
  const stageIndex = pick === null ? -1 : plan.stages.findIndex((stage) => stage.steps.includes(pick));
  return { done, total: steps.length, current: pick, stageIndex };
}

/**
 * The plan the card shows: the most recently updated one that is still open,
 * or finished less than DONE_VISIBLE_MS ago. `hideInMs` says when a finished
 * one goes, measured on the server's clock.
 */
export function visiblePlan(
  plans: readonly Plan[],
  now: number,
  doneVisibleMs = DONE_VISIBLE_MS,
): { plan: Plan; hideInMs: number | null } | null {
  const latest = [...plans].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest === undefined) return null;
  if (latest.state !== "done") return { plan: latest, hideInMs: null };
  const left = (latest.finishedAt ?? latest.updatedAt) + doneVisibleMs - now;
  return left > 0 ? { plan: latest, hideInMs: left } : null;
}

/**
 * Whether the card is up: background work runs, or a plan is shown and, if
 * finished, not yet past its hide time (`hideAt`, browser clock; null while open).
 */
export function cardVisible(
  activityCount: number,
  shown: { hideAt: number | null } | null,
  now: number,
): boolean {
  return activityCount > 0 || planShown(shown, now);
}

export function planShown(shown: { hideAt: number | null } | null, now: number): boolean {
  return shown !== null && (shown.hideAt === null || now < shown.hideAt);
}

const STATUS_MARK: Record<StepStatus, string> = {
  pending: "[ ]",
  active: "[>]",
  review: "[?]",
  done: "[x]",
  error: "[!]",
  skipped: "[-]",
};

/** Who works on a ticket, by name («Неон»), for the agent's answers; null without one. */
export type AgentLabel = (step: PlanStep) => string | null;

/** Tickets by title (codes are never shown), each with its agent's name when known: «Масштаб щипком (Неон)». */
function names(list: PlanStep[], agentLabel?: AgentLabel): string {
  return list
    .map((step) => {
      const who = agentLabel?.(step) ?? null;
      return who === null ? ticketView(step).name : `${ticketView(step).name} (${who})`;
    })
    .join(", ");
}

/**
 * One line for the agent: `done/total, state, active steps · review · accepted`.
 * A plan moved with the old ops only reads exactly as before.
 */
export function summary(plan: Plan, now = plan.updatedAt, agentLabel?: AgentLabel): string {
  const { done, total, current } = progress(plan);
  const parts = [`${plan.id}: ${done}/${total}`, plan.state];
  const steps = allSteps(plan);
  const active = steps.filter((step) => step.status === "active");
  const review = steps.filter((step) => step.status === "review");
  const segments: string[] = [];
  if (active.length > 0) segments.push(`active: ${names(active, agentLabel)}`);
  else if (current !== null && current.status === "error") segments.push(`failed: ${ticketView(current).name}`);
  else if (current !== null && current.status === "pending") segments.push(`active: ${ticketView(current).name}`);
  if (review.length > 0) segments.push(`review: ${names(review, agentLabel)}`);
  const accepted = planMetrics(plan, now).acceptance;
  if (accepted !== null) segments.push(`accepted ${percent(accepted)}%`);
  if (segments.length > 0) parts.push(segments.join(" · "));
  if (plan.note !== null) parts.push(`note: ${plan.note}`);
  return parts.join(", ");
}

function stepExtras(step: PlanStep, agentLabel?: AgentLabel): string {
  const extras: string[] = [];
  const who = agentLabel?.(step) ?? null;
  if (who !== null) extras.push(who);
  if (step.points !== undefined) extras.push(`${step.points} pt`);
  if (step.owner !== undefined) extras.push(step.owner);
  if (step.accepted !== undefined && step.criteria !== undefined) extras.push(`accepted ${step.accepted}/${step.criteria}`);
  else if (step.criteria !== undefined) extras.push(`${step.criteria} criteria`);
  if (step.rework !== undefined && step.rework > 0) extras.push(`rework ${step.rework}`);
  return extras.length === 0 ? "" : ` (${extras.join(", ")})`;
}

/**
 * The plan as a checklist with its metrics line, for `plan show`; "Волна"
 * names read "Очередь". `full` adds each ticket's `desc` on its own line.
 */
export function describe(plan: Plan, now = Date.now(), full = false, agentLabel?: AgentLabel): string {
  const lines = [`${queueName(plan.title)} (${summary(plan, now, agentLabel)})`, `  ${metricsLine(plan, now)}`];
  for (const stage of plan.stages) {
    if (stage.name !== "") lines.push(`  ${queueName(stage.name)}`);
    const indent = stage.name === "" ? "  " : "    ";
    for (const step of stage.steps) {
      lines.push(`${indent}${STATUS_MARK[step.status]} ${ticketView(step).name}${stepExtras(step, agentLabel)}`);
      if (full && step.desc !== undefined) lines.push(`${indent}    ${step.desc}`);
    }
  }
  return lines.join("\n");
}

/** `Metrics: progress 40% · accepted 92% · ...`; a figure without data reads n/a. */
export function metricsLine(plan: Plan, now: number): string {
  const m = planMetrics(plan, now);
  const pct = (value: number | null) => (value === null ? "n/a" : `${percent(value)}%`);
  const minutes = (ms: number | null) => (ms === null ? "n/a" : duration(ms));
  return [
    `Metrics: progress ${pct(m.progress)}`,
    `accepted ${pct(m.acceptance)}`,
    `velocity ${m.velocity === null ? "n/a" : `${rate(m.velocity)} pt/h`}`,
    `ETA ${minutes(m.etaMs)}`,
    `cycle ${minutes(m.cycleMs)}`,
    `first-pass ${pct(m.firstPass)}`,
    `WIP ${m.wip}`,
  ].join(" · ");
}

/**
 * A plan with its figures, for `plan show --json`: `metrics` on the plan and on
 * every stage, and the names the card prints (`displayTitle`, `displayName`:
 * "Волна" reads "Очередь") next to the stored ones.
 */
export function withMetrics(
  plan: Plan,
  now: number,
): Plan & { displayTitle: string; metrics: Metrics; stages: (PlanStage & { displayName: string; metrics: StageMetrics })[] } {
  return {
    ...plan,
    displayTitle: queueName(plan.title),
    stages: plan.stages.map((stage) => ({ ...stage, displayName: queueName(stage.name), metrics: stageMetrics(stage) })),
    metrics: planMetrics(plan, now),
  };
}

const STORED_NUMBERS = ["points", "criteria", "accepted", "rework", "createdAt", "startedAt", "reworkAt", "reviewAt", "doneAt"] as const;

/** Stored plans read loosely: anything malformed is dropped, never thrown. */
export function readStored(value: unknown): Plan[] {
  if (!isRecord(value) || !Array.isArray(value.plans)) return [];
  const plans: Plan[] = [];
  for (const raw of value.plans) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string" || !Array.isArray(raw.stages)) continue;
    const stages: PlanStage[] = [];
    for (const stage of raw.stages) {
      if (!isRecord(stage) || !Array.isArray(stage.steps)) continue;
      const steps: PlanStep[] = [];
      for (const item of stage.steps) {
        if (!isRecord(item) || typeof item.title !== "string" || !STEP_STATUSES.includes(item.status as StepStatus)) continue;
        const step: PlanStep = { title: item.title, status: item.status as StepStatus };
        if (typeof item.code === "string") step.code = item.code;
        if (typeof item.agent === "string") step.agent = item.agent;
        if (typeof item.owner === "string") step.owner = item.owner;
        if (typeof item.desc === "string") step.desc = item.desc;
        for (const key of STORED_NUMBERS) {
          const v = item[key];
          if (typeof v === "number" && Number.isFinite(v)) step[key] = v;
        }
        steps.push(step);
      }
      stages.push({ name: typeof stage.name === "string" ? stage.name : "", steps });
    }
    const state = typeof raw.state === "string" ? STATE_ALIASES[raw.state] : undefined;
    const time = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    plans.push({
      id: raw.id,
      title: raw.title,
      stages,
      state: state ?? "running",
      note: typeof raw.note === "string" ? raw.note : null,
      startedAt: time(raw.startedAt) ?? 0,
      updatedAt: time(raw.updatedAt) ?? 0,
      finishedAt: time(raw.finishedAt),
    });
  }
  return plans;
}
