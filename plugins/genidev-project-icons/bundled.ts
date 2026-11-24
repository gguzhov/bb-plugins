// Loads the icons shipped with the plugin from assets/icons/icons.json.
// The list is read on every plugin load, so replacing the json and the image files
// and reloading the plugin changes the set without touching code.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** Reads one listed file; returns a problem text instead of throwing. */
function readPicture(folder: string, file: string): IconPicture | string {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(join(folder, file));
  } catch {
    return "нет файла";
  }
  const mime = sniffImage(bytes);
  if (mime === null || bytes.length > MAX_IMAGE_BYTES || (mime === "image/webp" && !webpLengthMatches(bytes))) {
    return "файл не PNG, JPEG или WebP, повреждён либо больше 512 КБ";
  }
  return { mime, bytes, hash: hashBytes(bytes) };
}

/** Reads icons.json; broken entries are skipped and reported, never fatal. */
export function loadBundledIcons(root: string): BundledLoad {
  const folder = join(root, "assets", "icons");
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(folder, "icons.json"), "utf8"));
  } catch {
    return { icons: [], problems: ["assets/icons/icons.json не прочитан"] };
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return { icons: [], problems: ["assets/icons/icons.json не по формату"] };

  const icons: BundledIcon[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    if (entry.id.startsWith(CUSTOM_PREFIX)) {
      problems.push(`id ${entry.id} занят под свои картинки`);
      continue;
    }
    if (seen.has(entry.id)) {
      problems.push(`повтор id ${entry.id}`);
      continue;
    }
    const main = readPicture(folder, entry.file);
    if (typeof main === "string") {
      problems.push(`${entry.id}: ${main}`);
      continue;
    }
    const frames: BundledIcon["frames"] = {};
    for (const [frame, file] of Object.entries(entry.frames ?? {})) {
      if (!(FRAME_NAMES as readonly string[]).includes(frame)) {
        problems.push(`${entry.id}: неизвестный кадр ${frame}`);
        continue;
      }
      if (typeof file !== "string" || !FILE_NAME.test(file)) {
        problems.push(`${entry.id}: кадр ${frame} — недопустимое имя файла`);
        continue;
      }
      const picture = readPicture(folder, file);
      if (typeof picture === "string") {
        problems.push(`${entry.id}: кадр ${frame} — ${picture}`);
        continue;
      }
      frames[frame as FrameName] = picture;
    }
    seen.add(entry.id);
    icons.push({ id: entry.id, name: entry.name, ...main, frames });
  }
  return { icons, problems };
}
