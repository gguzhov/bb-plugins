// All visible text of the plugin, English and Russian, in one place.
export type Language = "en" | "ru";
export type LanguageSetting = "auto" | Language;

export const STRINGS = {
  en: {
    openLabel: "Open folder in Finder",
    openTitle: (path: string) => `Open in Finder: ${path}`,
    unsupported: "Finder opens only a ready folder on the Mac where the environment lives. Nothing was opened.",
    onlyMac: "Finder is available only on macOS.",
    notFound: "Folder not found.",
    failed: "Could not open the folder in Finder.",
  },
  ru: {
    openLabel: "Открыть папку в Finder",
    openTitle: (path: string) => `Открыть в Finder: ${path}`,
    unsupported: "Finder открывает только готовую папку на Mac, где живёт среда. Ничего не открыто.",
    onlyMac: "Finder доступен только на macOS.",
    notFound: "Папка не найдена.",
    failed: "Не удалось открыть папку в Finder.",
  },
} as const;

/** Error codes the host entry throws; the server turns them into text in the right language. */
export const HOST_ERRORS = { onlyMac: "finder:only-macos", notFound: "finder:not-found" } as const;

/** `auto` follows the page and browser language: Russian when either starts with "ru", English otherwise. */
export function resolveLanguage(setting: LanguageSetting | undefined, ...languages: (string | null | undefined)[]): Language {
  if (setting === "en" || setting === "ru") return setting;
  return languages.some((language) => (language ?? "").toLowerCase().startsWith("ru")) ? "ru" : "en";
}

export function hostErrorText(error: unknown, language: Language): string {
  const message = error instanceof Error ? error.message : String(error);
  const t = STRINGS[language];
  if (message.includes(HOST_ERRORS.onlyMac)) return t.onlyMac;
  if (message.includes(HOST_ERRORS.notFound)) return t.notFound;
  return t.failed;
}
