import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/ui/icon";
import { usePortalScopeProps } from "./lib/portal-scope";
import type { Material } from "./model";
import type { GitChanges } from "./git-stats";
import { actionText, elapsedMs, executorCounts, executorSummary, formatCalls, formatClock, formatDuration, formatTokens, resolveModel, stateLabel, ticketCodes, type Executor } from "./agents";
import { displayAgentName, type Dict, type Lang } from "./i18n";
import { chipSummary, gitChipText, placePopover, readState, toggle, visibleRows, writeState, type SectionId, type WidgetState } from "./widget-state";
import { isImageHref, MaterialIcon, useThumbnail } from "./MaterialIcon";
import { CARD_SCAN_EVENT } from "./card-chrome";

export type GitState = GitChanges | { kind: "no-env" } | null;
export type WidgetData = { materials: Material[]; executors: Executor[]; leaderModel: string | null; executorsPartial: boolean; hostId: string | null };

const storage = () => { try { return window.localStorage; } catch { return null; } };

/** Ticks every second while `active`, so a running agent's timer moves without a reload. */
function useTicker(active: boolean): number {
 const [now, setNow] = useState(() => Date.now());
 useEffect(() => { if (!active) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
 return now;
}

// ---------- hover cards ----------

/** Open on hover (after a short delay) and on keyboard focus; close on leave, blur or Escape. */
function useHover(delay = 250) {
 const [open, setOpen] = useState(false);
 const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
 useEffect(() => clear, []);
 const close = useCallback(() => { clear(); setOpen(false); }, []);
 const bind = {
  onPointerEnter: (e: ReactPointerEvent) => { if (e.pointerType === "touch") return; clear(); timer.current = setTimeout(() => setOpen(true), delay); },
  onPointerLeave: () => close(),
  onFocus: (e: ReactFocusEvent<HTMLElement>) => { if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible")) setOpen(true); },
  onBlur: () => close(),
 };
 return { open, close, bind };
}

/** A small card next to its anchor, portaled to the body with position:fixed; never takes pointer events. */
function HoverCard({ anchor, open, id, children, wide = false }: { anchor: RefObject<HTMLElement | null>; open: boolean; id: string; children: ReactNode; wide?: boolean }) {
 const ref = useRef<HTMLDivElement>(null);
 const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
 const scope = usePortalScopeProps();
 useLayoutEffect(() => {
  if (!open) { setPos(null); return; }
  const a = anchor.current?.getBoundingClientRect(), r = ref.current?.getBoundingClientRect();
  if (a && r) setPos(placePopover(a, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }));
 }, [open, anchor, children]);
 if (!open) return null;
 return createPortal(<div ref={ref} id={id} role="tooltip" {...scope} data-bb-plugin="thread-materials" className={"tm-pop" + (wide ? " tm-pop-wide" : "")} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? "visible" : "hidden" }}>{children}</div>, document.body);
}

// ---------- chips ----------

/** "2 в работе · 5 готово · 1 с ошибкой": running in the active colour with a live dot, errors in the error colour. */
function SummaryText({ parts, form }: { parts: ReturnType<typeof executorSummary>; form: "short" | "long" }) {
 return <>{parts.map((p, i) => <span key={p.state} className={"tm-sum-part tm-sum-" + p.state} data-sum={p.state}>
  {p.state === "running" && <span className="tm-chip-live" aria-hidden="true" />}{p.text}{i < parts.length - 1 && <span className="tm-sum-sep" aria-hidden="true">·</span>}
 </span>)}</>;
}

