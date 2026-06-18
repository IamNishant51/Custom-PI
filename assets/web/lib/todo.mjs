import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const PI_DIR = path.join(os.homedir(), ".pi", "agent");

export function todoWrite(phase, items) {
  const todoPath = path.join(PI_DIR, "todos.json");
  let todos = {};
  try { todos = JSON.parse(fs.readFileSync(todoPath, "utf8")); } catch {}

  todos[phase] = { items, updatedAt: Date.now() };
  fs.writeFileSync(todoPath, JSON.stringify(todos, null, 2));

  const summary = items.map((it, i) => `${it.done ? "✓" : "○"} ${it.description}`).join("\n");
  return `Todo phase '${phase}' saved.\n\n${summary}`;
}
