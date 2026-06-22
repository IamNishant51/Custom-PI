import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerModelDownload(app, { sendError }) {
  const MODELS_DOWNLOAD_DIR = path.join(PI_DIR, "downloaded-models");

  app.post("/api/models/download", {
    schema: {
      body: {
        type: "object",
        additionalProperties: true,
        properties: {
          modelId: { type: "string" },
          source: { type: "string" },
        },
      },
    },
  }, async (req) => {
    const { modelId, source } = req.body || {};
    if (!modelId) return { error: "modelId required" };
    const src = source || "huggingface";
    try {
      fs.mkdirSync(MODELS_DOWNLOAD_DIR, { recursive: true });
      const targetDir = path.join(MODELS_DOWNLOAD_DIR, modelId.replace(/[^a-zA-Z0-9_-]/g, "_"));
      if (fs.existsSync(targetDir)) return { success: true, path: targetDir, message: "Already downloaded" };
      const cmds = [
        `huggingface-cli download ${modelId} --local-dir "${targetDir}" --quiet 2>/dev/null`,
        `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://huggingface.co/${modelId} "${targetDir}" 2>/dev/null`,
      ];
      for (const cmd of cmds) {
        try {
          execSync(cmd, { timeout: 300000, cwd: MODELS_DOWNLOAD_DIR });
          if (fs.existsSync(targetDir)) return { success: true, path: targetDir, message: `Downloaded ${modelId}` };
        } catch {}
      }
      const dlRecord = path.join(MODELS_DOWNLOAD_DIR, "downloads.json");
      const records = JSON.parse(fs.readFileSync(dlRecord, "utf8").catch(() => "[]"));
      records.push({ modelId, source: src, timestamp: Date.now(), status: "pending" });
      fs.writeFileSync(dlRecord, JSON.stringify(records, null, 2));
      return { success: true, message: `Download queued for ${modelId}. Run: huggingface-cli download ${modelId}` };
    } catch (e) { return { error: e.message, success: false }; }
  });

  app.get("/api/models/downloads", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            downloads: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  }, async () => {
    const records = []; const dlRecord = path.join(MODELS_DOWNLOAD_DIR, "downloads.json");
    try { records.push(...JSON.parse(fs.readFileSync(dlRecord, "utf8"))); } catch {}
    try {
      const dirs = fs.readdirSync(MODELS_DOWNLOAD_DIR).filter(d => d !== "downloads.json");
      for (const dir of dirs) records.push({ modelId: dir, path: path.join(MODELS_DOWNLOAD_DIR, dir), status: "downloaded" });
    } catch {}
    return { downloads: records };
  });

  const VOTES_FILE = path.join(PI_DIR, "model-votes.json");
  function loadVotes() {
    try { return JSON.parse(fs.readFileSync(VOTES_FILE, "utf8")); } catch { return []; }
  }

  app.post("/api/models/vote", {
    schema: {
      body: {
        type: "object",
        additionalProperties: true,
        properties: {
          promptId: { type: "string" },
          winner: { type: "string" },
          loser: { type: "string" },
        },
      },
    },
  }, async (req) => {
    const { promptId, winner, loser } = req.body || {};
    if (!promptId || !winner) return { error: "promptId and winner required" };
    const votes = loadVotes();
    votes.push({ promptId, winner, loser: loser || null, votedAt: Date.now() });
    fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2));
    return { success: true };
  });

  app.get("/api/models/votes", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            votes: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  }, async () => ({ votes: loadVotes() }));

  app.get("/api/models/rankings", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            votes: { type: "number" },
            rankings: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  }, async () => {
    const votes = loadVotes();
    const stats = {};
    for (const v of votes) {
      if (!stats[v.winner]) stats[v.winner] = { wins: 0, losses: 0, total: 0 };
      if (v.loser && !stats[v.loser]) stats[v.loser] = { wins: 0, losses: 0, total: 0 };
      stats[v.winner].wins++; stats[v.winner].total++;
      if (v.loser) { stats[v.loser].losses++; stats[v.loser].total++; }
    }
    const ranked = Object.entries(stats).map(([model, s]) => ({ model, ...s, winRate: s.total > 0 ? Math.round(s.wins / s.total * 100) : 0 })).sort((a, b) => b.winRate - a.winRate);
    return { votes: votes.length, rankings: ranked };
  });
}
