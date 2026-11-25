// Project icons: backend.
// Stores which icon each project uses and the library of custom pictures,
// serves the pictures over the plugin HTTP route, and exposes RPC + CLI.
import { createHash, randomBytes } from "node:crypto";
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
import { defaultPackDir, isNeverAuto, loadPack, packDirProblem, PACK_DIR_SETTING, RELATIVE_PATH_MESSAGE, type PackLoad } from "./pack";
import { checkImage, MAX_CUSTOM_ICONS, MAX_IMAGE_BYTES } from "./image";
import { ImportError, readImageFile, type ImportOptions } from "./import-file";
import { ANIMATION_SETTING, AUTO_ASSIGN_SETTING, CHANGED, FRAME_NAMES, isFrameName, type FrameName, type IconFrames } from "./shared";

const projectId = z.string().min(1).max(160);
const iconId = z.string().regex(ICON_ID);
const iconName = z.string().trim().min(1).max(60);

const iconSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["builtin", "pack", "custom"]),
  url: z.string(),
  /** URLs of the animation frames this icon has; custom pictures have none. */
  frames: z.object({
    left: z.string().optional(),
    right: z.string().optional(),
    puzzled: z.string().optional(),
    alert: z.string().optional(),
    happy: z.string().optional(),
  }),
});
export type LibraryIcon = z.infer<typeof iconSchema>;

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  iconId: z.string().nullable(),
  /** Moment (ms since epoch) the icon was assigned; 0 for assignments saved before it was recorded or for no icon. */
  assignedAt: z.number(),
  /** True while the icon was put there by the plugin and the owner has not chosen another one. */
  auto: z.boolean(),
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
  // 0.3.1: icon put automatically to a new project; projects already handled; one-time baseline marker.
  `ALTER TABLE project_icons ADD COLUMN auto INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS seen_projects (project_id TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS icon_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/** Stable number from a project id. */
function stableHash(id: string): number {
  return createHash("sha256").update(id).digest().readUInt32BE(0);
}

/** The icon id an automatic assignment picks, or null when the library has nothing allowed. */
export function pickAutoIcon(projectId: string, libraryIds: readonly string[], used: ReadonlySet<string>): string | null {
  const allowed = libraryIds.filter((id) => !isNeverAuto(id));
  if (allowed.length === 0) return null;
  const free = allowed.filter((id) => !used.has(id));
  const pool = free.length > 0 ? free : allowed;
  return pool[stableHash(projectId) % pool.length];
}

export interface PluginOptions extends ImportOptions {
  /** Folder that holds assets/icons; tests point it at their own fixtures. */
  root?: string;
  /** Pack folder used while the setting is empty; tests point it away from the real home folder. */
  defaultPackDir?: string;
}

export function createPlugin(options: PluginOptions = {}) {
  return (bb: BbPluginApi) => setup(bb, options);
}

export default function plugin(bb: BbPluginApi) {
  return setup(bb, {});
}

async function setup(bb: BbPluginApi, options: PluginOptions) {
  // Read by the frontend through useSettings(); shown in the plugin's settings.
  const settings = bb.settings.define({
    [AUTO_ASSIGN_SETTING]: {
      type: "boolean",
      label: "Give new projects an icon",
      description: "A new project gets a free icon from the library automatically; it can be changed or removed in the project menu. Existing projects are left alone.",
      default: true,
    },
    [ANIMATION_SETTING]: {
      type: "boolean",
      label: "Icon animation",
      description: "The icon moves its eyes while an agent works, looks puzzled while it waits for you, and flinches on an error. Off: icons stay still, the state badges remain.",
      default: true,
    },
    [PACK_DIR_SETTING]: {
      type: "string",
      label: "Personal icon pack folder",
      description: "Absolute path to a folder with extra icons (icons.json plus image files, same format as the built-in set). Empty: ~/.bb/plugins_bb/project-icons-pack. A missing folder means no personal pack. Re-read on change and by `bb genidev-project-icons reload-pack`.",
      default: "",
      experimental_schema: z.string().refine((value) => packDirProblem(value) === null, { message: RELATIVE_PATH_MESSAGE }),
    },
  });

  const bundled = loadBundledIcons(options.root ?? pluginRoot());
  for (const problem of bundled.problems) bb.log.warn(`built-in icons: ${problem}`);
  const bundledById = new Map(bundled.icons.map((icon) => [icon.id, icon]));

  // Personal pack: read at load, on a settings change and by `reload-pack`.
  let pack: PackLoad = { dir: "", icons: [], problems: [], skipped: 0, found: false };
  const readPack = async (): Promise<PackLoad> => {
    let value: string | undefined;
    try {
      value = (await settings.get())[PACK_DIR_SETTING];
    } catch {
      value = undefined;
    }
    const load = loadPack(value, options.defaultPackDir ?? defaultPackDir());
    const icons = load.icons.filter((icon) => {
      if (!bundledById.has(icon.id)) return true;
      load.problems.push(`${icon.id}: the built-in icon with this id wins`);
      load.skipped += 1;
      return false;
    });
    for (const problem of load.problems) bb.log.warn(`personal pack: ${problem}`);
    return { ...load, icons };
  };
  pack = await readPack();
  const packById = () => new Map(pack.icons.map((icon) => [icon.id, icon]));
  const fixedIcon = (id: string): BundledIcon | undefined => bundledById.get(id) ?? packById().get(id);

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
    ...pack.icons.map((icon) => ({ id: icon.id, name: icon.name, kind: "pack" as const, url: iconUrl(icon.id, icon.hash), frames: frameUrls(icon) })),
    ...customRows().map((row) => ({ id: row.id, name: row.name, kind: "custom" as const, url: iconUrl(row.id, row.hash), frames: {} })),
  ];

  const state = async (): Promise<IconsState> => {
    await syncProjects().catch((error: unknown) => bb.log.warn(`auto icon: ${error instanceof Error ? error.message : String(error)}`));
    const projects = await bb.sdk.projects.list();
    const icons = library();
    const known = new Set(icons.map((icon) => icon.id));
    const rows = db().prepare("SELECT project_id, icon_id, assigned_at, auto FROM project_icons").all() as { project_id: string; icon_id: string; assigned_at: number | null; auto: number | null }[];
    const chosen = new Map(rows.map((row) => [row.project_id, row]));
    return {
      icons,
      projects: projects.map((project) => {
        const row = chosen.get(project.id);
        const has = !!row && known.has(row.icon_id);
        return { id: project.id, name: project.name, iconId: has ? row.icon_id : null, assignedAt: has ? Number(row.assigned_at) || 0 : 0, auto: has && row.auto === 1 };
      }),
    };
  };

  const changed = () => bb.realtime.publish(CHANGED, { at: Date.now() });

  const reloadPack = async (): Promise<PackLoad> => {
    pack = await readPack();
    changed();
    return pack;
  };
  settings.onChange((next, prev) => {
    if (next[PACK_DIR_SETTING] === prev[PACK_DIR_SETTING]) return;
    void reloadPack().catch((error: unknown) => bb.log.warn(`personal pack: ${error instanceof Error ? error.message : String(error)}`));
  });

  // New projects: bb announces no project creation to plugins (only thread events), so the plugin
  // keeps the ids it has already seen and compares them with the project list.
  let syncing: Promise<void> = Promise.resolve();
  const syncProjects = (): Promise<void> => {
    const run = syncing.then(syncOnce);
    syncing = run.catch(() => undefined);
    return run;
  };

  const syncOnce = async (): Promise<void> => {
    const projects = await bb.sdk.projects.list();
    const handle = db();
    const baseline = handle.prepare("SELECT value FROM icon_meta WHERE key = 'baseline'").get();
    const seen = new Set((handle.prepare("SELECT project_id FROM seen_projects").all() as { project_id: string }[]).map((row) => row.project_id));
    const fresh = projects.filter((project) => !seen.has(project.id));
    if (fresh.length === 0) return;
    const markSeen = handle.prepare("INSERT OR IGNORE INTO seen_projects (project_id) VALUES (?)");
    if (!baseline) {
      // First run of this version: every project that exists now is known and gets nothing.
      handle.transaction(() => {
        for (const project of fresh) markSeen.run(project.id);
        handle.prepare("INSERT OR IGNORE INTO icon_meta (key, value) VALUES ('baseline', ?)").run(String(Date.now()));
      })();
      return;
    }
    const enabled = (await settings.get())[AUTO_ASSIGN_SETTING] !== false;
    const libraryIds = library().map((icon) => icon.id);
    const used = new Set((handle.prepare("SELECT icon_id FROM project_icons").all() as { icon_id: string }[]).map((row) => row.icon_id));
    const assigned: [string, string][] = [];
    handle.transaction(() => {
      for (const project of fresh) {
        markSeen.run(project.id);
        if (!enabled) continue;
        const exists = handle.prepare("SELECT 1 FROM project_icons WHERE project_id = ?").get(project.id);
        if (exists) continue;
        const pick = pickAutoIcon(project.id, libraryIds, used);
        if (!pick) continue;
        handle.prepare("INSERT INTO project_icons (project_id, icon_id, assigned_at, auto) VALUES (?, ?, ?, 1)").run(project.id, pick, Date.now());
        used.add(pick);
        assigned.push([project.id, pick]);
      }
    })();
    for (const [id, icon] of assigned) bb.log.info(`auto icon: project ${id}, icon ${icon}`);
    if (assigned.length > 0) changed();
  };

  // A new project usually brings a thread; the thread event is only a nudge to compare the list.
  bb.events.on("thread.created", () => {
    void syncProjects().catch((error: unknown) => bb.log.warn(`auto icon: ${error instanceof Error ? error.message : String(error)}`));
  });
  // Also at load, so a project created while the plugin was off is seen at once.
  void Promise.resolve()
    .then(syncProjects)
    .catch((error: unknown) => bb.log.warn(`auto icon: ${error instanceof Error ? error.message : String(error)}`));

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
          "INSERT INTO project_icons (project_id, icon_id, assigned_at, auto) VALUES (?, ?, ?, 0) ON CONFLICT(project_id) DO UPDATE SET icon_id = excluded.icon_id, assigned_at = excluded.assigned_at, auto = 0",
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
    if (packById().has(id)) throw new UserError("Иконку личного набора удалить нельзя.");
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
      // Only the known frame names pass; anything else never reaches a lookup.
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
      const builtin = fixedIcon(id);
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
  const json = { type: "boolean", description: "Print JSON" } as const;
  const out = (stdout: string) => ({ exitCode: 0, stdout: stdout.endsWith("\n") ? stdout : stdout + "\n" });

  bb.cli.register(
    defineCli({
      name: "genidev-project-icons",
      summary: "Project icons in the bb sidebar",
      commands: {
        list: cliCommand({
          summary: "Projects and their icons",
          options: { json },
          async run(input) {
            const current = await state();
            const names = new Map(current.icons.map((icon) => [icon.id, icon.name]));
            if (input.options.json) {
              return out(JSON.stringify(current.projects.map((p) => ({ id: p.id, name: p.name, iconId: p.iconId, iconName: p.iconId ? names.get(p.iconId) ?? null : null, ...(p.auto ? { auto: true } : {}) }))));
            }
            const lines = current.projects.map((p) =>
              `${p.name} (${p.id}): ${p.iconId ? `${names.get(p.iconId)} (${p.iconId})${p.auto ? " (auto)" : ""}` : "no icon"}`,
            );
            return out(lines.join("\n") || "No projects");
          },
        }),
        icons: cliCommand({
          summary: "Icon library: built-in, personal pack and custom",
          options: { json },
          async run(input) {
            const icons = library().map(({ id, name, kind, frames }) => ({ id, name, kind, frames: FRAME_NAMES.filter((frame) => frames[frame]) }));
            if (input.options.json) return out(JSON.stringify(icons));
            const lines = icons.map((icon) => `${icon.id}\t${icon.kind}\t${icon.name}${icon.frames.length ? `\tframes: ${icon.frames.join(", ")}` : ""}`);
            return out(lines.join("\n") || "The library is empty");
          },
        }),
        "reload-pack": cliCommand({
          summary: "Re-read the personal icon pack folder",
          description: "Reads the folder from the Personal icon pack folder setting (default ~/.bb/plugins_bb/project-icons-pack) and reports how many icons were read and how many were skipped, with reasons.",
          options: { json },
          async run(input) {
            const load = await reloadPack();
            if (input.options.json) return out(JSON.stringify({ dir: load.dir, found: load.found, read: load.icons.length, skipped: load.skipped, problems: load.problems }));
            const head = load.found
              ? `Personal pack ${load.dir}: ${load.icons.length} read, ${load.skipped} skipped`
              : `Personal pack folder not found or unusable: ${load.dir} (0 read)`;
            return out([head, ...load.problems.map((problem) => `  - ${problem}`)].join("\n"));
          },
        }),
        set: cliCommand({
          summary: "Assign an icon to a project, or remove it (none)",
          positionals: [
            { name: "projectId", description: "Project id, see list", required: true },
            { name: "iconId", description: "Icon id from icons, or none", required: true },
          ],
          options: { json },
          async run(input) {
            const { projectId: project, iconId: icon } = input.positionals;
            const next = icon === "none" ? null : icon;
            if (next !== null && !ICON_ID.test(next)) throw new PluginCliError("No such icon in the library.", { code: "not_found", hint: "List: bb genidev-project-icons icons" });
            await setIcon({ projectId: project, iconId: next }).catch(cliFailure);
            if (input.options.json) return out(JSON.stringify({ ok: true, projectId: project, iconId: next }));
            return out(next ? `Icon ${next} assigned to project ${project}` : `Icon removed from project ${project}`);
          },
        }),
        add: cliCommand({
          summary: "Add your own picture from disk (PNG, JPEG, WebP)",
          description: "The picture is fitted into a 96x96 square (with sips on macOS) and saved as WebP if cwebp is installed, otherwise as PNG. The result is at most 512 KB and 512 px. SVG is not accepted. At most 200 custom pictures.",
          positionals: [{ name: "file", description: "File path; a relative path is taken from the current folder", required: true }],
          options: { name: { type: "string", required: true, description: "Picture name, up to 60 characters" }, json },
          async run(input, ctx) {
            const name = iconName.safeParse(input.options.name);
            if (!name.success) throw new PluginCliError("The name must be 1 to 60 characters.", { code: "invalid" });
            const bytes = await readImageFile(input.positionals.file, ctx.cwd, options).catch(cliFailure);
            const icon = (() => {
              try {
                return addIcon(name.data, bytes);
              } catch (error) {
                return cliFailure(error);
              }
            })();
            if (input.options.json) return out(JSON.stringify({ id: icon.id, name: icon.name, kind: icon.kind }));
            return out(`Picture added: ${icon.id} (${icon.name})`);
          },
        }),
        remove: cliCommand({
          summary: "Delete a custom picture; it is removed from all projects",
          positionals: [{ name: "iconId", description: "Id of a custom picture (custom-...)", required: true }],
          options: { json },
          async run(input) {
            const id = input.positionals.iconId;
            if (!ICON_ID.test(id)) throw new PluginCliError("No such custom picture.", { code: "not_found" });
            let result: { unassigned: number };
            try {
              result = removeIcon(id);
            } catch (error) {
              return cliFailure(error);
            }
            if (input.options.json) return out(JSON.stringify({ ok: true, iconId: id, unassigned: result.unassigned }));
            return out(`Picture ${id} deleted, removed from projects: ${result.unassigned}`);
          },
        }),
      },
    }),
  );
}
