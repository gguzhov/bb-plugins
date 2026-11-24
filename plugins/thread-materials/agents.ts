// Executors of a thread (built-in subagents and child threads), derived from
// the thread's event history. Pure: no SDK imports, so tests run it directly.

import { dict, pluralRu, type Lang } from "./i18n.ts";

export type ExecutorState = "running" | "done" | "error" | "stopped";
/** What a running agent does right now: the latest tool call inside it. kind: command, read, edit, search, web, tool, think, agent. */
export type Action = { kind: string; detail: string; at: number };
/** actual: reported by the run itself; requested: the `model` passed at launch; inherited: nothing passed, the leader's model. */
export type ModelSource = "actual" | "requested" | "inherited";

export type Executor = {
 /** Leader's model when this executor was launched (for an inherited model). */
 leaderModel?: string | null;
 id: string;
 title: string;
 kind: "subagent" | "thread";
 state: ExecutorState;
 threadId: string | null;
 /** Raw model id or alias as found in the data; null when nothing names one. */
 model: string | null;
 modelSource: ModelSource;
 startedAt: number | null;
 endedAt: number | null;
 /** Start of the run in progress, for a live timer. */
 activeSince: number | null;
 /** Time spent in finished runs. */
 durationMs: number | null;
 toolUses: number | null;
 tokens: number | null;
 summary: string | null;
 /** Seq of the message just before the launch: what a `#msg=` link can address. */
 launchSeq?: number | null;
 agentType: string | null;
 /** Human name by launch order («Неон» is the first launched), set by the server; same as in task-queue's card. */
 name?: string;
 ordinal?: number;
 /** Latest tool call inside a running agent (not stored: rebuilt from the live event stream). */
 action?: Action | null;
};

type Delegation = { seq?: number; leaderModel?: string; id: string; label: string; detail: string; childRef: string; status: string; summary?: string; model?: string; createdAt: number; endedAt?: number; nested: boolean };
type Usage = { totalTokens: number; toolUses: number; durationMs: number };
type Run = { seq?: number; id: string; familyId: string; parent: string; description: string; status: string; startedAt: number; endedAt?: number; usage?: Usage; summary?: string; model?: string };
export type AgentLog = { version: 1; /** Seq of the latest message (reply or user request) seen so far. */ lastMsgSeq?: number; /** Set once launch seqs are recorded; older logs are re-read. */ msgAnchors?: true; lastSeq: number; leaderModel?: string; delegations: Record<string, Delegation>; runs: Record<string, Run> };
export type ThreadEvent = { seq: number | string; type: string; createdAt?: number | string; data?: unknown };

export const AGENT_EVENT_TYPES = ["client/turn/requested", "item/started", "item/completed", "item/backgroundTask/progress", "item/backgroundTask/completed", "item/delegation/completed", "item/delegation/progress"] as const;
export const emptyLog = (): AgentLog => ({ version: 1, msgAnchors: true, lastSeq: 0, delegations: {}, runs: {} });

const SUMMARY_MAX = 2000;
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clip = (s: string | null | undefined) => (s ? (s.length > SUMMARY_MAX ? s.slice(0, SUMMARY_MAX - 1) + "…" : s) : undefined);
/** Claude Code answers an async launch at once with this notice; it is not the agent's result. */
const LAUNCH_NOTICE = /^Async agent launched/i;

function usageOf(v: unknown): Usage | undefined {
 const u = rec(v);
 if (!u) return undefined;
 const totalTokens = num(u.totalTokens), toolUses = num(u.toolUses), durationMs = num(u.durationMs);
 if (totalTokens === null && toolUses === null && durationMs === null) return undefined;
 return { totalTokens: totalTokens ?? 0, toolUses: toolUses ?? 0, durationMs: durationMs ?? 0 };
}

