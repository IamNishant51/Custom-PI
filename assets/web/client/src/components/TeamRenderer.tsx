import { useState } from "react";
import { type SavedTeam } from "./types";
import { PLATFORM_META } from "./SwarmCommander";

interface TeamRendererProps {
  launchTarget: SavedTeam | null;
  topicInput: string;
  onTopicChange: (val: string) => void;
  platformStatus: Record<string, boolean>;
  selectedPlatforms: string[];
  onTogglePlatform: (key: string) => void;
  onSelectAllConnected: () => void;
  onClearPlatforms: () => void;
  onClose: () => void;
  onLaunch: (topic: string) => void;
}

export default function TeamRenderer({
  launchTarget, topicInput, onTopicChange,
  platformStatus, selectedPlatforms,
  onTogglePlatform, onSelectAllConnected, onClearPlatforms,
  onClose, onLaunch,
}: TeamRendererProps) {
  const [generating, setGenerating] = useState(false);

  if (!launchTarget) return null;

  return (
    <div className="subagent-modal-overlay" onClick={onClose}>
      <div className="launch-team-modal" onClick={e => e.stopPropagation()} style={{
        background: "var(--surface-card)",
        border: "1px solid var(--hairline-strong)",
        borderRadius: 12,
        padding: 28,
        maxWidth: 540,
        width: "90%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        animation: "slideUp 0.25s ease-out",
      }}>
        <div className="launch-team-header" style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          marginBottom: 20,
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.3px" }}>{launchTarget.name}</div>
            <div style={{ fontSize: 13, color: "var(--mute)", marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{launchTarget.agents.length} agent{launchTarget.agents.length > 1 ? "s" : ""}</span>
              <span style={{ opacity: 0.3 }}>/</span>
              {launchTarget.agents.map((a, i) => (
                <span key={a.id} style={{
                  background: "var(--surface-soft)", padding: "1px 8px", borderRadius: 4,
                  fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent-teal)",
                }}>{a.id}</span>
              ))}
            </div>
          </div>
          <button className="btn btn-small btn-ghost" onClick={onClose}
            style={{ fontSize: 16, opacity: 0.5, padding: "4px 8px" }}>x</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{
            fontSize: 12, color: "var(--mute)", display: "flex", alignItems: "center", gap: 6,
            marginBottom: 8, fontFamily: "var(--font-mono)", textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            Topic
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, opacity: 0.6 }}>(optional)</span>
          </label>
          <div style={{ position: "relative" }}>
            <textarea
              className="text-input"
              value={topicInput}
              onChange={e => onTopicChange(e.target.value)}
              placeholder="e.g. AI in healthcare, Rust vs Go, latest tech trends..."
              rows={2}
              style={{
                width: "100%", background: "var(--surface-soft)", border: "1px solid var(--hairline)",
                borderRadius: 8, padding: "10px 12px", color: "var(--ink)", fontSize: 13,
                fontFamily: "var(--font-sans)", resize: "vertical", outline: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={e => e.currentTarget.style.borderColor = "var(--accent-teal)"}
              onBlur={e => e.currentTarget.style.borderColor = "var(--hairline)"}
              autoFocus
            />
          </div>
          <button
            onClick={async () => {
              setGenerating(true);
              try {
                const r = await fetch("/api/generate/topic", { method: "POST" });
                const d = await r.json();
                if (d.ok) onTopicChange(d.topic);
              } catch {}
              setGenerating(false);
            }}
            disabled={generating}
            style={{
              marginTop: 8, padding: "6px 14px", background: "var(--surface-soft)",
              border: "1px solid var(--hairline)", borderRadius: 6, color: "var(--accent-teal)",
              fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer",
              transition: "all 0.15s",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent-teal)"; e.currentTarget.style.background = "var(--surface-card)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--hairline)"; e.currentTarget.style.background = "var(--surface-soft)"; }}
          >
            <span className="ai-sparkle" style={{ fontSize: 14, lineHeight: 1 }}>+</span>
            Generate with AI
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{
            fontSize: 12, color: "var(--mute)", display: "flex", alignItems: "center", gap: 6,
            marginBottom: 8, fontFamily: "var(--font-mono)", textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            Platforms
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, opacity: 0.6 }}>
              ({selectedPlatforms.length} selected)
            </span>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(PLATFORM_META).map(([key, meta]) => {
              const connected = platformStatus[key];
              const selected = selectedPlatforms.includes(key);
              return (
                <button
                  key={key}
                  disabled={!connected}
                  onClick={() => onTogglePlatform(key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", borderRadius: 6, fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    border: selected
                      ? `1px solid ${meta.color}`
                      : "1px solid var(--hairline)",
                    background: selected
                      ? `${meta.color}15`
                      : "var(--surface-soft)",
                    color: selected ? meta.color : "var(--mute)",
                    cursor: connected ? "pointer" : "not-allowed",
                    opacity: connected ? 1 : 0.35,
                    transition: "all 0.15s",
                    outline: "none",
                  }}
                  onMouseEnter={e => { if (connected) e.currentTarget.style.background = selected ? `${meta.color}25` : "var(--surface-card)"; }}
                  onMouseLeave={e => { if (connected) e.currentTarget.style.background = selected ? `${meta.color}15` : "var(--surface-soft)"; }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: selected ? meta.color : "var(--hairline-strong)",
                    flexShrink: 0,
                  }} />
                  {meta.label}
                  {!connected && <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 2 }}>(not connected)</span>}
                </button>
              );
            })}
          </div>
          {Object.values(platformStatus).some(Boolean) && (
            <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
              <button
                onClick={onSelectAllConnected}
                style={{ fontSize: 10, padding: "2px 8px", background: "transparent", border: "none", color: "var(--accent-teal)", cursor: "pointer", fontFamily: "var(--font-mono)", opacity: 0.7 }}
                onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}
              >Select all connected</button>
              <button
                onClick={onClearPlatforms}
                style={{ fontSize: 10, padding: "2px 8px", background: "transparent", border: "none", color: "var(--mute)", cursor: "pointer", fontFamily: "var(--font-mono)", opacity: 0.5 }}
                onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}
              >Clear</button>
            </div>
          )}
        </div>

        <div className="launch-team-agents" style={{
          background: "var(--surface-soft)", borderRadius: 8, padding: 14, marginBottom: 20,
          border: "1px solid var(--hairline)",
        }}>
          <div style={{
            fontSize: 11, color: "var(--mute)", marginBottom: 10,
            fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.5px",
          }}>Pipeline</div>
          {launchTarget.agents.map((a, i) => (
            <div key={a.id} className="launch-agent-row" style={{
              display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
              fontSize: 12, color: "var(--mute)",
              animation: "slideUp 0.2s ease-out",
              animationDelay: `${i * 0.05}s`,
              animationFillMode: "both",
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%",
                background: i === launchTarget.agents.length - 1
                  ? "rgba(90,176,176,0.15)"
                  : "var(--surface-card)",
                border: i === launchTarget.agents.length - 1
                  ? "1px solid var(--accent-teal)"
                  : "1px solid var(--hairline-strong)",
                color: i === launchTarget.agents.length - 1 ? "var(--accent-teal)" : "var(--mute)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 600, flexShrink: 0,
                transition: "all 0.2s",
              }}>{i + 1}</span>
              <span style={{ fontWeight: 500, color: "var(--ink)", width: 110, fontFamily: "var(--font-mono)", fontSize: 11 }}>{a.id}</span>
              <span style={{ flex: 1, color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.3 }}>{a.role}</span>
              <span style={{
                fontSize: 10, color: "var(--mute)", background: "var(--surface-card)",
                padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
              }}>{a.tools.length} tools</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
          <button className="btn btn-small btn-ghost" onClick={onClose}
            style={{ fontSize: 12, padding: "8px 16px", borderRadius: 6 }}>Cancel</button>
          <button className="btn btn-small btn-primary" onClick={() => onLaunch(topicInput.trim())}
            style={{
              background: "var(--accent-teal)", color: "#000", border: "none",
              padding: "8px 22px", borderRadius: 6, fontWeight: 600, fontSize: 13,
              cursor: "pointer", transition: "opacity 0.15s",
              fontFamily: "var(--font-mono)",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            Start Campaign
          </button>
        </div>
      </div>
    </div>
  );
}
