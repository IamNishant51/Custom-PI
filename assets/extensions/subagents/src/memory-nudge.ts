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

let state: NudgeState = { ...EMPTY_STATE };

const MEMORY_NUDGE_INTERVAL = 10;
const SKILL_NUDGE_INTERVAL = 10;

export function initNudgeState(): void {
  state = { ...EMPTY_STATE };
}

export function incrementTurn(): void {
  state.totalTurns++;
  state.turnsSinceMemory++;
  state.turnsSinceSkill++;
}

export function resetMemoryNudge(): void {
  state.turnsSinceMemory = 0;
}

export function resetSkillNudge(): void {
  state.turnsSinceSkill = 0;
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
