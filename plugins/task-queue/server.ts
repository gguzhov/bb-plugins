// bb-plugin-task-queue — backend.
//
// The thread's work plan: stored per thread in bb's kv, moved by the agent
// with `bb task-queue plan '<json>'` or the `task_queue_plan` tool, read by
// the card with RPC `plan({ threadId })`. Every change is announced on the
// realtime channel "plan" so open cards refetch at once.
//
// Background agents and commands of the thread are read here from its
// timeline (activity-source.ts): the card needs no other plugin.
//
// Optional, only for an older companion plugin of the same author
// (background-peek, which kept the plan up to its v0.5): its
// `bb background-peek plan …` and `background_peek_plan` forward to the `cli`
// and `tool` RPCs below, and the plans it stored are copied here once
// (`migrate`). When it is not installed, both simply never run.
import { PluginCliError, defineRpcContract, type BbPluginApi, type PluginCliRegistration } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PLAN_CHANNEL, allSteps, readStored, type AgentLabel, type Plan } from "./plan.ts";
import { stripCodes } from "./agent-names.ts";
import { createPlanCli, createPlanService, runPlanTool } from "./plan-service.ts";
import { createActivitySource } from "./activity-source.ts";
import { LANGUAGE_OPTIONS, resolveLang, t, type Lang } from "./i18n.ts";
import { MIGRATION_KEY, counts, mergePlans, reportText, sameCount, type ThreadReport } from "./migrate.ts";

