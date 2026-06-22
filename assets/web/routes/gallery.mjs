import path from "node:path";
import fs from "node:fs";
import { SHARED_PATHS } from "../shared-constants.mjs";
import { serveOptimizedImage } from "../lib/image-optimizer.mjs";

const { PI_DIR, ASSETS_DIR } = SHARED_PATHS;

export default function registerGallery(app, { sendError }) {
  const ALLOWED_EXTENSIONS = /^\.(png|jpg|jpeg|gif|webp|bmp)$/i;
  const MIME_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };

  function resolveAssetPath(filename) {
    if (!filename || typeof filename !== "string") return null;
    const resolved = path.resolve(ASSETS_DIR, path.basename(filename));
    if (!resolved.startsWith(ASSETS_DIR)) return null;
    if (!ALLOWED_EXTENSIONS.test(path.extname(resolved))) return null;
    return resolved;
  }

  app.get("/api/assets", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            assets: { type: "array" },
          },
        },
      },
    },
  }, async () => {
    try {
      if (!fs.existsSync(ASSETS_DIR)) return { assets: [] };
      const files = fs.readdirSync(ASSETS_DIR).filter(f => ALLOWED_EXTENSIONS.test(path.extname(f)));
      const assets = files.map(f => {
        const stat = fs.statSync(path.join(ASSETS_DIR, f));
        return { filename: f, size: stat.size, created: stat.birthtime || stat.mtime };
      }).sort((a, b) => new Date(b.created) - new Date(a.created));
      return { assets };
    } catch { return { assets: [] }; }
  });

  app.delete("/api/assets/:filename", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
          },
        },
      },
    },
  }, async (req) => {
    const filePath = resolveAssetPath(req.params.filename);
    if (!filePath) throw new Error("Security Check Failed: Invalid filename");
    if (!fs.existsSync(filePath)) throw new Error("File not found");
    fs.unlinkSync(filePath);
    return { ok: true };
  });

  const GALLERY_DIR = path.join(PI_DIR, "gallery");
  const GALLERY_EXT = /^\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i;
  const GALLERY_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml" };

  app.get("/api/gallery", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            images: { type: "array" },
          },
        },
      },
    },
  }, async () => {
    try {
      if (!fs.existsSync(GALLERY_DIR)) return { images: [] };
      const files = fs.readdirSync(GALLERY_DIR).filter(f => GALLERY_EXT.test(path.extname(f)));
      return { images: files.sort() };
    } catch { return { images: [] }; }
  });

  app.post("/api/gallery/upload", {
    schema: {
      body: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: { type: "string" },
          data: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const { name, data } = req.body || {};
    if (!data) { reply.status(400).send("No file data"); return; }
    const filename = name || `image_${Date.now()}.png`;
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!GALLERY_EXT.test(path.extname(safeName))) { reply.status(400).send("Invalid extension"); return; }
    fs.mkdirSync(GALLERY_DIR, { recursive: true });
    const buf = Buffer.from(data, "base64");
    fs.writeFileSync(path.join(GALLERY_DIR, safeName), buf);
    return { success: true, name: safeName };
  });

  app.get("/api/gallery/:filename", async (req, reply) => {
    const name = path.basename(req.params.filename);
    const filePath = path.join(GALLERY_DIR, name);
    if (!name || !fs.existsSync(filePath)) { reply.status(404).send("Not found"); return; }
    const ext = path.extname(name).toLowerCase();
    const format = req.query?.format || ext.slice(1);
    const width = req.query?.w || null;
    if (format === "webp" || width) {
      await serveOptimizedImage(reply, filePath, format, width);
      return;
    }
    reply.type(GALLERY_MIME[ext] || "application/octet-stream");
    reply.send(fs.readFileSync(filePath));
  });

  app.get("/api/assets/files/:filename", async (req, reply) => {
    const filePath = resolveAssetPath(req.params.filename);
    if (!filePath) { reply.status(400).send("Security Check Failed: Invalid filename"); return; }
    if (!fs.existsSync(filePath)) { reply.status(404).send("Not found"); return; }
    const format = req.query?.format || "original";
    const width = req.query?.w || null;
    if (format !== "original" || width) {
      await serveOptimizedImage(reply, filePath, format === "webp" ? "webp" : null, width);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    reply.type(mime);
    reply.send(fs.createReadStream(filePath));
  });

  app.delete("/api/gallery/:filename", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async (req) => {
    const name = path.basename(req.params.filename);
    const filePath = path.join(GALLERY_DIR, name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  });
}
