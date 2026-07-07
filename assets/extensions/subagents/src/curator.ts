import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { logger } from "./logger";
import { completeSimple } from "@earendil-works/pi-ai";
import { listSkills, getSkillUsage, deleteSkill, getAllUsage } from "./skill-store";
import { SkillFile, SkillLifecycle, STALE_DAYS, ARCHIVE_DAYS, SKILLS_DIR, type SkillInputSchema, type SkillOutputContract } from "./skill-types";

export interface CuratorReport {
  archived: string[];
  deleted: string[];
  staleCount: number;
  activeCount: number;
}

const CURATOR_PROMPT = `You are a skill curator for an AI coding agent.
Review the following skills and decide which ones to archive or delete.

Rules:
- Skills unused for >{archive_days} days → archive
- Skills unused for >{stale_days} days → mark stale
- Skills that are redundant or low-quality → delete
- Only touch agent-authored skills, never user-authored.

Current skills:
{skills_list}

Output JSON:
{
  "toArchive": ["skill_name", ...],
  "toDelete": ["skill_name", ...],
  "reasoning": "brief explanation"
}`;

export async function runCurator(model: any, auth: { apiKey?: string; headers?: Record<string, string> }, dryRun = false): Promise<CuratorReport> {
  const report: CuratorReport = { archived: [], deleted: [], staleCount: 0, activeCount: 0 };

  try {
    const skills = await listSkills("agent");
    const usage = await getAllUsage();

    let staleCount = 0;
    let activeCount = 0;
    const skillLines = skills.map(s => {
      const u = usage[s.frontmatter.name];
      const lastUsed = u?.lastUsed || "never";
      const useCount = u?.useCount || 0;
      const lifecycle = getLifecycleString(s, u?.lastUsed);
      if (lifecycle === "stale") staleCount++;
      if (lifecycle === "active") activeCount++;
      return `- ${s.frontmatter.name}: used ${useCount}x, last ${lastUsed}, lifecycle=${lifecycle}`;
    }).join("\n");

    report.staleCount = staleCount;
    report.activeCount = activeCount;

    const prompt = CURATOR_PROMPT
      .replace("{archive_days}", String(ARCHIVE_DAYS))
      .replace("{stale_days}", String(STALE_DAYS))
      .replace("{skills_list}", skillLines || "(no skills)");

    const response = await completeSimple(model, {
      systemPrompt: "You are a precise skill curator. Output only valid JSON.",
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    }, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      reasoning: "off" as any,
    });

    const text = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();

    const decision = JSON.parse(text);

    if (Array.isArray(decision.toArchive)) {
      if (dryRun) {
        report.archived.push(...decision.toArchive.map((n: string) => `${n} (dry-run)`));
      } else {
        const archiveDir = path.join(os.homedir(), SKILLS_DIR, "archived");
        await fs.mkdir(archiveDir, { recursive: true });
        for (const name of decision.toArchive) {
          const skill = skills.find(s => s.frontmatter.name === name);
          if (skill && skill.filePath) {
            try {
              const dest = path.join(archiveDir, path.basename(skill.filePath));
              await fs.copyFile(skill.filePath, dest);
              await fs.unlink(skill.filePath);
              report.archived.push(name);
          } catch (e) { logger.warn("Failed to archive skill", { name, error: String(e) }); }
          }
        }
      }
    }

    if (Array.isArray(decision.toDelete)) {
      if (dryRun) {
        report.deleted.push(...decision.toDelete.map((n: string) => `${n} (dry-run)`));
      } else {
        for (const name of decision.toDelete) {
          if (await deleteSkill(name)) {
            report.deleted.push(name);
          }
        }
      }
    }
  } catch (e: any) {
    logger.warn("Curator run failed", { error: e?.message || String(e) });
  }

  return report;
}

function getLifecycleString(skill: SkillFile, lastUsedStr?: string): SkillLifecycle {
  if (!lastUsedStr) return "active";
  const lastUsed = new Date(lastUsedStr).getTime();
  const now = Date.now();
  const daysSince = (now - lastUsed) / (1000 * 60 * 60 * 24);
  if (daysSince > ARCHIVE_DAYS) return "archived";
  if (daysSince > STALE_DAYS) return "stale";
  return "active";
}

// ── Skill Manifest Validation ──────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSkillExecution(
  skill: SkillFile,
  input: Record<string, any>,
  availableTools?: string[],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fm = skill.frontmatter;

  if (fm.prerequisites && fm.prerequisites.length > 0 && availableTools) {
    for (const prereq of fm.prerequisites) {
      if (!availableTools.includes(prereq)) {
        errors.push(`Missing prerequisite tool: '${prereq}' (required by skill '${fm.name}')`);
      }
    }
  }

  if (fm.input_schema) {
    const schema = fm.input_schema;
    if (schema.type === "object" && schema.properties) {
      for (const [propName, propDef] of Object.entries(schema.properties)) {
        if (input[propName] === undefined) {
          errors.push(`Missing required input: '${propName}' (${propDef.description || "no description"})`);
        } else if (propDef.type) {
          const actualType = typeof input[propName];
          if (actualType !== propDef.type) {
            warnings.push(`Input '${propName}' expected ${propDef.type}, got ${actualType}`);
          }
        }
      }
    }
  }

  if (fm.output_contract && !errors.length) {
    // output contract is for documentation / downstream consumers
  }

  return { valid: errors.length === 0, errors, warnings };
}

export async function validateAllSkills(availableTools?: string[]): Promise<Record<string, ValidationResult>> {
  const skills = await listSkills();
  const results: Record<string, ValidationResult> = {};
  for (const skill of skills) {
    results[skill.frontmatter.name] = validateSkillExecution(skill, {}, availableTools);
  }
  return results;
}
