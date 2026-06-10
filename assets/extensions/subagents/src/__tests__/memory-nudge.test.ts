import { describe, it, expect, beforeEach } from "vitest";
import { resetSystemStore } from "../system-store";
import {
  initNudgeState,
  incrementTurn,
  shouldNudgeMemory,
  shouldNudgeSkill,
  resetMemoryNudge,
  resetSkillNudge,
  getNudgeState,
  getNudgeConfig,
} from "../memory-nudge";

describe("memory-nudge", () => {
  beforeEach(() => {
    resetSystemStore();
    initNudgeState();
  });

  it("starts at zero", () => {
    const state = getNudgeState();
    expect(state.turnsSinceMemory).toBe(0);
    expect(state.turnsSinceSkill).toBe(0);
    expect(state.totalTurns).toBe(0);
  });

  it("incrementTurn increases all counters", () => {
    incrementTurn();
    const state = getNudgeState();
    expect(state.turnsSinceMemory).toBe(1);
    expect(state.turnsSinceSkill).toBe(1);
    expect(state.totalTurns).toBe(1);
  });

  it("shouldNudgeMemory returns false initially", () => {
    expect(shouldNudgeMemory()).toBe(false);
  });

  it("shouldNudgeMemory returns true after enough turns", () => {
    for (let i = 0; i < 10; i++) incrementTurn();
    expect(shouldNudgeMemory()).toBe(true);
  });

  it("shouldNudgeSkill returns true after enough turns", () => {
    for (let i = 0; i < 10; i++) incrementTurn();
    expect(shouldNudgeSkill()).toBe(true);
  });

  it("resetMemoryNudge resets only memory counter", () => {
    for (let i = 0; i < 5; i++) incrementTurn();
    resetMemoryNudge();
    const state = getNudgeState();
    expect(state.turnsSinceMemory).toBe(0);
    expect(state.turnsSinceSkill).toBe(5);
  });

  it("resetSkillNudge resets only skill counter", () => {
    for (let i = 0; i < 5; i++) incrementTurn();
    resetSkillNudge();
    const state = getNudgeState();
    expect(state.turnsSinceSkill).toBe(0);
    expect(state.turnsSinceMemory).toBe(5);
  });

  it("getNudgeConfig returns intervals", () => {
    const config = getNudgeConfig();
    expect(config).toHaveProperty("memoryInterval");
    expect(config).toHaveProperty("skillInterval");
    expect(config.memoryInterval).toBeGreaterThan(0);
    expect(config.skillInterval).toBeGreaterThan(0);
  });
});
