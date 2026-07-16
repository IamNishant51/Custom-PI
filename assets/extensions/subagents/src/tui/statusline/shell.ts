import { spawnSync } from "node:child_process";

interface ShellCommandCache {
  [key: string]: { value: string; expiresAt: number };
}

export class ShellCommandResolver {
  private cache: ShellCommandCache = {};
  private commands: { [name: string]: string } = {};
  private interval: number;

  constructor(config?: { commands?: Record<string, string>; interval?: number }) {
    this.commands = config?.commands || {};
    this.interval = config?.interval || 5000;
  }

  resolve(name: string): string {
    const cmd = this.commands[name];
    if (!cmd) return `<${name}:undefined>`;

    const cached = this.cache[name];
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    try {
      const result = spawnSync(cmd, { shell: true, timeout: 2000, encoding: "utf-8" });
      const value = result.stdout?.trim() || "";
      this.cache[name] = { value, expiresAt: Date.now() + this.interval };
      return value;
    } catch {
      return `<error>`;
    }
  }

  clearCache(): void {
    this.cache = {};
  }
}
