import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cache = {};

function load(name) {
  if (cache[name]) return cache[name];
  const filePath = path.join(__dirname, name);
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    cache[name] = data;
    return data;
  } catch {
    return {};
  }
}

export function prompts() {
  return {
    identity: load("system/identity.json"),
    modes: load("system/modes.json"),
    swarm: load("agents/swarm.json"),
    review: load("agents/review.json"),
    voice: load("features/voice.json"),
    email: load("features/email.json"),
    social: load("features/social.json"),
    research: load("features/research.json"),
  };
}

export function loadPrompt(category, key, vars = {}) {
  const data = load(`${category}.json`);
  let template = data[key];
  if (!template) {
    const dir = category.includes("/") ? category : `system/${category}`;
    const alt = load(`${dir}.json`);
    template = alt[key];
  }
  if (!template) return "";
  return template.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export default prompts;
