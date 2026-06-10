import crypto from "node:crypto";
import { getSystemStore, type WorkProduct } from "./system-store";
import { logger } from "./logger";

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
    summary: summary || `${action}d ${filePath.split("/").pop() || filePath}`,
  };

  try {
    getSystemStore().appendWorkProduct(product);
  } catch (err) {
    logger.warn("Failed to persist work product", { error: String(err) });
  }

  return product;
}

export function getWorkProducts(sessionId?: string): WorkProduct[] {
  try {
    return getSystemStore().getWorkProducts(sessionId);
  } catch (err) {
    logger.warn("Failed to read work products", { error: String(err) });
    return [];
  }
}

export function getWorkProductSummary(sessionId?: string): string {
  const products = getWorkProducts(sessionId);
  if (products.length === 0) return "No work products recorded.";
  const byAction: Record<string, number> = {};
  for (const p of products) {
    byAction[p.action] = (byAction[p.action] || 0) + 1;
  }
  const lines = ["Work Products:"];
  for (const [action, count] of Object.entries(byAction)) {
    const label = action === "modify" ? "modified" : `${action}d`;
    lines.push(`  ${count} ${label}`);
  }
  return lines.join("\n");
}

export function clearWorkProducts(sessionId?: string): number {
  try {
    const store = getSystemStore();
    const before = store.getWorkProducts(sessionId).length;
    store.clearWorkProducts(sessionId);
    return before;
  } catch (err) {
    logger.warn("Failed to clear work products", { error: String(err) });
    return 0;
  }
}
