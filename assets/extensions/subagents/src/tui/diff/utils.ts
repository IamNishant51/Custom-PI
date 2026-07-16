import type { FileDiff, Hunk, HunkLine } from "./types";

export function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.split("\n");
  let currentFile: Partial<FileDiff> | null = null;
  let currentHunk: Partial<Hunk> | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const rawLine of lines) {
    const line = rawLine;

    if (line.startsWith("diff --git ")) {
      if (currentFile && currentFile.filePath) {
        flushHunk(currentFile, currentHunk);
        files.push(normalizeFile(currentFile));
      }
      currentFile = { hunks: [], reviewed: false };
      currentHunk = null;

      const match = line.match(/diff --git a\/(.*?) b\/(.*?)$/);
      if (match) {
        currentFile.oldPath = match[1];
        currentFile.filePath = match[2];
        if (match[1] === "/dev/null") currentFile.status = "added";
        else if (match[2] === "/dev/null") currentFile.status = "deleted";
        else currentFile.status = "modified";
      }
      continue;
    }

    if (line.startsWith("--- a/")) {
      if (!currentFile) continue;
      const oldPath = line.slice(6);
      if (oldPath !== "/dev/null") {
        currentFile.oldPath = oldPath;
      }
      continue;
    }

    if (line.startsWith("+++ b/")) {
      if (!currentFile) continue;
      const newPath = line.slice(6);
      if (newPath !== "/dev/null") {
        currentFile.filePath = newPath;
      }
      continue;
    }

    if (line.startsWith("@@")) {
      if (currentFile) {
        flushHunk(currentFile, currentHunk);
      }
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (match) {
        currentHunk = {
          header: match[0],
          lines: [],
          oldStart: parseInt(match[1], 10),
          oldCount: match[2] ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newCount: match[4] ? parseInt(match[4], 10) : 1,
        };
        oldLineNum = currentHunk.oldStart!;
        newLineNum = currentHunk.newStart!;
      }
      continue;
    }

    if (!currentFile || (!line.startsWith("+") && !line.startsWith("-") && !line.startsWith(" ") && line !== "" && !line.startsWith("\\"))) {
      continue;
    }

    if (currentHunk) {
      const parsed = parsePatchLine(line);
      if (parsed.type === "add") {
        parsed.newLineNum = newLineNum++;
      } else if (parsed.type === "del") {
        parsed.oldLineNum = oldLineNum++;
      } else {
        parsed.oldLineNum = oldLineNum++;
        parsed.newLineNum = newLineNum++;
      }
      currentHunk.lines!.push(parsed);
    }
  }

  if (currentFile && currentFile.filePath) {
    flushHunk(currentFile, currentHunk);
    files.push(normalizeFile(currentFile));
  }

  return files;
}

function flushHunk(file: Partial<FileDiff>, hunk: Partial<Hunk> | null): void {
  if (hunk && hunk.lines && hunk.lines.length > 0) {
    file.hunks = file.hunks || [];
    file.hunks.push({
      header: hunk.header || "",
      lines: hunk.lines,
      oldStart: hunk.oldStart || 0,
      oldCount: hunk.oldCount || 0,
      newStart: hunk.newStart || 0,
      newCount: hunk.newCount || 0,
    });
  }
}

function normalizeFile(file: Partial<FileDiff>): FileDiff {
  return {
    filePath: file.filePath || "unknown",
    status: file.status || "modified",
    oldPath: file.oldPath,
    hunks: file.hunks || [],
    reviewed: file.reviewed || false,
  };
}

export function parsePatchLine(line: string): HunkLine {
  if (line.startsWith("+")) {
    return { type: "add", content: line.slice(1) };
  } else if (line.startsWith("-")) {
    return { type: "del", content: line.slice(1) };
  } else if (line.startsWith(" ")) {
    return { type: "ctx", content: line.slice(1) };
  } else if (line.startsWith("\\")) {
    return { type: "ctx", content: line };
  }
  return { type: "ctx", content: line };
}
