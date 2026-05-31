import { useState } from "react";

interface ToolCallCardProps {
  name: string;
  status?: "pending" | "running" | "done" | "completed" | "error";
  path?: string;
  args?: string;
  result?: string;
  defaultOpen?: boolean;
}

const statusIcons: Record<string, string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  completed: "✓",
  error: "✗",
};

export default function ToolCallCard({ name, status = "done", path, args, result, defaultOpen }: ToolCallCardProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const hasDetail = args || result;

  return (
    <div className={`tool-card-omp ${status}`}>
      <div className="tool-card-header-omp" onClick={() => hasDetail && setOpen(!open)} style={{ cursor: hasDetail ? "pointer" : "default" }}>
        <span className="tool-card-icon-omp">{statusIcons[status] || "○"}</span>
        <span className="tool-card-name-omp">{name}</span>
        {path && <span className="tool-card-path-omp">{path}</span>}
        {hasDetail && <span className={`tool-card-chevron-omp ${open ? "open" : ""}`}>▶</span>}
      </div>
      {open && (
        <div className="tool-card-body-omp">
          {args && (
            <>
              <div className="tool-result-label">Arguments</div>
              <pre>{args}</pre>
            </>
          )}
          {result && (
            <>
              <div className="tool-result-label">Result</div>
              <pre>{result}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
