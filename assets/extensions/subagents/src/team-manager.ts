import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnAgentSession, closeSession, discoverAgents, getAgentLabel } from "./agent-manager";
import { buildMcpContextForPrompt, getEnabledMcpServers } from "./mcp-catalog";
import type { AgentMode, AcpSessionConfig, McpServerConfig } from "./acp-types";

const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent");
const TEAMS_CONFIG_PATH = path.join(CONFIG_DIR, "teams.json");

export type TeammateRole = "leader" | "teammate";
export type TeammateStatus = "pending" | "idle" | "active" | "completed" | "failed";
export type WorkspaceMode = "shared" | "isolated";

export interface TeamAgent {
  slotId: string;
  agentId: string;
  agentName: string;
  role: TeammateRole;
  status: TeammateStatus;
  icon?: string;
  model?: string;
  mode?: AgentMode;
  sessionId?: string;
  conversationId?: string;
  result?: string;
  error?: string;
}

export interface Team {
  id: string;
  name: string;
  workspace: string;
  workspaceMode: WorkspaceMode;
  leaderAgentId: string;
  agents: TeamAgent[];
  sessionMode?: AgentMode;
  createdAt: number;
  updatedAt: number;
}

interface TeamStore {
  teams: Team[];
}

function loadTeamsStore(): TeamStore {
  try {
    if (fs.existsSync(TEAMS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(TEAMS_CONFIG_PATH, "utf8"));
    }
  } catch {}
  return { teams: [] };
}

function saveTeamsStore(store: TeamStore): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TEAMS_CONFIG_PATH, JSON.stringify(store, null, 2), "utf8");
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTeam(name: string, workspace: string, leaderAgentId: string): Team {
  const agent = discoverAgents().find(a => a.id === leaderAgentId);
  const team: Team = {
    id: generateId(),
    name,
    workspace,
    workspaceMode: "shared",
    leaderAgentId,
    agents: [
      {
        slotId: generateId(),
        agentId: leaderAgentId,
        agentName: agent?.name || leaderAgentId,
        role: "leader",
        status: "idle",
        icon: agent?.icon,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const store = loadTeamsStore();
  store.teams.push(team);
  saveTeamsStore(store);
  return team;
}

export function getTeams(): Team[] {
  return loadTeamsStore().teams;
}

export function getTeam(teamId: string): Team | undefined {
  return loadTeamsStore().teams.find(t => t.id === teamId);
}

export function updateTeam(teamId: string, updates: Partial<Team>): Team | undefined {
  const store = loadTeamsStore();
  const team = store.teams.find(t => t.id === teamId);
  if (!team) return undefined;
  Object.assign(team, updates, { updatedAt: Date.now() });
  saveTeamsStore(store);
  return team;
}

export function deleteTeam(teamId: string): boolean {
  const store = loadTeamsStore();
  const filtered = store.teams.filter(t => t.id !== teamId);
  if (filtered.length === store.teams.length) return false;
  store.teams = filtered;
  saveTeamsStore(store);
  return true;
}

export function addAgentToTeam(teamId: string, agentId: string, role: TeammateRole = "teammate"): TeamAgent | undefined {
  const store = loadTeamsStore();
  const team = store.teams.find(t => t.id === teamId);
  if (!team) return undefined;

  if (team.agents.length >= 10) return undefined;

  const agent = discoverAgents().find(a => a.id === agentId);
  if (!agent) return undefined;

  const slot: TeamAgent = {
    slotId: generateId(),
    agentId,
    agentName: agent.name,
    role,
    status: "pending",
    icon: agent.icon,
  };
  team.agents.push(slot);
  team.updatedAt = Date.now();
  saveTeamsStore(store);
  return slot;
}

export function removeAgentFromTeam(teamId: string, slotId: string): boolean {
  const store = loadTeamsStore();
  const team = store.teams.find(t => t.id === teamId);
  if (!team) return false;
  const idx = team.agents.findIndex(a => a.slotId === slotId);
  if (idx < 0) return false;
  if (team.agents[idx].role === "leader") return false;
  team.agents.splice(idx, 1);
  team.updatedAt = Date.now();
  saveTeamsStore(store);
  return true;
}

export function updateAgentStatus(teamId: string, slotId: string, status: TeammateStatus, extra?: Partial<TeamAgent>): void {
  const store = loadTeamsStore();
  const team = store.teams.find(t => t.id === teamId);
  if (!team) return;
  const agent = team.agents.find(a => a.slotId === slotId);
  if (!agent) return;
  Object.assign(agent, { status, ...extra });
  team.updatedAt = Date.now();
  saveTeamsStore(store);
}

export function getTeamContext(teamId: string): string {
  const team = getTeam(teamId);
  if (!team) return "";
  const agentLines = team.agents.map(a =>
    `  [${a.role}] ${a.agentName} (${a.status})${a.model ? ` - model: ${a.model}` : ""}`
  );
  const mcpContext = buildMcpContextForPrompt();
  return [
    `## Team: ${team.name}`,
    `Workspace: ${team.workspace} (${team.workspaceMode})`,
    `Members:`,
    ...agentLines,
    mcpContext,
  ].filter(Boolean).join("\n");
}

export function buildTeamSessionConfig(team: Team, slot: TeamAgent): AcpSessionConfig {
  return {
    id: slot.slotId,
    workspace: team.workspace,
    mode: slot.mode || team.sessionMode || "default",
    model: slot.model,
    mcpServerIds: getEnabledMcpServers().map(s => s.id),
    context: getTeamContext(team.id),
  };
}
