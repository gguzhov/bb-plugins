/** Only explicit, safe annotation URLs are actionable; never use unsafeUrl. */
export function allowedLinkUrl(value: unknown): value is string {
  if (typeof value !== "string" || !/^(https?:|mailto:)/i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try { return ["http:", "https:", "mailto:"].includes(new URL(value).protocol); } catch { return false; }
}

export function linkRectangle(rect: unknown, viewport: { width: number; height: number; convertToViewportRectangle: (rect: number[]) => number[] }) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(x => typeof x === "number" && Number.isFinite(x))) return null;
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  return { left: Math.min(x1!, x2!) / viewport.width * 100, top: Math.min(y1!, y2!) / viewport.height * 100,
    width: Math.abs(x2! - x1!) / viewport.width * 100, height: Math.abs(y2! - y1!) / viewport.height * 100 };
}

export async function destinationPage(dest: unknown, pdf: { numPages: number; getDestination(name: string): Promise<unknown>; getPageIndex(ref: { num: number; gen: number }): Promise<number> }): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const ref = explicit[0];
    const index = Number.isInteger(ref) ? ref : ref && Number.isInteger(ref.num) && Number.isInteger(ref.gen) ? await pdf.getPageIndex(ref) : -1;
    return index >= 0 && index < pdf.numPages ? index + 1 : null;
  } catch { return null; }
}

/** Pointer hit testing leaves native text selection in the text layer untouched. */
export function wireLinkLayer(page: HTMLElement, layer: HTMLElement): () => void {
  let down: { x: number; y: number; link: HTMLAnchorElement; moved: boolean } | null = null;
  const hit = (x: number, y: number) => [...layer.querySelectorAll<HTMLAnchorElement>("a")].find(a => {
    const r = a.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  const move = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
    const link = hit(e.clientX, e.clientY);
    page.classList.toggle("over-pdf-link", !!link);
    page.title = link?.title ?? "";
  };
  const start = (e: PointerEvent) => {
    const link = hit(e.clientX, e.clientY);
    down = e.button === 0 && link ? { x: e.clientX, y: e.clientY, link, moved: false } : null;
  };
  const click = (e: MouseEvent) => {
    if (e.target instanceof Element && layer.contains(e.target)) return;
    const prior = down; down = null;
    if (prior && !prior.moved && Math.hypot(e.clientX - prior.x, e.clientY - prior.y) <= 4 && hit(e.clientX, e.clientY) === prior.link && !window.getSelection()?.toString()) {
      e.preventDefault(); prior.link.click();
    }
  };
  const leave = () => { if (down) down.moved = true; page.classList.remove("over-pdf-link"); page.removeAttribute("title"); };
  const cancel = () => { down = null; leave(); };
  page.addEventListener("pointerdown", start);
  page.addEventListener("pointermove", move);
  page.addEventListener("click", click);
  page.addEventListener("pointerleave", leave);
  page.addEventListener("pointercancel", cancel);
  return () => {
    page.removeEventListener("pointerdown", start); page.removeEventListener("pointermove", move);
    page.removeEventListener("click", click); page.removeEventListener("pointerleave", leave); page.removeEventListener("pointercancel", cancel); cancel();
  };
}
