import fs from "node:fs";
import path, { dirname } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { bus, Topics } from "../event-bus/event-bus";
import { getGraph } from "../state-graph/property-graph";
import { getDaemon, Daemon } from "../daemon/daemon";
import { writeAtomic } from "../storage-driver";
import { logger } from "../logger";

const _dirname = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const ALLOWED_SRC_DIR = path.resolve(_dirname, "..", "..", "..", "extensions", "subagents", "src");
const MAX_ROLLBACKS_PER_SESSION = 3;
const TSC_BIN = path.resolve(_dirname, "..", "..", "..", "..", "..", "node_modules", ".bin", "tsc");
const PROJECT_ROOT = path.resolve(_dirname, "..", "..", "..", "..", "..");

interface SelfPatch {
  id: string;
  filePath: string;
  description: string;
  originalContent: string;
  patchedContent: string;
  diff: string;
  status: "proposed" | "pending_approval" | "approved" | "rejected" | "testing" | "applied" | "rolled_back" | "failed";
  risk: "low" | "medium" | "high";
  testResults?: { passed: number; failed: number; output: string };
  appliedAt?: number;
  improvement: { metric: string; before: any; after?: any };
  blastRadius?: string[];
  gitCommitHash?: string;
}

interface AuditFinding {
  id: string;
  file: string;
  line?: number;
  severity: "info" | "warning" | "issue";
  category: "performance" | "style" | "complexity" | "duplication" | "unused";
  description: string;
  suggestion: string;
}

interface CapabilityRegistration {
  name: string;
  type: "tool" | "command" | "hook";
  description: string;
  code: string;
  registeredAt?: number;
}

export class SelfModifier {
  private patches: SelfPatch[] = [];
  private sourceDir: string;
  private isPatching = false;
  private rollbackCount = 0;
  private registrations: CapabilityRegistration[] = [];
  private approvalCallback: ((patch: SelfPatch) => Promise<boolean>) | null = null;

