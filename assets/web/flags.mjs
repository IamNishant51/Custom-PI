import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

const FLAGS_FILE = path.resolve(import.meta.dirname, "../../.feature-flags.json");

const DEFAULT_FLAGS = {
  "undo-redo": { value: "off", description: "Enable undo/redo for destructive actions" },
  "search-command-palette": { value: "on", description: "Enable Cmd+K command palette search" },
  "optimistic-updates": { value: "on", description: "Immediate UI updates before API response" },
  "notification-center": { value: "off", description: "Persistent notification center with read/unread" },
  "pwa-offline": { value: "on", description: "Service worker offline caching" },
};

let _flags = {};

export function loadFlags() {
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      _flags = { ...DEFAULT_FLAGS, ...JSON.parse(fs.readFileSync(FLAGS_FILE, "utf8")) };
    } else {
      _flags = { ...DEFAULT_FLAGS };
      saveFlags();
    }
  } catch {
    _flags = { ...DEFAULT_FLAGS };
  }
  return _flags;
}

export function saveFlags(overrides = {}) {
  _flags = { ..._flags, ...overrides };
  fs.mkdirSync(path.dirname(FLAGS_FILE), { recursive: true });
  fs.writeFileSync(FLAGS_FILE, JSON.stringify(_flags, null, 2));
}

export function isFlagEnabled(key) {
  if (!_flags[key]) return false;
  const val = _flags[key].value || _flags[key];
  return val === "on" || val === true;
}

export function getFlags() {
  return { ..._flags };
}

export function setFlag(key, value, description) {
  if (!_flags[key]) {
    _flags[key] = { value, description: description || "" };
  } else {
    _flags[key].value = value;
    if (description) _flags[key].description = description;
  }
  saveFlags();
}
