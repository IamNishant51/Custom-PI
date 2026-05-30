export type SkillAuthor = "agent" | "user";

export interface SkillFrontmatter {
  name: string;
  description: string;
  author: SkillAuthor;
  created: string;
  updated: string;
  version: number;
  tags: string[];
  complexity: number;
  dependencies?: string[];
  example?: string;
}

export interface SkillFile {
  frontmatter: SkillFrontmatter;
  body: string;
  filePath: string;
}

export interface SkillUsageRecord {
  name: string;
  lastUsed: string;
  useCount: number;
  sessionsUsed: string[];
  successRate: number;
}

export type SkillLifecycle = "active" | "stale" | "archived";

export const SKILLS_DIR = ".pi/skills";
export const SKILL_USAGE_FILE = ".skill-usage.json";

export const DEFAULT_SKILL_FRONTMATTER: Omit<SkillFrontmatter, "name" | "description"> = {
  author: "agent",
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  version: 1,
  tags: [],
  complexity: 3,
};

export const STALE_DAYS = 30;
export const ARCHIVE_DAYS = 90;

export function makeSkillFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, "_") + ".md";
}
