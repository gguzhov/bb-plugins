import {
  MOBILE_HOME_COMPOSER_STYLE_ID,
  mobileHomeComposerCss,
} from "./mobile-home-composer-styles";

const COMPACT_HOME_SELECTOR = '[data-testid="root-compose-compact-home"]';
const COMPACT_COMPOSER_SELECTOR =
  '[data-testid="root-compose-compact-composer"]';
const SCROLL_VIEWPORT_SELECTOR =
  '[data-testid="root-compose-compact-scroll-viewport"]';
const BOTTOM_SPACER_SELECTOR =
  '[data-testid="root-compose-compact-bottom-spacer"]';
const SPACER_SYNC_ATTR = "data-mobile-home-composer-spacer-sync";
const LIST_GAP_PX = 8;
const TITLE_ATTR = "data-mobile-home-composer-title";
const ICON_ONLY_SELECTOR =
  '[data-promptbox-project-control], button[aria-label="Environment"], button[aria-label="Branch"], button[aria-label="Machine"]';

const NARROW_MEDIA = "(max-width: 47.99rem)";

export function mountMobileHomeComposerContent(signal: AbortSignal): () => void {
  const narrowQuery = window.matchMedia(NARROW_MEDIA);
  let styleEl: HTMLStyleElement | null = null;
  let homeEl: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let layoutMutationObserver: MutationObserver | null = null;
  let presenceObserver: MutationObserver | null = null;
  let rafId = 0;

  const ensureStyle = () => {
    if (styleEl?.isConnected) return;
    styleEl = document.createElement("style");
    styleEl.id = MOBILE_HOME_COMPOSER_STYLE_ID;
    styleEl.setAttribute("data-bb-plugin", "mobile-home-composer");
    styleEl.textContent = mobileHomeComposerCss;
    document.head.appendChild(styleEl);
  };

  const removeStyle = () => {
    styleEl?.remove();
    styleEl = null;
  };

  const clearTitles = () => {
    for (const node of document.querySelectorAll<HTMLElement>(`[${TITLE_ATTR}]`)) {
      node.removeAttribute("title");
      node.removeAttribute(TITLE_ATTR);
    }
  };

  // Icon-only footer buttons name the control and its current value on hover or long-press.
  const syncTitles = (home: HTMLElement) => {
    for (const button of home.querySelectorAll<HTMLElement>(
      `[data-new-thread-footer] :is(${ICON_ONLY_SELECTOR})`,
    )) {
      const aria = button.getAttribute("aria-label") ?? "";
      let title = aria;
      if (!aria.includes(":")) {
        const value = button
          .querySelector("[data-promptbox-full-label], :scope > span > span:not([aria-hidden])")
          ?.textContent?.trim();
        if (value && value !== aria) title = `${aria}: ${value}`;
      }
      if (title && button.getAttribute("title") !== title) {
        button.setAttribute("title", title);
      }
      button.setAttribute(TITLE_ATTR, "");
    }
  };

  const clearSpacerSync = () => {
    clearTitles();
    if (!homeEl) return;
    for (const selector of [BOTTOM_SPACER_SELECTOR, SCROLL_VIEWPORT_SELECTOR]) {
      const node = homeEl.querySelector<HTMLElement>(selector);
      if (!node?.hasAttribute(SPACER_SYNC_ATTR)) continue;
      node.style.removeProperty("height");
      node.style.removeProperty("bottom");
      node.removeAttribute(SPACER_SYNC_ATTR);
    }
    for (const label of homeEl.querySelectorAll<HTMLElement>(
      '[data-promptbox-project-control] [data-promptbox-full-label], [data-promptbox-project-control] [data-promptbox-compact-label], button[aria-label="Environment"] [data-promptbox-full-label], button[aria-label="Environment"] [data-promptbox-compact-label], button[aria-label="Permission mode"] [data-promptbox-full-label], button[aria-label="Permission mode"] [data-promptbox-compact-label]',
    )) {
      label.style.removeProperty("display");
    }
  };

  const syncBottomSpacer = () => {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const home = homeEl;
      if (!home || !narrowQuery.matches) return;
      const composer = home.querySelector<HTMLElement>(COMPACT_COMPOSER_SELECTOR);
      const viewport = home.querySelector<HTMLElement>(SCROLL_VIEWPORT_SELECTOR);
      const spacer = home.querySelector<HTMLElement>(BOTTOM_SPACER_SELECTOR);
      syncTitles(home);
      if (!composer || !viewport) return;
      const bottom = `${composer.offsetHeight + LIST_GAP_PX}px`;
      if (viewport.style.bottom !== bottom) viewport.style.bottom = bottom;
      viewport.setAttribute(SPACER_SYNC_ATTR, "");
      if (!spacer) return;
      if (spacer.style.height !== `${LIST_GAP_PX}px`) {
        spacer.style.height = `${LIST_GAP_PX}px`;
      }
      spacer.setAttribute(SPACER_SYNC_ATTR, "");
    });
  };

  const disconnectLayoutObservers = () => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    layoutMutationObserver?.disconnect();
    layoutMutationObserver = null;
  };

  const bindHome = (next: HTMLElement | null) => {
    if (homeEl === next) return;
    disconnectLayoutObservers();
    clearSpacerSync();
    homeEl = next;
    if (!homeEl || !narrowQuery.matches) return;

    const composer = homeEl.querySelector<HTMLElement>(COMPACT_COMPOSER_SELECTOR);
    const shell = homeEl.querySelector<HTMLElement>("[data-promptbox-shell]");

    resizeObserver = new ResizeObserver(() => syncBottomSpacer());
    if (composer) resizeObserver.observe(composer);
    if (shell && shell !== composer) resizeObserver.observe(shell);

    layoutMutationObserver = new MutationObserver(() => syncBottomSpacer());
    layoutMutationObserver.observe(homeEl, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });

    syncBottomSpacer();
  };

  const findCompactHome = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(COMPACT_HOME_SELECTOR);

  const applyActiveState = () => {
    const home = findCompactHome();
    if (!narrowQuery.matches) {
      removeStyle();
      disconnectLayoutObservers();
      clearSpacerSync();
      homeEl = null;
      return;
    }
    ensureStyle();
    bindHome(home);
  };

  const onMediaChange = () => applyActiveState();

  const onCompactHomePresenceChange = () => {
    if (!narrowQuery.matches) return;
    const home = findCompactHome();
    if (home !== homeEl) bindHome(home);
  };

  presenceObserver = new MutationObserver(onCompactHomePresenceChange);
  presenceObserver.observe(document.body, { childList: true, subtree: true });

  narrowQuery.addEventListener("change", onMediaChange);

  applyActiveState();

  return () => {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    narrowQuery.removeEventListener("change", onMediaChange);
    presenceObserver?.disconnect();
    disconnectLayoutObservers();
    clearSpacerSync();
    removeStyle();
    homeEl = null;
  };
}