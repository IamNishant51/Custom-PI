import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Worker } from "node:worker_threads";

const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const PLUGINS_DIR = path.join(PI_DIR, "plugins");

function ensurePluginsDir() { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); }

export function loadPlugins() {
  ensurePluginsDir();
  try {
    const plugins = [];
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const manifestFile = path.join(PLUGINS_DIR, entry.name, "manifest.json");
        const codeFile = path.join(PLUGINS_DIR, entry.name, "plugin.js");
        if (fs.existsSync(manifestFile)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
            plugins.push({ name: entry.name, manifest, enabled: true, hasCode: fs.existsSync(codeFile) });
          } catch {}
        }
      }
    }
    return plugins;
  } catch { return []; }
}

export async function runPluginHook(name, hookName, context) {
  const codeFile = path.join(PLUGINS_DIR, name, "plugin.js");
  if (!fs.existsSync(codeFile)) return null;

  const code = fs.readFileSync(codeFile, "utf8");

  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('worker_threads');
      const { console, JSON, Math, Date, RegExp, String, Number, Boolean, Array, Object, Map, Set, Promise, TextEncoder, TextDecoder, URL, URLSearchParams } = workerData.safeModules;
      const sandbox = Object.create(null);
      Object.assign(sandbox, workerData.safeModules);
      sandbox.module = { exports: {} };
      sandbox.exports = sandbox.module.exports;
      sandbox.require = () => { throw new Error('require() not allowed in plugin sandbox'); };
      try {
        const fn = new Function('context', workerData.code);
        const result = fn(workerData.context);
        Promise.resolve(result).then(r => {
          parentPort.postMessage({ success: true, result: r });
        }).catch(err => {
          parentPort.postMessage({ success: false, error: err.message });
        });
      } catch (err) {
        parentPort.postMessage({ success: false, error: err.message });
      }
    `, {
      eval: true,
      workerData: {
        code,
        context,
        safeModules: {
          console: { log: console.log, warn: console.warn, error: console.error },
          JSON, Math, Date, RegExp, String, Number, Boolean, Array, Object, Map, Set, Promise,
          TextEncoder, TextDecoder, URL, URLSearchParams,
        }
      }
    });

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Plugin timeout'));
    }, 5000);

    worker.on('message', (msg) => {
      clearTimeout(timeout);
      if (msg.success) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.error));
      }
    });

    worker.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Plugin worker exited with code ${code}`));
      }
    });
  });
}

export async function loadPluginCode(name) {
  const codeFile = path.join(PLUGINS_DIR, name, "plugin.js");
  if (fs.existsSync(codeFile)) {
    try {
      const code = fs.readFileSync(codeFile, "utf8");
      // Run in worker for sandboxed execution
      return await runPluginHook(name, "load", {});
    } catch (e) {
      return { error: e.message };
    }
  }
  return null;
}

export function createPluginManifest(name, description, version) {
  ensurePluginsDir();
  const pluginDir = path.join(PLUGINS_DIR, name);
  fs.mkdirSync(pluginDir, { recursive: true });
  const manifest = {
    name,
    description: description || `${name} plugin`,
    version: version || "1.0.0",
    author: "user",
    tools: [],
    hooks: [],
    created: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function installPluginFromUrl(url) {
  return { success: false, message: "Plugin installation from URL not yet implemented. Use plugin.create to create a new plugin." };
}
