// Человеческие имена фоновых исполнителей треда по порядковому номеру запуска (1 — первый запущенный).
// Файл одинаковый в плагинах task-queue и thread-materials (тест в task-queue сверяет копии):
// имя считается в обоих местах одной функцией, поэтому в карточке плана и в разделе «Субагенты» оно совпадает.

/** Первый круг — имена в духе киберпанка. */
export const AGENT_NAMES: readonly string[] = [
  "Неон", "Глитч", "Шифр", "Вектор", "Нова", "Хром", "Эхо", "Квант", "Пиксель", "Зеро", "Искра", "Байт", "Призрак", "Сигнал",
  "Вольт", "Мираж", "Оникс", "Плазма", "Радар", "Синт", "Турбо", "Фантом", "Циан", "Спектр", "Импульс", "Кобальт", "Лазер",
  "Магма", "Никель", "Орбита", "Протон", "Ртуть", "Сканер", "Титан", "Ультра", "Фотон", "Хакер", "Циклон", "Шторм", "Эфир",
  "Юнит", "Ядро", "Аркада", "Бит",
];

/** 1 → «Неон», 44 → «Бит», 45 → «Неон 2», 89 → «Неон 3». Номер меньше 1 читается как 1. */
export function agentName(ordinal: number): string {
  const n = Math.max(1, Math.floor(Number.isFinite(ordinal) ? ordinal : 1));
  const index = (n - 1) % AGENT_NAMES.length;
  const round = Math.floor((n - 1) / AGENT_NAMES.length) + 1;
  return round === 1 ? AGENT_NAMES[index]! : `${AGENT_NAMES[index]!} ${round}`;
}

/** Исполнитель с моментом запуска; одинаковый момент — по id, чтобы порядок не зависел от выдачи. */
export interface Launched {
  id: string;
  startedAt: number | null;
  seq?: number | null;
}

/** Порядковые номера по истории запусков: раньше запущен — меньше номер. Возвращает id → номер (с 1). */
export function ordinals(list: readonly Launched[]): Map<string, number> {
  const sorted = [...list].sort((a, b) => {
    const ta = a.startedAt ?? Number.MAX_SAFE_INTEGER;
    const tb = b.startedAt ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    const sa = a.seq ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seq ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return new Map(sorted.map((item, index) => [item.id, index + 1]));
}

/** «PZ PS · PDF: масштаб» → «PDF: масштаб»: служебные коды в начале названия агента не показываются. */
export function stripCodes(title: string): string {
  const flat = title.trim();
  const match = /^((?:[A-Z][A-Z0-9]{1,3})(?:[ ,]+[A-Z][A-Z0-9]{1,3})*)\s*([·:—–-])\s*(\S.*)$/.exec(flat);
  if (match === null) return flat;
  // «PDF: масштаб» — это название, а не код: двоеточие и дефис отрезают только два кода и больше.
  const several = match[1]!.split(/[ ,]+/).length > 1;
  return /[·—–]/.test(match[2]!) || several ? match[3]!.trim() : flat;
}
