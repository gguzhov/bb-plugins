/**
 * The "root password, once" path against a fake `ssh` and `ssh-keyscan` put
 * first in PATH. The fakes record argv and the names of the environment
 * variables they get, act as the server (authorized_keys is a file in the
 * fixture dir), and obtain the password the way real ssh does: by running
 * $SSH_ASKPASS. No real server is contacted.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "../server.ts";
import { AGENT_PROMPT } from "../lib/agent-prompt.ts";
import { fingerprintOf, parseKeyscan, redact } from "../lib/password-setup.ts";

const PASSWORD = "Canary-Pa55word-7f3c1e!";
const HOST = "203.0.113.5";

const FAKE_SSH = `#!/bin/bash
d="$FAKE_SSH_DIR"
printf 'argv:' >> "$d/calls.log"; printf ' %q' "$@" >> "$d/calls.log"; printf '\\n' >> "$d/calls.log"
printf 'envnames: %s\\n' "$(env | cut -d= -f1 | sort | tr '\\n' ' ')" >> "$d/calls.log"
printf 'askpass_require=%s askpass_set=%s\\n' "$SSH_ASKPASS_REQUIRE" "\${SSH_ASKPASS:+yes}" >> "$d/calls.log"
scenario=$(cat "$d/scenario")
if [ "$1" = "-V" ]; then
  if [ "$scenario" = "old" ]; then echo "OpenSSH_8.2p1, LibreSSL" >&2; else echo "OpenSSH_9.6p1, LibreSSL" >&2; fi
  exit 0
fi
args="$*"
kh=$(printf '%s\\n' "$@" | sed -n 's/^UserKnownHostsFile=//p')
if ! grep -qxF -- "$(cat "$d/expected_known_host")" "$kh" 2>/dev/null; then
  echo "Host key verification failed." >&2; exit 255
fi
case "$args" in
*PubkeyAuthentication=no*)
  echo "password-session" >> "$d/sequence.log"
  case "$scenario" in
    unreachable) echo "ssh: connect to host $HOST port 22: Connection refused" >&2; exit 255 ;;
    disabled) echo "root@$HOST: Permission denied (publickey)." >&2; exit 255 ;;
  esac
  pw=$("$SSH_ASKPASS" "root@$HOST's password: ") || { echo "askpass failed" >&2; exit 255; }
  if [ "$scenario" = "noisy" ]; then echo "debug1: server echoed $pw back" >&2; fi
  if [ "$pw" != "$(cat "$d/expected_password")" ]; then
    echo "Permission denied, please try again." >&2
    echo "root@$HOST: Permission denied (publickey,password)." >&2
    exit 255
  fi
  IFS= read -r key
  touch "$d/authorized_keys"
  case "$args" in
  *SSH_FLEET_KEY_REMOVED*)
    grep -vxF -- "$key" "$d/authorized_keys" > "$d/ak.tmp"; cat "$d/ak.tmp" > "$d/authorized_keys"; echo SSH_FLEET_KEY_REMOVED; exit 0 ;;
  esac
  if grep -qxF -- "$key" "$d/authorized_keys"; then echo SSH_FLEET_KEY_PRESENT; exit 0; fi
  printf '%s\\n' "$key" >> "$d/authorized_keys"; echo SSH_FLEET_KEY_INSTALLED; exit 0 ;;
*PreferredAuthentications=publickey*)
  echo "key-session" >> "$d/sequence.log"
  idf=$(printf '%s\\n' "$@" | sed -n 's/^IdentityFile=//p')
  if [ "$scenario" = "keyfail" ] || ! grep -qxF -- "$(cat "$idf.pub")" "$d/authorized_keys" 2>/dev/null; then
    echo "root@$HOST: Permission denied (publickey)." >&2; exit 255
  fi
  echo SSH_FLEET_KEY_LOGIN_OK; exit 0 ;;
esac
echo "unexpected call" >&2; exit 255
`;

const FAKE_KEYSCAN = `#!/bin/bash
d="$FAKE_SSH_DIR"
printf 'keyscan:' >> "$d/calls.log"; printf ' %q' "$@" >> "$d/calls.log"; printf '\\n' >> "$d/calls.log"
echo "keyscan" >> "$d/sequence.log"
if [ "$(cat "$d/scenario")" = "unreachable" ]; then exit 1; fi
echo "# $HOST:22 SSH-2.0-OpenSSH_9.6"
cat "$d/hostkey_line"
`;

type Fixture = {
  dir: string;
  bin: string;
  home: string;
  knownHosts: string;
  hostKey: { type: string; base64: string; fingerprint: string };
};

let fixture: Fixture;
let savedPath: string | undefined;

beforeEach(() => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ssh-fleet-pw-")));
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(bin, "ssh"), FAKE_SSH, { mode: 0o755 });
  writeFileSync(join(bin, "ssh-keyscan"), FAKE_KEYSCAN, { mode: 0o755 });
  // A throwaway host key made for this test only; its public half plays the server's host key.
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(dir, "hostkey")]);
  const [type, base64] = readFileSync(join(dir, "hostkey.pub"), "utf8").trim().split(/\s+/) as [string, string];
  writeFileSync(join(dir, "hostkey_line"), `${HOST} ${type} ${base64}\n`);
  writeFileSync(join(dir, "expected_known_host"), `${HOST} ${type} ${base64}`);
  writeFileSync(join(dir, "expected_password"), PASSWORD);
  writeFileSync(join(dir, "scenario"), "ok");
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "sequence.log"), "");
  savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  process.env.FAKE_SSH_DIR = dir;
  process.env.HOST = HOST;
  fixture = { dir, bin, home, knownHosts: join(home, "known_hosts"), hostKey: { type, base64, fingerprint: fingerprintOf(base64) } };
});

afterEach(() => {
  process.env.PATH = savedPath;
  delete process.env.FAKE_SSH_DIR;
});

async function start() {
  const host = createFakePluginHost({ pluginId: "ssh-fleet" });
  await createPlugin({
    findSsh: () => join(fixture.bin, "ssh"),
    home: () => fixture.home,
    knownHostsPath: () => fixture.knownHosts,
    probe: async () => ({ code: "up", metrics: null }),
  })(host.bb);
  return host;
}

function scenario(name: string) {
  writeFileSync(join(fixture.dir, "scenario"), name);
}

function sshDirFiles(): string[] {
  const dir = join(fixture.home, ".ssh");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

const draft = (scanId: string, fingerprint: string, password = PASSWORD) => ({
  name: "Demo web",
  host: HOST,
  port: 22,
  iconName: "Server",
  iconImage: null,
  scanId,
  fingerprint,
  password,
  addSshConfig: false,
});

/** Every byte a reviewer could worry about: fake ssh records, plugin logs, the db file and its WAL. */
function leakSources(host: Awaited<ReturnType<typeof start>>, extra: string[]): Record<string, string> {
  const db = host.bb.storage.database() as unknown as { name: string };
  const dbBytes = ["", "-wal", "-shm"]
    .map((suffix) => `${db.name}${suffix}`)
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path).toString("latin1"))
    .join("\n");
  return {
    calls: readFileSync(join(fixture.dir, "calls.log"), "utf8"),
    argv: readFileSync(join(fixture.dir, "calls.log"), "utf8").split("\n").filter((line) => line.startsWith("argv") || line.startsWith("keyscan")).join("\n"),
    logs: host.harness.inspection.logEntries.map((entry) => entry.message).join("\n"),
    db: dbBytes,
    publicFiles: sshDirFiles()
      .filter((name) => name.endsWith(".pub") || name === "config" || name === "known_hosts")
      .map((name) => readFileSync(join(fixture.home, ".ssh", name), "utf8"))
      .join("\n"),
    knownHosts: existsSync(fixture.knownHosts) ? readFileSync(fixture.knownHosts, "utf8") : "",
    results: extra.join("\n"),
  };
}

