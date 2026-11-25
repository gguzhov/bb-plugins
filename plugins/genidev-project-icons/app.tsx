// Project icons: frontend entry.
// - content script "project-menus" keeps a host for the «Icon» item in the project menu;
// - content script "sidebar-icons" draws the chosen icon next to project names;
// - overlay "icons" loads state over RPC, renders the item into the host and
//   works out each project's state (error / waiting / working / done) from the sidebar's live
//   thread list, which bb already keeps fresh: no extra requests or polling.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, experimental_useSidebarThreads, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { IconsState, rpcContract } from "./server";
import { ANIMATION_SETTING, CHANGED } from "./shared";
import { DEBUG_KEY, parseDebugStates, projectStates, withOverrides, type ProjectState } from "./project-state";
import { menuTarget, sidebarIcons, type SidebarIcon } from "./store";
import { watchProjectMenus } from "./menu-watch";
import { decorateSidebar } from "./decoration";
import { IconMenu } from "./icon-menu";
import type { PickerActions } from "./picker";
import "./style.css";

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function useIconsState() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<IconsState | null>(null);
  const [loadError, setLoadError] = useState("");
  const { projects, threads } = experimental_useSidebarThreads();
  const catalogKey = projects.map((project) => `${project.id}:${project.name}`).join("|");

  const refresh = useCallback(async () => {
    try {
      setState(await rpc.call("state"));
      setLoadError("");
    } catch (error) {
      setLoadError(message(error, "Не удалось загрузить иконки."));
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh, catalogKey]);
  useRealtime(CHANGED, () => void refresh());

  const actions = useMemo<PickerActions>(
    () => ({
      async select(iconId) {
        const target = menuTarget.get();
        if (!target) throw new Error("Меню проекта закрыто.");
        await rpc.call("setIcon", { projectId: target.projectId, iconId });
        await refresh();
      },
      async add(name, data) {
        await rpc.call("addIcon", { name, data });
        await refresh();
      },
      async remove(iconId) {
        await rpc.call("removeIcon", { iconId });
        await refresh();
      },
    }),
    [rpc, refresh],
  );

  return { state, loadError, actions, threads };
}

function readDebug(): Map<string, ProjectState> {
  try {
    return parseDebugStates(window.localStorage.getItem(DEBUG_KEY));
  } catch {
    return new Map();
  }
}

/** Manual debug overrides from localStorage; empty (and inert) unless the key is set. */
function useDebugStates(): Map<string, ProjectState> {
  const [states, setStates] = useState(readDebug);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === DEBUG_KEY || event.key === null) setStates(readDebug());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return states;
}

function ProjectIcons() {
  const { state, loadError, actions, threads } = useIconsState();
  const target = useSyncExternalStore(menuTarget.subscribe, menuTarget.get);
  const { values } = useSettings();
  const animate = values?.[ANIMATION_SETTING] !== false;
  const debug = useDebugStates();
  const realStates = useMemo(() => projectStates(threads), [threads]);
  // Thread objects change often; only a different state per project should redraw icons.
  const statesKey = JSON.stringify(Array.from(withOverrides(realStates, debug)).sort());

  // Hand the sidebar its icon per project.
  useEffect(() => {
    const live = new Map(JSON.parse(statesKey) as [string, ProjectState][]);
    const urls = new Map((state?.icons ?? []).map((icon) => [icon.id, icon]));
    const next = new Map<string, SidebarIcon>();
    for (const project of state?.projects ?? []) {
      const icon = project.iconId ? urls.get(project.iconId) : undefined;
      if (icon) next.set(project.id, { url: icon.url, name: icon.name, assignedAt: project.assignedAt, frames: icon.frames, state: live.get(project.id) ?? "idle", animate });
    }
    sidebarIcons.set(next);
  }, [state, statesKey, animate]);
  useEffect(() => () => sidebarIcons.set(new Map()), []);

  if (!target) return null;
  const selected = state?.projects.find((project) => project.id === target.projectId)?.iconId ?? null;
  return createPortal(
    <IconMenu
      key={target.key}
      target={target}
      icons={state?.icons ?? null}
      selected={selected}
      loadError={loadError}
      actions={actions}
    />,
    target.host,
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "project-menus", mount: ({ signal }) => watchProjectMenus(signal) });
  app.contentScripts.register({ id: "sidebar-icons", mount: ({ signal }) => decorateSidebar(signal) });
  app.slots.experimental_appOverlay({ id: "icons", component: ProjectIcons });
});
