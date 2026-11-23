import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "../server.ts";
import { MIGRATIONS, REWRITTEN_MIGRATIONS } from "../lib/store.ts";

test("import preview does not persist until confirm", async () => {
  const key = makeKey();
  const other = makeKey();
  const config = `Host web\n  IdentityFile ${key}\nHost db\n  IdentityFile ${other}\n`;
  const { bb, harness } = createFakePluginHost({ pluginId: "ssh-fleet" });
  await createPlugin({
    findSsh: () => "/usr/bin/ssh",
    readConfig: () => config,
    home: () => "/tmp/does-not-matter",
    runSshG: async (alias) => `user ubuntu\nhostname ${alias}.example\nport 22\n`,
    probe: async () => ({ code: "up", metrics: null }),
  })(bb);

  const preview = await harness.behavior.callRpc("importPreview", null);
  const body = preview as { candidates: Array<{ alias: string }> };
  assert.equal(body.candidates.length, 2);
  const before = await harness.behavior.callRpc("list", null);
  assert.equal((before as { servers: unknown[] }).servers.length, 0);
  await harness.behavior.callRpc("importCommit", { aliases: ["web"] });
  const after = await harness.behavior.callRpc("list", null);
  const servers = (after as { servers: Array<{ name: string; host: string; user: string }> }).servers;
  assert.equal(servers.length, 1);
  assert.equal(servers[0]?.name, "web");
  assert.equal(servers[0]?.host, "web.example");
  assert.equal(servers[0]?.user, "root");
  await harness.lifecycle.dispose();
});

async function startPlugin() {
  const { bb, harness } = createFakePluginHost({ pluginId: "ssh-fleet" });
  await createPlugin({ findSsh: () => "/usr/bin/ssh", probe: async () => ({ code: "up", metrics: null }) })(bb);
  return harness;
}

type CliServer = { id: string; name: string; description: string; hosting: string; monthlyCostRub: number | null; host: string };

test("add creates a server, a repeated host:port is a conflict", async () => {
  const harness = await startPlugin();
  const key = makeKey();
  const done = await harness.behavior.runCli([
    "add", "--name", "web", "--host", "203.0.113.5", "--key", key,
    "--description", "сайт\nпочта", "--hosting", "Selectel", "--cost", "730", "--json",
  ]);
  assert.equal(done.exitCode, 0, done.stderr);
  const added = JSON.parse(done.stdout) as { ok: boolean; server: CliServer & { port: number } };
  assert.equal(added.server.port, 22);
  assert.equal(added.server.monthlyCostRub, 730);
  const listed = JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout) as { servers: CliServer[] };
  assert.equal(listed.servers.length, 1);
  assert.equal(listed.servers[0]?.hosting, "Selectel");
  assert.equal(listed.servers[0]?.description, "сайт\nпочта");
  const text = (await harness.behavior.runCli(["list"])).stdout;
  assert.ok(text.includes("Selectel · 730 ₽/мес · сайт"), text);
  assert.equal(text.includes("почта"), false);
  const dup = await harness.behavior.runCli(["add", "--name", "copy", "--host", "203.0.113.5", "--key", key, "--json"]);
  assert.notEqual(dup.exitCode, 0);
  assert.ok(dup.stdout.includes("conflict") || dup.stderr.includes("conflict"), dup.stdout + dup.stderr);
  const bad = await harness.behavior.runCli(["add", "--name", "x", "--host", "203.0.113.7", "--key", "relative/key"]);
  assert.notEqual(bad.exitCode, 0);
  const rpc = await harness.behavior.callRpc("list", null) as { servers: CliServer[] };
  assert.equal(rpc.servers[0]?.monthlyCostRub, 730);
  await harness.lifecycle.dispose();
});

