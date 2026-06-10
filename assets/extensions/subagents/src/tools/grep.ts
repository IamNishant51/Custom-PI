import fs from "node:fs";
import path from "node:path";

const MAX_GREP_FILE_SIZE = 50 * 1024 * 1024;

export async function localGrep(pattern: string, dirOrFile: string, maxResults = 1000): Promise<string> {
  const results: string[] = [];
  let count = 0;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, "i");
  }
  const absPath = path.resolve(dirOrFile);

  async function walk(currentPath: string): Promise<void> {
    if (count >= maxResults) return;
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(currentPath); } catch { return; }
    if (stat.isFile()) {
      if (stat.size > MAX_GREP_FILE_SIZE) return;
      try {
        const content = await fs.promises.readFile(currentPath, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && count < maxResults; i++) {
          if (regex.test(lines[i])) {
            results.push(`${currentPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            count++;
          }
        }
      } catch { /* skip unreadable */ }
    } else if (stat.isDirectory()) {
      let entries: string[];
      try { entries = await fs.promises.readdir(currentPath); } catch { return; }
      const children = entries.map(e => path.join(currentPath, e));
      const filtered = children.filter(c => {
        const base = path.basename(c);
        return base !== "node_modules" && base !== ".git" && base !== "dist";
      });
      await Promise.all(filtered.map(walk));
    }
  }

  await walk(absPath);
  return results.join("\n") || "No matches found.";
}
