# Project Icons (bb-plugin-genidev-project-icons)

A plugin for [bb](https://getbb.app) that puts an icon beside each project name in the sidebar. Pick a built-in icon or import your own picture. While a project is busy the icon comes alive: it moves its eyes while an agent works, looks puzzled when an agent waits for you, flinches on an error, and smiles when a thread finishes unread.

## Features

- Project menu (three dots) -> "Icon" -> a grid with "No icon", built-in icons, your own pictures and a "+" tile.
- Hovering an icon in the picker plays its states.
- State badges: red "!" (error), yellow "?" (waiting for you), green dot (done, not opened yet).
- New projects get a free icon automatically (can be turned off).
- Personal icon pack: extra icons kept in a folder outside the plugin.

## Install

```
bb plugin install . --yes
bb plugin reload genidev-project-icons
```

Requires bb 0.50 or newer. To build from source: `npm install && bb plugin build .`.

## Settings

| Setting | Meaning |
| --- | --- |
| Give new projects an icon | A new project gets a free icon from the library. Default: on. |
| Icon animation | Eye movement and state frames. Off: icons stay still, badges remain. Default: on. |
| Personal icon pack folder | Absolute path of the personal pack. Empty: `~/.bb/plugins_bb/project-icons-pack`. |

Change a setting in Settings -> Installed plugins, or with `bb plugin config genidev-project-icons set <name> <value>` (names: `autoAssign`, `animation`, `packDir`).

## Commands

```
bb genidev-project-icons list [--json]                 projects and their icons
bb genidev-project-icons icons [--json]                library: id, kind (builtin, pack, custom), name, frames
bb genidev-project-icons set <projectId> <iconId|none> assign or remove an icon
bb genidev-project-icons add <file> --name <name>      add your own picture
bb genidev-project-icons remove <iconId>               delete your own picture (custom-...)
bb genidev-project-icons reload-pack                   re-read the personal pack folder
```

## Your own pictures

Click "+" in the picker (the picture is fitted into 96x96 and saved as WebP in the browser), or run `bb genidev-project-icons add picture.png --name "Rocket"`. PNG, JPEG and WebP are accepted by content, not by file name; SVG is not. At most 512 KB, 512 px, 200 pictures. Your own pictures can be deleted from the picker (the cross on hover) or with `remove`.

## Personal icon pack

Icons you do not want to ship with the plugin (private artwork, for example) can live in a folder of their own:

- Format is the same as the built-in `assets/icons/`: an `icons.json` array of `{"id", "file", "name", "frames"?}` and the image files next to it. Files are WebP, PNG or JPEG up to 512 KB; ids are lowercase letters, digits and dashes.
- Default folder: `~/.bb/plugins_bb/project-icons-pack` (the home folder of the user that runs the bb server). Use the setting "Personal icon pack folder" for another absolute path. A missing folder simply means no personal pack.
- Only files named in `icons.json` are read, and only inside the folder. Names with `..` or paths are refused, and a symbolic link that leads outside the folder is never followed.
- Personal icons come after the built-in ones in the picker, work with states exactly like built-in icons, and cannot be deleted from the picker. If an id matches a built-in icon, the built-in one wins and one line is logged.
- The pack is read when the plugin loads, when the setting changes, and by `bb genidev-project-icons reload-pack`, which reports how many icons were read and how many were skipped, with reasons.
- Automatic assignment to new projects uses the pack too, except ids starting with `leader-` or `star-` and the id `sheikh` (see `pack.ts`).

## States and frames

Each icon has a main picture and optional frames: `left`, `right` (eyes), `puzzled` (waiting), `alert` (error), `happy` (done). A missing frame falls back to the main picture. Frame files are named in `icons.json`:

```json
{ "id": "fox", "file": "fox.webp", "name": "Fox", "frames": { "left": "fox.left.webp", "right": "fox.right.webp", "puzzled": "fox.puzzled.webp" } }
```

State priority, highest first: error, waiting for you, working, done and unread, idle.

## Development

```
npm install
npx tsc --noEmit
npm test
bb plugin build .
```

Tests build their own icon folders. The one exception is a check in `pack.test.ts` that the shipped `assets/icons` contain no closed icons (`leader-`, `star-`, `gg-mascot`, `sheikh`).

Russian version of this file: `README.ru.md`. Internals: `ARCHITECTURE.md`, `DESIGN.md`, `COMPONENTS.md`, `features/project-icons.md`.