test("set changes only the passed fields and keeps the snapshot", async () => {
  const harness = await startPlugin();
  const key = makeKey();
  await harness.behavior.runCli(["add", "--name", "web", "--host", "203.0.113.5", "--key", key, "--description", "старое", "--hosting", "A", "--cost", "100"]);
  const before = (await harness.behavior.callRpc("list", null) as { servers: CliServer[] }).servers[0] as CliServer;
  const done = await harness.behavior.runCli(["set", "--id", before.id, "--description", "новое", "--json"]);
  assert.equal(done.exitCode, 0, done.stderr);
  const after = (await harness.behavior.callRpc("list", null) as { servers: CliServer[] }).servers[0] as CliServer;
  assert.equal(after.description, "новое");
  assert.equal(after.name, "web");
  assert.equal(after.hosting, "A");
  assert.equal(after.monthlyCostRub, 100);
  await harness.behavior.runCli(["set", "--id", before.id, "--cost", "0", "--hosting", "B"]);
  const third = (await harness.behavior.callRpc("list", null) as { servers: CliServer[] }).servers[0] as CliServer;
  assert.equal(third.monthlyCostRub, 0);
  assert.equal(third.hosting, "B");
  assert.equal(third.description, "новое");
  const missing = await harness.behavior.runCli(["set", "--id", "nope", "--name", "x", "--json"]);
  assert.notEqual(missing.exitCode, 0);
  assert.ok((missing.stdout + missing.stderr).includes("not_found"), missing.stdout + missing.stderr);
  await harness.lifecycle.dispose();
});

type GroupServer = CliServer & { group: string; status: string };
type CliGroup = { id: string; label: string; position: number; count: number };

async function groups(harness: Awaited<ReturnType<typeof startPlugin>>): Promise<CliGroup[]> {
  const done = await harness.behavior.runCli(["group", "list", "--json"]);
  assert.equal(done.exitCode, 0, done.stderr);
  return (JSON.parse(done.stdout) as { groups: CliGroup[] }).groups;
}

test("a fresh install lists exactly one group, Personal", async () => {
  const harness = await startPlugin();
  assert.deepEqual(await groups(harness), [{ id: "personal", label: "Personal", position: 0, count: 0 }]);
  const text = (await harness.behavior.runCli(["group", "list"])).stdout;
  assert.ok(text.includes("personal  «Personal»  0  (по умолчанию)"), text);
  await harness.lifecycle.dispose();
});

test("group add, set and remove follow the same rules as the panel", async () => {
  const harness = await startPlugin();
  const key = makeKey();
  const added = await harness.behavior.runCli(["group", "add", "--label", "Demo", "--json"]);
  assert.equal(added.exitCode, 0, added.stderr);
  assert.equal((JSON.parse(added.stdout) as { group: CliGroup }).group.id, "demo");
  const again = await harness.behavior.runCli(["group", "add", "--label", "demo"]);
  assert.notEqual(again.exitCode, 0);
  assert.match(again.stdout + again.stderr, /уже есть|already exists/);
  const badId = await harness.behavior.runCli(["group", "add", "--label", "X", "--id", "Bad Id!"]);
  assert.notEqual(badId.exitCode, 0);
  const empty = await harness.behavior.runCli(["group", "add", "--label", "   "]);
  assert.notEqual(empty.exitCode, 0);
  const lab = await harness.behavior.runCli(["group", "add", "--label", "Лаборатория"]);
  assert.equal(lab.exitCode, 0, lab.stderr);
  assert.ok(lab.stdout.includes("laboratoriya"), lab.stdout);
  const server = await harness.behavior.runCli(["add", "--name", "demo-1", "--host", "203.0.113.31", "--key", key, "--group", "Demo", "--json"]);
  assert.equal(server.exitCode, 0, server.stderr);
  const serverId = (JSON.parse(server.stdout) as { server: GroupServer }).server.id;
  const renamed = await harness.behavior.runCli(["group", "set", "--id", "demo", "--label", "Demo stand", "--position", "0"]);
  assert.equal(renamed.exitCode, 0, renamed.stderr);
  assert.equal((await groups(harness)).find((group) => group.id === "demo")?.label, "Demo stand");
  const noDefault = await harness.behavior.runCli(["group", "remove", "--id", "personal", "--yes"]);
  assert.notEqual(noDefault.exitCode, 0);
  assert.ok((noDefault.stdout + noDefault.stderr).includes("по умолчанию"), noDefault.stdout + noDefault.stderr);
  const unconfirmed = await harness.behavior.runCli(["group", "remove", "--id", "demo", "--json"]);
  assert.notEqual(unconfirmed.exitCode, 0);
  assert.ok(unconfirmed.stdout.includes("confirm"), unconfirmed.stdout);
  assert.ok((await groups(harness)).some((group) => group.id === "demo"));
  const removed = await harness.behavior.runCli(["group", "remove", "--id", "demo", "--yes", "--json"]);
  assert.equal(removed.exitCode, 0, removed.stderr);
  assert.equal((JSON.parse(removed.stdout) as { moved: number }).moved, 1);
  const after = (await harness.behavior.callRpc("list", null) as { servers: GroupServer[] }).servers;
  assert.equal(after.find((row) => row.id === serverId)?.group, "personal");
  const emptyRemoved = await harness.behavior.runCli(["group", "remove", "--id", "laboratoriya"]);
  assert.equal(emptyRemoved.exitCode, 0, emptyRemoved.stderr);
  assert.deepEqual((await groups(harness)).map((group) => group.id), ["personal"]);
  const gone = await harness.behavior.runCli(["group", "remove", "--id", "demo", "--yes", "--json"]);
  assert.notEqual(gone.exitCode, 0);
  assert.ok(gone.stdout.includes("not_found"), gone.stdout);
  await harness.lifecycle.dispose();
});

