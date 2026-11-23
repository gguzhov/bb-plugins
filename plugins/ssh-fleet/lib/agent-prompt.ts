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
2. For each server, check that key login as root works:
   ssh -o BatchMode=yes -o IdentitiesOnly=yes -i <private key path> -p <port> root@<host> true
3. If it does not work and I give you the root password, set up a dedicated key with the plugin itself, so the password goes only from stdin to ssh and is never stored:
   bb ssh-fleet add --name <name> --host <host> [--port <port>] --password-stdin [--group <group>] [--ssh-config]
   Feed the password on stdin from where I keep it (for example a password manager command piped into bb); never put it in a command line argument, a file or your messages. If you cannot pass it that way, ask me to add the server myself with the root password option in the add-server form of the Servers page. The first run prints the server's host key fingerprint and stops: show it to me, and after I confirm, run the same command again with --host-key <fingerprint>. The plugin creates the key in ~/.ssh, installs it for root and checks that it logs in.
4. Register each server whose key login works:
   bb ssh-fleet add --name <name> --host <host> --key <absolute path to the private key> [--port <port>] [--group <group>] [--hosting <provider>] [--cost <rubles per month>] [--description <what runs there>]
   Create a missing group first with: bb ssh-fleet group add --label <group name>
5. Finish with:
   bb ssh-fleet check --all
   and show me the short result for each server: name, status, and the error if there is one.`;
