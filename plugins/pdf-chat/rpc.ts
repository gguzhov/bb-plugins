import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const fileInput = z
  .object({
    path: z.string().min(1),
    kind: z.enum(["host", "workspace", "thread-storage"]),
    environmentId: z.string().nullable(),
    threadId: z.string().nullable(),
  })
  .strict();

const ok = z.object({ ok: z.literal(true) }).strict();

export const pdfChatRpcContract = defineRpcContract({
  revealInFinder: { input: fileInput, output: ok },
  openInDefaultApp: { input: fileInput, output: ok },
});
