import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowSuggestion {
  intent: string;
  command: string;
  description: string;
  confidence: "high" | "medium" | "low";
  filePath?: string;
}

export interface ProjectContext {
  name: string;
  scripts: Record<string, string>;
  agentInstructions: string[];
  projectType: "web" | "node" | "python" | "rust" | "other";
  hasTests: boolean;
  hasCi: boolean;
}

// ── Context Harvesting ─────────────────────────────────────────────────────

function getProjectRoot(): string {
  return process.env.PI_PROJECT_ROOT || process.cwd();
}

function parsePackageJson(): { name: string; scripts: Record<string, string> } | null {
  const pkgPath = path.join(getProjectRoot(), "package.json");
  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return { name: pkg.name || "unknown", scripts: pkg.scripts || {} };
    }
  } catch {}
  return null;
}

function parseAgentMd(): string[] {
  const mdPath = path.join(getProjectRoot(), "AGENT.md");
  try {
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, "utf8");
      return content.split("\n")
        .map(l => l.replace(/^[#\s-]*/, "").trim())
        .filter(l => l.length > 10);
    }
  } catch {}
  return [];
}

function detectProjectType(scripts: Record<string, string>): ProjectContext["projectType"] {
  const all = Object.values(scripts).join(" ");
  if (/\bnext\b|react|vite|webpack|angular|vue\b/.test(all)) return "web";
  if (/\bnode|tsc|ts-node\b/.test(all)) return "node";
  if (/\bpython|pytest|flask|django\b/.test(all)) return "python";
  if (/\bcargo|rustc\b/.test(all)) return "rust";
  return "other";
}

export function harvestContext(): ProjectContext {
  const pkg = parsePackageJson();
  const scripts = pkg?.scripts || {};
  const agentInstructions = parseAgentMd();
  const projectType = detectProjectType(scripts);
  const hasTests = Object.keys(scripts).some(s => /test|spec|check/.test(s));
  const hasCi = fs.existsSync(path.join(getProjectRoot(), ".github/workflows")) ||
    fs.existsSync(path.join(getProjectRoot(), ".circleci")) ||
    fs.existsSync(path.join(getProjectRoot(), ".gitlab-ci.yml"));

  return {
    name: pkg?.name || path.basename(getProjectRoot()),
    scripts,
    agentInstructions,
    projectType,
    hasTests,
    hasCi,
  };
}

// ── Intent Mapping ─────────────────────────────────────────────────────────

const INTENT_KEYWORDS: Record<string, RegExp[]> = {
  build: [/^build/, /^compile/, /^prod/, /^dist/],
  dev: [/^dev/, /^start/, /^serve/, /^watch/],
  test: [/^test/, /^lint/, /^check/, /^validate/],
  deploy: [/^deploy/, /^release/, /^publish/],
  clean: [/^clean/, /^reset/],
  analyze: [/^analyze/, /^audit/, /^inspect/, /^report/],
};

export function suggestWorkflows(context: ProjectContext): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];
  const seen = new Set<string>();

  for (const [scriptName, scriptCmd] of Object.entries(context.scripts)) {
    for (const [intent, patterns] of Object.entries(INTENT_KEYWORDS)) {
      if (patterns.some(p => p.test(scriptName))) {
        const key = `${intent}:${scriptName}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({
            intent,
            command: scriptName,
            description: `Run 'npm run ${scriptName}' — ${scriptCmd.slice(0, 60)}`,
            confidence: context.hasCi ? "high" : "medium",
          });
        }
      }
    }
  }

  return suggestions.sort((a, b) => {
    const order = ["high", "medium", "low"];
    return order.indexOf(a.confidence) - order.indexOf(b.confidence);
  }).slice(0, 5);
}

// ── Session Start Injection ────────────────────────────────────────────────

export function formatSuggestionsForPrompt(suggestions: WorkflowSuggestion[]): string {
  if (!suggestions.length) return "";
  const lines = suggestions.map((s, i) =>
    `${i + 1}. [${s.intent.toUpperCase()}] \`npm run ${s.command}\` — ${s.description}`
  );
  return `\n## 🔮 WORKFLOW SUGGESTIONS\nBased on the project context, you might want to:\n${lines.join("\n")}\n`;
}
