// bb-plugin-task-queue — frontend.
//
// The lead agent's work plan in one card above the composer (the plugin is
// shown as "Working Thread"): closed, one line with the plan, the ticket in
// work, its count, acceptance and time; open, the figures, one tick per
// ticket, the epics ("Очередь N") and their tickets with who does each one
// and its state. Background agents and commands sit inside the card: under the
// ticket they work on, as a «Неон · 12 мин» pill; work tied to no ticket is
// listed at the bottom under "Other background work" and named in the plan
// state's hint. The plugin reads that work itself (activity-source.ts).
// Every word comes from i18n.ts, in the language the `language` setting picks.
import "./app.css";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { definePluginApp, useComposer, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { ActivityDto, PlanDto, rpcContract } from "./server";
import { PLAN_CHANNEL, planShown, progress, type StepStatus } from "./plan.ts";
import { percent, planMetrics, type Metrics } from "./metrics.ts";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ownerLabel, queueName, ticketView } from "./format.ts";
import { stripCodes } from "./agent-names.ts";
import { DECK_UI, rescanDeck, useDeckOptOut, usePillsMode } from "./deck-opt-out.ts";
import { epicHint, headerCurrent, linkAgents, nowDoing, planHints, unlinkedLine, spendLine, ticketHint } from "./hint.ts";
import { agentDisplayName, duration, resolveLang, t, type Lang } from "./i18n.ts";

/** The card's language: the setting, or with `auto` the page's then the browser's language. */
const LangContext = createContext<Lang>("en");
function useResolvedLang(): Lang {
  const setting = useSettings().values?.language;
  const page = typeof document === "undefined" ? null : document.documentElement.lang;
  const browser = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  return resolveLang(setting, [page, ...browser]);
}
const useLang = () => useContext(LangContext);

const OPEN_KEY = "task-queue:open";
/** The plan comes by realtime signal; this reread only covers a missed one. */
const PLAN_POLL_MS = 15_000;

function readOpen(): boolean {
  try {
    const value = window.localStorage.getItem(OPEN_KEY);
    // Older versions kept the same choice under this key.
    return value === null ? window.localStorage.getItem("background-peek:open") === "1" : value === "1";
  } catch {
    return false;
  }
}
function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

interface ShownPlan {
  threadId: string;
  plan: PlanDto;
  /** Browser time when a finished plan leaves the card; null while it is open. */
  hideAt: number | null;
}

/**
 * The thread's plan as the server picks it: the latest one still open, or
 * finished less than 30 s ago. Refetched on the server's realtime signal for
 * this thread, and every 15 s in case a signal was missed.
 */
function usePlan(threadId: string | null): ShownPlan | null {
  const rpc = useRpc<typeof rpcContract>();
  const [shown, setShown] = useState<ShownPlan | null>(null);
  const [signal, setSignal] = useState(0);
  const current = useRef(threadId);
  current.current = threadId;

  useRealtime(PLAN_CHANNEL, (payload) => {
    const id = typeof payload === "object" && payload !== null ? (payload as { threadId?: unknown }).threadId : null;
    if (id !== null && id === current.current) setSignal((value) => value + 1);
  });

  useEffect(() => {
    if (threadId === null) return;
    let cancelled = false;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      rpc
        .call("plan", { threadId })
        .then(
          (result) => {
            if (cancelled) return;
            setShown((previous) => {
              if (result.plan === null) return null;
              // An unchanged plan keeps the old object: the card does not redraw on every reread.
              if (
                previous !== null &&
                previous.threadId === threadId &&
                previous.hideAt === null &&
                result.hideInMs === null &&
                JSON.stringify(previous.plan) === JSON.stringify(result.plan)
              ) {
                return previous;
              }
              return { threadId, plan: result.plan, hideAt: result.hideInMs === null ? null : Date.now() + result.hideInMs };
            });
          },
          () => {
            // Keep what the card shows; the next signal or poll tries again.
          },
        )
        .finally(() => {
          inFlight = false;
        });
    };
    load();
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, PLAN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rpc, threadId, signal]);

  // Another thread's plan never shows while this thread's first read is on its way.
  return shown !== null && shown.threadId === threadId ? shown : null;
}

/**
 * The card does not tick: times on screen are LiveTime nodes that rewrite their
 * own text. The card redraws only when its data changes, and once when a
 * finished plan's hide time comes.
 */
