import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountMobileHomeComposerContent } from "./mobile-home-composer-content";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "compact-home-composer",
    mount({ signal }) {
      return mountMobileHomeComposerContent(signal);
    },
  });
});