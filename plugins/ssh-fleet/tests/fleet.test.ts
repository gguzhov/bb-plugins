import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertIconImage, assertIconName } from "../lib/icon.ts";
import { isDeniedAddress, normalizeHost } from "../lib/hosts.ts";
import { classifyFailure, HOST_KEY_FIXTURE, AUTH_FIXTURE } from "../lib/classify.ts";
import { parseRemoteOutput } from "../lib/remote.ts";
import { extractHostStanzas } from "../lib/ssh-config.ts";
import { sshArguments } from "../lib/ssh-probe.ts";
import { createStore, GroupError, MIGRATIONS } from "../lib/store.ts";
import { DEFAULT_GROUP, cleanGroupLabel, groupIdFromLabel, isGroupId } from "../lib/groups.ts";
import Database from "better-sqlite3";
import { costLine, costTotals, hourly } from "../lib/cost.ts";

test("denies loopback, link-local, and metadata, and allows a private VPS", () => {
  assert.equal(isDeniedAddress("127.0.0.1"), true);
  assert.equal(isDeniedAddress("10.1.2.3"), false);
  assert.equal(isDeniedAddress("169.254.169.254"), true);
  assert.equal(isDeniedAddress("100.100.100.200"), true);
  assert.equal(isDeniedAddress("::1"), true);
  assert.equal(isDeniedAddress("fe80::1"), true);
  assert.equal(isDeniedAddress("fd00:ec2::254"), true);
  assert.equal(normalizeHost("Example.COM").host, "example.com");
  assert.throws(() => normalizeHost("metadata.google.internal"));
  assert.throws(() => normalizeHost("127.0.0.1"));
  assert.equal(normalizeHost("192.168.0.5").kind, "ipv4");
});

test("parses a capacity snapshot and ignores unknown lines", () => {
  const parsed = parseRemoteOutput("cpu_percent=12.5\nuptime_seconds=90\nload1=0.1\nload5=0.2\nload15=0.3\nmem_total_bytes=100\nmem_available_bytes=40\ndisk_total_bytes=200\ndisk_used_bytes=50\nnope\n");
  assert.equal(parsed.count, 9);
  assert.equal(parsed.metrics.cpuPercent, 12.5);
  assert.equal(parsed.metrics.uptimeSeconds, 90);
});

test("classifies host-key and auth fixtures, and leaves other stderr generic", () => {
  const hostKey = `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\n${HOST_KEY_FIXTURE}`;
  assert.equal(classifyFailure({ stderr: hostKey, timedOut: false, truncated: false }), "host_key_changed");
  assert.equal(classifyFailure({ stderr: `root@host: ${AUTH_FIXTURE}).`, timedOut: false, truncated: false }), "auth");
  assert.equal(classifyFailure({ stderr: "Connection reset by peer", timedOut: false, truncated: false }), "ssh_error");
  assert.equal(classifyFailure({ stderr: HOST_KEY_FIXTURE, timedOut: true, truncated: false }), "timeout");
});

test("an IdentityFile stays in its own Host stanza", () => {
  const text = [
    "Host web",
    "  IdentityFile /keys/web",
    "Host bare",
    "  User ubuntu",
    "Host *",
    "  IdentityFile /keys/default",
    "Host first",
    "  IdentityFile /keys/first",
    "Host second",
    "  User root",
  ].join("\n");
  const found = extractHostStanzas(text);
  assert.deepEqual(found.map((item) => item.alias), ["web", "first"]);
  assert.equal(found.find((item) => item.alias === "web")?.identityFile, "/keys/web");
  assert.equal(found.find((item) => item.alias === "second"), undefined);
});

test("hostname ssh argv uses a vetted literal and HostKeyAlias", () => {
  const args = sshArguments({
    identityPath: "/keys/id",
    port: 22,
    address: "203.0.113.5",
    hostKeyAlias: "vps.example",
    knownHostsPath: "/Users/me/.ssh/known_hosts",
  });
  assert.ok(args.includes("HostKeyAlias=vps.example"));
  assert.equal(args.at(-2), "203.0.113.5");
  assert.equal(sshArguments({
    identityPath: "/keys/id",
    port: 22,
    address: "203.0.113.5",
    hostKeyAlias: null,
    knownHostsPath: "/Users/me/.ssh/known_hosts",
  }).some((arg) => arg.startsWith("HostKeyAlias=")), false);
});