function SectionChip({ id, icon, label, text, tip, failed = false, aria, open, onToggle, chipRef, registerClose, running = false, gitReady = false }: {
 id: SectionId; icon: string; label: string; text?: string; tip?: string; failed?: boolean; aria?: string; open: boolean;
 onToggle: (id: SectionId) => void; chipRef: (el: HTMLButtonElement | null) => void;
 registerClose: (fn: () => void) => () => void; running?: boolean; gitReady?: boolean;
}) {
 const anchor = useRef<HTMLButtonElement>(null);
 const tipId = useId();
 const hover = useHover(350);
 useEffect(() => registerClose(hover.close), [registerClose, hover.close]);
 return <>
  <button ref={element => { anchor.current = element; chipRef(element); }} type="button" className="tm-chip" data-section={id} aria-expanded={open}
   aria-controls={open ? "tm-sec-" + id : undefined} aria-label={aria ? label + ": " + aria : label}
   aria-describedby={hover.open ? tipId : undefined} data-tm-git-ready={gitReady ? "" : undefined} onClick={() => { hover.close(); onToggle(id); }} {...hover.bind}>
   <Icon name={icon} aria-hidden />{text && <span className="tm-chip-count" aria-hidden="true">{text}</span>}
   {running && <span className="tm-chip-live" aria-hidden="true" />}{failed && <span className="tm-chip-fail" data-testid="tm-chip-fail" aria-hidden="true" />}
  </button>
  <HoverCard anchor={anchor} open={hover.open} id={tipId}><span className="tm-chip-label">{label}</span>{tip && <span className="tm-chip-tip" data-testid="tm-chip-tip">{tip}</span>}</HoverCard>
 </>;
}

export function GitCommitList({ commits, limit, t }: { commits: Extract<GitChanges, { kind: "ok" }>["recentCommits"]; limit?: number; t: Dict }) {
 return <div className="tm-git-history">
  <p className="tm-pop-h">{t.recentCommits}</p>
  {commits?.length ? <ul aria-label={t.recentCommits}>
   {commits.slice(0, limit).map(commit => <li key={commit.hash}><code>{commit.hash}</code><span>{commit.subject || "–"}</span></li>)}
  </ul> : <p className="tm-empty">{commits ? t.noCommits : t.commitsUnavailable}</p>}
 </div>;
}

function GitDetails({ git, t }: { git: GitState; t: Dict }) {
 if (!git || git.kind !== "ok") {
  const message = !git ? t.gitLoading : git.kind === "not-git" ? t.notGit : git.kind === "no-env" ? t.noEnv : git.message;
  return <p className="tm-empty" role="status">{message}</p>;
 }
 const top = git.top ?? [];
 return <>
  <p className="tm-pop-title"><Icon name="GitBranch" aria-hidden /><span className="tm-pop-branch">{git.branch}</span></p>
  <p className="tm-pop-muted">{gitChipText(git)} · {t.gitHint({ ...git.uncommitted, commits: git.unpushedCommits, base: git.base, baseRef: git.baseRef, truncated: git.truncated })}</p>
  {top.length > 0 && <ul className="tm-pop-files">{top.map(file => <li key={file.path}>
   <span className="tm-pop-path" title={file.path}>{file.path}</span>
   {file.added === null && file.removed === null ? <span className="tm-pop-muted">{t.binary}</span> :
    <span className="tm-git-stats"><span className="tm-git-add">+{file.added ?? 0}</span><span className="tm-git-del">−{file.removed ?? 0}</span></span>}
  </li>)}</ul>}
  <GitCommitList commits={git.recentCommits} limit={3} t={t} />
 </>;
}

// ---------- executors ----------

const isFallbackTitle = (title: string) => title === "Субагент" || title === "Дочерний тред";
function execTitle(x: Executor, t: Dict): string {
 if (isFallbackTitle(x.title)) return x.kind === "thread" ? t.childThread : t.subagent;
 return ticketCodes(x.title).name;
}

function StateIcon({ state }: { state: Executor["state"] }) {
 return <span className={"tm-exec-icon tm-exec-" + state} aria-hidden="true">{state === "running" ? <span className="tm-spinner" /> : state === "done" ? <Icon name="Check" /> : state === "error" ? <Icon name="CircleAlert" /> : <Icon name="CircleStop" />}</span>;
}

