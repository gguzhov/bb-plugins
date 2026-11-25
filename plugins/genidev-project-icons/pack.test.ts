// Personal pack tests. They build their own folders; only the last test reads the real
// assets/icons, to be sure no closed icon is shipped with the plugin.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "./server";
import { isNeverAuto, loadPack, NEVER_AUTO, packDirProblem } from "./pack";
import { pluginRoot } from "./bundled";

/** Header-only lossless WebP with a correct RIFF length (same trick as server.test.ts). */
function webp(width = 96, height = 96, tag = 0): Buffer {
  const bits = (width - 1) | ((height - 1) << 14) | (1 << 28);
  const payload = Buffer.alloc(10);
  payload[0] = 0x2f;
  payload.writeUInt32LE(bits >>> 0, 1);
  payload[9] = tag;
  const chunkHeader = Buffer.concat([Buffer.from("VP8L"), Buffer.from([payload.length, 0, 0, 0])]);
  const body = Buffer.concat([Buffer.from("WEBP"), chunkHeader, payload]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "pi-pack-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A folder with icons.json and files. */
function folder(base: string, name: string, files: Record<string, Buffer | string>, entries: unknown): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) writeFileSync(join(dir, file), bytes);
  writeFileSync(join(dir, "icons.json"), typeof entries === "string" ? entries : JSON.stringify(entries));
  return dir;
}

/** A plugin folder whose built-in set holds `ids`. */
function builtinRoot(base: string, ids: string[]): string {
  const root = join(base, "plugin");
  const dir = join(root, "assets", "icons");
  mkdirSync(dir, { recursive: true });
  for (const id of ids) writeFileSync(join(dir, `${id}.webp`), webp());
  writeFileSync(join(dir, "icons.json"), JSON.stringify(ids.map((id) => ({ id, file: `${id}.webp`, name: id }))));
  return root;
}

function packHost(count = 2) {
  const projects = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));
  const made = createFakePluginHost({
    pluginId: "genidev-project-icons",
    sdk: { projects: { list: async () => projects.map((p) => ({ ...p })) as never } },
  });
  return { ...made, projects };
}

const state = async (harness: any) => (await harness.behavior.callRpc("state", null)) as { icons: any[]; projects: any[] };

test("pack: missing folder, empty folder and junk icons.json never break loading", () => {
  const { dir, done } = scratch();
  try {
    const missing = loadPack(join(dir, "nope"));
    assert.deepEqual([missing.found, missing.icons.length, missing.problems], [false, 0, []]);
    mkdirSync(join(dir, "empty"));
    const empty = loadPack(join(dir, "empty"));
    assert.deepEqual([empty.found, empty.icons.length, empty.problems], [false, 0, []]);
    for (const junk of ["not json", "{}", '[{"id": 5}]', "[1,2]"]) {
      const bad = loadPack(folder(dir, "junk", {}, junk));
      assert.equal(bad.icons.length, 0);
      assert.equal(bad.problems.length, 1, junk);
    }
  } finally {
    done();
  }
});

test("pack: bad entries are skipped with reasons, good ones stay", () => {
  const { dir, done } = scratch();
  try {
    const retry = loadPack(
      folder(dir, "pack2", { "ok.webp": webp(), "ok.left.webp": webp(96, 96, 1), "text.webp": "just text", "big.webp": Buffer.concat([webp(), Buffer.alloc(600 * 1024)]) }, [
        { id: "ok", file: "ok.webp", name: "Ok", frames: { left: "ok.left.webp", right: "missing.webp", puzzled: "../outside.webp", wink: "ok.webp" } },
        { id: "gone", file: "gone.webp", name: "Gone" },
        { id: "text", file: "text.webp", name: "Text" },
        { id: "big", file: "big.webp", name: "Big" },
        { id: "custom-x", file: "ok.webp", name: "Reserved" },
        { id: "ok", file: "ok.webp", name: "Twin" },
      ]),
    );
    assert.deepEqual(retry.icons.map((i) => i.id), ["ok"]);
    assert.deepEqual(Object.keys(retry.icons[0].frames), ["left"]);
    assert.equal(retry.skipped, 5);
    const text = retry.problems.join("\n");
    assert.match(text, /ok: frame right: file not found/);
    assert.match(text, /ok: frame puzzled has an invalid file name/);
    assert.match(text, /ok: unknown frame wink/);
    assert.match(text, /gone: file not found/);
    assert.match(text, /text: not a PNG, JPEG or WebP/);
    assert.match(text, /big: not a PNG, JPEG or WebP.*512 KB/);
    assert.match(text, /id custom-x is reserved/);
    assert.match(text, /duplicate id ok/);
  } finally {
    done();
  }
});

