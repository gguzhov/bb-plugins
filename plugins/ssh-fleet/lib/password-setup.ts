/**
 * One-time root password setup: the password is used once to install a
 * dedicated key, then only the key path is kept.
 *
 * Where the password may go, and nowhere else:
 *   - the `password` argument of `installKeyWithPassword` (process memory);
 *   - the environment of ONE `ssh` child (`SSH_FLEET_ASKPASS_SECRET`), which
 *     reaches it through the askpass helper below with
 *     `SSH_ASKPASS_REQUIRE=force`.
 * It is never put in argv, never written to a file, never logged and never
 * returned: every stderr line is passed through `redact` before it is even
 * classified, and callers only ever see a `SetupError` code.
 */
import { spawn } from "node:child_process";
import { accessSync, appendFileSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupIdFromLabel } from "./groups.ts";

/** The askpass helper. It holds no secret: it prints the variable only for a password prompt. */
export const ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  *[Pp]assword*) printf '%s\\n' "$SSH_FLEET_ASKPASS_SECRET" ;;
  *) exit 1 ;;
esac
`;

export const SECRET_ENV = "SSH_FLEET_ASKPASS_SECRET";

/** Remote side of the password session. The public key arrives on stdin. */
export const INSTALL_SCRIPT = [
  `[ "$(id -u)" = 0 ] || { echo SSH_FLEET_NOT_ROOT >&2; exit 41; }`,
  `IFS= read -r key || exit 42`,
  `case "$key" in ssh-ed25519\\ *) ;; *) exit 42 ;; esac`,
  `umask 077`,
  `[ -d /root/.ssh ] || { mkdir /root/.ssh && chmod 700 /root/.ssh; } || exit 43`,
  `f=/root/.ssh/authorized_keys`,
  `[ -f "$f" ] || { : > "$f" && chmod 600 "$f"; } || exit 43`,
  `if grep -qxF -- "$key" "$f"; then echo SSH_FLEET_KEY_PRESENT; exit 0; fi`,
  `if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf '\\n' >> "$f" || exit 43; fi`,
  `printf '%s\\n' "$key" >> "$f" || exit 43`,
  `command -v restorecon >/dev/null 2>&1 && restorecon -R /root/.ssh >/dev/null 2>&1`,
  `echo SSH_FLEET_KEY_INSTALLED`,
].join("\n");

/** Undo for a key that was installed but then could not log in. */
export const REMOVE_SCRIPT = [
  `[ "$(id -u)" = 0 ] || exit 41`,
  `IFS= read -r key || exit 42`,
  `f=/root/.ssh/authorized_keys`,
  `[ -f "$f" ] || exit 0`,
  `t=$(mktemp /root/.ssh/.ssh-fleet.XXXXXX) || exit 43`,
  `grep -vxF -- "$key" "$f" > "$t"; cat "$t" > "$f"; rm -f "$t"`,
  `echo SSH_FLEET_KEY_REMOVED`,
].join("\n");

export const VERIFY_TOKEN = "SSH_FLEET_KEY_LOGIN_OK";

export type SetupErrorCode =
  | "askpass_unsupported"
  | "tool_missing"
  | "unreachable"
  | "timeout"
  | "wrong_password"
  | "password_disabled"
  | "host_key_mismatch"
  | "scan_failed"
  | "scan_expired"
  | "fingerprint_mismatch"
  | "not_root"
  | "install_failed"
  | "key_login_failed"
  | "keygen_failed"
  | "invalid_password";

export class SetupError extends Error {
  readonly code: SetupErrorCode;
  constructor(code: SetupErrorCode, message: string) {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

export const PROCESS_BUDGET_MS = 30_000;
const OUTPUT_CAP = 16 * 1024;

/** Replace every occurrence of the secret. Applied to anything that might be shown or logged. */
export function redact(text: string, secret: string | null): string {
  if (secret === null || secret === "") return text;
  return text.split(secret).join("[redacted]");
}

export function assertPasswordShape(password: string): void {
  if (password.length === 0 || password.length > 1024 || /[\0\r\n]/.test(password)) {
    throw new SetupError("invalid_password", "invalid_password");
  }
}

export function findTool(name: string, pathEnv = process.env.PATH ?? ""): string | null {
  for (const dir of pathEnv.split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export type RunResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; failed: boolean };

/** Spawn without a shell, feed `input` on stdin, cap output, kill the group on timeout. */
export function runProcess(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    } catch {
      resolve({ exitCode: null, stdout: "", stderr: "", timedOut: false, failed: true });
      return;
    }
    const kill = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs ?? PROCESS_BUDGET_MS);
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += chunk.toString("utf8").slice(0, OUTPUT_CAP - stdout.length);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += chunk.toString("utf8").slice(0, OUTPUT_CAP - stderr.length);
    });
    child.stdin?.on("error", () => undefined);
    child.on("error", () => finish({ exitCode: null, stdout, stderr, timedOut, failed: true }));
    child.on("close", (code) => finish({ exitCode: code, stdout, stderr, timedOut, failed: false }));
    child.stdin?.end(options.input ?? "");
  });
}

/** OpenSSH learned SSH_ASKPASS_REQUIRE in 8.4; older ssh would fall back to a terminal. */
export async function assertAskpassSupport(sshPath: string): Promise<void> {
  const result = await runProcess(sshPath, ["-V"], { timeoutMs: 5000 });
  const match = /OpenSSH_(\d+)\.(\d+)/.exec(`${result.stderr}\n${result.stdout}`);
  if (match === null) throw new SetupError("askpass_unsupported", "askpass_unsupported");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 8 || (major === 8 && minor < 4)) throw new SetupError("askpass_unsupported", "askpass_unsupported");
}

export type HostKey = { type: string; base64: string; fingerprint: string };

const KEY_PREFERENCE = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa"];

export function fingerprintOf(base64: string): string {
  const digest = createHash("sha256").update(Buffer.from(base64, "base64")).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

/** The type named inside the key blob must match the advertised type. */
function blobType(base64: string): string | null {
  const blob = Buffer.from(base64, "base64");
  if (blob.length < 4) return null;
  const length = blob.readUInt32BE(0);
  if (length <= 0 || length > 64 || blob.length < 4 + length) return null;
  return blob.subarray(4, 4 + length).toString("ascii");
}

export function parseKeyscan(output: string): HostKey | null {
  const keys: HostKey[] = [];
  for (const line of output.split("\n")) {
    const text = line.trim();
    if (text === "" || text.startsWith("#")) continue;
    const parts = text.split(/\s+/);
    const type = parts[1];
    const base64 = parts[2];
    if (type === undefined || base64 === undefined) continue;
    if (!KEY_PREFERENCE.includes(type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) continue;
    if (blobType(base64) !== type) continue;
    keys.push({ type, base64, fingerprint: fingerprintOf(base64) });
  }
  keys.sort((a, b) => KEY_PREFERENCE.indexOf(a.type) - KEY_PREFERENCE.indexOf(b.type));
  return keys[0] ?? null;
}

export async function scanHostKey(input: { keyscanPath: string; address: string; port: number }): Promise<HostKey> {
  const result = await runProcess(
    input.keyscanPath,
    ["-T", "10", "-p", String(input.port), "-t", "ed25519,ecdsa,rsa", input.address],
    { timeoutMs: 20_000 },
  );
  if (result.timedOut) throw new SetupError("timeout", "timeout");
  const key = parseKeyscan(result.stdout);
  if (key === null) throw new SetupError("unreachable", "unreachable");
  return key;
}

/** The name ssh looks up in known_hosts for this target: the alias, or the address with a non-default port. */
export function knownHostsName(address: string, port: number, hostKeyAlias: string | null): string {
  if (hostKeyAlias !== null) return hostKeyAlias;
  return port === 22 ? address : `[${address}]:${port}`;
}

export function knownHostsLine(name: string, key: Pick<HostKey, "type" | "base64">): string {
  return `${name} ${key.type} ${key.base64}`;
}

function nameMatches(field: string, name: string): boolean {
  if (field.startsWith("|1|")) {
    const [, , salt, hash] = field.split("|");
    if (salt === undefined || hash === undefined) return false;
    const digest = createHmac("sha1", Buffer.from(salt, "base64")).update(name).digest("base64");
    return digest === hash;
  }
  return field.split(",").some((pattern) => pattern.toLowerCase() === name.toLowerCase());
}

/** Whether known_hosts already holds this key for `name`, a different key of the same type, or nothing. */
export function knownHostStatus(path: string, name: string, key: Pick<HostKey, "type" | "base64">): "same" | "different" | "new" {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return "new";
  }
  let different = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("@")) continue;
    const [field, type, base64] = line.split(/\s+/);
    if (field === undefined || type === undefined || base64 === undefined) continue;
    if (!nameMatches(field, name)) continue;
    if (type === key.type && base64 === key.base64) return "same";
    if (type === key.type) different = true;
  }
  return different ? "different" : "new";
}

/** Add the confirmed key to the shared known_hosts unless the same line is there already. */
export function rememberHostKey(path: string, line: string): boolean {
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "";
  }
  if (current.split("\n").some((existing) => existing.trim() === line)) return false;
  const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
  appendFileSync(path, `${prefix}${line}\n`, { mode: 0o600 });
  return true;
}

export type Target = { address: string; port: number; hostKeyAlias: string | null };

function commonOptions(target: Target, knownHosts: string): string[] {
  const args = [
    "-F", "/dev/null",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHosts}`,
    "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "UpdateHostKeys=no",
    "-o", "ControlMaster=no",
    "-o", "ControlPath=none",
    "-o", "ForwardAgent=no",
    "-o", "ClearAllForwardings=yes",
  ];
  if (target.hostKeyAlias !== null) args.push("-o", `HostKeyAlias=${target.hostKeyAlias}`);
  return args;
}

