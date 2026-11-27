/**
 * Imperative PDF viewer that lives outside React state: selection, popovers and
 * other React updates never touch the pages it draws.
 *
 * - Bytes are fetched in chunks (pdf-loader.ts), parsed in the shared pdf.js worker.
 * - Every page gets a placeholder of the right size up front, so the scrollbar is stable.
 * - Only on-screen pages and their neighbours are drawn; far pages are released.
 * - Page size follows the CSS variable --scale-factor, so a zoom relayouts instantly
 *   by stretching the drawn bitmaps; sharp redraws follow once the zoom settles.
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { loadPdfBytes, type LoadProgress } from "./pdf-loader.ts";
import { acquirePdfWorker, releasePdfWorker } from "./pdf-worker.ts";
import { buildTextLayer, type TextItemLike, type TextStyleLike } from "./text-layer.ts";
import { anchoredScroll, stepZoom, wheelZoomFactor, zoomKey } from "./zoom.ts";
import { outputScaleFor, renderPlan, type VisibleRange } from "./schedule.ts";

import { allowedLinkUrl, destinationPage, linkRectangle, wireLinkLayer } from "./links.ts";

type PdfJs = typeof import("pdfjs-dist");

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;
export const PAGE_GAP = 16;
export const DOC_PAD_X = 12;
const REDRAW_DELAY_MS = 150;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Scale at which the page width fills the available width. */
export function fitWidthScale(pageWidth: number, availableWidth: number): number {
  if (pageWidth <= 0) return 1;
  return clampScale(Math.max(80, availableWidth) / pageWidth);
}

export type ViewerCallbacks = {
  onOpenLink?: (url: string) => void;
  onProgress?: (progress: LoadProgress) => void;
  onDocument?: (info: { numPages: number; fromCache: boolean }) => void;
  onFirstPage?: () => void;
  onScale?: (scale: number, fitScale: number) => void;
  onError?: (error: unknown) => void;
};


type PageSlot = {
  links?: { element: HTMLElement; dispose: () => void };
  number: number;
  wrap: HTMLDivElement;
  width: number; // PDF units at scale 1
  height: number;
  sized: boolean;
  proxy: PDFPageProxy | null;
  canvas: HTMLCanvasElement | null;
  drawnScale: number;
  task: RenderTask | null;
  textLayer: { cancelled: boolean } | null;
  textDiv: HTMLDivElement | null;
};

function isCancel(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "RenderingCancelledException" || name === "AbortError" || name === "AbortException";
}

export class PdfViewer {
  readonly scroller: HTMLElement;
  readonly root: HTMLElement;
  private callbacks: ViewerCallbacks;
  private controller = new AbortController();
  private pdfjs: PdfJs | null = null;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private pdf: PDFDocumentProxy | null = null;
  private workerHeld = false;
  private slots: PageSlot[] = [];
  private visible = new Set<number>();
  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private queue: number[] = [];
  private drawing = false;
  private redrawTimer: ReturnType<typeof setTimeout> | null = null;
  private settled = true;
  private firstPageShown = false;
  private destroyed = false;
  private disposers: (() => void)[] = [];
  scale = 1;
  fitScale = 1;
  numPages = 0;

