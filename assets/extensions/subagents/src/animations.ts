import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
export const DOT_PULSE = ["◐", "◓", "◑", "◒"];
export const PROGRESS_SPINNER = ["◐", "◓", "◑", "◒"];
export const BOUNCING_BAR = ["◐", "◓", "◑", "◒"];

function loadVerbs(): string[] {
  const env = process.env.PI_STATUS_VERBS;
  if (env) return env.split(",").map(v => v.trim()).filter(Boolean);
  const filePath = process.env.PI_VERBS_FILE || path.join(os.homedir(), ".pi", "agent", "verbs.json");
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
    }
  } catch {}
  return [
    "Cooking", "Brewing", "Baking", "Roasting", "Sautéing",
    "Thinking", "Dreaming", "Musing", "Pondering", "Ruminating",
    "Crafting", "Forging", "Sculpting", "Weaving", "Knitting",
    "Decoding", "Cracking", "Solving", "Unraveling", "Untangling",
    "Mixing", "Blending", "Whisking", "Kneading", "Drizzling",
    "Booping", "Beaming", "Frolicking", "Moonwalking", "Jitterbugging",
    "Churning", "Brewing", "Fermenting", "Marinating", "Caramelizing",
    "Orchestrating", "Conducting", "Composing", "Harmonizing", "Grooving",
    "Foraging", "Noodling", "Meandering", "Moseying", "Gallivanting",
    "Illuminating", "Enchanting", "Concocting", "Hatching", "Germinating",
    "Catalyzing", "Nucleating", "Crystallizing", "Coalescing", "Manifesting",
    "Flummoxing", "Befuddling", "Discombobulating", "Flibbertigibbeting", "Boondoggling",
    "Hullaballooing", "Canoodling", "Dilly-dallying", "Lollygagging", "Fiddle-faddling",
  ];
}

export const STATUS_VERBS = loadVerbs();

let globalFrame = 0;
let globalVerbIndex = 0;
let globalAnimTimer: ReturnType<typeof setInterval> | null = null;

export const activeTrackers = new Map<string, any>();
export const activeInvalidators = new Map<string, () => void>();

export function startGlobalAnimation() {
  if (globalAnimTimer) return;
  globalAnimTimer = setInterval(() => {
    if (activeTrackers.size === 0) return;
    globalFrame = (globalFrame + 1) % (SPINNER_FRAMES.length * DOT_PULSE.length * BOUNCING_BAR.length);
    if (globalFrame % 10 === 0) {
      globalVerbIndex = (globalVerbIndex + 1) % STATUS_VERBS.length;
    }
    for (const invalidate of activeInvalidators.values()) {
      try { invalidate(); } catch {}
    }
  }, 80);
}

export function stopGlobalAnimation() {
  if (globalAnimTimer) {
    clearInterval(globalAnimTimer);
    globalAnimTimer = null;
  }
}

export function getSpinner(): string { return SPINNER_FRAMES[globalFrame % SPINNER_FRAMES.length]; }
export function getDotPulse(): string { return DOT_PULSE[globalFrame % DOT_PULSE.length]; }
export function getProgressSpinner(): string { return PROGRESS_SPINNER[globalFrame % PROGRESS_SPINNER.length]; }
export function getBouncingBar(): string { return BOUNCING_BAR[globalFrame % BOUNCING_BAR.length]; }
export function getStatusVerb(): string { return STATUS_VERBS[globalVerbIndex % STATUS_VERBS.length]; }
export function getGlobalFrame(): number { return globalFrame; }
export function getGlobalVerbIndex(): number { return globalVerbIndex; }
