// Project icons: backend.
// Stores which icon each project uses and the library of custom pictures,
// serves the pictures over the plugin HTTP route, and exposes RPC + CLI.
import { randomBytes } from "node:crypto";
import {
  cliCommand,
  defineCli,
  defineRpcContract,
  experimental_PluginRpcRefusal,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CUSTOM_PREFIX, hashBytes, ICON_ID, loadBundledIcons, pluginRoot, type BundledIcon } from "./bundled";
import { checkImage, MAX_CUSTOM_ICONS, MAX_IMAGE_BYTES } from "./image";
import { ImportError, readImageFile, type ImportOptions } from "./import-file";
import { ANIMATION_SETTING, CHANGED, FRAME_NAMES, isFrameName, type FrameName, type IconFrames } from "./shared";

const projectId = z.string().min(1).max(160);
const iconId = z.string().regex(ICON_ID);
const iconName = z.string().trim().min(1).max(60);

const iconSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["builtin", "custom"]),
  url: z.string(),
  /** URLs of the animation frames this icon has; custom pictures have none. */
  frames: z.object({ left: z.string().optional(), right: z.string().optional(), puzzled: z.string().optional() }),
});
export type LibraryIcon = z.infer<typeof iconSchema>;

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  iconId: z.string().nullable(),
  /** Moment (ms since epoch) the icon was assigned; 0 for assignments saved before it was recorded or for no icon. */
  assignedAt: z.number(),
});
export type ProjectIcon = z.infer<typeof projectSchema>;

const stateSchema = z.object({ projects: z.array(projectSchema), icons: z.array(iconSchema) });
export type IconsState = z.infer<typeof stateSchema>;

// Base64 of a 512 KB file is ~700 000 characters.
const MAX_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateSchema },
  setIcon: {
    input: z.object({ projectId, iconId: iconId.nullable() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  addIcon: {
    input: z.object({ name: iconName, data: z.string().min(1).max(MAX_BASE64) }).strict(),
    output: iconSchema,
  },
  removeIcon: {
    input: z.object({ iconId }).strict(),
    output: z.object({ ok: z.literal(true), unassigned: z.number() }),
  },
});


class UserError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "not_found" | "conflict" = "invalid",
  ) {
    super(message);
  }
}

interface CustomRow {
  id: string;
  name: string;
  mime: string;
  hash: string;
}

/** Append-only list of storage migrations (statement index = migration id). */
export const MIGRATIONS: string[] = [
  // The first two statements keep their exact text: the host records their hashes.
  `CREATE TABLE IF NOT EXISTS custom_icons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS project_icons (
        project_id TEXT PRIMARY KEY,
        icon_id TEXT NOT NULL
      )`,
  // When the icon was assigned (0 for rows saved before 0.2.1).
  `ALTER TABLE project_icons ADD COLUMN assigned_at INTEGER NOT NULL DEFAULT 0`,
];

export interface PluginOptions extends ImportOptions {
  /** Folder that holds assets/icons; tests point it at their own fixtures. */
  root?: string;
}

export function createPlugin(options: PluginOptions = {}) {
  return (bb: BbPluginApi) => setup(bb, options);
}

export default function plugin(bb: BbPluginApi) {
  setup(bb, {});
}

