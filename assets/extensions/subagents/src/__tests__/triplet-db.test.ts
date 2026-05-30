import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { insertTriplet, queryTriplets, deleteTriplet, closeDb } from "../state-db";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("RDF Triplet Database Operations", () => {
  beforeAll(() => {
    // DB initializes automatically when imported/accessed
  });

  afterAll(() => {
    closeDb();
  });

  it("should insert and query triplets by subject, predicate, and object characteristics", () => {
    const record = {
      id: "trip_001",
      subjectId: "dev_nishant",
      subjectType: "developer",
      subjectLabel: "Nishant",
      predicateType: "PREFERS",
      predicateLabel: "prefers framework",
      objectId: "react_js",
      objectType: "technology",
      objectLabel: "React.js",
      confidenceScore: 0.95,
      sourceSession: "sess_test_123"
    };

    insertTriplet(record);

    // Query by subject
    const q1 = queryTriplets({ subjectId: "dev_nishant" });
    expect(q1.length).toBeGreaterThanOrEqual(1);
    const match = q1.find(t => t.id === "trip_001");
    expect(match).toBeDefined();
    expect(match?.subjectLabel).toBe("Nishant");
    expect(match?.objectId).toBe("react_js");

    // Query by predicate
    const q2 = queryTriplets({ predicateType: "PREFERS" });
    expect(q2.length).toBeGreaterThanOrEqual(1);

    // Query by object
    const q3 = queryTriplets({ objectId: "react_js" });
    expect(q3.length).toBeGreaterThanOrEqual(1);
  });

  it("should delete a triplet successfully", () => {
    const record = {
      id: "trip_002",
      subjectId: "component_app",
      subjectType: "class",
      subjectLabel: "AppContent",
      predicateType: "DEPENDS_ON",
      predicateLabel: "depends on context",
      objectId: "context_chat",
      objectType: "class",
      objectLabel: "ChatContext",
      confidenceScore: 1.0,
      sourceSession: "sess_test_123"
    };

    insertTriplet(record);

    const check1 = queryTriplets({ subjectId: "component_app" });
    expect(check1.find(t => t.id === "trip_002")).toBeDefined();

    const deleted = deleteTriplet("trip_002");
    expect(deleted).toBe(true);

    const check2 = queryTriplets({ subjectId: "component_app" });
    expect(check2.find(t => t.id === "trip_002")).toBeUndefined();
  });
});