function assertNoPassword(sources: Record<string, string>) {
  for (const [where, text] of Object.entries(sources)) {
    assert.equal(text.includes(PASSWORD), false, `password found in ${where}`);
  }
}

test("password setup: dedicated key, installed, verified, only the key path stored, password nowhere", async () => {
  const host = await start();
  const scanned = (await host.harness.behavior.callRpc("hostKeyScan", { host: HOST, port: 22 })) as {
    scanId: string; fingerprint: string; keyType: string; known: string;
  };
  assert.equal(scanned.fingerprint, fixture.hostKey.fingerprint);
  assert.equal(scanned.keyType, "ssh-ed25519");
  assert.equal(scanned.known, "new");
  const result = (await host.harness.behavior.callRpc("createWithPassword", { ...draft(scanned.scanId, scanned.fingerprint), addSshConfig: true })) as {
    server: { identityPath: string; host: string; status: string };
    keyPath: string;
    sshConfigAlias: string | null;
  };
  const keyPath = join(fixture.home, ".ssh", "ssh-fleet-demo-web");
  assert.equal(result.keyPath, keyPath);
  assert.equal(result.server.identityPath, keyPath);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  const publicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
  assert.deepEqual(readFileSync(join(fixture.dir, "authorized_keys"), "utf8").trim().split("\n"), [publicKey]);
  assert.deepEqual(readFileSync(join(fixture.dir, "sequence.log"), "utf8").trim().split("\n"), ["keyscan", "password-session", "key-session"]);
  assert.equal(result.server.status, "up");
  assert.ok(readFileSync(fixture.knownHosts, "utf8").includes(`${HOST} ${fixture.hostKey.type} ${fixture.hostKey.base64}`));
  assert.equal(result.sshConfigAlias, "demo-web");
  assert.ok(readFileSync(join(fixture.home, ".ssh", "config"), "utf8").includes(`Host demo-web\n  HostName ${HOST}\n  User root\n  IdentityFile ${keyPath}`));

  const calls = readFileSync(join(fixture.dir, "calls.log"), "utf8");
  assert.ok(calls.includes("askpass_require=force askpass_set=yes"), "ssh got SSH_ASKPASS with REQUIRE=force");
  assert.ok(!/StrictHostKeyChecking=(no|accept-new)/.test(calls), "host key checking stays strict");
  const listed = await host.harness.behavior.callRpc("list", null);
  const cli = await host.harness.behavior.runCli(["list", "--json"]);
  const kv = await host.bb.storage.kv.list();
  assert.deepEqual(kv, []);
  assertNoPassword(leakSources(host, [JSON.stringify(scanned), JSON.stringify(result), JSON.stringify(listed), cli.stdout, cli.stderr, JSON.stringify(kv)]));
  await host.harness.lifecycle.dispose();
});

