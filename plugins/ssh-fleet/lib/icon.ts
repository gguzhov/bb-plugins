import { InputError } from "./hosts.ts";
import { t } from "./i18n.ts";

export const SERVER_ICONS = [
  "Server",
  "Cloud",
  "Database",
  "HardDrive",
  "Cpu",
  "Globe",
  "Box",
  "Ship",
  "Container",
  "Terminal",
  "Wifi",
  "Shield",
  "Monitor",
  "Zap",
] as const;

export type ServerIconName = (typeof SERVER_ICONS)[number];

const MAX_ICON_BYTES = 96 * 1024;

export function assertIconName(name: string): ServerIconName {
  if ((SERVER_ICONS as readonly string[]).includes(name)) return name as ServerIconName;
  throw new InputError(t("err.icon"));
}

export function assertIconImage(dataUrl: string | null): string | null {
  if (dataUrl === null || dataUrl === "") return null;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (match === null) {
    throw new InputError(t("err.iconFormat"));
  }
  const payload = match[2]?.replace(/\s/g, "") ?? "";
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) {
    throw new InputError(t("err.iconFormat"));
  }
  if (!magicMatches(match[1] ?? "", bytes)) {
    throw new InputError(t("err.iconContent"));
  }
  return `data:${match[1]};base64,${payload}`;
}

function magicMatches(mime: string, bytes: Buffer): boolean {
  if (mime === "image/png") {
    return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/gif") return bytes.subarray(0, 3).toString("ascii") === "GIF";
  if (mime === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}
