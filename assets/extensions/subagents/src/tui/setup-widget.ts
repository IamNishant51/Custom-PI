import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { QuantumHUDWidget, BannerHeader } from "./components";
import { applyLivePatches } from "./patches";
import { activeInvalidators } from "../animations";

let widgetInstance: QuantumHUDWidget | null = null;
let bannerInstance: BannerHeader | null = null;
let activeTuiInstance: any = null;
let bannerTimer: ReturnType<typeof setInterval> | null = null;

export function setupWidget(ctx: ExtensionContext) {
  if (widgetInstance) return;

  widgetInstance = new QuantumHUDWidget();
  bannerInstance = new BannerHeader();

  const key = "subagent-dashboard-widget";
  const invalidator = () => {
    if (activeTuiInstance) {
      activeTuiInstance.requestRender();
    }
  };
  activeInvalidators.set(key, invalidator);

  ctx.ui.setHeader((tui: any, themeInstance: any) => {
    activeTuiInstance = tui;
    return bannerInstance!;
  });

  if (!bannerTimer) {
    bannerTimer = setInterval(() => {
      bannerInstance?.tick();
      activeTuiInstance?.requestRender();
    }, 50);
  }

  ctx.ui.setWidget("subagent-dashboard", (tui: any, themeInstance: any) => {
    activeTuiInstance = tui;
    applyLivePatches(tui, themeInstance);
    widgetInstance!.setTheme(themeInstance);
    return widgetInstance!;
  }, { placement: "aboveEditor" });
}

export function teardownWidget(ctx: ExtensionContext) {
  ctx.ui.setHeader(undefined);
  ctx.ui.setWidget("subagent-dashboard", undefined);
  ctx.ui.setWidget("app-mode-indicator", undefined);
  ctx.ui.setStatus("app-mode", undefined);
  activeInvalidators.delete("subagent-dashboard-widget");
  if (bannerTimer) {
    clearInterval(bannerTimer);
    bannerTimer = null;
  }
  if (bannerInstance) {
    bannerInstance.dispose();
    bannerInstance = null;
  }
  if (widgetInstance) {
    widgetInstance.dispose();
    widgetInstance = null;
  }
  activeTuiInstance = null;
}
