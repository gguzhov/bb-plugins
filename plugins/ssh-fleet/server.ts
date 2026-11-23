import { accessSync, constants, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
  cliCommand,
  defineCli,
  defineRpcContract,
  experimental_PluginRpcRefusal,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { assertPort, InputError, normalizeHost } from "./lib/hosts.ts";
import { assertIdentityPath } from "./lib/identity.ts";
import { candidatesFromConfig, defaultHome } from "./lib/import.ts";
import { createCoordinator, type ProbeServer } from "./lib/coordinator.ts";
import {
  MIGRATIONS,
  createStore,
  DuplicateServerError,
  forgetRewrittenMigrations,
  GroupError,
  type FleetStore,
  type GroupWithCount,
  type ServerRow,
} from "./lib/store.ts";
import { knownHostsPath, resolveProbeTarget } from "./lib/ssh-probe.ts";
import { AGENT_PROMPT } from "./lib/agent-prompt.ts";
import {
  INSTALL_SCRIPT,
  REMOVE_SCRIPT,
  SetupError,
  appendSshConfig,
  assertAskpassSupport,
  assertPasswordShape,
  ensureSshDir,
  findTool,
  freeKeyPath,
  generateKey,
  knownHostStatus,
  knownHostsLine,
  knownHostsName,
  makeSessionDir,
  redact,
  rememberHostKey,
  removeKeyPair,
  runPasswordSession,
  scanHostKey,
  verifyKeyLogin,
  classifyPasswordFailure,
  type HostKey,
  type SetupErrorCode,
} from "./lib/password-setup.ts";

import { assertIconImage, assertIconName } from "./lib/icon.ts";
import { FLEET_CHANNEL } from "./lib/channel.ts";
import {
  DEFAULT_GROUP,
  GROUP_LABEL_MAX,
  cleanGroupLabel,
  findGroup,
  groupHint,
  groupIdFromLabel,
  isGroupId,
  type ServerGroup,
} from "./lib/groups.ts";

const DESCRIPTION_MAX = 500;
const HOSTING_MAX = 80;
const COST_MAX = 1_000_000_000;

const serverSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  user: z.literal("root"),
  identityPath: z.string(),
  status: z.enum(["unchecked", "up", "down"]),
  checkedAt: z.number().int().nullable(),
  metricsAt: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorText: z.string().nullable(),
  uptimeSeconds: z.number().int().nullable(),
  load1: z.number().nullable(),
  load5: z.number().nullable(),
  load15: z.number().nullable(),
  cpuPercent: z.number().nullable(),
  memTotalBytes: z.number().int().nullable(),
  memAvailableBytes: z.number().int().nullable(),
  diskTotalBytes: z.number().int().nullable(),
  diskUsedBytes: z.number().int().nullable(),
  cpuCount: z.number().int().nullable(),
  swapTotalBytes: z.number().int().nullable(),
  swapFreeBytes: z.number().int().nullable(),
  procsRunning: z.number().int().nullable(),
  procsTotal: z.number().int().nullable(),
  netRxBps: z.number().int().nullable(),
  netTxBps: z.number().int().nullable(),
  iconName: z.string(),
  iconImage: z.string().nullable(),
  description: z.string(),
  hosting: z.string(),
  monthlyCostRub: z.number().int().nullable(),
  group: z.string(),
});

const groupSchema = z.object({
  id: z.string(),
  label: z.string(),
  position: z.number().int(),
  count: z.number().int(),
});

const candidateSchema = z.object({
  alias: z.string(),
  host: z.string(),
  port: z.number().int(),
  configUser: z.string(),
  identityPath: z.string(),
  already: z.boolean(),
  error: z.string().nullable(),
  notice: z.string(),
});

const draftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  identityPath: z.string().min(1).max(4096),
  iconName: z.string().min(1).max(32),
  iconImage: z.string().max(140_000).nullable(),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  hosting: z.string().max(HOSTING_MAX).optional(),
  monthlyCostRub: z.number().int().min(0).nullable().optional(),
  group: z.string().min(1).max(64).optional(),
}).strict();

/**
 * The "root password, once" form. `password` is used for one ssh session and
 * dropped; it is never stored or returned. `scanId` + `fingerprint` prove the
 * user confirmed the host key shown by `hostKeyScan`.
 */
const passwordDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535),
    iconName: z.string().min(1).max(32),
    iconImage: z.string().max(140_000).nullable(),
    description: z.string().max(DESCRIPTION_MAX).optional(),
    hosting: z.string().max(HOSTING_MAX).optional(),
    monthlyCostRub: z.number().int().min(0).nullable().optional(),
    group: z.string().min(1).max(64).optional(),
    scanId: z.string().min(1).max(64),
    fingerprint: z.string().min(1).max(128),
    password: z.string().max(1024),
    addSshConfig: z.boolean(),
  })
  .strict();