function ExecRow({ x, data, t, lang, now, expanded, onExpand, onThread, onChat, registerClose }: { x: Executor; data: WidgetData; t: Dict; lang: Lang; now: number; expanded: boolean; onExpand: (id: string | null) => void; onThread: (id: string) => void; onChat: (seq: number) => void; registerClose: (fn: () => void) => () => void }) {
 const ref = useRef<HTMLButtonElement>(null);
 const hover = useHover(400);
 useEffect(() => registerClose(hover.close), [registerClose, hover.close]);
 const name = displayAgentName(x.name, x.ordinal, lang), title = execTitle(x, t), model = resolveModel(x, data.leaderModel, lang);
 const running = x.state === "running", elapsed = elapsedMs(x, now);
 const action = running ? actionText(x.action, lang) : null;
 const meta = running ? [elapsed !== null ? formatClock(elapsed) : null, action ?? (x.kind === "thread" ? t.kindThread : t.starting)] : [model?.label, elapsed !== null ? formatDuration(elapsed, lang) : null];
 const popId = "tm-pop-" + x.id.replace(/[^a-z0-9_-]/gi, "-");
 const go = x.threadId ? <button type="button" className="tm-textact" onClick={() => onThread(x.threadId!)}><Icon name="MessageSquare" aria-hidden />{t.openThread}</button> : x.launchSeq != null ? <button type="button" className="tm-textact" onClick={() => onChat(x.launchSeq!)}><Icon name="MessageSquareText" aria-hidden />{t.showInChat}</button> : null;
 const label = (name ? name + " — " : "") + title + " — " + stateLabel(x.state, lang) + (action ? ", " + action : "");
 return <li className="tm-wx" data-state={x.state} data-expanded={expanded ? "" : undefined}>
  <button ref={ref} type="button" className="tm-exec-row tm-wx-row" aria-label={label} aria-expanded={expanded} aria-describedby={hover.open ? popId : undefined}
   onClick={() => { hover.close(); onExpand(expanded ? null : x.id); }} {...hover.bind}>
   <StateIcon state={x.state} />
   <span className="tm-wx-body">
    <span className="tm-wx-title">{name && <span className="tm-agent-name">{name}</span>}<span className="tm-wx-name">{title}</span></span>
    <span className="tm-wx-meta" data-live={running ? "" : undefined}>{meta.filter(Boolean).map((p, i) => <span key={i} className={i === 0 && running ? "tm-wx-clock" : i === 1 && running ? "tm-wx-action" : undefined}>{p}</span>)}</span>
   </span>
   <span className="tm-wx-chev" aria-hidden="true"><Icon name={expanded ? "ChevronUp" : "ChevronDown"} /></span>
  </button>
  <HoverCard anchor={ref} open={hover.open} id={popId}>
   <p className="tm-pop-title">{name && <span className="tm-agent-name">{name}</span>}<span>{title}</span></p>
   <dl className="tm-pop-dl">
    <dt>{t.kind}</dt><dd>{x.kind === "thread" ? t.kindThread : t.kindSubagent} · {stateLabel(x.state, lang)}</dd>
    {model && <><dt>{t.model}</dt><dd>{model.label}</dd></>}
    {elapsed !== null && <><dt>{t.runTime}</dt><dd>{formatDuration(elapsed, lang)}</dd></>}
    {x.toolUses !== null && <><dt>{t.toolCalls}</dt><dd>{formatCalls(x.toolUses, lang)}</dd></>}
    {x.tokens !== null && x.tokens > 0 && <><dt>{t.tokens}</dt><dd>{formatTokens(x.tokens, lang)}</dd></>}
   </dl>
   {action && <p className="tm-pop-muted">{action}</p>}
  </HoverCard>
  {expanded && <div className="tm-wx-more">
   <dl className="tm-pop-dl">
    <dt>{t.kind}</dt><dd>{x.kind === "thread" ? t.kindThread : t.kindSubagent} · {stateLabel(x.state, lang)}</dd>
    {model && <><dt>{t.model}</dt><dd>{model.label}</dd></>}
    {elapsed !== null && <><dt>{t.runTime}</dt><dd>{formatDuration(elapsed, lang)}</dd></>}
    {x.tokens !== null && <><dt>{t.tokens}</dt><dd>{formatTokens(x.tokens, lang)}</dd></>}
   </dl>
   {action && <p className="tm-wx-summary">{action}</p>}
   {!running && <p className="tm-wx-summary">{x.summary || t.noSummary}</p>}
   {go && <div className="tm-wx-actions">{go}</div>}
  </div>}
 </li>;
}

// ---------- materials ----------

