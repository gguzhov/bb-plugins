// Pure helpers that turn a bb thread timeline into "what is running in the
// background, and what is it doing right now". No SDK imports, so they can be
// exercised with a saved timeline (see tests/activity.test.mjs).
// Working Thread reads background work itself; it needs no other plugin.

/** A timeline row read loosely, so new row kinds never break the card. */
export type Row = Record<string, unknown>;

export interface Step {
  id: string;
  /** Lucide icon name bb suggests for the row, e.g. "Terminal". */
  icon: string | null;
  /** Short verb phrase: "Running command", "Thought", "Read file". */
  label: string;
  /** What the step is about: the command, the path, the thought. */
  text: string;
  status: "pending" | "done" | "error";
  /** The provider's tool name ("Bash", "Edit"), when the row carries one. */
  tool?: string;
}

export interface Activity {
  id: string;
  kind: "agent" | "command" | "other";
  /** "Running background agent" — bb's own wording for the row. */
  label: string;
  title: string;
  icon: string | null;
  startedAt: number | null;
  tokens: number | null;
  toolUses: number | null;
  /** Steps hidden before the returned ones. */
  /** Command: the shell line that was started in the background. */
  command: string | null;
  /** Command: the file its output is written to while it runs, when the provider names one. */
  outputPath: string | null;
  /** Agent: the commands and tool calls it is waiting on right now. Thoughts and finished steps stay in the chat. */
  running: Step[];
}

const MAX_TEXT = 400;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function rec(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value.filter((row) => rec(row) !== null) as Row[]) : [];
}
function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

function stepStatus(row: Row): Step["status"] {
  const status = str(row.status);
  if (status === "pending") return "pending";
  if (status === "error") return "error";
  const exitCode = num(row.exitCode);
  return exitCode !== null && exitCode !== 0 ? "error" : "done";
}

/** One nested row of a subagent, as a line the card can print. */
export function toStep(row: Row): Step | null {
  const id = str(row.id);
  if (id === null) return null;
  const status = stepStatus(row);
  const presentation = rec(row.presentation);
  const labels = rec(presentation?.label);
  const icon = str(rec(presentation?.icon)?.glyph);

  if (row.kind === "conversation") {
    const text = str(row.text);
    if (text === null) return null;
    return { id, icon: "MessageSquare", label: "Said", text: clip(text), status };
  }
  if (row.kind === "system") {
    const text = str(row.detail) ?? str(row.title);
    if (text === null) return null;
    const thought = row.operationKind === "reasoning";
    return {
      id,
      icon: thought ? "Brain" : icon,
      label: thought ? (status === "pending" ? "Thinking" : "Thought") : (str(row.title) ?? "Step"),
      text: clip(text),
      status,
    };
  }
  const label =
    str(status === "pending" ? labels?.pending : labels?.completed) ??
    str(row.toolName) ??
    str(row.workKind) ??
    "Step";
  const text =
    str(row.description) ??
    str(presentation?.title) ??
    str(row.command) ??
    str(row.path) ??
    str(row.query) ??
    str(row.url) ??
    "";
  const tool = str(row.toolName);
  return tool === null ? { id, icon, label, text: clip(text), status } : { id, icon, label, text: clip(text), status, tool };
}

function walk(list: Row[], visit: (row: Row) => void): void {
  for (const row of list) {
    visit(row);
    walk(rows(row.children), visit);
  }
}

const LAUNCHED = /running in background/i;
const OUTPUT_PATH = /output is being written to:\s*(\S+?\.output)/i;
/** A launch row and the background item it started are written within moments of each other. */
const LAUNCH_WINDOW_MS = 5000;

/** True for a step that is real work in progress, not a thought or a message. */
function isRunningWork(row: Row): boolean {
  return row.kind === "work" && row.status === "pending";
}

/**
 * Join bb's list of live background work with the rows that describe it. They
 * share no id: an agent is matched to the newest background delegation with
 * the same description, a command to the launch row written at the same time.
 */
export function buildActivities(timeline: Row): Activity[] {
  const delegations: Row[] = [];
  const launches: Row[] = [];
  walk(rows(timeline.rows), (row) => {
    if (row.workKind === "delegation" && row.background === true) delegations.push(row);
    else if (row.workKind === "command" && LAUNCHED.test(str(row.output) ?? "")) launches.push(row);
  });
  const used = new Set<Row>();

  return rows(timeline.activeBackgroundCommands).map((active, index) => {
    const presentation = rec(active.presentation);
    const title = str(active.description) ?? str(presentation?.title) ?? "Background task";
    const taskType = str(active.taskType) ?? "";
    const kind: Activity["kind"] = taskType.includes("agent")
      ? "agent"
      : taskType.includes("bash")
        ? "command"
        : "other";
    const usage = rec(active.usage);
    const startedAt = num(active.startedAt);

    let running: Step[] = [];
    let command: string | null = null;
    let outputPath: string | null = null;
    if (kind === "agent") {
      const match = [...delegations]
        .reverse()
        .find((row) => !used.has(row) && str(row.description) === title);
      if (match !== undefined) {
        used.add(match);
        running = rows(match.childRows)
          .filter(isRunningWork)
          .map(toStep)
          .filter((step): step is Step => step !== null);
      }
    } else if (kind === "command" && startedAt !== null) {
      let best: Row | null = null;
      let bestGap = LAUNCH_WINDOW_MS;
      for (const row of launches) {
        if (used.has(row)) continue;
        const at = num(row.createdAt) ?? num(row.startedAt);
        if (at === null) continue;
        const gap = Math.abs(at - startedAt);
        if (gap <= bestGap) {
          best = row;
          bestGap = gap;
        }
      }
      if (best !== null) {
        used.add(best);
        command = str(best.command);
        outputPath = OUTPUT_PATH.exec(str(best.output) ?? "")?.[1] ?? null;
      }
    }
    return {
      id: str(active.id) ?? str(active.itemId) ?? `item-${index}`,
      kind,
      label:
        str(rec(presentation?.label)?.pending) ??
        (kind === "agent" ? "Running background agent" : "Running background command"),
      title,
      icon: str(rec(presentation?.icon)?.glyph),
      startedAt,
      tokens: num(usage?.totalTokens),
      toolUses: num(usage?.toolUses),
      command,
      outputPath,
      running,
    };
  });
}

/** The last non-empty lines of a command's output, each cut to a printable width. */
export function tailLines(text: string, count: number, width = 240): string[] {
  const lines = text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((line) => line.split("\r").pop() ?? "")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
  return lines.slice(-count).map((line) => (line.length > width ? `${line.slice(0, width - 1)}…` : line));
}
