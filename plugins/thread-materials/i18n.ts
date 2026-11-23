// Every visible string of the plugin, in English and Russian. Pure: no SDK imports, so tests and the server use it too.
// The `language` setting picks the language: `auto` follows the page (then the browser), `en` and `ru` pin it.

export type Lang = "en" | "ru";
export type LanguageSetting = "auto" | "en" | "ru";

/** `auto`: Russian when the page or the browser language starts with `ru`, English otherwise. */
export function resolveLang(setting: unknown, hints: readonly (string | null | undefined)[] = []): Lang {
 if (setting === "en" || setting === "ru") return setting;
 return hints.some(h => !!h && /^ru(?:$|[-_.])/i.test(h.trim())) ? "ru" : "en";
}

/** Russian plural forms: 1 файл, 2 файла, 5 файлов. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
 const a = Math.abs(n) % 100, b = a % 10;
 return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
const pl = (lang: Lang, n: number, en: [string, string], ru: [string, string, string]) => lang === "ru" ? pluralRu(n, ...ru) : n === 1 ? en[0] : en[1];

/** English names of the executors, in the same order as AGENT_NAMES in agent-names.ts (that file is shared with task-queue and stays Russian). */
export const AGENT_NAMES_EN: readonly string[] = [
 "Neon", "Glitch", "Cipher", "Vector", "Nova", "Chrome", "Echo", "Quantum", "Pixel", "Zero", "Spark", "Byte", "Ghost", "Signal",
 "Volt", "Mirage", "Onyx", "Plasma", "Radar", "Synth", "Turbo", "Phantom", "Cyan", "Spectrum", "Pulse", "Cobalt", "Laser",
 "Magma", "Nickel", "Orbit", "Proton", "Mercury", "Scanner", "Titan", "Ultra", "Photon", "Hacker", "Cyclone", "Storm", "Ether",
 "Unit", "Core", "Arcade", "Bit",
];
/** The server names executors in Russian by launch order; in English the same ordinal gives the English name. */
export function displayAgentName(name: string | undefined, ordinal: number | undefined, lang: Lang): string | undefined {
 if (!name || lang === "ru" || !ordinal || ordinal < 1) return name;
 const n = Math.floor(ordinal), round = Math.floor((n - 1) / AGENT_NAMES_EN.length) + 1;
 const base = AGENT_NAMES_EN[(n - 1) % AGENT_NAMES_EN.length]!;
 return round === 1 ? base : base + " " + round;
}

