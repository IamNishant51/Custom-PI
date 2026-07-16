import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const KITTY_CHUNK_SIZE = 4096;

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "image/png";
}

export function supportsKittyProtocol(): boolean {
  return (
    (process.env.TERM || "").toLowerCase() === "xterm-kitty" ||
    (process.env.TERM_PROGRAM || "").toLowerCase() === "kitty"
  );
}

export function supportsITerm2Protocol(): boolean {
  return (process.env.TERM_PROGRAM || "").toLowerCase() === "iterm.app";
}

export async function emitKittyImage(
  filePath: string,
  opts?: { width?: number }
): Promise<void> {
  const data = await readFile(filePath);
  const mime = getMimeType(filePath);
  const b64 = data.toString("base64");
  const totalChunks = Math.ceil(b64.length / KITTY_CHUNK_SIZE);

  const payload: string[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunk = b64.slice(i * KITTY_CHUNK_SIZE, (i + 1) * KITTY_CHUNK_SIZE);
    const isLast = i === totalChunks - 1;
    const more = isLast ? "0" : "1";

    const params: string[] = [
      `a=T`,
      `f=100`,
      `m=${more}`,
    ];

    if (i === 0) {
      params.push(`t=${mime}`);
      if (opts?.width) {
        params.push(`w=${opts.width}`);
      }
    }

    payload.push(`\x1b_G${params.join(",")};${chunk}\x1b\\`);
  }

  process.stdout.write(payload.join(""));
}

export async function emitInlineImage(filePath: string): Promise<string> {
  if (supportsKittyProtocol()) {
    await emitKittyImage(filePath);
    return "";
  }

  if (supportsITerm2Protocol()) {
    const data = await readFile(filePath);
    const filename = filePath.split("/").pop() || "image";
    const mime = getMimeType(filePath);
    const b64 = data.toString("base64");
    const seq = `\x1b]1337;File=inline=1;width=auto;height=auto;filename=${encodeURIComponent(filename)};mime=${mime}:${b64}\x07`;
    return seq;
  }

  return `[Image: ${filePath}]`;
}
