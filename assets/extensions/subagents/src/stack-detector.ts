import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

export interface StackIndicator {
  file: string;
  contains?: string;
}

export interface StackCommands {
  build?: string[];
  test?: string[];
  lint?: string[];
  typecheck?: string[];
  fmt?: string[];
  dev?: string[];
  [key: string]: string[] | undefined;
}

export interface StackPermissions {
  allow: string[];
  deny: string[];
}

export interface StackDefinition {
  id: string;
  name: string;
  indicators: StackIndicator[];
  language: string | null;
  rules: string[];
  skills: string[];
  commands: StackCommands;
  permissions: StackPermissions;
}

export interface StackMappingData {
  stacks: StackDefinition[];
}

export interface DetectedStack {
  id: string;
  name: string;
  language: string | null;
  rules: string[];
  skills: string[];
  commands: StackCommands;
  permissions: StackPermissions;
  confidence: number;
}

const STACK_MAPPINGS_PATH = resolve(join(__dirname, "..", "..", "..", "..", "config", "project-stack-mappings.json"));

let cachedMappings: StackDefinition[] | null = null;

function loadMappings(): StackDefinition[] {
  if (cachedMappings) return cachedMappings;
  try {
    const raw = readFileSync(STACK_MAPPINGS_PATH, "utf-8");
    const data: StackMappingData = JSON.parse(raw);
    cachedMappings = data.stacks;
    return cachedMappings;
  } catch {
    return [];
  }
}

function indicatorScore(root: string, indicator: StackIndicator): number {
  const fullPath = join(root, indicator.file);
  if (indicator.file.endsWith("/")) {
    const dir = fullPath.slice(0, -1);
    return existsSync(dir) && statSync(dir).isDirectory() ? 3 : 0;
  }
  if (indicator.file.includes("*")) {
    const pattern = indicator.file.replace(/\*/g, ".*");
    try {
      const files = readdirSync(root);
      if (files.some(f => new RegExp("^" + pattern + "$").test(f))) return 3;
    } catch { return 0; }
    return 0;
  }
  if (!existsSync(fullPath)) return 0;
  if (indicator.contains) {
    try {
      const content = readFileSync(fullPath, "utf-8");
      return content.includes(indicator.contains) ? 3 : 1;
    } catch { return 1; }
  }
  return 3;
}

export function detectStack(projectRoot: string): DetectedStack[] {
  const stacks = loadMappings();
  const results: DetectedStack[] = [];

  for (const stack of stacks) {
    let score = 0;
    let maxScore = 0;
    for (const indicator of stack.indicators) {
      maxScore += 3;
      score += indicatorScore(projectRoot, indicator);
    }
    if (score > 0) {
      results.push({
        id: stack.id,
        name: stack.name,
        language: stack.language,
        rules: stack.rules,
        skills: stack.skills,
        commands: stack.commands,
        permissions: stack.permissions,
        confidence: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export function detectPrimaryStack(projectRoot: string): DetectedStack | null {
  const results = detectStack(projectRoot);
  return results.length > 0 ? results[0] : null;
}

export function getCombinedRules(stacks: DetectedStack[]): string[] {
  const rules = new Set<string>();
  for (const stack of stacks) {
    for (const rule of stack.rules) {
      rules.add(rule);
    }
  }
  return Array.from(rules);
}

export function getCombinedPermissions(stacks: DetectedStack[]): StackPermissions {
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const stack of stacks) {
    for (const a of stack.permissions.allow) allow.add(a);
    for (const d of stack.permissions.deny) deny.add(d);
  }
  return {
    allow: Array.from(allow),
    deny: Array.from(deny),
  };
}

export function formatStackSummary(stacks: DetectedStack[]): string {
  if (stacks.length === 0) return "No project stack detected.";
  return stacks
    .map(s => `  - ${s.name}  (${s.confidence}% confidence)${s.language ? `  [${s.language}]` : ""}`)
    .join("\n");
}