const planStepSchema = z.object({
  title: z.string(),
  status: z.enum(["pending", "active", "review", "done", "error", "skipped"]),
  code: z.string().optional(),
  agent: z.string().optional(),
  points: z.number().optional(),
  owner: z.string().optional(),
  desc: z.string().optional(),
  criteria: z.number().optional(),
  accepted: z.number().optional(),
  rework: z.number().optional(),
  createdAt: z.number().optional(),
  startedAt: z.number().optional(),
  reworkAt: z.number().optional(),
  reviewAt: z.number().optional(),
  doneAt: z.number().optional(),
});
const planSchema = z.object({
  id: z.string(),
  title: z.string(),
  stages: z.array(z.object({ name: z.string(), steps: z.array(planStepSchema) })),
  state: z.enum(["running", "needs_input", "error", "done"]),
  note: z.string().nullable(),
  startedAt: z.number(),
  updatedAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type PlanDto = z.infer<typeof planSchema>;

/** One background agent or command (activity-source.ts). */
const stepSchema = z.object({
  id: z.string(),
  icon: z.string().nullable(),
  label: z.string(),
  text: z.string(),
  status: z.enum(["pending", "done", "error"]),
  tool: z.string().optional(),
});
const activitySchema = z.object({
  id: z.string(),
  kind: z.enum(["agent", "command", "other"]),
  label: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  startedAt: z.number().nullable(),
  tokens: z.number().nullable(),
  toolUses: z.number().nullable(),
  command: z.string().nullable(),
  output: z.array(z.string()),
  running: z.array(stepSchema),
  /** Name by launch order in the thread's history («Неон»), from thread-materials; null when unknown. */
  name: z.string().nullable().optional(),
  /** false: thread-materials did not answer and the name is the order among the agents running now. */
  nameFromHistory: z.boolean().optional(),
  /** Model the agent runs on, when thread-materials knows it. */
  model: z.string().nullable().optional(),
});
export type ActivityDto = z.infer<typeof activitySchema>;

/** Older companion plugin allowed to call `cli` and `tool` (the old name of the command and the tool); optional. */
const LEGACY_PLUGIN = "background-peek";

export const rpcContract = defineRpcContract({
  /** The plan the card shows, or null; `hideInMs` counts down a finished one. */
  plan: {
    input: z.object({ threadId: z.string().min(1).max(100) }),
    output: z.object({ plan: planSchema.nullable(), hideInMs: z.number().nullable() }),
  },
  /**
   * Background agents and commands of the thread, read from its timeline.
   * `available` is false when the timeline could not be read: the card then
   * shows the plan alone.
   */
  activity: {
    input: z.object({ threadId: z.string().min(1).max(100) }),
    output: z.object({ items: z.array(activitySchema), available: z.boolean() }),
  },
  /** `bb background-peek plan …` forwarded: the same argv run by `bb task-queue`. */
  cli: {
    input: z.object({ argv: z.array(z.string().max(300_000)).max(200), threadId: z.string().max(100).nullable() }),
    output: z.object({ exitCode: z.number(), stdout: z.string(), stderr: z.string() }),
  },
  /** `background_peek_plan` forwarded: the same params run by `task_queue_plan`. */
  tool: {
    input: z.object({ threadId: z.string().min(1).max(100), params: z.unknown() }),
    output: z.object({ text: z.string(), isError: z.boolean() }),
  },
});

const PLAN_KEY = (threadId: string) => `plan:${threadId}`;

/** JSON schema the agent tool advertises; the op is validated again by plan.ts. */
const STATUS_ENUM = ["pending", "active", "review", "done", "error", "skipped"];
const TICKET_ITEM = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string" },
    status: { type: "string", enum: STATUS_ENUM },
    code: { type: "string", description: "Optional old ticket code, never shown; not needed for new plans" },
    agent: { type: "string", description: "Who works on the ticket: the subagent's description as given at launch, or a child thread id thr_…" },
    points: { type: "integer", enum: [1, 2, 3, 5, 8, 13], description: "Size; counts as 1 when left out" },
    owner: { type: "string", description: "Who does it, up to 40 characters: the executor's model (\"Sonnet 5.5\") or \"Lead: <model>\"" },
    desc: { type: "string", description: "One or two sentences in the user's language: what gets done and what comes of it (up to 300 characters); the user reads it on hover" },
    criteria: { type: "integer", minimum: 0, maximum: 50, description: "Number of acceptance criteria" },
    accepted: { type: "integer", minimum: 0, maximum: 50, description: "Kept only on a done ticket; use accept instead" },
  },
} as const;
const TICKET_LIST = { type: "array", items: { type: "string" } } as const;
export const PLAN_TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", description: "Plan id, one per task" },
    title: { type: "string", description: "Plan title; required when the plan is created" },
    stages: {
      type: "array",
      description: "Create or replace the plan: epics (\"Queue 1: …\", named in the user's language) of tickets (one epic with one ticket is fine). Synonym: epics",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          steps: { type: "array", items: TICKET_ITEM },
          tickets: { type: "array", items: TICKET_ITEM, description: "Synonym of steps" },
        },
      },
    },
    epics: { type: "array", description: "Synonym of stages", items: { type: "object" } },
    steps: { type: "array", description: "Instead of stages, one flat list of tickets", items: TICKET_ITEM },
    tickets: { type: "array", description: "Synonym of steps", items: TICKET_ITEM },
    next: { type: "boolean", description: "true: the current ticket is done, the next one becomes current" },
    done: { ...TICKET_LIST, description: "Tickets (by title) to mark done, without acceptance" },
    skipped: { ...TICKET_LIST, description: "Tickets to mark skipped" },
    active: { type: "string", description: "Ticket that becomes current; earlier current tickets count as done" },
    start: {
      type: "array",
      description: "Tickets to put in work (others stay in work); with agent: who does it — the subagent's description or a child thread id",
      items: { anyOf: [{ type: "string" }, { type: "object", required: ["ticket"], properties: { ticket: { type: "string" }, agent: { type: "string" } } }] },
    },
    assign: {
      type: "array",
      description: "Say which agent works on a ticket without moving it: [{ticket, agent}]; one agent may do several tickets",
      items: { type: "object", required: ["ticket", "agent"], properties: { ticket: { type: "string" }, agent: { type: "string" } } },
    },
    review: { ...TICKET_LIST, description: "Tickets handed in for acceptance (active -> review)" },
    accept: {
      type: "array",
      description: "Lead's acceptance: ticket becomes done with confirmed/total criteria. \"T1\" alone = all criteria confirmed",
      items: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            required: ["ticket"],
            properties: {
              ticket: { type: "string" },
              confirmed: { type: "integer", minimum: 0, maximum: 50 },
              total: { type: "integer", minimum: 0, maximum: 50 },
            },
          },
        ],
      },
    },
    rework: {
      type: "array",
      description: "Send tickets in review or done back to work; counts a rework and clears acceptance",
      items: {
        anyOf: [
          { type: "string" },
          { type: "object", required: ["ticket"], properties: { ticket: { type: "string" }, note: { type: "string" } } },
        ],
      },
    },
    describe: {
      type: "array",
      description: "Set or change tickets' descriptions: [{ticket:\"T1\",desc:\"...\"}]; an empty desc clears it",
      items: { type: "object", required: ["ticket", "desc"], properties: { ticket: { type: "string" }, desc: { type: "string" } } },
    },
    failed: { type: "string", description: "Ticket that failed (send a note)" },
    note: { type: "string", description: "Why the plan waits or failed" },
    state: { type: "string", enum: ["running", "needs_input", "error", "done"] },
  },
} as const;

