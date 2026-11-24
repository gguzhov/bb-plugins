// Order of the cells in the picker: one grid, no sections.
import type { LibraryIcon } from "./server";

export type PickerCell = { kind: "none" } | { kind: "icon"; icon: LibraryIcon } | { kind: "add" };

/** «Без иконки», bundled icons in icons.json order, custom pictures in the order they were added, then «+». */
export function pickerCells(icons: readonly LibraryIcon[]): PickerCell[] {
  return [
    { kind: "none" },
    ...icons.filter((icon) => icon.kind === "builtin").map((icon) => ({ kind: "icon" as const, icon })),
    ...icons.filter((icon) => icon.kind === "custom").map((icon) => ({ kind: "icon" as const, icon })),
    { kind: "add" },
  ];
}

/** The loop the picker plays while the pointer is over an icon: only a full set of frames (left, right, puzzled) plays. */
export function previewMode(icon: LibraryIcon): "preview" | null {
  return icon.frames.left && icon.frames.right && icon.frames.puzzled ? "preview" : null;
}