test("nothing is sent before the host key is confirmed; a wrong or stale confirmation stops before ssh", async () => {
  const host = await start();
  const scanned = (await host.harness.behavior.callRpc("hostKeyScan", { host: HOST, port: 22 })) as { scanId: string; fingerprint: string };
  assert.deepEqual(readFileSync(join(fixture.dir, "sequence.log"), "utf8").trim().split("\n"), ["keyscan"]);
  assert.equal(readFileSync(join(fixture.dir, "calls.log"), "utf8").includes("argv:"), false, "scan never runs ssh");

  const wrong = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  await assert.rejects(() => host.harness.behavior.callRpc("createWithPassword", draft(scanned.scanId, wrong)), /Отпечаток не совпадает/);
  await assert.rejects(() => host.harness.behavior.callRpc("createWithPassword", draft("no-such-scan", scanned.fingerprint)), /устарело/);
  assert.equal(readFileSync(join(fixture.dir, "calls.log"), "utf8").includes("argv:"), false, "no ssh process before confirmation");
  assert.deepEqual(sshDirFiles(), [], "no key generated");

  // The CLI shows the fingerprint and stops; the password is not used.
  const first = await host.harness.behavior.runCli(["add", "--name", "cli", "--host", HOST, "--password", PASSWORD, "--json"]);
  assert.notEqual(first.exitCode, 0);
  assert.ok((first.stdout + first.stderr).includes(fixture.hostKey.fingerprint));
  assert.ok((first.stdout + first.stderr).includes("confirm_host_key"));
  assert.equal(readFileSync(join(fixture.dir, "calls.log"), "utf8").includes("argv:"), false);

  // If the server presents a different key than the confirmed one, ssh refuses before authentication.
  const scanned2 = (await host.harness.behavior.callRpc("hostKeyScan", { host: HOST, port: 22 })) as { scanId: string; fingerprint: string };
  writeFileSync(join(fixture.dir, "expected_known_host"), `${HOST} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDifferentKeyDifferentKeyDifferentKey00`);
  await assert.rejects(() => host.harness.behavior.callRpc("createWithPassword", draft(scanned2.scanId, scanned2.fingerprint)), /Ключ хоста не совпал/);
  assert.equal(readFileSync(join(fixture.dir, "sequence.log"), "utf8").includes("password-session"), false);
  assert.deepEqual(sshDirFiles(), [], "the generated key was removed");
  assertNoPassword(leakSources(host, [first.stdout, first.stderr]));
  await host.harness.lifecycle.dispose();
});

