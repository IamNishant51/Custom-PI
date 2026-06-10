import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import crypto from "node:crypto";

const DB_DIR = path.join(os.homedir(), ".pi", "agent");
const DB_PATH = path.join(DB_DIR, "state-graph.db");

export type NodeType =
  | "session" | "message" | "triplet" | "entity"
  | "task" | "deployment" | "checkpoint"
  | "file" | "function" | "class" | "concept"
  | "service" | "incident" | "rate_limit"
  | "agent" | "tool_call" | "cost_entry"
  | "memory" | "episode" | "skill"
  | "user_preference" | "plan" | "goal"
  | "plugin" | "webhook" | "email"
  | "environment" | "custom";

export type EdgeType =
  | "contains" | "references" | "depends_on"
  | "causes" | "follows" | "precedes"
  | "triggers" | "responds_to" | "extracted_from"
  | "relates_to" | "implements" | "deployed_to"
  | "owned_by" | "created_by" | "modified_by"
  | "resolves" | "blocks" | "duplicates"
  | "derived_from" | "part_of" | "version_of";

interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  properties: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  ttl?: number;
}

interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight: number;
  properties: Record<string, any>;
  createdAt: number;
}

interface GraphQuery {
  nodeType?: NodeType;
  edgeType?: EdgeType;
  label?: string;
  properties?: Record<string, any>;
  limit?: number;
  offset?: number;
}

