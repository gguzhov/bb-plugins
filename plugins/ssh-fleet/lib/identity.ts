import { realpathSync, statSync } from "node:fs";
import { t } from "./i18n.ts";
import { basename } from "node:path";
import { InputError } from "./hosts.ts";

const FORBIDDEN = new Set(["known_hosts", "config"]);

/** Confirm the path is a private key file. Does not read its contents. */
export function assertIdentityPath(input: string): string {
  if (!input.startsWith("/") || input.includes("\0") || /[\r\n]/.test(input)) {
    throw new InputError(t("err.keyAbsolute"));
  }
  let resolved: string;
  try {
    resolved = realpathSync(input);
  } catch {
    throw new InputError(t("err.keyMissing"));
  }
  const info = statSync(resolved);
  if (!info.isFile()) throw new InputError(t("err.keyNotFile"));
  const name = basename(resolved);
  if (name.endsWith(".pub") || FORBIDDEN.has(name)) {
    throw new InputError(t("err.keyPublic"));
  }
  const mode = info.mode & 0o777;
  if (mode !== 0o600 && mode !== 0o400) {
    throw new InputError(t("err.keyMode"));
  }
  return resolved;
}