test("pack: a symbolic link leading outside the folder is never read", () => {
  const { dir, done } = scratch();
  try {
    const secret = join(dir, "secret.webp");
    writeFileSync(secret, webp());
    const pack = folder(dir, "pack", { "fine.webp": webp() }, [
      { id: "link", file: "link.webp", name: "Link" },
      { id: "framelink", file: "fine.webp", name: "Frame", frames: { left: "flink.webp" } },
      { id: "fine", file: "fine.webp", name: "Fine" },
    ]);
    symlinkSync(secret, join(pack, "link.webp"));
    symlinkSync(secret, join(pack, "flink.webp"));
    const load = loadPack(pack);
    assert.deepEqual(load.icons.map((i) => i.id), ["framelink", "fine"]);
    assert.deepEqual(Object.keys(load.icons[0].frames), [], "frame behind a link is dropped");
    assert.match(load.problems.join("\n"), /link: file points outside the folder/);
    assert.match(load.problems.join("\n"), /framelink: frame left: file points outside the folder/);
    // icons.json itself as a link to a file outside
    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(join(dir, "manifest-out.json"), JSON.stringify([{ id: "x", file: "x.webp", name: "X" }]));
    writeFileSync(join(other, "x.webp"), webp());
    symlinkSync(join(dir, "manifest-out.json"), join(other, "icons.json"));
    const linked = loadPack(other);
    assert.equal(linked.icons.length, 0);
    assert.match(linked.problems.join("\n"), /points outside the folder/);
    // a link that stays inside the folder is fine
    const inner = folder(dir, "inner", { "real.webp": webp() }, [{ id: "in", file: "alias.webp", name: "In" }]);
    symlinkSync(join(inner, "real.webp"), join(inner, "alias.webp"));
    assert.deepEqual(loadPack(inner).icons.map((i) => i.id), ["in"]);
  } finally {
    done();
  }
});

