import type { ServerRow, FleetStore, ProbeWrite } from "./store.ts";
import { failureText, resolveProbeTarget, runSsh, sshArguments, type SshResult } from "./ssh-probe.ts";
import { emptyMetrics } from "./remote.ts";
import type { FailureCode } from "./classify.ts";

const LIMIT = 3;
const HOUR_MS = 60 * 60 * 1000;

export type PassScope = "all" | "stale" | { id: string };

export type PassStart =
  | { conflict: true; done: Promise<PassSummary> }
  | { conflict: false; done: Promise<PassSummary> };

export type PassSummary = {
  up: number;
  down: number;
  skipped: number;
  durationMs: number;
};

type Publish = (payload: { id: string } | { kind: "inventory" } | { kind: "pass-complete" }) => void;

export type ProbeServer = (
  server: ServerRow,
  signal: AbortSignal,
) => Promise<SshResult | { code: FailureCode; metrics: null }>;

export function createCoordinator(input: {
  store: FleetStore;
  publish: Publish;
  log: { info: (message: string) => void; warn: (message: string) => void; debug: (message: string) => void };
  now?: () => number;
  signal: AbortSignal;
  probe?: ProbeServer;
  sshPath?: string;
  knownHostsPath?: string;
}) {
  const now = input.now ?? Date.now;
  const controllers = new Map<string, AbortController>();
  const inflight = new Map<string, Promise<"up" | "down" | "skipped">>();
  let active = 0;
  const waiters: Array<() => void> = [];
  let passRunning = false;
  let aborted = input.signal.aborted;
  input.signal.addEventListener("abort", () => {
    aborted = true;
    for (const controller of controllers.values()) controller.abort();
    const pending = waiters.splice(0);
    for (const waiter of pending) waiter();
  });

  function acquire(): Promise<boolean> {
    if (aborted) return Promise.resolve(false);
    if (active < LIMIT) {
      active += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const tryTake = () => {
        if (aborted) {
          resolve(false);
          return;
        }
        if (active < LIMIT) {
          active += 1;
          resolve(true);
          return;
        }
        waiters.push(tryTake);
      };
      waiters.push(tryTake);
    });
  }

  function release(): void {
    active = Math.max(0, active - 1);
    const waiter = waiters.shift();
    waiter?.();
  }

  function probeServer(server: ServerRow, signal: AbortSignal) {
    if (input.probe !== undefined) return input.probe(server, signal);
    return probeWithSsh(server, signal, input.sshPath ?? "ssh", input.knownHostsPath ?? "");
  }

  async function runOne(id: string): Promise<"up" | "down" | "skipped"> {
    const existing = inflight.get(id);
    if (existing !== undefined) {
      await existing;
      return "skipped";
    }
    const job = runOneBody(id);
    inflight.set(id, job);
    try {
      return await job;
    } finally {
      if (inflight.get(id) === job) inflight.delete(id);
    }
  }

  async function runOneBody(id: string): Promise<"up" | "down" | "skipped"> {
    const slot = await acquire();
    if (!slot) return "skipped";
    const controller = new AbortController();
    controllers.set(id, controller);
    try {
      if (aborted) return "skipped";
      const server = input.store.get(id);
      if (server === null) return "skipped";
      const startedAt = now();
      if (!input.store.markStarted(id, server.generation, startedAt)) return "skipped";
      let result: SshResult | { code: FailureCode; metrics: null };
      try {
        result = await probeServer(server, controller.signal);
      } catch (error) {
        input.log.debug(error instanceof Error ? error.message : "probe failed");
        result = { code: "ssh_error", metrics: null };
      }
      if (aborted || controller.signal.aborted) return "skipped";
      const outcome = toWrite(result, now());
      const wrote = input.store.applyResult(id, server.generation, startedAt, outcome);
      if (wrote) input.publish({ id });
      return wrote && outcome.status === "up" ? "up" : "down";
    } finally {
      controllers.delete(id);
      release();
    }
  }

  function cancel(id: string): void {
    controllers.get(id)?.abort();
  }

  function killAll(): void {
    aborted = true;
    for (const controller of controllers.values()) controller.abort();
    const pending = waiters.splice(0);
    for (const waiter of pending) waiter();
  }

  async function executePass(scope: "all" | "stale"): Promise<PassSummary> {
    const started = now();
    const servers =
      scope === "all"
        ? input.store.list()
        : input.store.listStale(started - HOUR_MS);
    const counts = { up: 0, down: 0, skipped: 0 };
    await Promise.all(
      servers.map(async (server) => {
        const result = await runOne(server.id);
        counts[result] += 1;
      }),
    );
    const summary = { ...counts, durationMs: now() - started };
    input.log.info(
      `pass finished up=${summary.up} down=${summary.down} skipped=${summary.skipped} duration_ms=${summary.durationMs}`,
    );
    return summary;
  }

  function runPass(scope: PassScope): PassStart {
    const empty = Promise.resolve({ up: 0, down: 0, skipped: 0, durationMs: 0 });
    if (aborted) return { conflict: true, done: empty };
    if (typeof scope === "object") {
      return { conflict: false, done: runOne(scope.id).then(() => ({ up: 0, down: 0, skipped: 0, durationMs: 0 })) };
    }
    if (passRunning) return { conflict: true, done: empty };
    passRunning = true;
    const done = executePass(scope).finally(() => {
      passRunning = false;
      input.publish({ kind: "pass-complete" });
    });
    return { conflict: false, done };
  }

  return {
    runPass,
    cancel,
    killAll,
    get passRunning() {
      return passRunning;
    },
  };
}

async function probeWithSsh(
  server: ServerRow,
  signal: AbortSignal,
  sshPath: string,
  knownHosts: string,
): Promise<SshResult> {
  const literalKind = /^\d{1,3}(\.\d{1,3}){3}$/.test(server.host)
    ? "ipv4"
    : server.host.includes(":")
      ? "ipv6"
      : "hostname";
  const target = await resolveProbeTarget(server.host, literalKind);
  if (!target.ok) return { code: target.code, metrics: null };
  const args = sshArguments({
    identityPath: server.identityPath,
    port: server.port,
    address: target.address,
    hostKeyAlias: target.hostKeyAlias,
    knownHostsPath: knownHosts,
  });
  return runSsh(args, signal, sshPath);
}

function toWrite(result: SshResult | { code: FailureCode; metrics: null }, at: number): ProbeWrite {
  if (result.code === "up" || result.code === "partial") {
    return {
      status: "up",
      errorCode: result.code === "partial" ? "partial" : null,
      errorText: result.code === "partial" ? failureText("partial") : null,
      metrics: result.metrics ?? emptyMetrics(),
      now: at,
    };
  }
  return { status: "down", errorCode: result.code, errorText: failureText(result.code), now: at };
}