/** Folds new events into the log. Events at or below `lastSeq` are ignored, so a re-read never double counts. */
export function applyEvents(log: AgentLog, events: readonly ThreadEvent[]): AgentLog {
 for (const event of events) {
  const seq = Number(event.seq);
  if (!Number.isFinite(seq) || seq <= log.lastSeq) continue;
  log.lastSeq = seq;
  if (event.type === "client/turn/requested") { log.lastMsgSeq = seq; const m = str(rec(rec(event.data)?.execution)?.model); if (m) log.leaderModel = m; continue; }
  const item = rec(rec(event.data)?.item);
  if (!item) continue;
  const at = Number(event.createdAt) || 0;
  if (item.type === "agentMessage" && event.type === "item/completed") log.lastMsgSeq = seq;
  const id = str(item.id);
  if (!id) continue;
  if (item.type === "delegation") {
   const prev = log.delegations[id];
   const presentation = rec(item.presentation);
   const status = str(item.status) ?? prev?.status ?? "pending";
   const summary = str(item.summary);
   const model = str(item.model) ?? prev?.model;
   log.delegations[id] = {
    seq: prev?.seq ?? log.lastMsgSeq ?? seq,
    id,
    label: prev?.label ?? str(item.label) ?? str(presentation?.title) ?? "Субагент",
    detail: str(presentation?.detail) ?? prev?.detail ?? "",
    childRef: str(item.childRef) ?? prev?.childRef ?? "",
    status,
    ...(summary && !LAUNCH_NOTICE.test(summary) ? { summary: clip(summary) } : prev?.summary ? { summary: prev.summary } : {}),
    ...(model ? { model } : {}),
    createdAt: prev?.createdAt ?? at,
    ...(status !== "pending" ? { endedAt: prev?.endedAt ?? at } : {}),
    nested: prev?.nested ?? !!str(item.parentToolCallId),
    ...((prev?.leaderModel ?? log.leaderModel) ? { leaderModel: prev?.leaderModel ?? log.leaderModel } : {}),
   };
   continue;
  }
  if (item.type === "backgroundTask" && /agent/i.test(str(item.taskType) ?? "")) {
   const prev = log.runs[id];
   const familyId = str(item.familyId) ?? prev?.familyId ?? id;
   const taskStatus = str(item.taskStatus) ?? prev?.status ?? "running";
   const finished = !/^(running|pending)$/.test(taskStatus);
   const summary = str(item.summary);
   const model = str(item.model) ?? prev?.model;
   log.runs[id] = {
    seq: prev?.seq ?? log.lastMsgSeq ?? seq,
    id,
    familyId,
    parent: str(item.parentToolCallId) ?? prev?.parent ?? "",
    description: str(item.description) ?? prev?.description ?? "Субагент",
    status: taskStatus,
    startedAt: prev?.startedAt ?? at,
    ...(finished ? { endedAt: prev?.endedAt ?? at } : {}),
    ...((usageOf(item.usage) ?? prev?.usage) ? { usage: usageOf(item.usage) ?? prev!.usage } : {}),
    ...((clip(summary) ?? prev?.summary) ? { summary: clip(summary) ?? prev!.summary } : {}),
    ...(model ? { model } : {}),
   };
  }
 }
 return log;
}

const RUN_STATE: Record<string, ExecutorState> = { running: "running", pending: "running", completed: "done", failed: "error", killed: "stopped", stopped: "stopped", paused: "stopped" };
const DELEGATION_STATE: Record<string, ExecutorState> = { pending: "running", completed: "done", failed: "error", interrupted: "stopped" };

/** `general-purpose agent · model sonnet` -> { agentType: "general-purpose", model: "sonnet" }. */
export function parseDetail(detail: string): { agentType: string | null; model: string | null } {
 const model = /(?:^|·)\s*model\s+([^\s·]+)/i.exec(detail)?.[1] ?? null;
 const agentType = /^\s*([^·]+?)\s+agent\b/i.exec(detail)?.[1] ?? null;
 return { agentType, model };
}

/**
 * One executor per agent: runs that share a familyId (a launch and its
 * SendMessage resumes) are one row. `activeRunIds`, when given, is the set of
 * background runs bb reports alive right now; a run still marked running but
 * absent from it was cut off (bb restart, thread stop) and reads as stopped.
 */
