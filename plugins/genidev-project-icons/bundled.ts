// Loads the icons shipped with the plugin from assets/icons/icons.json.
// The list is read on every plugin load, so replacing the json and the image files
// and reloading the plugin changes the set without touching code.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MAX_IMAGE_BYTES, sniffImage, webpLengthMatches, type ImageMime } from "./image";
import { FRAME_NAMES, type FrameName } from "./shared";

export const ICON_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Ids of custom pictures start with this prefix; bundled ids may not. */
export const CUSTOM_PREFIX = "custom-";
/** The real type is read from the first bytes; the extension only limits what may be listed. */
const FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.(png|webp|jpe?g)$/;

// Unknown keys (an old `group`, for example) are dropped by zod and ignored.
// `frames` is checked entry by entry below, so one bad frame never hides the icon.
const manifestSchema = z.array(
  z.object({
    id: z.string().regex(ICON_ID),
    file: z.string().regex(FILE_NAME),
    name: z.string().trim().min(1).max(60),
    frames: z.record(z.string(), z.unknown()).optional(),
  }),
);

export interface IconPicture {
  mime: ImageMime;
  bytes: Uint8Array;
  hash: string;
}

export interface BundledIcon extends IconPicture {
  id: string;
  name: string;
  /** Animation frames that passed the same checks as the main file. */
  frames: Partial<Record<FrameName, IconPicture>>;
}

/** Finds the plugin folder: server.ts runs from it, dist/server.js one level below. */
export function pluginRoot(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let step = 0; step < 4; step += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "assets"))) return dir;
    dir = dirname(dir);
  }
  return dirname(fileURLToPath(fromUrl));
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

export interface BundledLoad {
  icons: BundledIcon[];
  problems: string[];
}

/** Reads one listed file; returns a problem text instead of throwing. The real path must stay inside the folder. */
function readPicture(folder: string, realFolder: string, file: string): IconPicture | string {
  let bytes: Uint8Array;
  try {
    const real = realpathSync(join(folder, file));
    if (real !== realFolder && !real.startsWith(realFolder + sep)) return "file points outside the folder";
    if (!statSync(real).isFile()) return "not a regular file";
    bytes = readFileSync(real);
  } catch {
    return "file not found";
  }
  const mime = sniffImage(bytes);
  if (mime === null || bytes.length > MAX_IMAGE_BYTES || (mime === "image/webp" && !webpLengthMatches(bytes))) {
    return "not a PNG, JPEG or WebP, damaged, or larger than 512 KB";
  }
  return { mime, bytes, hash: hashBytes(bytes) };
}

export interface FolderLoad extends BundledLoad {
  /** Entries of icons.json that did not become an icon. */
  skipped: number;
  /** False when the folder or its icons.json is missing. */
  found: boolean;
}

/**
 * Reads `<folder>/icons.json` and the files it names. Only names listed there are read, and
 * only inside the folder (a link leading outside is refused). Broken entries are skipped and
 * reported, never fatal. `label` prefixes the manifest-level problems.
 */
export function loadIconFolder(folder: string, label: string): FolderLoad {
  const problems: string[] = [];
  const empty = (found: boolean, problem?: string): FolderLoad => ({ icons: [], problems: problem ? [problem] : [], skipped: 0, found });
  let realFolder: string;
  let raw: unknown;
  try {
    realFolder = realpathSync(folder);
    if (!statSync(realFolder).isDirectory()) return empty(false);
  } catch {
    return empty(false);
  }
  const manifest = join(realFolder, "icons.json");
  if (!existsSync(manifest)) return empty(false);
  try {
    const realManifest = realpathSync(manifest);
    if (!realManifest.startsWith(realFolder + sep)) return empty(true, `${label}/icons.json points outside the folder`);
    raw = JSON.parse(readFileSync(realManifest, "utf8"));
  } catch {
    return empty(true, `${label}/icons.json cannot be read`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return empty(true, `${label}/icons.json has the wrong format`);

  const icons: BundledIcon[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of parsed.data) {
    if (entry.id.startsWith(CUSTOM_PREFIX)) {
      problems.push(`id ${entry.id} is reserved for custom pictures`);
      skipped += 1;
      continue;
    }
    if (seen.has(entry.id)) {
      problems.push(`duplicate id ${entry.id}`);
      skipped += 1;
      continue;
    }
    const main = readPicture(folder, realFolder, entry.file);
    if (typeof main === "string") {
      problems.push(`${entry.id}: ${main}`);
      skipped += 1;
      continue;
    }
    const frames: BundledIcon["frames"] = {};
    for (const [frame, file] of Object.entries(entry.frames ?? {})) {
      if (!(FRAME_NAMES as readonly string[]).includes(frame)) {
        problems.push(`${entry.id}: unknown frame ${frame}`);
        continue;
      }
      if (typeof file !== "string" || !FILE_NAME.test(file)) {
        problems.push(`${entry.id}: frame ${frame} has an invalid file name`);
        continue;
      }
      const picture = readPicture(folder, realFolder, file);
      if (typeof picture === "string") {
        problems.push(`${entry.id}: frame ${frame}: ${picture}`);
        continue;
      }
      frames[frame as FrameName] = picture;
    }
    seen.add(entry.id);
    icons.push({ id: entry.id, name: entry.name, ...main, frames });
  }
  return { icons, problems, skipped, found: true };
}

/** Reads the icons shipped with the plugin (assets/icons). */
export function loadBundledIcons(root: string): BundledLoad {
  const load = loadIconFolder(join(root, "assets", "icons"), "assets/icons");
  if (!load.found && load.problems.length === 0) return { icons: [], problems: ["assets/icons/icons.json cannot be read"] };
  return { icons: load.icons, problems: load.problems };
}