test("a stale generation does not overwrite the row", () => {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = createStore(db);
  const key = makeKey();
  const row = store.insert({ id: "s1", name: "web", host: "203.0.113.5", port: 22, identityPath: key, now: 1 });
  assert.equal(store.markStarted(row.id, row.generation, 10), true);
  assert.equal(store.applyResult(row.id, row.generation, 10, {
    status: "up",
    errorCode: null,
    errorText: null,
    metrics: emptyMetrics(1),
    now: 11,
  }), true);
  const updated = store.update(row.id, {
    name: "web",
    host: "203.0.113.9",
    port: 22,
    identityPath: key,
    iconName: "Cloud",
    iconImage: null,
    now: 12,
  });
  assert.equal(updated?.status, "unchecked");
  assert.equal(updated?.cpuPercent, null);
  assert.equal(updated?.generation, 2);
  assert.equal(updated?.iconName, "Cloud");
  assert.equal(store.applyResult(row.id, row.generation, 10, {
    status: "up",
    errorCode: null,
    errorText: null,
    metrics: emptyMetrics(9),
    now: 13,
  }), false);
  assert.equal(store.get(row.id)?.status, "unchecked");
  assert.throws(() => store.insert({ id: "s2", name: "copy", host: "203.0.113.9", port: 22, identityPath: key, now: 14 }));
});

test("new info fields are stored and editing them keeps the snapshot", () => {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = createStore(db);
  const key = makeKey();
  const plain = store.insert({ id: "p", name: "plain", host: "203.0.113.1", port: 22, identityPath: key, now: 1 });
  assert.equal(plain.description, "");
  assert.equal(plain.hosting, "");
  assert.equal(plain.monthlyCostRub, null);
  const row = store.insert({
    id: "s1", name: "web", host: "203.0.113.5", port: 22, identityPath: key, now: 1,
    description: "сайт\nи почта", hosting: "Selectel", monthlyCostRub: 730,
  });
  assert.equal(store.get("s1")?.description, "сайт\nи почта");
  assert.equal(store.get("s1")?.hosting, "Selectel");
  assert.equal(store.get("s1")?.monthlyCostRub, 730);
  store.markStarted(row.id, row.generation, 10);
  store.applyResult(row.id, row.generation, 10, {
    status: "up", errorCode: null, errorText: null, metrics: emptyMetrics(7), now: 11,
  });
  const edited = store.update("s1", {
    name: "web2", host: "203.0.113.5", port: 22, identityPath: key,
    iconName: "Server", iconImage: null, description: "новое", hosting: "Timeweb", monthlyCostRub: null, now: 12,
  });
  assert.equal(edited?.description, "новое");
  assert.equal(edited?.hosting, "Timeweb");
  assert.equal(edited?.monthlyCostRub, null);
  assert.equal(edited?.status, "up");
  assert.equal(edited?.cpuPercent, 7);
  assert.equal(edited?.generation, 1);
  const moved = store.update("s1", {
    name: "web2", host: "203.0.113.6", port: 22, identityPath: key, iconName: "Server", iconImage: null, now: 13,
  });
  assert.equal(moved?.status, "unchecked");
  assert.equal(moved?.description, "новое");
});

test("new columns migrate an existing database with data", () => {
  const db = new Database(":memory:");
  const old = MIGRATIONS.slice(0, 10);
  for (const statement of old) db.exec(statement);
  db.prepare(`INSERT INTO servers (id, name, host, port, identity_path, created_at, updated_at, generation, status)
    VALUES ('x', 'old', '198.51.100.1', 22, '/k', 1, 1, 1, 'up')`).run();
  for (const statement of MIGRATIONS.slice(10)) db.exec(statement);
  const row = createStore(db).get("x");
  assert.equal(row?.status, "up");
  assert.equal(row?.description, "");
  assert.equal(row?.hosting, "");
  assert.equal(row?.monthlyCostRub, null);
});

test("a fresh install has exactly one group, the default one", () => {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = createStore(db);
  assert.deepEqual(store.listGroups(), [{ id: DEFAULT_GROUP, label: "Personal", position: 0, count: 0 }]);
});

