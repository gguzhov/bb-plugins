import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./host-contract";
import { gitChanges } from "./git-stats";

export default experimental_defineHostEntry({
 contract: hostContract,
 handlers: {
  // Read-only git on the environment's machine, bounded to 10 s.
  gitChanges: async ({ path }) => {
   if (!path.startsWith("/") || path.split("/").includes("..") || /[\x00-\x1f]/.test(path)) return { kind: "error" as const, message: "Invalid path" };
   try { return await gitChanges(path, { timeoutMs: 10000 }); }
   catch (error) { return { kind: "error" as const, message: error instanceof Error ? error.message : String(error) }; }
  },
 },
});
