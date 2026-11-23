import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const openerSourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    experimental_hostId: z.string().optional(),
  })
  .strict();

export type OpenerSource = z.infer<typeof openerSourceSchema>;

export const rpcContract = defineRpcContract({
  readCsv: {
    input: z
      .object({
        path: z.string().min(1).max(4096),
        source: openerSourceSchema,
      })
      .strict(),
    output: z
      .object({
        content: z.string(),
        sizeBytes: z.number().int().nonnegative(),
      })
      .strict(),
  },
});