const en = {
 // sections and chips
 results: "Results", sources: "Sources", executors: "Executors", git: "Git",
 running: "running", total: "total",
 chipGitTitle: "Changes not on GitHub yet. Click to open the diff",
 chipEmpty: "Nothing here yet",
 openSection: "Show", closeSection: "Hide",
 more: (n: number) => n + " more",
 moreTitle: "Open the full list in the right panel",
 loading: "Loading…",
 emptyAgents: "No subagents yet.",
 emptyResults: "Documents this chat creates appear here.",
 emptySources: "Files and images you attach to the chat.",
 emptyExecutors: "No subagents or child threads yet.",
 partial: "Reading history, the list will fill in.",
 // git
 gitLoading: "git…", notGit: "not a git repository", noEnv: "no working folder", gitError: "git: could not count",
 noChanges: "no changes",
 files: (n: number) => n + " " + pl("en", n, ["file", "files"], ["", "", ""]),
 commits: (n: number) => n + " " + pl("en", n, ["commit", "commits"], ["", "", ""]),
 gitHint: (o: { added: number; removed: number; commits: number; base: string; baseRef: string | null; truncated: boolean }) =>
  "uncommitted: +" + o.added + " −" + o.removed + " · not pushed: " + o.commits + " " + pl("en", o.commits, ["commit", "commits"], ["", "", ""]) +
  (o.base === "upstream" ? " (against " + o.baseRef + ")" : o.base === "merge-base" ? " (no remote branch, base " + o.baseRef + ")" : " (no remote branch)") +
  (o.truncated ? " · some files were not counted" : ""),
 openChanges: "open changes",
 gitAria: (branch: string, summary: string) => "Git: " + branch + ", " + summary + ". Open changes",
 gitSummary: (a: number, r: number, f: number) => "added " + a + ", removed " + r + ", " + f + " " + pl("en", f, ["file", "files"], ["", "", ""]),
 changedFiles: "Changed files",
 moreFiles: (n: number) => "and " + n + " more",
 binary: "binary",
 // executors
 stateRunning: "Running", stateDone: "Done", stateError: "Error", stateStopped: "Stopped",
 subagent: "Subagent", childThread: "Child thread",
 openThread: "Open thread", showInChat: "Show in chat", details: "Details in panel",
 whatWasDone: "What was done", noSummary: "No summary recorded", showFull: "Show all", collapse: "Collapse",
 acceptance: "Acceptance", startedAt: (t: string) => "Started at " + t,
 model: "Model", runTime: "Run time", toolCalls: "Tool calls", tokens: "Tokens", kind: "Kind",
 kindSubagent: "subagent", kindThread: "child thread",
 asLeader: (m: string) => "same as lead (" + m + ")",
 modelActual: (m: string) => "Actual model: " + m,
 modelRequested: (m: string) => "Model set at launch: " + m,
 modelInherited: "No model set at launch: the executor took the lead's model",
 expand: "Show result", collapseRow: "Hide result",
 action: { command: "Running", read: "Reading", edit: "Editing", search: "Searching", web: "Browsing", tool: "Using", think: "Thinking", agent: "Delegating" } as Record<string, string>,
 starting: "Starting…",
 // materials
 open: "Open", copyPath: "Copy path", copied: "Copied", remove: "Remove",
 removeAria: (t: string) => "Remove: " + t, openAria: (t: string) => "Open: " + t, copyAria: (t: string) => "Copy path: " + t,
 previewAria: (t: string) => "Preview: " + t,
 noEnvironment: "This chat has no working environment",
 add: "Add", addTitle: "Add material", archive: "Archive", archiveCount: (n: number) => "Archive" + (n ? " (" + n + ")" : ""),
 title: "Title", hrefLabel: "Link or full path", saving: "Saving…", cancel: "Cancel", restore: "Restore",
 archiveEmpty: "Nothing in the archive yet.",
 updateFailed: "Could not refresh: ", retry: "Retry",
 olderMaybe: "Earlier messages may contain more materials.", loadOlder: "Load earlier messages", historyLimit: "History limit reached.",
 pickFile: "Pick a file in the widget.", previewTab: "Preview",
 sidecar: (name: string) => "macOS service file. Showing " + name + ".",
 agentNotChosen: "No agent selected.", agentNotFound: "This executor is not in the chat history.", summaryPending: "No summary published yet.", agentWork: "Agent work",
 // remove dialog
 removeTitle: "Remove material?",
 removeText: "Keep the entry in the archive or delete it from the list. The file itself stays where it is.",
 toArchive: "Move to archive", deleteFromList: "Delete from list",
 // widget chrome
 widgetLabel: "Chat widget",
 imagePreview: "Image preview",
};
export type Dict = typeof en;

