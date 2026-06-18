import path from "node:path";
import { getOrCreateDb } from "../services/db.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;
const STATE_DB_PATH = path.join(PI_DIR, "session-state.db");

export default function registerKnowledgeGraph(app, { sendError }) {
  app.get("/api/knowledge/triplets", async (req) => {
    try {
      const db = getOrCreateDb(STATE_DB_PATH);
      if (!db) return { error: "Database not available", triplets: [], count: 0 };
      const minConf = req.query?.minConfidence ?? 0.5;
      const limit = Math.min(parseInt(req.query?.limit ?? "50"), 200);
      const rows = db.prepare(`
        SELECT id, subject_id, subject_type, subject_label,
               predicate_type, predicate_label, object_id, object_type, object_label,
               confidence_score, last_updated
        FROM triplets
        WHERE confidence_score >= ?
        ORDER BY confidence_score DESC, last_updated DESC
        LIMIT ?
      `).all(minConf, limit);
      return { triplets: rows, count: rows.length };
    } catch (e) {
      return { error: e.message, triplets: [], count: 0 };
    }
  });

  app.get("/api/knowledge/entity", async (req) => {
    try {
      const id = req.query?.id;
      if (!id) return { error: "id parameter required" };
      const db = getOrCreateDb(STATE_DB_PATH);
      if (!db) return { error: "Database not available" };
      const entityRow = db.prepare(`
        SELECT subject_id AS id, subject_label AS label, subject_type AS type
        FROM triplets WHERE subject_id = ? LIMIT 1
      `).get(id);
      if (!entityRow) {
        const objRow = db.prepare(`
          SELECT object_id AS id, object_label AS label, object_type AS type
          FROM triplets WHERE object_id = ? LIMIT 1
        `).get(id);
        if (!objRow) return { error: "Entity not found" };
        const outgoing = db.prepare(`
          SELECT * FROM triplets WHERE subject_id = ? ORDER BY confidence_score DESC
        `).all(id);
        return { entity: objRow, outgoing, incoming: [] };
      }
      const outgoing = db.prepare(`
        SELECT * FROM triplets WHERE subject_id = ? ORDER BY confidence_score DESC
      `).all(id);
      const incoming = db.prepare(`
        SELECT * FROM triplets WHERE object_id = ? ORDER BY confidence_score DESC
      `).all(id);
      return { entity: entityRow, outgoing, incoming };
    } catch (e) {
      return { error: e.message };
    }
  });
}
