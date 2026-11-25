// Personal icon pack: icons kept in a folder outside the plugin (so they are never published
// with it). Same folder format as assets/icons: icons.json plus the image files next to it.
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { loadIconFolder, type BundledIcon } from "./bundled";

/** Setting that names the pack folder; empty means the default folder. */
export const PACK_DIR_SETTING = "packDir";

/** Default pack folder, inside the home folder of the user that runs the bb server. */
export function defaultPackDir(home: string = homedir()): string {
  return join(home, ".bb", "plugins_bb", "project-icons-pack");
}

/**
 * Icons the plugin never assigns to a new project by itself: caricatures of real people and
 * the like. The owner can still pick them by hand. One list for the code and the docs.
 */
export const NEVER_AUTO = {
  prefixes: ["leader-", "star-"],
  ids: ["sheikh"],
} as const;

export function isNeverAuto(id: string): boolean {
  return NEVER_AUTO.ids.some((name) => name === id) || NEVER_AUTO.prefixes.some((prefix) => id.startsWith(prefix));
}

/** Message shown when the setting holds a relative path. */
export const RELATIVE_PATH_MESSAGE = "The personal pack folder must be an absolute path, for example /Users/name/icons-pack.";

/** Checks a proposed value of the setting: empty or an absolute path. */
export function packDirProblem(value: string): string | null {
  const text = value.trim();
  if (text === "" || isAbsolute(text)) return null;
  return RELATIVE_PATH_MESSAGE;
}

export interface PackLoad {
  dir: string;
  icons: BundledIcon[];
  problems: string[];
  skipped: number;
  /** True when the folder with icons.json exists. */
  found: boolean;
}

/** Reads the personal pack for the value of the setting; never throws. */
export function loadPack(setting: string | undefined, fallbackDir: string = defaultPackDir()): PackLoad {
  const text = (setting ?? "").trim();
  const dir = text === "" ? fallbackDir : text;
  if (!isAbsolute(dir)) return { dir, icons: [], problems: [RELATIVE_PATH_MESSAGE], skipped: 0, found: false };
  const load = loadIconFolder(dir, "personal pack");
  return { dir, ...load };
}
