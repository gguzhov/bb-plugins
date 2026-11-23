import { BlockList, isIP } from "node:net";
import { t } from "./i18n.ts";

const denied = new BlockList();
denied.addSubnet("127.0.0.0", 8, "ipv4");
denied.addSubnet("169.254.0.0", 16, "ipv4");
denied.addAddress("0.0.0.0", "ipv4");
denied.addAddress("100.100.100.200", "ipv4");
denied.addAddress("::1", "ipv6");
denied.addSubnet("fe80::", 10, "ipv6");
denied.addAddress("fd00:ec2::254", "ipv6");

const METADATA_NAME = "metadata.google.internal";
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export type HostKind = "hostname" | "ipv4" | "ipv6";

export function normalizeHost(raw: string): { host: string; kind: HostKind } {
  if (raw !== raw.trim() || /[\s"'@]/.test(raw) || raw.startsWith("-") || raw.includes("[")) {
    throw new InputError(t("err.host"));
  }
  if ([...raw].some((char) => char.charCodeAt(0) > 127)) {
    throw new InputError(t("err.hostAscii"));
  }
  const lower = raw.toLowerCase();
  if (lower === METADATA_NAME) throw new InputError(t("err.blocked"));
  const kind = isIP(raw);
  if (kind === 4 || kind === 6) {
    if (isDeniedAddress(raw)) throw new InputError(t("err.blocked"));
    return { host: raw, kind: kind === 4 ? "ipv4" : "ipv6" };
  }
  if (!HOSTNAME.test(lower)) throw new InputError(t("err.host"));
  return { host: lower, kind: "hostname" };
}

export function isDeniedAddress(address: string): boolean {
  const mapped = address.toLowerCase().startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : null;
  if (mapped !== null && isIP(mapped) === 4) return isDeniedAddress(mapped);
  const kind = isIP(address);
  if (kind === 0) return true;
  return denied.check(address, kind === 4 ? "ipv4" : "ipv6");
}

export function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InputError(t("err.port"));
  }
  return port;
}
