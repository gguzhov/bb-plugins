import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbNavigate,
  useComposer,
  useRpc,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import { isFileAccessError, resolvePdfUrl } from "./pdf-source.ts";
import { PdfTooLargeError, type LoadProgress } from "./pdf-loader.ts";
import { pdfWorkerStats } from "./pdf-worker.ts";
import { MAX_SCALE, MIN_SCALE, PdfViewer } from "./viewer.ts";
import { placeInView, popoverKeyAction, unionBox, type Box } from "./popover.ts";
import { copySelectionText, pdfQuote, selectionPageNumber, selectionText, sendQuote } from "./quote.ts";
import { pdfChatRpcContract } from "./rpc.ts";
import { rangeHighlights, textRectsOfRange } from "./selection.ts";
import "./style.css";

type PreviewState =
  | { status: "loading"; progress: LoadProgress | null; parsing: boolean }
  | { status: "ready"; numPages: number }
  | { status: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof PdfTooLargeError) return error.message;
  const name = (error as { name?: string } | null)?.name;
  if (name === "InvalidPDFException") return "This file is damaged or is not a valid PDF.";
  if (name === "PasswordException") return "This PDF is password-protected.";
  if (isFileAccessError(name)) {
    return "bb did not return this file. Its file address may have changed after a bb update: use the built-in preview below and update pdf-chat.";
  }
  const message = error instanceof Error ? error.message : String(error);
  return message || "The PDF could not be opened.";
}

function progressLabel(state: PreviewState): string {
  if (state.status !== "loading") return "";
  if (state.parsing) return "Opening PDF…";
  const progress = state.progress;
  if (progress && progress.total) {
    return `Loading PDF… ${Math.min(100, Math.round((progress.loaded / progress.total) * 100))}%`;
  }
  if (progress && progress.loaded > 0) return `Loading PDF… ${Math.round(progress.loaded / 1024)} KB`;
  return "Loading PDF…";
}

declare global {
  interface Window {
    __pdfChatStats?: () => unknown;
  }
}

/** A text selection in the document, waiting for "Add to chat" or open in the popover. */
type Picked = {
  text: string;
  page: number;
  range: Range;
  stage: "button" | "popover";
};

type Spot = { x: number; y: number; width: number };

const BUTTON_SIZE = { width: 190, height: 32 };
const POPOVER_MAX_WIDTH = 320;
const POPOVER_EST_HEIGHT = 200;

/** Selection geometry in the scroll container's content coordinates. */
function rangeGeometry(range: Range, scroller: HTMLElement): { union: Box; endX: number } | null {
  const rects = textRectsOfRange(range);
  const union = unionBox(rects);
  if (!union) return null;
  const box = scroller.getBoundingClientRect();
  const dx = scroller.scrollLeft - box.left - scroller.clientLeft;
  const dy = scroller.scrollTop - box.top - scroller.clientTop;
  const last = rects[rects.length - 1]!;
  return {
    union: { left: union.left + dx, right: union.right + dx, top: union.top + dy, bottom: union.bottom + dy },
    endX: last.right + dx,
  };
}

function scrollerView(scroller: HTMLElement) {
  return {
    left: scroller.scrollLeft,
    top: scroller.scrollTop,
    width: scroller.clientWidth,
    height: scroller.clientHeight,
  };
}