test("CLI --password-stdin path (rewritten by bb to --password) installs the key after --host-key", async () => {
  const host = await start();
  const done = await host.harness.behavior.runCli([
    "add", "--name", "cli web", "--host", HOST, "--password", PASSWORD,
    "--host-key", fixture.hostKey.fingerprint, "--hosting", "Example", "--cost", "500", "--json",
  ]);
  assert.equal(done.exitCode, 0, done.stdout + done.stderr);
  const body = JSON.parse(done.stdout) as { server: { identityPath: string; monthlyCostRub: number }; keyPath: string };
  assert.equal(body.server.identityPath, join(fixture.home, ".ssh", "ssh-fleet-cli-web"));
  assert.equal(body.server.monthlyCostRub, 500);
  const both = await host.harness.behavior.runCli(["add", "--name", "x", "--host", "203.0.113.6", "--password", PASSWORD, "--key", "/tmp/k"]);
  assert.notEqual(both.exitCode, 0);
  assertNoPassword(leakSources(host, [done.stdout, done.stderr, both.stdout, both.stderr]));
  await host.harness.lifecycle.dispose();
});

for (const [name, expected] of [
  ["wrong", /Пароль не подошёл/],
  ["disabled", /не принимает вход по паролю/],
  ["unreachable", /недоступен/],
  ["keyfail", /вход по нему не прошёл/],
  ["noisy", /Пароль не подошёл/],
  ["old", /OpenSSH 8\.4/],
] as const) {
  test(`password setup fails cleanly: ${name}`, async () => {
    const host = await start();
    if (name !== "unreachable") {
      // Scan first with a working server, then switch the scenario.
      scenario("ok");
    } else {
      scenario("unreachable");
    }
    if (name === "unreachable") {
      await assert.rejects(() => host.harness.behavior.callRpc("hostKeyScan", { host: HOST, port: 22 }), expected);
      const viaCli = await host.harness.behavior.runCli(["add", "--name", "x", "--host", HOST, "--password", PASSWORD, "--host-key", fixture.hostKey.fingerprint]);
      assert.notEqual(viaCli.exitCode, 0);
      assert.match(viaCli.stdout + viaCli.stderr, expected);
    } else {
      const scanned = (await host.harness.behavior.callRpc("hostKeyScan", { host: HOST, port: 22 })) as { scanId: string; fingerprint: string };
      if (name === "wrong") writeFileSync(join(fixture.dir, "expected_password"), "something-else");
      if (name === "noisy") {
        writeFileSync(join(fixture.dir, "expected_password"), "something-else");
        scenario("noisy");
      } else scenario(name);
      let message = "";
      await assert.rejects(
        () => host.harness.behavior.callRpc("createWithPassword", draft(scanned.scanId, scanned.fingerprint)),
        (error: Error) => {
          message = error.message;
          return expected.test(error.message);
        },
      );
      assert.equal(message.includes(PASSWORD), false);
      if (name === "keyfail") {
        assert.equal(readFileSync(join(fixture.dir, "authorized_keys"), "utf8").trim(), "", "the installed key was taken back");
      }
    }
    const listed = (await host.harness.behavior.callRpc("list", null)) as { servers: unknown[] };
    assert.equal(listed.servers.length, 0, "no half-created server");
    assert.deepEqual(sshDirFiles(), [], "no orphan key");
    assertNoPassword(leakSources(host, [JSON.stringify(listed)]));
    await host.harness.lifecycle.dispose();
  });
}

