import fs from "node:fs";
import path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

export function shouldRotate(filePath: string, maxSize: number = DEFAULT_MAX_SIZE): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.size >= maxSize;
  } catch {
    return false;
  }
}

export function rotateFile(filePath: string, maxFiles: number = DEFAULT_MAX_FILES): string {
  if (!fs.existsSync(filePath)) return filePath;

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  for (let i = maxFiles - 1; i >= 1; i--) {
    const oldPath = path.join(dir, `${base}.${i}${ext}.gz`);
    const newPath = path.join(dir, `${base}.${i + 1}${ext}.gz`);
    if (fs.existsSync(oldPath)) {
      if (i === maxFiles - 1) {
        fs.unlinkSync(oldPath);
      } else {
        fs.renameSync(oldPath, newPath);
      }
    }
  }

  const firstPath = path.join(dir, `${base}.1${ext}.gz`);
  fs.renameSync(filePath, firstPath);

  const gzip = createGzip();
  const source = createReadStream(firstPath);
  const tempPath = firstPath + ".tmp";
  const dest = createWriteStream(tempPath);

  return new Promise((resolve, reject) => {
    pipeline(source, gzip, dest)
      .then(() => {
        fs.renameSync(tempPath, firstPath);
        resolve(filePath);
      })
      .catch(reject);
  }) as unknown as string;
}

export async function rotateIfNeeded(
  filePath: string,
  maxSize: number = DEFAULT_MAX_SIZE,
  maxFiles: number = DEFAULT_MAX_FILES,
): Promise<boolean> {
  if (shouldRotate(filePath, maxSize)) {
    await rotateFile(filePath, maxFiles);
    return true;
  }
  return false;
}

export function getLogFiles(dir: string, baseName: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const pattern = new RegExp(`^${baseName}(\\.\\d+)?\\.(log|txt|jsonl|md)(\\.gz)?$`);
  return files
    .filter(f => pattern.test(f))
    .map(f => path.join(dir, f))
    .sort();
}

export function totalLogSize(dir: string, baseName: string): number {
  return getLogFiles(dir, baseName).reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);
}