function MaterialRow({ item, threadId, t, removable, onOpen, onCopy, onRemove, copied, registerClose, link }: { item: Material; threadId: string; t: Dict; removable: boolean; onOpen: (item: Material) => void; onCopy: (item: Material) => void; onRemove: (item: Material) => void; copied: boolean; registerClose: (fn: () => void) => () => void; link: ReactNode }) {
 const ref = useRef<HTMLLIElement>(null);
 const image = isImageHref(item.href);
 const hover = useHover(300);
 useEffect(() => registerClose(hover.close), [registerClose, hover.close]);
 const thumb = useThumbnail(item.href, item, threadId, image && hover.open);
 const popId = "tm-pop-img-" + item.id.replace(/[^a-z0-9_-]/gi, "-").slice(-40);
 return <li ref={ref} className="tm-wm" data-copied={copied ? "" : undefined} {...(image ? { onPointerEnter: hover.bind.onPointerEnter, onPointerLeave: hover.bind.onPointerLeave } : {})}>
  {link}
  <span className="tm-wm-acts">
   <button type="button" className="tm-act" aria-label={t.openAria(item.title)} title={t.open} onClick={() => onOpen(item)}><Icon name="ExternalLink" aria-hidden /></button>
   <button type="button" className="tm-act" aria-label={t.copyAria(item.title)} title={copied ? t.copied : t.copyPath} onClick={() => onCopy(item)}><Icon name={copied ? "Check" : "Copy"} aria-hidden /></button>
   {removable && <button type="button" className="tm-act" aria-label={t.removeAria(item.title)} title={t.remove} onClick={() => onRemove(item)}><Icon name="X" aria-hidden /></button>}
  </span>
  {image && <HoverCard anchor={ref} open={hover.open} id={popId}><p className="tm-pop-h">{item.title}</p>{thumb ? <img className="tm-pop-img" src={thumb} alt="" /> : <p className="tm-pop-muted">{t.loading}</p>}</HoverCard>}
 </li>;
}

// ---------- the widget ----------

