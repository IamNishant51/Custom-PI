import { useState } from "react";

function getToolDesc(name: string, argsStr: string): string {
  try {
    const parsed = JSON.parse(argsStr);
    if (name === "view_file" || name === "write_to_file" || name === "replace_file_content" || name === "multi_replace_file_content") {
      const pathStr = parsed.AbsolutePath || parsed.TargetFile || "";
      return pathStr.split("/").pop() || pathStr;
    }
    if (name === "list_dir") {
      const pathStr = parsed.DirectoryPath || "";
      return pathStr.split("/").pop() || pathStr;
    }
    if (name === "grep_search") {
      return `"${parsed.Query}"`;
    }
    if (name === "run_command") {
      return parsed.CommandLine || "";
    }
  } catch {}
  return "";
}

export default function ToolCallItem({ name, args, status, result }: {
  name: string;
  args: string;
  status: "running" | "completed" | "error";
  result: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusText = status === "running" ? "[ ]" : status === "completed" ? "[x]" : "[!]";
  const statusClass = status === "running" ? "running" : status === "completed" ? "completed" : "error";
  const desc = getToolDesc(name, args);

  return (
    <div className={`msg msg-tool stagger-item ${statusClass}`}>
      <button className="tool-header" onClick={() => setExpanded(v => !v)}>
        <span className="tool-status-icon">{statusText}</span>
        <span className="tool-name-label">
          {name} {desc && <span className="tool-desc-sub">{desc}</span>}
        </span>
        <span className={`tool-chevron ${expanded ? "rotated" : ""}`}>▸</span>
      </button>
      <div
        className="tool-body"
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
        }}
      >
        <div className="tool-inner">
          {args && (
            <div className="tool-section">
              <div className="tool-section-label">Arguments</div>
              <pre className="tool-code">{args}</pre>
            </div>
          )}
          {result && (
            <div className="tool-section">
              <div className="tool-section-label">Output</div>
              <pre className="tool-code tool-result-text">{result}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
