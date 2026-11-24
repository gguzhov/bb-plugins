// State and summaries of the chat widget's chip row. Pure: no React, no SDK, so tests run it directly.

export type SectionId = "git" | "agents" | "result" | "source";
export type WidgetState = { open: SectionId | null };
export const SECTIONS: readonly SectionId[] = ["git", "agents", "result", "source"];
export function isSectionId(value: unknown): value is SectionId {
 return SECTIONS.some(section => section === value);
}

/** Rows an open section shows before the "N more" line: fits the card without an inner scrollbar. */
export const WIDGET_ROWS = 5;

type Store = Pick<Storage, "getItem" | "setItem">;
const KEY = "thread-materials:widget:";

/** Saved state of the thread, or `fallback` when nothing was saved or the value is broken. */
export function readState(store: Store | null | undefined, threadId: string, fallback: WidgetState = { open: null }): WidgetState {
 try {
  const raw = store?.getItem(KEY + threadId);
  if (raw == null) return fallback;
  const v = JSON.parse(raw) as { open?: unknown };
  return { open: isSectionId(v?.open) ? v.open : null };
 } catch { return fallback; }
}

export function writeState(store: Store | null | undefined, threadId: string, state: WidgetState): void {
 try { store?.setItem(KEY + threadId, JSON.stringify({ open: state.open })); } catch { /* private mode or full storage: state lives until reload */ }
}

/** Accordion: a click on the open chip closes it, a click on another chip opens that one and closes the rest. */
export function toggle(state: WidgetState, id: SectionId): WidgetState {
 return { open: state.open === id ? null : id };
}

/** First rows and the count behind the "N more" line. */
export function visibleRows<T>(list: readonly T[], limit = WIDGET_ROWS): { shown: T[]; rest: number } {
 const shown = list.slice(0, Math.max(0, limit));
 return { shown, rest: list.length - shown.length };
}

type ExecLike = { state: "running" | "done" | "error" | "stopped" };
export type Chips = {
 agents: { running: number; total: number; enabled: boolean };
 result: { count: number; enabled: boolean };
 source: { count: number; enabled: boolean };
};
/** Counts on the chips; a chip with nothing behind it is dimmed and does not open. */
export function chipSummary(data: { executors: readonly ExecLike[]; materials: readonly { group: "result" | "source" }[] } | null): Chips {
 const executors = data?.executors ?? [], materials = data?.materials ?? [];
 const running = executors.filter(x => x.state === "running").length;
 const result = materials.filter(x => x.group === "result").length, source = materials.filter(x => x.group === "source").length;
 return { agents: { running, total: executors.length, enabled: executors.length > 0 }, result: { count: result, enabled: result > 0 }, source: { count: source, enabled: source > 0 } };
}

/** Chip text for git: "+120 −30 · 3"; ≥ when some files were not counted. */
export function gitChipText(g: { added: number; removed: number; files: number; truncated: boolean }): string {
 const ge = g.truncated ? "≥" : "";
 return `${ge}+${g.added} ${ge}−${g.removed} · ${ge}${g.files}`;
}

/** Popover position: under the anchor, or above it when there is no room below; kept inside the viewport. */
export function placePopover(anchor: { top: number; bottom: number; left: number; right: number }, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = 6): { top: number; left: number } {
 const below = anchor.bottom + gap, above = anchor.top - gap - size.height;
 const top = below + size.height <= viewport.height - 8 || above < 8 ? below : above;
 const left = Math.min(Math.max(8, anchor.right - size.width), Math.max(8, viewport.width - size.width - 8));
 return { top: Math.max(8, Math.min(top, viewport.height - size.height - 8)), left };
}
