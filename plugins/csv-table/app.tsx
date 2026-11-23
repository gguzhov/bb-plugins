import { useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useRpc,
  type PluginFileOpenerProps,
  type PluginFileOpenerSource,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { parseCsv } from "./csv";
import { CsvTable } from "./csv-table";
import { Button } from "@/components/ui/button";
import { TOUCH_HEIGHT } from "./csv-table";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; content: string; sizeBytes: number }
  | { status: "error"; message: string };

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.split("/").pop();
  return base && base.length > 0 ? base : path;
}

function openerSource(source: PluginFileOpenerSource) {
  return {
    kind: source.kind,
    threadId: source.threadId,
    environmentId: source.environmentId,
    projectId: source.projectId,
    ...(source.experimental_hostId === undefined
      ? {}
      : { experimental_hostId: source.experimental_hostId }),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return "Could not read this CSV file.";
}

function CsvFileOpener({
  path,
  source,
  experimental_lineRange,
  Original,
}: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  const sourceInput = useMemo(
    () => openerSource(source),
    [
      source.environmentId,
      source.experimental_hostId,
      source.kind,
      source.projectId,
      source.threadId,
    ],
  );
  const [reloadNonce, setReloadNonce] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    setShowOriginal(false);
  }, [path, sourceInput]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    rpc
      .call("readCsv", { path, source: sourceInput })
      .then((result) => {
        if (!cancelled) {
          setState({
            status: "ready",
            content: result.content,
            sizeBytes: result.sizeBytes,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, reloadNonce, rpc, sourceInput]);

  if (showOriginal) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
        <div className="flex justify-end border-b border-border px-2 py-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TOUCH_HEIGHT}
            onClick={() => setShowOriginal(false)}
          >
            Show table
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <Original />
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-label={`Loading ${fileName(path)}`}
      >
        <Icon name="Spinner" className="size-4 animate-spin" />
        Loading CSV…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center" role="alert">
          <p className="text-sm text-destructive">{state.message}</p>
          <div className="flex justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={TOUCH_HEIGHT}
              onClick={() => setReloadNonce((nonce) => nonce + 1)}
            >
              Retry
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={TOUCH_HEIGHT}
              onClick={() => setShowOriginal(true)}
            >
              Built-in preview
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <CsvTable
        key={`${state.sizeBytes}:${fingerprint(state.content)}`}
        parsed={parseCsv(state.content)}
        fileName={fileName(path)}
        lineRange={experimental_lineRange ?? null}
        toolbarExtra={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TOUCH_HEIGHT}
            onClick={() => setShowOriginal(true)}
          >
            Built-in preview
          </Button>
        }
      />
    </div>
  );
}

function fingerprint(content: string): string {
  let hash = 5381;
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(index)) | 0;
  }
  return String(hash);
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "csv-table",
    title: "CSV table",
    extensions: ["csv"],
    component: CsvFileOpener,
  });
});