export function deriveSubagents(log: AgentLog, activeRunIds?: ReadonlySet<string>, actions?: Readonly<Record<string, Action>>): Executor[] {
 const byFamily = new Map<string, Run[]>();
 const nested = new Set(Object.values(log.delegations).filter(d => d.nested).map(d => d.id));
 for (const run of Object.values(log.runs)) {
  if (nested.has(run.parent)) continue;
  const list = byFamily.get(run.familyId) ?? [];
  list.push(run);
  byFamily.set(run.familyId, list);
 }
 const linked = new Set<string>();
 const out: Executor[] = [];
 for (const [familyId, runs] of byFamily) {
  runs.sort((a, b) => a.startedAt - b.startedAt);
  const launch = runs.map(r => log.delegations[r.parent]).find(Boolean);
  runs.forEach(r => linked.add(r.parent));
  const last = runs[runs.length - 1];
  let state = RUN_STATE[last.status] ?? "running";
  if (state === "running" && activeRunIds && !activeRunIds.has(last.id) && !activeRunIds.has(familyId)) state = "stopped";
  const done = runs.filter(r => r.endedAt !== undefined);
  const durationMs = done.length ? done.reduce((s, r) => s + (r.usage?.durationMs || Math.max(0, (r.endedAt ?? r.startedAt) - r.startedAt)), 0) : null;
  const toolUses = runs.some(r => r.usage) ? runs.reduce((s, r) => s + (r.usage?.toolUses ?? 0), 0) : null;
  const tokens = runs.some(r => r.usage) ? Math.max(...runs.map(r => r.usage?.totalTokens ?? 0)) : null;
  const detail = parseDetail(launch?.detail ?? "");
  const actual = [...runs].reverse().find(r => r.model)?.model ?? launch?.model ?? null;
  const summary = [...runs].reverse().find(r => r.summary)?.summary ?? launch?.summary ?? null;
  out.push({
   leaderModel: launch?.leaderModel ?? null,
   id: "agent:" + familyId,
   title: launch?.label ?? last.description,
   kind: "subagent",
   state,
   threadId: null,
   model: actual ?? detail.model,
   modelSource: actual ? "actual" : detail.model ? "requested" : "inherited",
   startedAt: runs[0].startedAt || null,
   endedAt: state === "running" ? null : (last.endedAt ?? null),
   activeSince: state === "running" ? last.startedAt : null,
   durationMs,
   toolUses,
   tokens,
   summary,
   launchSeq: launch?.seq ?? runs[0].seq ?? null,
   agentType: detail.agentType,
   ...(state === "running" && actions?.[last.parent] ? { action: actions[last.parent] } : {}),
  });
 }
 // Foreground launches and providers without background runs: the delegation is the run.
 for (const d of Object.values(log.delegations)) {
  if (d.nested || linked.has(d.id)) continue;
  const detail = parseDetail(d.detail);
  const state = DELEGATION_STATE[d.status] ?? "running";
  const childThread = /^thr_[a-z0-9]+$/.test(d.childRef) ? d.childRef : null;
  out.push({
   leaderModel: d.leaderModel ?? null,
   id: childThread ? childThread : "delegation:" + d.id,
   title: d.label,
   kind: childThread ? "thread" : "subagent",
   state,
   threadId: childThread,
   model: d.model ?? detail.model,
   modelSource: d.model ? "actual" : detail.model ? "requested" : "inherited",
   startedAt: d.createdAt || null,
   endedAt: state === "running" ? null : (d.endedAt ?? null),
   activeSince: state === "running" ? d.createdAt : null,
   durationMs: d.endedAt !== undefined ? Math.max(0, d.endedAt - d.createdAt) : null,
   toolUses: null,
   tokens: null,
   summary: d.summary ?? null,
   launchSeq: d.seq ?? null,
   agentType: detail.agentType,
   ...(state === "running" && actions?.[d.id] ? { action: actions[d.id] } : {}),
  });
 }
 return out;
}

/** Running first (newest start first), then finished by end time, newest first. */
export function sortExecutors(list: Executor[]): Executor[] {
 const running = list.filter(x => x.state === "running").sort((a, b) => (b.activeSince ?? b.startedAt ?? 0) - (a.activeSince ?? a.startedAt ?? 0));
 const rest = list.filter(x => x.state !== "running").sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0));
 return [...running, ...rest];
}

/** How many executors are in each state. Stopped is counted apart: it is neither done nor an error. */
export type ExecutorCounts = Record<ExecutorState, number> & { total: number };
export function executorCounts(list: readonly Pick<Executor, "state">[]): ExecutorCounts {
 const c: ExecutorCounts = { running: 0, done: 0, error: 0, stopped: 0, total: 0 };
 for (const x of list) { if (x.state in c) c[x.state]++; c.total++; }
 return c;
}

export type SummaryPart = { state: ExecutorState; text: string };
/**
 * The one-line tally over the executors. `short` (collapsed chip): "2 в работе", "5 готово"; `long` (top of the open section): "В работе 2", "Готово 5".
 * Parts with a zero are left out; the error part is flagged by its state so the UI can colour it.
 */
export function executorSummary(counts: ExecutorCounts, lang: Lang = "ru", form: "short" | "long" = "short"): SummaryPart[] {
 const t = dict(lang);
 const f = form === "short" ? t.summaryShort : t.summaryLong;
 const out: SummaryPart[] = [];
 for (const state of ["running", "done", "error", "stopped"] as const) if (counts[state] > 0) out.push({ state, text: f[state](counts[state]) });
 return out;
}