export const rpcContract = defineRpcContract({
  list: {
    input: z.null(),
    output: z.object({
      servers: z.array(serverSchema),
      groups: z.array(groupSchema),
      passInProgress: z.boolean(),
    }),
  },
  groupCreate: {
    input: z.object({ label: z.string().max(200) }).strict(),
    output: z.object({ group: groupSchema }),
  },
  groupUpdate: {
    input: z
      .object({
        id: z.string().max(64),
        label: z.string().max(200).optional(),
        position: z.number().int().min(0).max(10_000).optional(),
      })
      .strict(),
    output: z.object({ group: groupSchema }),
  },
  groupRemove: {
    input: z.object({ id: z.string().max(64) }).strict(),
    output: z.object({ removed: z.literal(true), moved: z.number().int(), movedTo: z.string() }),
  },
  get: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ server: serverSchema.nullable() }),
  },
  badge: {
    input: z.null(),
    output: z.object({ count: z.number().int() }),
  },
  create: {
    input: draftSchema,
    output: z.object({ server: serverSchema }),
  },
  update: {
    input: draftSchema.extend({ id: z.string() }).strict(),
    output: z.object({ server: serverSchema }),
  },
  remove: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
  importPreview: {
    input: z.null(),
    output: z.object({ candidates: z.array(candidateSchema) }),
  },
  importCommit: {
    input: z.object({ aliases: z.array(z.string()).max(200) }).strict(),
    output: z.object({ added: z.number().int() }),
  },
  hostKeyScan: {
    input: z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535) }).strict(),
    output: z.object({
      scanId: z.string(),
      keyType: z.string(),
      fingerprint: z.string(),
      known: z.enum(["same", "new"]),
    }),
  },
  createWithPassword: {
    input: passwordDraftSchema,
    output: z.object({ server: serverSchema, keyPath: z.string(), sshConfigAlias: z.string().nullable() }),
  },
  agentPrompt: {
    input: z.null(),
    output: z.object({ text: z.string() }),
  },
  checkAll: {
    input: z.null(),
    output: z.object({ started: z.literal(true) }),
  },
  checkOne: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ server: serverSchema }),
  },
});

export type FleetDeps = {
  findSsh?: () => string | null;
  readConfig?: () => string;
  runSshG?: (alias: string) => Promise<string>;
  home?: () => string;
  now?: () => number;
  probe?: ProbeServer;
  /** Locates ssh, ssh-keyscan and ssh-keygen for the password setup. */
  findTool?: (name: string) => string | null;
  knownHostsPath?: () => string;
  resolve?: (hostname: string) => Promise<string[]>;
};

const SCAN_TTL_MS = 10 * 60_000;

type ScanRecord = {
  host: string;
  port: number;
  address: string;
  hostKeyAlias: string | null;
  key: HostKey;
  expiresAt: number;
};

const SETUP_MESSAGES: Record<SetupErrorCode, string> = {
  askpass_unsupported:
    "ssh на этой машине не умеет брать пароль через SSH_ASKPASS (нужен OpenSSH 8.4 или новее). Пароль не отправлен. Обновите OpenSSH или добавьте сервер по ключу.",
  tool_missing: "На этой машине нет ssh, ssh-keyscan или ssh-keygen. Установите OpenSSH.",
  unreachable: "Сервер недоступен: нет ответа по SSH на этом адресе и порту.",
  timeout: "Сервер не ответил вовремя. Проверьте адрес, порт и сеть.",
  wrong_password:
    "Пароль не подошёл. Или сервер не пускает root по паролю (PermitRootLogin prohibit-password).",
  password_disabled: "Сервер не принимает вход по паролю, только по ключу. Добавьте сервер по ключу.",
  host_key_mismatch:
    "Ключ хоста не совпал с подтверждённым или с тем, что эта машина уже знает. Ничего не отправлено. Проверьте сервер.",
  scan_failed: "Не удалось получить ключ хоста.",
  scan_expired: "Подтверждение ключа хоста устарело или относится к другому адресу. Получите отпечаток заново.",
  fingerprint_mismatch: "Отпечаток не совпадает с ключом, который показал сервер. Пароль не отправлен.",
  not_root: "Вход выполнен не от root. Нужен пароль именно root.",
  install_failed: "Не удалось записать ключ в /root/.ssh/authorized_keys на сервере.",
  key_login_failed:
    "Ключ записан, но вход по нему не прошёл (проверьте PubkeyAuthentication и AuthorizedKeysFile в sshd). Ключ с сервера убран.",
  keygen_failed: "Не удалось создать ключ в ~/.ssh.",
  invalid_password: "Введите пароль: одна строка, до 1024 символов.",
};

function setupMessage(error: SetupError): string {
  return SETUP_MESSAGES[error.code];
}

export function findSsh(pathEnv = process.env.PATH ?? ""): string | null {
  for (const dir of pathEnv.split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, "ssh");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function publicServer(row: ServerRow) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    user: "root" as const,
    identityPath: row.identityPath,
    status: row.status,
    checkedAt: row.checkedAt,
    metricsAt: row.metricsAt,
    errorCode: row.errorCode,
    errorText: row.errorText,
    uptimeSeconds: row.uptimeSeconds,
    load1: row.load1,
    load5: row.load5,
    load15: row.load15,
    cpuPercent: row.cpuPercent,
    memTotalBytes: row.memTotalBytes,
    memAvailableBytes: row.memAvailableBytes,
    diskTotalBytes: row.diskTotalBytes,
    diskUsedBytes: row.diskUsedBytes,
    cpuCount: row.cpuCount,
    swapTotalBytes: row.swapTotalBytes,
    swapFreeBytes: row.swapFreeBytes,
    procsRunning: row.procsRunning,
    procsTotal: row.procsTotal,
    netRxBps: row.netRxBps,
    netTxBps: row.netTxBps,
    iconName: row.iconName,
    iconImage: row.iconImage,
    description: row.description,
    hosting: row.hosting,
    monthlyCostRub: row.monthlyCostRub,
    group: row.group,
  };
}

