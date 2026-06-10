import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { bus, Topics } from "../event-bus/event-bus";
import { getGraph } from "../state-graph/property-graph";
import { getDaemon, Daemon } from "../daemon/daemon";

interface SelfPatch {
  id: string;
  filePath: string;
  description: string;
  originalContent: string;
  patchedContent: string;
  diff: string;
  status: "proposed" | "testing" | "applied" | "rolled_back" | "failed";
  risk: "low" | "medium" | "high";
  testResults?: { passed: number; failed: number; output: string };
  appliedAt?: number;
  improvement: { metric: string; before: any; after?: any };
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

export class SelfModifier {
  private patches: SelfPatch[] = [];
  private sourceDir: string;
  private isPatching = false;

  constructor() {
    this.sourceDir = path.join(__dirname, "..", "..", "..", "extensions", "subagents", "src");
    this.setupListeners();
    this.registerBackgroundTask();
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
      3600000
    ));
  }

  proposePatch(filePath: string, description: string, newContent: string, risk: SelfPatch["risk"] = "low"): SelfPatch | null {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) return null;

    const originalContent = fs.readFileSync(resolvedPath, "utf8");
    if (originalContent === newContent) return null;

    const id = `patch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const diff = this.generateDiff(originalContent, newContent);

    const patch: SelfPatch = {
      id,
      filePath: resolvedPath,
      description,
      originalContent,
      patchedContent: newContent,
      diff,
      status: "proposed",
      risk,
      improvement: { metric: "unknown", before: "unknown" },
    };

    this.patches.push(patch);

    bus.emit(Topics.SELF_IMPROVEMENT, {
      patchId: id,
      file: resolvedPath,
      description,
      risk,
      diffLength: diff.length,
    }, { source: "self-modifier" });

    return patch;
  }

  async applyPatch(patchId: string): Promise<boolean> {
    const patch = this.patches.find(p => p.id === patchId);
    if (!patch || patch.status !== "proposed") return false;

    if (this.isPatching) return false;
    this.isPatching = true;

    try {
      if (patch.risk === "high") {
        const testResult = await this.runPatchTests(patch);
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

      return true;
    } catch (err: any) {
      patch.status = "failed";
      return false;
    } finally {
      this.isPatching = false;
    }
  }

  rollbackPatch(patchId: string): boolean {
    const patch = this.patches.find(p => p.id === patchId);
    if (!patch || patch.status !== "applied") return false;

    try {
      fs.writeFileSync(patch.filePath, patch.originalContent, "utf8");
      patch.status = "rolled_back";
      return true;
    } catch {
      return false;
    }
  }

  proposeOptimization(): Promise<AuditFinding[]> {
    return this.auditSource();
  }

  getPatches(status?: SelfPatch["status"]): SelfPatch[] {
    if (status) return this.patches.filter(p => p.status === status);
    return this.patches;
  }

  private async auditSource(): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    const files = this.getSourceFiles();

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n");

        if (content.includes("any") && !file.includes("types.d.ts")) {
          const anyLines = lines.map((l, i) => l.includes("any") && !l.includes("//") ? i + 1 : -1).filter(i => i > 0);
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
      } catch {}
    }

    return findings;
  }

  private async runPatchTests(patch: SelfPatch): Promise<{ passed: number; failed: number; output: string }> {
    try {
      const typeCheckResult = execSync("npx tsc --noEmit --pretty 2>&1 || true", {
        cwd: path.join(this.sourceDir, "..", "..", "..", "..", ".."),
        encoding: "utf8", timeout: 30000,
      });
      const hasError = typeCheckResult.toLowerCase().includes("error");
      return {
        passed: hasError ? 0 : 1,
        failed: hasError ? 1 : 0,
        output: typeCheckResult.slice(0, 1000),
      };
    } catch (err: any) {
      return { passed: 0, failed: 1, output: err.message };
    }
  }

  private getSourceFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
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
