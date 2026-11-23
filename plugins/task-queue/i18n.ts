// Every word the plugin shows or prints for people, in English and Russian.
// The `language` setting picks one: `auto` (default) reads the page or browser
// language in the card and the machine's locale on the server; Russian when it
// starts with "ru", English otherwise. Epic and ticket names stay as the agent
// typed them. No SDK imports: tests read the dictionary directly.
import { AGENT_NAMES } from "./agent-names.ts";

export type Lang = "en" | "ru";
export const LANGUAGE_OPTIONS = ["auto", "en", "ru"] as const;
export type LanguageSetting = (typeof LANGUAGE_OPTIONS)[number];

/**
 * The language to use: an explicit `en`/`ru` wins; `auto` (or anything else)
 * is Russian when the page or the browser (any locale given) is Russian,
 * English otherwise. bb's page says "en" for everyone, so the browser decides.
 */
export function resolveLang(setting: unknown, locales: readonly (string | null | undefined)[]): Lang {
  if (setting === "en" || setting === "ru") return setting;
  return locales.some((locale) => typeof locale === "string" && locale.trim().toLowerCase().startsWith("ru")) ? "ru" : "en";
}

/** Russian plural form: plural(2, "раз", "раза", "раз") -> "раза". */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
const en = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Russian genitive after "из": "из 1 тикета", "из 5 тикетов". */
const ofRu = (n: number, one: string, many: string) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : many}`;

/** "45 s", "12 min", "1 h 05 min" / "45 с", "12 мин", "1 ч 05 мин". */
export function duration(ms: number, lang: Lang): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const [s, m, h] = lang === "ru" ? ["с", "мин", "ч"] : ["s", "min", "h"];
  if (seconds < 60) return `${seconds} ${s}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${m}`;
  return `${Math.floor(minutes / 60)} ${h} ${String(minutes % 60).padStart(2, "0")} ${m}`;
}

/** Background agents' names in English, in the order of agent-names.ts. */
const AGENT_NAMES_EN: readonly string[] = [
  "Neon", "Glitch", "Cipher", "Vector", "Nova", "Chrome", "Echo", "Quantum", "Pixel", "Zero", "Spark", "Byte", "Ghost", "Signal",
  "Volt", "Mirage", "Onyx", "Plasma", "Radar", "Synth", "Turbo", "Phantom", "Cyan", "Spectrum", "Pulse", "Cobalt", "Laser",
  "Magma", "Nickel", "Orbit", "Proton", "Mercury", "Scanner", "Titan", "Ultra", "Photon", "Hacker", "Cyclone", "Storm", "Ether",
  "Unit", "Core", "Arcade", "Bit",
];

/** «Неон» -> "Neon", «Неон 2» -> "Neon 2" in English; other names stay. */
export function agentDisplayName(name: string, lang: Lang): string {
  if (lang === "ru") return name;
  const match = /^(\S+)( \d+)?$/u.exec(name.trim());
  if (match === null) return name;
  const index = AGENT_NAMES.indexOf(match[1]!);
  return index < 0 || AGENT_NAMES_EN[index] === undefined ? name : `${AGENT_NAMES_EN[index]}${match[2] ?? ""}`;
}

export interface Dictionary {
  // Card chrome
  cardLabel: string;
  openPlan: (heading: string) => string;
  closePlan: (heading: string) => string;
  moreQueued: (n: number) => string;
  acceptancePill: (pct: number) => string;
  ticksHint: string;
  otherWork: string;
  /** Plan state words. */
  planWord: { running: string; needs_input: string; error: string; done: string };
  /** Ticket state words. */
  stepWord: { queued: string; running: string; waiting: string; rework: string; review: string; failed: string; cancelled: string; done: string };
  // Background work
  commandLabel: string;
  thinkingLine: string;
  commandsCount: (n: number) => string;
  subagent: string;
  command: string;
  agentLine: (who: string, kind: "agent" | "command", model: string | null, worked: string, now: string, guessed: boolean) => string;
  nowThinking: string;
  nowRunningCommand: (command: string | null) => string;
  nowCalling: (tool: string, text: string | null) => string;
  tokens: (n: number, short: string) => string;
  unlinked: (parts: string[]) => string;
  unlinkedCommand: (command: string | null) => string;
  // Ticket hints
  owner: (who: string) => string;
  lead: (model: string | null) => string;
  queuedFor: (span: string | null) => string;
  waitingOwner: string;
  inWorkFor: (span: string) => string;
  reworked: (times: number, ago: string | null) => string;
  totalInWork: (span: string) => string;
  inWork: (span: string | null) => string;
  queuedBefore: (span: string) => string;
  handedIn: (ago: string | null) => string;
  took: (span: string) => string;
  returned: (times: number) => string;
  accepted: string;
  finished: string;
  confirmed: (confirmed: number, criteria: number) => string;
  failedStep: string;
  skippedStep: string;
  nowPrefix: (what: string) => string;
  // Plan hints
  doneOf: (finished: number, total: number) => string;
  doneOfWithAcceptance: (finished: number, total: number, pct: number) => string;
  planState: { running: string; needs_input: string; error: string; done: string };
  planTook: (span: string, clock: string) => string;
  planRunning: (span: string, clock: string) => string;
  eta: (span: string) => string;
  acceptanceHint: (pct: number, confirmed: number, criteria: number) => string;
  ticketsInWork: (n: number) => string;
  // Server
  noPlan: string;
  removed: (n: number) => string;
  noThread: string;
  noThreadHint: string;
  notThreadId: (id: string) => string;
  unknownThread: (id: string) => string;
  unknownThreadHint: string;
  migrationFailed: (reason: string) => string;
  migrationHint: string;
  /** Agent-facing tool text: how epics are named and how the card names agents. */
  epicPattern: string;
  namesExample: string;
}

const EN: Dictionary = {
  cardLabel: "Working thread",
  openPlan: (heading) => `${heading}. Open the plan`,
  closePlan: (heading) => `${heading}. Collapse the plan`,
  moreQueued: (n) => `${n} more queued`,
  acceptancePill: (pct) => `accepted ${pct}%`,
  ticksHint: "Each mark is a ticket, wider means more work: green accepted, blue in progress, yellow in review, red failed, grey queued",
  otherWork: "Other background work",
  planWord: { running: "running", needs_input: "waiting", error: "failed", done: "done" },
  stepWord: { queued: "queued", running: "running", waiting: "waiting", rework: "rework", review: "review", failed: "failed", cancelled: "cancelled", done: "done" },
  commandLabel: "Command",
  thinkingLine: "Thinking or writing: no command is running right now",
  commandsCount: (n) => en(n, "command"),
  subagent: "subagent",
  command: "command",
  agentLine: (who, kind, model, worked, now, guessed) =>
    `${who}: ${kind === "agent" ? "subagent" : "command"}${model === null ? "" : `, ${model}`}. Running for ${worked}. Now: ${now}` +
    (guessed ? " (named by order among the running agents)" : ""),
  nowThinking: "thinking",
  nowRunningCommand: (command) => (command === null ? "running a command" : `running ${command}`),
  nowCalling: (tool, text) => `calling ${tool}${text === null ? "" : ` ${text}`}`,
  tokens: (n, short) => `${short} ${n === 1 ? "token" : "tokens"}`,
  unlinked: (parts) => `Also running, not tied to a ticket: ${parts.join(", ")}`,
  unlinkedCommand: (command) => (command === null ? "a command" : `command ${command}`),
  owner: (who) => `done by ${who}`,
  lead: (model) => (model === null ? "the lead" : `the lead (${model})`),
  queuedFor: (span) => (span === null ? "Queued" : `Queued for ${span}`),
  waitingOwner: "Waiting for the owner's answer",
  inWorkFor: (span) => `in progress for ${span}`,
  reworked: (times, ago) =>
    ago === null
      ? `Sent back for rework ${times === 1 ? "once" : `${times} times`}`
      : `Sent back for rework ${ago} ago${times > 1 ? ` (${times} times so far)` : ""}`,
  totalInWork: (span) => `in progress ${span} in total`,
  inWork: (span) => (span === null ? "In progress" : `In progress for ${span}`),
  queuedBefore: (span) => `queued ${span} before that`,
  handedIn: (ago) => (ago === null ? "Handed in for review" : `Handed in for review ${ago} ago`),
  took: (span) => `the work took ${span}`,
  returned: (times) => `sent back ${times === 1 ? "once" : `${times} times`}`,
  accepted: "Accepted",
  finished: "Done",
  confirmed: (confirmed, criteria) => `${confirmed} of ${en(criteria, "criterion", "criteria")} confirmed`,
  failedStep: "Failed: work stopped",
  skippedStep: "Cancelled: will not be done",
  nowPrefix: (what) => `Now: ${what}`,
  doneOf: (finished, total) => `${finished} of ${en(total, "ticket")} done`,
  doneOfWithAcceptance: (finished, total, pct) => `${finished} of ${en(total, "ticket")} done, ${pct}% accepted`,
  planState: {
    running: "The plan is in progress",
    needs_input: "The plan is waiting for the owner's answer",
    error: "The plan has failed: work stopped",
    done: "The plan is finished",
  },
  planTook: (span, clock) => `The plan took ${span}, started at ${clock}`,
  planRunning: (span, clock) => `In progress for ${span}, started at ${clock}`,
  eta: (span) => `About ${span} left, judging by the pace of accepted tickets`,
  acceptanceHint: (pct, confirmed, criteria) =>
    `Accepted ${pct}%: the lead confirmed ${confirmed} of ${en(criteria, "criterion", "criteria")} on accepted tickets`,
  ticketsInWork: (n) => `${n} tickets in progress`,
  noPlan: "No plan in this thread.",
  removed: (n) => `Removed ${en(n, "plan")}.`,
  noThread: "no thread: this command is not running inside a bb thread",
  noThreadHint: "Add --thread <id>, e.g. `bb task-queue plan show --thread thr_123`.",
  notThreadId: (id) => `"${id}" is not a thread id`,
  unknownThread: (id) => `thread ${id} was not found`,
  unknownThreadHint: "Check the id with `bb thread list`, or run the command inside the thread without --thread.",
  migrationFailed: (reason) => `could not read the old plans: ${reason}`,
  migrationHint: "Only needed for plans kept by an older version of the plan card; nothing else depends on it.",
  epicPattern: "Queue N: …",
  namesExample: "Neon, Glitch…",
};

const RU: Dictionary = {
  cardLabel: "Рабочий тред",
  openPlan: (heading) => `${heading}. Открыть план`,
  closePlan: (heading) => `${heading}. Свернуть план`,
  moreQueued: (n) => `ещё ${n} в очереди`,
  acceptancePill: (pct) => `приёмка ${pct}%`,
  ticksHint: "Каждое деление — тикет, шире — больше работы: зелёный принят, синий в работе, жёлтый на приёмке, красный ошибка, серый в очереди",
  otherWork: "Ещё в фоне",
  planWord: { running: "в работе", needs_input: "ждёт", error: "ошибка", done: "готово" },
  stepWord: {
    queued: "в очереди",
    running: "в работе",
    waiting: "ждёт",
    rework: "доработка",
    review: "приёмка",
    failed: "ошибка",
    cancelled: "отменён",
    done: "готов",
  },
  commandLabel: "Команда",
  thinkingLine: "Думает или пишет: команда сейчас не выполняется",
  commandsCount: (n) => `${n} ${plural(n, "команда", "команды", "команд")}`,
  subagent: "субагент",
  command: "команда",
  agentLine: (who, kind, model, worked, now, guessed) =>
    `${who} — ${kind === "agent" ? "субагент" : "команда"}${model === null ? "" : `, модель ${model}`}. Работает ${worked}. Сейчас: ${now}` +
    (guessed ? " (имя по порядку среди работающих)" : ""),
  nowThinking: "думает",
  nowRunningCommand: (command) => (command === null ? "выполняет команду" : `выполняет команду ${command}`),
  nowCalling: (tool, text) => `вызывает ${tool}${text === null ? "" : ` ${text}`}`,
  tokens: (n, short) => `${short} ${plural(n, "токен", "токена", "токенов")}`,
  unlinked: (parts) => `Ещё работают без тикета: ${parts.join(", ")}`,
  unlinkedCommand: (command) => (command === null ? "команда" : `команда ${command}`),
  owner: (who) => `делает ${who}`,
  lead: (model) => (model === null ? "ведущий" : `ведущий (${model})`),
  queuedFor: (span) => (span === null ? "В очереди" : `В очереди ${span}`),
  waitingOwner: "Ждёт ответа владельца",
  inWorkFor: (span) => `в работе ${span}`,
  reworked: (times, ago) =>
    ago === null
      ? `Возвращён на доработку ${times} ${plural(times, "раз", "раза", "раз")}`
      : `Возвращён на доработку ${ago} назад${times > 1 ? ` (уже ${times} ${plural(times, "раз", "раза", "раз")})` : ""}`,
  totalInWork: (span) => `всего в работе ${span}`,
  inWork: (span) => (span === null ? "В работе" : `В работе ${span}`),
  queuedBefore: (span) => `до этого ждал в очереди ${span}`,
  handedIn: (ago) => (ago === null ? "Сдан на приёмку" : `Сдан на приёмку ${ago} назад`),
  took: (span) => `работа заняла ${span}`,
  returned: (times) => `возвращался ${times} ${plural(times, "раз", "раза", "раз")}`,
  accepted: "Принят",
  finished: "Готов",
  confirmed: (confirmed, criteria) => `подтверждено ${confirmed} из ${ofRu(criteria, "критерия", "критериев")}`,
  failedStep: "Ошибка: работа остановлена",
  skippedStep: "Отменён: делать не будут",
  nowPrefix: (what) => `Сейчас: ${what}`,
  doneOf: (finished, total) => `Готово ${finished} из ${ofRu(total, "тикета", "тикетов")}`,
  doneOfWithAcceptance: (finished, total, pct) => `Готово ${finished} из ${ofRu(total, "тикета", "тикетов")}, приёмка ${pct}%`,
  planState: {
    running: "План в работе",
    needs_input: "План ждёт ответа владельца",
    error: "В плане ошибка: работа остановлена",
    done: "План завершён",
  },
  planTook: (span, clock) => `План занял ${span}, начат в ${clock}`,
  planRunning: (span, clock) => `План в работе ${span}, начат в ${clock}`,
  eta: (span) => `Осталось примерно ${span} — по темпу уже принятых тикетов`,
  acceptanceHint: (pct, confirmed, criteria) =>
    `Приёмка ${pct}%: ведущий подтвердил ${confirmed} из ${ofRu(criteria, "критерия", "критериев")} у принятых тикетов`,
  ticketsInWork: (n) => `${n} ${plural(n, "тикет", "тикета", "тикетов")} в работе`,
  noPlan: "В этом треде нет плана.",
  removed: (n) => `Удалено планов: ${n}.`,
  noThread: "нет треда: команда запущена не внутри треда bb",
  noThreadHint: "Добавьте --thread <id>, например `bb task-queue plan show --thread thr_123`.",
  notThreadId: (id) => `«${id}» — не id треда`,
  unknownThread: (id) => `тред ${id} не найден`,
  unknownThreadHint: "Проверьте id командой `bb thread list` или запустите команду внутри треда без --thread.",
  migrationFailed: (reason) => `не удалось прочитать старые планы: ${reason}`,
  migrationHint: "Нужно только для планов, сохранённых старой версией карточки плана; больше от этого ничего не зависит.",
  epicPattern: "Очередь N: …",
  namesExample: "Неон, Глитч…",
};

export const DICTIONARY: Record<Lang, Dictionary> = { en: EN, ru: RU };

export function t(lang: Lang): Dictionary {
  return DICTIONARY[lang];
}
