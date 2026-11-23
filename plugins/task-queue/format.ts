// Pure presentation helpers for the card: ticket codes, times, numbers.
// No SDK imports, so tests run them with plain `node --test`.

/** Words that end a title in capitals but name a thing, not a ticket's team. */
const NOT_CODES = new Set([
  "API", "SQL", "CSS", "HTML", "URL", "JSON", "YAML", "XML", "PDF", "CSV", "SSH", "HTTP", "HTTPS",
  "CLI", "SDK", "RLS", "CRM", "SEO", "DNS", "SSL", "TLS", "JWT", "RPC", "REST", "CPU", "GPU", "RAM",
  "UI", "UX", "CI", "CD", "TODO",
]);
const CODE = /^[A-Z]{2,4}$/;

export interface TicketTitle {
  /** First trailing code, or null. */
  code: string | null;
  /** Further trailing codes, in order. */
  extra: string[];
  /** The title without its trailing codes. */
  name: string;
}

/**
 * A ticket title may end in team codes of 2-4 capital Latin letters:
 * "Справочники DI DP" -> code DI, extra [DP], name "Справочники". A title that
 * is only a code, or ends in a well-known acronym (API, SQL...), stays whole.
 */
export function ticketTitle(title: string): TicketTitle {
  const words = title.trim().split(/\s+/).filter((word) => word !== "");
  let cut = words.length;
  while (cut > 1 && CODE.test(words[cut - 1]!) && !NOT_CODES.has(words[cut - 1]!)) cut -= 1;
  const codes = words.slice(cut);
  if (codes.length === 0) return { code: null, extra: [], name: words.join(" ") };
  return { code: codes[0]!, extra: codes.slice(1), name: words.slice(0, cut).join(" ") };
}

