// Tiny shared stores between the content scripts and the React overlay.
// All of them live in this bundle, so a plugin reload starts from fresh copies.

import type { ProjectState } from "./project-state";
import type { IconFrames } from "./shared";

type Listener = () => void;

export interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The project menu that is open right now and the element our item is drawn into. */
export interface MenuTarget {
  /** Changes every time a new host element is created. */
  key: number;
  projectId: string;
  menu: HTMLElement;
  host: HTMLElement;
}

/** Icon picture per project id, for the sidebar. */
export interface SidebarIcon {
  url: string;
  name: string;
  /** When the icon was assigned to the project (ms); 0 for old assignments. */
  assignedAt?: number;
  /** Frame URLs; frames are only put into the page while the project is not idle. */
  frames?: IconFrames;
  state?: ProjectState;
  /** The «Анимация иконок» setting; false keeps every icon still (the waiting badge stays). */
  animate?: boolean;
}

export const menuTarget = createStore<MenuTarget | null>(null);
export const sidebarIcons = createStore<ReadonlyMap<string, SidebarIcon>>(new Map());
