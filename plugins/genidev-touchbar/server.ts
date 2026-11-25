// bb-plugin-genidev-touchbar (Notch Bar): per-thread plan summary for the native notch app.
// Backend only. Reads plans from task-queue over RPC, turn times from thread
// events, and serves one Snapshot (lib/contract.ts) over CLI and HTTP.
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCRIPT_ABOUT,
  appStatus,
  formatStatus,
  isAppAgent,
  pluginRoot,
  runScript,
  scriptCommand,
  scriptPath,
  type AppScript,
} from "./lib/app.ts";
import type { Snapshot, SnapshotCard } from "./lib/contract.ts";
import { FRAME_ORDER, assignThreadIcons, decorateCard, iconLabel, type LibraryEntry, type Pin } from "./lib/icons.ts";
import {
  applyTurnEvents,
  buildCard,
  buildSnapshot,
  newTracker,
  pickCandidates,
  retainDone,
  workTime,
  type KeptCard,
  type TurnTracker,
} from "./lib/logic.ts";

const stepSchema = z.object({
  title: z.string(),
  status: z.enum(["pending", "active", "review", "done", "error", "skipped"]),
  points: z.number().optional(),
  owner: z.string().optional(),
  agent: z.string().optional(),
  startedAt: z.number().optional(),
  reviewAt: z.number().optional(),
  doneAt: z.number().optional(),
});
const planSchema = z.object({
  title: z.string(),
  state: z.enum(["running", "needs_input", "error", "done"]),
  note: z.string().nullable().optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  stages: z.array(z.object({ name: z.string().optional(), steps: z.array(stepSchema) })),
});
const planReplySchema = z.object({ plan: planSchema.nullable() });

const iconsReplySchema = z.object({
  projects: z.array(z.object({ id: z.string(), iconId: z.string().nullable() })),
  icons: z.array(z.object({ id: z.string(), frames: z.record(z.string(), z.string().optional()) })),
});
const ICONS_PLUGIN = "genidev-project-icons";
const ICONS_MS = 30_000;
const PIN_PREFIX = "pin:";

