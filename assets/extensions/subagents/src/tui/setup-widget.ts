import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BannerHeader } from "./components";
import { applyLivePatches } from "./patches";

let bannerInstance: BannerHeader | null = null;
let activeTuiInstance: any = null;

export function setupWidget(ctx: ExtensionContext) {
  if (bannerInstance) return;

  bannerInstance = new BannerHeader();

  try {
    (ctx.ui as any).setHeader((tui: any, themeInstance: any) => {
      activeTuiInstance = tui;
      applyLivePatches(tui, themeInstance);
      return bannerInstance!;
    });
  } catch (e: any) {
    // setHeader not available in all host versions
  }
}

export function teardownWidget(ctx: ExtensionContext) {
  try { (ctx.ui as any).setHeader(undefined); } catch {}
  ctx.ui.setWidget("subagent-dashboard", undefined);
  ctx.ui.setWidget("app-mode-indicator", undefined);
  ctx.ui.setStatus("app-mode", undefined);
  if (bannerInstance) {
    bannerInstance.dispose();
    bannerInstance = null;
  }
  activeTuiInstance = null;
}
