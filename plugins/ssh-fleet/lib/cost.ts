import { getLanguage, locale, translate, type Lang } from "./i18n.ts";

export const HOURS_PER_MONTH = 720;

/** Whole rubles with the language's grouping: "4 858" or "4,858". */
export function rubles(value: number, lang: Lang = getLanguage()): string {
  return value.toLocaleString(locale(lang), { maximumFractionDigits: 0 });
}

/** Monthly / 720 with two decimals: "6,75" or "6.75". */
export function hourly(monthly: number, lang: Lang = getLanguage()): string {
  return (monthly / HOURS_PER_MONTH).toLocaleString(locale(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "4 858 ₽" or "4,858 RUB". */
export function money(value: number, lang: Lang = getLanguage()): string {
  return translate(lang, "money.amount", { value: rubles(value, lang) });
}

/** «4 858 ₽/мес · 6,75 ₽/час» / "4,858 RUB/mo · 6.75 RUB/h", or null when the price is unknown. */
export function costLine(monthly: number | null, lang: Lang = getLanguage()): string | null {
  if (monthly === null) return null;
  return `${translate(lang, "money.month", { value: rubles(monthly, lang) })} · ${translate(lang, "money.hour", { value: hourly(monthly, lang) })}`;
}

export function costTotals(servers: ReadonlyArray<{ monthlyCostRub: number | null }>) {
  let monthly = 0;
  let unpriced = 0;
  for (const server of servers) {
    if (server.monthlyCostRub === null) unpriced += 1;
    else monthly += server.monthlyCostRub;
  }
  return { monthly, unpriced, count: servers.length };
}
