export interface PaletteCommand {
  id: string;
  title: string;
  description: string;
  category: "navigation" | "session" | "view" | "agent" | "settings" | "plugin";
  shortcut?: string;
  icon?: string;
  execute: () => void | Promise<void>;
}

export class CommandRegistry {
  private commands: Map<string, PaletteCommand> = new Map();

  register(cmd: PaletteCommand): void {
    this.commands.set(cmd.id, cmd);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  getAll(): PaletteCommand[] {
    return Array.from(this.commands.values());
  }

  search(query: string): PaletteCommand[] {
    if (!query.trim()) return this.getAll().slice(0, 20);
    const q = query.toLowerCase();
    const results: { cmd: PaletteCommand; score: number }[] = [];
    for (const cmd of this.commands.values()) {
      const titleScore = fuzzyScore(q, cmd.title.toLowerCase());
      const descScore = fuzzyScore(q, cmd.description.toLowerCase());
      const catScore = fuzzyScore(q, cmd.category.toLowerCase());
      const best = Math.max(titleScore, descScore * 0.7, catScore * 0.5);
      if (best > 0) results.push({ cmd, score: best });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 20).map(r => r.cmd);
  }
}

function fuzzyScore(query: string, target: string): number {
  if (target === query) return 100;
  if (target.startsWith(query)) return 80;
  if (target.includes(query)) return 60;
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  if (qi === query.length) return 40 + (query.length / target.length) * 10;
  return 0;
}
