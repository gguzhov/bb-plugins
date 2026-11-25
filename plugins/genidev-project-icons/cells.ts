// Order of the cells in the picker: one grid, no sections.
import type { LibraryIcon } from "./server";

export type PickerCell = { kind: "none" } | { kind: "icon"; icon: LibraryIcon } | { kind: "add" };

/** «Без иконки», bundled icons in icons.json order, personal-pack icons, custom pictures in the order they were added, then «+». */
export function pickerCells(icons: readonly LibraryIcon[]): PickerCell[] {
  return [
    { kind: "none" },
    ...icons.filter((icon) => icon.kind === "builtin").map((icon) => ({ kind: "icon" as const, icon })),
    ...icons.filter((icon) => icon.kind === "pack").map((icon) => ({ kind: "icon" as const, icon })),
    ...icons.filter((icon) => icon.kind === "custom").map((icon) => ({ kind: "icon" as const, icon })),
    { kind: "add" },
  ];
}

/** The states the picker can play, in loop order. */
export type PreviewPhase = "work" | "wait" | "error" | "done";

export const PHASE_CAPTION: Record<PreviewPhase, string> = {
  work: "в работе",
  wait: "ждёт вас",
  error: "ошибка",
  done: "готово",
};

/**
 * The loop the picker plays while the pointer is over an icon: one phase for every
 * state the icon has frames for, in a fixed order:
 * - work: eye movement, needs `left` and/or `right`;
 * - wait: `puzzled`; error: `alert`; done: `happy`.
 * An icon without any of these frames has an empty loop («без анимации»).
 */
export function previewPhases(icon: Pick<LibraryIcon, "frames">): PreviewPhase[] {
  const { frames } = icon;
  const phases: PreviewPhase[] = [];
  if (frames.left || frames.right) phases.push("work");
  if (frames.puzzled) phases.push("wait");
  if (frames.alert) phases.push("error");
  if (frames.happy) phases.push("done");
  return phases;
}

export function previewMode(icon: Pick<LibraryIcon, "frames">): "preview" | null {
  return previewPhases(icon).length > 0 ? "preview" : null;
}
