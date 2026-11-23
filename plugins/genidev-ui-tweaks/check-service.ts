// Сервер: ждёт отчёт открытого окна bb на запрос `bb genidev-ui-tweaks check`. Ничего не крутится в покое:
// запрос живёт только пока идёт команда, таймер ставится на время ожидания и снимается.
import { formatReport } from "./anchors.ts";
import type { CheckReport } from "./check-protocol.ts";

export interface CheckService {
  /** Принять отчёт окна. */
  report(report: CheckReport): void;
  /** Запросить проверку у окон и напечатать таблицу. */
  run(): Promise<{ exitCode: number; text: string }>;
}

export function createCheckService(
  request: (id: string) => void,
  options: { waitMs?: number; now?: () => number; newId?: () => string } = {},
): CheckService {
  const waitMs = options.waitMs ?? 6000;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => Math.random().toString(36).slice(2, 10));
  const waiting = new Map<string, (report: CheckReport) => void>();
  let last: { at: number; report: CheckReport } | null = null;

  return {
    report(report) {
      last = { at: now(), report };
      if (report.id !== null) {
        const done = waiting.get(report.id);
        if (done) {
          waiting.delete(report.id);
          done(report);
        }
      }
    },
    async run() {
      const id = newId();
      const answer = await new Promise<CheckReport | null>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve(null);
        }, waitMs);
        waiting.set(id, (report) => {
          clearTimeout(timer);
          resolve(report);
        });
        request(id);
      });
      if (answer !== null) return formatReport(answer.results);
      if (last !== null) {
        const time = new Date(last.at).toLocaleTimeString("ru-RU");
        const note = `Окно bb не ответило за ${waitMs / 1000} с, показан снимок, снятый при загрузке в ${time} (мог быть до открытия треда).\n`;
        return formatReport(last.report.results, note.trimEnd());
      }
      return {
        exitCode: 2,
        text: "Нет открытого окна bb с плагином: проверять нечего. Откройте bb, откройте любой тред и запустите команду ещё раз.\n",
      };
    },
  };
}
