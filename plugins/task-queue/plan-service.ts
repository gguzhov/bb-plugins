// Plans per thread: storage, one writer at a time, and the agent-facing
// surfaces (the `bb task-queue plan` command and the agent tool). Kept
// apart from server.ts so tests can drive it with an in-memory store.
import { PluginCliError, cliCommand, defineCli, type PluginCliRegistration } from "@get-bb/plugin-sdk";
import {
  PlanError,
  applyOp,
  describe,
  parseOp,
  parseOpText,
  readStored,
  summary,
  visiblePlan,
  withMetrics,
  type AgentLabel,
  type Plan,
} from "./plan.ts";
import { t, type Lang } from "./i18n.ts";

export interface PlanStore {
  load(threadId: string): Promise<unknown>;
  save(threadId: string, value: { plans: Plan[] } | null): Promise<void>;
}

export interface PlanService {
  apply(threadId: string, raw: unknown): Promise<Plan>;
  list(threadId: string): Promise<Plan[]>;
  clear(threadId: string, id?: string): Promise<number>;
  visible(threadId: string): Promise<{ plan: Plan; hideInMs: number | null } | null>;
  /** Stores `merge(current)` for a thread, in turn with every other write to it. */
  replace(threadId: string, merge: (current: Plan[]) => Plan[]): Promise<Plan[]>;
}

/** Stored value size the store refuses past (bb kv rows are capped at 256 KB). */
const MAX_STORED_BYTES = 240_000;

export function createPlanService(options: {
  store: PlanStore;
  now?: () => number;
  /** Called after a thread's plans changed, so open cards refetch. */
  onChange?: (threadId: string) => void;
}): PlanService {
  const { store, onChange } = options;
  const now = options.now ?? Date.now;
  // Writes to one thread run in order: two quick CLI calls must not lose a step.
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(threadId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    queues.set(threadId, tail);
    void tail.then(() => {
      if (queues.get(threadId) === tail) queues.delete(threadId);
    });
    return run;
  }
  const list = async (threadId: string) => readStored(await store.load(threadId));

  return {
    list,
    async apply(threadId, raw) {
      const op = typeof raw === "string" ? parseOpText(raw) : parseOp(raw);
      return serial(threadId, async () => {
        const result = applyOp(await list(threadId), op, now());
        const value = { plans: result.plans };
        while (value.plans.length > 1 && JSON.stringify(value).length > MAX_STORED_BYTES) value.plans.shift();
        if (JSON.stringify(value).length > MAX_STORED_BYTES) throw new PlanError("the plan is too large to store", "too_large");
        await store.save(threadId, value);
        onChange?.(threadId);
        return result.plan;
      });
    },
    clear(threadId, id) {
      return serial(threadId, async () => {
        const plans = await list(threadId);
        const kept = id === undefined ? [] : plans.filter((plan) => plan.id !== id);
        if (id !== undefined && kept.length === plans.length) {
          throw new PlanError(`no plan "${id}" in this thread`, "unknown_plan");
        }
        await store.save(threadId, kept.length === 0 ? null : { plans: kept });
        onChange?.(threadId);
        return plans.length - kept.length;
      });
    },
    replace(threadId, merge) {
      return serial(threadId, async () => {
        const next = merge(await list(threadId));
        await store.save(threadId, next.length === 0 ? null : { plans: next });
        onChange?.(threadId);
        return next;
      });
    },
    async visible(threadId) {
      return visiblePlan(await list(threadId), now());
    },
  };
}

const THREAD_ID = /^[\w-]{1,100}$/;

/**
 * `bb task-queue plan '<json>'`, `plan show [--json]`, `plan clear`, and
 * `migrate` when the server passes it. `resolveThread` turns `--thread` or the
 * caller's thread into a checked id. `bb background-peek plan` (the old name)
 * forwards its argv here unchanged, so both names answer alike.
 */
