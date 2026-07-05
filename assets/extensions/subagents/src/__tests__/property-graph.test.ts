import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PropertyGraph } from "../state-graph/property-graph";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

describe("PropertyGraph", () => {
  let graph: PropertyGraph;
  const testDbPath = path.join(os.tmpdir(), `test-property-graph-${Date.now()}.db`);

  beforeEach(() => {
    graph = new PropertyGraph(testDbPath);
  });

  afterEach(() => {
    graph.close();
    try { fs.unlinkSync(testDbPath); } catch {}
    try { fs.unlinkSync(testDbPath + "-wal"); } catch {}
    try { fs.unlinkSync(testDbPath + "-shm"); } catch {}
  });

  it("adds and retrieves nodes", () => {
    const id = graph.addNode("session", "Test Session", { userId: "user1" });
    const node = graph.getNode(id);
    expect(node).not.toBeNull();
    expect(node!.type).toBe("session");
    expect(node!.label).toBe("Test Session");
    expect(node!.properties.userId).toBe("user1");
  });

  it("adds and retrieves edges", () => {
    const a = graph.addNode("entity", "Node A");
    const b = graph.addNode("entity", "Node B");
    const eid = graph.addEdge(a, b, "relates_to", { reason: "test" }, 0.5);
    const edge = graph.getEdge(eid);
    expect(edge).not.toBeNull();
    expect(edge!.sourceId).toBe(a);
    expect(edge!.targetId).toBe(b);
    expect(edge!.type).toBe("relates_to");
    expect(edge!.weight).toBe(0.5);
  });

  it("queries nodes by type", () => {
    graph.addNode("session", "S1");
    graph.addNode("session", "S2");
    graph.addNode("message", "M1");
    const sessions = graph.queryNodes({ nodeType: "session" });
    expect(sessions).toHaveLength(2);
  });

  it("queries nodes by label", () => {
    graph.addNode("entity", "Important Thing");
    graph.addNode("entity", "Another Thing");
    const results = graph.queryNodes({ label: "Important" });
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("Important Thing");
  });

  it("queries edges by source", () => {
    const a = graph.addNode("entity", "A");
    const b = graph.addNode("entity", "B");
    const c = graph.addNode("entity", "C");
    graph.addEdge(a, b, "contains");
    graph.addEdge(a, c, "contains");
    const edges = graph.queryEdges(a);
    expect(edges).toHaveLength(2);
  });

  it("finds paths between nodes", () => {
    const a = graph.addNode("entity", "A");
    const b = graph.addNode("entity", "B");
    const c = graph.addNode("entity", "C");
    graph.addEdge(a, b, "relates_to");
    graph.addEdge(b, c, "relates_to");
    const pathResult = graph.findPath(a, c);
    expect(pathResult).not.toBeNull();
    expect(pathResult!.nodes).toHaveLength(3);
    expect(pathResult!.edges).toHaveLength(2);
  });

  it("finds neighbors", () => {
    const a = graph.addNode("entity", "Center");
    const b = graph.addNode("entity", "Neighbor1");
    const c = graph.addNode("entity", "Neighbor2");
    graph.addEdge(a, b, "relates_to");
    graph.addEdge(a, c, "relates_to");
    const neighbors = graph.findNeighbors(a);
    expect(neighbors.nodes).toHaveLength(3);
    expect(neighbors.edges).toHaveLength(2);
  });

  it("updates node properties", () => {
    const id = graph.addNode("entity", "Original", { status: "pending" });
    const updated = graph.updateNode(id, { properties: { status: "done" } });
    expect(updated).toBe(true);
    const node = graph.getNode(id);
    expect(node!.properties.status).toBe("done");
  });

  it("deletes nodes and cascades edges", () => {
    const a = graph.addNode("entity", "A");
    const b = graph.addNode("entity", "B");
    graph.addEdge(a, b, "relates_to");
    expect(graph.deleteNode(a)).toBe(true);
    const edges = graph.queryEdges(a);
    expect(edges).toHaveLength(0);
  });

  it("deletes edges", () => {
    const a = graph.addNode("entity", "A");
    const b = graph.addNode("entity", "B");
    const eid = graph.addEdge(a, b, "relates_to");
    expect(graph.deleteEdge(eid)).toBe(true);
    expect(graph.getEdge(eid)).toBeNull();
  });

  it("counts nodes and edges", () => {
    const aId = graph.addNode("entity", "A");
    const bId = graph.addNode("entity", "B");
    graph.addNode("session", "S");
    graph.addEdge(aId, bId, "relates_to");
    expect(graph.countNodes()).toBe(3);
    expect(graph.countNodes("entity")).toBe(2);
  });

  it("returns distinct node types", () => {
    graph.addNode("session", "S");
    graph.addNode("message", "M");
    graph.addNode("entity", "E");
    const types = graph.getNodeTypes();
    expect(types).toContain("session");
    expect(types).toContain("message");
    expect(types).toContain("entity");
  });

  it("prunes expired nodes", () => {
    graph.addNode("session", "Expired", { data: "x" }, { ttl: Date.now() - 1000 });
    graph.addNode("session", "Fresh", { data: "y" });
    const pruned = graph.pruneExpired();
    expect(pruned).toBe(1);
    expect(graph.countNodes()).toBe(1);
  });

  it("searches nodes via FTS", () => {
    graph.addNode("entity", "Docker Configuration");
    graph.addNode("entity", "Kubernetes Deployment");
    graph.addNode("entity", "Node.js Server");
    const results = graph.searchNodes("Docker");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(n => n.label.includes("Docker"))).toBe(true);
  });
});
