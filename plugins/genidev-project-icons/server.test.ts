// Server tests. They never read assets/icons: every test builds its own icon
// folder from the fixtures below, so replacing the shipped set cannot break them.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin, MIGRATIONS } from "./server";
import { checkImage, imageSize, sniffImage } from "./image";
import { loadBundledIcons } from "./bundled";
import { findCwebp, readImageFile } from "./import-file";

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A real RGBA PNG; `alpha` sets the transparency of every pixel. */
function png(width: number, height: number, alpha = 0x80): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const pixel = Buffer.from([0x40, 0x90, 0xe0, alpha]);
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => pixel))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Header-only lossless WebP (VP8L) with a correct RIFF length: enough for the byte checks. */
function webp(width: number, height: number): Buffer {
  const bits = (width - 1) | ((height - 1) << 14) | (1 << 28); // alpha_is_used
  const payload = Buffer.alloc(10); // header + a few bytes: files under 30 bytes are not read
  payload[0] = 0x2f;
  payload.writeUInt32LE(bits >>> 0, 1);
  const chunkHeader = Buffer.concat([Buffer.from("VP8L"), Buffer.from([payload.length, 0, 0, 0])]);
  const body = Buffer.concat([Buffer.from("WEBP"), chunkHeader, payload, Buffer.alloc(payload.length % 2)]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
}

interface Entry {
  id: string;
  file: string;
  name: string;
  frames?: Record<string, unknown>;
  group?: string;
}

/** A plugin folder with assets/icons built from `files` and `entries`. */
function fixture(files: Record<string, Buffer | string>, entries: Entry[]): { root: string; done(): void } {
  const root = mkdtempSync(join(tmpdir(), "pi-fixture-"));
  const folder = join(root, "assets", "icons");
  mkdirSync(folder, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(folder, name), bytes);
  writeFileSync(join(folder, "icons.json"), JSON.stringify(entries));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Two icons; «cat» has all three frames, «dog» has none. */
function standardFixture() {
  return fixture(
    {
      "cat.png": png(96, 96),
      "cat.left.png": png(96, 96, 0x10),
      "cat.right.png": png(96, 96, 0x20),
      "cat.puzzled.webp": webp(96, 96),
      "dog.webp": webp(96, 96),
    },
    [
      { id: "cat", file: "cat.png", name: "Кот", frames: { left: "cat.left.png", right: "cat.right.png", puzzled: "cat.puzzled.webp" } },
      { id: "dog", file: "dog.webp", name: "Пёс", group: "старое поле, игнорируется" },
    ],
  );
}

/** Pack folder that does not exist: tests never read the real personal pack. */
const NO_PACK = join(tmpdir(), "pi-no-such-pack");

function host() {
  return createFakePluginHost({
    pluginId: "genidev-project-icons",
    sdk: { projects: { list: async () => [{ id: "p1", name: "Demo" }, { id: "p2", name: "Other" }] as never } },
  });
}

test("image checks go by bytes, not by name; WebP must be whole", () => {
  assert.equal(sniffImage(png(4, 4)), "image/png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(webp(10, 10)), "image/webp");
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.deepEqual(imageSize(png(300, 200), "image/png"), { width: 300, height: 200 });
  assert.deepEqual(imageSize(webp(96, 80), "image/webp"), { width: 96, height: 80 });
  const svg = checkImage(Buffer.from('<?xml version="1.0"?><svg/>'));
  assert.equal(svg.ok, false);
  assert.match(svg.ok ? "" : svg.message, /SVG/);
  assert.equal(checkImage(Buffer.from("not an image at all")).ok, false);
  assert.equal(checkImage(png(600, 10)).ok, false);
  assert.equal(checkImage(png(96, 96)).ok, true);
  // WebP: magic bytes, RIFF length equal to the file length, readable size.
  const good = checkImage(webp(96, 96));
  assert.deepEqual(good.ok && good.mime, "image/webp");
  const cut = webp(96, 96).subarray(0, 24);
  assert.match(checkImage(cut).ok ? "" : (checkImage(cut) as { message: string }).message, /повреждён/);
  assert.equal(checkImage(Buffer.concat([webp(96, 96), Buffer.alloc(8)])).ok, false);
  assert.equal(checkImage(webp(600, 96)).ok, false);
});

test("manifest: frames present, missing, broken; group ignored", () => {
  const { root, done } = fixture(
    {
      "a.png": png(96, 96),
      "a.left.png": png(96, 96),
      "a.puzzled.webp": "<svg/>", // broken frame
      "b.png": png(96, 96),
      "fake.png": "<svg/>",
    },
    [
      { id: "one", file: "a.png", name: "Один", group: "Пиксельные", frames: { left: "a.left.png", puzzled: "a.puzzled.webp", wink: "a.png", right: "../a.png" } },
      { id: "two", file: "b.png", name: "Два" },
      { id: "fake", file: "fake.png", name: "Подделка" },
      { id: "custom-x", file: "a.png", name: "Чужой префикс" },
      { id: "missing", file: "nope.png", name: "Нет файла" },
      { id: "three", file: "b.png", name: "Три", frames: { left: "nope.png" } },
    ],
  );
  try {
    const loaded = loadBundledIcons(root);
    assert.deepEqual(loaded.icons.map((icon) => icon.id), ["one", "two", "three"]);
    const one = loaded.icons[0];
    assert.deepEqual(Object.keys(one.frames), ["left"], "only the good frame stays");
    assert.equal("group" in one, false);
    assert.deepEqual(loaded.icons[1].frames, {});
    assert.deepEqual(loaded.icons[2].frames, {}, "missing frame file: icon stays, frame skipped");
    const text = loaded.problems.join("\n");
    assert.match(text, /one: frame puzzled/);
    assert.match(text, /one: unknown frame wink/);
    assert.match(text, /one: frame right has an invalid file name/);
    assert.match(text, /three: frame left: file not found/);
    assert.equal(loaded.problems.length, 7);
  } finally {
    done();
  }
});

test("broken frames are logged on load and the icon stays in the library", async () => {
  const { root, done } = fixture({ "a.png": png(96, 96), "bad.webp": "RIFFxxxxWEBPjunk" }, [
    { id: "one", file: "a.png", name: "Один", frames: { puzzled: "bad.webp" } },
  ]);
  try {
    const { bb, harness } = host();
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    const state: any = await harness.behavior.callRpc("state", null);
    assert.deepEqual(state.icons.map((icon: any) => [icon.id, icon.frames]), [["one", {}]]);
    assert.ok(harness.inspection.logEntries.some((entry) => entry.level === "warn" && /frame puzzled/.test(entry.message)));
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("animation setting is declared, on by default", async () => {
  const { root, done } = standardFixture();
  try {
    const { bb, harness } = host();
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    const descriptor: any = (harness.inspection.registrations.settingsDescriptors as any).animation;
    assert.equal(descriptor.type, "boolean");
    assert.equal(descriptor.default, true);
    assert.equal(descriptor.label, "Icon animation");
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("RPC: one ordered library, select, validate, add, remove, persist", async () => {
  const { root, done } = standardFixture();
  try {
    const plugin = createPlugin({ root, defaultPackDir: NO_PACK });
    let { bb, harness } = host();
    await plugin(bb);
    const state: any = await harness.behavior.callRpc("state", null);
    assert.deepEqual(state.icons.map((icon: any) => icon.id), ["cat", "dog"]);
    const cat = state.icons[0];
    assert.deepEqual(Object.keys(cat.frames).sort(), ["left", "puzzled", "right"]);
    assert.match(cat.frames.left, /id=cat&frame=left&v=[0-9a-f]{16}$/);
    assert.deepEqual(state.icons[1].frames, {});
    assert.equal("group" in cat, false);
    assert.deepEqual(state.projects.map((p: any) => p.iconId), [null, null]);

    await harness.behavior.callRpc("setIcon", { projectId: "p1", iconId: "cat" });
    await assert.rejects(() => harness.behavior.callRpc("setIcon", { projectId: "missing", iconId: "cat" }));
    await assert.rejects(() => harness.behavior.callRpc("setIcon", { projectId: "p1", iconId: "no-such-icon" }));
    await assert.rejects(() => harness.behavior.callRpc("setIcon", { projectId: "p1", iconId: "../etc/passwd" }));

    await assert.rejects(() => harness.behavior.callRpc("addIcon", { name: "svg", data: Buffer.from("<svg/>").toString("base64") }));
    await assert.rejects(() => harness.behavior.callRpc("addIcon", { name: "big", data: png(600, 600).toString("base64") }));
    // What the picker sends: base64 of a 96×96 WebP (or PNG when the browser cannot write WebP).
    const first: any = await harness.behavior.callRpc("addIcon", { name: "Первая", data: webp(96, 96).toString("base64") });
    const second: any = await harness.behavior.callRpc("addIcon", { name: "Вторая", data: png(96, 96).toString("base64") });
    assert.match(first.id, /^custom-[0-9a-f]{12}$/);
    assert.deepEqual(first.frames, {});
    await assert.rejects(() => harness.behavior.callRpc("addIcon", { name: "cut", data: webp(96, 96).subarray(0, 20).toString("base64") }));
    await harness.behavior.callRpc("setIcon", { projectId: "p2", iconId: first.id });

    harness = (await harness.lifecycle.reload(plugin)).harness;
    let after: any = await harness.behavior.callRpc("state", null);
    assert.deepEqual(after.icons.map((icon: any) => icon.id), ["cat", "dog", first.id, second.id], "bundled, then custom in order added");
    assert.deepEqual(after.projects.map((p: any) => p.iconId), ["cat", first.id]);

    const custom = await harness.behavior.fetchHttp("GET", `/icon?id=${first.id}`);
    assert.equal(custom.headers.get("content-type"), "image/webp");
    const old = await harness.behavior.fetchHttp("GET", `/icon?id=${second.id}`);
    assert.equal(old.headers.get("content-type"), "image/png", "stored PNG pictures keep working");

    const removed: any = await harness.behavior.callRpc("removeIcon", { iconId: first.id });
    assert.equal(removed.unassigned, 1);
    await harness.behavior.callRpc("removeIcon", { iconId: second.id });
    await assert.rejects(() => harness.behavior.callRpc("removeIcon", { iconId: "cat" }));
    after = await harness.behavior.callRpc("state", null);
    assert.deepEqual(after.projects.map((p: any) => p.iconId), ["cat", null]);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("HTTP: main pictures and frames only for library ids and known frame names", async () => {
  const { root, done } = standardFixture();
  try {
    const { bb, harness } = host();
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    const ok = await harness.behavior.fetchHttp("GET", "/icon?id=cat");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.match(ok.headers.get("cache-control") ?? "", /max-age/);

    const frames: [string, number, string | null][] = [];
    for (const frame of ["left", "right", "puzzled"]) {
      const response = await harness.behavior.fetchHttp("GET", `/icon?id=cat&frame=${frame}`);
      frames.push([frame, response.status, response.headers.get("content-type")]);
    }
    assert.deepEqual(frames, [
      ["left", 200, "image/png"],
      ["right", 200, "image/png"],
      ["puzzled", 200, "image/webp"],
    ]);
    const left = Buffer.from(await (await harness.behavior.fetchHttp("GET", "/icon?id=cat&frame=left")).arrayBuffer());
    const main = Buffer.from(await (await harness.behavior.fetchHttp("GET", "/icon?id=cat")).arrayBuffer());
    assert.notDeepEqual(left, main, "a frame is its own file");

    const refused: Record<string, number> = {};
    for (const query of [
      "?id=",
      "",
      "?id=..%2F..%2Fpackage.json",
      "?id=nope",
      "?id=custom-000000000000",
      "?id=cat&frame=wink",
      "?id=cat&frame=",
      "?id=cat&frame=..%2Fcat.png",
      "?id=cat&frame=../left",
      "?id=dog&frame=left",
      "?id=nope&frame=left",
    ]) {
      refused[query] = (await harness.behavior.fetchHttp("GET", `/icon${query}`)).status;
    }
    for (const [query, status] of Object.entries(refused)) assert.ok(status === 400 || status === 404, `${query} -> ${status}`);
    assert.equal(refused["?id=cat&frame=wink"], 400);
    assert.equal(refused["?id=dog&frame=left"], 404);

    // A custom picture has no frames.
    const added: any = await harness.behavior.callRpc("addIcon", { name: "x", data: webp(96, 96).toString("base64") });
    assert.equal((await harness.behavior.fetchHttp("GET", `/icon?id=${added.id}&frame=left`)).status, 404);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("CLI: list, icons with frames, set, add, remove", async () => {
  const { root, done } = standardFixture();
  const dir = mkdtempSync(join(tmpdir(), "pi-cli-"));
  try {
    const { bb, harness } = host();
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    writeFileSync(join(dir, "wide.png"), png(300, 200));
    writeFileSync(join(dir, "fake.png"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    const icons = JSON.parse((await harness.behavior.runCli(["icons", "--json"])).stdout);
    assert.deepEqual(icons.map((icon: any) => [icon.id, icon.frames]), [["cat", ["left", "right", "puzzled"]], ["dog", []]]);
    assert.equal((await harness.behavior.runCli(["set", "p1", "cat"])).exitCode, 0);
    const list = JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout);
    assert.equal(list[0].iconId, "cat");

    const added = await harness.behavior.runCli(["add", "wide.png", "--name", "Широкая", "--json"], { cwd: dir } as never);
    assert.equal(added.exitCode, 0, added.stderr);
    const icon = JSON.parse(added.stdout);
    const fake = await harness.behavior.runCli(["add", join(dir, "fake.png"), "--name", "x"]);
    assert.notEqual(fake.exitCode, 0);
    assert.match(fake.stderr, /SVG/);

    assert.equal((await harness.behavior.runCli(["set", "p2", icon.id])).exitCode, 0);
    const removed = await harness.behavior.runCli(["remove", icon.id, "--json"]);
    assert.equal(JSON.parse(removed.stdout).unassigned, 1);
    assert.equal((await harness.behavior.runCli(["set", "p1", "none"])).exitCode, 0);
    assert.ok(!removed.stdout.includes(dir), "no file paths in output");
    await harness.lifecycle.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    done();
  }
});

test("add: big JPEG becomes a 96×96 WebP with cwebp, a PNG without it", { skip: process.platform !== "darwin" && "needs sips (macOS)" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-jpeg-"));
  try {
    writeFileSync(join(dir, "big.png"), png(2000, 2000, 0xff));
    execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", join(dir, "big.png"), "--out", join(dir, "big.jpg")], { stdio: "ignore" });
    const source = readFileSync(join(dir, "big.jpg"));
    assert.equal(sniffImage(source), "image/jpeg");
    assert.deepEqual(imageSize(source, "image/jpeg"), { width: 2000, height: 2000 });

    const withoutCwebp = await readImageFile(join(dir, "big.jpg"), undefined, { findCwebp: async () => null });
    const png96 = checkImage(withoutCwebp);
    assert.ok(png96.ok);
    assert.equal(png96.mime, "image/png");
    assert.deepEqual(png96.size, { width: 96, height: 96 });

    if (await findCwebp()) {
      const converted = await readImageFile(join(dir, "big.jpg"), undefined);
      const webp96 = checkImage(converted);
      assert.ok(webp96.ok);
      assert.equal(webp96.mime, "image/webp");
      assert.deepEqual(webp96.size, { width: 96, height: 96 });
      assert.ok(converted.length < withoutCwebp.length, `webp ${converted.length} < png ${withoutCwebp.length}`);
    }
    // A cwebp that fails leaves the PNG in place.
    const broken = await readImageFile(join(dir, "big.jpg"), undefined, { findCwebp: async () => "/usr/bin/false" });
    assert.equal(sniffImage(broken), "image/png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findCwebp looks in PATH and the Homebrew folders", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-bin-"));
  try {
    writeFileSync(join(dir, "cwebp"), "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(await findCwebp(dir), join(dir, "cwebp"));
    const fallback = await findCwebp("relative/dir");
    assert.ok(fallback === null || /^\/(opt\/homebrew|usr\/local)\/bin\/cwebp$/.test(fallback));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("assignment moment: stored on set, refreshed on re-set, 0 for rows saved before it existed", async () => {
  const { root, done } = standardFixture();
  try {
    const { bb, harness } = host();
    // The schema as it was in 0.2.0, with one assignment saved then.
    const handle = bb.storage.database();
    bb.storage.migrate(handle, MIGRATIONS.slice(0, 2));
    handle.prepare("INSERT INTO project_icons (project_id, icon_id) VALUES ('p2', 'dog')").run();
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);

    let state: any = await harness.behavior.callRpc("state", null);
    assert.deepEqual(state.projects.map((p: any) => [p.iconId, p.assignedAt]), [[null, 0], ["dog", 0]], "old assignment reads with moment 0");

    const before = Date.now();
    await harness.behavior.callRpc("setIcon", { projectId: "p1", iconId: "cat" });
    state = await harness.behavior.callRpc("state", null);
    const first = state.projects[0].assignedAt;
    assert.ok(first >= before && first <= Date.now(), "moment of the call");
    assert.equal(state.projects[1].assignedAt, 0, "other projects keep theirs");

    await new Promise((resolve) => setTimeout(resolve, 5));
    await harness.behavior.callRpc("setIcon", { projectId: "p1", iconId: "dog" });
    state = await harness.behavior.callRpc("state", null);
    assert.ok(state.projects[0].assignedAt > first, "assigning again moves the moment");

    await harness.behavior.callRpc("setIcon", { projectId: "p1", iconId: null });
    state = await harness.behavior.callRpc("state", null);
    assert.deepEqual([state.projects[0].iconId, state.projects[0].assignedAt], [null, 0]);

    const list = JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout);
    assert.deepEqual(Object.keys(list[0]), ["id", "name", "iconId", "iconName"], "list output is unchanged");
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("frames alert and happy: in the manifest, over RPC and over HTTP; a missing one stays missing", async () => {
  const { root, done } = fixture(
    {
      "fox.png": png(96, 96),
      "fox.alert.png": png(96, 96, 0x30),
      "fox.happy.webp": webp(96, 96),
      "owl.png": png(96, 96),
      "owl.alert.png": png(96, 96, 0x31),
      "owl.left.png": png(96, 96, 0x11),
      "bad.png": png(96, 96),
      "bad.happy.webp": "<svg/>",
    },
    [
      { id: "fox", file: "fox.png", name: "Лис", frames: { alert: "fox.alert.png", happy: "fox.happy.webp" } },
      { id: "owl", file: "owl.png", name: "Сова", frames: { alert: "owl.alert.png", left: "owl.left.png", happy: "nope.webp" } },
      { id: "bad", file: "bad.png", name: "Битая", frames: { happy: "bad.happy.webp" } },
    ],
  );
  try {
    const loaded = loadBundledIcons(root);
    assert.deepEqual(Object.keys(loaded.icons[0].frames).sort(), ["alert", "happy"]);
    assert.deepEqual(Object.keys(loaded.icons[1].frames).sort(), ["alert", "left"], "missing happy file is skipped");
    assert.deepEqual(loaded.icons[2].frames, {}, "broken happy frame is skipped");

    const { bb, harness } = host();
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    const state: any = await harness.behavior.callRpc("state", null);
    const [fox, owl, bad] = state.icons;
    assert.deepEqual(Object.keys(fox.frames).sort(), ["alert", "happy"]);
    assert.match(fox.frames.alert, /id=fox&frame=alert&v=[0-9a-f]{16}$/);
    assert.match(fox.frames.happy, /id=fox&frame=happy&v=[0-9a-f]{16}$/);
    assert.equal(owl.frames.happy, undefined);
    assert.deepEqual(bad.frames, {});

    const alert = await harness.behavior.fetchHttp("GET", "/icon?id=fox&frame=alert");
    const happy = await harness.behavior.fetchHttp("GET", "/icon?id=fox&frame=happy");
    assert.deepEqual([alert.status, alert.headers.get("content-type")], [200, "image/png"]);
    assert.deepEqual([happy.status, happy.headers.get("content-type")], [200, "image/webp"]);
    const main = Buffer.from(await (await harness.behavior.fetchHttp("GET", "/icon?id=fox")).arrayBuffer());
    assert.notDeepEqual(Buffer.from(await alert.arrayBuffer()), main, "the alert frame is its own file");
    assert.equal((await harness.behavior.fetchHttp("GET", "/icon?id=owl&frame=happy")).status, 404);
    assert.equal((await harness.behavior.fetchHttp("GET", "/icon?id=fox&frame=scared")).status, 400);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

// ---- 0.3.1: icon for a new project ----

/** Library of `names` (ids = names) plus a mutable project list. */
function autoFixture(ids: string[]) {
  const files: Record<string, Buffer> = {};
  for (const id of ids) files[`${id}.png`] = png(96, 96);
  return fixture(files, ids.map((id) => ({ id, file: `${id}.png`, name: id })));
}

function autoHost(initial: string[]) {
  const projects = initial.map((id) => ({ id, name: `Проект ${id}` }));
  const made = createFakePluginHost({
    pluginId: "genidev-project-icons",
    sdk: { projects: { list: async () => projects.map((p) => ({ ...p })) as never } },
  });
  return { ...made, projects };
}

const projectsOf = async (harness: any): Promise<any[]> => ((await harness.behavior.callRpc("state", null)) as any).projects;

test("auto icon: projects that exist on the first run are known and get nothing", async () => {
  const { root, done } = autoFixture(["a", "b", "c"]);
  try {
    const { bb, harness } = autoHost(["p1", "p2"]);
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    assert.deepEqual((await projectsOf(harness)).map((p) => [p.iconId, p.auto]), [[null, false], [null, false]]);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: a new project gets a free icon, two new ones get different icons, log has ids only", async () => {
  const { root, done } = autoFixture(["a", "b", "c", "d"]);
  try {
    const plugin = createPlugin({ root, defaultPackDir: NO_PACK });
    const { bb, harness, projects } = autoHost(["p1"]);
    await plugin(bb);
    await harness.behavior.callRpc("setIcon", { projectId: "p1", iconId: "a" });
    projects.push({ id: "p2", name: "Секретное имя" }, { id: "p3", name: "Другое имя" });
    const state = await projectsOf(harness);
    const [p1, p2, p3] = state;
    assert.deepEqual([p1.iconId, p1.auto], ["a", false]);
    assert.ok(p2.iconId && p3.iconId && p2.iconId !== p3.iconId);
    assert.ok(![p2.iconId, p3.iconId].includes("a"), "the icon of another project is not taken");
    assert.deepEqual([p2.auto, p3.auto], [true, true]);
    assert.ok(p2.assignedAt > 0);
    const lines = harness.inspection.logEntries.filter((entry) => /auto icon: project/.test(entry.message));
    assert.equal(lines.length, 2);
    assert.ok(lines.every((entry) => !/имя/.test(entry.message)));
    // same answer on the next request, nothing new is assigned
    assert.deepEqual((await projectsOf(harness)).map((p) => p.iconId), state.map((p) => p.iconId));
    // a manual choice clears the "auto" mark
    await harness.behavior.callRpc("setIcon", { projectId: "p2", iconId: "d" });
    assert.deepEqual((await projectsOf(harness))[1].auto, false);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: a thread event nudges the comparison", async () => {
  const { root, done } = autoFixture(["a", "b"]);
  try {
    const { bb, harness, projects } = autoHost(["p1"]);
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    await projectsOf(harness);
    projects.push({ id: "p2", name: "Новый" });
    await harness.behavior.emitThreadEvent("thread.created", { thread: { id: "t1", projectId: "p2" } } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const row: any = (await projectsOf(harness)).find((p) => p.id === "p2");
    assert.equal(row.auto, true);
    assert.ok(harness.inspection.logEntries.some((entry) => /project p2, icon/.test(entry.message)));
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: an icon the owner removed does not come back, also after a reload", async () => {
  const { root, done } = autoFixture(["a", "b", "c"]);
  try {
    const plugin = createPlugin({ root, defaultPackDir: NO_PACK });
    let { bb, harness, projects } = autoHost(["p1"]);
    await plugin(bb);
    await projectsOf(harness);
    projects.push({ id: "p2", name: "Новый" });
    assert.equal(((await projectsOf(harness)) as any[])[1].auto, true);
    await harness.behavior.callRpc("setIcon", { projectId: "p2", iconId: null });
    assert.equal(((await projectsOf(harness)) as any[])[1].iconId, null);
    harness = (await harness.lifecycle.reload(plugin)).harness;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(((await projectsOf(harness)) as any[])[1], { id: "p2", name: "Новый", iconId: null, assignedAt: 0, auto: false });
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: leader- icons are never picked; when nothing is free an icon repeats", async () => {
  const { root, done } = autoFixture(["leader-x", "leader-y", "a", "b"]);
  try {
    const { bb, harness, projects } = autoHost(["p0"]);
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    await projectsOf(harness);
    for (let i = 1; i <= 12; i += 1) projects.push({ id: `n${i}`, name: `N${i}` });
    const state = await projectsOf(harness);
    const icons = state.slice(1).map((p) => p.iconId);
    assert.ok(icons.every((id) => id === "a" || id === "b"), `got ${icons.join()}`);
    assert.ok(icons.every((id) => !!id), "repeat allowed when all are used");
    assert.deepEqual(new Set(icons.slice(0, 2)).size, 2, "the first two take the two free icons");
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: setting declared, on by default; when off new projects are only remembered", async () => {
  const { root, done } = autoFixture(["a", "b"]);
  try {
    const plugin = createPlugin({ root, defaultPackDir: NO_PACK });
    let { bb, harness, projects } = autoHost(["p1"]);
    await plugin(bb);
    const descriptor: any = (harness.inspection.registrations.settingsDescriptors as any).autoAssign;
    assert.deepEqual([descriptor.type, descriptor.default, descriptor.label], ["boolean", true, "Give new projects an icon"]);
    await projectsOf(harness);
    await harness.behavior.setSettings({ autoAssign: false });
    projects.push({ id: "p2", name: "Новый" });
    assert.equal(((await projectsOf(harness)) as any[])[1].iconId, null);
    await harness.behavior.setSettings({ autoAssign: true });
    assert.equal(((await projectsOf(harness)) as any[])[1].iconId, null, "no backdated icon");
    projects.push({ id: "p3", name: "Ещё" });
    assert.equal(((await projectsOf(harness)) as any[])[2].auto, true, "a project created after turning it on gets one");
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: an empty library does not break the plugin", async () => {
  const { root, done } = fixture({}, []);
  try {
    const { bb, harness, projects } = autoHost(["p1"]);
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    await projectsOf(harness);
    projects.push({ id: "p2", name: "Новый" });
    assert.deepEqual((await projectsOf(harness)).map((p) => p.iconId), [null, null]);
    assert.equal(harness.inspection.logEntries.filter((entry) => entry.level === "warn" && /auto icon/.test(entry.message)).length, 0);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: CLI list marks automatic icons", async () => {
  const { root, done } = autoFixture(["a"]);
  try {
    const { bb, harness, projects } = autoHost(["p1"]);
    await createPlugin({ root, defaultPackDir: NO_PACK })(bb);
    await projectsOf(harness);
    projects.push({ id: "p2", name: "Новый" });
    const json = JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout);
    assert.deepEqual(json.map((p: any) => p.auto ?? false), [false, true]);
    assert.match((await harness.behavior.runCli(["list"])).stdout, /Новый \(p2\): a \(a\) \(auto\)/);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});