export function createPlanCli(
  service: PlanService,
  resolveThread: (threadId: string) => Promise<string> = async (threadId) => threadId,
  now: () => number = Date.now,
  migrate?: (again: boolean) => Promise<string>,
  /** Names of the agents working on tickets («Неон»), for the answers; none when the names cannot be read. */
  labeler: (threadId: string) => Promise<AgentLabel | undefined> = async () => undefined,
  /** Language of the messages written for people (the plan lines stay the agents' fixed format). */
  lang: () => Lang = () => "en",
): PluginCliRegistration {
  const thread = {
    type: "string",
    placeholder: "id",
    aliases: ["thread-id"],
    description: "Thread to use; defaults to the thread the command runs in (BB_THREAD_ID)",
  } as const;
  async function target(option: string | undefined, ctxThread: string | undefined): Promise<string> {
    const id = option ?? ctxThread;
    if (id === undefined || id === "") {
      throw new PluginCliError(t(lang()).noThread, {
        code: "missing_thread",
        hint: t(lang()).noThreadHint,
      });
    }
    if (!THREAD_ID.test(id)) throw new PluginCliError(t(lang()).notThreadId(id), { code: "invalid_thread" });
    return resolveThread(id);
  }
  const refuse = (error: unknown): never => {
    if (error instanceof PlanError) throw new PluginCliError(error.message, { code: error.code });
    throw error;
  };

  return defineCli({
    name: "task-queue",
    summary: "Keep the thread's work plan in the Working Thread card above the composer",
    description:
      "One JSON op per call. Create: {\"id\",\"title\",\"stages\":[{\"name\",\"steps\":[{\"title\",\"status\"?}]}]}. " +
      "Move: {\"id\",\"next\":true} | {\"id\",\"done\":[\"Step\"],\"active\":\"Step\"} | {\"id\",\"failed\":\"Step\",\"note\"} | " +
      "{\"id\",\"state\":\"needs_input\"|\"done\",\"note\"?}. Epics/tickets: \"epics\"=\"stages\", \"tickets\"=\"steps\"; ticket fields " +
      "points, owner, criteria, agent (code is optional and never shown). Tickets in parallel: {\"id\",\"start\":[\"T1\",\"T2\"]} | {\"id\",\"review\":[\"T1\"]} | " +
      "{\"id\",\"accept\":[{\"ticket\":\"T1\",\"confirmed\":5,\"total\":6}]} | {\"id\",\"rework\":[\"T1\"]}. " +
      "Who works on a ticket: {\"id\",\"start\":[{\"ticket\":\"T1\",\"agent\":\"<subagent description or thr_ id>\"}]} | {\"id\",\"assign\":[{\"ticket\":\"T1\",\"agent\":\"…\"}]}; ticket field agent. " +
      "Describe: {\"id\",\"describe\":[{\"ticket\":\"T1\",\"desc\":\"...\"}]}; ticket field desc. Tickets are addressed by title or code, without case.",
    commands: {
      plan: cliCommand({
        summary: "Create, replace or move the thread's plan with one JSON op",
        positionals: [
          {
            name: "op",
            description: "The op as JSON, in single quotes, e.g. '{\"id\":\"task\",\"next\":true}'",
            required: true,
            variadic: true,
          },
        ],
        options: {
          thread,
          json: { type: "boolean", description: "Print the updated plan as JSON" },
        },
        async run(input, ctx) {
          const threadId = await target(input.options.thread, ctx.threadId);
          const plan = await service.apply(threadId, input.positionals.op.join(" ")).catch(refuse);
          if (input.options.json) return { exitCode: 0, stdout: `${JSON.stringify(withMetrics(plan, now()))}\n` };
          return { exitCode: 0, stdout: `${summary(plan, now(), await labeler(threadId))}\n` };
        },
      }),
      "plan show": cliCommand({
        summary: "Print the thread's plans, the most recent last",
        options: {
          thread,
          json: { type: "boolean", description: "Print {plans:[...]} as JSON" },
          full: { type: "boolean", description: "Add each ticket's description (desc) on a line under it" },
        },
        async run(input, ctx) {
          const threadId = await target(input.options.thread, ctx.threadId);
          const plans = await service.list(threadId);
          if (input.options.json) {
            const at = now();
            return { exitCode: 0, stdout: `${JSON.stringify({ threadId, plans: plans.map((plan) => withMetrics(plan, at)) })}\n` };
          }
          return {
            exitCode: 0,
            stdout:
              plans.length === 0
                ? `${t(lang()).noPlan}\n`
                : await (async () => {
                    const label = await labeler(threadId);
                    return `${plans.map((plan) => describe(plan, now(), input.options.full === true, label)).join("\n\n")}\n`;
                  })(),
          };
        },
      }),
      "plan clear": cliCommand({
        summary: "Delete the thread's plans, or one of them with --id",
        options: {
          thread,
          id: { type: "string", description: "Delete only the plan with this id" },
        },
        async run(input, ctx) {
          const threadId = await target(input.options.thread, ctx.threadId);
          const removed = await service.clear(threadId, input.options.id).catch(refuse);
          return { exitCode: 0, stdout: `${t(lang()).removed(removed)}\n` };
        },
      }),
      ...(migrate === undefined
        ? {}
        : {
            migrate: cliCommand({
              summary: "Copy plans kept by an older companion plugin (background-peek before v0.6), if it is installed, and print the check",
              options: {
                again: {
                  type: "boolean",
                  description: "Merge again even if it already ran: a newer plan in the old plugin replaces this one",
                },
              },
              async run(input) {
                return { exitCode: 0, stdout: await migrate(input.options.again === true) };
              },
            }),
          }),
    },
  });
}

/** The agent tool's answer: one line on success, the refusal with the step list otherwise. */
export async function runPlanTool(
  service: PlanService,
  threadId: string,
  params: unknown,
  labeler: (threadId: string) => Promise<AgentLabel | undefined> = async () => undefined,
): Promise<string | { content: { type: "text"; text: string }[]; isError: true }> {
  try {
    const plan = await service.apply(threadId, params);
    return summary(plan, plan.updatedAt, await labeler(threadId));
  } catch (error) {
    if (error instanceof PlanError) return { content: [{ type: "text", text: error.message }], isError: true };
    throw error;
  }
}