export function ChatWidget({ threadId, data, git, lang, t, openAll, openThread, showInChat, openMaterial, onRemove, renderLink, visible, error }: {
 threadId: string; data: WidgetData | null; git: GitState; lang: Lang; t: Dict; visible: boolean; error: ReactNode;
 openAll: (section: SectionId) => void; openThread: (id: string) => void; showInChat: (seq: number) => void;
 openMaterial: (item: Material) => void; onRemove: (item: Material) => void; renderLink: (item: Material) => ReactNode;
}) {
 const [state, setState] = useState<WidgetState>(() => readState(storage(), threadId));
 const [expanded, setExpanded] = useState<string | null>(null);
 const [copied, setCopied] = useState<string | null>(null);
 const chips = data ? chipSummary(data) : null;
 const open = state.open;
 useEffect(() => { setState(readState(storage(), threadId)); setExpanded(null); }, [threadId]);
 const chipEls = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});
 const root = useRef<HTMLDivElement>(null);
 const closers = useRef(new Set<() => void>());
 const registerClose = useCallback((fn: () => void) => { closers.current.add(fn); return () => { closers.current.delete(fn); }; }, []);
 const onToggle = (id: SectionId) => { const next = toggle({ open }, id); setState(next); writeState(storage(), threadId, next); setExpanded(null); };
 const running = (data?.executors ?? []).some(x => x.state === "running");
 const now = useTicker(visible && open === "agents" && running);

 // Escape: close a hover card first, then the open section; bb's own card closes only when nothing is open.
 // Listens on window in the capture phase because bb's popover handles Escape on the document before us.
 const openRef = useRef(open); openRef.current = open;
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (e.key !== "Escape" || !root.current) return;
   const active = document.activeElement;
   if (!active || !root.current.contains(active) || active.closest("dialog")) return;
   const popover = document.querySelector('.tm-pop');
   if (popover) { closers.current.forEach(fn => fn()); }
   else if (openRef.current) { const id = openRef.current; const next = { open: null }; setState(next); writeState(storage(), threadId, next); setExpanded(null); requestAnimationFrame(() => chipEls.current[id]?.focus()); }
   else return;
   e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
 }, [threadId]);

 const copy = async (item: Material) => {
  const ok = await copyToClipboard({ text: item.href }).catch(() => false);
  if (!ok) try { await navigator.clipboard.writeText(item.href); } catch { return; }
  setCopied(item.id); setTimeout(() => setCopied(c => c === item.id ? null : c), 1500);
 };
 // The card may sit inside the chat timeline, which card-chrome does not watch: ask it to mark the card.
 const gitReady = git?.kind === "ok";
 useEffect(() => { window.dispatchEvent(new Event(CARD_SCAN_EVENT)); }, [gitReady, open, !!data]);
 const onKeyDown = (e: ReactKeyboardEvent) => { if (e.key === " " && (e.target as HTMLElement).tagName === "A") { e.preventDefault(); (e.target as HTMLElement).click(); } };

 const list = data?.executors ?? [];
 const ag = chips?.agents;
 const execCounts = executorCounts(list);
 const sumParts = data ? executorSummary(execCounts, lang, "short") : [];
 const labels = { git: "Git", agents: t.executors, result: t.createdMaterials, source: t.attachments };
 const section = (id: SectionId, body: ReactNode) => <section id={"tm-sec-" + id} className="tm-wsec" aria-label={labels[id]}>
  {body}
  {id === "agents" && data?.executorsPartial && <p className="tm-empty">{t.partial}</p>}
  <button type="button" className="tm-view-all" onClick={() => openAll(id)}>{t.viewAll}</button>
 </section>;
 let body: ReactNode = null;
 if (open === "git") {
  body = section(open, <GitDetails git={git} t={t} />);
 } else if (open === "agents") {
  const { shown } = visibleRows(list, 3);
  body = section(open, !data || !shown.length ? <p className="tm-empty" role="status">{data ? t.emptyAgents : error ? null : t.loading}</p> :
   <><p className="tm-wsum" data-testid="tm-exec-total"><SummaryText parts={executorSummary(executorCounts(list), lang, "long")} form="long" /></p><ul className="tm-wlist">{shown.map(x => <ExecRow key={x.id} x={x} data={data} t={t} lang={lang} now={now} expanded={expanded === x.id} onExpand={setExpanded} onThread={openThread} onChat={showInChat} registerClose={registerClose} />)}</ul></>);
 } else if (open === "result" || open === "source") {
  const entries = data?.materials.filter(x => x.group === open) ?? [];
  const { shown } = visibleRows(entries);
  body = section(open, !data || !shown.length ? <p className="tm-empty" role="status">{!data ? (error ? null : t.loading) : open === "result" ? t.emptyResults : t.emptySources}</p> :
    <ul className="tm-wlist">{shown.map(item => <MaterialRow key={item.id} item={item} threadId={threadId} t={t} removable={!item.originThreadId || item.originThreadId === threadId} onOpen={openMaterial} onCopy={copy} onRemove={onRemove} copied={copied === item.id} registerClose={registerClose} link={renderLink(item)} />)}</ul>);
 }
 return <div ref={root} className="tm-wroot" onKeyDown={onKeyDown}>
  <div className="tm-chips" aria-label={t.widgetLabel}>
   <SectionChip id="git" icon="GitBranch" label={labels.git} registerClose={registerClose} gitReady={git?.kind === "ok"} chipRef={el => { chipEls.current.git = el; }} open={open === "git"} onToggle={onToggle} />
   <SectionChip id="agents" icon="Bot" label={labels.agents} registerClose={registerClose} chipRef={el => { chipEls.current.agents = el; }} running={!!ag?.running}
    text={!ag ? "…" : ag.running ? ag.running + "/" + ag.total : String(ag.total)}
    tip={sumParts.map(p => p.text).join(" · ") || undefined} failed={!!data && execCounts.error > 0}
    aria={!ag ? t.loading : sumParts.map(p => p.text).join(", ") || String(ag.total)}
    open={open === "agents"} onToggle={onToggle} />
   <SectionChip id="result" icon="FileText" label={labels.result} registerClose={registerClose} chipRef={el => { chipEls.current.result = el; }} text={chips ? String(chips.result.count) : "…"} aria={chips ? String(chips.result.count) : t.loading} open={open === "result"} onToggle={onToggle} />
   <SectionChip id="source" icon="Paperclip" label={labels.source} registerClose={registerClose} chipRef={el => { chipEls.current.source = el; }} text={chips ? String(chips.source.count) : "…"} aria={chips ? String(chips.source.count) : t.loading} open={open === "source"} onToggle={onToggle} />
  </div>
  {error}
  {body}
 </div>;
}

export { MaterialIcon };
