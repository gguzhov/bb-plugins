// The notch app on this Mac: where its install scripts are, whether it is installed and running.
// Facts only: files, the LaunchAgent, the process list and the last time the app polled the plugin.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_LABEL = "app.gguzhov.bb-touchbar";
export const APP_NAME = "BBTouchbar";
export const APP_PROCESS = "BBTouchbar.app/Contents/MacOS/BBTouchbar";
export const SCRIPT_TIMEOUT_MS = 10 * 60_000;

export type AppScript = "install" | "uninstall";

/** The plugin folder: server.ts runs from it, dist/server.js one level below. */
export function pluginRoot(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let step = 0; step < 4; step += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "native"))) return dir;
    dir = dirname(dir);
  }
  return dirname(fileURLToPath(fromUrl));
}

/** The notch app's requests carry "BBTouchbar/<version> CFNetwork/…" as User-Agent. */
export function isAppAgent(ua: string | undefined | null): boolean {
  return typeof ua === "string" && /^BBTouchbar\//.test(ua);
}

export function scriptPath(root: string, which: AppScript): string {
  return join(root, "native", `${which}.sh`);
}

/** Single-quoted for a POSIX shell, so a path with spaces or quotes pastes as one argument. */
export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function scriptCommand(root: string, which: AppScript): string {
  return `/bin/bash ${shellQuote(scriptPath(root, which))}`;
}

export const SCRIPT_ABOUT: Record<AppScript, string[]> = {
  install: [
    "The script builds BBTouchbar.app from the Swift sources with swiftc (needs Xcode Command Line Tools, about a minute),",
    "copies it to ~/Applications/BBTouchbar.app, writes the bb path to ~/Library/Application Support/bb-touchbar/config.json,",
    `installs the LaunchAgent ~/Library/LaunchAgents/${APP_LABEL}.plist (start at login) and starts the app.`,
    "The build goes to native/build when the plugin folder is writable, else to a temporary folder. Safe to run again.",
  ],
  uninstall: [
    "The script stops the app, removes the LaunchAgent, ~/Applications/BBTouchbar.app and config.json.",
    "It keeps the log (~/Library/Logs/bb-touchbar.log) and your own mascot pictures",
    "(~/Library/Application Support/bb-touchbar/mascot). The bb plugin itself stays: remove it with `bb plugin remove genidev-touchbar`.",
  ],
};

export interface RunResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

/** Runs a script with /bin/bash, no shell parsing of the path, with a timeout. */
export function runScript(path: string, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      "/bin/bash",
      [path],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string }) | null;
        const timedOut = !!err && err.killed === true && err.signal === "SIGTERM";
        const code = err === null ? 0 : typeof err.code === "number" ? err.code : null;
        resolve({ code, output: [stdout, stderr].filter((s) => s.trim() !== "").join("\n").trimEnd(), timedOut });
      },
    );
  });
}

function capture(file: string, args: string[], timeoutMs = 5000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout) => {
      const e = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
      resolve({ code: e === null ? 0 : typeof e.code === "number" ? e.code : -1, out: String(stdout) });
    });
  });
}

/** CFBundleShortVersionString from an Info.plist text; null when absent. */
export function plistVersion(text: string): string | null {
  const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]{1,40})<\/string>/.exec(text);
  return m ? m[1] : null;
}

export interface AppStatus {
  platform: string;
  appPath: string;
  appInstalled: boolean;
  appVersion: string | null;
  agentPath: string;
  agentInstalled: boolean;
  agentLoaded: boolean | null;
  pids: number[];
  /** Last time the app read the snapshot from this plugin (ms), null = not since the plugin started. */
  lastPollAt: number | null;
}

export async function appStatus(lastPollAt: number | null, home = homedir()): Promise<AppStatus> {
  const appPath = join(home, "Applications", `${APP_NAME}.app`);
  const agentPath = join(home, "Library", "LaunchAgents", `${APP_LABEL}.plist`);
  const status: AppStatus = {
    platform: process.platform,
    appPath,
    appInstalled: existsSync(join(appPath, "Contents", "MacOS", APP_NAME)),
    appVersion: null,
    agentPath,
    agentInstalled: existsSync(agentPath),
    agentLoaded: null,
    pids: [],
    lastPollAt,
  };
  if (status.appInstalled) {
    try {
      status.appVersion = plistVersion(readFileSync(join(appPath, "Contents", "Info.plist"), "utf8"));
    } catch {
      status.appVersion = null;
    }
  }
  if (process.platform !== "darwin") return status;
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null) {
    const r = await capture("/bin/launchctl", ["print", `gui/${uid}/${APP_LABEL}`]);
    status.agentLoaded = r.code === 0;
  }
  const p = await capture("/usr/bin/pgrep", ["-f", APP_PROCESS]);
  status.pids = p.out
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return status;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export function formatStatus(s: AppStatus, pluginVersion: string, now: number, root: string): string {
  const lines: string[] = [];
  if (s.platform !== "darwin") {
    lines.push(`The notch app runs on macOS only; this bb server runs on ${s.platform}.`);
    return lines.join("\n");
  }
  lines.push(
    s.appInstalled
      ? `App: installed at ${s.appPath}, version ${s.appVersion ?? "unknown"} (plugin ${pluginVersion})`
      : `App: not installed (${s.appPath} is missing)`,
  );
  lines.push(
    `Start at login: ${s.agentInstalled ? "LaunchAgent installed" : "no LaunchAgent"}` +
      (s.agentLoaded === null ? "" : s.agentLoaded ? ", loaded" : ", not loaded"),
  );
  lines.push(s.pids.length > 0 ? `Process: running (pid ${s.pids.join(", ")})` : "Process: not running");
  lines.push(
    s.lastPollAt !== null
      ? `Plugin link: the app read the snapshot ${ago(now - s.lastPollAt)}`
      : "Plugin link: the app has not read the snapshot since the plugin started",
  );
  if (!s.appInstalled) lines.push(`Install it: ${scriptCommand(root, "install")}  (or: bb genidev-touchbar install-app --run)`);
  return lines.join("\n");
}
