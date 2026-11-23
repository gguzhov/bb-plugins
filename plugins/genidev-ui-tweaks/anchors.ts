// Манифест «якорей»: для каждой правки плагина перечислены ключевые селекторы разметки bb, без которых она не работает.
// По нему `bb genidev-ui-tweaks check` после обновления bb говорит, какая правка тихо перестала работать.
// Модуль чистый (без React и без браузерных API, кроме переданного document), поэтому его проверяют тесты.

/** Селектор, который должен найтись в живом окне bb. */
export interface Anchor {
  /** CSS-селектор; через запятую — достаточно любого из них. */
  selector: string;
  /**
   * Когда якоря может не быть, не считая это ошибкой: если `when` — селектор и он не найден, или `when === null`
   * (состояние не проверить без действий пользователя), якорь получает статус «не проверено».
   * Без `when` якорь обязателен всегда.
   */
  when?: string | null;
  /** Почему якорь не проверен, по-русски: «панель закрыта». */
  whenLabel?: string;
}

/** Одна правка плагина: название для владельца, файлы стилей, ключевые якоря. */
export interface Tweak {
  id: string;
  title: string;
  /** Файлы styles/*.css этой правки; по ним тест проверяет, что манифест не устарел. */
  css: readonly string[];
  anchors: readonly Anchor[];
}

const PANEL_OPEN = '[data-panel-id="thread-detail-secondary-panel"] > aside[aria-hidden="false"], button[aria-label^="Hide right panel"]';
const THREAD_OPEN = '[data-panel-id="thread-detail-timeline-panel"]';
const SIDEBAR = '[data-sidebar="sidebar"]';

export const TWEAKS: readonly Tweak[] = [
  {
    id: "pin-icon",
    title: "Значок закрепления",
    css: ["pin-icon.css"],
    anchors: [
      {
        selector: 'button[aria-label="Unpin thread context"], button[aria-label="Pin thread context"]',
        when: null,
        whenLabel: "кнопка закрепления видна только в карточке контекста треда",
      },
    ],
  },
  {
    id: "panel-motion",
    title: "Плавный выезд панели",
    css: ["panel-motion.css"],
    anchors: [
      { selector: '[data-panel-id="thread-detail-timeline-panel"][data-panel-size]', when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: '[data-split-resize-grid-root]', when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: "[data-resize-handle]", when: PANEL_OPEN, whenLabel: "панель закрыта" },
      { selector: '[data-panel-id="thread-detail-secondary-panel"][data-panel-size]', when: PANEL_OPEN, whenLabel: "панель закрыта" },
      { selector: '[data-panel-id="thread-detail-secondary-panel"] > aside[data-surface-tone]', when: PANEL_OPEN, whenLabel: "панель закрыта" },
    ],
  },
  {
    id: "header-order",
    title: "Порядок кнопок шапки",
    css: ["header-order.css", "header-collapse.css"],
    anchors: [
      { selector: '[data-testid="app-page-header-content-row"] .bb-thread-title', when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: '[data-testid="app-page-header-content-row"] button[aria-label="Thread actions"]', when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: '[data-thread-header-pane-actions], [data-thread-header-workflow-actions]', when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: '[data-thread-header-workflow-actions] > [data-bb-plugin] button[data-burn-chip-button]', when: null },
      { selector: '[data-thread-header-responsive-action]', when: null, whenLabel: "адаптивное действие шапки не видно" },
      { selector: '[data-thread-header-pane-actions] button[aria-label^="Show right panel"], [data-thread-header-pane-actions] button[aria-label="Close pane"]', when: null },
    ],
  },
  {
    id: "header-actions",
    title: "Кнопки шапки «Open in…»",
    css: ["header-actions.css", "header-touch.css"],
    anchors: [
      { selector: '[data-testid="app-page-header-content-row"], [data-thread-header-pane-actions]', when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: '[data-thread-header-responsive-action] button[aria-label^="Open workspace in"], [data-thread-header-responsive-action] button[aria-label^="Choose another app"]', when: null },
      { selector: '[data-thread-header-workflow-actions] > [data-bb-plugin] button[data-burn-chip-button]', when: null },
      { selector: 'button[aria-label^="Toggle sidebar"], button[aria-label="Thread actions"]', when: null },
      { selector: '[data-testid="thread-secondary-panel-top-chrome"] [data-tab-pill] [data-icon-root]', when: null },
      { selector: 'button[aria-label="Next tab"], button[aria-label="Previous tab"], [data-panel-new-tab], button[aria-label^="Hide right panel"]', when: null },
    ],
  },
  {
    id: "panel-tabs",
    title: "Ряд вкладок правой панели",
    css: ["panel-bar.css"],
    anchors: [
      { selector: '[data-testid="thread-secondary-panel-top-chrome"] [data-sidebar-split-tab-group]', when: PANEL_OPEN, whenLabel: "панель закрыта" },
      { selector: '[data-tab-pill] [data-icon-root], [data-panel-new-tab]', when: null },
      { selector: 'button[aria-label="Next tab"], button[aria-label="Previous tab"]', when: null },
    ],
  },
  {
    id: "panel-close",
    title: "Крестик закрытия панели",
    css: ["panel-close.css"],
    anchors: [
      {
        selector: '[data-testid="thread-secondary-panel-top-chrome"] button[aria-label^="Hide right panel"]',
        when: PANEL_OPEN,
        whenLabel: "панель закрыта",
      },
    ],
  },
  {
    id: "close-on-chat",
    title: "Закрытие по клику на чат",
    css: [],
    anchors: [
      { selector: '[data-panel-id="thread-detail-timeline-panel"]', when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: '[data-panel-id="thread-detail-secondary-panel"] > aside[aria-hidden="false"]', when: PANEL_OPEN, whenLabel: "панель закрыта" },
      { selector: '[data-testid="thread-secondary-panel-top-chrome"] button[aria-label^="Hide right panel"]', when: PANEL_OPEN, whenLabel: "панель закрыта" },
      { selector: "[data-app-composer], [data-follow-up-composer], [data-promptbox]", when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: "[data-thread-toc]", when: THREAD_OPEN, whenLabel: "тред не открыт" },
    ],
  },
  {
    id: "message-nav",
    title: "Навигатор сообщений",
    css: ["message-nav.css"],
    anchors: [
      { selector: "[data-thread-toc]", when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: '[data-thread-toc] [id^="thread-toc-panel"]', when: '[data-thread-toc] button[aria-expanded="true"]', whenLabel: "навигатор свёрнут" },
    ],
  },
  {
    id: "send-label",
    title: "Кнопка отправки с подписью",
    css: ["third-party-fixes.css"],
    anchors: [
      { selector: ".bb-app-shell" },
      { selector: "[data-promptbox-action-row]", when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: "[data-promptbox] [data-promptbox-submit-action]", when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: "[data-promptbox-submit-group], [data-promptbox-send-menu]", when: null, whenLabel: "группа кнопки отправки видна не всегда" },
      { selector: "[data-promptbox-submit-label]", when: null, whenLabel: "подпись есть только при передаче треда" },
    ],
  },
  {
    id: "sidebar-title",
    title: "Название треда в сайдбаре",
    css: ["third-party-fixes.css"],
    anchors: [
      { selector: "[data-sidebar-rename-row]", when: SIDEBAR, whenLabel: "сайдбар не показан" },
      { selector: ".bb-thread-title", when: SIDEBAR, whenLabel: "сайдбар не показан" },
      { selector: "[data-sidebar-thread-trailing]", when: null, whenLabel: "значок статуса есть только у тредов с активностью" },
    ],
  },
  {
    id: "composer-corner",
    title: "Угол поля ввода без кнопки стопки",
    css: ["third-party-fixes.css"],
    anchors: [
      { selector: "[data-promptbox]", when: THREAD_OPEN, whenLabel: "тред не открыт" },
      { selector: "[data-lg-dock-glyph]", when: null, whenLabel: "кнопка стопки есть только при карточках над полем" },
    ],
  },
];