test("add and set take --group, list --group filters, an unknown group fails with the list", async () => {
  const harness = await startPlugin();
  const key = makeKey();
  await harness.behavior.runCli(["group", "add", "--label", "Tunnels"]);
  await harness.behavior.runCli(["group", "add", "--label", "Lab"]);
  const first = await harness.behavior.runCli(["add", "--name", "plain", "--host", "203.0.113.11", "--key", key, "--json"]);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal((JSON.parse(first.stdout) as { server: GroupServer }).server.group, "personal");
  const tunnel = await harness.behavior.runCli(["add", "--name", "tunnel", "--host", "203.0.113.12", "--key", key, "--group", "tunnels", "--json"]);
  assert.equal(tunnel.exitCode, 0, tunnel.stderr);
  const tunnelId = (JSON.parse(tunnel.stdout) as { server: GroupServer }).server.id;
  const badAdd = await harness.behavior.runCli(["add", "--name", "x", "--host", "203.0.113.13", "--key", key, "--group", "work"]);
  assert.notEqual(badAdd.exitCode, 0);
  const badText = badAdd.stdout + badAdd.stderr;
  assert.ok(badText.includes("Неизвестная группа"), badText);
  assert.ok(badText.includes("personal (Personal)") && badText.includes("tunnels (Tunnels)") && badText.includes("lab (Lab)"), badText);
  const all = JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout) as { servers: GroupServer[] };
  assert.equal(all.servers.length, 2);
  const only = JSON.parse((await harness.behavior.runCli(["list", "--group", "tunnels", "--json"])).stdout) as { servers: GroupServer[] };
  assert.deepEqual(only.servers.map((server) => server.name), ["tunnel"]);
  const text = (await harness.behavior.runCli(["list", "--group", "Tunnels"])).stdout;
  assert.ok(text.includes("tunnel") && text.includes("[Tunnels]"), text);
  assert.equal(text.includes("plain"), false);
  const emptyLab = (await harness.behavior.runCli(["list", "--group", "lab"])).stdout;
  assert.ok(emptyLab.includes("В группе «Lab» серверов нет."), emptyLab);
  const badList = await harness.behavior.runCli(["list", "--group", "nope"]);
  assert.notEqual(badList.exitCode, 0);
  assert.ok((badList.stdout + badList.stderr).includes("Неизвестная группа"), badList.stdout + badList.stderr);
  const set = await harness.behavior.runCli(["set", "--id", tunnelId, "--group", "lab", "--json"]);
  assert.equal(set.exitCode, 0, set.stderr);
  const after = JSON.parse(set.stdout) as { server: GroupServer };
  assert.equal(after.server.group, "lab");
  assert.equal(after.server.name, "tunnel");
  const badSet = await harness.behavior.runCli(["set", "--id", tunnelId, "--group", "VPN!"]);
  assert.notEqual(badSet.exitCode, 0);
  const still = (await harness.behavior.callRpc("list", null) as { servers: GroupServer[] }).servers.find((s) => s.id === tunnelId);
  assert.equal(still?.group, "lab");
  await harness.lifecycle.dispose();
});

