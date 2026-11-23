// One-time move of the plans background-peek kept (up to v0.5) into this
// plugin's storage. Pure functions: the server fetches the old rows over
// background-peek's `exportPlans` RPC and stores the merge; tests run these.
import { LIMITS, allSteps, readStored, type Plan } from "./plan.ts";

/** Key of the marker saved once the move ran. */
export const MIGRATION_KEY = "migration:v1";

export interface Counts {
  plans: number;
  tickets: number;
}

export function counts(plans: readonly Plan[]): Counts {
  return { plans: plans.length, tickets: plans.reduce((sum, plan) => sum + allSteps(plan).length, 0) };
}

/**
 * Merges the old plans into the ones kept here: a plan missing here is added,
 * one here with the same id is replaced only when the old one is newer. The
 * list stays sorted by update time and capped like any thread's plans.
 */
export function mergePlans(current: readonly Plan[], incoming: readonly Plan[]): Plan[] {
  const byId = new Map(current.map((plan) => [plan.id, plan]));
  for (const plan of incoming) {
    const have = byId.get(plan.id);
    if (have === undefined || plan.updatedAt > have.updatedAt) byId.set(plan.id, plan);
  }
  const merged = [...byId.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  while (merged.length > LIMITS.plansPerThread) merged.shift();
  return merged;
}

export interface ThreadReport {
  threadId: string;
  before: Counts;
  after: Counts;
  /** Old plans found here unchanged (statuses, acceptance, times). */
  same: number;
}

/** Old plans present after the merge exactly as they were. */
export function sameCount(old: readonly Plan[], kept: readonly Plan[]): number {
  const here = new Map(kept.map((plan) => [plan.id, JSON.stringify(plan)]));
  return old.filter((plan) => here.get(plan.id) === JSON.stringify(plan)).length;
}

export function reportText(rows: readonly ThreadReport[], note: string): string {
  const lines = [note, "thread                 before (plans/tickets)  ->  after (plans/tickets)  unchanged"];
  for (const row of rows) {
    const ok = row.same === row.before.plans ? "ok" : "DIFFERS";
    lines.push(
      `${row.threadId.padEnd(22)} ${`${row.before.plans}/${row.before.tickets}`.padStart(10)}              ->  ${`${row.after.plans}/${row.after.tickets}`.padStart(8)}               ${row.same}/${row.before.plans} ${ok}`,
    );
  }
  if (rows.length === 0) lines.push("(background-peek kept no plans)");
  return `${lines.join("\n")}\n`;
}

export { readStored };
