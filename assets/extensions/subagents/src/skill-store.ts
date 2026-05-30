import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";
import {
  SkillFrontmatter,
  SkillFile,
  SkillUsageRecord,
  SkillLifecycle,
  SkillAuthor,
  SKILLS_DIR,
  SKILL_USAGE_FILE,
  DEFAULT_SKILL_FRONTMATTER,
  STALE_DAYS,
  ARCHIVE_DAYS,
  makeSkillFilename,
} from "./skill-types";

function getSkillsDir(): string {
  return path.join(os.homedir(), SKILLS_DIR);
}

function getAgentSkillsDir(): string {
  return path.join(getSkillsDir(), "agent");
}

function getUserSkillsDir(): string {
  return path.join(getSkillsDir(), "user");
}

function usageFilePath(): string {
  return path.join(getSkillsDir(), SKILL_USAGE_FILE);
}

function ensureDirs(): void {
  for (const dir of [getSkillsDir(), getAgentSkillsDir(), getUserSkillsDir()]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function readUsage(): Record<string, SkillUsageRecord> {
  ensureDirs();
  const fp = usageFilePath();
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return {};
  }
}

function writeUsage(usage: Record<string, SkillUsageRecord>): void {
  ensureDirs();
  fs.writeFileSync(usageFilePath(), JSON.stringify(usage, null, 2), "utf8");
}

export function listSkills(author?: SkillAuthor): SkillFile[] {
  ensureDirs();
  const results: SkillFile[] = [];
  const dirs = author === "user" ? [getUserSkillsDir()]
    : author === "agent" ? [getAgentSkillsDir()]
    : [getAgentSkillsDir(), getUserSkillsDir()];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const parsed = parseSkillFile(content, filePath);
        if (parsed) results.push(parsed);
      } catch {}
    }
  }
  return results;
}

export function parseSkillFile(content: string, filePath: string): SkillFile | null {
  const match = content.match(/^\s*---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (!match) return null;
  try {
    const frontmatter = yaml.parse(match[1]) as SkillFrontmatter;
    if (!frontmatter.name || !frontmatter.description) return null;
    return {
      frontmatter: {
        ...DEFAULT_SKILL_FRONTMATTER,
        ...frontmatter,
        created: frontmatter.created || new Date().toISOString(),
        updated: new Date().toISOString(),
      },
      body: match[2].trim(),
      filePath,
    };
  } catch {
    return null;
  }
}

export function getSkill(name: string): SkillFile | null {
  const skills = listSkills();
  return skills.find(s => s.frontmatter.name === name || path.basename(s.filePath, ".md") === makeSkillFilename(name)) || null;
}

export function saveSkill(
  name: string,
  description: string,
  body: string,
  author: SkillAuthor = "agent",
  tags: string[] = [],
  complexity: number = 3,
): SkillFile {
  ensureDirs();
  const filename = makeSkillFilename(name);
  const dir = author === "user" ? getUserSkillsDir() : getAgentSkillsDir();
  const filePath = path.join(dir, filename);

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    author,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    version: 1,
    tags,
    complexity,
  };

  const content = `---\n${yaml.stringify(frontmatter)}---\n${body}\n`;
  fs.writeFileSync(filePath, content, "utf8");
  return { frontmatter, body, filePath };
}

export function deleteSkill(name: string): boolean {
  const skill = getSkill(name);
  if (!skill) return false;
  try {
    fs.unlinkSync(skill.filePath);
    const usage = readUsage();
    delete usage[skill.frontmatter.name];
    writeUsage(usage);
    return true;
  } catch {
    return false;
  }
}

export function recordSkillUsage(name: string, sessionId: string, success: boolean): void {
  const usage = readUsage();
  const now = new Date().toISOString();
  const existing = usage[name];
  if (existing) {
    existing.lastUsed = now;
    existing.useCount++;
    if (!existing.sessionsUsed.includes(sessionId)) {
      existing.sessionsUsed.push(sessionId);
    }
    const total = existing.useCount;
    const successes = existing.successRate * (total - 1) + (success ? 1 : 0);
    existing.successRate = successes / total;
  } else {
    usage[name] = {
      name,
      lastUsed: now,
      useCount: 1,
      sessionsUsed: [sessionId],
      successRate: success ? 1 : 0,
    };
  }
  writeUsage(usage);
}

export function getSkillUsage(name: string): SkillUsageRecord | null {
  const usage = readUsage();
  return usage[name] || null;
}

export function getAllUsage(): Record<string, SkillUsageRecord> {
  return readUsage();
}

export function computeLifecycle(skill: SkillFile): SkillLifecycle {
  const usage = readUsage();
  const record = usage[skill.frontmatter.name];
  if (!record) return "active";
  const lastUsed = new Date(record.lastUsed).getTime();
  const now = Date.now();
  const daysSinceUse = (now - lastUsed) / (1000 * 60 * 60 * 24);
  if (daysSinceUse > ARCHIVE_DAYS) return "archived";
  if (daysSinceUse > STALE_DAYS) return "stale";
  return "active";
}

export function getStaleSkills(): SkillFile[] {
  return listSkills("agent").filter(s => computeLifecycle(s) === "stale");
}

export function getArchivedSkills(): SkillFile[] {
  return listSkills("agent").filter(s => computeLifecycle(s) === "archived");
}