test("refused addresses fail before any network call", async () => {
  const host = await start();
  for (const target of ["127.0.0.1", "169.254.169.254", "metadata.google.internal", "::1"]) {
    await assert.rejects(() => host.harness.behavior.callRpc("hostKeyScan", { host: target, port: 22 }), /нельзя|cannot be checked/);
    await assert.rejects(
      () => host.harness.behavior.callRpc("createWithPassword", { ...draft("x", "SHA256:x"), host: target }),
      /нельзя|cannot be checked/,
    );
  }
  assert.equal(readFileSync(join(fixture.dir, "calls.log"), "utf8"), "");
  assert.deepEqual(sshDirFiles(), []);
  await host.harness.lifecycle.dispose();
});

test("an existing key file is never overwritten", async () => {
  const host = await start();
  mkdirSync(join(fixture.home, ".ssh"), { mode: 0o700 });
  writeFileSync(join(fixture.home, ".ssh", "ssh-fleet-demo-web"), "keep me\n", { mode: 0o600 });
  const scanned = (await host.harness.behavior.callRpc("hostKeyScan", { host: HOST, port: 22 })) as { scanId: string; fingerprint: string };
  const result = (await host.harness.behavior.callRpc("createWithPassword", draft(scanned.scanId, scanned.fingerprint))) as { keyPath: string };
  assert.equal(result.keyPath, join(fixture.home, ".ssh", "ssh-fleet-demo-web-2"));
  assert.equal(readFileSync(join(fixture.home, ".ssh", "ssh-fleet-demo-web"), "utf8"), "keep me\n");
  await host.harness.lifecycle.dispose();
});

test("redact and keyscan parsing", () => {
  assert.equal(redact(`a ${PASSWORD} b ${PASSWORD}`, PASSWORD), "a [redacted] b [redacted]");
  const parsed = parseKeyscan(`# comment\n${HOST} ssh-rsa AAAA\n${readFileSync(join(fixture.dir, "hostkey_line"), "utf8")}`);
  assert.equal(parsed?.type, "ssh-ed25519");
  assert.equal(parsed?.fingerprint, fixture.hostKey.fingerprint);
  // ssh-keygen agrees on the fingerprint format.
  const keygen = execFileSync("ssh-keygen", ["-lf", join(fixture.dir, "hostkey.pub")], { encoding: "utf8" });
  assert.ok(keygen.includes(fixture.hostKey.fingerprint), keygen);
});

test("the agent prompt is the same in the CLI, the RPC and the skill, names no agent and forbids printing secrets", async () => {
  const host = await start();
  const cli = await host.harness.behavior.runCli(["agent-prompt"]);
  assert.equal(cli.stdout.trim(), AGENT_PROMPT);
  const rpc = (await host.harness.behavior.callRpc("agentPrompt", null)) as { text: string };
  assert.equal(rpc.text, AGENT_PROMPT);
  const skill = readFileSync(new URL("../skills/ssh-fleet/SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.includes(AGENT_PROMPT), "skill carries the same text");
  assert.ok(AGENT_PROMPT.includes("Use existing SSH keys on this computer"));
  assert.ok(AGENT_PROMPT.includes("Never ask for passwords in chat"));
  assert.ok(!AGENT_PROMPT.includes("--password-stdin"));
  assert.ok(!/chatgpt|claude|grok|composer|cursor|codex|copilot|gemini/i.test(AGENT_PROMPT));
  assert.ok(AGENT_PROMPT.includes("Never print, echo, log, store or write to a file any password"));
  assert.ok(AGENT_PROMPT.includes("never print or read out the contents of a private key"));
  await host.harness.lifecycle.dispose();
});
