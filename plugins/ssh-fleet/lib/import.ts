import { homedir } from "node:os";
import { t } from "./i18n.ts";
import { assertIdentityPath } from "./identity.ts";
import { assertPort, InputError, normalizeHost } from "./hosts.ts";
import { extractHostStanzas } from "./ssh-config.ts";


export type ImportCandidate = {
  alias: string;
  host: string;
  port: number;
  configUser: string;
  identityPath: string;
  already: boolean;
  error: string | null;
  notice: string;
};

export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
}

export function parseSshG(stdout: string): { hostname: string; port: number; user: string } | null {
  let hostname: string | undefined;
  let port: number | undefined;
  let user = "";
  for (const line of stdout.split("\n")) {
    const splitAt = line.indexOf(" ");
    if (splitAt <= 0) continue;
    const keyword = line.slice(0, splitAt).toLowerCase();
    const value = line.slice(splitAt + 1).trim();
    if (keyword === "hostname") hostname = value;
    if (keyword === "port") port = Number(value);
    if (keyword === "user") user = value;
  }
  if (hostname === undefined || port === undefined || !Number.isInteger(port)) return null;
  return { hostname, port, user };
}

export async function candidatesFromConfig(input: {
  configText: string;
  home: string;
  taken: (host: string, port: number) => boolean;
  resolveG: (alias: string) => Promise<string>;
}): Promise<ImportCandidate[]> {
  const stanzas = extractHostStanzas(input.configText);
  const candidates: ImportCandidate[] = [];
  for (const stanza of stanzas) {
    if (!/^[A-Za-z0-9._-]+$/.test(stanza.alias) || stanza.alias.startsWith("-")) continue;
    const base: ImportCandidate = {
      alias: stanza.alias,
      host: "",
      port: 22,
      configUser: "",
      identityPath: expandHome(stanza.identityFile, input.home),
      already: false,
      error: null,
      notice: t("import.rootNotice"),
    };
    try {
      base.identityPath = assertIdentityPath(base.identityPath);
    } catch (error) {
      base.error = error instanceof Error ? error.message : t("err.keyUnavailable");
      candidates.push(base);
      continue;
    }
    try {
      const parsed = parseSshG(await input.resolveG(stanza.alias));
      if (parsed === null) throw new InputError(t("err.sshG"));
      const host = normalizeHost(parsed.hostname);
      const port = assertPort(parsed.port);
      base.host = host.host;
      base.port = port;
      base.configUser = parsed.user;
      base.already = input.taken(host.host, port);
    } catch (error) {
      base.error = error instanceof Error ? error.message : t("err.hostUnparsed");
    }
    candidates.push(base);
  }
  return candidates;
}

export function defaultHome(): string {
  return homedir();
}
