// Puts the chosen icon to the left of the project name in the sidebar.
// One <span class="pi-project-icon"> per project row, placed right before the name
// label; rows without an icon get nothing. Everything added here is removed on abort.
//
// Animation is CSS only. The span holds the frames as a stack of <img> and a
// `data-pi-anim` mode; style.css switches their opacity in steps. No timers run
// here: the code only changes the DOM when the store changes. Frame pictures are
// put into the page only while the project is working or waiting.
import { watchDocument } from "./scoped-observer";
import { sidebarIcons, type SidebarIcon } from "./store";

export const ICON_CLASS = "pi-project-icon";

/** What the icon shows; null = still main picture. */
export type AnimMode = "eyes" | "wiggle" | "still" | "puzzled" | "badge" | null;

export function animMode(icon: SidebarIcon): AnimMode {
  const animate = icon.animate !== false;
  const frames = icon.frames ?? {};
  if (icon.state === "waiting") return animate && frames.puzzled ? "puzzled" : "badge";
  if (icon.state === "working") {
    if (!animate) return "still";
    return frames.left && frames.right ? "eyes" : "wiggle";
  }
  return null;
}

/** The name label: the element right before the row's collapse button (span, or input while renaming). */
function labelFor(row: HTMLElement): HTMLElement | null {
  const anchor = row.querySelector<HTMLElement>("[data-sidebar-rename-anchor][aria-expanded]:not([aria-haspopup])");
  const label = anchor?.previousElementSibling as HTMLElement | null;
  return label && !label.classList.contains(ICON_CLASS) ? label : null;
}

function makeIcon(): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `${ICON_CLASS} pi-stack`;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function frameImg(kind: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = `pi-frame pi-frame-${kind}`;
  img.alt = "";
  img.draggable = false;
  img.decoding = "async";
  return img;
}

/** Children the icon needs for its mode: [class suffix, url] pairs, plus the badge. */
function layers(icon: SidebarIcon, mode: AnimMode): [string, string][] {
  const frames = icon.frames ?? {};
  const list: [string, string][] = [["base", icon.url]];
  if (mode === "eyes") list.push(["left", frames.left!], ["right", frames.right!]);
  if (mode === "puzzled") list.push(["puzzled", frames.puzzled!]);
  return list;
}

/** Attribute the «Цвета проектов» plugin puts on a name label when the owner picked the colour by hand. */
export const CHOSEN_AT_ATTRIBUTE = "data-pc-chosen-at";
export const NO_UNDERLINE_CLASS = "pi-no-underline";

/** Moment the colour was chosen by hand; 0 when the attribute is missing or not a number. */
export function chosenAt(label: Element | null): number {
  const value = Number(label?.getAttribute(CHOSEN_AT_ATTRIBUTE));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The last action wins: the colour underline is hidden while the icon was
 * assigned at or after the moment the colour was chosen (equal moments, in
 * particular 0 and 0, hide it).
 */
export function hidesUnderline(assignedAt: number | undefined, colourChosenAt: number): boolean {
  return colourChosenAt <= (assignedAt ?? 0);
}

export function renderIcon(span: HTMLElement, icon: SidebarIcon, colourChosenAt = 0): void {
  span.classList.toggle(NO_UNDERLINE_CLASS, hidesUnderline(icon.assignedAt, colourChosenAt));
  const mode = animMode(icon);
  if (span.title !== icon.name) span.title = icon.name;
  if (mode) span.dataset.piAnim = mode;
  else delete span.dataset.piAnim;

  const wanted = layers(icon, mode);
  const existing = new Map<string, HTMLImageElement>();
  for (const img of span.querySelectorAll<HTMLImageElement>(":scope > img.pi-frame")) {
    existing.set(img.className.replace("pi-frame pi-frame-", ""), img);
  }
  for (const [kind, img] of existing) {
    if (!wanted.some(([name]) => name === kind)) img.remove();
  }
  for (const [kind, url] of wanted) {
    let img = existing.get(kind);
    if (!img) {
      img = frameImg(kind);
      span.append(img);
    }
    if (img.getAttribute("src") !== url) img.src = url;
  }
  let badge = span.querySelector<HTMLElement>(":scope > .pi-badge");
  if (mode === "badge" && !badge) {
    badge = document.createElement("span");
    badge.className = "pi-badge";
    badge.textContent = "?";
    span.append(badge);
  } else if (mode !== "badge" && badge) {
    badge.remove();
  }
}

export function decorateSidebar(signal: AbortSignal): () => void {
  const placed = new Map<HTMLElement, HTMLSpanElement>();
  let frame = 0;
  // Watches only the `data-pc-chosen-at` attribute of the name labels, not the chat stream.
  const labelWatcher = new MutationObserver(() => schedule());

  const apply = () => {
    frame = 0;
    const icons = sidebarIcons.get();
    for (const [row, span] of placed) {
      if (!row.isConnected || !icons.has(row.dataset.sidebarProjectId ?? "")) {
        span.remove();
        placed.delete(row);
      }
    }
    for (const row of document.querySelectorAll<HTMLElement>("[data-sidebar-project-id]")) {
      const icon = icons.get(row.dataset.sidebarProjectId ?? "");
      if (!icon) continue;
      const label = labelFor(row);
      if (!label) continue;
      const span = placed.get(row) ?? makeIcon();
      placed.set(row, span);
      labelWatcher.observe(label, { attributes: true, attributeFilter: [CHOSEN_AT_ATTRIBUTE] });
      renderIcon(span, icon, chosenAt(label));
      if (label.previousElementSibling !== span) label.before(span);
    }
  };

  const schedule = () => {
    if (!frame && !signal.aborted) frame = requestAnimationFrame(apply);
  };
  const stopWatching = watchDocument(schedule, signal);
  const unsubscribe = sidebarIcons.subscribe(schedule);
  schedule();

  const dispose = () => {
    stopWatching();
    unsubscribe();
    labelWatcher.disconnect();
    cancelAnimationFrame(frame);
    for (const span of placed.values()) span.remove();
    placed.clear();
    document.querySelectorAll(`.${ICON_CLASS}`).forEach((node) => node.remove());
  };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
