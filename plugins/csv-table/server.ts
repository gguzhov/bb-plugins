import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { readCsvFile } from "./open-target";

export type { rpcContract } from "./contract";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  bb.rpc.register(rpcContract, {
    async readCsv(input) {
      return readCsvFile(
        input.source,
        input.path,
        {
          environment: (environmentId) =>
            bb.sdk.environments.get({ environmentId }),
          project: (projectId) => bb.sdk.projects.get({ projectId }),
          primaryHostId: async () =>
            (await bb.sdk.system.config()).primaryHostId,
          threadStorage: (threadId) =>
            bb.sdk.threads.storageLocation({ threadId }),
        },
        (args) => bb.sdk.files.read(args),
      );
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
