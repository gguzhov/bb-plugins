/**
 * One pdf.js worker shared by every open PDF tab. The worker script is served
 * by this plugin's server, so parsing never runs on bb's main thread and never
 * depends on a CDN. The worker is terminated shortly after the last tab closes.
 */
import type { PDFWorker } from "pdfjs-dist";

export const WORKER_URL = "/api/v1/plugins/pdf-chat/http/pdf.worker.mjs";
const IDLE_TERMINATE_MS = 3000;

type PdfJs = typeof import("pdfjs-dist");

let shared: { worker: PDFWorker; raw: Worker } | null = null;
let users = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let created = 0;
let terminated = 0;

export function acquirePdfWorker(pdfjs: PdfJs): PDFWorker {
  users++;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!shared || shared.worker.destroyed) {
    // workerSrc is only read if the port fails and pdf.js falls back; keep it same-origin.
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
    const raw = new Worker(WORKER_URL, { type: "module", name: "pdf-chat pdf.js" });
    const worker = new pdfjs.PDFWorker({ port: raw as unknown as null });
    shared = { worker, raw };
    created++;
  }
  return shared.worker;
}

export function releasePdfWorker(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (users > 0 || !shared) return;
    shared.worker.destroy();
    shared.raw.terminate();
    shared = null;
    terminated++;
  }, IDLE_TERMINATE_MS);
}

/** Live counters for diagnostics (read from devtools: window.__pdfChatStats()). */
export function pdfWorkerStats(): { users: number; alive: boolean; created: number; terminated: number } {
  return { users, alive: shared !== null, created, terminated };
}