/** After a failed attempt to read the old plans, the move is tried again this much later, then given up for the session. */
const MIGRATION_RETRY_MS = 10_000;
const MIGRATION_ATTEMPTS = 3;

const exportSchema = z.object({ threads: z.array(z.object({ threadId: z.string(), value: z.unknown() })) });

const namesSchema = z.object({
  agents: z.array(
    z.object({ id: z.string(), title: z.string(), name: z.string(), ordinal: z.number(), model: z.string().nullable(), startedAt: z.number().nullable(), keys: z.array(z.string()) }),
  ),
});
type NamedAgent = z.infer<typeof namesSchema>["agents"][number];
const nameKey = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
/** Order of fallback names when thread-materials is away: «Неон», «Глитч» … among the agents running now. */
const FALLBACK = ["Неон", "Глитч", "Шифр", "Вектор", "Нова", "Хром", "Эхо", "Квант", "Пиксель", "Зеро"];

/** The executor a background item is: by id (family/run ids), else by its name as given at launch. */
export function findNamed(agents: readonly NamedAgent[], item: { id: string; title: string }): NamedAgent | null {
  const byKey = agents.find((agent) => agent.keys.includes(item.id) || agent.id === item.id);
  if (byKey !== undefined) return byKey;
  const title = nameKey(item.title);
  const matches = agents.filter((agent) => nameKey(agent.title) === title || nameKey(stripCodes(agent.title)) === nameKey(stripCodes(item.title)));
  // The same description used twice: the latest launch is the one running.
  return matches.sort((a, b) => b.ordinal - a.ordinal)[0] ?? null;
}

