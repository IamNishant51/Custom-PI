import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { logger } from "./logger";

const PRODUCTS_DIR = path.join(os.homedir(), ".pi", "agent", "work-products");

interface WorkProduct {
  id: string;
  timestamp: string;
  sessionId: string;
  agent: string;
  task: string;
  filePath: string;
  action: "create" | "modify" | "delete" | "read";
  size: number;
  hash: string;
  summary: string;
}

function ensureDir(): void {
  if (!fs.existsSync(PRODUCTS_DIR)) fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
}

function productFilePath(): string {
  return path.join(PRODUCTS_DIR, "products.jsonl");
}

function shortHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

let idCounter = 0;

export function recordWorkProduct(
  sessionId: string,
  agent: string,
  task: string,
  filePath: string,
  action: "create" | "modify" | "delete" | "read",
  content?: string,
  summary?: string,
): WorkProduct {
  ensureDir();
  idCounter++;
  const product: WorkProduct = {
    id: `wp_${Date.now()}_${idCounter}`,
    timestamp: new Date().toISOString(),
    sessionId,
    agent,
    task: task.slice(0, 200),
    filePath,
    action,
    size: content ? content.length : 0,
    hash: content ? shortHash(content) : "",
    summary: summary || `${action}d ${path.basename(filePath)}`,
  };

  fs.appendFileSync(productFilePath(), JSON.stringify(product) + "\n", "utf8");
  return product;
}

export function getWorkProducts(sessionId?: string, limit: number = 50): WorkProduct[] {
  ensureDir();
  const fp = productFilePath();
  if (!fs.existsSync(fp)) return [];

  const lines = fs.readFileSync(fp, "utf8").trim().split("\n").filter(Boolean);
  const products: WorkProduct[] = [];
  for (let i = lines.length - 1; i >= 0 && products.length < limit; i--) {
    try {
      const p = JSON.parse(lines[i]) as WorkProduct;
      if (!sessionId || p.sessionId === sessionId) {
        products.push(p);
      }
    } catch { logger.warn("Failed to parse work product entry"); }
  }
  return products;
}

export function getWorkProductSummary(sessionId?: string): string {
  const products = getWorkProducts(sessionId);
  if (!products.length) return "No work products recorded.";

  const created = products.filter(p => p.action === "create").length;
  const modified = products.filter(p => p.action === "modify").length;
  const deleted = products.filter(p => p.action === "delete").length;
  const byAgent = new Map<string, number>();
  for (const p of products) {
    byAgent.set(p.agent, (byAgent.get(p.agent) || 0) + 1);
  }
  const agentSummary = Array.from(byAgent.entries()).map(([a, c]) => `${a}: ${c}`).join(", ");

  return `Work Products: ${products.length} total (${created} created, ${modified} modified, ${deleted} deleted)\nAgents: ${agentSummary}`;
}

export function clearWorkProducts(sessionId?: string): number {
  ensureDir();
  const fp = productFilePath();
  if (!fs.existsSync(fp)) return 0;
  if (!sessionId) {
    const count = fs.readFileSync(fp, "utf8").trim().split("\n").filter(Boolean).length;
    fs.writeFileSync(fp, "", "utf8");
    return count;
  }
  const lines = fs.readFileSync(fp, "utf8").trim().split("\n").filter(Boolean);
  const remaining = lines.filter(l => {
    try { const p = JSON.parse(l); return p.sessionId !== sessionId; } catch { logger.warn("Failed to parse work product during clear"); return true; }
  });
  const removed = lines.length - remaining.length;
  fs.writeFileSync(fp, remaining.join("\n") + "\n", "utf8");
  return removed;
}