interface PathResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class PropertyGraph {
  private db: Database;
  private writeQueue = Promise.resolve();

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || DB_PATH;
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("cache_size = -16000");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ttl INTEGER
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        properties TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        label, properties,
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, label, properties) VALUES (new.id, new.label, new.properties);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid) VALUES('delete', old.id);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid) VALUES('delete', old.id);
        INSERT INTO nodes_fts(rowid, label, properties) VALUES (new.id, new.label, new.properties);
      END;
    `);
  }

  addNode(type: NodeType, label: string, properties: Record<string, any> = {}, options?: {
    id?: string;
    ttl?: number;
  }): string {
    const id = options?.id || `node_${crypto.randomUUID().slice(0, 8)}_${Date.now()}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, label, properties, created_at, updated_at, ttl)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, label, JSON.stringify(properties), now, now, options?.ttl || null);
    return id;
  }

  addEdge(
    sourceId: string,
    targetId: string,
    type: EdgeType,
    properties: Record<string, any> = {},
    weight = 1.0,
  ): string {
    const id = `edge_${crypto.randomUUID().slice(0, 8)}_${Date.now()}`;
    this.db.prepare(`
      INSERT OR IGNORE INTO edges (id, source_id, target_id, type, weight, properties, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, targetId, type, weight, JSON.stringify(properties), Date.now());
    return id;
  }

  getNode(id: string): GraphNode | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.mapNode(row);
  }

  getEdge(id: string): GraphEdge | null {
    const row = this.db.prepare("SELECT * FROM edges WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.mapEdge(row);
  }

  queryNodes(query: GraphQuery): GraphNode[] {
    let sql = "SELECT * FROM nodes WHERE 1=1";
    const params: any[] = [];
    if (query.nodeType) { sql += " AND type = ?"; params.push(query.nodeType); }
    if (query.label) { sql += " AND label LIKE ?"; params.push(`%${query.label}%`); }
    if (query.properties) {
      for (const [key, value] of Object.entries(query.properties)) {
        sql += " AND json_extract(properties, ?) = ?";
        params.push(`$.${key}`, JSON.stringify(value));
      }
    }
    sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
    params.push(query.limit || 50, query.offset || 0);
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this.mapNode(r));
  }

  queryEdges(sourceId?: string, targetId?: string, type?: EdgeType): GraphEdge[] {
    let sql = "SELECT * FROM edges WHERE 1=1";
    const params: any[] = [];
    if (sourceId) { sql += " AND source_id = ?"; params.push(sourceId); }
    if (targetId) { sql += " AND target_id = ?"; params.push(targetId); }
    if (type) { sql += " AND type = ?"; params.push(type); }
    sql += " ORDER BY weight DESC, created_at DESC";
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this.mapEdge(r));
  }

  findPath(sourceId: string, targetId: string, maxDepth = 5): PathResult | null {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: { nodes: Set<string>; edges: string[] } }> = [
      { nodeId: sourceId, path: { nodes: new Set([sourceId]), edges: [] } },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);

      const edges = this.queryEdges(current.nodeId);
      for (const edge of edges) {
        if (edge.targetId === targetId || edge.sourceId === targetId) {
          const nodes = new Set([...current.path.nodes, targetId]);
          const nodeMap = new Map<string, GraphNode>();
          for (const nid of nodes) {
            const node = this.getNode(nid);
            if (node) nodeMap.set(nid, node);
          }
          return {
            nodes: Array.from(nodeMap.values()),
            edges: [...current.path.edges, edge.id].map(eid => this.getEdge(eid)!).filter(Boolean),
          };
        }
        if (current.path.nodes.size < maxDepth && !visited.has(edge.targetId)) {
          queue.push({
            nodeId: edge.targetId,
            path: {
              nodes: new Set([...current.path.nodes, edge.targetId]),
              edges: [...current.path.edges, edge.id],
            },
          });
        }
      }
    }
    return null;
  }

  findNeighbors(nodeId: string, maxDepth = 2): PathResult {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id) || current.depth > maxDepth) continue;
      visited.add(current.id);

      const node = this.getNode(current.id);
      if (node) nodes.set(current.id, node);

      const nodeEdges = this.queryEdges(current.id);
      for (const edge of nodeEdges) {
        edges.set(edge.id, edge);
        if (!visited.has(edge.targetId)) {
          queue.push({ id: edge.targetId, depth: current.depth + 1 });
        }
        if (!visited.has(edge.sourceId) && edge.sourceId !== current.id) {
          queue.push({ id: edge.sourceId, depth: current.depth + 1 });
        }
      }
    }

    return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
  }

  searchNodes(query: string, limit = 20): GraphNode[] {
    const q = query.trim().replace(/'/g, "''");
    if (!q) return [];
    const sql = `
      SELECT n.* FROM nodes_fts
      JOIN nodes n ON nodes_fts.rowid = n.id
      WHERE nodes_fts MATCH ?
      ORDER BY rank LIMIT ?
    `;
    return (this.db.prepare(sql).all(q, limit) as any[]).map(r => this.mapNode(r));
  }

  updateNode(id: string, updates: Partial<Omit<GraphNode, "id" | "createdAt">>): boolean {
    const existing = this.getNode(id);
    if (!existing) return false;
    const properties = updates.properties !== undefined
      ? { ...existing.properties, ...updates.properties }
      : existing.properties;
    const label = updates.label ?? existing.label;
    const type = updates.type ?? existing.type;
    const ttl = updates.ttl ?? existing.ttl;
    this.db.prepare(`
      UPDATE nodes SET type = ?, label = ?, properties = ?, updated_at = ?, ttl = ?
      WHERE id = ?
    `).run(type, label, JSON.stringify(properties), Date.now(), ttl, id);
    return true;
  }

  deleteNode(id: string): boolean {
    this.db.prepare("DELETE FROM edges WHERE source_id = ? OR target_id = ?").run(id, id);
    const result = this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
    return result.changes > 0;
  }

  deleteEdge(id: string): boolean {
    const result = this.db.prepare("DELETE FROM edges WHERE id = ?").run(id);
    return result.changes > 0;
  }

  countNodes(type?: NodeType): number {
    if (type) {
      const row = this.db.prepare("SELECT COUNT(*) as c FROM nodes WHERE type = ?").get(type) as any;
      return row?.c || 0;
    }
    const row = this.db.prepare("SELECT COUNT(*) as c FROM nodes").get() as any;
    return row?.c || 0;
  }

  countEdges(type?: EdgeType): number {
    if (type) {
      const row = this.db.prepare("SELECT COUNT(*) as c FROM edges WHERE type = ?").get(type) as any;
      return row?.c || 0;
    }
    const row = this.db.prepare("SELECT COUNT(*) as c FROM edges").get() as any;
    return row?.c || 0;
  }

  getNodeTypes(): NodeType[] {
    return (this.db.prepare("SELECT DISTINCT type FROM nodes ORDER BY type").all() as any[]).map(r => r.type);
  }

  getEdgeTypes(): EdgeType[] {
    return (this.db.prepare("SELECT DISTINCT type FROM edges ORDER BY type").all() as any[]).map(r => r.type);
  }

  pruneExpired(): number {
    const now = Date.now();
    const expired = this.db.prepare("SELECT id FROM nodes WHERE ttl IS NOT NULL AND ttl < ?").all(now) as any[];
    for (const row of expired) {
      this.deleteNode(row.id);
    }
    return expired.length;
  }

  close(): void {
    try { this.db.close(); } catch {}
  }

  private mapNode(row: any): GraphNode {
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      properties: JSON.parse(row.properties || "{}"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ttl: row.ttl || undefined,
    };
  }

  private mapEdge(row: any): GraphEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type,
      weight: row.weight,
      properties: JSON.parse(row.properties || "{}"),
      createdAt: row.created_at,
    };
  }
}

let _graph: PropertyGraph | null = null;
export function getGraph(dbPath?: string): PropertyGraph {
  if (!_graph) _graph = new PropertyGraph(dbPath);
  return _graph;
}

export function closeGraph(): void {
  if (_graph) { _graph.close(); _graph = null; }
}
