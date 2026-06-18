import path from "node:path";
import fs from "node:fs";

const hashlineSnapshots = {};

function computeFileHash(content) {
  const normalized = content.replace(/[ \t]+\r?\n/g, "\n");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return (hash & 0xFFFF).toString(16).padStart(4, "0").toUpperCase();
}

function parseHashlinePatch(patch) {
  const sections = [];
  const lines = patch.split("\n");

  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("¶")) {
      if (currentSection) sections.push(currentSection);
      const match = line.match(/^¶(.+?)#([0-9A-Fa-f]{4})$/);
      if (!match) continue;
      currentSection = { path: match[1], hash: match[2].toUpperCase(), ops: [] };
      continue;
    }

    if (!currentSection) continue;

    const opMatch = line.match(/^(replace|delete|insert)(?:\s+block)?\s+(.+)$/);
    if (opMatch) {
      const verb = opMatch[1];
      const rest = opMatch[2].trim();

      if (verb === "insert") {
        const posMatch = rest.match(/^(before|after|head|tail)\s*(\d+)?\s*:?\s*$/);
        if (posMatch) {
          currentSection.ops.push({
            type: "insert",
            position: posMatch[1],
            anchor: posMatch[2] ? parseInt(posMatch[2]) : null,
            lines: [],
          });
        }
        continue;
      }

      if (verb === "delete") {
        const rangeMatch = rest.match(/^(\d+)(?:\.\.\s*(\d+))?\s*$/);
        if (rangeMatch) {
          currentSection.ops.push({
            type: "delete",
            start: parseInt(rangeMatch[1]),
            end: rangeMatch[2] ? parseInt(rangeMatch[2]) : parseInt(rangeMatch[1]),
          });
        }
        continue;
      }

      if (verb === "replace") {
        const rangeMatch = rest.match(/^(\d+)(?:\.\.\s*(\d+))?:?\s*$/);
        if (rangeMatch) {
          currentSection.ops.push({
            type: "replace",
            start: parseInt(rangeMatch[1]),
            end: rangeMatch[2] ? parseInt(rangeMatch[2]) : parseInt(rangeMatch[1]),
            lines: [],
          });
        }
        continue;
      }
    }

    if (line.startsWith("+") && currentSection.ops.length > 0) {
      const lastOp = currentSection.ops[currentSection.ops.length - 1];
      if (lastOp.lines !== undefined) {
        lastOp.lines.push(line.slice(1));
      }
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}

function applyOps(lines, ops) {
  let result = [...lines];

  const sorted = [...ops].sort((a, b) => {
    const aLine = a.type === "insert" && a.position === "tail" ? lines.length :
      a.type === "insert" && a.position === "head" ? 0 :
      a.type === "insert" && a.anchor ? a.anchor :
      a.start || 0;
    const bLine = b.type === "insert" && b.position === "tail" ? lines.length :
      b.type === "insert" && b.position === "head" ? 0 :
      b.type === "insert" && b.anchor ? b.anchor :
      b.start || 0;
    return bLine - aLine;
  });

  for (const op of sorted) {
    if (op.type === "replace") {
      if (op.start < 1 || op.end > result.length) return null;
      result.splice(op.start - 1, op.end - op.start + 1, ...op.lines);
    } else if (op.type === "delete") {
      if (op.start < 1 || op.end > result.length) return null;
      result.splice(op.start - 1, op.end - op.start + 1);
    } else if (op.type === "insert") {
      let idx;
      if (op.position === "head") idx = 0;
      else if (op.position === "tail") idx = result.length;
      else if (op.position === "before" && op.anchor) idx = Math.min(op.anchor - 1, result.length);
      else if (op.position === "after" && op.anchor) idx = Math.min(op.anchor, result.length);
      else idx = result.length;
      result.splice(idx, 0, ...op.lines);
    }
  }

  return result;
}

export async function hashlineEdit(patch, cwd, safeResolve, expandPath) {
  try {
    const sections = parseHashlinePatch(patch);
    if (!sections.length) return "Invalid hashline patch. Format: ¶path#TAG\\nreplace N..N:\\n+content";

    const results = [];

    for (const section of sections) {
      const fp = safeResolve(cwd, expandPath(section.path));
      if (!fs.existsSync(fp)) {
        results.push(`File not found: ${section.path}`);
        continue;
      }

      const content = fs.readFileSync(fp, "utf8");
      const liveHash = computeFileHash(content);
      let contentLines = content.split("\n");

      if (liveHash !== section.hash) {
        const snap = hashlineSnapshots[fp];
        if (snap && snap.hash === section.hash) {
          const snapshotLines = snap.content.split("\n");
          const edited = applyOps(snapshotLines, section.ops);
          if (edited === null) {
            results.push(`Hash mismatch for ${section.path}: expected ${section.hash}, got ${liveHash}. File changed externally.`);
            continue;
          }
          contentLines = edited;
        } else {
          const onlyHeadTail = section.ops.every(o => o.type === "insert" && (o.position === "head" || o.position === "tail"));
          if (!onlyHeadTail) {
            results.push(`Hash mismatch for ${section.path}: expected ${section.hash}, got ${liveHash}${snap ? ". Attempted 3-way merge failed." : ". Record hash not found."}`);
            continue;
          }
        }
      }

      const edited = applyOps(contentLines, section.ops);
      if (edited === null) {
        results.push(`Failed to apply edits to ${section.path}`);
        continue;
      }

      const newContent = edited.join("\n");
      fs.writeFileSync(fp, newContent, "utf8");

      hashlineSnapshots[fp] = { hash: computeFileHash(newContent), content: newContent };

      const opSummary = section.ops.map(o => {
        if (o.type === "replace") return `replace ${o.start}..${o.end} (${o.lines.length} lines)`;
        if (o.type === "delete") return `delete ${o.start}..${o.end}`;
        if (o.type === "insert") return `insert ${o.position}${o.anchor ? " " + o.anchor : ""}`;
        return o.type;
      }).join(", ");

      results.push(`Edited ${section.path}: ${opSummary}`);
    }

    return results.join("\n");
  } catch (e) {
    return `Hashline edit error: ${e.message}`;
  }
}