// ---------- presentation ----------

/** The one place model ids and launch aliases become human names. */
export const MODEL_NAMES: Readonly<Record<string, string>> = {
 "claude-opus-5-5": "Opus 5.5", opus: "Opus 5.5",
 "claude-sonnet-5-5": "Sonnet 5.5", sonnet: "Sonnet 5.5",
 "claude-haiku-5-5": "Haiku 5.5", haiku: "Haiku 5.5",
 "claude-fable-5-2": "Fable 5.2", fable: "Fable 5.2",
};

/** Human model name; an unknown id is returned as is. */
export function modelLabel(id: string): string {
 const key = id.trim().toLowerCase().replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
 return MODEL_NAMES[key] ?? id.trim();
}

export type ModelView = { label: string; source: ModelSource; hint: string | null; inherited: boolean };
/** actual -> requested -> "same as lead (<leader>)". */
export function resolveModel(x: Pick<Executor, "model" | "modelSource" | "leaderModel">, currentLeader: string | null, lang: Lang = "ru"): ModelView | null {
 const t = dict(lang);
 const leaderModel = x.leaderModel ?? currentLeader;
 if (x.model && x.modelSource === "actual") return { label: modelLabel(x.model), source: "actual", hint: t.modelActual(x.model), inherited: false };
 if (x.model && x.modelSource === "requested") return { label: modelLabel(x.model), source: "requested", hint: t.modelRequested(x.model), inherited: false };
 if (!leaderModel) return null;
 return { label: t.asLeader(modelLabel(leaderModel)), source: "inherited", hint: t.modelInherited, inherited: true };
}

const plural = pluralRu;

/** 42_000 -> "42 с" / "42 s", 4 min -> "4 мин" / "4 min", 65 min -> "1 ч 5 мин" / "1 h 5 min". */
export function formatDuration(ms: number, lang: Lang = "ru"): string {
 const [sec, min, hr] = lang === "ru" ? ["с", "мин", "ч"] : ["s", "min", "h"];
 const s = Math.max(0, Math.round(ms / 1000));
 if (s < 60) return s + " " + sec;
 const m = Math.floor(s / 60);
 if (m < 60) return m + " " + min;
 const h = Math.floor(m / 60), rest = m % 60;
 return rest ? `${h} ${hr} ${rest} ${min}` : `${h} ${hr}`;
}

