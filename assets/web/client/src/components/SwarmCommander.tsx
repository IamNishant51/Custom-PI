import { useToast } from "./Toast";
import AssetGallery from "./AssetGallery";
import { type SavedTeam } from "./types";

interface PlatformMeta {
  label: string;
  tool: string;
  color: string;
}

const PLATFORM_META: Record<string, PlatformMeta> = {
  twitter: { label: "Twitter / X", tool: "post_to_twitter", color: "#1da1f2" },
  reddit: { label: "Reddit", tool: "post_to_reddit", color: "#ff4500" },
  bluesky: { label: "Bluesky", tool: "post_to_bluesky", color: "#0085ff" },
  discord: { label: "Discord", tool: "post_to_discord", color: "#5865f2" },
  telegram: { label: "Telegram", tool: "post_to_telegram", color: "#26a5e4" },
};

export { PLATFORM_META };

interface SwarmCommanderProps {
  goal: string;
  onGoalChange: (val: string) => void;
  onLaunch: () => void;
  canLaunch: boolean;
  savedTeams: SavedTeam[];
  onLaunchTeam: (team: SavedTeam) => void;
  onDeleteTeam: (name: string) => void;
}

export default function SwarmCommander({ goal, onGoalChange, onLaunch, canLaunch, savedTeams, onLaunchTeam, onDeleteTeam }: SwarmCommanderProps) {
  return (
    <div className="subagent-idle">
      <div className="subagent-hero">
        <div className="subagent-hero-icon">⚡</div>
        <h1 className="subagent-hero-title">Swarm Commander</h1>
        <p className="subagent-hero-desc">Enter a goal. The CEO will assemble a team, delegate tasks, and compile results.</p>
        <div className="subagent-hero-input-row">
          <textarea
            className="subagent-hero-input"
            rows={2}
            placeholder="e.g. Write a script that checks system CPU load, logs it, and alerts if > 80%..."
            value={goal}
            onChange={e => onGoalChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onLaunch(); } }}
          />
          <button className="subagent-hero-btn" onClick={onLaunch} disabled={!canLaunch}>
            Launch
          </button>
        </div>
      </div>

      {savedTeams.length > 0 && (
        <div className="subagent-saved-section">
          <div className="subagent-section-label">Saved Teams</div>
          <div className="subagent-saved-grid">
            {savedTeams.map((team, i) => (
              <div key={i} className="saved-team-item" onClick={() => onLaunchTeam(team)}>
                <div className="saved-team-item-top">
                  <span className="saved-team-item-name">{team.name}{team.default ? <span className="saved-team-item-badge" style={{marginLeft:6,fontSize:10,opacity:0.5}}>built-in</span> : null}</span>
                  {!team.default && <button className="saved-team-item-delete" onClick={e => { e.stopPropagation(); onDeleteTeam(team.name); }} title="Delete">✕</button>}
                </div>
                <div className="saved-team-item-goal">{team.goal}</div>
                <div className="saved-team-item-agents">
                  {team.agents.map((a, j) => (
                    <span key={j} className="saved-team-item-tag">{a.id}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="subagent-saved-section">
        <AssetGallery />
      </div>
    </div>
  );
}
