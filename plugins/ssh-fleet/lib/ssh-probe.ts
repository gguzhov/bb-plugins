import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { classifyFailure, errorSentence, type FailureCode } from "./classify.ts";
import { isDeniedAddress } from "./hosts.ts";
import { REMOTE_SCRIPT, parseRemoteOutput, type Metrics } from "./remote.ts";

const OUTPUT_CAP = 8 * 1024;
const PROBE_BUDGET_MS = 20_000;

export type ResolvedTarget =
  | { ok: true; address: string; hostKeyAlias: string | null }
  | { ok: false; code: "dns" | "blocked_target" };

export async function resolveProbeTarget(
  host: string,
  kind: "hostname" | "ipv4" | "ipv6",
  resolve: (hostname: string) => Promise<string[]> = defaultLookup,
): Promise<ResolvedTarget> {
  if (kind !== "hostname") {
    return isDeniedAddress(host)
      ? { ok: false, code: "blocked_target" }
      : { ok: true, address: host, hostKeyAlias: null };
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, code: "dns" };
  }
  if (addresses.length === 0) return { ok: false, code: "dns" };
  if (addresses.some((address) => isDeniedAddress(address))) {
    return { ok: false, code: "blocked_target" };
  }
  const allowed = addresses.find((address) => !isDeniedAddress(address));
  if (allowed === undefined) return { ok: false, code: "blocked_target" };
  return { ok: true, address: allowed, hostKeyAlias: host };
}

export function defaultLookup(hostname: string): Promise<string[]> {
  return lookup(hostname, { all: true, verbatim: true }).then((records) =>
    records.map((record) => record.address),
  );
}

export function sshArguments(input: {
  identityPath: string;
  port: number;
  address: string;
  hostKeyAlias: string | null;
  knownHostsPath: string;
}): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `IdentityFile=${input.identityPath}`,
    "-o",
    "PubkeyAuthentication=yes",
    "-o",
    "PreferredAuthentications=publickey",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${input.knownHostsPath}`,
  ];
  if (input.hostKeyAlias !== null) {
    args.push("-o", `HostKeyAlias=${input.hostKeyAlias}`);
  }
  args.push("-T", "-p", String(input.port), "-l", "root", "--", input.address, REMOTE_SCRIPT);
  return args;
}

export function knownHostsPath(): string {
  return `${homedir()}/.ssh/known_hosts`;
}

export type SshResult = {
  code: FailureCode | "up" | "partial";
  metrics: Metrics | null;
};

type SpawnFn = typeof spawn;

export async function runSsh(
  args: string[],
  signal: AbortSignal,
  sshPath = "ssh",
  spawnImpl: SpawnFn = spawn,
): Promise<SshResult> {
  if (signal.aborted) return { code: "ssh_error", metrics: null };
  const child = spawnImpl(sshPath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const collect = (chunk: Buffer, which: "out" | "err") => {
    const next = (which === "out" ? stdout : stderr) + chunk.toString("utf8");
    if (next.length > OUTPUT_CAP) {
      truncated = true;
      if (which === "out") stdout = next.slice(0, OUTPUT_CAP);
      else stderr = next.slice(0, OUTPUT_CAP);
      killGroup(child);
      return;
    }
    if (which === "out") stdout = next;
    else stderr = next;
  };
  child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "out"));
  child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "err"));

  const timedOut = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (timeout: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(timeout);
    };
    const timer = setTimeout(() => {
      killGroup(child);
      finish(true);
    }, PROBE_BUDGET_MS);
    const onAbort = () => {
      killGroup(child);
      finish(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("close", () => finish(false));
    child.on("error", () => finish(false));
  });

  if (signal.aborted) return { code: "ssh_error", metrics: null };
  if (truncated) return { code: "truncated", metrics: null };
  if (timedOut) return { code: "timeout", metrics: null };
  if (child.exitCode === 0) {
    const parsed = parseRemoteOutput(stdout);
    if (parsed.count === 0) return { code: "partial", metrics: parsed.metrics };
    const missing = Object.values(parsed.metrics).some((value) => value === null);
    return { code: missing ? "partial" : "up", metrics: parsed.metrics };
  }
  const code = classifyFailure({ stderr, timedOut, truncated: false });
  return { code, metrics: null };
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process already exited.
    }
  }
}

export function redactKey(text: string, identityPath: string): string {
  return text.split(identityPath).join("[key]");
}

export function failureText(code: FailureCode | "partial"): string {
  return errorSentence(code);
}
