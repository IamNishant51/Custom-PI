import crypto from "node:crypto";
import { vaultGet } from "./secret-vault";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let _encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer | null {
  if (_encryptionKey) return _encryptionKey;
  try {
    const keyStr = vaultGet("__memory_encryption_key__");
    if (keyStr) {
      const key = Buffer.from(keyStr, "hex");
      if (key.length === 32) {
        _encryptionKey = key;
        return key;
      }
    }
  } catch {}
  return null;
}

async function ensureKey(): Promise<Buffer> {
  const existing = getEncryptionKey();
  if (existing) return existing;
  const key = crypto.randomBytes(32);
  try {
    const { vaultSet } = await import("./secret-vault");
    vaultSet("__memory_encryption_key__", key.toString("hex"));
  } catch {}
  _encryptionKey = key;
  return key;
}

export async function ensureEncryptionKey(): Promise<boolean> {
  if (getEncryptionKey()) return true;
  await ensureKey();
  return true;
}

export function isMemoryEncryptionEnabled(): boolean {
  return !!(process.env.PI_MEMORY_ENCRYPT || getEncryptionKey());
}

export async function encryptMemory(plaintext: string): Promise<string> {
  if (!isMemoryEncryptionEnabled()) return plaintext;
  try {
    const key = await ensureKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, tag, encrypted]);
    return "enc:v1:" + combined.toString("base64");
  } catch {
    return plaintext;
  }
}

export function decryptMemory(ciphertext: string): string {
  if (!ciphertext.startsWith("enc:v1:")) return ciphertext;
  try {
    const key = getEncryptionKey();
    if (!key) return ciphertext;
    const raw = Buffer.from(ciphertext.slice(7), "base64");
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = raw.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return ciphertext;
  }
}
