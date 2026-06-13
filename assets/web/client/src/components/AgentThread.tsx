import { useState } from "react";
import ToolCallItem from "./ToolCallItem";

export interface ThreadedToolCall {
  id: string;
  type: "tool_call" | "tool_result";
  toolName?: string;
  toolArgs?: string;
  status?: "running" | "completed" | "error";
  content: string;
}

export default function AgentThread({ tools }: { tools: ThreadedToolCall[] }) {
  const [collapsed, setCollapsed] = useState(false);

  const running = tools.some(t => t.status === "running");
  const names = [...new Set(tools.map(t => t.toolName).filter(Boolean))].join(", ");

  return (
    <div className={`agent-thread ${running ? "running" : ""}`}>
      <button className="agent-thread-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="agent-thread-toggle">{collapsed ? "▶" : "▼"}</span>
        <span className="agent-thread-title">Agent Tools</span>
        <span className="agent-thread-names">{names}</span>
        <span className="agent-thread-count">{tools.length} steps</span>
        {running && <span className="agent-thread-spinner" />}
      </button>
      {!collapsed && (
        <div className="agent-thread-body">
          {tools.map((tool, i) => (
            <ToolCallItem
              key={tool.id || i}
              name={tool.toolName || ""}
              args={tool.toolArgs || ""}
              status={tool.status || "running"}
              result={tool.content}
            />
          ))}
        </div>
      )}
    </div>
  );
}