test("pack: icons come after the built-in ones, kind pack, HTTP with frames, no delete, built-in id wins", async () => {
  const { dir, done } = scratch();
  try {
    const root = builtinRoot(dir, ["cat", "dog"]);
    const pack = folder(dir, "pack", { "a.webp": webp(96, 96, 7), "a.left.webp": webp(96, 96, 8), "cat.webp": webp(96, 96, 9), "b.webp": webp(96, 96, 10) }, [
      { id: "a", file: "a.webp", name: "A", frames: { left: "a.left.webp" } },
      { id: "cat", file: "cat.webp", name: "Pack cat" },
      { id: "b", file: "b.webp", name: "B" },
    ]);
    const { bb, harness } = packHost();
    await createPlugin({ root, defaultPackDir: join(dir, "none") })(bb);
    await harness.behavior.setSettings({ packDir: pack });
    await harness.behavior.runCli(["reload-pack"]);
    const first: any = await harness.behavior.callRpc("addIcon", { name: "Mine", data: webp(96, 96, 11).toString("base64") });
    const current = await state(harness);
    assert.deepEqual(current.icons.map((i) => [i.id, i.kind]), [["cat", "builtin"], ["dog", "builtin"], ["a", "pack"], ["b", "pack"], [first.id, "custom"]]);
    assert.deepEqual(Object.keys(current.icons[2].frames), ["left"]);
    assert.equal(current.icons.find((i) => i.id === "cat").name, "cat", "the built-in cat won");
    assert.ok(harness.inspection.logEntries.some((entry) => entry.level === "warn" && /cat: the built-in icon with this id wins/.test(entry.message)));

    const main = await harness.behavior.fetchHttp("GET", "/icon?id=a");
    assert.equal(main.status, 200);
    assert.equal(main.headers.get("content-type"), "image/webp");
    assert.deepEqual(Buffer.from(await main.arrayBuffer()), readFileSync(join(pack, "a.webp")));
    const frame = await harness.behavior.fetchHttp("GET", "/icon?id=a&frame=left");
    assert.deepEqual(Buffer.from(await frame.arrayBuffer()), readFileSync(join(pack, "a.left.webp")));
    assert.equal((await harness.behavior.fetchHttp("GET", "/icon?id=a&frame=right")).status, 404);

    await harness.behavior.callRpc("setIcon", { projectId: "p0", iconId: "a" });
    assert.equal((await state(harness)).projects[0].iconId, "a");
    await assert.rejects(() => harness.behavior.callRpc("removeIcon", { iconId: "a" }), /личного набора/);
    assert.equal((await state(harness)).icons.length, 5);

    const icons = JSON.parse((await harness.behavior.runCli(["icons", "--json"])).stdout);
    assert.deepEqual(icons.map((i: any) => i.kind), ["builtin", "builtin", "pack", "pack", "custom"]);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("pack: reload-pack picks up changes and reports read and skipped", async () => {
  const { dir, done } = scratch();
  try {
    const root = builtinRoot(dir, ["cat"]);
    const def = join(dir, "default-pack");
    const { bb, harness } = packHost();
    await createPlugin({ root, defaultPackDir: def })(bb);
    assert.equal((await state(harness)).icons.length, 1, "no folder, no pack, no error");
    const none = await harness.behavior.runCli(["reload-pack"]);
    assert.equal(none.exitCode, 0);
    assert.match(none.stdout, /not found/);

    folder(dir, "default-pack", { "x.webp": webp(), "y.webp": webp() }, [
      { id: "x", file: "x.webp", name: "X" },
      { id: "y", file: "y.webp", name: "Y" },
      { id: "z", file: "z.webp", name: "Z" },
    ]);
    const out = await harness.behavior.runCli(["reload-pack"]);
    assert.match(out.stdout, /2 read, 1 skipped/);
    assert.match(out.stdout, /- z: file not found/);
    const json = JSON.parse((await harness.behavior.runCli(["reload-pack", "--json"])).stdout);
    assert.deepEqual([json.read, json.skipped, json.found], [2, 1, true]);
    assert.deepEqual((await state(harness)).icons.map((i) => i.id), ["cat", "x", "y"]);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("packDir setting: absolute path works, relative one is refused, empty means the default", async () => {
  const { dir, done } = scratch();
  try {
    const root = builtinRoot(dir, ["cat"]);
    const def = folder(dir, "def", { "d.webp": webp() }, [{ id: "d", file: "d.webp", name: "D" }]);
    const other = folder(dir, "other", { "o.webp": webp() }, [{ id: "o", file: "o.webp", name: "O" }]);
    const { bb, harness } = packHost();
    await createPlugin({ root, defaultPackDir: def })(bb);
    const descriptor: any = (harness.inspection.registrations.settingsDescriptors as any).packDir;
    assert.deepEqual([descriptor.type, descriptor.default, descriptor.label], ["string", "", "Personal icon pack folder"]);
    assert.deepEqual((await state(harness)).icons.map((i) => i.id), ["cat", "d"]);

    await harness.behavior.setSettings({ packDir: other });
    await harness.behavior.runCli(["reload-pack"]);
    assert.deepEqual((await state(harness)).icons.map((i) => i.id), ["cat", "o"]);

    // The schema of the setting refuses a relative path with a clear message.
    const verdict = await descriptor.experimental_schema["~standard"].validate("relative/dir");
    assert.match(JSON.stringify(verdict.issues), /must be an absolute path/);
    assert.equal((await descriptor.experimental_schema["~standard"].validate(other)).issues, undefined);
    assert.equal((await descriptor.experimental_schema["~standard"].validate("")).issues, undefined);
    assert.ok(packDirProblem("a/b"));

    // The host refuses to store a relative path; the old value stays.
    await assert.rejects(() => harness.behavior.setSettings({ packDir: "relative/dir" }), /must be an absolute path/);
    await harness.behavior.runCli(["reload-pack"]);
    assert.deepEqual((await state(harness)).icons.map((i) => i.id), ["cat", "o"]);
    // A relative value that got into storage some other way is refused when read.
    const refused = loadPack("relative/dir");
    assert.deepEqual([refused.icons.length, refused.found], [0, false]);
    assert.match(refused.problems.join(), /must be an absolute path/);

    await harness.behavior.setSettings({ packDir: "" });
    await harness.behavior.runCli(["reload-pack"]);
    assert.deepEqual((await state(harness)).icons.map((i) => i.id), ["cat", "d"]);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("auto icon: leader-, star- and sheikh are never picked, other pack icons are", async () => {
  const { dir, done } = scratch();
  try {
    const root = builtinRoot(dir, ["cat"]);
    const ids = ["leader-a", "star-b", "sheikh", "starfish", "p1", "p2"];
    const files: Record<string, Buffer> = {};
    for (const id of ids) files[`${id}.webp`] = webp();
    const pack = folder(dir, "pack", files, ids.map((id) => ({ id, file: `${id}.webp`, name: id })));
    const { bb, harness, projects } = packHost(1);
    await createPlugin({ root, defaultPackDir: join(dir, "none") })(bb);
    await harness.behavior.setSettings({ packDir: pack });
    await harness.behavior.runCli(["reload-pack"]);
    await state(harness);
    for (let i = 1; i <= 30; i += 1) projects.push({ id: `n${i}`, name: `N${i}` });
    const picked = new Set((await state(harness)).projects.slice(1).map((p) => p.iconId));
    for (const id of picked) assert.ok(["cat", "starfish", "p1", "p2"].includes(id as string), `picked ${id}`);
    assert.ok(picked.has("p1") || picked.has("p2") || picked.has("starfish"), "pack icons take part");
    assert.equal(isNeverAuto("sheikh"), true);
    assert.equal(isNeverAuto("star-x"), true);
    assert.equal(isNeverAuto("leader-x"), true);
    assert.equal(isNeverAuto("sheikh2"), false);
    assert.equal(isNeverAuto("gg-mascot"), false);
    await harness.lifecycle.dispose();
  } finally {
    done();
  }
});

test("the shipped assets/icons hold no closed icon (the only test that reads the real set)", () => {
  const folderPath = join(pluginRoot(), "assets", "icons");
  const manifest = JSON.parse(readFileSync(join(folderPath, "icons.json"), "utf8")) as { id: string; file: string; frames?: Record<string, string> }[];
  const closed = (name: string) => /^(leader-|star-|gg-mascot|sheikh)/.test(name);
  assert.deepEqual(manifest.map((e) => e.id).filter(closed), [], "closed id in icons.json");
  const files = [...manifest.flatMap((e) => [e.file, ...Object.values(e.frames ?? {})]), ...readdirSync(folderPath)];
  assert.deepEqual(files.filter(closed), [], "closed file in assets/icons");
  // the constant used by the code agrees with the list this test guards
  for (const prefix of NEVER_AUTO.prefixes) assert.ok(closed(prefix + "x"));
  for (const id of NEVER_AUTO.ids) assert.ok(closed(id));
});
