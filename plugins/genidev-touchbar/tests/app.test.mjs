import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appStatus, formatStatus, isAppAgent, plistVersion, pluginRoot, runScript, scriptCommand, scriptPath, shellQuote,
} from "../lib/app.ts";

test("pluginRoot finds the folder with package.json and native/ from dist/server.js", () => {
  const root = mkdtempSync(join(tmpdir(), "nb-root-"));
  mkdirSync(join(root, "native"));
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "package.json"), "{}");
  assert.equal(pluginRoot(pathToFileURL(join(root, "dist", "server.js")).href), root);
  assert.equal(pluginRoot(pathToFileURL(join(root, "server.ts")).href), root);
});

test("script command is an absolute, quoted path to native/<script>.sh", () => {
  assert.equal(scriptPath("/a/b", "install"), "/a/b/native/install.sh");
  assert.equal(scriptCommand("/a/b", "uninstall"), "/bin/bash /a/b/native/uninstall.sh");
  assert.equal(shellQuote("/Volumes/My Disk/it's"), `'/Volumes/My Disk/it'\\''s'`);
  assert.equal(scriptCommand("/x y", "install"), "/bin/bash '/x y/native/install.sh'");
});

test("plistVersion reads CFBundleShortVersionString", () => {
  const t = "<dict>\n  <key>CFBundleShortVersionString</key><string>0.2.0</string>\n</dict>";
  assert.equal(plistVersion(t), "0.2.0");
  assert.equal(plistVersion("<dict></dict>"), null);
});

test("runScript passes the path as an argument, returns code and output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nb run $(x) "));
  const p = join(dir, "s.sh");
  writeFileSync(p, 'echo "ran $0"; echo oops >&2; exit 3\n');
  chmodSync(p, 0o644); // not executable: bash runs it anyway
  const r = await runScript(p);
  assert.equal(r.code, 3);
  assert.match(r.output, /ran .*s\.sh/);
  assert.match(r.output, /oops/);
  assert.equal(r.timedOut, false);
  const slow = join(dir, "slow.sh");
  writeFileSync(slow, "sleep 5\n");
  const t = await runScript(slow, 200);
  assert.equal(t.timedOut, true);
});

test("status of an empty home: nothing installed, said plainly", async () => {
  const home = mkdtempSync(join(tmpdir(), "nb-home-"));
  const s = await appStatus(null, home);
  assert.equal(s.appInstalled, false);
  assert.equal(s.agentInstalled, false);
  assert.equal(s.appVersion, null);
  const text = formatStatus({ ...s, platform: "darwin", pids: [], agentLoaded: false }, "0.2.0", 0, "/p");
  assert.match(text, /App: not installed/);
  assert.match(text, /Process: not running/);
  assert.match(text, /has not read the snapshot/);
  assert.match(text, /\/bin\/bash \/p\/native\/install\.sh/);
});

test("status with the app: version, process and last read", async () => {
  const home = mkdtempSync(join(tmpdir(), "nb-home-"));
  const app = join(home, "Applications", "BBTouchbar.app", "Contents");
  mkdirSync(join(app, "MacOS"), { recursive: true });
  writeFileSync(join(app, "MacOS", "BBTouchbar"), "");
  writeFileSync(join(app, "Info.plist"), "<key>CFBundleShortVersionString</key><string>0.2.0</string>");
  const s = await appStatus(1000, home);
  assert.equal(s.appInstalled, true);
  assert.equal(s.appVersion, "0.2.0");
  const text = formatStatus({ ...s, platform: "darwin", pids: [42], agentLoaded: true, agentInstalled: true }, "0.2.0", 6000, "/p");
  assert.match(text, /installed at .*version 0\.2\.0 \(plugin 0\.2\.0\)/);
  assert.match(text, /LaunchAgent installed, loaded/);
  assert.match(text, /running \(pid 42\)/);
  assert.match(text, /read the snapshot 5 s ago/);
  assert.equal(/[А-Яа-яЁё]/.test(text), false);
});

test("other platforms: macOS only", () => {
  const text = formatStatus({ platform: "linux", appPath: "", appInstalled: false, appVersion: null, agentPath: "",
    agentInstalled: false, agentLoaded: null, pids: [], lastPollAt: null }, "0.2.0", 0, "/p");
  assert.match(text, /macOS only/);
});

test("only the app's User-Agent counts as the app reading the snapshot", () => {
  assert.equal(isAppAgent("BBTouchbar/0.2.0 CFNetwork/3826.500.131 Darwin/25.6.0"), true);
  assert.equal(isAppAgent("curl/8.7.1"), false);
  assert.equal(isAppAgent(undefined), false);
});
