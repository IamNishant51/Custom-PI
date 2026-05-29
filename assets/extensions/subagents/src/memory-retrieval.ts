import { getTopByPriority, getRecent, stats } from "./memory-store";

export function buildMemoryContextBlock(projectDir: string): string {
  const top = getTopByPriority(5, projectDir);
  const byImportance = top.length > 0 ? top : getRecent(5);
  const valid = byImportance.filter(e => e.importance >= 3 && !e.deprecated);
  if (!valid.length) return "";

  const lines = valid.map(e => {
    const icon =
      e.type === "fact" ? "" :
      e.type === "decision" ? "⚡" :
      e.type === "preference" ? "💡" : "";
    const confidence = e.retrievalCount > 0
      ? `(confidence: ${Math.round((e.retrievalSuccessCount / e.retrievalCount) * 100)}%)`
      : "(new)";
    return `  ${icon}[${e.type}] ${e.content} (project: ${e.project}, importance: ${e.importance}) ${confidence}`;
  });

  return `\n# 🧠 PERSISTENT MEMORY - RECENT KNOWLEDGE\nBelow are recently accessed persistent memory entries. Use them for context but verify critical facts. If the user asks about something not listed here, use the memory_search tool to check. If nothing is found, say so honestly.\n${lines.join("\n")}\n`;
}