function useHideTimer(hideAt: number | null): void {
  const [, bump] = useState(0);
  useEffect(() => {
    if (hideAt === null) return;
    const timer = window.setTimeout(() => bump((value) => value + 1), Math.max(0, hideAt - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [hideAt]);
}

/** A time span that updates itself every 15 s by rewriting one text node; nothing else redraws. */
function LiveTime({ since, until = null }: { since: number; until?: number | null }) {
  const lang = useLang();
  const format = (ms: number) => duration(ms, lang);
  const ref = useRef<HTMLSpanElement | null>(null);
  const text = () => format((until ?? Date.now()) - since);
  useEffect(() => {
    if (until !== null) return;
    const timer = window.setInterval(() => {
      if (document.hidden || ref.current === null) return;
      const next = text();
      if (ref.current.textContent !== next) ref.current.textContent = next;
    }, 15_000);
    return () => window.clearInterval(timer);
  });
  return <span ref={ref} className="tqueue-live">{text()}</span>;
}

/**
 * Phones: when the prompt box takes focus and the on-screen keyboard comes up
 * (the visual viewport shrinks by a quarter or more), an open card folds so
 * the chat stays in view; the closed line stays. The choice is not saved.
 */
function useKeyboardFold(card: React.RefObject<HTMLElement | null>, active: boolean, fold: (open: boolean) => void): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || viewport === undefined || viewport === null) return;
    const check = () => {
      const focus = document.activeElement;
      const inComposer = focus !== null && focus.closest("[data-app-composer]") !== null && card.current?.contains(focus) !== true;
      const editing = focus !== null && focus.closest('textarea, input, [contenteditable]:not([contenteditable="false"])') !== null;
      if (inComposer && editing && viewport.height < window.innerHeight * 0.75) fold(false);
    };
    viewport.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    return () => {
      viewport.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
    };
  }, [active, card, fold]);
}