/** Locale of the machine the server runs on, for `language: auto`. */
function serverLocales(): string[] {
  const env = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG].filter((value): value is string => value !== undefined && value !== "" && value !== "C" && value !== "POSIX");
  let intl: string | undefined;
  try {
    intl = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    intl = undefined;
  }
  return intl === undefined ? env : [...env, intl];
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    language: {
      type: "select",
      label: "Language",
      description: "Language of the card, its hints and the command's messages. auto: Russian when the browser (or, for the command, the computer) uses Russian, English otherwise.",
      options: [...LANGUAGE_OPTIONS],
      experimental_optionLabels: { auto: "Auto", en: "English", ru: "Русский" },
      default: "auto",
    },
  });
  let lang: Lang = resolveLang((await settings.get()).language, serverLocales());
  settings.onChange((next) => {
    lang = resolveLang(next.language, serverLocales());
  });
  const words = () => t(lang);

  const activity = createActivitySource({
    timeline: (threadId, segments) => bb.sdk.threads.timeline({ threadId, includeNestedRows: "true", segmentLimit: segments }),
    warn: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => activity.clear());

  const plans = createPlanService({
    store: {
      load: (threadId) => bb.storage.kv.get(PLAN_KEY(threadId)),
      save: async (threadId, value) => {
        if (value === null) await bb.storage.kv.delete(PLAN_KEY(threadId));
        else await bb.storage.kv.set(PLAN_KEY(threadId), value);
      },
    },
    onChange: (threadId) => bb.realtime.publish(PLAN_CHANNEL, { threadId }),
  });

  /** Copies background-peek's plans here, newer plan wins, and reports the counts. */
  async function migrate(again: boolean): Promise<string> {
    const marker = await bb.storage.kv.get<{ at: number }>(MIGRATION_KEY);
    if (marker !== undefined && !again) {
      return `Already moved on ${new Date(marker.at).toISOString()}; run with --again to merge once more.\n${await compare()}`;
    }
    const exported = await bb.sdk.plugins.callRpc({
      pluginId: LEGACY_PLUGIN,
      method: "exportPlans",
      input: {},
      outputSchema: exportSchema,
    });
    const rows: ThreadReport[] = [];
    for (const { threadId, value } of exported.threads) {
      const old = readStored(value);
      const after = await plans.replace(threadId, (current) => mergePlans(current, old));
      rows.push({ threadId, before: counts(old), after: counts(after), same: sameCount(old, after) });
    }
    await bb.storage.kv.set(MIGRATION_KEY, { at: Date.now(), threads: rows });
    bb.log.info(`moved plans of ${rows.length} threads from ${LEGACY_PLUGIN}`);
    return reportText(rows, `Moved the plans of ${rows.length} threads from ${LEGACY_PLUGIN} (its copy is kept).`);
  }

  /** The check alone: background-peek's copy against the plans kept here, nothing written. */
  async function compare(): Promise<string> {
    const exported = await bb.sdk.plugins.callRpc({
      pluginId: LEGACY_PLUGIN,
      method: "exportPlans",
      input: {},
      outputSchema: exportSchema,
    });
    const rows: ThreadReport[] = [];
    for (const { threadId, value } of exported.threads) {
      const old = readStored(value);
      const here = await plans.list(threadId);
      rows.push({ threadId, before: counts(old), after: counts(here), same: sameCount(old, here) });
    }
    return reportText(rows, "background-peek's copy against task-queue now:");
  }

  let migration: Promise<void> | null = null;
  let retryAt = 0;
  let failures = 0;
  /** Runs the move once before the first plan read or write; a failure is logged and retried later. */
  function ensureMigrated(): Promise<void> {
    if (migration !== null) return migration;
    if (Date.now() < retryAt || failures >= MIGRATION_ATTEMPTS) return Promise.resolve();
    migration = (async () => {
      if ((await bb.storage.kv.get(MIGRATION_KEY)) !== undefined) return;
      await migrate(false);
    })().catch((error: unknown) => {
      // Usually the old plugin is simply not installed: nothing to move. Tried a
      // few times (it may still be starting), then left alone until a restart;
      // `bb task-queue migrate` runs it by hand.
      failures += 1;
      if (failures >= MIGRATION_ATTEMPTS) bb.log.info(`no old plans to move from ${LEGACY_PLUGIN} (${String(error)})`);
      retryAt = Date.now() + MIGRATION_RETRY_MS;
      migration = null;
    });
    return migration;
  }

  const resolveThread = async (threadId: string) => {
    try {
      await bb.sdk.threads.get({ threadId });
    } catch {
      throw new PluginCliError(words().unknownThread(threadId), {
        code: "unknown_thread",
        hint: words().unknownThreadHint,
      });
    }
    return threadId;
  };
  const cli = createPlanCli(plans, resolveThread, Date.now, async (again) => {
    // The command answers even when the old plugin is not installed, with the reason.
    try {
      return await migrate(again);
    } catch (error) {
      throw new PluginCliError(words().migrationFailed(error instanceof Error ? error.message : String(error)), {
        code: "migration_failed",
        hint: words().migrationHint,
      });
    }
  }, labeler, () => lang);
  const registration: PluginCliRegistration = {
    ...cli,
    run: async (argv, ctx) => {
      if (argv[0] !== "migrate") await ensureMigrated();
      return cli.run(argv, ctx);
    },
  };

  /** thread-materials' names of the thread's executors; null when it does not answer. */
  async function namedAgents(threadId: string): Promise<NamedAgent[] | null> {
    try {
      const result = await bb.sdk.plugins.callRpc({ pluginId: "thread-materials", method: "agentNames", input: { threadId }, outputSchema: namesSchema });
      return result.agents;
    } catch {
      return null;
    }
  }
  /** For answers: a ticket's agent (its `agent` field) by name, «Неон». */
  async function labeler(threadId: string): Promise<AgentLabel | undefined> {
    const named = await plans.list(threadId).then((list) => list.some((plan) => allSteps(plan).some((step) => step.agent !== undefined)));
    if (!named) return undefined;
    const agents = await namedAgents(threadId);
    if (agents === null) return undefined;
    return (step) => {
      if (step.agent === undefined) return null;
      const key = nameKey(step.agent);
      const found =
        agents.find((agent) => agent.id === step.agent || agent.keys.includes(step.agent!)) ??
        agents.filter((agent) => nameKey(agent.title) === key || nameKey(stripCodes(agent.title)) === key).sort((a, b) => b.ordinal - a.ordinal)[0];
      return found?.name ?? null;
    };
  }

  bb.rpc.register(rpcContract, {
    plan: async ({ threadId }) => {
      await ensureMigrated();
      const shown = await plans.visible(threadId);
      return { plan: shown?.plan ?? null, hideInMs: shown?.hideInMs ?? null };
    },
    activity: async ({ threadId }) => {
      let items: ActivityDto[];
      try {
        items = await activity.read(threadId);
      } catch {
        return { items: [], available: false };
      }
      const agents = items.some((item) => item.kind === "agent") ? await namedAgents(threadId) : [];
      let spare = 0;
      const running = [...items].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      const named = new Map<string, Partial<ActivityDto>>();
      for (const item of running) {
        if (item.kind !== "agent") continue;
        const found = agents === null ? null : findNamed(agents, item);
        named.set(
          item.id,
          found !== null
            ? { name: found.name, nameFromHistory: true, model: found.model }
            : { name: FALLBACK[spare++ % FALLBACK.length]!, nameFromHistory: false },
        );
      }
      return { items: items.map((item) => ({ ...item, ...(named.get(item.id) ?? {}) })), available: true };
    },
    cli: async ({ argv, threadId }, { experimental_caller: caller }) => {
      if (caller.kind !== "plugin" || caller.pluginId !== LEGACY_PLUGIN) throw new Error("only background-peek forwards plan commands");
      await ensureMigrated();
      const result = await cli.run(argv, threadId === null ? {} : { threadId });
      return { exitCode: result.exitCode, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    tool: async ({ threadId, params }, { experimental_caller: caller }) => {
      if (caller.kind !== "plugin" || caller.pluginId !== LEGACY_PLUGIN) throw new Error("only background-peek forwards plan tool calls");
      await ensureMigrated();
      const result = await runPlanTool(plans, threadId, params, labeler);
      return typeof result === "string" ? { text: result, isError: false } : { text: result.content[0]!.text, isError: true };
    },
  });

  bb.cli.register(registration);

  bb.agents.registerTool({
    name: "task_queue_plan",
    description:
      `Show and move this thread's work plan (task -> epics "${words().epicPattern}" -> tickets)` + " in the Working Thread card above the composer. One op per call: " +
      "create {id,title,epics:[{name,tickets:[{title,points?,owner?,criteria?,desc?,agent?}]}]} (stages/steps work too), then " +
      "{id,start:[{ticket:\"T1\",agent:\"<subagent description>\"},\"T2\"]}, {id,assign:[{ticket,agent}]}, {id,review:[\"T1\"]}, {id,accept:[{ticket:\"T1\",confirmed:5,total:6}]} (lead only), " +
      "{id,rework:[{ticket:\"T1\",note}]}, or the old {id,next:true}, {id,done:[...],active:\"T\"}, {id,failed:\"T\",note}, " +
      "{id,state:\"needs_input\"|\"done\",note?}. Tickets are addressed by title (old plans also by code), without case; an unknown one " +
      "is refused with the list. Returns one line: `done/total, state, active · review · accepted N%`.",
    instructions:
      "For any task, even one ticket, keep a plan in the Working Thread card: create it once with " +
      `task_queue_plan (or \`bb task-queue plan '<json>'\`), name epics "${words().epicPattern}", set owner` + " to the executor's model or " +
      "\"Lead: <model>\", give every ticket a one-two sentence desc in the user's language (the user reads it on hover), " +
      "name subagents in plain words in the user's language (what they do, no codes) and tie them to tickets with start:[{ticket,agent:\"<that description>\"}] or assign; " +
      "a background command is tied the same way by its description, a child thread by its thr_ id. " +
      `The card names agents itself (${words().namesExample}). Move tickets with start/review/accept/rework (or next/done/active), ` +
      "send state needs_input before asking the user and done at the end. If a result is lost, check " +
      "`bb task-queue plan show --json` instead of repeating next.",
    presentation: {
      label: { pending: "Updating plan", completed: "Updated plan" },
      icon: { glyph: "ListTodo" },
      suppress: true,
    },
    parameters: PLAN_TOOL_PARAMETERS,
    execute: async (params, { threadId }) => {
      await ensureMigrated();
      return runPlanTool(plans, threadId, params, labeler);
    },
  });
}

export type { Plan };
