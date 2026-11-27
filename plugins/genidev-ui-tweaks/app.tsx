import "./styles/new-tab.css";
import { installBentoNewTab } from "./new-tab";
// bb-plugin-genidev-ui-tweaks: набор стилевых правок интерфейса. Каждая правка лежит в своём
// файле styles/*.css, сборка (bb plugin build) склеивает их в один dist/app.css.
import "./styles/pin-icon.css";
import "./styles/panel-motion.css";
import "./styles/header-order.css";
import "./styles/panel-close.css";
import "./styles/message-nav.css";
import "./styles/header-actions.css";
import "./styles/header-collapse.css";
import "./styles/panel-bar.css";
import "./styles/header-touch.css";
import "./styles/third-party-fixes.css";
import { useEffect } from "react";
import { definePluginApp, useBbNavigate, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { installCloseOnChat } from "./close-on-chat";
import { installThemePerformance } from "./theme-performance";
import { installHeaderLabels } from "./header-labels";
import { runAnchors } from "./anchors";
import { CHECK_CHANNEL } from "./check-protocol";
import type { rpcContract } from "./server";

type Disposer = () => void;
const KEY = "__genidevUiTweaksCloseOnChat";
const LABELS_KEY = "__genidevUiTweaksHeaderLabels";

/** Стили подключаются импортами выше; компонент ставит один слушатель «нажатие на чат закрывает панель»
    и снимает его при выгрузке плагина (reload не задваивает слушатель). */
function GenidevUiTweaksStyles() {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const settings = useSettings().values;
  const reduceThemeStyleWork = settings?.reduceThemeStyleWork === true;
  const hideBurn = settings?.hideBurnInMobileHeader === true;
  const bento = settings?.bentoNewTab === true;
  const github = settings?.githubUser;
  useEffect(() => {
    document.documentElement.classList.toggle("genidev-hide-mobile-burn", hideBurn);
    return () => document.documentElement.classList.remove("genidev-hide-mobile-burn");
  }, [hideBurn]);
  useEffect(() => {
    const holder = window as unknown as Record<string, Disposer | undefined>;
    const key = "__genidevUiTweaksNewTab";
    holder[key]?.();
    if (!bento) return;
    const dispose = installBentoNewTab(document, github, url => navigate.openUrl(url));
    holder[key] = dispose;
    return () => { dispose(); if (holder[key] === dispose) delete holder[key]; };
  }, [bento, github, navigate]);
  useEffect(() => reduceThemeStyleWork ? installThemePerformance(document) : undefined, [reduceThemeStyleWork]);
  // Самопроверка якорей: по запросу `bb genidev-ui-tweaks check` и один раз после загрузки. Без наблюдателей и опросов.
  const send = (id: string | null) => {
    rpc.call("report", { report: { id, results: runAnchors(document) } }).catch(() => {});
  };
  useRealtime(CHECK_CHANNEL, (payload) => {
    const id = typeof payload === "object" && payload !== null ? (payload as { id?: unknown }).id : null;
    if (typeof id === "string") send(id);
  });
  useEffect(() => {
    const once = window.setTimeout(() => send(null), 5000);
    return () => window.clearTimeout(once);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const holder = window as unknown as Record<string, Disposer | undefined>;
    holder[KEY]?.();
    const dispose = installCloseOnChat(document);
    holder[KEY] = dispose;
    return () => {
      dispose();
      if (holder[KEY] === dispose) delete holder[KEY];
    };
  }, []);
  useEffect(() => {
    const holder = window as unknown as Record<string, Disposer | undefined>;
    holder[LABELS_KEY]?.();
    const dispose = installHeaderLabels(document);
    holder[LABELS_KEY] = dispose;
    return () => {
      dispose();
      if (holder[LABELS_KEY] === dispose) delete holder[LABELS_KEY];
    };
  }, []);
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "genidev-ui-tweaks-styles", component: GenidevUiTweaksStyles });
});
