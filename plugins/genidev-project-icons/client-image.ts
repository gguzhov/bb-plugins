// Turns a picked file into a transparent 96×96 picture in the browser.
// The picture is fitted into the square (aspect ratio kept), encoded as WebP
// (PNG when the browser cannot write WebP) and sent as base64.
import { ICON_SIDE, looksLikeSvg, sniffImage } from "./image";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export class PickError extends Error {}

export function iconNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return (base || "Картинка").slice(0, 60);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The part of a canvas the encoder needs (a fake one in tests). */
export interface EncodableCanvas {
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export const WEBP_QUALITY = 0.92;

/**
 * WebP first; a browser that cannot write WebP silently returns PNG (or nothing),
 * and then PNG is asked for explicitly. Alpha is kept by both formats.
 */
export async function encodeIcon(canvas: EncodableCanvas): Promise<Blob> {
  const ask = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await ask("image/webp", WEBP_QUALITY);
  if (webp && webp.type === "image/webp") return webp;
  const png = webp && webp.type === "image/png" ? webp : await ask("image/png");
  if (!png) throw new PickError("Браузер не смог обработать картинку.");
  return png;
}

export async function fileToIcon(file: File): Promise<string> {
  if (file.size > MAX_SOURCE_BYTES) throw new PickError("Файл больше 20 МБ.");
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (!sniffImage(head)) {
    throw new PickError(looksLikeSvg(head) ? "SVG не поддерживается: нужен PNG, JPEG или WebP." : "Это не картинка PNG, JPEG или WebP.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PickError("Не удалось прочитать картинку: файл повреждён.");
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = ICON_SIDE;
    canvas.height = ICON_SIDE;
    const context = canvas.getContext("2d");
    if (!context) throw new PickError("Браузер не смог обработать картинку.");
    const scale = Math.min(ICON_SIDE / bitmap.width, ICON_SIDE / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, Math.round((ICON_SIDE - width) / 2), Math.round((ICON_SIDE - height) / 2), width, height);
    const blob = await encodeIcon(canvas);
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    bitmap.close();
  }
}
