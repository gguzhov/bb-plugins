export const DEFAULT_BROWSER_HOME = "https://www.google.com";
export function browserHomeUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_BROWSER_HOME;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : DEFAULT_BROWSER_HOME; }
  catch { return DEFAULT_BROWSER_HOME; }
}

/** Freeform settings never become arbitrary navigation targets. */
export function githubUser(value: unknown): string {
  return typeof value === "string" && /^(?=.{1,39}$)[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(value) ? value : "";
}
export function githubUrl(value: unknown): string {
  const user = githubUser(value);
  return user ? `https://github.com/${user}?tab=repositories` : "https://github.com";
}

/** Proxy native clicks without moving React-owned nodes or duplicating their handlers. */
export function installBentoNewTab(doc: Document, user: unknown, openUrl?: (url: string) => boolean, home?: unknown): () => void {
  const win = doc.defaultView!;
  const mounted = new Map<HTMLElement, { grid: HTMLElement; cleanup: () => void; browser: HTMLButtonElement | undefined; terminal: HTMLButtonElement }>();
  let frame = 0;
  const refresh = () => {
    observer.disconnect();
    for (const [page, state] of mounted) {
      const input = page.querySelector<HTMLInputElement>('input[data-panel-new-tab-item][role="combobox"]');
      if (!page.isConnected || !input || input.value !== "" || (state.browser !== undefined && !page.contains(state.browser)) || !page.contains(state.terminal)) {
        state.cleanup(); mounted.delete(page);
      }
    }
    for (const page of Array.from(doc.querySelectorAll<HTMLElement>('[data-panel-new-tab-page]'))) {
      if (mounted.has(page)) continue;
      const input = page.querySelector<HTMLInputElement>('input[data-panel-new-tab-item][role="combobox"]');
      const actions = page.querySelector<HTMLElement>('[data-testid="new-tab-actions"]');
      if (!input || input.value !== "" || !actions) continue;
      const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button[data-panel-new-tab-item]'));
      const browser = buttons.find(b => (b.id === "file-search-result-open-browser" || b.textContent?.trim() === "Open browser") && !b.disabled);
      const terminal = buttons.find(b => (b.id === "file-search-result-start-terminal" || b.textContent?.trim() === "Start terminal") && !b.disabled);
      const container = input.parentElement?.parentElement;
      // Require the known search/actions structure before hiding anything.
      if (!terminal || !container || actions.parentElement !== container || container.parentElement !== page) continue;
      const grid = doc.createElement("div"); grid.className = "genidev-newtab-grid genidev-newtab-three";
      const make = (label: string, source: HTMLElement, click?: () => void) => {
        const button = click ? doc.createElement("button") : doc.createElement("a");
        if (button instanceof HTMLButtonElement) button.type = "button";
        else {
          button.href = githubUrl(user); button.target = "_blank"; button.rel = "noopener noreferrer";
          button.addEventListener("click", event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (openUrl) { event.preventDefault(); openUrl(button.href); }
          });
        } button.className = "genidev-newtab-tile"; button.setAttribute("aria-label", label);
        const icon = source.querySelector("svg")?.cloneNode(true) as SVGElement | undefined;
        if (icon) { icon.removeAttribute("class"); icon.setAttribute("aria-hidden", "true"); button.append(icon); }
        const text = doc.createElement("span"); text.textContent = label; button.append(text);
        if (click) button.addEventListener("click", click); grid.append(button);
      };
      make("Browser", browser ?? terminal, () => browser ? browser.click() : openUrl?.(browserHomeUrl(home)));
      if (!browser) {
        const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18" fill="none" stroke="currentColor" stroke-width="1.5"/>';
        grid.firstElementChild?.querySelector("svg")?.replaceWith(icon);
      }
      make("Start terminal", terminal, () => terminal.click());
      make("GitHub", buttons.find(b => b.title === "GitHub PR") ?? browser ?? terminal);
      // Hide sibling content, including Recent, without changing React's ownership.
      const hidden = [...Array.from(container.children).filter(e => e !== input.parentElement), ...Array.from(page.children).filter(e => e !== container)];
      for (const element of hidden) element.classList.add("genidev-newtab-hidden");
      container.append(grid); page.classList.add("genidev-newtab-container");
      mounted.set(page, { grid, browser, terminal, cleanup: () => {
        grid.remove(); page.classList.remove("genidev-newtab-container");
        for (const element of hidden) element.classList.remove("genidev-newtab-hidden");
      }});
    }
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "disabled", "title", "id"] });
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; refresh(); }); };
  const observer = new MutationObserver(schedule);
  doc.addEventListener("input", schedule, true);
  refresh();
  return () => { observer.disconnect(); win.cancelAnimationFrame(frame); doc.removeEventListener("input", schedule, true); for (const s of mounted.values()) s.cleanup(); mounted.clear(); };
}
