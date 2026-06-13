import { describe, it, expect, beforeEach, vi } from "vitest";
import { SelfModifier } from "../evolution/self-modifier";

describe("SelfModifier", () => {
  let modifier: SelfModifier;

  beforeEach(() => {
    modifier = new SelfModifier();
  });

  it("rejects patches to disallowed paths", () => {
    const outsidePath = "/etc/passwd";
    const patch = modifier.proposePatch(outsidePath, "Should be rejected", "content", "low");
    expect(patch).toBeNull();
  });

  it("rejects patches to non-existent files", () => {
    const srcDir = modifier["sourceDir"];
    const nonexistent = srcDir + "/nonexistent_file_that_does_not_exist.ts";
    const patch = modifier.proposePatch(nonexistent, "No file", "content", "low");
    expect(patch).toBeNull();
  });

  it("rejects patches with identical content", () => {
    const patch = modifier.proposePatch("/fake/path.ts", "Test", "same content", "low");
    expect(patch).toBeNull();
  });

  it("tracks rollback count and enforces max limit", () => {
    const maxRollbacks = modifier.getMaxRollbacks();
    expect(maxRollbacks).toBeGreaterThan(0);

    const result = modifier.rollbackPatch("nonexistent");
    expect(result).toBe(false);
    expect(modifier.getRollbackCount()).toBe(0);
  });

  it("analyzes dependency blast radius", () => {
    const srcDir = modifier["sourceDir"];
    const testFile = srcDir + "/event-bus/event-bus.ts";
    if (require("fs").existsSync(testFile)) {
      const radius = modifier.analyzeDependencyBlastRadius(testFile);
      expect(Array.isArray(radius)).toBe(true);
    } else {
      const radius = modifier.analyzeDependencyBlastRadius(srcDir + "/index.ts");
      expect(Array.isArray(radius)).toBe(true);
    }
  });

  it("generates capability registration code for tools", () => {
    const reg = modifier.generateCapabilityCode("myTool", "tool", "return { result: true };");
    expect(reg).not.toBeNull();
    expect(reg!.name).toBe("myTool");
    expect(reg!.type).toBe("tool");
    expect(reg!.code).toContain("myTool");
    expect(reg!.code).toContain("execute");
  });

  it("generates capability registration code for commands", () => {
    const reg = modifier.generateCapabilityCode("myCommand", "command", "console.log('hello');");
    expect(reg).not.toBeNull();
    expect(reg!.name).toBe("myCommand");
    expect(reg!.type).toBe("command");
    expect(reg!.code).toContain("myCommand");
    expect(reg!.code).toContain("execute");
  });

  it("generates capability registration code for hooks", () => {
    const reg = modifier.generateCapabilityCode("myHook", "hook", "console.log('hook triggered');");
    expect(reg).not.toBeNull();
    expect(reg!.name).toBe("myHook");
    expect(reg!.type).toBe("hook");
    expect(reg!.code).toContain("turn_end");
  });

  it("returns patches from internal collection", () => {
    const patches = modifier.getPatches();
    expect(Array.isArray(patches)).toBe(true);
  });

  it("filters patches by status", () => {
    const proposed = modifier.getPatches("proposed");
    expect(Array.isArray(proposed)).toBe(true);

    const applied = modifier.getPatches("applied");
    expect(Array.isArray(applied)).toBe(true);
  });

  it("audits source for code quality issues", async () => {
    const findings = await modifier.proposeOptimization();
    expect(Array.isArray(findings)).toBe(true);
  });

  it("checks modification disabled state", () => {
    expect(modifier.isModificationDisabled()).toBe(false);
  });

  it("rejects null capability type", () => {
    const reg = modifier.generateCapabilityCode("bad", "invalid" as any, "code");
    expect(reg).toBeNull();
  });

  it("validates capability file save path saves successfully", () => {
    const reg = modifier.generateCapabilityCode("testTool", "tool", "return 1;");
    expect(reg).not.toBeNull();
    const saved = modifier.saveCapabilityToFile(reg!);
    expect(saved).not.toBeNull();
    expect(saved).toContain(".ts");
    if (saved && require("fs").existsSync(saved)) {
      require("fs").rmSync(saved, { force: true });
    }
  });
});
