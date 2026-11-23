export function pdfQuote(
  path: string,
  page: number,
  text: string,
  comment = "",
): string {
  const quote = text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const note = comment.trim();
  return [`PDF: ${path}`, `Page ${page}`, quote, note ? `\n${note}` : ""]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function selectionPageNumber(anchor: Node | null): number {
  let node: Node | null = anchor;
  while (node) {
    if (node instanceof HTMLElement) {
      const page = Number(node.dataset.page);
      if (Number.isInteger(page) && page > 0) return page;
    }
    node = node.parentNode;
  }
  return 1;
}

/** Selected PDF text as plain lines: spacing collapsed, blank lines dropped. */
export function selectionText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/ /g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

type DraftLike = { text: string; mentions: readonly unknown[]; attachments: readonly unknown[] };

/** The part of bb's composer handle that sending a quote needs. */
export type QuoteComposer<D extends DraftLike> = {
  readonly draft: D;
  /** bb re-checks "can send" on its next render after a replacement. */
  readonly isSubmittingBlocked?: boolean;
  replace(next: { text: string; mentions: never[]; attachments: never[] } | D): void;
  submit(options: { experimental_mode: "queue-if-active" }): Promise<void>;
};

/**
 * Sends only the quote, then puts back whatever the user had typed in the
 * composer, so a half-written message is never sent along with it. bb's editor
 * re-validates a replaced draft on its next render, so wait until it may be sent.
 */
export async function sendQuote<D extends DraftLike>(composer: QuoteComposer<D>, block: string): Promise<void> {
  const saved = composer.draft;
  composer.replace({ text: block, mentions: [], attachments: [] });
  for (
    let attempt = 0;
    attempt < 60 && (composer.draft.text !== block || composer.isSubmittingBlocked === true);
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  let sent = false;
  try {
    await composer.submit({ experimental_mode: "queue-if-active" });
    sent = true;
  } finally {
    // After a failure the quote must not linger in the composer; after success keep it clean too.
    if (!sent || saved.text || saved.attachments.length > 0) composer.replace(saved);
  }
}

export type ClipboardLike = { writeText(text: string): Promise<void> };

/**
 * Copies the normalized selection text. Returns false when the clipboard refused,
 * so the caller can fall back or show nothing instead of a false "Copied".
 */
export async function copySelectionText(text: string, clipboard: ClipboardLike | undefined): Promise<boolean> {
  const value = selectionText(text);
  if (!value || !clipboard) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