test("group is stored, defaults to the default group, and editing it keeps the snapshot", () => {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = createStore(db);
  const key = makeKey();
  store.addGroup("alpha", "Alpha");
  store.addGroup("beta", "Beta");
  const plain = store.insert({ id: "p", name: "plain", host: "203.0.113.1", port: 22, identityPath: key, now: 1 });
  assert.equal(plain.group, DEFAULT_GROUP);
  const alpha = store.insert({ id: "a", name: "a", host: "203.0.113.2", port: 22, identityPath: key, now: 1, group: "alpha" });
  assert.equal(store.get(alpha.id)?.group, "alpha");
  store.markStarted("a", alpha.generation, 10);
  store.applyResult("a", alpha.generation, 10, {
    status: "up", errorCode: null, errorText: null, metrics: emptyMetrics(42), now: 11,
  });
  const regrouped = store.update("a", {
    name: "a", host: "203.0.113.2", port: 22, identityPath: key, iconName: "Server", iconImage: null,
    group: "beta", now: 12,
  });
  assert.equal(regrouped?.group, "beta");
  assert.equal(regrouped?.status, "up");
  assert.equal(regrouped?.cpuPercent, 42);
  assert.equal(regrouped?.generation, 1);
  const kept = store.update("a", {
    name: "a2", host: "203.0.113.2", port: 22, identityPath: key, iconName: "Server", iconImage: null, now: 13,
  });
  assert.equal(kept?.group, "beta");
  assert.deepEqual(store.listGroups().map((group) => [group.id, group.count]), [
    [DEFAULT_GROUP, 1], ["alpha", 0], ["beta", 1],
  ]);
});

test("groups: repeated id or label is a conflict, removal moves servers to the default group", () => {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = createStore(db);
  const key = makeKey();
  store.addGroup("demo", "Demo");
  assert.throws(() => store.addGroup("demo", "Other"), GroupError);
  assert.throws(() => store.addGroup("demo-2", "demo"), GroupError);
  const row = store.insert({ id: "d", name: "d", host: "203.0.113.3", port: 22, identityPath: key, now: 1, group: "demo" });
  store.markStarted("d", row.generation, 5);
  store.applyResult("d", row.generation, 5, {
    status: "up", errorCode: null, errorText: null, metrics: emptyMetrics(3), now: 6,
  });
  assert.throws(() => store.removeGroup(DEFAULT_GROUP, 7), GroupError);
  assert.throws(() => store.removeGroup("missing", 7), GroupError);
  assert.equal(store.removeGroup("demo", 7), 1);
  const moved = store.get("d");
  assert.equal(moved?.group, DEFAULT_GROUP);
  assert.equal(moved?.status, "up");
  assert.equal(moved?.cpuPercent, 3);
  assert.deepEqual(store.listGroups().map((group) => group.id), [DEFAULT_GROUP]);
  store.updateGroup(DEFAULT_GROUP, { label: "Личный", position: 5 });
  assert.equal(store.getGroup(DEFAULT_GROUP)?.label, "Личный");
});

test("group ids come from labels, latin or cyrillic, and stay unique", () => {
  assert.equal(groupIdFromLabel("Demo Lab", new Set()), "demo-lab");
  assert.equal(groupIdFromLabel("Работа", new Set()), "rabota");
  assert.equal(groupIdFromLabel("Demo", new Set(["demo"])), "demo-2");
  assert.equal(groupIdFromLabel("!!!", new Set()), "group");
  assert.equal(isGroupId("demo-lab"), true);
  assert.equal(isGroupId("Demo"), false);
  assert.equal(isGroupId(":add"), false);
  assert.equal(cleanGroupLabel("  a   b "), "a b");
  assert.equal(cleanGroupLabel(""), null);
  assert.equal(cleanGroupLabel("x".repeat(41)), null);
  assert.equal(cleanGroupLabel("a\u0007b"), null);
});

test("group migration keeps existing rows and sets them to the default group", () => {
  const db = new Database(":memory:");
  const before = MIGRATIONS.length - 2;
  for (const statement of MIGRATIONS.slice(0, before)) db.exec(statement);
  db.prepare(`INSERT INTO servers (id, name, host, port, identity_path, created_at, updated_at, generation, status,
    description, hosting, monthly_cost_rub, cpu_percent)
    VALUES ('x', 'old', '198.51.100.1', 22, '/k', 1, 1, 3, 'up', 'сайт', 'Selectel', 4858, 12.5)`).run();
  for (const statement of MIGRATIONS.slice(before)) db.exec(statement);
  const row = createStore(db).get("x");
  assert.equal(row?.group, DEFAULT_GROUP);
  assert.equal(row?.name, "old");
  assert.equal(row?.status, "up");
  assert.equal(row?.generation, 3);
  assert.equal(row?.description, "сайт");
  assert.equal(row?.hosting, "Selectel");
  assert.equal(row?.monthlyCostRub, 4858);
  assert.equal(row?.cpuPercent, 12.5);
});

