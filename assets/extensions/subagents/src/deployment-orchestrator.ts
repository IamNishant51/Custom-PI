import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

function sanitizeGitSha(input: string): string {
  return input.replace(/[^a-fA-F0-9]/g, "");
}

export type PipelineStageName =
  | "pr_created" | "build_started" | "unit_tests" | "staging_deploy"
  | "smoke_tests" | "prod_deploy" | "completed" | "failed" | "rolled_back";

export interface PipelineStage {
  name: PipelineStageName;
  status: "pending" | "running" | "passed" | "failed";
  startedAt?: number;
  completedAt?: number;
}

export interface DeploymentState {
  id: string;
  prUrl?: string;
  branch: string;
  target: string;
  stages: PipelineStage[];
  currentStage: number;
  rollbackSha?: string;
  stableSha?: string;
  createdAt: number;
}

const deployments = new Map<string, DeploymentState>();

export function createDeployment(branch: string, target: string, stableSha?: string): DeploymentState {
  const id = `deploy_${Date.now()}`;
  const stageNames: PipelineStageName[] = ["pr_created", "build_started", "unit_tests", "staging_deploy", "smoke_tests", "prod_deploy"];
  const state: DeploymentState = {
    id, branch, target,
    stages: stageNames.map(n => ({ name: n, status: "pending" as const })),
    currentStage: 0,
    rollbackSha: stableSha,
    createdAt: Date.now(),
  };
  deployments.set(id, state);
  return state;
}

export function advanceStage(id: string, status: "passed" | "failed"): DeploymentState | null {
  const state = deployments.get(id);
  if (!state) return null;
  const stage = state.stages[state.currentStage];
  if (!stage) return null;
  stage.status = status;
  stage.completedAt = Date.now();
  if (status === "failed") return state;
  state.currentStage++;
  if (state.currentStage < state.stages.length) {
    state.stages[state.currentStage].status = "running";
    state.stages[state.currentStage].startedAt = Date.now();
  }
  return state;
}

export function getDeployment(id: string): DeploymentState | null {
  return deployments.get(id) || null;
}

export function listDeployments(): DeploymentState[] {
  return Array.from(deployments.values());
}

export function executeRollback(deploymentId: string, workDir: string): { ok: boolean; output: string } {
  const state = deployments.get(deploymentId);
  if (!state || !state.rollbackSha) return { ok: false, output: "No rollback SHA available" };
  const safeSha = sanitizeGitSha(state.rollbackSha);
  if (safeSha.length !== 40) return { ok: false, output: "Invalid rollback SHA" };
  try {
    const stashOut = execFileSync("git", ["stash"], { cwd: workDir, encoding: "utf8", timeout: 15000 });
    const checkoutOut = execFileSync("git", ["checkout", safeSha], { cwd: workDir, encoding: "utf8", timeout: 15000 });
    state.stages.forEach(s => { if (s.status === "running") s.status = "pending"; });
    return { ok: true, output: `${stashOut.trim()}\n${checkoutOut.trim()}` };
  } catch (e: any) {
    return { ok: false, output: e.message || String(e) };
  }
}

export function runVerificationScript(scriptPath: string): { passed: boolean; output: string } {
  const resolvedPath = path.resolve(scriptPath);
  if (!fs.existsSync(resolvedPath)) return { passed: false, output: `Script not found: ${resolvedPath}` };
  try {
    const output = execFileSync("bash", [resolvedPath], { encoding: "utf8", timeout: 60000 });
    return { passed: true, output: output.trim() };
  } catch (e: any) {
    return { passed: false, output: e.message || String(e) };
  }
}