function refusal(code: "conflict" | "not_found" | "invalid", message: string): never {
  throw new experimental_PluginRpcRefusal({ code, message });
}

function draftOf(input: z.infer<typeof draftSchema>, store: FleetStore) {
  const host = normalizeHost(input.host);
  return {
    name: input.name.trim(),
    host: host.host,
    port: assertPort(input.port),
    identityPath: assertIdentityPath(input.identityPath),
    iconName: assertIconName(input.iconName),
    iconImage: assertIconImage(input.iconImage),
    description: input.description === undefined ? undefined : assertDescription(input.description),
    hosting: input.hosting === undefined ? undefined : assertHosting(input.hosting),
    monthlyCostRub: input.monthlyCostRub,
    group: input.group === undefined ? undefined : assertGroup(store, input.group),
  };
}

/** Resolves an existing group by id or label; anything else fails with the list of groups. */
function assertGroup(store: FleetStore, value: string): string {
  const groups = store.listGroups();
  const found = findGroup(groups, value);
  if (found === null) {
    throw new InputError(`Неизвестная группа «${value.trim().slice(0, 64)}». Есть: ${groupHint(groups)}.`);
  }
  return found.id;
}

function assertGroupLabel(value: string): string {
  const label = cleanGroupLabel(value);
  if (label === null) throw new InputError(`Название группы от 1 до ${GROUP_LABEL_MAX} символов, без управляющих символов.`);
  return label;
}

function createGroup(store: FleetStore, labelInput: string, idInput?: string): ServerGroup {
  const label = assertGroupLabel(labelInput);
  const taken = new Set(store.listGroups().map((group) => group.id));
  let id: string;
  if (idInput === undefined) id = groupIdFromLabel(label, taken);
  else {
    id = idInput.trim().toLowerCase();
    if (!isGroupId(id)) throw new InputError("id группы: латиница, цифры и дефис, до 32 символов, с буквы или цифры.");
  }
  return store.addGroup(id, label);
}

function groupWithCount(store: FleetStore, id: string): GroupWithCount {
  const found = store.listGroups().find((group) => group.id === id);
  if (found === undefined) throw new GroupError("not_found", `Группы «${id}» нет.`);
  return found;
}

function assertDescription(value: string): string {
  const text = value.trim();
  if (text.length > DESCRIPTION_MAX) throw new InputError(`Описание длиннее ${DESCRIPTION_MAX} символов.`);
  return text;
}

function assertHosting(value: string): string {
  const text = value.trim();
  if (text.length > HOSTING_MAX) throw new InputError(`Хостинг длиннее ${HOSTING_MAX} символов.`);
  return text;
}

function cliFailure(error: unknown): never {
  if (error instanceof PluginCliError) throw error;
  if (error instanceof GroupError) throw new PluginCliError(error.message, { code: error.code });
  if (error instanceof DuplicateServerError) throw new PluginCliError(error.message, { code: "conflict" });
  if (error instanceof InputError) throw new PluginCliError(error.message, { code: "invalid" });
  throw error;
}

