import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface NudgeState {
  turnsSinceMemory: number;
  turnsSinceSkill: number;
  totalTurns: number;
}

const EMPTY_STATE: NudgeState = {
  turnsSinceMemory: 0,
  turnsSinceSkill: 0,
  totalTurns: 0,
};

const STATE_FILE = path.join(os.homedir(), ".pi", "agent", "nudge-state.json");

let state: NudgeState = loadState();

function loadState(): NudgeState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) };
    }
  } catch {}
  return { ...EMPTY_STATE };
}

function saveState(): void {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
  } catch {}
}

const MEMORY_NUDGE_INTERVAL = 10;
const SKILL_NUDGE_INTERVAL = 10;

export function initNudgeState(): void {
  state = { ...EMPTY_STATE };
  saveState();
}

export function incrementTurn(): void {
  state.totalTurns++;
  state.turnsSinceMemory++;
  state.turnsSinceSkill++;
  saveState();
}

export function resetMemoryNudge(): void {
  state.turnsSinceMemory = 0;
  saveState();
}

export function resetSkillNudge(): void {
  state.turnsSinceSkill = 0;
  saveState();
}

export function shouldNudgeMemory(): boolean {
  return state.turnsSinceMemory >= MEMORY_NUDGE_INTERVAL;
}

export function shouldNudgeSkill(): boolean {
  return state.turnsSinceSkill >= SKILL_NUDGE_INTERVAL;
}

export function getNudgeState(): Readonly<NudgeState> {
  return state;
}

export function getNudgeConfig(): { memoryInterval: number; skillInterval: number } {
  return { memoryInterval: MEMORY_NUDGE_INTERVAL, skillInterval: SKILL_NUDGE_INTERVAL };
}