const CACHE_MS = 1000;
const MAX_CANDIDATES = 40;
/** A thread that is not in a turn and has not changed is asked for its plan again only this often. */
const IDLE_RECHECK_MS = 30_000;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    recentHours: {
      type: "number",
      label: "Recent threads, hours",
      description: "Plans are read from threads that are running now or changed within this many hours.",
      default: 24,
      experimental_schema: z.number().int().min(1).max(720),
    },
    cardLimit: {
      type: "number",
      label: "Cards in the snapshot",
      description: "The notch app gets at most this many thread cards.",
      default: 12,
      experimental_schema: z.number().int().min(1).max(40),
    },
  });
  const trackers = new Map<string, TurnTracker & { afterSeq: number }>();
  const kept = new Map<string, KeptCard>();
  /** Last answer per thread: lets a quiet thread skip the plan RPC and the event read. */
  const checks = new Map<string, { checkedAt: number; updatedAt: number; card: SnapshotCard | null }>();
  let cache: { at: number; value: Snapshot } | null = null;
  let inflight: Promise<Snapshot> | null = null;
  /** Icons library and the owner's choices, asked from the icons plugin every 30 seconds. */
  let iconsState: { at: number; library: LibraryEntry[]; byProject: Map<string, string> } | null = null;
  const threadProject = new Map<string, string | null>();
  let pins: Map<string, Pin> | null = null;

  async function loadIcons(now: number) {
    if (iconsState !== null && now - iconsState.at < ICONS_MS) return iconsState;
    let next: NonNullable<typeof iconsState> = { at: now, library: [], byProject: new Map() };
    try {
      const reply = await bb.sdk.plugins.callRpc({
        pluginId: ICONS_PLUGIN,
        method: "state",
        input: null,
        outputSchema: iconsReplySchema,
      });
      const library = reply.icons.map((icon) => ({
        id: icon.id,
        frames: FRAME_ORDER.filter((name) => !!icon.frames[name]) as string[],
      }));
      const byProject = new Map<string, string>();
      for (const p of reply.projects) if (p.iconId !== null) byProject.set(p.id, p.iconId);
      next = { at: now, library, byProject };
    } catch (error) {
      bb.log.warn(`icons state failed: ${errorName(error)}`);
    }
    iconsState = next;
    return next;
  }

  async function loadPins(): Promise<Map<string, Pin>> {
    if (pins !== null) return pins;
    const loaded = new Map<string, Pin>();
    try {
      for (const key of await bb.storage.kv.list(PIN_PREFIX)) {
        if (!key.startsWith(PIN_PREFIX)) continue;
        const value = await bb.storage.kv.get<Pin>(key);
        if (value && typeof value.iconId === "string" && typeof value.seenAt === "number") {
          loaded.set(key.slice(PIN_PREFIX.length), value);
        }
      }
    } catch (error) {
      bb.log.warn(`pins read failed: ${errorName(error)}`);
    }
    pins = loaded;
    return loaded;
  }

  async function withIcons(cards: SnapshotCard[], now: number): Promise<{ cards: SnapshotCard[]; iconUrl: string | null }> {
    const { library, byProject } = await loadIcons(now);
    if (library.length === 0) {
      return { cards: cards.map((c) => decorateCard(c, null, [])), iconUrl: null };
    }
    const old = await loadPins();
    const result = assignThreadIcons(
      cards.map((c) => {
        const project = threadProject.get(c.threadId) ?? null;
        return { threadId: c.threadId, projectIconId: project !== null ? byProject.get(project) ?? null : null };
      }),
      library,
      old,
      now,
    );
    pins = result.pins;
    try {
      for (const id of result.dirty) await bb.storage.kv.set(PIN_PREFIX + id, result.pins.get(id));
      for (const id of result.removed) await bb.storage.kv.delete(PIN_PREFIX + id);
    } catch (error) {
      bb.log.warn(`pins write failed: ${errorName(error)}`);
    }
    return {
      cards: cards.map((c) => decorateCard(c, result.icons.get(c.threadId) ?? null, library)),
      iconUrl: `${bb.server.loopbackBaseUrl}/api/v1/plugins/${ICONS_PLUGIN}/http/icon`,
    };
  }

  async function refreshTracker(threadId: string): Promise<TurnTracker> {
    let tracker = trackers.get(threadId);
    if (tracker === undefined) {
      tracker = { ...newTracker(), afterSeq: 0 };
      trackers.set(threadId, tracker);
    }
    for (let page = 0; page < 50; page++) {
      const events = await bb.sdk.threads.events.list({
        threadId,
        types: ["turn/started", "turn/completed"],
        afterSeq: String(tracker.afterSeq),
        limit: "100",
      });
      if (events.length === 0) break;
      applyTurnEvents(tracker, events);
      for (const e of events) tracker.afterSeq = Math.max(tracker.afterSeq, Number(e.seq));
      if (events.length < 100) break;
    }
    return tracker;
  }

  async function build(): Promise<Snapshot> {
    const now = Date.now();
    const cards: SnapshotCard[] = [];
    const live = new Set<string>();
    const { recentHours, cardLimit } = await settings.get();
    const keep = (card: SnapshotCard) => {
      live.add(card.threadId);
      cards.push(card);
      if (card.state === "done") kept.set(card.threadId, { card, seenAt: now });
      else kept.delete(card.threadId);
    };
    try {
      const [threadPage, projects] = await Promise.all([
        bb.sdk.threads.list({ archived: false, limit: 200 }),
        bb.sdk.projects.list({ includePersonal: true }),
      ]);
      const threads = threadPage as unknown as Array<{
        id: string;
        projectId: string | null;
        title: string | null;
        titleFallback?: string | null;
        status: string;
        visibility?: string;
        archivedAt?: unknown;
        updatedAt: number;
      }>;
      const names = new Map<string, string>(
        (projects as unknown as Array<{ id: string; name: string }>).map((p) => [p.id, p.name] as const),
      );
      for (const t of threads) threadProject.set(t.id, t.projectId);
      const visible = threads.filter(
        (t) => t.visibility !== "hidden" && (t.archivedAt === null || t.archivedAt === undefined),
      );
      const candidates = pickCandidates(visible, now, recentHours, MAX_CANDIDATES);
      await Promise.all(
        candidates.map(async (thread) => {
          const active = thread.status === "active";
          const last = checks.get(thread.id);
          if (
            last !== undefined &&
            !active &&
            last.updatedAt === thread.updatedAt &&
            now - last.checkedAt < IDLE_RECHECK_MS
          ) {
            if (last.card !== null) keep(last.card);
            return;
          }
          try {
            const reply = await bb.sdk.plugins.callRpc({
              pluginId: "task-queue",
              method: "plan",
              input: { threadId: thread.id },
              outputSchema: planReplySchema,
            });
            if (reply.plan === null) {
              checks.set(thread.id, { checkedAt: now, updatedAt: thread.updatedAt, card: null });
              return;
            }
            const tracker = await refreshTracker(thread.id);
            const work = workTime(tracker, reply.plan.startedAt);
            if (!active) work.runningSince = null;
            const card = buildCard({
              threadId: thread.id,
              project: (thread.projectId !== null && names.get(thread.projectId)) || "",
              title: thread.title || thread.titleFallback || "",
              threadActive: active,
              threadUpdatedAt: thread.updatedAt,
              plan: reply.plan,
              work,
              now,
              intervals: tracker.intervals,
            });
            checks.set(thread.id, { checkedAt: now, updatedAt: thread.updatedAt, card });
            keep(card);
          } catch (error) {
            bb.log.warn(`plan read failed: ${errorName(error)}`);
          }
        }),
      );
    } catch (error) {
      bb.log.warn(`snapshot build failed: ${errorName(error)}`);
    }
    cards.push(...retainDone(kept, live, now));
    // Forget trackers of threads that are not candidates for long.
    if (trackers.size > 200) trackers.clear();
    if (checks.size > 400) checks.clear();
    const decorated = await withIcons(cards, now);
    return buildSnapshot(decorated.cards, cardLimit, now, decorated.iconUrl);
  }

  async function snapshot(): Promise<Snapshot> {
    if (cache !== null && Date.now() - cache.at < CACHE_MS) return cache.value;
    if (inflight === null) {
      inflight = build()
        .then((value) => {
          cache = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  /** Last time the notch app read the snapshot: `status` reports it instead of guessing. */
  let lastPollAt: number | null = null;
  bb.http.route(
    "GET",
    "/snapshot",
    async (c) => {
      // The app's URLSession sends "BBTouchbar/<version> CFNetwork/…"; other clients do not count.
      if (isAppAgent(c.req.header("user-agent"))) lastPollAt = Date.now();
      return c.json(await snapshot());
    },
    { auth: "token" },
  );

  const endpointUrl = () => `${bb.server.loopbackBaseUrl}/api/v1/plugins/${bb.pluginId}/http/snapshot`;
  const root = pluginRoot();
  const pluginVersion = readVersion(root);

  function scriptCli(which: AppScript) {
    return cliCommand({
      summary:
        which === "install"
          ? "Print the command that builds and installs the notch app from this plugin copy; --run runs it"
          : "Print the command that removes the notch app; --run runs it",
      options: { run: { type: "boolean", description: "Run the script now and print its output" } },
      async run(input) {
        if (process.platform !== "darwin") {
          throw new PluginCliError("the notch app runs on macOS only", { code: "unsupported_platform" });
        }
        const path = scriptPath(root, which);
        if (!input.options.run) {
          return { exitCode: 0, stdout: [scriptCommand(root, which), "", ...SCRIPT_ABOUT[which]].join("\n") };
        }
        const r = await runScript(path);
        const tail = r.timedOut ? "\n(stopped: the script ran longer than 10 minutes)" : "";
        return { exitCode: r.code === 0 ? 0 : 1, stdout: `$ ${scriptCommand(root, which)}\n${r.output}${tail}` };
      },
    });
  }

  bb.cli.register(
    defineCli({
      name: "genidev-touchbar",
      summary: "Notch Bar: plan summary for the MacBook notch app (projects, tasks done/planned, work time) and the app installer",
      commands: {
        snapshot: cliCommand({
          summary: "Threads with a plan: project, done/total, remaining, work time, state",
          options: { json: { type: "boolean", description: "Print the snapshot as JSON" } },
          async run(input) {
            const snap = await snapshot();
            if (input.options.json) return { exitCode: 0, stdout: JSON.stringify(snap) };
            if (snap.cards.length === 0) return { exitCode: 0, stdout: "No threads with a plan." };
            const lines = snap.cards.map((c) => {
              const ms = c.workMs + (c.runningSince === null ? 0 : Math.max(0, snap.generatedAt - c.runningSince));
              return [
                c.project + iconLabel(c.icon),
                `${c.done}/${c.total}`,
                `${c.remaining} left`,
                formatDuration(ms),
                STATE_LABEL[c.state],
                c.title,
              ].join("  ");
            });
            const t = snap.summary;
            const head = `Threads with a plan: ${t.threads}, working now: ${t.threadsWorking}, tasks in them: ${t.tasksInWorking}. Projects working: ${t.projectsWorking} of ${t.projects}. Tasks done/planned: ${t.done}/${t.total}.`;
            return { exitCode: 0, stdout: [head, ...lines].join("\n") };
          },
        }),
        endpoint: cliCommand({
          summary: "Snapshot URL for the notch app (token: `bb plugin token genidev-touchbar`)",
          options: { json: { type: "boolean", description: "Print { url } as JSON" } },
          async run(input) {
            let url: string;
            try {
              url = endpointUrl();
            } catch {
              throw new PluginCliError("the bb server is not listening yet", { code: "not_ready" });
            }
            return { exitCode: 0, stdout: input.options.json ? JSON.stringify({ url }) : url };
          },
        }),
        "install-app": scriptCli("install"),
        "uninstall-app": scriptCli("uninstall"),
        status: cliCommand({
          summary: "Is the notch app installed and running, its version, and when it last read the snapshot",
          options: { json: { type: "boolean", description: "Print the status as JSON" } },
          async run(input) {
            const s = await appStatus(lastPollAt);
            if (input.options.json) return { exitCode: 0, stdout: JSON.stringify({ ...s, pluginVersion }) };
            return { exitCode: 0, stdout: formatStatus(s, pluginVersion, Date.now(), root) };
          },
        }),
      },
    }),
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "error";
}

function readVersion(root: string): string {
  try {
    const v = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

const STATE_LABEL: Record<SnapshotCard["state"], string> = {
  working: "working",
  waiting: "waiting for answer",
  error: "error",
  done: "done",
  idle: "paused",
};

/** Under a minute "N s", under an hour "N min", else "H h M min". */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
