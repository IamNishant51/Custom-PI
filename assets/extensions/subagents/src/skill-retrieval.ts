import { SkillFile, SkillLifecycle } from "./skill-types";
import { listSkills, computeLifecycle, getAllUsage } from "./skill-store";

export interface RetrievedSkill {
  skill: SkillFile;
  lifecycle: SkillLifecycle;
  relevanceScore: number;
  useCount: number;
}

const LEVEL0_DISPLAY_CHARS = 200;

export function retrieveSkills(query: string, topK: number = 5): RetrievedSkill[] {
  const skills = listSkills("agent");
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 2);

  const scored: RetrievedSkill[] = skills.map(s => {
    const lifecycle = computeLifecycle(s);
    const usage = getAllUsage()[s.frontmatter.name];
    const useCount = usage?.useCount || 0;

    let score = 0;
    const nameDesc = (s.frontmatter.name + " " + s.frontmatter.description).toLowerCase();
    const bodyLower = s.body.toLowerCase();

    // Exact phrase match in name/description
    if (nameDesc.includes(queryLower)) score += 10;

    // Token matches
    const matchedInNameDesc = queryTokens.filter(t => nameDesc.includes(t)).length;
    score += matchedInNameDesc * 5;

    const matchedInBody = queryTokens.filter(t => bodyLower.includes(t)).length;
    score += matchedInBody * 2;

    // Boost for frequently used skills
    score += Math.min(useCount * 0.5, 5);

    return { skill: s, lifecycle, relevanceScore: score, useCount };
  });

  return scored
    .filter(s => s.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
}

export function retrieveAllSkills(): RetrievedSkill[] {
  const skills = listSkills();
  return skills.map(s => ({
    skill: s,
    lifecycle: computeLifecycle(s),
    relevanceScore: 0,
    useCount: (getAllUsage()[s.frontmatter.name]?.useCount || 0),
  }));
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
    const preview = s.skill.body.slice(0, 100).replace(/\n/g, " ");
    return `  ${i + 1}. **${s.skill.frontmatter.name}**: ${preview}${tags}${usage}`;
  });
  return `\n# 🔧 RELEVANT SKILLS\n${lines.join("\n")}\n`;
}
