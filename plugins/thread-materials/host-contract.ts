import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const counts = z.object({ added: z.number(), removed: z.number(), files: z.number() });
export const gitChangesSchema = z.discriminatedUnion("kind", [
 z.object({ kind: z.literal("ok"), branch: z.string(), base: z.enum(["upstream", "merge-base", "head"]), baseRef: z.string().nullable(), added: z.number(), removed: z.number(), files: z.number(), uncommitted: counts, unpushedCommits: z.number(), truncated: z.boolean(), recentCommits: z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{4,64}$/), subject: z.string().max(240) })).max(20).optional(), elapsedMs: z.number(), top: z.array(z.object({ path: z.string(), added: z.number().nullable(), removed: z.number().nullable() })).optional() }),
 z.object({ kind: z.literal("not-git") }),
 z.object({ kind: z.literal("error"), message: z.string() }),
]);

export const hostContract = defineRpcContract({
 gitChanges: {
  input: z.object({ path: z.string().min(1).max(4096) }).strict(),
  output: gitChangesSchema,
  experimental_retryable: true,
 },
});
