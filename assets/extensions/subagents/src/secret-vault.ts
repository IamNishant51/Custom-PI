import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

import { PATHS } from "./config";

const VAULT_DIR = PATHS.VAULT;
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

async function ensureVaultDir(): Promise<void> {
  await fs.mkdir(VAULT_DIR, { recursive: true });
}

async function getMasterKey(): Promise<Buffer> {
  const envKey = process.env.CUSTOM_PI_VAULT_KEY || process.env.PI_VAULT_KEY;
  if (envKey) {
    const decoded = Buffer.from(envKey, "hex");
    if (decoded.length === KEY_LENGTH) return decoded;
  }
  await ensureVaultDir();
  try {
    const keyRaw = (await fs.readFile(KEY_FILE, "utf8")).trim();
    return Buffer.from(keyRaw, "hex");
  } catch {
    const key = crypto.randomBytes(KEY_LENGTH);
    await fs.writeFile(KEY_FILE, key.toString("hex"), "utf8");
    await fs.chmod(KEY_FILE, 0o600);
    return key;
  }
}

async function readVault(): Promise<VaultData> {
  await ensureVaultDir();
  try {
    const data = JSON.parse(await fs.readFile(VAULT_FILE, "utf8"));
    data.entries = data.entries || {};
    data.version = data.version || 1;
    return data;
  } catch {
    return { entries: {}, version: 1 };
  }
}

async function writeVault(data: VaultData): Promise<void> {
  await ensureVaultDir();
  const tmp = VAULT_FILE + ".tmp." + Date.now();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, VAULT_FILE);
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

export async function vaultSet(key: string, value: string): Promise<void> {
  const masterKey = await getMasterKey();
  const vault = await readVault();
  const material = encrypt(value, masterKey);
  vault.entries[key] = material;
  await writeVault(vault);
}

export async function vaultGet(key: string): Promise<string | null> {
  const masterKey = await getMasterKey();
  const vault = await readVault();
  const material = vault.entries[key];
  if (!material) return null;
  try {
    return decrypt(material, masterKey);
  } catch {
    return null;
  }
}

export async function vaultDelete(key: string): Promise<boolean> {
  const vault = await readVault();
  if (!vault.entries[key]) return false;
  delete vault.entries[key];
  await writeVault(vault);
  return true;
}

export async function vaultList(): Promise<string[]> {
  const vault = await readVault();
  return Object.keys(vault.entries);
}

export async function vaultHas(key: string): Promise<boolean> {
  const vault = await readVault();
  return key in vault.entries;
}

export async function vaultExists(): Promise<boolean> {
  try {
    await fs.access(VAULT_FILE);
    await fs.access(KEY_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function vaultHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    try {
      await fs.access(KEY_FILE);
    } catch {
      return { ok: false, message: "Master key not initialized. Run vault_set to create it." };
    }
    const key = await getMasterKey();
    if (key.length !== KEY_LENGTH) {
      return { ok: false, message: `Master key has invalid length (${key.length}, expected ${KEY_LENGTH}).` };
    }
    const testPlaintext = "health-check-" + Date.now();
    const encrypted = encrypt(testPlaintext, key);
    const decrypted = decrypt(encrypted, key);
    if (decrypted !== testPlaintext) {
      return { ok: false, message: "Encrypt/decrypt round-trip failed." };
    }
    const vault = await readVault();
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
    if (envVal && !(await vaultHas(key))) {
      await vaultSet(key, envVal);
      imported.push(key);
    }
  }
  return imported;
}

export async function vaultExportToEnv(keys: string[]): Promise<void> {
  for (const key of keys) {
    const val = await vaultGet(key);
    if (val) {
      const envKey = key.replace(/-/g, "_").toUpperCase();
      process.env[envKey] = val;
    }
  }
}

export async function vaultRotateKey(): Promise<{ ok: boolean; message: string }> {
  try {
    const oldKey = await getMasterKey();
    const vault = await readVault();
    const entries = vault.entries;
    const newKey = crypto.randomBytes(KEY_LENGTH);
    const reEncrypted: Record<string, EncryptedMaterial> = {};
    for (const [name, material] of Object.entries(entries)) {
      try {
        const plaintext = decrypt(material, oldKey);
        reEncrypted[name] = encrypt(plaintext, newKey);
      } catch {
        return { ok: false, message: `Failed to decrypt entry '${name}' with current key. Rotation aborted.` };
      }
    }
    const backupPath = KEY_FILE + ".bak." + Date.now();
    try {
      await fs.access(KEY_FILE);
      await fs.copyFile(KEY_FILE, backupPath);
    } catch {
      // key file might not exist
    }
    await fs.writeFile(KEY_FILE, newKey.toString("hex"), "utf8");
    await fs.chmod(KEY_FILE, 0o600);
    vault.entries = reEncrypted;
    await writeVault(vault);
    return { ok: true, message: `Key rotated. ${Object.keys(reEncrypted).length} entries re-encrypted. Backup saved to ${backupPath}.` };
  } catch (e: any) {
    return { ok: false, message: `Key rotation failed: ${e.message}` };
  }
}
