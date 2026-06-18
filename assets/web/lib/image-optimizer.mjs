import fs from "node:fs";
import path from "node:path";

let sharp = null;
try { sharp = (await import("sharp")).default; } catch {}

export function optimizeImage(filePath, format, width) {
  if (!sharp) return null;
  try {
    let pipeline = sharp(filePath);
    if (width) pipeline = pipeline.resize(Number(width), undefined, { withoutEnlargement: true, fit: "inside" });
    if (format === "webp") pipeline = pipeline.webp({ quality: 80 });
    return pipeline;
  } catch { return null; }
}

export function getOptimizedPath(filePath, format, width) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const suffix = format === "webp" ? ".webp" : ext;
  const sizeSuffix = width ? `_w${width}` : "";
  return path.join(dir, `.cache_${base}${sizeSuffix}${suffix}`);
}

export function getCacheHeaders() {
  return { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" };
}

export async function serveOptimizedImage(reply, filePath, format, width) {
  if (!sharp) {
    reply.type(format === "webp" ? "image/webp" : `image/${path.extname(filePath).slice(1)}`);
    reply.send(fs.createReadStream(filePath));
    return;
  }

  const cachePath = getOptimizedPath(filePath, format, width);
  if (fs.existsSync(cachePath)) {
    reply.type(format === "webp" ? "image/webp" : `image/${path.extname(cachePath).slice(1)}`);
    reply.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    reply.header("X-Optimized", "cache-hit");
    reply.send(fs.createReadStream(cachePath));
    return;
  }

  const pipeline = optimizeImage(filePath, format, width);
  if (!pipeline) {
    reply.type(`image/${path.extname(filePath).slice(1)}`);
    reply.send(fs.createReadStream(filePath));
    return;
  }

  const buf = await pipeline.toBuffer();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, buf);

  reply.type(format === "webp" ? "image/webp" : `image/${path.extname(cachePath).slice(1)}`);
  reply.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  reply.header("X-Optimized", "true");
  reply.send(buf);
}