function setup(bb: BbPluginApi, options: PluginOptions) {
  // Read by the frontend through useSettings(); shown in the plugin's settings.
  bb.settings.define({
    [ANIMATION_SETTING]: {
      type: "boolean",
      label: "Анимация иконок",
      description: "Иконка шевелит глазами, пока агент работает, и озадачена, когда ждёт ответа. Выключено: иконки в покое, метка «ждёт» остаётся.",
      default: true,
    },
  });

  const bundled = loadBundledIcons(options.root ?? pluginRoot());
  for (const problem of bundled.problems) bb.log.warn(`вшитые иконки: ${problem}`);
  const bundledById = new Map(bundled.icons.map((icon) => [icon.id, icon]));

  let migrated: ReturnType<typeof bb.storage.database> | null = null;
  const db = () => {
    const handle = bb.storage.database();
    if (migrated === handle) return handle;
    bb.storage.migrate(handle, MIGRATIONS);
    migrated = handle;
    return handle;
  };

  const iconUrl = (id: string, hash: string, frame?: string) =>
    `/api/v1/plugins/${bb.pluginId}/http/icon?id=${encodeURIComponent(id)}${frame ? `&frame=${frame}` : ""}&v=${hash}`;

  const frameUrls = (icon: BundledIcon): IconFrames => {
    const urls: IconFrames = {};
    for (const name of FRAME_NAMES) {
      const frame = icon.frames[name];
      if (frame) urls[name] = iconUrl(icon.id, frame.hash, name);
    }
    return urls;
  };

  const customRows = (): CustomRow[] =>
    db().prepare("SELECT id, name, mime, hash FROM custom_icons ORDER BY created_at, rowid").all() as CustomRow[];

  const library = (): LibraryIcon[] => [
    ...bundled.icons.map((icon) => ({ id: icon.id, name: icon.name, kind: "builtin" as const, url: iconUrl(icon.id, icon.hash), frames: frameUrls(icon) })),
    ...customRows().map((row) => ({ id: row.id, name: row.name, kind: "custom" as const, url: iconUrl(row.id, row.hash), frames: {} })),
  ];

  const state = async (): Promise<IconsState> => {
    const projects = await bb.sdk.projects.list();
    const icons = library();
    const known = new Set(icons.map((icon) => icon.id));
    const rows = db().prepare("SELECT project_id, icon_id, assigned_at FROM project_icons").all() as { project_id: string; icon_id: string; assigned_at: number | null }[];
    const chosen = new Map(rows.map((row) => [row.project_id, row]));
    return {
      icons,
      projects: projects.map((project) => {
        const row = chosen.get(project.id);
        const has = !!row && known.has(row.icon_id);
        return { id: project.id, name: project.name, iconId: has ? row.icon_id : null, assignedAt: has ? Number(row.assigned_at) || 0 : 0 };
      }),
    };
  };

  const changed = () => bb.realtime.publish(CHANGED, { at: Date.now() });

  const setIcon = async (input: { projectId: string; iconId: string | null }) => {
    const projects = await bb.sdk.projects.list();
    if (!projects.some((project) => project.id === input.projectId)) {
      throw new UserError("Проект не найден.", "not_found");
    }
    if (input.iconId === null) {
      db().prepare("DELETE FROM project_icons WHERE project_id = ?").run(input.projectId);
    } else {
      if (!library().some((icon) => icon.id === input.iconId)) throw new UserError("Такой иконки нет в библиотеке.", "not_found");
      db()
        .prepare(
          "INSERT INTO project_icons (project_id, icon_id, assigned_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET icon_id = excluded.icon_id, assigned_at = excluded.assigned_at",
        )
        .run(input.projectId, input.iconId, Date.now());
    }
    changed();
    return { ok: true as const };
  };

  const addIcon = (name: string, bytes: Uint8Array): LibraryIcon => {
    const check = checkImage(bytes);
    if (!check.ok) throw new UserError(check.message);
    const count = (db().prepare("SELECT COUNT(*) AS n FROM custom_icons").get() as { n: number }).n;
    if (count >= MAX_CUSTOM_ICONS) throw new UserError(`Своих картинок уже ${MAX_CUSTOM_ICONS}, больше нельзя. Удалите ненужные.`, "conflict");
    const id = CUSTOM_PREFIX + randomBytes(6).toString("hex");
    const hash = hashBytes(bytes);
    db()
      .prepare("INSERT INTO custom_icons (id, name, mime, data, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, name, check.mime, Buffer.from(bytes), hash, Date.now());
    changed();
    return { id, name, kind: "custom", url: iconUrl(id, hash), frames: {} };
  };

  const removeIcon = (id: string) => {
    if (bundledById.has(id)) throw new UserError("Вшитую иконку удалить нельзя.");
    const handle = db();
    const removed = handle.transaction(() => {
      const gone = handle.prepare("DELETE FROM custom_icons WHERE id = ?").run(id).changes;
      if (!gone) return null;
      return handle.prepare("DELETE FROM project_icons WHERE icon_id = ?").run(id).changes;
    })();
    if (removed === null) throw new UserError("Такой своей картинки нет.", "not_found");
    changed();
    return { ok: true as const, unassigned: removed };
  };

  const refuse = <T>(run: () => T | Promise<T>) =>
    Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        if (error instanceof UserError) throw new experimental_PluginRpcRefusal({ code: error.code, message: error.message });
        throw error;
      });

  bb.rpc.register(rpcContract, {
    state: () => state(),
    setIcon: (input) => refuse(() => setIcon(input)),
    addIcon: (input) =>
      refuse(() => {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) throw new UserError("Картинка пришла повреждённой.");
        return addIcon(input.name, Buffer.from(input.data, "base64"));
      }),
    removeIcon: (input) => refuse(() => removeIcon(input.iconId)),
  });

  // Pictures for <img>. Only ids from the library are served; nothing from the request reaches the disk.
  bb.http.route(
    "GET",
    "/icon",
    (c) => {
      const id = c.req.query("id") ?? "";
      if (!id) return c.text("Не указан id", 400);
      if (!ICON_ID.test(id)) return c.text("Нет такой иконки", 404);
      // Only the three known frame names pass; anything else never reaches a lookup.
      const asked = c.req.query("frame");
      let frame: FrameName | undefined;
      if (asked !== undefined) {
        if (!isFrameName(asked)) return c.text("Нет такого кадра", 400);
        frame = asked;
      }
      const headers = {
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      };
      const builtin = bundledById.get(id);
      if (builtin) {
        const picture = frame ? builtin.frames[frame] : builtin;
        if (!picture) return c.text("Нет такого кадра", 404);
        return new Response(Buffer.from(picture.bytes), { headers: { ...headers, "Content-Type": picture.mime } });
      }
      // Custom pictures have no frames.
      if (frame) return c.text("Нет такого кадра", 404);
      const row = db().prepare("SELECT mime, data FROM custom_icons WHERE id = ?").get(id) as { mime: string; data: Buffer } | undefined;
      if (!row) return c.text("Нет такой иконки", 404);
      return new Response(new Uint8Array(row.data), { headers: { ...headers, "Content-Type": row.mime } });
    },
    { auth: "local" },
  );

  const cliFailure = (error: unknown): never => {
    if (error instanceof UserError || error instanceof ImportError) throw new PluginCliError(error.message, { code: error.code });
    throw error;
  };
  const json = { type: "boolean", description: "Вывести JSON" } as const;
  const out = (stdout: string) => ({ exitCode: 0, stdout: stdout.endsWith("\n") ? stdout : stdout + "\n" });

  bb.cli.register(
    defineCli({
      name: "genidev-project-icons",
      summary: "Иконки проектов в боковой панели bb",
      commands: {
        list: cliCommand({
          summary: "Проекты и их иконки",
          options: { json },
          async run(input) {
            const current = await state();
            const names = new Map(current.icons.map((icon) => [icon.id, icon.name]));
            if (input.options.json) {
              return out(JSON.stringify(current.projects.map((p) => ({ id: p.id, name: p.name, iconId: p.iconId, iconName: p.iconId ? names.get(p.iconId) ?? null : null }))));
            }
            const lines = current.projects.map((p) =>
              `${p.name} (${p.id}): ${p.iconId ? `${names.get(p.iconId)} (${p.iconId})` : "без иконки"}`,
            );
            return out(lines.join("\n") || "Проектов нет");
          },
        }),
        icons: cliCommand({
          summary: "Библиотека иконок: вшитые и свои",
          options: { json },
          async run(input) {
            const icons = library().map(({ id, name, kind, frames }) => ({ id, name, kind, frames: FRAME_NAMES.filter((frame) => frames[frame]) }));
            if (input.options.json) return out(JSON.stringify(icons));
            const lines = icons.map((icon) => `${icon.id}\t${icon.kind === "builtin" ? "вшитая" : "своя"}\t${icon.name}${icon.frames.length ? `\tкадры: ${icon.frames.join(", ")}` : ""}`);
            return out(lines.join("\n") || "Библиотека пуста");
          },
        }),
        set: cliCommand({
          summary: "Назначить проекту иконку или снять её (none)",
          positionals: [
            { name: "projectId", description: "id проекта, см. list", required: true },
            { name: "iconId", description: "id иконки из icons или none", required: true },
          ],
          options: { json },
          async run(input) {
            const { projectId: project, iconId: icon } = input.positionals;
            const next = icon === "none" ? null : icon;
            if (next !== null && !ICON_ID.test(next)) throw new PluginCliError("Такой иконки нет в библиотеке.", { code: "not_found", hint: "Список: bb genidev-project-icons icons" });
            await setIcon({ projectId: project, iconId: next }).catch(cliFailure);
            if (input.options.json) return out(JSON.stringify({ ok: true, projectId: project, iconId: next }));
            return out(next ? `Иконка ${next} назначена проекту ${project}` : `Иконка снята с проекта ${project}`);
          },
        }),
        add: cliCommand({
          summary: "Добавить свою картинку с диска (PNG, JPEG, WebP)",
          description: "Картинка вписывается в квадрат 96×96 (через sips на macOS) и сохраняется в WebP, если на машине есть cwebp, иначе в PNG. Итог не больше 512 КБ и 512 px. SVG не принимается. Своих не больше 200.",
          positionals: [{ name: "file", description: "Путь к файлу; относительный считается от текущей папки", required: true }],
          options: { name: { type: "string", required: true, description: "Название картинки, до 60 символов" }, json },
          async run(input, ctx) {
            const name = iconName.safeParse(input.options.name);
            if (!name.success) throw new PluginCliError("Название должно быть от 1 до 60 символов.", { code: "invalid" });
            const bytes = await readImageFile(input.positionals.file, ctx.cwd, options).catch(cliFailure);
            const icon = (() => {
              try {
                return addIcon(name.data, bytes);
              } catch (error) {
                return cliFailure(error);
              }
            })();
            if (input.options.json) return out(JSON.stringify({ id: icon.id, name: icon.name, kind: icon.kind }));
            return out(`Картинка добавлена: ${icon.id} (${icon.name})`);
          },
        }),
        remove: cliCommand({
          summary: "Удалить свою картинку; она снимается со всех проектов",
          positionals: [{ name: "iconId", description: "id своей картинки (custom-…)", required: true }],
          options: { json },
          async run(input) {
            const id = input.positionals.iconId;
            if (!ICON_ID.test(id)) throw new PluginCliError("Такой своей картинки нет.", { code: "not_found" });
            let result: { unassigned: number };
            try {
              result = removeIcon(id);
            } catch (error) {
              return cliFailure(error);
            }
            if (input.options.json) return out(JSON.stringify({ ok: true, iconId: id, unassigned: result.unassigned }));
            return out(`Картинка ${id} удалена, снята с проектов: ${result.unassigned}`);
          },
        }),
      },
    }),
  );
}
