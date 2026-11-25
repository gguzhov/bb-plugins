/**
 * The prompt the "Set up with an agent" dialog, `bb ssh-fleet agent-prompt`
 * and the plugin skill all offer. Plain text for any coding agent with a
 * shell on this machine; it names no agent product. Keep the skill's copy in
 * sync: a test compares them.
 */
export const AGENT_PROMPT = `Register my servers in the bb "Servers" plugin (ssh-fleet). You have a shell on my machine; the bb command is available.

Rules for the whole task:
- Never print, echo, log, store or write to a file any password, and never print or read out the contents of a private key. Public keys and file paths are fine.
- Ask me before you change anything on a server, and before you edit ~/.ssh/config. Reading is fine.
- Log in only as root. Do not disable host key checking: when a host is new to this machine, show me its fingerprint and wait until I confirm it.

Steps:
1. Find my servers. Read ~/.ssh/config (Host, HostName, Port, User, IdentityFile) and ask me which of them to add and whether there are others. Run "bb ssh-fleet list" so you skip servers that are already registered, and "bb ssh-fleet group list" to see the groups.
2. After I confirm which servers to add, for each server check that key login as root works:
   ssh -o BatchMode=yes -o IdentitiesOnly=yes -i <private key path> -p <port> root@<host> true
3. Use existing SSH keys on this computer: inspect file names and permissions in ~/.ssh and IdentityFile entries in ~/.ssh/config. Never read private key contents. Match existing keys to the selected hosts; do not guess hosts from key names. Never ask for passwords in chat. If key access fails, report the problem and wait for the owner to arrange access outside chat.
4. Register each server whose key login works:
   bb ssh-fleet add --name <name> --host <host> --key <absolute path to the private key> [--port <port>] [--group <group>] [--hosting <provider>] [--cost <rubles per month>] [--description <what runs there>]
   Create a missing group first with: bb ssh-fleet group add --label <group name>
5. Finish with:
   bb ssh-fleet check --all
   and show me the short result for each server: name, status, and the error if there is one.`;