/** Live timer: 65_000 -> "1:05", 3_725_000 -> "1:02:05". */
export function formatClock(ms: number): string {
 const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
 const pad = (n: number) => String(n).padStart(2, "0");
 return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** 950 -> "950 токенов" / "950 tokens", 1234 -> "1.2k …", 120400 -> "120k …", 1.25M -> "1.3M …". */
export function formatTokens(n: number, lang: Lang = "ru"): string {
 const word = (k: number) => lang === "ru" ? plural(k, "токен", "токена", "токенов") : k === 1 ? "token" : "tokens";
 if (n < 1000) return n + " " + word(n);
 if (n < 1_000_000) { const k = n / 1000; return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + "k " + word(5); }
 return Math.round(n / 100_000) / 10 + "M " + word(5);
}

export const formatCalls = (n: number, lang: Lang = "ru") => n + " " + (lang === "ru" ? plural(n, "вызов", "вызова", "вызовов") : n === 1 ? "tool call" : "tool calls");

/** Time spent so far: finished runs plus the run in progress. */
export function elapsedMs(x: Pick<Executor, "state" | "activeSince" | "durationMs" | "startedAt" | "kind">, now: number): number | null {
 const since = x.state === "running" ? (x.activeSince ?? (x.kind === "thread" ? x.startedAt : null)) : null;
 const live = since ? Math.max(0, now - since) : 0;
 if (x.durationMs === null && !since) return null;
 return (x.durationMs ?? 0) + live;
}

/** Parts of the muted line under the title; missing data is left out. */
export function metaParts(x: Executor, now: number, lang: Lang = "ru"): string[] {
 const parts: string[] = [];
 const live = x.state === "running" && x.activeSince ? Math.max(0, now - x.activeSince) : 0;
 const total = (x.durationMs ?? 0) + live;
 if (x.durationMs !== null || live > 0) parts.push(formatDuration(total, lang));
 if (x.tokens !== null && x.tokens > 0) parts.push(formatTokens(x.tokens, lang));
 return parts;
}

/** "Running · npm test" for the row of a running agent; null when nothing is known yet. */
export function actionText(action: Action | null | undefined, lang: Lang = "ru"): string | null {
 if (!action) return null;
 const verb = dict(lang).action[action.kind] ?? dict(lang).action.tool;
 return action.detail ? verb + " · " + action.detail : verb;
}

/**
 * The latest tool call of each running agent, keyed by the launch (delegation) id: the nested items an agent
 * starts carry its launch id as parentToolCallId. Kept in memory only, since it matters only while an agent runs.
 */
export function applyActions(actions: Record<string, Action>, events: readonly ThreadEvent[]): Record<string, Action> {
 for (const event of events) {
  if (event.type !== "item/started") continue;
  const item = rec(rec(event.data)?.item);
  const parent = item && str(item.parentToolCallId);
  if (!item || !parent) continue;
  const action = actionOf(item, Number(event.createdAt) || 0);
  if (action && (!actions[parent] || actions[parent].at <= action.at)) actions[parent] = action;
 }
 return actions;
}

const ACTION_KIND: Record<string, string> = { commandExecution: "command", fileRead: "read", fileChange: "edit", webSearch: "web", mcpToolCall: "tool", dynamicToolCall: "tool", toolCall: "tool", reasoning: "think", delegation: "agent", backgroundTask: "agent", search: "search", fileSearch: "search", grep: "search" };
const firstLine = (s: string, max = 80) => { const line = s.trim().split(/\r?\n/)[0]!.trim(); return line.length > max ? line.slice(0, max - 1) + "…" : line; };
const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
function actionOf(item: Record<string, unknown>, at: number): Action | null {
 const type = str(item.type);
 if (!type || type === "agentMessage" || type === "userMessage") return null;
 const kind = ACTION_KIND[type] ?? (/search|grep|glob/i.test(type) ? "search" : "tool");
 const title = str(rec(item.presentation)?.title);
 let detail = "";
 if (type === "commandExecution") detail = str(item.command) ?? title ?? "";
 else if (type === "fileRead") detail = baseName(str(item.path) ?? title ?? "");
 else if (type === "fileChange") { const first = Array.isArray(item.changes) ? rec(item.changes[0]) : null; detail = baseName(str(first?.path) ?? title ?? ""); }
 else detail = title ?? str(item.tool) ?? str(item.name) ?? "";
 return { kind, detail: firstLine(detail), at };
}

const NOT_CODES = new Set(["API", "SQL", "CSS", "HTML", "URL", "JSON", "YAML", "XML", "PDF", "CSV", "SSH", "HTTP", "CLI", "SDK", "RLS", "CRM", "SEO", "DNS", "SSL", "TLS", "JWT", "RPC", "REST", "CPU", "GPU", "RAM", "UI", "UX", "CI", "CD", "TODO", "AI", "PR", "QA", "MCP", "BB"]);
/** "R19 Сравнение с курортами" -> { code: "R19", name: "Сравнение с курортами" }. */
export function ticketCode(title: string): { code: string | null; name: string } {
 const m = /^([A-Z][A-Z0-9]{1,3}(?:-\d{1,4})?)[\s:.—–]+(\S.*)$/s.exec(title.trim());
 if (!m || NOT_CODES.has(m[1])) return { code: null, name: title.trim() };
 return { code: m[1], name: m[2].trim() };
}

export const STATE_LABEL: Record<ExecutorState, string> = { running: "Работает", done: "Готово", error: "Ошибка", stopped: "Остановлен" };
export function stateLabel(state: ExecutorState, lang: Lang = "ru"): string {
 const t = dict(lang);
 return state === "running" ? t.stateRunning : state === "done" ? t.stateDone : state === "error" ? t.stateError : t.stateStopped;
}

/** Thread runtime status of a child thread -> executor state. */
export function threadState(displayStatus: string): ExecutorState {
 if (/^(active|running|pending|starting|provisioning|waiting-for-host|stopping)$/.test(displayStatus)) return "running";
 if (displayStatus === "error") return "error";
 if (displayStatus === "interrupted") return "stopped";
 return "done";
}

// ---------- expanded row: acceptance and summary ----------

/** One ticket of a `task-queue` plan, as far as the row needs it. */
export type PlanTicket = { code: string; status: "pending" | "active" | "review" | "done" | "error" | "skipped"; accepted?: number; criteria?: number; startedAt?: number; plan: string; planUpdatedAt: number };

/** "TQ MG QN · План" -> codes TQ, MG, QN; "R19 Сравнение" -> R19; no code -> []. */
export function ticketCodes(title: string): { codes: string[]; name: string } {
 const multi = /^([A-Z][A-Z0-9]{1,3}(?:\s+[A-Z][A-Z0-9]{1,3}){1,7})\s*[·:—–]\s*(\S.*)$/s.exec(title.trim());
 if (multi) {
  const codes = multi[1].split(/\s+/);
  if (!codes.every(c => NOT_CODES.has(c))) return { codes, name: multi[2].trim() };
 }
 const one = ticketCode(title);
 return { codes: one.code ? [one.code] : [], name: one.name };
}

/** The same code can sit in several plans: take the ticket started closest to the agent, else the newest plan. */
export function pickTicket(code: string, tickets: readonly PlanTicket[], startedAt: number | null): PlanTicket | null {
 const found = tickets.filter(t => t.code === code);
 if (!found.length) return null;
 if (startedAt !== null && found.some(t => t.startedAt !== undefined)) {
  return [...found].sort((a, b) => Math.abs((a.startedAt ?? Infinity) - startedAt) - Math.abs((b.startedAt ?? Infinity) - startedAt))[0];
 }
 return [...found].sort((a, b) => b.planUpdatedAt - a.planUpdatedAt)[0];
}

const TICKET_WORDS: Record<Lang, Record<PlanTicket["status"], string>> = {
 ru: { pending: "ещё не начат", active: "в работе", review: "сдан, ждёт приёмки", done: "завершён, приёмка не записана", error: "ошибка", skipped: "пропущен" },
 en: { pending: "not started", active: "in progress", review: "handed in, awaiting review", done: "finished, no review recorded", error: "error", skipped: "skipped" },
};

/** "TQ · принят, подтверждено 17 из 17 критериев"; codes without a ticket are left out. */
export function acceptanceLines(title: string, tickets: readonly PlanTicket[] | undefined, startedAt: number | null, lang: Lang = "ru"): string[] {
 if (!tickets?.length) return [];
 const out: string[] = [];
 for (const code of ticketCodes(title).codes) {
  const t = pickTicket(code, tickets, startedAt);
  if (!t) continue;
  if (t.status === "done" && t.accepted !== undefined) {
   const total = t.criteria ?? t.accepted;
   out.push(lang === "ru" ? `${code} · принят, подтверждено ${t.accepted} из ${total} ${plural(total, "критерия", "критериев", "критериев")}` : `${code} · accepted, ${t.accepted} of ${total} ${total === 1 ? "criterion" : "criteria"} confirmed`);
  } else out.push(`${code} · ${TICKET_WORDS[lang][t.status]}`);
 }
 return out;
}

/** First lines of a result for the opened row; `truncated` says a "show all" button is needed. */
export function summaryPreview(text: string, maxLines = 5, maxChars = 420): { head: string; truncated: boolean } {
 const lines = text.trim().split(/\r?\n/);
 let head = lines.slice(0, maxLines).join("\n");
 let truncated = lines.length > maxLines;
 if (head.length > maxChars) { head = head.slice(0, maxChars).replace(/\s+\S*$/, "") + "…"; truncated = true; }
 return { head, truncated };
}

/** Flattens `bb task-queue plan show --json` plans into tickets with a code; unknown shapes are skipped. */
export function ticketsFromPlans(plans: unknown): PlanTicket[] {
 const out: PlanTicket[] = [];
 if (!Array.isArray(plans)) return out;
 for (const p of plans) {
  const plan = rec(p);
  if (!plan || !Array.isArray(plan.stages)) continue;
  for (const stage of plan.stages) for (const step of Array.isArray(rec(stage)?.steps) ? (rec(stage)!.steps as unknown[]) : []) {
   const t = rec(step);
   const code = t && str(t.code), status = t && str(t.status);
   if (!t || !code || !status || !/^(pending|active|review|done|error|skipped)$/.test(status)) continue;
   out.push({ code, status: status as PlanTicket["status"], ...(num(t.accepted) !== null ? { accepted: num(t.accepted)! } : {}), ...(num(t.criteria) !== null ? { criteria: num(t.criteria)! } : {}), ...(num(t.startedAt) !== null ? { startedAt: num(t.startedAt)! } : {}), plan: str(plan.id) ?? "", planUpdatedAt: num(plan.updatedAt) ?? 0 });
  }
  if (out.length > 300) break;
 }
 return out.slice(0, 300);
}