export function passwordSessionArgs(target: Target, knownHosts: string, remote: string): string[] {
  return [
    ...commonOptions(target, knownHosts),
    "-o", "BatchMode=no",
    "-o", "PubkeyAuthentication=no",
    "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none",
    "-o", "PreferredAuthentications=keyboard-interactive,password",
    "-o", "KbdInteractiveAuthentication=yes",
    "-o", "PasswordAuthentication=yes",
    "-o", "NumberOfPasswordPrompts=1",
    "-T", "-p", String(target.port), "-l", "root", "--", target.address, remote,
  ];
}

export function keySessionArgs(target: Target, knownHosts: string, keyPath: string): string[] {
  return [
    ...commonOptions(target, knownHosts),
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none",
    "-o", `IdentityFile=${keyPath}`,
    "-o", "PubkeyAuthentication=yes",
    "-o", "PreferredAuthentications=publickey",
    "-o", "PasswordAuthentication=no",
    "-T", "-p", String(target.port), "-l", "root", "--", target.address, `echo ${VERIFY_TOKEN}`,
  ];
}

/** Map a failed password session to one clear reason. `stderr` must already be redacted. */
export function classifyPasswordFailure(result: RunResult): SetupErrorCode {
  if (result.timedOut) return "timeout";
  const text = result.stderr;
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key for .* has changed/i.test(text)) {
    return "host_key_mismatch";
  }
  if (text.includes("SSH_FLEET_NOT_ROOT") || result.exitCode === 41) return "not_root";
  const denied = /Permission denied \(([^)]*)\)/.exec(text);
  if (denied !== null) {
    const methods = (denied[1] ?? "").split(",").map((method) => method.trim());
    return methods.includes("password") || methods.includes("keyboard-interactive") ? "wrong_password" : "password_disabled";
  }
  if (/Permission denied/i.test(text)) return "wrong_password";
  if (/Could not resolve|Connection refused|timed out|No route to host|Network is unreachable|Connection closed|Connection reset|kex_exchange_identification/i.test(text)) {
    return "unreachable";
  }
  if (result.exitCode !== 255 && result.exitCode !== null) return "install_failed";
  return "unreachable";
}