function PdfFileOpener({ path, source, Original }: PluginFileOpenerProps) {
  // bb opens the address by this client's browser preference: the in-app Browser or the external one.
  // No window.open fallback: a false result means bb blocked the scheme, and that decision stands.
  const navigate = useBbNavigate();
  const openLinkRef = useRef<(url: string) => void>(() => {});
  openLinkRef.current = (url) => { navigate.openUrl(url); };
  const composer = useComposer();
  const rpc = useRpc<typeof pdfChatRpcContract>();
  const pagesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightsRef = useRef<HTMLElement[]>([]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading", progress: null, parsing: false });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [finderBusy, setFinderBusy] = useState(false);
  const [finderError, setFinderError] = useState("");
  const [useOriginal, setUseOriginal] = useState(false);
  const url = useMemo(
    () => resolvePdfUrl(path, source),
    [path, source.environmentId, source.kind, source.projectId, source.threadId],
  );

  const viewerRef = useRef<PdfViewer | null>(null);
  const [zoom, setZoom] = useState<{ scale: number; fitScale: number } | null>(null);

  useEffect(() => {
    if (url === null) return;
    const root = pagesRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return;
    setState({ status: "loading", progress: null, parsing: false });
    setPicked(null);
    setComment("");
    setSendError("");
    setFinderError("");
    const viewer = new PdfViewer(scroller, root, {
      onOpenLink: (url) => openLinkRef.current(url),
      onProgress: (progress) =>
        setState((current) =>
          current.status === "loading" ? { status: "loading", progress, parsing: false } : current,
        ),
      onDocument: () =>
        setState((current) => (current.status === "loading" ? { ...current, parsing: true } : current)),
      onFirstPage: () => setState({ status: "ready", numPages: viewer.numPages }),
      onScale: (scale, fitScale) => setZoom({ scale, fitScale }),
      onError: (error) => setState({ status: "error", message: errorMessage(error) }),
    });
    viewerRef.current = viewer;
    window.__pdfChatStats = () => ({ viewer: viewerRef.current?.stats() ?? null, worker: pdfWorkerStats() });
    scroller.scrollTop = 0;
    void viewer.open(url);
    viewer.watchResize();
    viewer.enableZoomInput();
    return () => {
      viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [reloadNonce, url]);

  const clearHighlights = () => {
    for (const el of highlightsRef.current) el.remove();
    highlightsRef.current = [];
  };

  /** Paint the selection inside its pages, so it stays visible after focus moves to the popover. */
  const paintHighlights = (range: Range) => {
    clearHighlights();
    const root = pagesRef.current;
    if (!root) return;
    const pages = [...root.querySelectorAll<HTMLElement>(".pdf-chat-page")]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > -2000 && rect.top < window.innerHeight + 2000)
      .map(({ el, rect }) => ({ el, box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }));
    const rects = textRectsOfRange(range).map((rect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }));
    for (const box of rangeHighlights(rects, pages)) {
      const span = document.createElement("span");
      span.className = "pdf-chat-hl";
      span.style.left = `${box.left}%`;
      span.style.top = `${box.top}%`;
      span.style.width = `${box.width}%`;
      span.style.height = `${box.height}%`;
      box.el.append(span);
      highlightsRef.current.push(span);
    }
  };

  const closePicked = (options: { restoreSelection: boolean }) => {
    setPicked((current) => {
      if (current && options.restoreSelection && current.range.startContainer.isConnected) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(current.range);
        clearHighlights();
        scrollRef.current?.focus({ preventScroll: true });
      }
      return null;
    });
    setSpot(null);
    setSendError("");
  };

  const pickedRef = useRef<Picked | null>(null);
  pickedRef.current = picked;
  const closePickedRef = useRef(closePicked);
  closePickedRef.current = closePicked;

  // Selecting text shows the small "Add to chat" button next to the end of the selection.
  useEffect(() => {
    const root = pagesRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return;
    const inOverlay = (target: EventTarget | null) =>
      target instanceof Node &&
      (popoverRef.current?.contains(target) === true || buttonRef.current?.contains(target) === true);
    const onPointerDown = (event: PointerEvent) => {
      if (inOverlay(event.target)) return;
      // A click anywhere else closes the button or popover without sending.
      setPicked(null);
      setSpot(null);
      // A new click in the document starts a new selection; elsewhere the painted selection stays.
      if (event.target instanceof Node && scroller.contains(event.target)) clearHighlights();
    };
    const pick = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const text = selectionText(selection.toString());
      if (!text) return;
      clearHighlights();
      setComment("");
      setSendError("");
      setCopied("idle");
      setPicked({ text, page: selectionPageNumber(range.startContainer), range: range.cloneRange(), stage: "button" });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (inOverlay(event.target)) return;
      // Let the browser finish updating the selection first.
      setTimeout(pick, 0);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (inOverlay(event.target)) return;
      if (event.shiftKey || event.key === "Shift") pick();
    };
    // Capture phase, so Escape is ours (and marked handled) before bb or other plugins act on it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const current = pickedRef.current;
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      closePickedRef.current({ restoreSelection: current.stage === "popover" });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp);
    scroller.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp);
      scroller.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [state.status]);

  // Position the button or popover in the document's own scroll space: it scrolls with the
  // selection and never depends on transforms of bb's panels around the plugin.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!picked || !scroller) {
      setSpot(null);
      return;
    }
    if (!picked.range.startContainer.isConnected) {
      setPicked(null);
      return;
    }
    const geometry = rangeGeometry(picked.range, scroller);
    if (!geometry) return;
    const view = scrollerView(scroller);
    const element = picked.stage === "button" ? buttonRef.current : popoverRef.current;
    const measured = element?.getBoundingClientRect();
    const width =
      picked.stage === "button"
        ? measured?.width || BUTTON_SIZE.width
        : Math.min(POPOVER_MAX_WIDTH, Math.max(160, view.width - 16));
    const height =
      (measured && measured.height > 0 ? measured.height : 0) ||
      (picked.stage === "button" ? BUTTON_SIZE.height : POPOVER_EST_HEIGHT);
    const placed = placeInView(geometry.union, geometry.endX, view, { width, height });
    setSpot((current) =>
      current &&
      Math.abs(current.x - placed.x) < 0.5 &&
      Math.abs(current.y - placed.y) < 0.5 &&
      Math.abs(current.width - width) < 0.5
        ? current
        : { x: placed.x, y: placed.y, width },
    );
  }, [picked, zoom, sendError]);

  useEffect(() => {
    if (picked?.stage === "popover" && spot) textareaRef.current?.focus({ preventScroll: true });
  }, [picked?.stage, spot !== null]);

  const openPopover = () => {
    if (!picked) return;
    paintHighlights(picked.range);
    setSpot(null);
    setPicked({ ...picked, stage: "popover" });
  };

  const copySelection = () => {
    if (!picked) return;
    const text = picked.text;
    void (async () => {
      let ok = await copySelectionText(text, navigator.clipboard);
      if (!ok) {
        // Older webviews: copy through a hidden field, then put the document selection back.
        const field = document.createElement("textarea");
        field.value = text;
        field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        document.body.append(field);
        field.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
        field.remove();
        const selection = window.getSelection();
        if (picked.range.startContainer.isConnected) {
          selection?.removeAllRanges();
          selection?.addRange(picked.range);
        }
      }
      setCopied(ok ? "done" : "failed");
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied("idle"), 1600);
    })();
  };

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const send = () => {
    if (!picked || busy) return;
    const block = pdfQuote(path, picked.page, picked.text, comment);
    setBusy(true);
    setSendError("");
    void sendQuote<typeof composer.draft>(composer, block)
      .then(() => {
        clearHighlights();
        window.getSelection()?.removeAllRanges();
        setPicked(null);
        setSpot(null);
        setComment("");
        scrollRef.current?.focus({ preventScroll: true });
      })
      .catch((cause: unknown) => {
        setSendError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => clearHighlights, [url]);

  if (url === null || useOriginal) return <Original />;

  const fileInput = {
    path,
    kind: source.kind,
    environmentId: source.environmentId,
    threadId: source.threadId,
  };

  return (
    <div className="pdf-chat">
      <div className="pdf-chat-bar">
        <button
          type="button"
          disabled={finderBusy}
          onClick={() => {
            setFinderBusy(true);
            setFinderError("");
            void rpc
              .call("revealInFinder", fileInput)
              .catch((cause: unknown) => {
                setFinderError(cause instanceof Error ? cause.message : String(cause));
              })
              .finally(() => setFinderBusy(false));
          }}
        >
          <Icon name="Folder" aria-hidden />
          {finderBusy ? "Opening…" : "Show in Finder"}
        </button>
        {finderError ? <span className="pdf-chat-finder-error">{finderError}</span> : null}
        <div className="pdf-chat-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out (⌘−)"
            disabled={!zoom || zoom.scale <= MIN_SCALE + 1e-6}
            onClick={() => viewerRef.current?.zoomStep(-1)}
          >
            −
          </button>
          <span className="pdf-chat-zoom-value" aria-live="polite">
            {zoom ? `${Math.round(zoom.scale * 100)}%` : "–"}
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in (⌘+)"
            disabled={!zoom || zoom.scale >= MAX_SCALE - 1e-6}
            onClick={() => viewerRef.current?.zoomStep(1)}
          >
            +
          </button>
          <button
            type="button"
            className="pdf-chat-zoom-fit"
            aria-label="Fit width"
            title="Fit width (⌘0)"
            aria-pressed={zoom ? Math.abs(zoom.scale - zoom.fitScale) < 1e-6 : false}
            disabled={!zoom}
            onClick={() => viewerRef.current?.zoomFit()}
          >
            Fit
          </button>
        </div>
      </div>
      <p className="pdf-chat-hint">Select text, then Add to chat or Copy.</p>
      {state.status === "loading" ? (
        <div className="pdf-chat-status" role="status" aria-live="polite" aria-label={`Loading ${path}`}>
          <Icon name="Spinner" className="pdf-chat-spin" aria-hidden />
          <span>{progressLabel(state)}</span>
          {state.progress?.total ? (
            <span className="pdf-chat-progress" aria-hidden>
              <span style={{ width: `${Math.round((state.progress.loaded / state.progress.total) * 100)}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}
      {state.status === "error" ? (
        <div className="pdf-chat-error" role="alert">
          <p>This PDF could not be shown. {state.message}</p>
          <div className="pdf-chat-error-actions">
            <button type="button" onClick={() => setReloadNonce((n) => n + 1)}>
              Retry
            </button>
            <button type="button" onClick={() => setUseOriginal(true)}>
              Use built-in preview
            </button>
            <button
              type="button"
              onClick={() => {
                void rpc.call("openInDefaultApp", fileInput).catch((cause: unknown) => {
                  setFinderError(cause instanceof Error ? cause.message : String(cause));
                });
              }}
            >
              Open in default app
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="pdf-chat-pages"
        hidden={state.status === "error"}
        tabIndex={0}
        aria-label={`PDF ${path}`}
      >
        <div ref={pagesRef} className="pdf-chat-doc" />
        {picked?.stage === "button" ? (
          <div
            ref={buttonRef}
            className="pdf-chat-sel"
            role="toolbar"
            aria-label="Selection actions"
            style={spot ? { left: spot.x, top: spot.y } : { left: 0, top: 0, visibility: "hidden" }}
            // Keep the document selection: a button press would otherwise clear it.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button type="button" className="pdf-chat-add" onClick={openPopover}>
              <Icon name="MessageSquarePlus" aria-hidden />
              Add to chat
            </button>
            <button type="button" className="pdf-chat-copy" onClick={copySelection}>
              <Icon name={copied === "done" ? "Check" : "Copy"} aria-hidden />
              <span aria-live="polite">{copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}</span>
            </button>
          </div>
        ) : null}
        {picked?.stage === "popover" ? (
          <div
            ref={popoverRef}
            className="pdf-chat-pop"
            role="dialog"
            aria-label="Send selection to chat"
            style={
              spot
                ? { left: spot.x, top: spot.y, width: spot.width }
                : { left: 0, top: 0, width: POPOVER_MAX_WIDTH, visibility: "hidden" }
            }
          >
            <div className="pdf-chat-pop-quote">
              <p>{picked.text}</p>
            </div>
            <p className="pdf-chat-pop-meta">
              Page {picked.page}
              {composer.isRunning ? " · will be sent after the current reply" : ""}
            </p>
            <textarea
              ref={textareaRef}
              value={comment}
              maxLength={4000}
              rows={3}
              placeholder="Your prompt (optional)"
              aria-label="Your prompt"
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                const action = popoverKeyAction({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  altKey: event.altKey,
                  isComposing: event.nativeEvent.isComposing,
                });
                if (action === "send") {
                  event.preventDefault();
                  send();
                }
              }}
            />
            {sendError ? <p className="pdf-chat-pop-error">{sendError}</p> : null}
            <div className="pdf-chat-pop-actions">
              <span className="pdf-chat-pop-hint">Enter to send · Shift+Enter for a new line</span>
              <button type="button" className="pdf-chat-send" disabled={busy} onClick={send}>
                <Icon name="ArrowUp" aria-hidden />
                {busy ? "Sending…" : "Send to chat"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "pdf-chat",
    title: "PDF to chat",
    extensions: ["pdf"],
    component: PdfFileOpener,
  });
});
