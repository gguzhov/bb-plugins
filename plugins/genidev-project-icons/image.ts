// Image format checks shared by the server, the CLI and the tests.
// The format is decided by the first bytes of the file, never by its name.

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_SIDE = 512;
export const MAX_CUSTOM_ICONS = 200;
/** Side of the square every custom picture is fitted into. */
export const ICON_SIDE = 96;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Returns the image type by magic bytes, or null for anything else (SVG included). */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** True when the start of the file looks like SVG/XML text (for a clearer error message). */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

export interface ImageSize {
  width: number;
  height: number;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  // IHDR is always the first chunk: length(4) "IHDR"(4) width(4) height(4).
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = readU16BE(bytes, offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: readU16BE(bytes, offset + 5), width: readU16BE(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return { width: readU24LE(bytes, 24) + 1, height: readU24LE(bytes, 27) + 1 };
  }
  if (chunk === "VP8L") {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8 ") {
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  }
  return null;
}

export function imageSize(bytes: Uint8Array, mime: ImageMime): ImageSize | null {
  if (mime === "image/png") return pngSize(bytes);
  if (mime === "image/jpeg") return jpegSize(bytes);
  return webpSize(bytes);
}

/** RIFF size field (bytes 4–7, little endian) + 8 must equal the file length. */
export function webpLengthMatches(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const declared = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
  return declared + 8 === bytes.length;
}

export type ImageCheck =
  | { ok: true; mime: ImageMime; size: ImageSize }
  | { ok: false; message: string };

/** The checks every stored custom picture must pass, whatever path it came from. */
export function checkImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, message: "Файл пустой." };
  const mime = sniffImage(bytes);
  if (!mime) {
    if (looksLikeSvg(bytes)) return { ok: false, message: "SVG не поддерживается: нужен PNG, JPEG или WebP." };
    return { ok: false, message: "Это не картинка PNG, JPEG или WebP." };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, message: "Картинка больше 512 КБ." };
  }
  // A WebP declares its own length right after "RIFF"; a cut or padded file does not match it.
  if (mime === "image/webp" && !webpLengthMatches(bytes)) {
    return { ok: false, message: "Файл WebP повреждён." };
  }
  const size = imageSize(bytes, mime);
  if (!size || size.width < 1 || size.height < 1) {
    return { ok: false, message: "Не удалось прочитать размер картинки." };
  }
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
    return { ok: false, message: `Сторона картинки больше ${MAX_IMAGE_SIDE} px.` };
  }
  return { ok: true, mime, size };
}
