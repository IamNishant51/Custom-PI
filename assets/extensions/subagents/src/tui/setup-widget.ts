import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { QuantumHUDWidget } from "./components";
import { applyLivePatches } from "./patches";
import { activeInvalidators } from "../animations";

let widgetInstance: QuantumHUDWidget | null = null;
let activeTuiInstance: any = null;

export function setupWidget(ctx: ExtensionContext) {
  if (widgetInstance) return;

  widgetInstance = new QuantumHUDWidget();

  const key = "subagent-dashboard-widget";
  const invalidator = () => {
    if (activeTuiInstance) {
      activeTuiInstance.requestRender();
    }
  };
  activeInvalidators.set(key, invalidator);

  ctx.ui.setWidget("subagent-dashboard", (tui: any, themeInstance: any) => {
    activeTuiInstance = tui;
    applyLivePatches(tui, themeInstance);
    widgetInstance!.setTheme(themeInstance);
    return widgetInstance!;
  }, { placement: "aboveEditor" });
}

export function teardownWidget(ctx: ExtensionContext) {
  ctx.ui.setWidget("subagent-dashboard", undefined);
  ctx.ui.setWidget("app-mode-indicator", undefined);
  ctx.ui.setStatus("app-mode", undefined);
  activeInvalidators.delete("subagent-dashboard-widget");
  if (widgetInstance) {
    widgetInstance.dispose();
    widgetInstance = null;
  }
  activeTuiInstance = null;
}