/** Same list as before (by content): keep the old array so nothing redraws. */
function sameItems(a: readonly ActivityDto[], b: readonly ActivityDto[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** A small rounded label for states and figures; passes props and ref on, so a Hint can wrap it. */
const Pill = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { tone?: "ok" | "warn" | "bad" | "accent" }
>(function Pill({ className, tone, ...props }, ref) {
  return <span ref={ref} className={className === undefined ? "tqueue-pill" : `tqueue-pill ${className}`} data-tone={tone} {...props} />;
});

/**
 * A hover hint in bb's tooltip: the first line plain, the rest muted. Opens
 * on hover, on keyboard focus, and on touch by press and hold.
 */
function Hint({
  lines,
  children,
  side = "top",
}: {
  /** A function is read when the hint opens, so its times are current. */
  lines: readonly (string | null | undefined)[] | (() => readonly (string | null | undefined)[]);
  children: React.ReactElement;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const shown = (typeof lines === "function" ? (open ? lines() : ["…"]) : lines).filter(
    (line): line is string => typeof line === "string" && line !== "",
  );
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  if (shown.length === 0) return children;
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        asChild
        onPointerDown={(event) => {
          fired.current = false;
          if (event.pointerType !== "touch") return;
          cancel();
          timer.current = window.setTimeout(() => {
            fired.current = true;
            setOpen(true);
          }, 450);
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(event) => {
          if (fired.current) event.preventDefault();
        }}
        onClickCapture={(event) => {
          // The press that opened the hint is not also a click on the row.
          if (fired.current) {
            fired.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className="tqueue-tip">
        {shown.map((line, index) => (
          <span key={index} className={index === 0 ? "tqueue-tip-line" : "tqueue-tip-line tqueue-tip-muted"}>
            {line}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/** Three states for the whole card: working (green), paused (grey), failed (red). Static: the colour carries the state. */
type Tone = "ok" | "paused" | "bad";
function Dot({ tone }: { tone: Tone }) {
  return <span className="tqueue-dot" data-tone={tone} aria-hidden="true" />;
}

const PLAN_TONE: Record<PlanDto["state"], "ok" | "warn" | "bad" | undefined> = {
  running: undefined,
  needs_input: "warn",
  error: "bad",
  done: "ok",
};
const PLAN_ICON = "ListTodo";
const STEP_ICON: Record<StepStatus, string> = {
  pending: "Circle",
  active: "Target",
  review: "CircleDot",
  done: "Check",
  error: "CircleX",
  skipped: "Minus",
};
type Ticket = PlanDto["stages"][number]["steps"][number];


/** Acceptance tone: green from 90%, plain from 70%, yellow below. */
function acceptTone(share: number): "ok" | "warn" | undefined {
  const value = percent(share);
  return value >= 90 ? "ok" : value >= 70 ? undefined : "warn";
}

// ── Background work, read through task-queue's `activity` RPC ─────────────

const HOST_CARD = 'section[aria-label^="Background"]:not([data-bgpeek-card]):not([data-tqueue-card])';
const CLOSED_MS = 5000;
const OPEN_MS = 2000;

/**
 * The thread's background agents and commands (this plugin's `activity` RPC).
 * Read only while bb itself has a background card in this composer (hidden or
 * not), so a quiet thread costs a DOM lookup a second and no requests.
 *
 * While this card lists that work, bb's own card steps aside: app.css hides it
 * (data-tqueue-activity) and it is marked as not a card for Liquid Glass, which
 * counts every card above the composer into its deck and pill row, hidden or
 * not. If the read fails, bb's card stays, so the work is never shown nowhere.
 */
function useActivity(threadId: string | null, root: React.RefObject<HTMLElement | null>, open: boolean): ActivityDto[] {
  const rpc = useRpc<typeof rpcContract>();
  const [items, setItems] = useState<ActivityDto[]>([]);
  useEffect(() => {
    if (threadId === null) return;
    let cancelled = false;
    let inFlight = false;
    let lastFetch = 0;
    let had = false;
    let listed = false;
    let aside: Element | null = null;
    const setAside = (host: Element | null) => {
      if (aside === host) return;
      aside?.removeAttribute(DECK_UI);
      host?.setAttribute(DECK_UI, "");
      aside = host;
      rescanDeck();
    };
    const tick = () => {
      if (document.hidden) return;
      const composer = root.current?.closest("[data-app-composer]") ?? null;
      if (composer === null) return;
      const host = composer.querySelector(HOST_CARD);
      if (host === null) {
        if (had) setItems((previous) => (previous.length === 0 ? previous : []));
        had = false;
        listed = false;
        setAside(null);
        return;
      }
      setAside(listed ? host : null);
      if (inFlight || (had && Date.now() - lastFetch < (open ? OPEN_MS : CLOSED_MS))) return;
      had = true;
      inFlight = true;
      lastFetch = Date.now();
      rpc
        .call("activity", { threadId })
        .then(
          (result) => {
            if (cancelled) return;
            listed = result.items.length > 0;
            setItems((previous) => (sameItems(previous, result.items) ? previous : result.items));
            setAside(listed && host.isConnected ? host : null);
          },
          () => {
            // Keep the last list; the plan shows without agents if this keeps failing.
          },
        )
        .finally(() => {
          inFlight = false;
        });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setAside(null);
    };
  }, [rpc, threadId, root, open]);
  return items;
}

/** What an agent or command does now, with its time and tokens. */
function AgentDetail({ item, now, named }: { item: ActivityDto; now: number; named: boolean }) {
  const lang = useLang();
  const words = t(lang);
  const spend = spendLine(item, now, lang);
  return (
    <div className="tqueue-agent">
      {named ? <p className="tqueue-agent-name">{item.title}</p> : null}
      {item.kind === "command" && item.command !== null ? (
        <pre className="tqueue-agent-cmd" title={item.command}>
          <span aria-hidden="true">$ </span>
          {item.command}
        </pre>
      ) : null}
      {item.running.length > 0 ? (
        <ul className="tqueue-agent-steps">
          {item.running.map((step) => (
            <li key={step.id}>
              <Icon name={step.icon ?? "Terminal"} className="size-3 shrink-0" />
              <span className="tqueue-agent-label">{step.tool === "Bash" || step.icon === "Terminal" ? words.commandLabel : (step.tool ?? step.label)}</span>
              {step.text === "" ? null : <code title={step.text}>{step.text}</code>}
            </li>
          ))}
        </ul>
      ) : item.kind === "agent" ? (
        <p className="tqueue-agent-note">{words.thinkingLine}</p>
      ) : null}
      {item.output.length > 0 ? <pre className="tqueue-agent-out">{item.output.join("\n")}</pre> : null}
      {spend === "" ? null : <p className="tqueue-agent-meta">{spend}</p>}
    </div>
  );
}

/** The figures under the plan row: time left and acceptance; nothing without data. */
function MetricsRow({ plan, metrics, now }: { plan: PlanDto; metrics: Metrics; now: number }) {
  const lang = useLang();
  const hints = planHints(plan, now, lang);
  const eta = metrics.etaMs !== null && metrics.etaMs > 0 ? metrics.etaMs : null;
  if (eta === null && metrics.acceptance === null) return null;
  return (
    <div className="tqueue-metrics">
      {eta === null ? null : (
        <Hint lines={[hints.eta(eta)]}>
          <Pill className="tqueue-metric" tabIndex={0}>
            ~{duration(eta, lang)}
          </Pill>
        </Hint>
      )}
      {metrics.acceptance === null ? null : (
        <Hint lines={[hints.acceptance]}>
          <Pill className="tqueue-metric" tone={acceptTone(metrics.acceptance)} tabIndex={0}>
            {t(lang).acceptancePill(percent(metrics.acceptance))}
          </Pill>
        </Hint>
      )}
    </div>
  );
}

/** Closed row: a thin track. */
function PlanBar({ plan }: { plan: PlanDto }) {
  const { done, total } = progress(plan);
  if (total <= 1) return null;
  const share = Math.round((done / total) * 100);
  return (
    <span className="tqueue-bar tqueue-opt-bar" data-state={plan.state} aria-hidden="true">
      <span className="tqueue-bar-fill" style={{ width: `${share}%` }} />
    </span>
  );
}

/** Opened plan: one tick per ticket, as wide as its size; a solid track past 40 tickets; none for one ticket. */
function Ticks({ plan, metrics }: { plan: PlanDto; metrics: Metrics }) {
  const TICKS_HINT = t(useLang()).ticksHint;
  const steps = plan.stages.flatMap((stage) => stage.steps);
  if (steps.length <= 1) return null;
  const track =
    steps.length > 40 ? (
      <span className="tqueue-ticks" data-solid="" tabIndex={0} role="img" aria-label={TICKS_HINT}>
        <span className="tqueue-ticks-fill" style={{ width: `${(metrics.progress ?? 0) * 100}%` }} />
      </span>
    ) : (
      <span className="tqueue-ticks" tabIndex={0} role="img" aria-label={TICKS_HINT}>
        {steps.map((step, index) => (
          <span key={index} className="tqueue-tick" data-status={step.status} style={{ flexGrow: step.points ?? ticketView(step).points ?? 1 }} />
        ))}
      </span>
    );
  return <Hint lines={[TICKS_HINT]}>{track}</Hint>;
}

/** "claude-opus-5-5" -> "Opus 5.5"; other ids stay as they are. */
function modelName(model: string | null | undefined): string | null {
  if (model === null || model === undefined || model === "") return null;
  const match = /(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-_.](\d+))?/i.exec(model);
  // Already a label ("Opus 5.5", "как у ведущего (…)") or a bare alias ("opus").
  if (match === null) return /^(opus|sonnet|haiku|fable)$/i.test(model) ? model[0]!.toUpperCase() + model.slice(1).toLowerCase() : model;
  return `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()} ${match[2]}${match[3] === undefined ? "" : `.${match[3]}`}`;
}

/** The name the card prints for an agent («Неон» / "Neon"), else its description without codes. */
function itemName(item: ActivityDto, lang: Lang): string {
  return item.kind === "agent" && item.name != null ? agentDisplayName(item.name, lang) : stripCodes(item.title);
}

/** «Неон — субагент, модель Opus 5.5. Работает 12 мин. Сейчас: думает» / "Neon: subagent, Opus 5.5. Running for 12 min. Now: thinking". */
function agentLine(item: ActivityDto, since: number, lang: Lang): string {
  return t(lang).agentLine(
    itemName(item, lang),
    item.kind === "agent" ? "agent" : "command",
    modelName(item.model),
    duration(Date.now() - since, lang),
    nowDoing(item, lang),
    item.kind === "agent" && item.nameFromHistory === false,
  );
}

const FUTURE_SHOWN = 3;
const FUTURE_FOLD = 4;

function TicketRow({
  step,
  waiting,
  withBadges,
  agents,
  now,
}: {
  step: Ticket;
  waiting: boolean;
  withBadges: boolean;
  agents: readonly ActivityDto[];
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const lang = useLang();
  const words = t(lang);
  const view = ticketView(step);
  const isWaiting = step.status === "active" && waiting;
  const accepted = step.status === "done" && step.accepted !== undefined && step.criteria !== undefined;
  const owner = view.owner === undefined ? null : ownerLabel(view.owner);
  // The left pill says who does the ticket (the model), in full; codes are never shown.
  const badge = owner;
  const expandable = step.status === "active" && agents.length > 0;
  const working = agents.filter((item) => item.kind === "agent");
  const commands = agents.filter((item) => item.kind !== "agent");
  // Time on this ticket: since the later of the ticket's start and the agent's start.
  const since =
    step.status !== "active" || isWaiting
      ? null
      : Math.max(step.startedAt ?? 0, ...working.map((item) => item.startedAt ?? 0)) || null;
  const names = [
    ...working.map((item) => itemName(item, lang)),
    ...(commands.length === 0 ? [] : [words.commandsCount(commands.length)]),
  ].join(", ");
  const hintLines = () => {
    const hint = ticketHint(step, { now: Date.now(), waiting, agent: null, lang });
    const who = since === null ? [] : agents.map((item) => agentLine(item, Math.max(since, item.startedAt ?? since), lang));
    return [hint.title, hint.state, ...who];
  };

  // At most two pills on the right: the agent and its time, then the state word;
  // without an agent pill, the state word, then acceptance or reworks.
  const pills: React.ReactNode[] = [];
  if (since !== null) {
    pills.push(
      <Pill key="who" className="tqueue-agent-pill">
        {names === "" ? null : <span className="tqueue-agent-names">{names}</span>}
        <span className={names === "" ? "tqueue-agent-time tqueue-agent-alone" : "tqueue-agent-time"}>
          {names === "" ? null : "\u00a0· "}
          <LiveTime since={since} />
        </span>
      </Pill>,
    );
  }
  const reworking = step.status === "active" && step.rework !== undefined && step.rework > 0;
  const word = words.stepWord;
  if (step.status === "pending") pills.push(<Pill key="s">{word.queued}</Pill>);
  else if (step.status === "active")
    pills.push(
      <Pill key="s" tone={isWaiting || reworking ? "warn" : "accent"}>
        {isWaiting ? word.waiting : reworking ? word.rework : word.running}
      </Pill>,
    );
  else if (step.status === "review") pills.push(<Pill key="s" tone="warn">{word.review}</Pill>);
  else if (step.status === "error") pills.push(<Pill key="s" tone="bad">{word.failed}</Pill>);
  else if (step.status === "skipped") pills.push(<Pill key="s">{word.cancelled}</Pill>);
  else if (step.status === "done") pills.push(<Pill key="s" tone="ok">{word.done}</Pill>);
  if (accepted && step.accepted !== step.criteria) {
    const share = step.criteria! > 0 ? step.accepted! / step.criteria! : 1;
    pills.push(
      <Pill key="a" tone={acceptTone(share)}>
        {step.accepted}/{step.criteria}
      </Pill>,
    );
  }
  if (step.rework !== undefined && step.rework > 0) pills.push(<Pill key="r">↺{step.rework}</Pill>);

  const toggle = () => setOpen((value) => !value);
  return (
    <>
      <Hint lines={hintLines}>
        <li
          className="tqueue-ticket"
          data-status={step.status}
          data-current={step.status === "active" || step.status === "review" ? "" : undefined}
          data-agent={since !== null && names !== "" ? "" : undefined}
          data-expandable={expandable ? "" : undefined}
          data-open={expandable && open ? "" : undefined}
          tabIndex={0}
          aria-expanded={expandable ? open : undefined}
          onClick={expandable ? toggle : undefined}
          onKeyDown={
            expandable
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle();
                  }
                }
              : undefined
          }
        >
          <Icon name={isWaiting ? "CircleQuestion" : STEP_ICON[step.status]} fallback="Circle" className="tqueue-ticket-icon size-3 shrink-0" />
          {withBadges ? (
            <span className="tqueue-who" data-owner={owner === null ? undefined : ""} data-empty={badge === null ? "" : undefined}>
              {badge === null ? null : (
                <>
                  <span className="tqueue-who-full">{badge}</span>
                  <span className="tqueue-who-short" aria-hidden="true">
                    {badge.startsWith("Lead") ? "Lead" : badge.split(" ")[0]}
                  </span>
                </>
              )}
            </span>
          ) : null}
          <span className="tqueue-ticket-title">{view.name}</span>
          <span className="tqueue-ticket-pills">
            {pills.slice(0, 2)}
            {expandable ? <Icon name="ChevronDown" className="tqueue-ticket-chevron size-3 shrink-0" /> : null}
          </span>
        </li>
      </Hint>
      {expandable && open ? (
        <li className="tqueue-ticket-detail">
          {agents.map((item) => (
            <AgentDetail key={item.id} item={item} now={now} named={agents.length > 1} />
          ))}
        </li>
      ) : null}
    </>
  );
}

function StageBlock({
  stage,
  plan,
  single,
  withBadges,
  open,
  onToggle,
  agentsOf,
  now,
}: {
  stage: PlanDto["stages"][number];
  plan: PlanDto;
  /** The plan's only epic: its counts are the plan row's, so they are not repeated. */
  single: boolean;
  withBadges: boolean;
  open: boolean;
  onToggle: () => void;
  agentsOf: (step: Ticket) => readonly ActivityDto[];
  now: number;
}) {
  const [more, setMore] = useState(false);
  const lang = useLang();
  const finished = stage.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const complete = finished === stage.steps.length;
  const futures = stage.steps.filter((step) => step.status === "pending");
  const fold = !more && futures.length > FUTURE_FOLD;
  let futureSeen = 0;
  const visible = stage.steps.filter((step) => {
    if (!fold || step.status !== "pending") return true;
    futureSeen += 1;
    return futureSeen <= FUTURE_SHOWN;
  });
  const hidden = stage.steps.length - visible.length;
  const waiting = plan.state === "needs_input";
  const name = queueName(stage.name);
  const list = (
    <ul className="tqueue-tickets" data-badges={withBadges ? "" : undefined}>
      {visible.map((step, index) => (
        <TicketRow key={index} step={step} waiting={waiting} withBadges={withBadges} agents={agentsOf(step)} now={now} />
      ))}
      {hidden > 0 ? (
        <li className="tqueue-more">
          <button type="button" className="tqueue-more-button" onClick={() => setMore(true)}>
            {t(lang).moreQueued(hidden)}
          </button>
        </li>
      ) : null}
    </ul>
  );
  if (stage.name === "") return <li className="tqueue-group">{list}</li>;
  return (
    <li className="tqueue-group" data-complete={complete ? "" : undefined}>
      <Hint lines={[name, epicHint(stage, lang)]}>
        <button type="button" className="tqueue-group-head" aria-expanded={open} onClick={onToggle}>
          <Icon name="ChevronRight" className="tqueue-group-chevron size-3 shrink-0" />
          <span className="tqueue-group-name">{name}</span>
          {single ? null : complete ? (
            <Pill tone="ok">
              ✓ {finished} / {stage.steps.length}
            </Pill>
          ) : (
            <Pill>
              {finished} / {stage.steps.length}
            </Pill>
          )}
        </button>
      </Hint>
      {open ? list : null}
    </li>
  );
}

/** The opened plan: its row, the figures, the ticks and the epics with their tickets. */
function PlanBlock({ plan, now, items }: { plan: PlanDto; now: number; items: readonly ActivityDto[] }) {
  const lang = useLang();
  const { done, total, current } = progress(plan);
  const metrics = planMetrics(plan, now);
  const hints = planHints(plan, now, lang);
  const root = useRef<HTMLDivElement | null>(null);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const withBadges = plan.stages.some((stage) =>
    stage.steps.some((step) => {
      const view = ticketView(step);
      return view.owner !== undefined;
    }),
  );
  const currentKey = current === null ? "" : `${plan.id}:${current.title}:${current.status}`;
  const single = plan.stages.length === 1;
  const title = queueName(plan.title);
  const { byTicket, unlinked } = linkAgents(plan, items);
  const none: readonly ActivityDto[] = [];

  // Bring the current ticket into view when it changes; scrolling by hand is left alone otherwise.
  useEffect(() => {
    const row = root.current?.querySelector<HTMLElement>("[data-current]") ?? null;
    const box = root.current?.closest<HTMLElement>(".tqueue-body") ?? null;
    if (row === null || box === null || box.scrollHeight <= box.clientHeight) return;
    const rowBox = row.getBoundingClientRect();
    const boxBox = box.getBoundingClientRect();
    if (rowBox.top < boxBox.top) box.scrollTop += rowBox.top - boxBox.top - 12;
    else if (rowBox.bottom > boxBox.bottom) box.scrollTop += rowBox.bottom - boxBox.bottom + 28;
  }, [currentKey]);

  return (
    <div ref={root} className="tqueue-plan">
      <div className="tqueue-plan-head">
        <Icon name={PLAN_ICON} fallback="Circle" className="size-3.5 shrink-0" />
        <span className="tqueue-row-title" title={title}>
          {title}
        </span>
        <Hint lines={[hints.state, unlinkedLine(unlinked, lang)]}>
          <Pill tone={PLAN_TONE[plan.state]} tabIndex={0}>
            {t(lang).planWord[plan.state]}
          </Pill>
        </Hint>
        <Hint lines={[hints.count]}>
          <Pill tabIndex={0}>
            {done} / {total}
          </Pill>
        </Hint>
        <Hint lines={[hints.time]}>
          <Pill className="tqueue-opt-time" tabIndex={0}>
            <LiveTime since={plan.startedAt} until={plan.state === "done" ? plan.finishedAt : null} />
          </Pill>
        </Hint>
      </div>
      <MetricsRow plan={plan} metrics={metrics} now={now} />
      <Ticks plan={plan} metrics={metrics} />
      {plan.note === null ? null : (
        <p className="tqueue-plan-note" data-state={plan.state}>
          {plan.note}
        </p>
      )}
      <ol className="tqueue-stages">
        {plan.stages.map((stage, index) => {
          const finished = stage.steps.every((step) => step.status === "done" || step.status === "skipped");
          const holdsCurrent = current !== null && stage.steps.includes(current);
          const defaultOpen = holdsCurrent || !finished;
          const key = `${plan.id}:${index}`;
          return (
            <StageBlock
              key={index}
              stage={stage}
              plan={plan}
              single={single}
              withBadges={withBadges}
              open={toggled[key] ?? defaultOpen}
              onToggle={() => setToggled((value) => ({ ...value, [key]: !(value[key] ?? defaultOpen) }))}
              agentsOf={(step) => byTicket.get(step) ?? none}
              now={now}
            />
          );
        })}
      </ol>
      <OtherWork items={unlinked} now={now} />
    </div>
  );
}

/** Background work tied to no ticket: one short row each at the bottom of the open card, opened for details. */
function OtherWork({ items, now }: { items: readonly ActivityDto[]; now: number }) {
  const lang = useLang();
  if (items.length === 0) return null;
  return (
    <section className="tqueue-other" aria-label={t(lang).otherWork}>
      <p className="tqueue-other-head">
        {t(lang).otherWork} · {items.length}
      </p>
      <ul className="tqueue-tickets">
        {items.map((item) => (
          <OtherRow key={item.id} item={item} now={now} />
        ))}
      </ul>
    </section>
  );
}

function OtherRow({ item, now }: { item: ActivityDto; now: number }) {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((value) => !value);
  const kind = item.kind === "agent" ? t(lang).subagent : t(lang).command;
  return (
    <>
      <Hint lines={() => [agentLine(item, item.startedAt ?? Date.now(), lang)]}>
        <li
          className="tqueue-ticket"
          data-status="active"
          data-expandable=""
          data-open={open ? "" : undefined}
          tabIndex={0}
          aria-expanded={open}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
        >
          <Icon name={item.kind === "agent" ? "Bot" : "Terminal"} fallback="Circle" className="tqueue-ticket-icon size-3 shrink-0" />
          <span className="tqueue-ticket-title">{itemName(item, lang)}</span>
          <span className="tqueue-ticket-pills">
            <Pill className="tqueue-agent-pill">
              <span className="tqueue-agent-names">{kind}</span>
              {item.startedAt === null ? null : (
                <span className="tqueue-agent-time">
                  {"\u00a0· "}
                  <LiveTime since={item.startedAt} />
                </span>
              )}
            </Pill>
            <Icon name="ChevronDown" className="tqueue-ticket-chevron size-3 shrink-0" />
          </span>
        </li>
      </Hint>
      {open ? (
        <li className="tqueue-ticket-detail">
          <AgentDetail item={item} now={now} named={false} />
        </li>
      ) : null}
    </>
  );
}

/** Fades the body's bottom edge while there is more to scroll to. */
function useScrollFade(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  });
  return [ref, more];
}

function TaskQueueBanner() {
  const composer = useComposer();
  const lang = useResolvedLang();
  const words = t(lang);
  const scope = composer?.scope;
  const threadId = scope !== undefined && scope.kind === "thread" ? scope.threadId : null;
  const [open, setOpen] = useState(readOpen);
  const shownPlan = usePlan(threadId);
  // No ticking clock: a finished plan's hide time redraws the card once.
  useHideTimer(shownPlan?.hideAt ?? null);
  const now = Date.now();
  const [body, fade] = useScrollFade();
  const card = useRef<HTMLElement | null>(null);
  const plan = planShown(shownPlan, now) ? shownPlan!.plan : null;
  const items = useActivity(plan === null ? null : threadId, card, open);
  // Phones (liquid-glass "pills"): the card stays a full-width card above the prompt box, not a pill.
  const pillsDeck = usePillsMode();
  useDeckOptOut(card, pillsDeck, plan !== null);
  useKeyboardFold(card, open && pillsDeck, setOpen);

  if (plan === null) return null;

  const counts = progress(plan);
  const acceptance = planMetrics(plan, now).acceptance;
  const hints = planHints(plan, now, lang);
  const toggle = () => {
    setOpen((value) => {
      writeOpen(!value);
      return !value;
    });
  };

  const tone: Tone = plan.state === "needs_input" ? "paused" : plan.state === "error" ? "bad" : "ok";
  const step = headerCurrent(plan, counts.current, lang);
  const title = queueName(plan.title);
  const heading = step === "" ? title : `${title} · ${step}`;

  // Closed: count, acceptance, time. Open, the plan row below carries them, so the header drops them.
  const pills: React.ReactNode[] = [];
  if (!open) {
    pills.push(
      <Pill key="count" title={hints.count}>
        {counts.done} / {counts.total}
      </Pill>,
    );
    if (acceptance !== null) {
      pills.push(
        <Pill key="acc" tone={acceptTone(acceptance)} title={hints.acceptance ?? undefined}>
          {percent(acceptance)}%
        </Pill>,
      );
    }
    pills.push(
      <Pill key="time" className="tqueue-opt-time" title={hints.time}>
        <LiveTime since={plan.startedAt} until={plan.state === "done" ? plan.finishedAt : null} />
      </Pill>,
    );
  }

  return (
    <LangContext.Provider value={lang}>
    <TooltipProvider delayDuration={300}>
      <section ref={card} data-tqueue-card="" data-tqueue-activity={items.length > 0 ? "" : undefined} data-tqueue-open={open ? "true" : "false"} aria-label={words.cardLabel} lang={lang} className="tqueue-card">
        <button
          type="button"
          className="tqueue-header"
          aria-expanded={open}
          aria-controls="tqueue-body"
          title={open ? words.closePlan(heading) : words.openPlan(heading)}
          onClick={toggle}
        >
          <Dot tone={tone} />
          <span className="tqueue-header-title">{heading}</span>
          {pills.slice(0, 1)}
          {open ? null : <PlanBar plan={plan} />}
          {pills.slice(1, 3)}
          <Icon name="ChevronUp" className="tqueue-chevron size-3.5 shrink-0" />
        </button>
        <div className="tqueue-reveal" aria-hidden={!open} inert={!open}>
          <div className="tqueue-clip">
            <div className="tqueue-scroller" data-fade={fade ? "" : undefined}>
              <div id="tqueue-body" ref={body} className="tqueue-body">
                <PlanBlock plan={plan} now={now} items={items} />
              </div>
            </div>
          </div>
        </div>
      </section>
    </TooltipProvider>
    </LangContext.Provider>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "task-queue",
    scopes: ["thread"],
    banners: [{ id: "task-queue-card", chrome: "bare", component: TaskQueueBanner }],
  });
});
