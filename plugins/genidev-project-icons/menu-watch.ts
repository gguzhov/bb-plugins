// Finds the project menu (three dots next to a project in the sidebar) and keeps
// an element for our «Icon» item in it: right below «Colour» from the
// «Цвета проектов» plugin when that item is there, otherwise right above
// «Project settings». The place is rechecked on every change of the page, so the
// order holds whichever plugin mounts first.
import { watchDocument } from "./scoped-observer";
import { menuTarget } from "./store";

export const HOST_CLASS = "pi-menu-host";
const PROJECT_SETTINGS = "Project settings";
const PROJECT_ROW = "[data-sidebar-project-id]";

function directItems(menu: Element): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]'));
}

export function findSettingsItem(menu: Element): HTMLElement | null {
  return directItems(menu).find((item) => item.textContent?.trim() === PROJECT_SETTINGS) ?? null;
}

/** The «Colour» surface of the colors plugin, only once its item has rendered. */
export function findColourSurface(menu: Element): HTMLElement | null {
  const surface = menu.querySelector<HTMLElement>(":scope > .pc-menu-surface");
  return surface?.querySelector(".pc-menu-anchor") ? surface : null;
}

/** Moves the host to its place if it is not there yet. Returns true when it moved. */
export function placeHost(menu: HTMLElement, host: HTMLElement): boolean {
  const colour = findColourSurface(menu);
  if (colour) {
    if (host.parentElement === menu && host.previousElementSibling === colour) return false;
    colour.after(host);
    return true;
  }
  const settings = findSettingsItem(menu);
  if (!settings) return false;
  if (host.parentElement === menu && host.nextElementSibling === settings) return false;
  settings.before(host);
  return true;
}

/** The list that holds the project menu items: a Radix menu on desktop, a bottom drawer on phones. */
export function findProjectMenu(): HTMLElement | null {
  const menus = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));
  const found = menus.find((menu) => findSettingsItem(menu));
  if (found) return found;
  for (const drawer of document.querySelectorAll<HTMLElement>('[role="dialog"][data-persistent-drawer-content]')) {
    for (const item of drawer.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
      if (item.textContent?.trim() === PROJECT_SETTINGS && item.parentElement) return item.parentElement;
    }
  }
  return null;
}

function projectForMenu(menu: HTMLElement, lastProject: string | null): string | null {
  if (menu.id) {
    for (const trigger of document.querySelectorAll<HTMLElement>(`${PROJECT_ROW} [aria-controls]`)) {
      if (trigger.getAttribute("aria-controls") === menu.id) {
        return trigger.closest<HTMLElement>(PROJECT_ROW)?.dataset.sidebarProjectId ?? null;
      }
    }
  }
  return lastProject;
}

export function watchProjectMenus(signal: AbortSignal): () => void {
  let host: HTMLElement | null = null;
  let frame = 0;
  let lastProject: string | null = null;
  let generation = 0;

  const drop = () => {
    host?.remove();
    host = null;
    menuTarget.set(null);
  };

  const scan = () => {
    frame = 0;
    const menu = findProjectMenu();
    const projectId = menu ? projectForMenu(menu, lastProject) : null;
    if (!menu || !projectId) {
      if (host) drop();
      return;
    }
    const current = menuTarget.get();
    if (host && (!host.isConnected || current?.menu !== menu || current.projectId !== projectId)) drop();
    if (!host) {
      host = document.createElement("div");
      host.className = HOST_CLASS;
      host.setAttribute("role", "none");
      placeHost(menu, host);
      generation += 1;
      menuTarget.set({ key: generation, projectId, menu, host });
      return;
    }
    placeHost(menu, host);
  };

  const schedule = () => {
    if (!frame && !signal.aborted) frame = requestAnimationFrame(scan);
  };

  // Remembers which project row opened the menu, for menus without aria-controls.
  const remember = (event: Event) => {
    const row = (event.target as Element | null)?.closest?.<HTMLElement>(PROJECT_ROW);
    if (row?.dataset.sidebarProjectId) lastProject = row.dataset.sidebarProjectId;
  };
  const events = ["pointerdown", "keydown", "contextmenu"] as const;
  for (const name of events) document.addEventListener(name, remember, true);
  const stopWatching = watchDocument(schedule, signal);
  schedule();

  const dispose = () => {
    stopWatching();
    cancelAnimationFrame(frame);
    for (const name of events) document.removeEventListener(name, remember, true);
    drop();
  };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