const ru: Dict = {
 results: "Результаты", sources: "Источники", executors: "Исполнители", git: "Git",
 running: "работает", total: "всего",
 chipGitTitle: "Изменения, которых ещё нет на GitHub. Нажмите, чтобы открыть",
 chipEmpty: "Пока пусто",
 openSection: "Показать", closeSection: "Скрыть",
 more: n => "ещё " + n,
 moreTitle: "Открыть весь список в правой панели",
 loading: "Загрузка…",
 emptyAgents: "Субагентов пока нет.",
 emptyResults: "Здесь появятся материалы, созданные этим чатом.",
 emptySources: "Файлы и изображения, которые вы прикрепляете к чату.",
 emptyExecutors: "Субагентов и дочерних тредов пока не было.",
 partial: "История читается, список дополнится.",
 gitLoading: "git…", notGit: "не git-репозиторий", noEnv: "нет рабочей папки", gitError: "git: не удалось посчитать",
 noChanges: "нет изменений",
 files: n => n + " " + pluralRu(n, "файл", "файла", "файлов"),
 commits: n => n + " " + pluralRu(n, "коммит", "коммита", "коммитов"),
 gitHint: o => "не закоммичено: +" + o.added + " −" + o.removed + " · не отправлено: " + o.commits + " " + pluralRu(o.commits, "коммит", "коммита", "коммитов") +
  (o.base === "upstream" ? " (относительно " + o.baseRef + ")" : o.base === "merge-base" ? " (ветки на сервере нет, база — " + o.baseRef + ")" : " (нет ветки на сервере)") +
  (o.truncated ? " · часть файлов не посчитана" : ""),
 openChanges: "открыть изменения",
 gitAria: (branch, summary) => "Git: " + branch + ", " + summary + ". Открыть изменения",
 gitSummary: (a, r, f) => "добавлено " + a + ", удалено " + r + ", " + f + " " + pluralRu(f, "файл", "файла", "файлов"),
 changedFiles: "Изменённые файлы",
 moreFiles: n => "и ещё " + n,
 binary: "двоичный",
 stateRunning: "Работает", stateDone: "Готово", stateError: "Ошибка", stateStopped: "Остановлен",
 subagent: "Субагент", childThread: "Дочерний тред",
 openThread: "Открыть тред", showInChat: "Показать в чате", details: "Подробнее в панели",
 whatWasDone: "Что сделано", noSummary: "Итог не записан", showFull: "Показать полностью", collapse: "Свернуть",
 acceptance: "Приёмка", startedAt: t => "Запущен в " + t,
 model: "Модель", runTime: "Время работы", toolCalls: "Вызовы инструментов", tokens: "Токены", kind: "Тип",
 kindSubagent: "субагент", kindThread: "дочерний тред",
 asLeader: m => "как у ведущего (" + m + ")",
 modelActual: m => "Фактическая модель: " + m,
 modelRequested: m => "Модель указана при запуске: " + m,
 modelInherited: "Модель при запуске не указана: исполнитель взял модель ведущего",
 expand: "Показать итог", collapseRow: "Скрыть итог",
 action: { command: "Команда", read: "Читает", edit: "Правит", search: "Ищет", web: "В сети", tool: "Инструмент", think: "Думает", agent: "Поручает" },
 starting: "Запускается…",
 open: "Открыть", copyPath: "Скопировать путь", copied: "Скопировано", remove: "Убрать",
 removeAria: t => "Убрать: " + t, openAria: t => "Открыть: " + t, copyAria: t => "Скопировать путь: " + t,
 previewAria: t => "Предпросмотр: " + t,
 noEnvironment: "У чата нет рабочего окружения",
 add: "Добавить", addTitle: "Добавить материал", archive: "Архив", archiveCount: n => "Архив" + (n ? " (" + n + ")" : ""),
 title: "Название", hrefLabel: "Ссылка или полный путь", saving: "Сохранение…", cancel: "Отмена", restore: "Вернуть",
 archiveEmpty: "В архиве пока нет материалов.",
 updateFailed: "Не удалось обновить: ", retry: "Повторить",
 olderMaybe: "В более ранних сообщениях могут быть другие материалы.", loadOlder: "Загрузить более ранние сообщения", historyLimit: "Достигнут предел просмотра истории.",
 pickFile: "Выберите файл в виджете.", previewTab: "Просмотр",
 sidecar: name => "Служебный файл macOS. Показан " + name + ".",
 agentNotChosen: "Агент не выбран.", agentNotFound: "Исполнитель не найден в истории чата.", summaryPending: "Итог пока не опубликован.", agentWork: "Работа агента",
 removeTitle: "Убрать материал?",
 removeText: "Можно сохранить запись в архиве или удалить её из списка. Сам файл останется на месте.",
 toArchive: "В архив", deleteFromList: "Удалить из списка",
 widgetLabel: "Виджет чата",
 imagePreview: "Предпросмотр изображения",
};

export const DICT: Record<Lang, Dict> = { en, ru };
export const dict = (lang: Lang): Dict => DICT[lang];

/** Server-side strings (CLI, errors, notices) follow the same setting. */
export const SERVER_TEXT: Record<Lang, { notArtifact: string; limit: string; indexLimited: string; partialHistory: string; notFound: string; badPath: string }> = {
 en: {
  notArtifact: "Add a meaningful document or artifact. Code, configs, README, logs and test files do not belong here.",
  limit: "Limit reached: 200 materials.",
  indexLimited: "The index keeps at most 1000 materials.",
  partialHistory: "History was read partly: the first 20 pages from the newest messages.",
  notFound: "This material is not in this chat.",
  badPath: "Invalid path",
 },
 ru: {
  notArtifact: "Добавьте содержательный документ или артефакт. Код, конфиги, README, логи и проверочные файлы сюда не входят.",
  limit: "Достигнут лимит: 200 материалов.",
  indexLimited: "Индекс ограничен 1000 материалами.",
  partialHistory: "История прочитана частично: первые 20 страниц от новых сообщений.",
  notFound: "Материал не найден в этом чате.",
  badPath: "Недопустимый путь",
 },
};