test("rpc carries groups: create, update, unknown group, group create and remove", async () => {
  const harness = await startPlugin();
  const key = makeKey();
  const made = await harness.behavior.callRpc("groupCreate", { label: "Demo" }) as { group: CliGroup };
  assert.equal(made.group.id, "demo");
  await assert.rejects(() => harness.behavior.callRpc("groupCreate", { label: "DEMO" }));
  await assert.rejects(() => harness.behavior.callRpc("groupCreate", { label: "" }));
  const draft = { name: "web", host: "203.0.113.21", port: 22, identityPath: key, iconName: "Server", iconImage: null };
  const created = await harness.behavior.callRpc("create", { ...draft, group: "demo" }) as { server: GroupServer };
  assert.equal(created.server.group, "demo");
  const listed = await harness.behavior.callRpc("list", null) as { groups: CliGroup[] };
  assert.deepEqual(listed.groups.map((group) => [group.id, group.count]), [["personal", 0], ["demo", 1]]);
  const updated = await harness.behavior.callRpc("update", { ...draft, id: created.server.id, group: "personal" }) as { server: GroupServer };
  assert.equal(updated.server.group, "personal");
  await assert.rejects(() => harness.behavior.callRpc("update", { ...draft, id: created.server.id, group: "other" }));
  await harness.behavior.callRpc("update", { ...draft, id: created.server.id, group: "demo" });
  await assert.rejects(() => harness.behavior.callRpc("groupRemove", { id: "personal" }));
  const removed = await harness.behavior.callRpc("groupRemove", { id: "demo" }) as { moved: number; movedTo: string };
  assert.deepEqual(removed, { removed: true, moved: 1, movedTo: "personal" });
  const final = await harness.behavior.callRpc("list", null) as { servers: GroupServer[]; groups: CliGroup[] };
  assert.equal(final.servers[0]?.group, "personal");
  assert.deepEqual(final.groups.map((group) => group.id), ["personal"]);
  await harness.lifecycle.dispose();
});

test("an install that applied the old group migration loads, keeps its rows and loses the fixed list", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "ssh-fleet" });
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS.slice(0, 13));
  db.exec(`ALTER TABLE servers ADD COLUMN server_group TEXT NOT NULL DEFAULT 'personal'
    CHECK (server_group IN ('alpha', 'beta', 'personal'))`);
  const [index, oldHash] = REWRITTEN_MIGRATIONS[0] as readonly [number, string];
  db.prepare(`INSERT INTO _bb_migrations (id, applied_at, statement_hash) VALUES (?, 1, ?)`).run(index, oldHash);
  db.prepare(`INSERT INTO servers (id, name, host, port, identity_path, created_at, updated_at, generation, status, server_group)
    VALUES ('x', 'old', '198.51.100.7', 22, '/k', 1, 1, 1, 'unchecked', 'beta')`).run();
  await createPlugin({ findSsh: () => "/usr/bin/ssh", probe: async () => ({ code: "up", metrics: null }) })(bb);
  const listed = await harness.behavior.callRpc("list", null) as { servers: GroupServer[]; groups: CliGroup[] };
  assert.equal(listed.servers.length, 1);
  assert.equal(listed.servers[0]?.group, "beta");
  assert.deepEqual(listed.groups.map((group) => [group.id, group.label, group.count]), [
    ["personal", "Personal", 0], ["beta", "beta", 1],
  ]);
  const set = await harness.behavior.runCli(["group", "set", "--id", "beta", "--label", "Beta"]);
  assert.equal(set.exitCode, 0, set.stderr);
  const added = await harness.behavior.runCli(["group", "add", "--label", "Gamma"]);
  assert.equal(added.exitCode, 0, added.stderr);
  const moved = await harness.behavior.runCli(["set", "--id", "x", "--group", "gamma"]);
  assert.equal(moved.exitCode, 0, moved.stderr);
  await harness.lifecycle.dispose();
});

function makeKey(): string {
  const dir = mkdtempSync(join(tmpdir(), "ssh-fleet-key-"));
  const path = join(dir, "id_ed25519");
  writeFileSync(path, "test-key\n");
  chmodSync(path, 0o600);
  return path;
}