  constructor(scroller: HTMLElement, root: HTMLElement, callbacks: ViewerCallbacks) {
    this.scroller = scroller;
    this.root = root;
    this.callbacks = callbacks;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  private availableWidth(): number {
    return Math.max(120, (this.scroller.clientWidth || 600) - DOC_PAD_X * 2);
  }

  private showSkeleton(): void {
    const width = this.availableWidth();
    const wrap = document.createElement("div");
    wrap.className = "pdf-chat-page is-skeleton";
    wrap.style.width = `${width}px`;
    wrap.style.height = `${Math.round(width * 1.4142)}px`;
    this.root.replaceChildren(wrap);
  }

  async open(url: string): Promise<void> {
    const signal = this.controller.signal;
    this.showSkeleton();
    try {
      const { bytes, fromCache } = await loadPdfBytes(url, signal, (progress) => {
        if (!signal.aborted) this.callbacks.onProgress?.(progress);
      });
      if (signal.aborted) return;
      const pdfjs = await import("pdfjs-dist");
      if (signal.aborted) return;
      this.pdfjs = pdfjs;
      const worker = acquirePdfWorker(pdfjs);
      this.workerHeld = true;
      const task = pdfjs.getDocument({
        data: bytes,
        worker,
        isEvalSupported: false,
        useSystemFonts: true,
        enableXfa: false,
      });
      this.loadingTask = task;
      const pdf = await task.promise;
      if (signal.aborted) {
        void task.destroy();
        return;
      }
      this.pdf = pdf;
      this.numPages = pdf.numPages;
      this.callbacks.onDocument?.({ numPages: pdf.numPages, fromCache });
      const first = await pdf.getPage(1);
      if (signal.aborted) return;
      const base = first.getViewport({ scale: 1 });
      this.fitScale = fitWidthScale(base.width, this.availableWidth());
      this.scale = this.fitScale;
      this.buildSlots(base.width, base.height, first);
      this.applyScaleVar();
      this.callbacks.onScale?.(this.scale, this.fitScale);
      this.observe();
      this.schedule();
      void this.measureRemainingPages();
    } catch (error) {
      if (signal.aborted || isCancel(error)) return;
      this.callbacks.onError?.(error);
    }
  }

  private buildSlots(width: number, height: number, first: PDFPageProxy): void {
    const fragment = document.createDocumentFragment();
    this.slots = [];
    for (let number = 1; number <= this.numPages; number++) {
      const wrap = document.createElement("div");
      wrap.className = "pdf-chat-page";
      wrap.dataset.page = String(number);
      wrap.style.width = `calc(var(--scale-factor) * ${width}px)`;
      wrap.style.height = `calc(var(--scale-factor) * ${height}px)`;
      fragment.append(wrap);
      this.slots.push({
        number,
        wrap,
        width,
        height,
        sized: number === 1,
        proxy: number === 1 ? first : null,
        canvas: null,
        drawnScale: 0,
        task: null,
        textLayer: null,
        textDiv: null,
      });
    }
    this.root.replaceChildren(fragment);
  }

  /** Real sizes of pages that differ from page 1, fetched in the background. */
  private async measureRemainingPages(): Promise<void> {
    for (const slot of this.slots) {
      if (this.destroyed) return;
      if (slot.sized) continue;
      const proxy = await this.pageProxy(slot).catch(() => null);
      if (!proxy || this.destroyed) return;
      this.sizeSlot(slot, proxy);
      // Yield so measuring never blocks input.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private sizeSlot(slot: PageSlot, proxy: PDFPageProxy): void {
    if (slot.sized) return;
    slot.sized = true;
    const viewport = proxy.getViewport({ scale: 1 });
    if (Math.abs(viewport.width - slot.width) < 0.5 && Math.abs(viewport.height - slot.height) < 0.5) return;
    slot.width = viewport.width;
    slot.height = viewport.height;
    slot.wrap.style.width = `calc(var(--scale-factor) * ${viewport.width}px)`;
    slot.wrap.style.height = `calc(var(--scale-factor) * ${viewport.height}px)`;
  }

  private async pageProxy(slot: PageSlot): Promise<PDFPageProxy> {
    if (slot.proxy) return slot.proxy;
    if (!this.pdf) throw new Error("No document");
    const proxy = await this.pdf.getPage(slot.number);
    slot.proxy = proxy;
    this.sizeSlot(slot, proxy);
    return proxy;
  }

  private applyScaleVar(): void {
    this.root.style.setProperty("--scale-factor", String(this.scale));
  }

  private observe(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) this.visible.add(number);
          else this.visible.delete(number);
        }
        this.schedule();
      },
      { root: this.scroller, rootMargin: "0px", threshold: 0 },
    );
    for (const slot of this.slots) this.observer.observe(slot.wrap);
  }

  visibleRange(): VisibleRange | null {
    if (this.visible.size === 0) return null;
    let first = Infinity;
    let last = -Infinity;
    for (const page of this.visible) {
      first = Math.min(first, page);
      last = Math.max(last, page);
    }
    return { first, last };
  }

  private schedule(): void {
    if (this.destroyed || !this.pdf) return;
    const plan = renderPlan(this.visibleRange(), this.numPages);
    for (const slot of this.slots) {
      if (slot.number < plan.keep.first || slot.number > plan.keep.last) this.release(slot);
    }
    const wanted = new Set(plan.render);
    // Drop queued pages that scrolled away; cancel draws for pages that left the plan.
    this.queue = plan.render.filter((number) => this.needsDraw(this.slots[number - 1]!));
    for (const slot of this.slots) {
      if (slot.task && !wanted.has(slot.number)) {
        slot.task.cancel();
      }
    }
    void this.drain();
  }

  private needsDraw(slot: PageSlot): boolean {
    return !slot.canvas || Math.abs(slot.drawnScale - this.scale) > 1e-6;
  }

  private async drain(): Promise<void> {
    if (this.drawing) return;
    this.drawing = true;
    try {
      while (!this.destroyed && this.queue.length > 0) {
        if (!this.settled) break; // zoom in progress: redraw after it settles
        const number = this.queue.shift()!;
        const slot = this.slots[number - 1];
        if (!slot || !this.needsDraw(slot)) continue;
        await this.draw(slot);
      }
    } finally {
      this.drawing = false;
    }
  }

  private async draw(slot: PageSlot): Promise<void> {
    const pdfjs = this.pdfjs;
    if (!pdfjs) return;
    let proxy: PDFPageProxy;
    try {
      proxy = await this.pageProxy(slot);
    } catch (error) {
      if (!this.destroyed && !isCancel(error)) this.callbacks.onError?.(error);
      return;
    }
    if (this.destroyed) return;
    const scale = this.scale;
    const viewport = proxy.getViewport({ scale });
    const outputScale = outputScaleFor(viewport.width, viewport.height, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const task = proxy.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      intent: "display",
      annotationMode: pdfjs.AnnotationMode.DISABLE,
      background: "#ffffff",
    });
    slot.task = task;
    try {
      await task.promise;
    } catch (error) {
      canvas.width = 0;
      canvas.height = 0;
      if (slot.task === task) slot.task = null;
      if (!isCancel(error) && !this.destroyed) this.callbacks.onError?.(error);
      return;
    }
    if (slot.task === task) slot.task = null;
    if (this.destroyed || !this.isNear(slot)) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const old = slot.canvas;
    if (old) {
      old.replaceWith(canvas);
      old.width = 0;
      old.height = 0;
    } else {
      slot.wrap.prepend(canvas);
    }
    slot.canvas = canvas;
    slot.drawnScale = scale;
    if (!this.firstPageShown) {
      this.firstPageShown = true;
      this.callbacks.onFirstPage?.();
    }
    await this.ensureTextLayer(slot, proxy);
    await this.ensureLinks(slot, proxy);
  }

  private isNear(slot: PageSlot): boolean {
    const plan = renderPlan(this.visibleRange(), this.numPages);
    return slot.number >= plan.keep.first && slot.number <= plan.keep.last;
  }

  private async ensureTextLayer(slot: PageSlot, proxy: PDFPageProxy): Promise<void> {
    if (this.destroyed || slot.textLayer) return;
    const handle = { cancelled: false };
    const div = document.createElement("div");
    div.className = "textLayer";
    slot.wrap.append(div);
    slot.textLayer = handle;
    slot.textDiv = div;
    try {
      const content = await proxy.getTextContent({ includeMarkedContent: false });
      if (handle.cancelled || this.destroyed) return;
      const viewport = proxy.getViewport({ scale: 1 });
      await buildTextLayer(
        div,
        content.items as TextItemLike[],
        content.styles as Record<string, TextStyleLike>,
        viewport.transform,
        viewport.width,
        viewport.height,
        handle,
      );
    } catch (error) {
      if (!isCancel(error) && !this.destroyed) console.warn("[pdf-chat] text layer failed", error);
    }
  }

  private async ensureLinks(slot: PageSlot, proxy: PDFPageProxy): Promise<void> {
    if (slot.links || this.destroyed || !slot.textLayer) return;
    const handle = slot.textLayer;
    try {
      const annotations = await proxy.getAnnotations({ intent: "display" });
      const layer = document.createElement("div");
      layer.className = "pdf-chat-links";
      const viewport = proxy.getViewport({ scale: 1 });
      for (const annotation of annotations) {
        if (annotation.subtype !== "Link") continue;
        const url = allowedLinkUrl(annotation.url) ? annotation.url : null;
        // Never turn an unsafe external action into another kind of link.
        if (!url && (annotation.url || annotation.unsafeUrl)) continue;
        const page = !url && this.pdf ? await destinationPage(annotation.dest, this.pdf) : null;
        if (!url && !page) continue;
        const rect = linkRectangle(annotation.rect, viewport);
        if (!rect || !rect.width || !rect.height) continue;
        const link = document.createElement("a");
        link.href = url ?? `#page=${page}`;
        link.title = url ?? `Page ${page}`;
        link.setAttribute("aria-label", link.title);
        link.draggable = false;
        Object.assign(link.style, { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` });
        link.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          if (url) this.callbacks.onOpenLink?.(url);
          else if (page) {
            const target = this.slots[page - 1]?.wrap;
            if (target) this.scroller.scrollTop += target.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
          }
        });
        layer.append(link);
      }
      if (this.destroyed || handle.cancelled || slot.textLayer !== handle) return;
      slot.wrap.append(layer);
      slot.links = { element: layer, dispose: wireLinkLayer(slot.wrap, layer) };
    } catch (error) {
      if (!this.destroyed) console.warn("[pdf-chat] link layer failed", error);
    }
  }

  private release(slot: PageSlot): void {
    slot.links?.dispose();
    slot.links?.element.remove();
    slot.links = undefined;
    if (slot.task) {
      slot.task.cancel();
      slot.task = null;
    }
    if (slot.canvas) {
      slot.canvas.width = 0;
      slot.canvas.height = 0;
      slot.canvas.remove();
      slot.canvas = null;
      slot.drawnScale = 0;
    }
    if (slot.textLayer) {
      slot.textLayer.cancelled = true;
      slot.textLayer = null;
      slot.textDiv?.remove();
      slot.textDiv = null;
    }
    if (slot.proxy && slot.number !== 1) {
      slot.proxy.cleanup();
    }
  }

  /**
   * Change the zoom. Layout follows immediately (drawn bitmaps stretch); pages are
   * redrawn sharp REDRAW_DELAY_MS after the last change.
   */
  setScale(next: number): number {
    const scale = clampScale(next);
    if (!this.pdf || Math.abs(scale - this.scale) < 1e-6) return this.scale;
    this.scale = scale;
    this.settled = false;
    for (const slot of this.slots) slot.task?.cancel();
    this.applyScaleVar();
    this.callbacks.onScale?.(this.scale, this.fitScale);
    if (this.redrawTimer) clearTimeout(this.redrawTimer);
    this.redrawTimer = setTimeout(() => {
      this.redrawTimer = null;
      this.settled = true;
      this.schedule();
    }, REDRAW_DELAY_MS);
    return this.scale;
  }


  /** Page box under a client point, or the page nearest the middle of the view. */
  private anchorPage(clientX: number, clientY: number): HTMLElement | null {
    const hit = document.elementFromPoint(clientX, clientY);
    const page = hit instanceof Element ? hit.closest<HTMLElement>(".pdf-chat-page") : null;
    if (page && this.root.contains(page)) return page;
    const range = this.visibleRange();
    const number = range ? Math.round((range.first + range.last) / 2) : 1;
    return this.slots[number - 1]?.wrap ?? null;
  }

  /** Zoom keeping the document point at (clientX, clientY) under it. */
  zoomAt(next: number, clientX: number, clientY: number): void {
    if (!this.pdf) return;
    const page = this.anchorPage(clientX, clientY);
    const before = page?.getBoundingClientRect();
    const previous = this.scale;
    this.setScale(next);
    if (!page || !before || Math.abs(previous - this.scale) < 1e-6) return;
    const after = page.getBoundingClientRect();
    const scroll = anchoredScroll(before, after, { x: clientX, y: clientY }, {
      left: this.scroller.scrollLeft,
      top: this.scroller.scrollTop,
    });
    this.scroller.scrollLeft = scroll.left;
    this.scroller.scrollTop = scroll.top;
  }

  private viewCenter(): { x: number; y: number } {
    const box = this.scroller.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + Math.min(box.height / 2, 200) };
  }

  zoomStep(direction: 1 | -1): void {
    const center = this.viewCenter();
    this.zoomAt(stepZoom(this.scale, direction), center.x, center.y);
  }

  zoomFit(): void {
    const center = this.viewCenter();
    this.zoomAt(this.fitScale, center.x, center.y);
  }

  /** Pinch (ctrl+wheel) and Cmd/Ctrl+wheel zoom the document, never the bb window. */
  enableZoomInput(): void {
    let pending = 1;
    let point = { x: 0, y: 0 };
    let frame = 0;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      pending *= wheelZoomFactor(event.deltaY, event.deltaMode);
      point = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const factor = pending;
        pending = 1;
        this.zoomAt(this.scale * factor, point.x, point.y);
      });
    };
    const onKey = (event: KeyboardEvent) => {
      const key = zoomKey(event);
      if (!key) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, input, [contenteditable='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "in") this.zoomStep(1);
      else if (key === "out") this.zoomStep(-1);
      else this.zoomFit();
    };
    // Safari-style gesture events (not sent by Chromium, harmless elsewhere).
    const stopGesture = (event: Event) => event.preventDefault();
    this.scroller.addEventListener("wheel", onWheel, { passive: false });
    this.scroller.addEventListener("keydown", onKey);
    this.scroller.addEventListener("gesturestart", stopGesture);
    this.disposers.push(() => {
      if (frame) cancelAnimationFrame(frame);
      this.scroller.removeEventListener("wheel", onWheel);
      this.scroller.removeEventListener("keydown", onKey);
      this.scroller.removeEventListener("gesturestart", stopGesture);
    });
  }

  /** Refit when the panel width changes, only while the user has not zoomed. */
  refit(): void {
    if (!this.pdf || this.slots.length === 0) return;
    const wasFit = Math.abs(this.scale - this.fitScale) < 1e-6;
    this.fitScale = fitWidthScale(this.slots[0]!.width, this.availableWidth());
    if (wasFit) this.setScale(this.fitScale);
    else this.callbacks.onScale?.(this.scale, this.fitScale);
  }

  watchResize(): void {
    let last = this.scroller.clientWidth;
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.scroller.clientWidth;
      if (Math.abs(width - last) < 1) return;
      last = width;
      this.refit();
    });
    this.resizeObserver.observe(this.scroller);
  }

  /** Counters for live checks. */
  stats(): { pages: number; canvases: number; textLayers: number; drawing: number; queued: number; scale: number } {
    return {
      pages: this.slots.length,
      canvases: this.slots.filter((slot) => slot.canvas).length,
      textLayers: this.slots.filter((slot) => slot.textLayer).length,
      drawing: this.slots.filter((slot) => slot.task).length,
      queued: this.queue.length,
      scale: this.scale,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.abort();
    if (this.redrawTimer) clearTimeout(this.redrawTimer);
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const slot of this.slots) this.release(slot);
    this.slots = [];
    this.queue = [];
    const task = this.loadingTask;
    this.loadingTask = null;
    this.pdf = null;
    if (task) void task.destroy().catch(() => {});
    if (this.workerHeld) {
      this.workerHeld = false;
      releasePdfWorker();
    }
    this.root.replaceChildren();
  }
}