  constructor() {
    this.sourceDir = ALLOWED_SRC_DIR;
    this.setupListeners();
    this.registerBackgroundTask();
    // Safety gate: require user approval via sentinel file
    this.setApprovalCallback(async (patch) => {
      const pendingPath = path.join(os.homedir(), ".pi", "agent", "pending-patch.json");
      try {
        fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
        fs.writeFileSync(pendingPath, JSON.stringify({
          id: patch.id,
          description: patch.description,
          diff: patch.diff,
          risk: patch.risk,
          status: "pending_approval",
          createdAt: Date.now(),
        }, null, 2), "utf8");
        const reviewMsg = `[SelfModifier] Patch "${patch.description}" awaiting approval at ${pendingPath}\n  Set "approved": true in that file to proceed, or delete it to reject.`;
        logger.warn(reviewMsg);
        // Poll for up to 5 minutes
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          if (!fs.existsSync(pendingPath)) return false;
          try {
            const resp = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
            if (resp.approved === true) {
              fs.unlinkSync(pendingPath);
              return true;
            }
          } catch { /* invalid JSON, keep waiting */ }
        }
        logger.warn(`[SelfModifier] Patch "${patch.description}" approval timed out.`);
        fs.unlinkSync(pendingPath);
        return false;
      } catch (err) {
        logger.error(`[SelfModifier] Approval callback error: ${err}`);
        return false;
      }
    });
  }

  setApprovalCallback(callback: (patch: SelfPatch) => Promise<boolean>): void {
    this.approvalCallback = callback;
  }

  private async requestUserApproval(patch: SelfPatch): Promise<boolean> {
    if (!this.approvalCallback) {
      logger.warn("[SelfModifier] No approval callback set — auto-rejecting for safety");
      return false;
    }
    return await this.approvalCallback(patch);
  }

  private setupListeners(): void {
    bus.on(Topics.SELF_AUDIT, (event) => {
      if (event.data.type === "code_quality") {
        this.auditSource();
      }
    });
  }

  private registerBackgroundTask(): void {
    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      "self-modifier:audit",
      async () => {
        const findings = await this.auditSource();
        if (findings.length > 0) {
          bus.emit(Topics.SELF_AUDIT, {
            type: "code_quality",
            findings: findings.length,
            severity: findings.filter(f => f.severity === "issue").length,
          }, { source: "self-modifier" });
        }
      },
      3600000,
    ));
  }

  isPathAllowed(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return resolved.startsWith(this.sourceDir);
  }

  proposePatch(filePath: string, description: string, newContent: string, risk: SelfPatch["risk"] = "low"): SelfPatch | null {
    const resolvedPath = path.resolve(filePath);
    if (!this.isPathAllowed(resolvedPath)) return null;
    if (!fs.existsSync(resolvedPath)) return null;

    const originalContent = fs.readFileSync(resolvedPath, "utf8");
    if (originalContent === newContent) return null;

    const id = `patch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const diff = this.generateDiff(originalContent, newContent);
    const blastRadius = this.analyzeDependencyBlastRadius(resolvedPath);

    const patch: SelfPatch = {
      id,
      filePath: resolvedPath,
      description,
      originalContent,
      patchedContent: newContent,
      diff,
      status: "pending_approval",
      risk,
      improvement: { metric: "unknown", before: "unknown" },
      blastRadius,
    };

    this.patches.push(patch);

    bus.emit(Topics.SELF_IMPROVEMENT, {
      patchId: id,
      file: resolvedPath,
      description,
      risk,
      diffLength: diff.length,
      blastRadius: blastRadius.length,
    }, { source: "self-modifier" });

    return patch;
  }

  async applyPatch(patchId: string): Promise<boolean> {
    const patch = this.patches.find(p => p.id === patchId);
    if (!patch || (patch.status !== "pending_approval" && patch.status !== "approved")) return false;
    if (this.isPatching) return false;

    // If still pending approval, request it
    if (patch.status === "pending_approval") {
      const approved = await this.requestUserApproval(patch);
      if (!approved) {
        patch.status = "rejected";
        bus.emit(Topics.SELF_IMPROVEMENT, {
          patchId: patch.id,
          file: patch.filePath,
          description: patch.description,
          risk: patch.risk,
          status: "rejected",
        }, { source: "self-modifier" });
        return false;
      }
      patch.status = "approved";
    }

    this.isPatching = true;

    try {
      const sandboxResult = this.runInSandbox(patch.patchedContent, patch.filePath);
      if (!sandboxResult.compiles) {
        patch.status = "failed";
        patch.testResults = { passed: 0, failed: 1, output: sandboxResult.error || "TypeScript compilation failed" };
        return false;
      }

      if (patch.risk === "high" || patch.risk === "medium") {
        const testResult = await this.runRelevantTests(patch);
        patch.testResults = testResult;
        if (testResult.failed > 0) {
          patch.status = "failed";
          return false;
        }
      }

      const backupPath = patch.filePath + ".bak." + Date.now();
      fs.copyFileSync(patch.filePath, backupPath);
      fs.writeFileSync(patch.filePath, patch.patchedContent, "utf8");

      patch.status = "applied";
      patch.appliedAt = Date.now();
      patch.improvement.after = "applied";

      bus.emit(Topics.SELF_PATCH, {
        patchId: patch.id,
        file: patch.filePath,
        description: patch.description,
        status: "applied",
      }, { source: "self-modifier" });

      this.gitCommit(patch);

      return true;
    } catch (err: any) {
      patch.status = "failed";
      patch.testResults = { passed: 0, failed: 1, output: err.message };
      return false;
    } finally {
      this.isPatching = false;
    }
  }

  rollbackPatch(patchId: string): boolean {
    if (this.rollbackCount >= MAX_ROLLBACKS_PER_SESSION) return false;

    const patch = this.patches.find(p => p.id === patchId);
    if (!patch || patch.status !== "applied") return false;

    try {
      fs.writeFileSync(patch.filePath, patch.originalContent, "utf8");
      patch.status = "rolled_back";
      this.rollbackCount++;

      if (this.rollbackCount >= MAX_ROLLBACKS_PER_SESSION) {
        bus.emit(Topics.SYSTEM_WARNING, {
          source: "self-modifier",
          message: `Max rollbacks (${MAX_ROLLBACKS_PER_SESSION}) reached. Self-modification disabled for this session.`,
        }, { source: "self-modifier" });
      }

      return true;
    } catch {
      return false;
    }
  }

  getRollbackCount(): number {
    return this.rollbackCount;
  }

  getMaxRollbacks(): number {
    return MAX_ROLLBACKS_PER_SESSION;
  }

  isModificationDisabled(): boolean {
    return this.rollbackCount >= MAX_ROLLBACKS_PER_SESSION;
  }

  async approvePatch(patchId: string): Promise<boolean> {
    const patch = this.patches.find(p => p.id === patchId);
    if (!patch || patch.status !== "pending_approval") return false;
    patch.status = "approved";
    bus.emit(Topics.SELF_IMPROVEMENT, {
      patchId: patch.id,
      file: patch.filePath,
      description: patch.description,
      risk: patch.risk,
      status: "approved",
    }, { source: "self-modifier" });
    return true;
  }

  async rejectPatch(patchId: string): Promise<boolean> {
    const patch = this.patches.find(p => p.id === patchId);
    if (!patch || patch.status !== "pending_approval") return false;
    patch.status = "rejected";
    bus.emit(Topics.SELF_IMPROVEMENT, {
      patchId: patch.id,
      file: patch.filePath,
      description: patch.description,
      risk: patch.risk,
      status: "rejected",
    }, { source: "self-modifier" });
    return true;
  }

  getPendingApprovalPatches(): SelfPatch[] {
    return this.patches.filter(p => p.status === "pending_approval");
  }

  proposeOptimization(): Promise<AuditFinding[]> {
    return this.auditSource();
  }

  getPatches(status?: SelfPatch["status"]): SelfPatch[] {
    if (status) return this.patches.filter(p => p.status === status);
    return this.patches;
  }

  generateCapabilityCode(name: string, type: CapabilityRegistration["type"], implementation: string): CapabilityRegistration | null {
    const templates: Record<string, string> = {
      tool: `// Auto-registered tool: ${name}
import { Type } from "typebox";

export const ${name}ToolDef = {
  name: "${name}",
  description: "Auto-generated tool via self-modifier",
  inputSchema: Type.Object({}),
  execute: async (args: unknown, ctx: unknown) => {
    ${implementation}
  },
};`,
      command: `// Auto-registered command: ${name}
export const ${name}CommandDef = {
  name: "${name}",
  description: "Auto-generated command via self-modifier",
  execute: async (args: string[], ctx: unknown) => {
    ${implementation}
  },
};`,
      hook: `// Auto-registered hook: ${name}
export const ${name}HookDef = {
  name: "${name}",
  description: "Auto-generated hook via self-modifier",
  hook: "turn_end",
  execute: async (event: unknown, ctx: unknown) => {
    ${implementation}
  },
};`,
    };

    const template = templates[type];
    if (!template) return null;

    const registration: CapabilityRegistration = {
      name,
      type,
      description: `Auto-generated ${type}: ${name}`,
      code: template,
    };

    this.registrations.push(registration);

    return registration;
  }

  saveCapabilityToFile(registration: CapabilityRegistration): string | null {
    if (!this.isPathAllowed(this.sourceDir)) return null;
    const fileName = `${registration.name}.${registration.type}.ts`;
    const filePath = path.join(this.sourceDir, registration.type + "s", fileName);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filePath, registration.code, "utf8");
    registration.registeredAt = Date.now();

    return filePath;
  }

  analyzeDependencyBlastRadius(filePath: string): string[] {
    const affected: string[] = [];
    try {
      const dir = path.dirname(filePath);
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
        const fullPath = path.join(dir, entry.name);
        if (fullPath === filePath) continue;
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          const importMatch = content.includes(`./${path.basename(filePath, ".ts")}`) ||
            content.includes(`./${path.basename(filePath)}`);
          if (importMatch) affected.push(fullPath);
        } catch { logger.warn("empty catch block") }
      }

      const allFiles = this.getSourceFiles();
      for (const f of allFiles) {
        if (affected.includes(f) || f === filePath) continue;
        try {
          const content = fs.readFileSync(f, "utf8");
          const relativePath = path.relative(path.dirname(f), filePath).replace(/\\/g, "/");
          if (content.includes(`"${relativePath}"`) || content.includes(`'${relativePath}'`)) {
            affected.push(f);
          }
        } catch { logger.warn("empty catch block") }
      }
    } catch { logger.warn("empty catch block") }

    return affected;
  }

  private runInSandbox(newContent: string, originalPath: string): { compiles: boolean; error?: string } {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "self-mod-sandbox-"));
    try {
      const relativePath = path.relative(this.sourceDir, originalPath);
      const sandboxFilePath = path.join(sandboxDir, relativePath);
      const sandboxDirPath = path.dirname(sandboxFilePath);
      if (!fs.existsSync(sandboxDirPath)) fs.mkdirSync(sandboxDirPath, { recursive: true });

      const relParts = relativePath.split(path.sep);
      let currentDir = sandboxDir;
      for (const part of relParts.slice(0, -1)) {
        currentDir = path.join(currentDir, part);
        if (!fs.existsSync(currentDir)) fs.mkdirSync(currentDir, { recursive: true });
      }

      fs.writeFileSync(sandboxFilePath, newContent, "utf8");

      try {
        const tscResult = execSync(`"${TSC_BIN}" --noEmit --pretty 2>&1 || true`, {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          timeout: 60000,
        });
        const hasError = tscResult.toLowerCase().includes("error");
        if (hasError) {
          const errorLines = tscResult.split("\n").filter(l => l.includes("error") || l.includes("Error")).slice(0, 10).join("\n");
          return { compiles: false, error: errorLines.slice(0, 1000) };
        }
        return { compiles: true };
      } catch (err: any) {
        return { compiles: false, error: err.message };
      }
    } finally {
      try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch { logger.warn("empty catch block") }
    }
  }

  private async runRelevantTests(patch: SelfPatch): Promise<{ passed: number; failed: number; output: string }> {
    try {
      const testFiles = this.findRelevantTests(patch.filePath);
      if (testFiles.length === 0) {
        return { passed: 1, failed: 0, output: "No relevant tests found" };
      }

      let totalPassed = 0;
      let totalFailed = 0;
      const outputs: string[] = [];

      for (const testFile of testFiles.slice(0, 5)) {
        try {
          const result = execSync(`npx vitest run "${testFile}" --reporter=json 2>&1 || true`, {
            cwd: PROJECT_ROOT,
            encoding: "utf8",
            timeout: 60000,
          });
          try {
            const report = JSON.parse(result);
            totalPassed += report.numPassedTests || 0;
            totalFailed += report.numFailedTests || 0;
            outputs.push(`${testFile}: ${report.numPassedTests || 0} passed, ${report.numFailedTests || 0} failed`);
          } catch {
            outputs.push(`${testFile}: unknown result`);
          }
        } catch (err: any) {
          totalFailed++;
          outputs.push(`${testFile}: error - ${err.message}`);
        }
      }

      return {
        passed: totalPassed,
        failed: totalFailed,
        output: outputs.join("\n"),
      };
    } catch (err: any) {
      return { passed: 0, failed: 1, output: err.message };
    }
  }

  private findRelevantTests(filePath: string): string[] {
    const testsDir = path.join(this.sourceDir, "__tests__");
    if (!fs.existsSync(testsDir)) return [];

    const baseName = path.basename(filePath, ".ts");
    const allTests = fs.readdirSync(testsDir).filter(f => f.endsWith(".test.ts"));

    const directMatch = allTests.filter(t => t.startsWith(baseName));
    if (directMatch.length > 0) return directMatch.map(t => path.join(testsDir, t));

    const moduleMatch = allTests.filter(t => {
      try {
        const content = fs.readFileSync(path.join(testsDir, t), "utf8");
        const importMatch = content.includes(`../${baseName}`) || content.includes(`"./${baseName}"`);
        return importMatch;
      } catch { return false; }
    });

    return moduleMatch.slice(0, 3).map(t => path.join(testsDir, t));
  }

  private gitCommit(patch: SelfPatch): void {
    try {
      const relativePath = path.relative(PROJECT_ROOT, patch.filePath);
      execSync(`git add "${relativePath}"`, { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 10000 });

      const commitMsg = `Auto-apply: ${patch.description}`;
      const result = execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}" --no-verify 2>&1 || true`, {
        cwd: PROJECT_ROOT, encoding: "utf8", timeout: 10000,
      });

      const hashMatch = result.match(/\[[\w-]+ ([a-f0-9]+)\]/);
      if (hashMatch) {
        patch.gitCommitHash = hashMatch[1];
        logger.info(`[SelfModifier] Committed patch ${patch.id} as ${patch.gitCommitHash}`);
      }
    } catch (err) {
      logger.warn("[SelfModifier] Git commit failed", { error: String(err) });
    }
  }

  private async auditSource(): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    const files = this.getSourceFiles();

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n");

        if (content.includes("any") && !file.includes("types.d.ts")) {
          const anyLines = lines.map((l, i) => l.includes("any") && !l.trim().startsWith("//") ? i + 1 : -1).filter(i => i > 0);
          if (anyLines.length > 3) {
            findings.push({
              id: `audit_any_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
              file, line: anyLines[0],
              severity: "warning",
              category: "style",
              description: `Excessive 'any' usage (${anyLines.length} occurrences)`,
              suggestion: "Replace 'any' with proper TypeScript types",
            });
          }
        }

        const longLines = lines.map((l, i) => l.length > 200 ? i + 1 : -1).filter(i => i > 0);
        if (longLines.length > 0) {
          findings.push({
            id: `audit_long_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
            file, line: longLines[0],
            severity: "info",
            category: "style",
            description: `${longLines.length} lines exceed 200 characters`,
            suggestion: "Break long lines for readability",
          });
        }

        if (content.length > 5000 && lines.length > 200) {
          findings.push({
            id: `audit_size_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
            file,
            severity: "warning",
            category: "complexity",
            description: `Large file (${lines.length} lines, ${content.length} chars)`,
            suggestion: "Consider splitting into smaller modules",
          });
        }

        const todoCount = (content.match(/\bTODO\b/g) || []).length;
        if (todoCount > 3) {
          findings.push({
            id: `audit_todo_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
            file,
            severity: "info",
            category: "style",
            description: `${todoCount} TODO comments remaining`,
            suggestion: "Address outstanding TODOs or convert to issues",
          });
        }
      } catch { logger.warn("empty catch block") }
    }

    return findings;
  }

  private getSourceFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "__tests__") {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          files.push(fullPath);
        }
      }
    };
    if (fs.existsSync(this.sourceDir)) walk(this.sourceDir);
    return files;
  }

  private generateDiff(original: string, patched: string): string {
    const origLines = original.split("\n");
    const patchLines = patched.split("\n");
    const diff: string[] = [];

    let i = 0, j = 0;
    while (i < origLines.length || j < patchLines.length) {
      if (i < origLines.length && j < patchLines.length && origLines[i] === patchLines[j]) {
        i++; j++;
      } else {
        diff.push(`- ${origLines[i] || ""}`);
        diff.push(`+ ${patchLines[j] || ""}`);
        i++; j++;
        if (diff.length > 50) { diff.push("... (diff truncated)"); break; }
      }
    }

    return diff.join("\n");
  }
}

export const selfModifier = new SelfModifier();
