import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";
import { logger } from "./logger";
import {
  SkillFrontmatter,
  SkillFile,
  SkillUsageRecord,
  SkillLifecycle,
  SkillAuthor,
  SKILLS_DIR,
  SKILL_USAGE_FILE,
  getDefaultSkillFrontmatter,
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

async function ensureDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(getSkillsDir(), { recursive: true }),
    fs.mkdir(getAgentSkillsDir(), { recursive: true }),
    fs.mkdir(getUserSkillsDir(), { recursive: true }),
  ]);
}

async function readUsage(): Promise<Record<string, SkillUsageRecord>> {
  await ensureDirs();
  const fp = usageFilePath();
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return {};
  }
}

async function writeUsage(usage: Record<string, SkillUsageRecord>): Promise<void> {
  await ensureDirs();
  await fs.writeFile(usageFilePath(), JSON.stringify(usage, null, 2), "utf8");
}

export async function listSkills(author?: SkillAuthor): Promise<SkillFile[]> {
  await ensureDirs();
  const results: SkillFile[] = [];
  const dirs = author === "user" ? [getUserSkillsDir()]
    : author === "agent" ? [getAgentSkillsDir()]
    : [getAgentSkillsDir(), getUserSkillsDir()];

  for (const dir of dirs) {
    try {
      await fs.access(dir);
    } catch {
      continue;
    }
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(dir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const parsed = parseSkillFile(content, filePath);
        if (parsed) results.push(parsed);
      } catch { logger.warn("Failed to parse skill file", { file: filePath }); }
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
        ...getDefaultSkillFrontmatter(),
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

export async function getSkill(name: string): Promise<SkillFile | null> {
  const skills = await listSkills();
  return skills.find(s => s.frontmatter.name === name || path.basename(s.filePath, ".md") === makeSkillFilename(name)) || null;
}

export async function saveSkill(
  name: string,
  description: string,
  body: string,
  author: SkillAuthor = "agent",
  tags: string[] = [],
  complexity: number = 3,
): Promise<SkillFile> {
  await ensureDirs();
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
  await fs.writeFile(filePath, content, "utf8");
  return { frontmatter, body, filePath };
}

export async function deleteSkill(name: string): Promise<boolean> {
  const skill = await getSkill(name);
  if (!skill) return false;
  try {
    await fs.unlink(skill.filePath);
    const usage = await readUsage();
    delete usage[skill.frontmatter.name];
    await writeUsage(usage);
    return true;
  } catch {
    return false;
  }
}

export async function recordSkillUsage(name: string, sessionId: string, success: boolean): Promise<void> {
  const usage = await readUsage();
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
  await writeUsage(usage);
}

export async function getSkillUsage(name: string): Promise<SkillUsageRecord | null> {
  const usage = await readUsage();
  return usage[name] || null;
}

export async function getAllUsage(): Promise<Record<string, SkillUsageRecord>> {
  return readUsage();
}

export async function computeLifecycle(skill: SkillFile): Promise<SkillLifecycle> {
  const usage = await readUsage();
  const record = usage[skill.frontmatter.name];
  if (!record) return "active";
  const lastUsed = new Date(record.lastUsed).getTime();
  const now = Date.now();
  const daysSinceUse = (now - lastUsed) / (1000 * 60 * 60 * 24);
  if (daysSinceUse > ARCHIVE_DAYS) return "archived";
  if (daysSinceUse > STALE_DAYS) return "stale";
  return "active";
}

export async function getStaleSkills(): Promise<SkillFile[]> {
  const skills = await listSkills("agent");
  const results: SkillFile[] = [];
  for (const s of skills) {
    if (await computeLifecycle(s) === "stale") results.push(s);
  }
  return results;
}

export async function getArchivedSkills(): Promise<SkillFile[]> {
  const skills = await listSkills("agent");
  const results: SkillFile[] = [];
  for (const s of skills) {
    if (await computeLifecycle(s) === "archived") results.push(s);
  }
  return results;
}
