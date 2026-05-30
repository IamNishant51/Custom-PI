import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface StorageDriver {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  listDirectory(dirPath: string): Promise<Array<{ name: string; isDir: boolean; size?: number }>>;
  exists(filePath: string): Promise<boolean>;
}

export class LocalStorageDriver implements StorageDriver {
  constructor(private workingDir: string) {}

  private resolvePath(p: string): string {
    const resolved = path.resolve(this.workingDir, p);
    const relative = path.relative(this.workingDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path traversal denied: ${p} resolves outside working directory`);
    }
    return resolved;
  }

  async readFile(filePath: string): Promise<string> {
    const target = this.resolvePath(filePath);
    return fs.readFile(target, "utf8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const target = this.resolvePath(filePath);
    const parent = path.dirname(target);
    if (!existsSync(parent)) {
      await fs.mkdir(parent, { recursive: true });
    }
    await fs.writeFile(target, content, "utf8");
  }

  async listDirectory(dirPath: string): Promise<Array<{ name: string; isDir: boolean; size?: number }>> {
    const target = this.resolvePath(dirPath);
    const entries = await fs.readdir(target, { withFileTypes: true });
    const results: Array<{ name: string; isDir: boolean; size?: number }> = [];

    for (const ent of entries) {
      const fullPath = path.join(target, ent.name);
      let size = 0;
      if (ent.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          size = stat.size;
        } catch {}
      }
      results.push({
        name: ent.name,
        isDir: ent.isDirectory(),
        size: ent.isFile() ? size : undefined
      });
    }

    return results;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const target = this.resolvePath(filePath);
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