/** A free `~/.ssh/ssh-fleet-<slug>` path; never an existing file. */
export function freeKeyPath(sshDir: string, serverName: string): string {
  const slug = groupIdFromLabel(serverName, new Set()).slice(0, 40) || "server";
  for (let index = 1; index < 100; index += 1) {
    const base = join(sshDir, index === 1 ? `ssh-fleet-${slug}` : `ssh-fleet-${slug}-${index}`);
    if (!exists(base) && !exists(`${base}.pub`)) return base;
  }
  throw new SetupError("keygen_failed", "keygen_failed");
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function ensureSshDir(sshDir: string): void {
  if (!existsSync(sshDir)) mkdirSync(sshDir, { recursive: true, mode: 0o700 });
}

/** Generate an unencrypted ed25519 pair. Reads back only the public half. */
export async function generateKey(keygenPath: string, path: string, comment: string): Promise<string> {
  if (exists(path) || exists(`${path}.pub`)) throw new SetupError("keygen_failed", "keygen_failed");
  const result = await runProcess(keygenPath, ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", path], { timeoutMs: 15_000 });
  if (result.exitCode !== 0 || !exists(path) || !exists(`${path}.pub`)) {
    removeKeyPair(path);
    throw new SetupError("keygen_failed", "keygen_failed");
  }
  chmodSync(path, 0o600);
  const publicKey = readFileSync(`${path}.pub`, "utf8").trim();
  if (!publicKey.startsWith("ssh-ed25519 ") || /[\r\n]/.test(publicKey)) {
    removeKeyPair(path);
    throw new SetupError("keygen_failed", "keygen_failed");
  }
  return publicKey;
}

export function removeKeyPair(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}.pub`, { force: true });
}

/** A private temp dir with the askpass helper and the confirmed known_hosts line. */
export function makeSessionDir(knownHostsLineText: string): { dir: string; askpass: string; knownHosts: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ssh-fleet-setup-"));
  chmodSync(dir, 0o700);
  const askpass = join(dir, "askpass.sh");
  writeFileSync(askpass, ASKPASS_SCRIPT, { mode: 0o700 });
  const knownHosts = join(dir, "known_hosts");
  writeFileSync(knownHosts, `${knownHostsLineText}\n`, { mode: 0o600 });
  return { dir, askpass, knownHosts, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Child environment for the password session: the parent's, minus agent hooks, plus the askpass trio. */
export function passwordEnv(askpass: string, password: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SSH_AUTH_SOCK;
  delete env[SECRET_ENV];
  env.SSH_ASKPASS = askpass;
  env.SSH_ASKPASS_REQUIRE = "force";
  env[SECRET_ENV] = password;
  return env;
}

function keyEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SSH_AUTH_SOCK;
  delete env.SSH_ASKPASS;
  delete env.SSH_ASKPASS_REQUIRE;
  delete env[SECRET_ENV];
  return env;
}

export async function runPasswordSession(input: {
  sshPath: string;
  target: Target;
  knownHosts: string;
  askpass: string;
  password: string;
  remote: string;
  stdin: string;
}): Promise<RunResult> {
  const result = await runProcess(input.sshPath, passwordSessionArgs(input.target, input.knownHosts, input.remote), {
    env: passwordEnv(input.askpass, input.password),
    input: input.stdin,
  });
  return {
    ...result,
    stdout: redact(result.stdout, input.password),
    stderr: redact(result.stderr, input.password),
  };
}

export async function verifyKeyLogin(input: { sshPath: string; target: Target; knownHosts: string; keyPath: string }): Promise<boolean> {
  const result = await runProcess(input.sshPath, keySessionArgs(input.target, input.knownHosts, input.keyPath), {
    env: keyEnv(),
  });
  return result.exitCode === 0 && result.stdout.includes(VERIFY_TOKEN);
}

export type SshConfigEntry = { alias: string; host: string; port: number; keyPath: string };

/** Host aliases already present in an ssh config text. */
export function configAliases(text: string): Set<string> {
  const aliases = new Set<string>();
  for (const line of text.split("\n")) {
    const match = /^\s*Host\s+(.+)$/i.exec(line.replace(/#.*$/, ""));
    if (match === null) continue;
    for (const token of (match[1] ?? "").trim().split(/\s+/)) aliases.add(token.toLowerCase());
  }
  return aliases;
}

/** Append a Host block for the new key; picks a free alias. Returns the alias used. */
export function appendSshConfig(configPath: string, serverName: string, entry: Omit<SshConfigEntry, "alias">): string {
  let current = "";
  try {
    current = readFileSync(configPath, "utf8");
  } catch {
    current = "";
  }
  const alias = groupIdFromLabel(serverName, configAliases(current));
  const block = [
    `Host ${alias}`,
    `  HostName ${entry.host}`,
    ...(entry.port === 22 ? [] : [`  Port ${entry.port}`]),
    `  User root`,
    `  IdentityFile ${entry.keyPath}`,
    `  IdentitiesOnly yes`,
  ].join("\n");
  const prefix = current === "" ? "" : current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(configPath, `${prefix}${block}\n`, { mode: 0o600 });
  return alias;
}