test("an install with a fixed-group CHECK keeps every row and gets one group per used value", () => {
  const db = new Database(":memory:");
  const before = MIGRATIONS.length - 2;
  for (const statement of MIGRATIONS.slice(0, before)) db.exec(statement);
  // What older versions shipped: a column limited to a fixed list of ids.
  db.exec(`ALTER TABLE servers ADD COLUMN server_group TEXT NOT NULL DEFAULT 'personal'
    CHECK (server_group IN ('alpha', 'beta', 'personal'))`);
  const insert = db.prepare(`INSERT INTO servers (id, name, host, port, identity_path, created_at, updated_at, generation,
    status, server_group, monthly_cost_rub, hosting) VALUES (?, ?, ?, 22, '/k', 1, 2, 4, 'down', ?, ?, 'H')`);
  insert.run("1", "one", "198.51.100.1", "beta", 100);
  insert.run("2", "two", "198.51.100.2", "alpha", null);
  insert.run("3", "three", "198.51.100.3", "beta", 300);
  const rowsBefore = createStoreRows(db);
  db.exec(MIGRATIONS[MIGRATIONS.length - 1] as string);
  const store = createStore(db);
  assert.deepEqual(createStoreRows(db), rowsBefore);
  assert.deepEqual(store.listGroups(), [
    { id: DEFAULT_GROUP, label: "Personal", position: 0, count: 0 },
    { id: "alpha", label: "alpha", position: 1, count: 1 },
    { id: "beta", label: "beta", position: 2, count: 2 },
  ]);
  store.addGroup("gamma", "Gamma");
  db.prepare(`UPDATE servers SET server_group = 'gamma' WHERE id = '1'`).run();
  assert.equal(store.get("1")?.group, "gamma");
});

test("hourly cost is monthly / 720 with two decimals", () => {
  const nbsp = (text: string | null) => text?.replace(/\u00a0|\u202f/g, " ");
  assert.equal(nbsp(costLine(4858, "ru")), "4 858 ₽/мес · 6,75 ₽/час");
  assert.equal(costLine(null), null);
  assert.equal(hourly(0, "ru"), "0,00");
  assert.equal(costLine(4858, "en"), "4,858 RUB/mo · 6.75 RUB/h");
  assert.deepEqual(costTotals([{ monthlyCostRub: 4858 }, { monthlyCostRub: null }, { monthlyCostRub: 142 }]), {
    monthly: 5000, unpriced: 1, count: 3,
  });
});

test("an attached icon must be a small raster image", () => {
  assert.equal(assertIconName("Server"), "Server");
  assert.throws(() => assertIconName("NotAnIcon"));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  assert.equal(assertIconImage(png)?.startsWith("data:image/png"), true);
  assert.throws(() => assertIconImage("data:image/svg+xml;base64,PHN2Zy8+"));
  assert.equal(assertIconImage(null), null);
});

test("probe source does not read the identity file", () => {
  const source = readFileSync(new URL("../lib/ssh-probe.ts", import.meta.url), "utf8");
  assert.equal(source.includes("readFile"), false);
  assert.equal(source.includes("IdentityFile="), true);
});

function createStoreRows(db: InstanceType<typeof Database>) {
  return db.prepare(`SELECT * FROM servers ORDER BY id`).all();
}

function makeKey(): string {
  const dir = mkdtempSync(join(tmpdir(), "ssh-fleet-"));
  const path = join(dir, "id_ed25519");
  writeFileSync(path, "test-key\n");
  chmodSync(path, 0o600);
  return path;
}

function emptyMetrics(cpu: number) {
  return {
    uptimeSeconds: 1,
    load1: 0,
    load5: 0,
    load15: 0,
    cpuPercent: cpu,
    memTotalBytes: 1,
    memAvailableBytes: 1,
    diskTotalBytes: 1,
    diskUsedBytes: 1,
    cpuCount: 1,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    procsRunning: 1,
    procsTotal: 1,
    netRxBps: 0,
    netTxBps: 0,
  };
}