/** Long form, for the plan row: "19m 14s", "1h 5m". */
export function elapsed(startedAt: number | null, now: number): string {
  if (startedAt === null) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Short form for pills: no seconds once a minute has passed. "45s", "19m", "1h 5m". */
export function elapsedShort(startedAt: number | null, now: number): string {
  if (startedAt === null) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  return `${h}h ${minutes % 60}m`;
}

/** 950 -> "950", 1234 -> "1.2k", 163000 -> "163k". */
export function compactNumber(value: number): string {
  if (value < 1000) return String(value);
  const k = value / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

// ── Display helpers for the plan card (task-queue) ─────────────────────────────

/** A leading ticket code: 2-4 capital Latin letters or digits, a letter first. */
const LEADING_CODE = /^[A-Z][A-Z0-9]{1,3}$/;

/**
 * "Волна 1: исследования" -> "Очередь 1: исследования", "волна v5" -> "Очередь v5".
 * Only a leading word "Волна" (any case) is replaced; "волна" inside a name,
 * or a longer word ("Волнами"), stays. Display only: stored names never change.
 */
export function queueName(name: string): string {
  return name.replace(/^(\s*)волна(?!\p{L})/iu, "$1Очередь");
}

/**
 * Who does the ticket, for its left pill: the owner in full. "lead" or
 * "ведущий" alone reads "Lead"; with a model after it, "Lead: <model>".
 */
export function ownerLabel(owner: string): string {
  const flat = owner.replace(/\s+/g, " ").trim();
  const lead = /^(?:lead|ведущий)(?![\p{L}\d])[\s:,·—-]*(.*)$/iu.exec(flat);
  if (lead !== null) return lead[1] === "" ? "Lead" : `Lead: ${lead[1]}`;
  return flat;
}

const MODEL = /^(?:haiku|sonnet|opus|fable)\s+\d+(?:\.\d+)*$/i;
const capital = (word: string) => word.charAt(0).toLocaleUpperCase() + word.slice(1);

/** One trailing comma part of an old-style title, if it is one the card knows. */
function legacyTail(part: string): { points?: number; criteria?: number; owner?: string } | null {
  const text = part.trim();
  let match = /^(\d{1,3})\s*(?:б\.?|балл(?:а|ов)?|pts?|points?)$/iu.exec(text);
  if (match !== null) {
    const value = Number(match[1]);
    return value >= 1 && value <= 100 ? { points: value } : null;
  }
  match = /^(\d{1,2})\s*критери(?:й|я|ев)$/iu.exec(text);
  if (match !== null) return { criteria: Number(match[1]) };
  match = /^(?:(ведущий|lead)(?![\p{L}\d])\s*:?\s*)?(.*)$/iu.exec(text);
  if (match !== null) {
    const model = match[2]!.trim();
    if (model === "" && match[1] !== undefined) return { owner: "Lead" };
    if (MODEL.test(model)) {
      const name = model.split(/\s+/).map(capital).join(" ");
      return { owner: match[1] === undefined ? name : `Lead: ${name}` };
    }
  }
  return null;
}

export interface LegacyTitle extends TicketTitle {
  points?: number;
  criteria?: number;
  owner?: string;
}

/**
 * Reads a title written before tickets had fields:
 * "RH вместимость участка, 3 б., Sonnet 5.5, 7 критериев" -> code RH,
 * name "вместимость участка", 3 points, owner "Sonnet 5.5", 7 criteria.
 * Only trailing comma parts the card recognises are cut, so a comma inside the
 * name stays. A code is taken from the start, else from the end.
 */
export function legacyTitle(title: string): LegacyTitle {
  const parts = title.split(",");
  const found: { points?: number; criteria?: number; owner?: string } = {};
  while (parts.length > 1) {
    const tail = legacyTail(parts[parts.length - 1]!);
    if (tail === null) break;
    const key = Object.keys(tail)[0] as keyof typeof tail;
    if (found[key] !== undefined) break;
    Object.assign(found, tail);
    parts.pop();
  }
  let rest = parts.join(",").trim();
  // A title that is only "Sonnet 5.5" or "3 б." keeps its words.
  if (rest === "") rest = title.trim();
  const words = rest.split(/\s+/).filter((word) => word !== "");
  let lead: string | null = null;
  if (words.length > 1 && LEADING_CODE.test(words[0]!) && !NOT_CODES.has(words[0]!)) {
    lead = words.shift()!;
    // "RH · вместимость" / "RH: вместимость" / "RH - вместимость": the separator goes too.
    if (words.length > 1 && /^[·:—–-]$/.test(words[0]!)) words.shift();
  }
  const trailing = ticketTitle(words.join(" "));
  const result: LegacyTitle =
    lead === null
      ? { ...trailing }
      : { code: lead, extra: trailing.code === null ? [] : [trailing.code, ...trailing.extra], name: trailing.name };
  if (found.points !== undefined) result.points = found.points;
  if (found.criteria !== undefined) result.criteria = found.criteria;
  if (found.owner !== undefined) result.owner = found.owner;
  return result;
}

/** "PF LT · Замер" -> "Замер"; a title without a separator after the capitals stays whole. */
export function withoutLeadingCodes(title: string): string {
  const match = /^(?:[A-Z][A-Z0-9]{1,3})(?:[ ,]+[A-Z][A-Z0-9]{1,3})*\s*[·—–:]\s*(\S.*)$/.exec(title.trim());
  if (match === null) return title.trim();
  const head = title.trim().slice(0, title.trim().length - match[1]!.length);
  // "PDF: отчёт" names a thing: a single well-known acronym before a colon stays.
  if (/^\s*([A-Z]{2,5})\s*:\s*$/.test(head) && NOT_CODES.has(head.replace(/[\s:]/g, ""))) return title.trim();
  return match[1]!.trim();
}

export interface TicketView {
  code: string | null;
  /** Further codes found in the title. */
  extra: string[];
  /** The title to print: without the parts read off it. */
  name: string;
  points?: number;
  criteria?: number;
  owner?: string;
}

/**
 * What the card prints for a ticket. A ticket with any field set (code,
 * points, owner, criteria) is taken as sent: only a trailing code is read off
 * its title when it has no code. A ticket with none is read as an old-style
 * title (legacyTitle). Fields set always win.
 */
export function ticketView(step: {
  title: string;
  code?: string;
  points?: number;
  owner?: string;
  criteria?: number;
}): TicketView {
  const hasFields =
    step.code !== undefined || step.points !== undefined || step.owner !== undefined || step.criteria !== undefined;
  if (hasFields) {
    const parsed = ticketTitle(step.title);
    // Codes are never shown: a sent code is also cut from the title's start ("PF · Замер") and end.
    const view: TicketView =
      step.code === undefined
        ? { code: parsed.code, extra: parsed.extra, name: parsed.name }
        : { code: step.code, extra: [], name: ticketTitle(withoutLeadingCodes(step.title)).name };
    if (step.points !== undefined) view.points = step.points;
    if (step.criteria !== undefined) view.criteria = step.criteria;
    if (step.owner !== undefined) view.owner = step.owner;
    return view;
  }
  return legacyTitle(step.title);
}
