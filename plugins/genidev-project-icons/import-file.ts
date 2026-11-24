// Reads a picture from this machine's disk for `bb genidev-project-icons add`.
// The original must be PNG, JPEG or WebP by its first bytes. On macOS it is then
// fitted into a transparent 96×96 PNG with sips, the same result the UI produces
// with canvas, and turned into WebP with cwebp when cwebp is installed (otherwise
// the PNG is kept). Without sips the original is kept and must pass the size limits itself.
// External programs run without a shell, with a timeout and paths as arguments.
import { execFile } from "node:child_process";
import { access, constants, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ICON_SIDE, looksLikeSvg, sniffImage } from "./image";

const run = promisify(execFile);
/** Largest original accepted before it is shrunk. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const TOOL_TIMEOUT_MS = 20_000;
/** Homebrew folders are often missing from the PATH the bb server was started with. */
const EXTRA_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

class ImportError extends Error {
  readonly code = "invalid" as const;
}

/** Finds an executable cwebp in PATH and the Homebrew folders; null when there is none. */
export async function findCwebp(pathEnv: string = process.env.PATH ?? ""): Promise<string | null> {
  const dirs = [...pathEnv.split(delimiter).filter((dir) => isAbsolute(dir)), ...EXTRA_BIN_DIRS];
  for (const dir of new Set(dirs)) {
    const candidate = join(dir, "cwebp");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

export interface ImportOptions {
  /** Replaced in tests to act as a machine without cwebp. */
  findCwebp?: () => Promise<string | null>;
}

export async function readImageFile(path: string, cwd: string | undefined, options: ImportOptions = {}): Promise<Uint8Array> {
  if (!isAbsolute(path) && !cwd) throw new ImportError("Относительный путь не от чего считать: укажите полный путь.");
  const full = isAbsolute(path) ? path : resolve(cwd!, path);
  const info = await stat(full).catch(() => null);
  if (!info || !info.isFile()) throw new ImportError("Файл не найден.");
  if (info.size > MAX_SOURCE_BYTES) throw new ImportError("Файл больше 20 МБ.");

  const handle = await open(full, "r");
  const head = new Uint8Array(512);
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  if (!sniffImage(head)) {
    throw new ImportError(looksLikeSvg(head) ? "SVG не поддерживается: нужен PNG, JPEG или WebP." : "Это не картинка PNG, JPEG или WebP.");
  }
  const original = new Uint8Array(await readFile(full));
  const square = await fitWithSips(original);
  if (!square) return original;
  return (await toWebp(square, options.findCwebp ?? (() => findCwebp()))) ?? square;
}

/** Returns a transparent ICON_SIDE×ICON_SIDE PNG, or null when sips is unavailable or fails. */
async function fitWithSips(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (process.platform !== "darwin") return null;
  const dir = await mkdtemp(join(tmpdir(), "pi-import-"));
  try {
    const source = join(dir, "source");
    const scaled = join(dir, "scaled.png");
    const square = join(dir, "square.png");
    await writeFile(source, bytes);
    const side = String(ICON_SIDE);
    await run("/usr/bin/sips", ["-s", "format", "png", "-Z", side, source, "--out", scaled], { timeout: TOOL_TIMEOUT_MS });
    await run("/usr/bin/sips", ["-p", side, side, scaled, "--out", square], { timeout: TOOL_TIMEOUT_MS });
    return new Uint8Array(await readFile(square));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** PNG → WebP (quality 92, lossless alpha) with cwebp; null when cwebp is missing or fails. */
async function toWebp(png: Uint8Array, locate: () => Promise<string | null>): Promise<Uint8Array | null> {
  const cwebp = await locate();
  if (!cwebp) return null;
  const dir = await mkdtemp(join(tmpdir(), "pi-webp-"));
  try {
    const source = join(dir, "icon.png");
    const target = join(dir, "icon.webp");
    await writeFile(source, png);
    await run(cwebp, ["-quiet", "-q", "92", "-alpha_q", "100", source, "-o", target], { timeout: TOOL_TIMEOUT_MS });
    const webp = new Uint8Array(await readFile(target));
    return sniffImage(webp) === "image/webp" ? webp : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export { ImportError };
