// Why an executor failed: turns the raw error text from the thread log into one short human line.
// Pure: no SDK imports. Source in the log: the `error` field of the `backgroundTask` item
// (event `item/backgroundTask/completed`, taskStatus "failed"), or of a failed `delegation` item.

import { dict, type Lang } from "./i18n.ts";

export type ErrorKind = "limit" | "context" | "stopped" | "network" | "other" | "none";
export type ErrorReason = {
 kind: ErrorKind;
 /** One line for the row. */
 text: string;
 /** Cleaned original text for the tooltip (up to 500 characters); empty when nothing was recorded. */
 full: string;
};

const FULL_MAX = 500, SHORT_MAX = 120;

/** Removes request ids, keys, tokens and file paths; collapses whitespace. */
export function sanitizeError(raw: string): string {
 return raw
  .replace(/[,;]?\s*\(?\s*(?:request[ _-]?id|req(?:uest)?[ _-]?id|trace[ _-]?id|x-request-id)\s*[:=]?\s*[\w.-]+\s*\)?/gi, "")
  .replace(/\breq_[A-Za-z0-9]+/g, "")
  .replace(/\b(?:sk|pk|rk|ghp|gho|github_pat|xox[abprs]|AKIA|AIza)[-_A-Za-z0-9]{8,}/g, "")
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer")
  .replace(/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1")
  .replace(/(?:file:\/\/)?(?:~|\/(?:Users|Volumes|private|tmp|var|home|opt|etc|root)|[A-Za-z]:\\)[^\s,;)"'`]*/g, "")
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "")
  .replace(/\(\s*[,;\s]*\)/g, "")
  .replace(/\(\s*[,;]\s*/g, "(")
  .replace(/\s*[,;]\s*\)/g, ")")
  .replace(/\s+/g, " ")
  .replace(/\s+([,.;:)])/g, "$1")
  .trim();
}

const clipTo = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);

const STOPPED = /\b(?:interrupted|aborted|cancel(?:l)?ed|killed|stopped|terminated)\s+by\s+(?:the\s+)?(?:user|lead|leader|parent|owner)\b|\buser\s+(?:interrupted|aborted|cancel(?:l)?ed|stopped)\b|\b(?:AbortError|request was aborted|interrupted by user|task (?:was )?(?:stopped|killed))\b/i;
const CONTEXT = /\bcontext[ _-]?(?:window|length|limit|size)\b|\bprompt is too long\b|\btoo many tokens\b|\bmaximum context\b|\bexceeds? the (?:model'?s )?(?:maximum|context)\b|\bcontext_length_exceeded\b|\binput is too long\b/i;
const LIMIT = /\b(?:weekly|daily|monthly|hourly|usage|rate|plan|session|5-hour)[ _-]?limit\b|\bhit your (?:\w+ )?limit\b|\bHTTP 429\b|\b429\b|\bquota\b|\brate_limit/i;
const NETWORK = /\bHTTP 5\d\d\b|\b(?:status|code)\s*:?\s*5\d\d\b|\boverloaded\b|\btime(?:d)?[ -]?out\b|\bETIMEDOUT\b|\bECONN(?:RESET|REFUSED|ABORTED)\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bsocket hang up\b|\bfetch failed\b|\bnetwork (?:error|is unreachable|unavailable)\b|\bservice unavailable\b|\bbad gateway\b|\bgateway time-?out\b|\binternal server error\b|\bapi_error\b|\bConnection (?:error|closed|reset)\b/i;

const ZONES: Record<string, { ru: string; en: string }> = {
 "Europe/Moscow": { ru: "по Москве", en: "Moscow time" },
 "UTC": { ru: "по UTC", en: "UTC" },
};

/** "resets 7am (Europe/Moscow)" -> "сброс в 7:00 по Москве" / "resets at 7:00 AM Moscow time"; null when no time is named. */
export function resetText(raw: string, lang: Lang): string | null {
 const m = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]{1,40})\))?/i.exec(raw);
 if (!m) return null;
 let h = Number(m[1]);
 const min = m[2] ?? "00", mer = m[3]?.toLowerCase();
 if (mer && (h < 1 || h > 12)) return null;
 if (!mer && h > 23) return null;
 if (Number(min) > 59) return null;
 const zoneRaw = m[4]?.trim();
 const zone = zoneRaw ? (ZONES[zoneRaw]?.[lang] ?? "(" + zoneRaw.replace(/[^\w/+:-]/g, "") + ")") : "";
 let clock: string;
 if (lang === "ru") {
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  clock = h + ":" + min;
 } else clock = mer ? h + ":" + min + " " + mer.toUpperCase() : (h > 12 ? h - 12 : h || 12) + ":" + min + " " + (h >= 12 ? "PM" : "AM");
 return dict(lang).errReset(clock, zone);
}

/** The reason line for a failed executor. `raw` is the error text from the log (null/empty: nothing recorded). */
export function explainError(raw: string | null | undefined, lang: Lang = "ru"): ErrorReason {
 const t = dict(lang);
 const clean = sanitizeError(typeof raw === "string" ? raw : "");
 if (!clean) return { kind: "none", text: t.errNone, full: "" };
 const full = clipTo(clean, FULL_MAX);
 if (STOPPED.test(clean)) return { kind: "stopped", text: t.errStopped, full };
 if (CONTEXT.test(clean)) return { kind: "context", text: t.errContext, full };
 if (LIMIT.test(clean)) {
  const reset = resetText(clean, lang);
  return { kind: "limit", text: reset ? t.errLimit + " · " + reset : t.errLimit, full };
 }
 if (NETWORK.test(clean)) return { kind: "network", text: t.errNetwork, full };
 const body = clean.replace(/^Agent terminated early due to an API error:\s*/i, "").trim() || clean;
 return { kind: "other", text: clipTo(body, SHORT_MAX), full };
}
