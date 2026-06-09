import { useState, useEffect, useRef } from "react";
import Markdown from "./Markdown";

export default function ThinkingBlock({
  content,
  isStreaming,
  isCollapsed,
  onToggleCollapse
}: {
  content: string;
  isStreaming?: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState("0px");

  useEffect(() => {
    if (ref.current) {
      setMaxH(!isCollapsed ? `${ref.current.scrollHeight}px` : "0px");
    }
  }, [isCollapsed, content]);

  return (
    <div className="msg msg-thinking stagger-item">
      <button className="thinking-header" onClick={onToggleCollapse}>
        <span className={`thinking-chevron ${!isCollapsed ? "rotated" : ""}`}>▸</span>
        <span className="thinking-label">Reasoning</span>
      </button>
      <div
        className="thinking-body"
        style={{
          maxHeight: maxH,
          transition: "max-height 0.25s ease",
        }}
      >
        <div ref={ref} className="thinking-content">
          {content ? (
            <Markdown content={content} />
          ) : (
            <span className="thinking-placeholder">Thinking...</span>
          )}
        </div>
      </div>
    </div>
  );
}
