/**
 * Server groups are data the user manages (table `server_groups`), not code.
 * Only the default group is known here: every install has it, it holds the
 * servers of a removed group, and it cannot be removed itself.
 */
export const DEFAULT_GROUP = "personal";

export const DEFAULT_GROUP_LABEL = "Personal";

export const GROUP_ID_MAX = 32;

export const GROUP_LABEL_MAX = 40;

export type ServerGroup = {
  id: string;
  label: string;
  position: number;
};

const GROUP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,31})$/;

export function isGroupId(value: unknown): value is string {
  return typeof value === "string" && value.length <= GROUP_ID_MAX && GROUP_ID_PATTERN.test(value);
}

/** Trims a label; returns null when it is empty, too long or has control characters. */
export function cleanGroupLabel(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (text === "" || text.length > GROUP_LABEL_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** A stable id derived from a label: lowercase latin, digits and hyphens, unique among `taken`. */
export function groupIdFromLabel(label: string, taken: ReadonlySet<string>): string {
  const latin = [...label.toLowerCase()].map((char) => CYRILLIC[char] ?? char).join("");
  const base =
    latin
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, GROUP_ID_MAX - 3)
      .replace(/-+$/g, "") || "group";
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** `id (label)` pairs for error messages and CLI help. */
export function groupHint(groups: readonly ServerGroup[]): string {
  return groups.map((group) => `${group.id} (${group.label})`).join(", ");
}

/** Finds a group by id, or by label ignoring case, so `--group Demo` works as well as `--group demo`. */
export function findGroup(groups: readonly ServerGroup[], value: string): ServerGroup | null {
  const text = value.trim();
  const byId = groups.find((group) => group.id === text.toLowerCase());
  if (byId !== undefined) return byId;
  const lower = text.toLocaleLowerCase("ru-RU");
  return groups.find((group) => group.label.toLocaleLowerCase("ru-RU") === lower) ?? null;
}
