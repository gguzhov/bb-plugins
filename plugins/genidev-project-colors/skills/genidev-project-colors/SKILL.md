---
name: genidev-project-colors
description: Inspect, choose or reset BB project underline colors in project settings or via the genidev-project-colors CLI.
---

# Project colors

Run `bb genidev-project-colors list` to read actual project IDs and colors.
Set a color with `bb genidev-project-colors set PROJECT_ID "#28A99C"`.
Reset with `bb genidev-project-colors set PROJECT_ID none`.
Never invent IDs. Use the CLI rather than editing BB storage.

The sidebar project actions menu has a Colour item above Project settings. Hover, focus or click opens a right-hand submenu with a single row of swatches and the RGB picker immediately visible. The first up to three swatches are recent colors, persisted globally in plugin storage. The RGB hue slider displays the full color spectrum. The palette is also available on the Project settings page. There is no standalone settings section. After Add project completes, a palette opens for the newly added project. The compact 224px submenu has four swatches in one row: the three most recent colors (preset fallbacks until used) and No colour. The RGB picker is always shown below. Colour uses the BB Palette icon and aligns with native menu rows. Hover/focus/click opens the RGB picker without saving. Pointer selection saves on release; numeric RGB uses Apply. Sidebar titles only have an underline, without dots or pills. The native project menu keeps its existing actions alongside the palette.

Colors persist per project ID. Content-script DOM markers depend on BB compatibility; validate the actual sidebar after BB upgrades.
