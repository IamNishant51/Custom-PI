import { SkillFile, SkillLifecycle } from "./skill-types";
import { listSkills, computeLifecycle, getAllUsage } from "./skill-store";

export interface RetrievedSkill {
  skill: SkillFile;
  lifecycle: SkillLifecycle;
  relevanceScore: number;
  useCount: number;
  confidence: number;
}

const LEVEL0_DISPLAY_CHARS = 200;

export async function retrieveSkills(query: string, topK: number = 5): Promise<RetrievedSkill[]> {
  const skills = await listSkills("agent");
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 2);

  const usage = await getAllUsage();
  const scored: RetrievedSkill[] = [];
  for (const s of skills) {
    const lifecycle = await computeLifecycle(s);
    const record = usage[s.frontmatter.name];
    const useCount = record?.useCount || 0;

    let score = 0;
    const nameDesc = (s.frontmatter.name + " " + s.frontmatter.description).toLowerCase();
    const bodyLower = s.body.toLowerCase();

    if (nameDesc.includes(queryLower)) score += 10;

    const matchedInNameDesc = queryTokens.filter(t => nameDesc.includes(t)).length;
    score += matchedInNameDesc * 5;

    const matchedInBody = queryTokens.filter(t => bodyLower.includes(t)).length;
    score += matchedInBody * 2;

    score += Math.min(useCount * 0.5, 5);

    scored.push({ skill: s, lifecycle, relevanceScore: score, useCount, confidence: Math.min(1, score / 20) });
  }

  return scored
    .filter(s => s.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
}

export async function retrieveSkillsWithConfidence(query: string, topK: number = 5, minConfidence: number = 0.7): Promise<RetrievedSkill[]> {
  const results = await retrieveSkills(query, topK);
  return results.filter(s => s.confidence >= minConfidence);
}

export async function retrieveAllSkills(): Promise<RetrievedSkill[]> {
  const skills = await listSkills();
  const usage = await getAllUsage();
  const results: RetrievedSkill[] = [];
  for (const s of skills) {
    results.push({
      skill: s,
      lifecycle: await computeLifecycle(s),
      relevanceScore: 0,
      useCount: (usage[s.frontmatter.name]?.useCount || 0),
      confidence: 0,
    });
  }
  return results;
}

export const LEVEL0_RENDER = Symbol("level0");

export function renderSkillProgressive(skill: SkillFile, level: 0 | 1 = 0): string {
  if (level === 0) {
    const preview = skill.body.slice(0, LEVEL0_DISPLAY_CHARS);
    const truncated = skill.body.length > LEVEL0_DISPLAY_CHARS ? "\n[...]" : "";
    return `**${skill.frontmatter.name}** — ${skill.frontmatter.description}\n${preview}${truncated}`;
  }
  return `---
name: ${skill.frontmatter.name}
description: ${skill.frontmatter.description}
author: ${skill.frontmatter.author}
version: ${skill.frontmatter.version}
tags: ${skill.frontmatter.tags.join(", ")}
complexity: ${skill.frontmatter.complexity}
---

${skill.body}`;
}

export function formatSkillsContextBlock(skills: RetrievedSkill[]): string {
  if (!skills.length) return "";
  const lines = skills.map((s, i) => {
    const tags = s.skill.frontmatter.tags.length ? ` [${s.skill.frontmatter.tags.join(", ")}]` : "";
    const usage = s.useCount > 0 ? ` (used ${s.useCount}x)` : "";
    const confidence = s.confidence > 0 ? ` [confidence: ${(s.confidence * 100).toFixed(0)}%]` : "";
    const preview = s.skill.body.slice(0, 100).replace(/\n/g, " ");
    return `  ${i + 1}. **${s.skill.frontmatter.name}**: ${preview}${tags}${usage}${confidence}`;
  });
  return `\n# RELEVANT SKILLS\n${lines.join("\n")}\n`;
}
