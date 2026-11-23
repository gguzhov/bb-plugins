/** Reads PDF bytes over HTTP in chunks, reports progress, and keeps a small validated memory cache. */

export const MAX_PDF_BYTES = 200 * 1024 * 1024;
const CACHE_ENTRIES = 3;
const CACHE_BYTES = 96 * 1024 * 1024;

export class PdfTooLargeError extends Error {
  constructor(bytes: number) {
    super(`This PDF is ${Math.round(bytes / 1024 / 1024)} MB, too large to preview here.`);
    this.name = "PdfTooLargeError";
  }
}

type CacheEntry = { url: string; bytes: Uint8Array; etag: string | null; lastModified: string | null };

/** Least recently used entries first. */
export class ByteCache {
  private entries: CacheEntry[] = [];
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  constructor(maxEntries = CACHE_ENTRIES, maxBytes = CACHE_BYTES) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get(url: string): CacheEntry | null {
    const index = this.entries.findIndex((entry) => entry.url === url);
    if (index < 0) return null;
    const [entry] = this.entries.splice(index, 1);
    this.entries.push(entry!);
    return entry!;
  }

  set(entry: CacheEntry): void {
    this.entries = this.entries.filter((item) => item.url !== entry.url);
    if (entry.bytes.byteLength > this.maxBytes) return;
    this.entries.push(entry);
    let total = this.entries.reduce((sum, item) => sum + item.bytes.byteLength, 0);
    while (this.entries.length > this.maxEntries || total > this.maxBytes) {
      const evicted = this.entries.shift();
      if (!evicted) break;
      total -= evicted.bytes.byteLength;
    }
  }

  get size(): number {
    return this.entries.length;
  }

  urls(): string[] {
    return this.entries.map((entry) => entry.url);
  }
}

const cache = new ByteCache();

export type LoadProgress = { loaded: number; total: number | null };
export type LoadedPdf = { bytes: Uint8Array; fromCache: boolean };

function isPdfContentType(value: string | null): boolean {
  return value !== null && value.split(";", 1)[0]!.trim().toLowerCase() === "application/pdf";
}

/**
 * Returns a private copy of the bytes: pdf.js transfers its input to the worker,
 * which would otherwise empty the cached buffer.
 */
export async function loadPdfBytes(
  url: string,
  signal: AbortSignal,
  onProgress: (progress: LoadProgress) => void,
): Promise<LoadedPdf> {
  const cached = cache.get(url);
  const headers: Record<string, string> = {};
  if (cached?.etag) headers["if-none-match"] = cached.etag;
  else if (cached?.lastModified) headers["if-modified-since"] = cached.lastModified;
  const response = await fetch(url, { credentials: "same-origin", signal, headers });
  if (response.status === 304 && cached) {
    onProgress({ loaded: cached.bytes.byteLength, total: cached.bytes.byteLength });
    return { bytes: cached.bytes.slice(), fromCache: true };
  }
  if (!response.ok) throw new Error(`PDF request failed with status ${response.status}.`);
  if (!isPdfContentType(response.headers.get("content-type"))) {
    throw new Error("The file response was not a PDF.");
  }
  const lengthHeader = Number(response.headers.get("content-length"));
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
  if (total !== null && total > MAX_PDF_BYTES) throw new PdfTooLargeError(total);
  onProgress({ loaded: 0, total });
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    chunks.push(buffer);
    loaded = buffer.byteLength;
  } else {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (loaded > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new PdfTooLargeError(loaded);
      }
      onProgress({ loaded, total });
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  cache.set({
    url,
    bytes,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  });
  return { bytes: bytes.slice(), fromCache: false };
}

/** For live diagnostics only. */
export function cachedPdfUrls(): string[] {
  return cache.urls();
}
