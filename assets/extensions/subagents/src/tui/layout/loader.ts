import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LayoutConfig, LAYOUT_PRESETS } from "../types";

export function deepMerge(target: LayoutConfig, source: Partial<LayoutConfig>): LayoutConfig {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof LayoutConfig)[]) {
    if (source[key] !== undefined) {
      (result as any)[key] = source[key];
    }
  }
  return result;
}

export function validateLayout(config: LayoutConfig): LayoutConfig {
  const clamped = { ...config };
  clamped.messageSeparation = Math.max(0, Math.min(4, clamped.messageSeparation));
  clamped.messagePaddingTop = Math.max(0, Math.min(4, clamped.messagePaddingTop));
  clamped.messagePaddingBottom = Math.max(0, Math.min(4, clamped.messagePaddingBottom));
  clamped.containerPaddingLeft = Math.max(0, Math.min(8, clamped.containerPaddingLeft));
  clamped.containerPaddingRight = Math.max(0, Math.min(8, clamped.containerPaddingRight));
  clamped.inputAreaHeight = Math.max(1, Math.min(8, clamped.inputAreaHeight));
  clamped.agentCardMaxOutputLines = Math.max(0, Math.min(20, clamped.agentCardMaxOutputLines));
  return clamped;
}

export function loadLayoutFromFile(filePath: string): Partial<LayoutConfig> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const cleaned = content
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return JSON.parse(cleaned) as Partial<LayoutConfig>;
  } catch {
    return null;
  }
}

export async function loadLayout(name: string): Promise<LayoutConfig> {
  const defaults = LAYOUT_PRESETS[name] || LAYOUT_PRESETS.default;
  let config = deepMerge(LAYOUT_PRESETS.default, defaults);

  const searchPaths = [
    path.join(os.homedir(), ".pi", "agent", "layout", `${name}.jsonc`),
    path.join(os.homedir(), ".pi", "agent", "layout", `default.jsonc`),
    path.join(process.cwd(), ".pi", "layout.jsonc"),
  ];

  for (const filePath of searchPaths) {
    const parsed = loadLayoutFromFile(filePath);
    if (parsed) {
      config = deepMerge(config, parsed);
    }
  }

  return validateLayout(config);
}

export function listLayoutNames(): string[] {
  return Object.keys(LAYOUT_PRESETS);
}
