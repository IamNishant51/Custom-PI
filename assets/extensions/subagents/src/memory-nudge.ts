import { getSystemStore, type NudgeState } from "./system-store";

const EMPTY_STATE: NudgeState = {
  turnsSinceMemory: 0,
  turnsSinceSkill: 0,
  totalTurns: 0,
};

let state: NudgeState = loadState();

function loadState(): NudgeState {
  try {
    return { ...EMPTY_STATE, ...getSystemStore().getNudgeState() };
  } catch (err) {
    console.error("[MemoryNudge] Failed to load state:", err);
  }
  return { ...EMPTY_STATE };
}

function saveState(): void {
  try {
    getSystemStore().setNudgeState(state);
  } catch (err) {
    console.error("[MemoryNudge] Failed to save state:", err);
  }
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
