// Short thread titles: trims every thread title to at most `maxWords` words
// (setting, default 4). bb has no title-length setting, so the plugin shortens
// titles after bb (or the AI title service) writes them: when a thread is
// created, starts a turn, and finishes a turn.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const DEFAULT_MAX_WORDS = 4;
export const MIN_MAX_WORDS = 2;
export const MAX_MAX_WORDS = 12;

/** Short words a title must not end on after a cut (English and Russian). */
const DANGLING = new Set(
  (
    // articles, prepositions, conjunctions, particles (English)
    "a an the and or but nor so yet of in on at by for to with from into onto over under about as if than that " +
    // prepositions, conjunctions, particles (Russian)
    "в во на по с со к ко о об обо от до из у за для без под над при про через между и а но или да то что чтобы как не ни же бы ли"
  ).split(" "),
);

const TRAILING_PUNCTUATION = /[\s,.:;!?…—–-]+$/u;
const trimTail = (text: string) => text.replace(TRAILING_PUNCTUATION, "");

export function clampMaxWords(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_MAX_WORDS;
  return Math.min(MAX_MAX_WORDS, Math.max(MIN_MAX_WORDS, n));
}

/** Returns the shortened title, or null when the title already fits (it is never touched then). */
export function shortenTitle(title: string, maxWords: number = DEFAULT_MAX_WORDS): string | null {
  const limit = clampMaxWords(maxWords);
  const words = title.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= limit) return null;
  let kept = words.slice(0, limit);
  // Drop dangling short words, but always keep at least one word.
  while (kept.length > 1) {
    const last = trimTail(kept[kept.length - 1]).toLowerCase();
    if (last !== "" && !DANGLING.has(last)) break;
    kept = kept.slice(0, -1);
  }
  return trimTail(kept.join(" "));
}

const maxWordsSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "short-titles",
    validate: (value: unknown) =>
      typeof value === "number" && Number.isInteger(value) && value >= MIN_MAX_WORDS && value <= MAX_MAX_WORDS
        ? { value }
        : { issues: [{ message: `Enter a whole number from ${MIN_MAX_WORDS} to ${MAX_MAX_WORDS}.` }] },
  },
};

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    maxWords: {
      type: "number",
      label: "Maximum words in a title",
      description: "Titles longer than this are cut to this many words (whole number, 2-12). Shorter titles are left alone.",
      default: DEFAULT_MAX_WORDS,
      experimental_schema: maxWordsSchema,
    },
  });
  let maxWords = clampMaxWords((await settings.get()).maxWords);
  settings.onChange((next) => {
    maxWords = clampMaxWords(next.maxWords);
  });

  const shorten = async (thread: { id: string; title?: string | null }) => {
    const next = thread.title ? shortenTitle(thread.title, maxWords) : null;
    if (!next) return;
    await bb.sdk.threads.update({ threadId: thread.id, title: next });
  };
  const handle = ({ thread }: { thread: { id: string; title?: string | null } }) =>
    shorten(thread).catch((cause: unknown) =>
      bb.log.warn(`short-titles: ${cause instanceof Error ? cause.message : String(cause)}`),
    );
  bb.events.on("thread.created", handle);
  bb.events.on("thread.active", handle);
  bb.events.on("thread.idle", handle);
}
