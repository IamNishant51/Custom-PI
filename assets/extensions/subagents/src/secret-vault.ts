import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const VAULT_DIR = path.join(os.homedir(), ".pi", "agent", ".vault");
const KEY_FILE = path.join(VAULT_DIR, "master.key");
const VAULT_FILE = path.join(VAULT_DIR, "vault.json");
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SCHEME = "local_encrypted_v1";

interface EncryptedMaterial {
  scheme: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface VaultData {
  entries: Record<string, EncryptedMaterial>;
  version: number;
}

function ensureVaultDir(): void {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
}

function getMasterKey(): Buffer {
  // Allow override via env var (more secure than file on shared systems)
  const envKey = process.env.CUSTOM_PI_VAULT_KEY || process.env.PI_VAULT_KEY;
  if (envKey) {
    const decoded = Buffer.from(envKey, "hex");
    if (decoded.length === KEY_LENGTH) return decoded;
  }
  ensureVaultDir();
  if (fs.existsSync(KEY_FILE)) {
    const keyRaw = fs.readFileSync(KEY_FILE, "utf8").trim();
    return Buffer.from(keyRaw, "hex");
  }
  const key = crypto.randomBytes(KEY_LENGTH);
  fs.writeFileSync(KEY_FILE, key.toString("hex"), "utf8");
  fs.chmodSync(KEY_FILE, 0o600);
  return key;
}

function readVault(): VaultData {
  ensureVaultDir();
  if (!fs.existsSync(VAULT_FILE)) {
    return { entries: {}, version: 1 };
  }
  try {
    return JSON.parse(fs.readFileSync(VAULT_FILE, "utf8"));
  } catch {
    return { entries: {}, version: 1 };
  }
}

function writeVault(data: VaultData): void {
  ensureVaultDir();
  const tmp = VAULT_FILE + ".tmp." + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, VAULT_FILE);
}

function encrypt(plaintext: string, key: Buffer): EncryptedMaterial {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    scheme: SCHEME,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

function decrypt(material: EncryptedMaterial, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(material.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(material.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(material.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export interface SecretEntry {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export function vaultSet(key: string, value: string): void {
  const masterKey = getMasterKey();
  const vault = readVault();
  const material = encrypt(value, masterKey);
  vault.entries[key] = material;
  writeVault(vault);
}

export function vaultGet(key: string): string | null {
  const masterKey = getMasterKey();
  const vault = readVault();
  const material = vault.entries[key];
  if (!material) return null;
  try {
    return decrypt(material, masterKey);
  } catch {
    return null;
  }
}

export function vaultDelete(key: string): boolean {
  const vault = readVault();
  if (!vault.entries[key]) return false;
  delete vault.entries[key];
  writeVault(vault);
  return true;
}

export function vaultList(): string[] {
  const vault = readVault();
  return Object.keys(vault.entries);
}

export function vaultHas(key: string): boolean {
  const vault = readVault();
  return key in vault.entries;
}

export function vaultExists(): boolean {
  return fs.existsSync(VAULT_FILE) && fs.existsSync(KEY_FILE);
}

export function vaultHealth(): { ok: boolean; message: string } {
  try {
    if (!fs.existsSync(KEY_FILE)) {
      return { ok: false, message: "Master key not initialized. Run vault_set to create it." };
    }
    const key = getMasterKey();
    if (key.length !== KEY_LENGTH) {
      return { ok: false, message: `Master key has invalid length (${key.length}, expected ${KEY_LENGTH}).` };
    }
    const vault = readVault();
    const testKey = "___health_check___";
    vaultSet(testKey, "ok");
    const result = vaultGet(testKey);
    vaultDelete(testKey);
    if (result !== "ok") {
      return { ok: false, message: "Encrypt/decrypt round-trip failed." };
    }
    return { ok: true, message: `Vault healthy. ${Object.keys(vault.entries).length} entries stored.` };
  } catch (e: any) {
    return { ok: false, message: `Vault error: ${e.message}` };
  }
}

export async function vaultImportFromEnv(keys: string[]): Promise<string[]> {
  const imported: string[] = [];
  for (const key of keys) {
    const envKey = key.replace(/-/g, "_").toUpperCase();
    const envVal = process.env[envKey] || process.env[key];
    if (envVal && !vaultHas(key)) {
      vaultSet(key, envVal);
      imported.push(key);
    }
  }
  return imported;
}

export async function vaultExportToEnv(keys: string[]): Promise<void> {
  for (const key of keys) {
    const val = vaultGet(key);
    if (val) {
      const envKey = key.replace(/-/g, "_").toUpperCase();
      process.env[envKey] = val;
    }
  }
}
