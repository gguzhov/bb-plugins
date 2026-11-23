export type HostStanza = {
  alias: string;
  identityFile: string;
};

function stripComment(line: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#") return line.slice(0, index);
  }
  return line;
}

function unquote(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function tokens(line: string): string[] {
  return stripComment(line)
    .trim()
    .split(/[ \t]+/)
    .filter((token) => token !== "")
    .map(unquote);
}

/** Host aliases from the top-level file only. IdentityFile must sit in that same stanza. */
export function extractHostStanzas(text: string): HostStanza[] {
  const found: HostStanza[] = [];
  let aliases: string[] = [];
  let identity: string | null = null;
  let inHost = false;

  const flush = () => {
    if (!inHost || identity === null) {
      aliases = [];
      identity = null;
      inHost = false;
      return;
    }
    for (const alias of aliases) {
      if (alias.includes("*") || alias.includes("?")) continue;
      found.push({ alias, identityFile: identity });
    }
    aliases = [];
    identity = null;
    inHost = false;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = tokens(raw);
    if (line.length === 0) continue;
    const keyword = line[0]?.toLowerCase();
    if (keyword === "host") {
      flush();
      aliases = line.slice(1);
      inHost = true;
      continue;
    }
    if (keyword === "match" || keyword === "include") {
      flush();
      continue;
    }
    if (!inHost) continue;
    if (keyword === "identityfile" && line[1] !== undefined && identity === null) {
      identity = line[1];
    }
  }
  flush();
  return found;
}