export type AnchorStatus = "ok" | "missing" | "skipped";

export interface AnchorResult {
  selector: string;
  status: AnchorStatus;
  /** Для «не проверено»: почему. */
  reason?: string;
}

export interface TweakResult {
  id: string;
  title: string;
  anchors: AnchorResult[];
}

/** Что нужно от документа: только querySelector. */
export interface QueryDoc {
  querySelector(selector: string): unknown;
}

/** Проверяет якоря в документе; одно обращение querySelector на якорь и на условие, ничего не запоминает. */
export function runAnchors(doc: QueryDoc, tweaks: readonly Tweak[] = TWEAKS): TweakResult[] {
  return tweaks.map((tweak) => ({
    id: tweak.id,
    title: tweak.title,
    anchors: tweak.anchors.map((anchor): AnchorResult => {
      if (doc.querySelector(anchor.selector) !== null) return { selector: anchor.selector, status: "ok" };
      const reason = anchor.whenLabel ?? "условие не выполнено";
      if (anchor.when === null) return { selector: anchor.selector, status: "skipped", reason };
      if (anchor.when !== undefined && doc.querySelector(anchor.when) === null) return { selector: anchor.selector, status: "skipped", reason };
      return { selector: anchor.selector, status: "missing" };
    }),
  }));
}

export type TweakStatus = "ok" | "broken" | "unchecked";

export function tweakStatus(result: TweakResult): TweakStatus {
  if (result.anchors.some((a) => a.status === "missing")) return "broken";
  if (result.anchors.length > 0 && result.anchors.every((a) => a.status === "skipped")) return "unchecked";
  return "ok";
}

/** Строка статуса по-русски. */
export function statusText(result: TweakResult): string {
  const missing = result.anchors.filter((a) => a.status === "missing");
  if (missing.length > 0) return `якорь не найден: ${missing.map((a) => a.selector).join("; ")}`;
  const skipped = [...new Set(result.anchors.filter((a) => a.status === "skipped").map((a) => a.reason ?? ""))];
  if (tweakStatus(result) === "unchecked") return `не проверено: ${skipped.join("; ")}`;
  return skipped.length > 0 ? `работает (часть не проверена: ${skipped.join("; ")})` : "работает";
}

/** Таблица для `bb genidev-ui-tweaks check` и код выхода: 1, если хоть один якорь не найден. */
export function formatReport(results: readonly TweakResult[], note?: string): { text: string; exitCode: number } {
  const width = Math.max(...results.map((r) => r.title.length), 6);
  const lines = results.map((r) => `${r.title.padEnd(width)}  ${statusText(r)}`);
  const broken = results.filter((r) => tweakStatus(r) === "broken").length;
  const unchecked = results.filter((r) => tweakStatus(r) === "unchecked").length;
  const summary =
    broken > 0
      ? `Не работает правок: ${broken} из ${results.length}. Откройте тред в bb и посмотрите, что изменилось в разметке.`
      : `Все ${results.length - unchecked} проверенных правок работают${unchecked > 0 ? `, не проверено: ${unchecked}` : ""}.`;
  const text = [note, `${"Правка".padEnd(width)}  Состояние`, ...lines, "", summary].filter((l) => l !== undefined).join("\n") + "\n";
  return { text, exitCode: broken > 0 ? 1 : 0 };
}
