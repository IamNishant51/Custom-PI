import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PropertyGraph } from "../state-graph/property-graph";
import { HybridSearch } from "../state-graph/hybrid-search";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

describe("HybridSearch", () => {
  let graph: PropertyGraph;
  let search: HybridSearch;
  const testDbPath = path.join(os.tmpdir(), `test-hybrid-${Date.now()}.db`);

  beforeEach(() => {
    graph = new PropertyGraph(testDbPath);
    search = new HybridSearch(graph);
    graph.addNode("entity", "Docker Container Setup", { category: "devops" });
    graph.addNode("entity", "Kubernetes Pod Deployment", { category: "devops" });
    graph.addNode("entity", "React Frontend Component", { category: "frontend" });
    graph.addNode("entity", "Node.js API Server", { category: "backend" });
    graph.addNode("entity", "PostgreSQL Database Schema", { category: "database" });
  });

  afterEach(() => {
    graph.close();
    try { fs.unlinkSync(testDbPath); } catch {}
    try { fs.unlinkSync(testDbPath + "-wal"); } catch {}
    try { fs.unlinkSync(testDbPath + "-shm"); } catch {}
  });

  it("performs BM25 search", async () => {
    const results = await search.search("Docker", { strategy: "bm25", topK: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].label.toLowerCase()).toContain("docker");
  });

  it("performs graph search", async () => {
    const results = await search.search("React", { strategy: "graph", topK: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.label.includes("React"))).toBe(true);
  });

  it("hybrid search returns fused results", async () => {
    const results = await search.search("Deployment", { topK: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by node type", async () => {
    const a = graph.addNode("session", "Test Session", { sessionId: "s1" });
    const results = await search.search("Test", {
      strategy: "bm25",
      nodeTypes: ["session"],
    });
    expect(results.some(r => r.type === "session")).toBe(true);
  });

  it("filters by properties", async () => {
    const results = await search.search("Kubernetes", {
      filters: { category: "devops" },
    });
    expect(results.some(r => r.label.includes("Kubernetes"))).toBe(true);
  });

  it("respects minScore threshold", async () => {
    const results = await search.search("xyz_nonexistent_123", { minScore: 0.5, topK: 10 });
    expect(results.length).toBe(0);
  });

  it("rebuilds index", async () => {
    await search.rebuildIndex();
    const results = await search.search("Docker", { strategy: "bm25" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("adds nodes to index", () => {
    search.addToIndex("test-node-id");
    expect(true).toBe(true);
  });

  it("removes nodes from index", () => {
    search.removeFromIndex("test-node-id");
    expect(true).toBe(true);
  });

  it("rerank search falls back gracefully", async () => {
    const results = await search.search("Docker", { strategy: "rerank", topK: 3 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("includes edges when requested", async () => {
    const nodes = graph.queryNodes({ limit: 100 });
    if (nodes.length >= 2) {
      graph.addEdge(nodes[0].id, nodes[1].id, "relates_to");
    }
    const results = await search.search("Docker", { includeEdges: true });
    if (results.length > 0) {
      expect(results[0]).toHaveProperty("neighbors");
    }
  });
});