export function createPlugin(deps: FleetDeps = {}) {
  const locateSsh = deps.findSsh ?? findSsh;
  const readConfig = deps.readConfig ?? (() => readFileSync(`${homedir()}/.ssh/config`, "utf8"));
  const home = deps.home ?? defaultHome;
  const now = deps.now ?? Date.now;

  return async function plugin(bb: BbPluginApi) {
    const db = bb.storage.database();
    forgetRewrittenMigrations(db);
    bb.storage.migrate(db, MIGRATIONS);
    const store = createStore(db);
    const sshPath = locateSsh();
    const publish = (payload: { id: string } | { kind: "inventory" } | { kind: "pass-complete" }) => {
      bb.realtime.publish(FLEET_CHANNEL, payload);
    };
    const coordinator = createCoordinator({
      store,
      publish,
      log: bb.log,
      now,
      signal: new AbortController().signal,
      sshPath: sshPath ?? "ssh",
      knownHostsPath: knownHostsPath(),
      probe: deps.probe,
    });
    const dispose = new AbortController();
    dispose.signal.addEventListener("abort", () => coordinator.killAll());

    if (sshPath === null) {
      bb.status.needsConfiguration("Установите ssh и перезагрузите плагин.");
    } else {
      bb.background.schedule("probe", "0 * * * *", async () => {
        const pass = coordinator.runPass("all");
        if (pass.conflict) {
          bb.log.warn("hourly pass skipped; another pass is running");
          return;
        }
        await pass.done;
      });
      bb.background.service("reconcile", {
        async start(signal) {
          const pass = coordinator.runPass("stale");
          if (!pass.conflict) await pass.done;
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      });
    }

    async function preview() {
      let text = "";
      try {
        text = readConfig();
      } catch {
        return [];
      }
      const ssh = sshPath;
      return candidatesFromConfig({
        configText: text,
        home: home(),
        taken: (host, port) => store.findByHostPort(host, port) !== null,
        resolveG: (alias) => {
          if (deps.runSshG !== undefined) return deps.runSshG(alias);
          if (ssh === null) return Promise.reject(new InputError("На этой машине нет ssh."));
          return new Promise<string>((resolve, reject) => {
            execFile(ssh, ["-G", alias], { timeout: 5000 }, (error, stdout) => {
              if (error !== null) reject(error);
              else resolve(stdout);
            });
          });
        },
      });
    }

    function requireSsh(): void {
      if (sshPath === null) refusal("invalid", "На этой машине нет ssh.");
    }

    const toolPath = deps.findTool ?? ((name: string) => findTool(name));
    const hostsFile = deps.knownHostsPath ?? knownHostsPath;
    const scans = new Map<string, ScanRecord>();

    function tool(name: string): string {
      const found = toolPath(name);
      if (found === null) throw new SetupError("tool_missing", "tool_missing");
      return found;
    }

    /** Resolve and refuse the same targets as the probe; returns where ssh will connect. */
    async function target(hostInput: string, portInput: number) {
      const host = normalizeHost(hostInput);
      const port = assertPort(portInput);
      const resolved = await resolveProbeTarget(host.host, host.kind, deps.resolve);
      if (!resolved.ok) {
        throw resolved.code === "dns"
          ? new InputError("Имя сервера не резолвится.")
          : new InputError("Этот адрес проверять нельзя.");
      }
      return { host: host.host, port, address: resolved.address, hostKeyAlias: resolved.hostKeyAlias };
    }

    /** Step one: fetch the host key, nothing is sent. The record lives ten minutes. */
    async function scan(hostInput: string, portInput: number) {
      const where = await target(hostInput, portInput);
      const key = await scanHostKey({ keyscanPath: tool("ssh-keyscan"), address: where.address, port: where.port });
      const name = knownHostsName(where.address, where.port, where.hostKeyAlias);
      const known = knownHostStatus(hostsFile(), name, key);
      if (known === "different") throw new SetupError("host_key_mismatch", "host_key_mismatch");
      for (const [id, record] of scans) if (record.expiresAt < now()) scans.delete(id);
      const scanId = randomBytes(16).toString("hex");
      scans.set(scanId, { ...where, key, expiresAt: now() + SCAN_TTL_MS });
      return { scanId, keyType: key.type, fingerprint: key.fingerprint, known };
    }

    type PasswordSetupInput = {
      name: string;
      host: string;
      port: number;
      iconName?: string;
      iconImage?: string | null;
      description?: string;
      hosting?: string;
      monthlyCostRub?: number | null;
      group?: string;
      scanId: string;
      fingerprint: string;
      addSshConfig: boolean;
    };

    /**
     * Step two: create a dedicated key, install it with the password once,
     * check key login, then store only the key path. Any failure removes the
     * new key files and leaves no server row.
     */
    async function setupWithPassword(input: PasswordSetupInput, password: string) {
      assertPasswordShape(password);
      const name = input.name.trim();
      if (name === "" || name.length > 80) throw new InputError("Имя от 1 до 80 символов.");
      const where = await target(input.host, input.port);
      const extras = {
        iconName: assertIconName(input.iconName ?? "Server"),
        iconImage: assertIconImage(input.iconImage ?? null),
        description: assertDescription(input.description ?? ""),
        hosting: assertHosting(input.hosting ?? ""),
        monthlyCostRub: input.monthlyCostRub ?? null,
        group: input.group === undefined ? undefined : assertGroup(store, input.group),
      };
      if (store.findByHostPort(where.host, where.port) !== null) throw new DuplicateServerError();
      const record = scans.get(input.scanId);
      if (
        record === undefined ||
        record.expiresAt < now() ||
        record.host !== where.host ||
        record.port !== where.port ||
        record.address !== where.address
      ) {
        throw new SetupError("scan_expired", "scan_expired");
      }
      if (record.key.fingerprint !== input.fingerprint.trim()) throw new SetupError("fingerprint_mismatch", "fingerprint_mismatch");
      const ssh = tool("ssh");
      const keygen = tool("ssh-keygen");
      await assertAskpassSupport(ssh);

      const sshDir = join(home(), ".ssh");
      ensureSshDir(sshDir);
      const keyPath = freeKeyPath(sshDir, name);
      const hostLine = knownHostsLine(knownHostsName(where.address, where.port, where.hostKeyAlias), record.key);
      const session = makeSessionDir(hostLine);
      const remoteTarget = { address: where.address, port: where.port, hostKeyAlias: where.hostKeyAlias };
      let server: ServerRow;
      try {
        const publicKey = await generateKey(keygen, keyPath, `ssh-fleet ${groupIdFromLabel(name, new Set())}`);
        const installed = await runPasswordSession({
          sshPath: ssh,
          target: remoteTarget,
          knownHosts: session.knownHosts,
          askpass: session.askpass,
          password,
          remote: INSTALL_SCRIPT,
          stdin: `${publicKey}\n`,
        });
        const added = installed.stdout.includes("SSH_FLEET_KEY_INSTALLED");
        if (installed.exitCode !== 0 || !(added || installed.stdout.includes("SSH_FLEET_KEY_PRESENT"))) {
          const code = installed.exitCode === 0 ? "install_failed" : classifyPasswordFailure(installed);
          bb.log.info(`password setup failed: ${code}`);
          throw new SetupError(code, code);
        }
        const works = await verifyKeyLogin({ sshPath: ssh, target: remoteTarget, knownHosts: session.knownHosts, keyPath });
        if (!works) {
          if (added) {
            await runPasswordSession({
              sshPath: ssh,
              target: remoteTarget,
              knownHosts: session.knownHosts,
              askpass: session.askpass,
              password,
              remote: REMOVE_SCRIPT,
              stdin: `${publicKey}\n`,
            });
          }
          bb.log.info("password setup failed: key_login_failed");
          throw new SetupError("key_login_failed", "key_login_failed");
        }
        rememberHostKey(hostsFile(), hostLine);
        server = store.insert({
          id: randomUUID(),
          name,
          host: where.host,
          port: where.port,
          identityPath: assertIdentityPath(keyPath),
          ...extras,
          now: now(),
        });
      } catch (error) {
        removeKeyPair(keyPath);
        throw error;
      } finally {
        session.dispose();
      }
      scans.delete(input.scanId);
      bb.log.info("password setup: key installed and verified");
      let sshConfigAlias: string | null = null;
      if (input.addSshConfig) {
        try {
          sshConfigAlias = appendSshConfig(join(sshDir, "config"), name, { host: where.host, port: where.port, keyPath });
        } catch {
          bb.log.warn("password setup: could not append to ssh config");
        }
      }
      publish({ kind: "inventory" });
      if (sshPath !== null) await coordinator.runPass({ id: server.id }).done;
      const fresh = store.get(server.id) ?? server;
      return { server: publicServer(fresh), keyPath, sshConfigAlias };
    }

    /** Turn any failure of the password flow into a refusal whose text cannot carry the password. */
    function passwordRefusal(error: unknown, password: string): Error {
      if (error instanceof SetupError) {
        return new experimental_PluginRpcRefusal({ code: "invalid", message: setupMessage(error) });
      }
      const refused = asRefusal(error);
      if (refused instanceof experimental_PluginRpcRefusal) {
        return new experimental_PluginRpcRefusal({ code: refused.code, message: redact(refused.message, password) });
      }
      return new Error("Не удалось добавить сервер.");
    }

    bb.rpc.register(rpcContract, {
      list: async () => ({
        servers: store.list().map(publicServer),
        groups: store.listGroups(),
        passInProgress: coordinator.passRunning,
      }),
      groupCreate: async ({ label }) => {
        try {
          const group = createGroup(store, label);
          publish({ kind: "inventory" });
          return { group: groupWithCount(store, group.id) };
        } catch (error) {
          throw asRefusal(error);
        }
      },
      groupUpdate: async ({ id, label, position }) => {
        try {
          store.updateGroup(id, {
            label: label === undefined ? undefined : assertGroupLabel(label),
            position,
          });
          publish({ kind: "inventory" });
          return { group: groupWithCount(store, id) };
        } catch (error) {
          throw asRefusal(error);
        }
      },
      groupRemove: async ({ id }) => {
        try {
          const moved = store.removeGroup(id, now());
          publish({ kind: "inventory" });
          return { removed: true as const, moved, movedTo: DEFAULT_GROUP };
        } catch (error) {
          throw asRefusal(error);
        }
      },
      get: async ({ id }) => ({ server: optionalServer(store.get(id)) }),
      badge: async () => ({ count: store.countDown() }),
      create: async (input) => {
        try {
          const draft = draftOf(input, store);
          const server = store.insert({ id: randomUUID(), ...draft, now: now() });
          publish({ kind: "inventory" });
          return { server: publicServer(server) };
        } catch (error) {
          throw asRefusal(error);
        }
      },
      update: async (input) => {
        try {
          const current = store.get(input.id);
          if (current === null) refusal("not_found", "Сервер не найден.");
          const draft = draftOf(input, store);
          const server = store.update(input.id, { ...draft, now: now() });
          if (server === null) refusal("not_found", "Сервер не найден.");
          if (store.credentialsChanged(current, server)) coordinator.cancel(input.id);
          publish({ kind: "inventory" });
          return { server: publicServer(server) };
        } catch (error) {
          throw asRefusal(error);
        }
      },
      remove: async ({ id }) => {
        coordinator.cancel(id);
        const removed = store.remove(id);
        if (removed) publish({ kind: "inventory" });
        return { removed };
      },
      importPreview: async () => ({ candidates: await preview() }),
      importCommit: async ({ aliases }) => {
        const wanted = new Set(aliases);
        const candidates = await preview();
        let added = 0;
        for (const candidate of candidates) {
          if (!wanted.has(candidate.alias) || candidate.already || candidate.error !== null) continue;
          try {
            store.insert({
              id: randomUUID(),
              name: candidate.alias,
              host: candidate.host,
              port: candidate.port,
              identityPath: candidate.identityPath,
              now: now(),
            });
            added += 1;
          } catch (error) {
            if (!(error instanceof DuplicateServerError)) throw asRefusal(error);
          }
        }
        if (added > 0) publish({ kind: "inventory" });
        return { added };
      },
      hostKeyScan: async ({ host, port }) => {
        try {
          return await scan(host, port);
        } catch (error) {
          throw passwordRefusal(error, "");
        }
      },
      createWithPassword: async (input) => {
        const { password, ...rest } = input;
        try {
          return await setupWithPassword(rest, password);
        } catch (error) {
          throw passwordRefusal(error, password);
        }
      },
      agentPrompt: async () => ({ text: AGENT_PROMPT }),
      checkAll: async () => {
        requireSsh();
        const pass = coordinator.runPass("all");
        if (pass.conflict) refusal("conflict", "Проверка уже идёт.");
        return { started: true as const };
      },
      checkOne: async ({ id }) => {
        requireSsh();
        if (store.get(id) === null) refusal("not_found", "Сервер не найден.");
        const pass = coordinator.runPass({ id });
        await pass.done;
        const server = store.get(id);
        if (server === null) refusal("not_found", "Сервер не найден.");
        return { server: publicServer(server) };
      },
    });

    function groupLabel(id: string): string {
      return store.getGroup(id)?.label ?? id;
    }

    function human(row: ReturnType<typeof publicServer>): string {
      const problem = row.errorText === null ? "" : `  ${row.errorText}`;
      const head = `${row.status}  ${row.name}  [${groupLabel(row.group)}]  ${row.host}:${row.port}${problem}`;
      const extra = [
        row.hosting === "" ? null : `хостинг: ${row.hosting}`,
        row.monthlyCostRub === null ? null : `${row.monthlyCostRub} ₽/мес`,
        row.description === "" ? null : (row.description.split("\n")[0] ?? ""),
      ].filter((part): part is string => part !== null && part !== "");
      return extra.length === 0 ? head : `${head}\n    ${extra.join(" · ")}`;
    }

    type AddOptions = {
      name: string;
      host: string;
      port: number;
      key?: string;
      description?: string;
      hosting?: string;
      cost?: number;
      group?: string;
      json?: boolean;
      "host-key"?: string;
      "ssh-config"?: boolean;
    };

    /** `add --password-stdin`: the first run shows the host key, the second (with --host-key) installs the key. */
    async function addWithPassword(options: AddOptions, password: string) {
      try {
        if (options.key !== undefined) {
          throw new PluginCliError("Укажите либо --key, либо --password-stdin.", { code: "invalid" });
        }
        const scanned = await scan(options.host, options.port);
        const confirmed = options["host-key"];
        if (confirmed === undefined) {
          throw new PluginCliError(
            `Ключ хоста ${scanned.keyType} ${scanned.fingerprint}. Сверьте отпечаток с сервером. Пароль не отправлен.`,
            {
              code: "confirm_host_key",
              hint: `Если отпечаток верный, повторите команду с --host-key ${scanned.fingerprint}`,
            },
          );
        }
        const result = await setupWithPassword(
          {
            name: options.name,
            host: options.host,
            port: options.port,
            description: options.description,
            hosting: options.hosting,
            monthlyCostRub: options.cost ?? null,
            group: options.group,
            scanId: scanned.scanId,
            fingerprint: confirmed,
            addSshConfig: options["ssh-config"] === true,
          },
          password,
        );
        return {
          exitCode: 0,
          stdout: options.json
            ? JSON.stringify({ ok: true, ...result })
            : `Добавлен: ${result.server.name} ${result.server.host}:${result.server.port} (id ${result.server.id}), ключ ${result.keyPath}${result.sshConfigAlias === null ? "" : `, Host ${result.sshConfigAlias} в ~/.ssh/config`}\n`,
        };
      } catch (error) {
        if (error instanceof SetupError) throw new PluginCliError(setupMessage(error), { code: error.code });
        if (error instanceof PluginCliError) throw new PluginCliError(redact(error.message, password), { code: error.code, hint: error.hint });
        if (error instanceof InputError || error instanceof GroupError || error instanceof DuplicateServerError) {
          return cliFailure(error);
        }
        throw new PluginCliError("Не удалось добавить сервер.", { code: "failed" });
      }
    }

    bb.cli.register(
      defineCli({
        name: "ssh-fleet",
        summary: "Серверы: снимок по SSH-ключу",
        description:
          "Список серверов (фильтр --group), добавление по ключу или один раз по паролю root (add --password-stdin), правка (set), группы (group list|add|set|remove), текст для агента (agent-prompt) и явная проверка. Удаление серверов только в панели. Пароль не сохраняется.",
        commands: {
          list: cliCommand({
            summary: "Показать серверы и последний снимок",
            options: {
              group: { type: "string", description: "Только одна группа: id или название (bb ssh-fleet group list)" },
              json: { type: "boolean", description: "Ответ JSON" },
            },
            async run(command) {
              try {
                const group = command.options.group === undefined ? null : assertGroup(store, command.options.group);
                const servers = store
                  .list()
                  .filter((row) => group === null || row.group === group)
                  .map(publicServer);
                return {
                  exitCode: 0,
                  stdout: command.options.json
                    ? JSON.stringify({ ok: true, servers })
                    : servers.length === 0
                      ? group === null ? "Серверов нет.\n" : `В группе «${groupLabel(group)}» серверов нет.\n`
                      : `${servers.map(human).join("\n")}\n`,
                };
              } catch (error) {
                return cliFailure(error);
              }
            },
          }),
          add: cliCommand({
            summary: "Добавить сервер",
            options: {
              name: { type: "string", required: true, description: "Имя сервера" },
              host: { type: "string", required: true, description: "Хост или IP" },
              port: { type: "integer", min: 1, max: 65535, default: 22, description: "Порт SSH" },
              key: { type: "string", description: "Абсолютный путь к приватному ключу (или --password-stdin)" },
              password: {
                type: "string",
                stdin: true,
                hidden: true,
                description: "Пароль root: только --password-stdin, один раз, не сохраняется",
              },
              "host-key": {
                type: "string",
                description: "Подтверждённый отпечаток ключа хоста SHA256:… (для --password-stdin)",
              },
              "ssh-config": { type: "boolean", description: "С --password-stdin: дописать Host в ~/.ssh/config" },
              description: { type: "string", description: "Что на сервере, комментарии" },
              hosting: { type: "string", description: "Хостер" },
              cost: { type: "integer", min: 0, max: COST_MAX, description: "Стоимость, рублей в месяц" },
              group: { type: "string", description: `Группа: id или название (по умолчанию ${DEFAULT_GROUP})` },
              json: { type: "boolean", description: "Ответ JSON" },
            },
            async run(command) {
              const password = command.options.password;
              if (password !== undefined) return addWithPassword(command.options, password);
              try {
                if (command.options.key === undefined) {
                  throw new PluginCliError("Нужен --key <путь к ключу> или --password-stdin.", { code: "invalid" });
                }
                const name = command.options.name.trim();
                if (name === "" || name.length > 80) throw new InputError("Имя от 1 до 80 символов.");
                const host = normalizeHost(command.options.host);
                const server = store.insert({
                  id: randomUUID(),
                  name,
                  host: host.host,
                  port: assertPort(command.options.port),
                  identityPath: assertIdentityPath(command.options.key),
                  description: assertDescription(command.options.description ?? ""),
                  hosting: assertHosting(command.options.hosting ?? ""),
                  monthlyCostRub: command.options.cost ?? null,
                  group: command.options.group === undefined ? undefined : assertGroup(store, command.options.group),
                  now: now(),
                });
                publish({ kind: "inventory" });
                const shown = publicServer(server);
                return {
                  exitCode: 0,
                  stdout: command.options.json
                    ? JSON.stringify({ ok: true, server: shown })
                    : `Добавлен: ${shown.name} ${shown.host}:${shown.port} (id ${shown.id})\n`,
                };
              } catch (error) {
                return cliFailure(error);
              }
            },
          }),
          set: cliCommand({
            summary: "Изменить имя, группу, описание, хостинг или стоимость сервера",
            options: {
              id: { type: "string", required: true, description: "Идентификатор сервера" },
              name: { type: "string", description: "Новое имя" },
              description: { type: "string", description: "Описание" },
              hosting: { type: "string", description: "Хостер" },
              cost: { type: "integer", min: 0, max: COST_MAX, description: "Стоимость, рублей в месяц" },
              group: { type: "string", description: "Группа: id или название" },
              json: { type: "boolean", description: "Ответ JSON" },
            },
            async run(command) {
              try {
                const current = store.get(command.options.id);
                if (current === null) {
                  throw new PluginCliError("Сервер не найден.", {
                    code: "not_found",
                    hint: "Запустите bb ssh-fleet list.",
                  });
                }
                const name = command.options.name === undefined ? current.name : command.options.name.trim();
                if (name === "" || name.length > 80) throw new InputError("Имя от 1 до 80 символов.");
                const server = store.update(current.id, {
                  name,
                  host: current.host,
                  port: current.port,
                  identityPath: current.identityPath,
                  iconName: current.iconName,
                  iconImage: current.iconImage,
                  description:
                    command.options.description === undefined
                      ? undefined
                      : assertDescription(command.options.description),
                  hosting:
                    command.options.hosting === undefined ? undefined : assertHosting(command.options.hosting),
                  monthlyCostRub: command.options.cost,
                  group: command.options.group === undefined ? undefined : assertGroup(store, command.options.group),
                  now: now(),
                });
                if (server === null) throw new PluginCliError("Сервер не найден.", { code: "not_found" });
                publish({ kind: "inventory" });
                const shown = publicServer(server);
                return {
                  exitCode: 0,
                  stdout: command.options.json
                    ? JSON.stringify({ ok: true, server: shown })
                    : `Сохранено: ${shown.name}\n`,
                };
              } catch (error) {
                return cliFailure(error);
              }
            },
          }),
          "group list": cliCommand({
            summary: "Показать группы и число серверов в каждой",
            options: { json: { type: "boolean", description: "Ответ JSON" } },
            async run(command) {
              const groups = store.listGroups();
              return {
                exitCode: 0,
                stdout: command.options.json
                  ? JSON.stringify({ ok: true, groups, defaultGroup: DEFAULT_GROUP })
                  : `${groups
                      .map(
                        (group) =>
                          `${group.id}  «${group.label}»  ${group.count}${group.id === DEFAULT_GROUP ? "  (по умолчанию)" : ""}`,
                      )
                      .join("\n")}\n`,
              };
            },
          }),
          "group add": cliCommand({
            summary: "Добавить группу",
            options: {
              label: { type: "string", required: true, description: "Название группы" },
              id: { type: "string", description: "id группы (по умолчанию из названия)" },
              json: { type: "boolean", description: "Ответ JSON" },
            },
            async run(command) {
              try {
                const group = createGroup(store, command.options.label, command.options.id);
                publish({ kind: "inventory" });
                return {
                  exitCode: 0,
                  stdout: command.options.json
                    ? JSON.stringify({ ok: true, group: groupWithCount(store, group.id) })
                    : `Группа добавлена: ${group.id} «${group.label}»\n`,
                };
              } catch (error) {
                return cliFailure(error);
              }
            },
          }),
          "group set": cliCommand({
            summary: "Переименовать группу или поменять её место в списке",
            options: {
              id: { type: "string", required: true, description: "id группы" },
              label: { type: "string", description: "Новое название" },
              position: { type: "integer", min: 0, max: 10_000, description: "Место в списке (меньше — выше)" },
              json: { type: "boolean", description: "Ответ JSON" },
            },
            constraints: [{ kind: "at-least-one", options: ["label", "position"] }],
            async run(command) {
              try {
                const id = command.options.id.trim().toLowerCase();
                store.updateGroup(id, {
                  label: command.options.label === undefined ? undefined : assertGroupLabel(command.options.label),
                  position: command.options.position,
                });
                publish({ kind: "inventory" });
                const group = groupWithCount(store, id);
                return {
                  exitCode: 0,
                  stdout: command.options.json
                    ? JSON.stringify({ ok: true, group })
                    : `Сохранено: ${group.id} «${group.label}»\n`,
                };
              } catch (error) {
                return cliFailure(error);
              }
            },
          }),
          "group remove": cliCommand({
            summary: "Удалить группу; её серверы переходят в группу по умолчанию",
            options: {
              id: { type: "string", required: true, description: "id группы" },
              yes: { type: "boolean", description: "Подтвердить, если в группе есть серверы" },
              json: { type: "boolean", description: "Ответ JSON" },
            },
            async run(command) {
              try {
                const id = command.options.id.trim().toLowerCase();
                if (id === DEFAULT_GROUP) {
                  throw new GroupError("invalid", "Группу по умолчанию удалить нельзя.");
                }
                const group = groupWithCount(store, id);
                if (group.count > 0 && command.options.yes !== true) {
                  throw new PluginCliError(
                    `В группе «${group.label}» серверов: ${group.count}. Они перейдут в «${groupLabel(DEFAULT_GROUP)}».`,
                    { code: "confirm", hint: "Повторите с --yes, чтобы удалить группу." },
                  );
                }
                const moved = store.removeGroup(id, now());
                publish({ kind: "inventory" });
                return {
                  exitCode: 0,
                  stdout: command.options.json
                    ? JSON.stringify({ ok: true, removed: id, moved, movedTo: DEFAULT_GROUP })
                    : `Группа удалена: ${id}. Перенесено серверов: ${moved}.\n`,
                };
              } catch (error) {
                return cliFailure(error);
              }
            },
          }),
          "agent-prompt": cliCommand({
            summary: "Текст для агента, который сам найдёт и добавит серверы",
            options: { json: { type: "boolean", description: "Ответ JSON" } },
            async run(command) {
              return {
                exitCode: 0,
                stdout: command.options.json ? JSON.stringify({ ok: true, text: AGENT_PROMPT }) : `${AGENT_PROMPT}\n`,
              };
            },
          }),
          check: cliCommand({
            summary: "Проверить один сервер или все",
            options: {
              all: { type: "boolean", description: "Проверить каждый сервер" },
              id: { type: "string", description: "Идентификатор одного сервера" },
              json: { type: "boolean", description: "Ответ JSON" },
            },
            constraints: [{ kind: "exactly-one", options: ["all", "id"] }],
            async run(command) {
              if (sshPath === null) {
                throw new PluginCliError("На этой машине нет ssh.", {
                  code: "ssh_missing",
                  hint: "Установите OpenSSH и перезагрузите плагин.",
                });
              }
              if (command.options.all === true) {
                const pass = coordinator.runPass("all");
                if (pass.conflict) {
                  throw new PluginCliError("Проверка уже идёт.", { code: "conflict" });
                }
                await pass.done;
              } else {
                const id = command.options.id;
                if (id === undefined || store.get(id) === null) {
                  throw new PluginCliError("Сервер не найден.", {
                    code: "not_found",
                    hint: "Запустите bb ssh-fleet list.",
                  });
                }
                await coordinator.runPass({ id }).done;
              }
              const servers = store.list().map(publicServer);
              const shown =
                command.options.id === undefined
                  ? servers
                  : servers.filter((server) => server.id === command.options.id);
              return {
                exitCode: 0,
                stdout: command.options.json
                  ? JSON.stringify({ ok: true, servers: shown })
                  : shown.length === 0
                    ? "Серверов нет.\n"
                    : `${shown.map(human).join("\n")}\n`,
              };
            },
          }),
        },
      }),
    );

    bb.onDispose(() => {
      dispose.abort();
    });
  };
}

function optionalServer(row: ServerRow | null) {
  return row === null ? null : publicServer(row);
}

function asRefusal(error: unknown): Error {
  if (error instanceof experimental_PluginRpcRefusal) return error;
  if (error instanceof GroupError) {
    return new experimental_PluginRpcRefusal({ code: error.code, message: error.message });
  }
  if (error instanceof DuplicateServerError || error instanceof InputError) {
    return new experimental_PluginRpcRefusal({ code: "invalid", message: error.message });
  }
  return error instanceof Error ? error : new Error("Не удалось сохранить сервер.");
}

export default createPlugin();
