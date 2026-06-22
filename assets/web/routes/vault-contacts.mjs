import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { vaultSet, vaultGet, vaultDelete, vaultList, vaultHealth, readVault } from "../services/vault.mjs";
import { SHARED_PATHS } from "../shared-constants.mjs";
import { getOrCreateDb } from "../services/db.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerVaultContacts(app, { sendError, validateBody, getContactsDb }) {
  const VAULT_AUDIT_FILE = path.join(PI_DIR, "vault-audit.jsonl");
  function vaultAudit(action, key, success) {
    try {
      const entry = { ts: new Date().toISOString(), action, key, ip: "local" };
      fs.appendFileSync(VAULT_AUDIT_FILE, JSON.stringify(entry) + "\n");
    } catch {}
  }

  app.post("/api/vault/set", {
    schema: { body: { type: "object", required: ["key", "value"], properties: { key: { type: "string" }, value: { type: "string" } } }, response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
  }, async (req) => {
    const err = validateBody(req.body, ["key", "value"]);
    if (err) return { ok: false, error: err };
    try { vaultSet(req.body.key, req.body.value); vaultAudit("set", req.body.key, true); return { ok: true }; }
    catch (e) { vaultAudit("set", req.body.key, false); throw e; }
  });

  app.post("/api/vault/get", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { key: { type: "string" } } },
      response: { 200: { type: "object", properties: { ok: { type: "boolean" }, value: { type: "string", nullable: true }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const err = validateBody(req.body, ["key"]);
    if (err) return { ok: false, error: err };
    vaultAudit("get", req.body.key, true);
    const value = vaultGet(req.body.key);
    if (value === null) return { ok: false, value: null };
    const redacted = value.length > 4 ? value.slice(0, 4) + "***" : "***";
    return { ok: true, value: redacted };
  });

  app.post("/api/vault/delete", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { key: { type: "string" } } },
      response: { 200: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const err = validateBody(req.body, ["key"]);
    if (err) return { ok: false, error: err };
    const result = vaultDelete(req.body.key);
    vaultAudit("delete", req.body.key, result);
    return { ok: result };
  });

  app.get("/api/vault/list", {
    schema: { response: { 200: { type: "object", properties: { keys: { type: "array", items: { type: "string" } } } } } },
  }, async () => ({ keys: vaultList() }));

  app.get("/api/vault/health", {
    schema: { response: { 200: { type: "object", additionalProperties: true } } },
  }, async () => vaultHealth());

  app.get("/api/vault/export", {
    schema: { response: { 200: { type: "object", properties: { vault: { type: "object" }, exportedAt: { type: "string" } } } } },
  }, async () => {
    const vault = readVault();
    return { vault, exportedAt: new Date().toISOString() };
  });

  app.post("/api/vault/import", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { entries: { type: "object" }, merge: { type: "boolean" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, imported: { type: "number" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { entries, merge } = req.body || {};
    if (!entries || typeof entries !== "object") return { error: "entries object required", imported: 0 };
    const current = readVault();
    let count = 0;
    for (const [key, val] of Object.entries(entries)) {
      if (merge && current[key] !== undefined) continue;
      vaultSet(key, String(val));
      count++;
    }
    return { success: true, imported: count };
  });

  app.get("/api/contacts", {
    schema: { response: { 200: { type: "object", properties: { contacts: { type: "array", items: { type: "object" } } } } },
  }, async () => {
    const db = getContactsDb();
    if (!db) return { contacts: [] };
    return { contacts: db.prepare("SELECT * FROM contacts ORDER BY name ASC LIMIT 200").all() };
  });

  app.post("/api/contacts", {
    schema: {
      body: { type: "object", required: ["name"], properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, organization: { type: "string" }, notes: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, id: { type: "string" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getContactsDb(); if (!db) return { error: "Unavailable" };
    const { name, email, phone, organization, notes } = req.body || {};
    if (!name) return { error: "name required" };
    const id = `c_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const now = Date.now();
    db.prepare("INSERT INTO contacts (id,name,email,phone,organization,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, name, email||"", phone||"", organization||"", notes||"", now, now);
    return { success: true, id };
  });

  app.put("/api/contacts/:id", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, organization: { type: "string" }, notes: { type: "string" }, avatar: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const db = getContactsDb(); if (!db) return { error: "Unavailable" };
    const fields = []; const vals = [];
    for (const k of ["name","email","phone","organization","notes","avatar"]) {
      if (req.body[k] !== undefined) { fields.push(`${k}=?`); vals.push(req.body[k]); }
    }
    if (!fields.length) return { error: "No fields" };
    fields.push("updated_at=?"); vals.push(Date.now()); vals.push(req.params.id);
    db.prepare(`UPDATE contacts SET ${fields.join(",")} WHERE id=?`).run(...vals);
    return { success: true };
  });

  app.delete("/api/contacts/:id", {
    schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } },
  }, async (req) => {
    const db = getContactsDb(); if (!db) return { error: "Unavailable" };
    db.prepare("DELETE FROM contacts WHERE id=?").run(req.params.id);
    return { success: true };
  });

  app.post("/api/contacts/carddav/sync", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { serverUrl: { type: "string" }, username: { type: "string" }, password: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, imported: { type: "number" }, total: { type: "number" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { serverUrl, username, password } = req.body || {};
    if (!serverUrl || !username || !password) return { error: "serverUrl, username, password required" };
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/addressbook/default/`, {
        headers: { "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64") },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `CardDAV server returned ${res.status}` };
      const text = await res.text();
      const vcards = text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) || [];
      const db = getContactsDb();
      let imported = 0;
      for (const vcard of vcards) {
        const name = vcard.match(/FN:(.+)/)?.[1]?.trim() || "";
        const email = vcard.match(/EMAIL:(.+)/)?.[1]?.trim() || "";
        const phone = vcard.match(/TEL:(.+)/)?.[1]?.trim() || "";
        if (!name) continue;
        const id = `carddav_${crypto.createHash("md5").update(name + email).digest("hex").slice(0, 12)}`;
        const now = Date.now();
        db.prepare("INSERT OR IGNORE INTO contacts (id, name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, email, phone, now, now);
        imported++;
      }
      return { success: true, imported, total: vcards.length };
    } catch (e) { return { error: e.message }; }
  });
}
