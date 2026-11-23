import path from "node:path";

export type FinderFileSource = {
  kind: "host" | "workspace" | "thread-storage";
  path: string;
  environmentPath: string | null;
  threadId: string | null;
};

function assertInside(root: string, resolved: string): string {
  const base = path.resolve(root);
  const full = path.resolve(resolved);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (full !== base && !full.startsWith(prefix)) {
    throw new Error("Invalid path.");
  }
  return full;
}

export function resolveAbsolutePath(
  input: FinderFileSource,
  homeDir: string,
): string {
  const filePath = input.path.trim();
  if (!filePath) throw new Error("Missing file path.");
  if (input.kind === "host") {
    if (!path.isAbsolute(filePath)) {
      throw new Error("Host files must use an absolute path.");
    }
    return path.resolve(filePath);
  }
  if (input.kind === "workspace") {
    if (!input.environmentPath) {
      throw new Error("This workspace has no local folder on this Mac.");
    }
    return assertInside(
      input.environmentPath,
      path.join(input.environmentPath, filePath.replace(/^\/+/u, "")),
    );
  }
  if (!input.threadId) throw new Error("Missing thread for this file.");
  const root = path.join(homeDir, ".bb", "thread-storage", input.threadId);
  return assertInside(root, path.join(root, filePath.replace(/^\/+/u, "")));
}

export function revealCommand(
  platform: NodeJS.Platform,
  absPath: string,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: ["-R", absPath] };
  if (platform === "win32") {
    return { command: "explorer", args: ["/select,", absPath] };
  }
  return { command: "xdg-open", args: [path.dirname(absPath)] };
}

export function openCommand(
  platform: NodeJS.Platform,
  absPath: string,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [absPath] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", absPath] };
  return { command: "xdg-open", args: [absPath] };
}
