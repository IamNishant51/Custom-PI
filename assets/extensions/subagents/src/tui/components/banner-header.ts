import { appMode } from "../../runtime/agent-state";
import { getActiveSession, getFooterData, formatCwdForFooter } from "../patches";
import { stripAnsi, measureWidth } from "../render/format";

function rightAlign(left: string, right: string, width: number): string {
  const leftVisible = measureWidth(stripAnsi(left));
  const rightVisible = measureWidth(stripAnsi(right));
  const spaces = Math.max(1, width - leftVisible - rightVisible);
  return left + " ".repeat(spaces) + right;
}

export class BannerHeader {
  private _disposed = false;

  render(width: number): string[] {
    if (this._disposed) return [];

    const session = getActiveSession();
    const footerData = getFooterData();
    const modelName = session?.state?.model?.id || "gemma-4-e4b";

    const version = "v1.11.0";
    const mode = appMode;
    const modeColour = mode === "agent" ? "\x1b[32m" : "\x1b[33m";

    const leftText = `\x1b[2mcustom-pi\x1b[0m  \x1b[2m${version}\x1b[0m  ·  \x1b[36m${modelName}\x1b[0m  ·  ${modeColour}${mode} mode\x1b[0m`;

    let rightText = "";
    if (session) {
      const rawCwd = session.sessionManager?.getCwd() || "";
      const pwd = formatCwdForFooter(rawCwd, process.env.HOME || process.env.USERPROFILE);
      const branch = footerData?.getGitBranch() || "";
      rightText = `\x1b[2m${pwd}${branch ? ` (${branch})` : ""}\x1b[0m`;
    }

    const headerLine = rightText ? rightAlign(leftText, rightText, width) : leftText;
    const separator = `\x1b[2m${"─".repeat(width)}\x1b[0m`;

    return [headerLine, separator];
  }

  invalidate(): void {}
  dispose(): void {
    this._disposed = true;
  }
}
