import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { QuantumHUDWidget, BannerHeader } from "./components";
import { applyLivePatches } from "./patches";
import { activeInvalidators } from "../animations";

let widgetInstance: QuantumHUDWidget | null = null;
let bannerInstance: BannerHeader | null = null;
let activeTuiInstance: any = null;

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

  try {
    ctx.ui.setHeader((tui: any, themeInstance: any) => {
      activeTuiInstance = tui;
      return bannerInstance!;
    });
  } catch (e: any) {
    // setHeader not available in all host versions
  }

  ctx.ui.setWidget("subagent-dashboard", (tui: any, themeInstance: any) => {
    activeTuiInstance = tui;
    applyLivePatches(tui, themeInstance);
    widgetInstance!.setTheme(themeInstance);
    return widgetInstance!;
  }, { placement: "aboveEditor" });
}

export function teardownWidget(ctx: ExtensionContext) {
  try { ctx.ui.setHeader(undefined); } catch {}
  ctx.ui.setWidget("subagent-dashboard", undefined);
  ctx.ui.setWidget("app-mode-indicator", undefined);
  ctx.ui.setStatus("app-mode", undefined);
  activeInvalidators.delete("subagent-dashboard-widget");
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
