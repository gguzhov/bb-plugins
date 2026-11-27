// bb-plugin-genidev-ui-tweaks: стили подключаются клиентской частью. Сервер отвечает только за самопроверку правок:
// `bb genidev-ui-tweaks check` просит открытое окно bb проверить якоря (anchors.ts) и печатает результат.
import { PluginCliError, cliCommand, defineCli, defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHECK_CHANNEL, parseReport } from "./check-protocol.ts";
import { createCheckService } from "./check-service.ts";

/** Окно присылает отчёт сюда: по запросу команды и один раз при загрузке. */
export const rpcContract = defineRpcContract({
  report: {
    input: z.object({ report: z.unknown() }),
    output: z.object({ ok: z.boolean() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    hideBurnInMobileHeader: {
      type: "boolean", label: "Hide Burn in the mobile header",
      description: "Hide the Burn header action on screens narrower than 768 pixels.", default: false,
    },
    bentoNewTab: {
      type: "boolean", label: "Bento New tab",
      description: "Show browser, terminal and GitHub tiles when the New tab search is empty.", default: false,
    },
    browserHomeUrl: {
      type: "string", label: "Browser tile start page",
      description: "HTTP or HTTPS page opened when the native browser action is unavailable.", default: "https://www.google.com",
    },
    githubUser: {
      type: "string", label: "GitHub user for the New tab tile",
      description: "Open repositories for a GitHub username, or the GitHub homepage when empty or invalid.", default: "",
    },
    reduceThemeStyleWork: {
      type: "boolean",
      label: "Reduce theme rendering work",
      description: "Skip relational styles from ChatGPT Skin and Beautiful Chat while keeping their palette and other styles.",
      default: false,
    },
  });

  const service = createCheckService((id) => bb.realtime.publish(CHECK_CHANNEL, { id }));

  bb.rpc.register(rpcContract, {
    report: async ({ report }) => {
      const parsed = parseReport(report);
      if (parsed === null) return { ok: false };
      service.report(parsed);
      return { ok: true };
    },
  });

  bb.cli.register(
    defineCli({
      name: "genidev-ui-tweaks",
      summary: "Проверить, что правки интерфейса работают в текущей версии bb",
      description: "После обновления bb запустите `bb genidev-ui-tweaks check`: команда проверит в открытом окне, находятся ли ключевые элементы разметки.",
      commands: {
        check: cliCommand({
          summary: "Показать, какие правки работают, а какие потеряли якорь в разметке bb",
          async run() {
            const result = await service.run();
            if (result.exitCode === 2) throw new PluginCliError(result.text.trim(), { code: "no_window" });
            return { exitCode: result.exitCode, stdout: result.text };
          },
        }),
      },
    }),
  );
}
