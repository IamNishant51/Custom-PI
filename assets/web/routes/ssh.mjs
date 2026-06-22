import path from "node:path";
import fs from "node:fs";

export default function registerSsh(app, { PI_DIR, sendError }) {
  const SSH_CONFIG_FILE = path.join(PI_DIR, "ssh-machines.json");
  function loadSshMachines() {
    try { return JSON.parse(fs.readFileSync(SSH_CONFIG_FILE, "utf8")); } catch { return []; }
  }
  function saveSshMachines(machines) {
    fs.writeFileSync(SSH_CONFIG_FILE, JSON.stringify(machines, null, 2));
  }

  app.get("/api/ssh/machines", { schema: { response: { 200: { type: "object", properties: { machines: { type: "array" } } } } } }, async () => {
    return { machines: loadSshMachines().map(m => ({ ...m, password: "***" })) };
  });

  app.post("/api/ssh/machines", { schema: { body: { type: "object", additionalProperties: true, properties: { host: { type: "string" }, port: { type: "number" }, username: { type: "string" }, password: { type: "string" }, label: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } } }, async (req) => {
    const { host, port, username, password, label } = req.body || {};
    if (!host || !username) return { error: "host and username required" };
    const machines = loadSshMachines();
    machines.push({
      id: `ssh_${Date.now()}`,
      host,
      port: port || 22,
      username,
      password: password || "",
      label: label || host,
      addedAt: Date.now(),
    });
    saveSshMachines(machines);
    return { success: true };
  });

  app.delete("/api/ssh/machines/:id", { schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } } }, async (req) => {
    const machines = loadSshMachines().filter(m => m.id !== req.params.id);
    saveSshMachines(machines);
    return { success: true };
  });

  app.put("/api/ssh/machines/:id", { schema: { body: { type: "object", additionalProperties: true, properties: { host: { type: "string" }, port: { type: "number" }, username: { type: "string" }, password: { type: "string" }, label: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, error: { type: "string" } } } } } }, async (req) => {
    const machines = loadSshMachines();
    const idx = machines.findIndex(m => m.id === req.params.id);
    if (idx === -1) return { error: "Machine not found" };
    const updates = req.body || {};
    if (updates.password === "***") delete updates.password;
    machines[idx] = { ...machines[idx], ...updates };
    saveSshMachines(machines);
    return { success: true };
  });
}
