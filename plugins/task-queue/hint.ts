// Words for the plan card: hover hints, times and the agents tied to tickets.
// Pure functions over the dictionary in i18n.ts (every phrase comes from
// there); no SDK imports, so tests run them with `node --test`. Each takes the
// language last; it defaults to Russian, the language these helpers had first.
import { stepCode, type Plan, type PlanStage, type PlanStep } from "./plan.ts";
import { ownerLabel, ticketView } from "./format.ts";
import { stripCodes } from "./agent-names.ts";
import { agentDisplayName, duration, plural, t, type Lang } from "./i18n.ts";

export { plural };

/** "45 с", "12 мин", "1 ч 05 мин" (Russian); see `duration` for both languages. */
export function ruDuration(ms: number): string {
  return duration(ms, "ru");
}

/** "Opus 5.5", "ведущий (Fable 5.2)" / "the lead (Fable 5.2)", "ведущий" / "the lead". */
export function ownerRu(owner: string, lang: Lang = "ru"): string {
  const label = ownerLabel(owner);
  if (label === "Lead") return t(lang).lead(null);
  if (label.startsWith("Lead: ")) return t(lang).lead(label.slice(6));
  return label;
}

/** What a background agent or command is busy with, as the card reads it. */
export interface Busy {
  kind: "agent" | "command" | "other";
  title: string;
  command: string | null;
  running: { label: string; text: string; icon: string | null; tool?: string }[];
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** "думает" / "thinking", "выполняет команду npm test" / "running npm test", "вызывает Read" / "calling Read". */
export function nowDoing(item: Busy, lang: Lang = "ru"): string {
  const d = t(lang);
  if (item.kind !== "agent") return d.nowRunningCommand(item.command === null ? null : clip(item.command, 60));
  const first = item.running[0];
  if (first === undefined) return d.nowThinking;
  if (first.tool === "Bash" || first.icon === "Terminal") return d.nowRunningCommand(first.text === "" ? null : clip(first.text, 60));
  return d.nowCalling(first.tool ?? first.label, first.text === "" ? null : clip(first.text, 40));
}

/** "959k", "1.2k", "950". */
function compact(value: number): string {
  if (value < 1000) return String(value);
  const k = value / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/** "12 мин · 959k токенов" / "12 min · 959k tokens": time and spend, no call count. */
export function spendLine(item: { startedAt: number | null; tokens: number | null }, now: number, lang: Lang = "ru"): string {
  const parts: string[] = [];
  if (item.startedAt !== null) parts.push(duration(now - item.startedAt, lang));
  if (item.tokens !== null) parts.push(t(lang).tokens(item.tokens, compact(item.tokens)));
  return parts.join(" · ");
}

export const THINKING_LINE = t("ru").thinkingLine;

/** «Ещё работают без тикета: Шифр (Замер), команда npm test» — for the plan state hint; null when none. */
export function unlinkedLine(items: readonly (Busy & { name?: string | null })[], lang: Lang = "ru"): string | null {
  const d = t(lang);
  const parts = items.map((item) =>
    item.kind === "agent"
      ? item.name ? `${agentDisplayName(item.name, lang)} (${stripCodes(item.title)})` : stripCodes(item.title)
      : d.unlinkedCommand(item.command === null ? null : clip(item.command, 40)),
  );
  return parts.length === 0 ? null : d.unlinked(parts);
}

export interface TicketHint {
  /** The description, or the full title. */
  title: string;
  /** State and times in words. */
  state: string;
  /** "Сейчас: думает", only with an agent on a ticket in work. */
  now: string | null;
}

/**
 * The hover text of a ticket row. `waiting`: the plan waits for the owner.
 * Times come from the stamps the plan keeps; a stamp that is missing (old
 * tickets have no createdAt) leaves its phrase out.
 */
export function ticketHint(
  step: PlanStep,
  context: { now: number; waiting: boolean; agent?: Busy | null; lang?: Lang },
): TicketHint {
  const { now } = context;
  const lang = context.lang ?? "ru";
  const d = t(lang);
  const span = (ms: number) => duration(ms, lang);
  const view = ticketView(step);
  const who = view.owner === undefined ? null : d.owner(ownerRu(view.owner, lang));
  const reworks = step.rework ?? 0;
  const parts: string[] = [];
  // Under a second reads as noise ("ждал 0 с"): such a span is left out.
  const queued =
    step.createdAt !== undefined && step.startedAt !== undefined && step.startedAt - step.createdAt >= 1000 ? step.startedAt - step.createdAt : null;
  const worked = (until: number | undefined) =>
    step.startedAt !== undefined && until !== undefined && until - step.startedAt >= 1000 ? span(until - step.startedAt) : null;

  switch (step.status) {
    case "pending":
      parts.push(d.queuedFor(step.createdAt === undefined ? null : span(now - step.createdAt)));
      if (who !== null) parts.push(who);
      break;
    case "active": {
      const inWork = worked(now);
      if (context.waiting) {
        parts.push(d.waitingOwner);
        if (inWork !== null) parts.push(d.inWorkFor(inWork));
      } else if (reworks > 0) {
        parts.push(d.reworked(reworks, step.reworkAt === undefined ? null : span(now - step.reworkAt)));
        if (inWork !== null) parts.push(d.totalInWork(inWork));
      } else {
        parts.push(d.inWork(inWork));
        if (queued !== null) parts.push(d.queuedBefore(span(queued)));
      }
      if (who !== null) parts.push(who);
      break;
    }
    case "review": {
      parts.push(d.handedIn(step.reviewAt === undefined ? null : span(now - step.reviewAt)));
      const took = worked(step.reviewAt);
      if (took !== null) parts.push(d.took(took));
      if (reworks > 0) parts.push(d.returned(reworks));
      if (who !== null) parts.push(who);
      break;
    }
    case "done": {
      const accepted = step.accepted !== undefined && step.criteria !== undefined;
      parts.push(accepted ? d.accepted : d.finished);
      const took = worked(step.doneAt);
      if (took !== null) parts.push(d.took(took));
      if (accepted) parts.push(d.confirmed(step.accepted!, step.criteria!));
      if (reworks > 0) parts.push(d.returned(reworks));
      if (who !== null) parts.push(who);
      break;
    }
    case "error":
      parts.push(d.failedStep);
      if (who !== null) parts.push(who);
      break;
    case "skipped":
      parts.push(d.skippedStep);
      break;
  }
  const busy = step.status === "active" && context.agent != null ? d.nowPrefix(nowDoing(context.agent, lang)) : null;
  return { title: step.desc ?? step.title, state: parts.join(" · "), now: busy };
}

function acceptanceCounts(steps: readonly PlanStep[]): { confirmed: number; criteria: number } {
  let confirmed = 0;
  let criteria = 0;
  for (const step of steps) {
    if (step.status !== "done" || step.accepted === undefined || step.criteria === undefined) continue;
    confirmed += step.accepted;
    criteria += step.criteria;
  }
  return { confirmed, criteria };
}

/** "Готово 3 из 5 тикетов, приёмка 92%" / "3 of 5 tickets done, 92% accepted". */
export function epicHint(stage: Pick<PlanStage, "steps">, lang: Lang = "ru"): string {
  const finished = stage.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const { confirmed, criteria } = acceptanceCounts(stage.steps);
  return criteria > 0
    ? t(lang).doneOfWithAcceptance(finished, stage.steps.length, Math.round((confirmed / criteria) * 100))
    : t(lang).doneOf(finished, stage.steps.length);
}

const clock = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Hints of the plan row's pills. */
export function planHints(plan: Pick<Plan, "stages" | "state" | "startedAt" | "finishedAt">, now: number, lang: Lang = "ru") {
  const d = t(lang);
  const steps = plan.stages.flatMap((stage) => stage.steps);
  const finished = steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const { confirmed, criteria } = acceptanceCounts(steps);
  const end = plan.state === "done" && plan.finishedAt !== null ? plan.finishedAt : now;
  const spent = duration(end - plan.startedAt, lang);
  return {
    state: d.planState[plan.state],
    count: d.doneOf(finished, steps.length),
    time: plan.state === "done" ? d.planTook(spent, clock(plan.startedAt)) : d.planRunning(spent, clock(plan.startedAt)),
    eta: (etaMs: number) => d.eta(duration(etaMs, lang)),
    acceptance: criteria === 0 ? null : d.acceptanceHint(Math.round((confirmed / criteria) * 100), confirmed, criteria),
  };
}

/** The closed header's second half: the ticket in work, or "3 тикета в работе". */
export function headerCurrent(plan: Pick<Plan, "stages" | "state">, current: PlanStep | null, lang: Lang = "ru"): string {
  const steps = plan.stages.flatMap((stage) => stage.steps);
  const active = steps.filter((step) => step.status === "active");
  if (active.length > 1) return t(lang).ticketsInWork(active.length);
  return current === null ? "" : ticketView(current).name;
}

/** "UX SM · Крестик" -> ["UX", "SM"]: the ticket codes an agent's name starts with. */
export function agentCodes(title: string): string[] {
  const match = /^((?:[A-Z][A-Z0-9]{1,3})(?:[ ,]+[A-Z][A-Z0-9]{1,3})*)\s*[·:—–-]\s*\S/.exec(title.trim());
  return match === null ? [] : match[1]!.split(/[ ,]+/).filter((code) => code !== "");
}

/** Agent names compare without case and extra spaces. */
const agentKey = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/**
 * Ties background agents to tickets in work or review, in this order:
 * 1) the ticket's `agent` (set by `start`/`assign`) equals the agent's or the
 *    background command's description as given at launch, or its id (one
 *    agent may do several tickets);
 * 2) an old-style agent name starting with the ticket's code ("UX · Крестик");
 * 3) exactly one ticket in work without an agent and exactly one agent left:
 *    that agent is the ticket's.
 * Codes and the last rule tie agents only. Whatever is left over is `unlinked`.
 */
export function linkAgents<T extends Busy & { id?: string }>(
  plan: Pick<Plan, "stages">,
  items: readonly T[],
): { byTicket: Map<PlanStep, T[]>; unlinked: T[] } {
  const steps = plan.stages.flatMap((stage) => stage.steps);
  const open = steps.filter((step) => step.status === "active" || step.status === "review");
  const byTicket = new Map<PlanStep, T[]>();
  const add = (step: PlanStep, item: T) => byTicket.set(step, [...(byTicket.get(step) ?? []), item]);
  const linked = new Set<T>();
  for (const item of items) {
    if (item.kind === "other") continue;
    const keys = [agentKey(item.title), agentKey(stripCodes(item.title)), ...(item.id === undefined ? [] : [agentKey(item.id)])];
    for (const step of open) {
      if (step.agent !== undefined && keys.includes(agentKey(step.agent))) {
        add(step, item);
        linked.add(item);
      }
    }
  }
  for (const item of items) {
    if (linked.has(item)) continue;
    const codes = item.kind === "agent" ? agentCodes(item.title).map((code) => code.toLowerCase()) : [];
    const matched = open.filter((step) => {
      if (step.agent !== undefined) return false;
      const code = stepCode(step);
      return code !== null && codes.includes(code.toLowerCase());
    });
    for (const step of matched) add(step, item);
    if (matched.length > 0) linked.add(item);
  }
  const free = steps.filter((step) => step.status === "active" && step.agent === undefined && !byTicket.has(step));
  const left = items.filter((item) => item.kind === "agent" && !linked.has(item));
  if (free.length === 1 && left.length === 1 && [...byTicket.keys()].every((step) => step.agent !== undefined)) {
    add(free[0]!, left[0]!);
    linked.add(left[0]!);
  }
  return { byTicket, unlinked: items.filter((item) => !linked.has(item)) };
}
