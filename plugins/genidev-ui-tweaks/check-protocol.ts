// Общее для сервера и окна: имя канала запроса и форма отчёта клиента.
import type { TweakResult } from "./anchors.ts";

/** Realtime-канал: сервер просит открытые окна bb проверить якоря. */
export const CHECK_CHANNEL = "check";

export interface CheckReport {
  /** Номер запроса, на который отвечает окно; null — отчёт при загрузке, без запроса. */
  id: string | null;
  results: TweakResult[];
}

/** Страж формы отчёта: окно присылает данные, серверу нельзя верить им на слово. */
export function parseReport(value: unknown): CheckReport | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, results } = value as { id?: unknown; results?: unknown };
  if (id !== null && typeof id !== "string") return null;
  if (!Array.isArray(results) || results.length > 100) return null;
  const clean: TweakResult[] = [];
  for (const r of results) {
    if (typeof r !== "object" || r === null) return null;
    const { id: rid, title, anchors } = r as { id?: unknown; title?: unknown; anchors?: unknown };
    if (typeof rid !== "string" || typeof title !== "string" || !Array.isArray(anchors) || anchors.length > 50) return null;
    const list: TweakResult["anchors"] = [];
    for (const a of anchors) {
      if (typeof a !== "object" || a === null) return null;
      const { selector, status, reason } = a as { selector?: unknown; status?: unknown; reason?: unknown };
      if (typeof selector !== "string" || selector.length > 500) return null;
      if (status !== "ok" && status !== "missing" && status !== "skipped") return null;
      list.push({ selector, status, ...(typeof reason === "string" ? { reason: reason.slice(0, 200) } : {}) });
    }
    clean.push({ id: rid.slice(0, 80), title: title.slice(0, 120), anchors: list });
  }
  return { id: id ?? null, results: clean };
}
