import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverAgents, saveCustomAgent, removeCustomAgent, getAgentLabel } from "../agent-manager";
import { loadMcpServers, saveMcpServers, toggleMcpServer, addMcpServer, removeMcpServer, getEnabledMcpServers, buildMcpContextForPrompt } from "../mcp-catalog";
import { createTeam, getTeams, getTeam, updateTeam, deleteTeam, addAgentToTeam, removeAgentFromTeam, updateAgentStatus, getTeamContext } from "../team-manager";
import type { McpServerConfig } from "../acp-types";

const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent");
const MCP_CONFIG_PATH = path.join(CONFIG_DIR, "mcp-servers.json");
const TEAMS_CONFIG_PATH = path.join(CONFIG_DIR, "teams.json");
const AGENTS_CONFIG_PATH = path.join(CONFIG_DIR, "agents.json");

function cleanAll() {
  saveMcpServers([]); // clears cache + file
  for (const p of [TEAMS_CONFIG_PATH, AGENTS_CONFIG_PATH]) {
    try { fs.unlinkSync(p); } catch {}
  }
}

describe("agent-manager", () => {
  afterEach(() => {
    try { fs.unlinkSync(AGENTS_CONFIG_PATH); } catch {}
  });

  it("returns an array of agents", () => {
    const agents = discoverAgents(true);
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });

  it("each agent has required fields", () => {
    const agents = discoverAgents(true);
    for (const a of agents) {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(typeof a.available).toBe("boolean");
      expect(Array.isArray(a.modes)).toBe(true);
    }
  });

  it("contains known agents", () => {
    const agents = discoverAgents(true);
    const ids = agents.map(a => a.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("codex");
    expect(ids).toContain("opencode");
  });

  it("caches results within TTL", () => {
    const agents1 = discoverAgents(true);
    const agents2 = discoverAgents(false);
    expect(agents2).toEqual(agents1);
  });
});

describe("mcp-catalog", () => {
  afterEach(cleanAll);

  it("loadMcpServers returns builtin servers", () => {
    cleanAll();
    const servers = loadMcpServers();
    expect(servers.length).toBeGreaterThanOrEqual(5);
    const ids = servers.map(s => s.id);
    expect(ids).toContain("builtin-fs");
    expect(ids).toContain("builtin-sequential-thinking");
  });

  it("builtin servers are marked isBuiltin", () => {
    cleanAll();
    const servers = loadMcpServers();
    for (const s of servers.filter(s => s.id.startsWith("builtin-"))) {
      expect(s.isBuiltin).toBe(true);
    }
  });

  it("saveMcpServers persists user servers", () => {
    cleanAll();
    const userServer: McpServerConfig = {
      id: "user-test", name: "Test Server", transport: "stdio",
      command: "test-cmd", enabled: true, isBuiltin: false,
    };
    saveMcpServers([...loadMcpServers(), userServer]);
    const loaded = loadMcpServers();
    const found = loaded.find(s => s.id === "user-test");
    expect(found).toBeTruthy();
    expect(found!.name).toBe("Test Server");
  });

  it("toggleMcpServer enables/disables", () => {
    cleanAll();
    toggleMcpServer("builtin-fs", false);
    const servers = loadMcpServers();
    const sv = servers.find(s => s.id === "builtin-fs");
    expect(sv!.enabled).toBe(false);
    toggleMcpServer("builtin-fs", true);
    expect(loadMcpServers().find(s => s.id === "builtin-fs")!.enabled).toBe(true);
  });

  it("addMcpServer adds new server", () => {
    cleanAll();
    const server: McpServerConfig = {
      id: "new-server", name: "New", transport: "stdio",
      command: "new-cmd", enabled: true, isBuiltin: false,
    };
    addMcpServer(server);
    expect(loadMcpServers().find(s => s.id === "new-server")).toBeTruthy();
  });

  it("addMcpServer updates existing", () => {
    cleanAll();
    const server: McpServerConfig = {
      id: "builtin-fs", name: "Updated FS", transport: "stdio",
      command: "npx", enabled: true, isBuiltin: true,
    };
    addMcpServer(server);
    expect(loadMcpServers().find(s => s.id === "builtin-fs")!.name).toBe("Updated FS");
  });

  it("removeMcpServer removes user server", () => {
    cleanAll();
    const server: McpServerConfig = {
      id: "remove-me", name: "Remove", transport: "stdio",
      command: "test", enabled: true, isBuiltin: false,
    };
    addMcpServer(server);
    expect(removeMcpServer("remove-me")).toBe(true);
    expect(removeMcpServer("nonexistent")).toBe(false);
  });

  it("getEnabledMcpServers only returns enabled", () => {
    cleanAll();
    toggleMcpServer("builtin-fs", true);
    toggleMcpServer("builtin-puppeteer", false);
    const enabled = getEnabledMcpServers();
    for (const s of enabled) {
      expect(s.enabled).toBe(true);
    }
  });

  it("buildMcpContextForPrompt returns content when servers enabled", () => {
    cleanAll();
    toggleMcpServer("builtin-fs", true);
    // Sequential thinking is already enabled by default
    // Re-add it explicitly to ensure it's persisted
    const ctx = buildMcpContextForPrompt();
    expect(ctx).toContain("MCP Servers");
  });

  it("buildMcpContextForPrompt returns empty when no servers enabled", () => {
    cleanAll();
    // Fresh state: disable all builtins
    for (const s of loadMcpServers()) {
      if (s.isBuiltin) toggleMcpServer(s.id, false);
    }
    expect(buildMcpContextForPrompt()).toBe("");
  });
});

describe("team-manager", () => {
  afterEach(() => {
    try { fs.unlinkSync(TEAMS_CONFIG_PATH); } catch {}
  });

  it("createTeam creates and returns team", () => {
    const team = createTeam("Test Team", "/tmp", "claude-code");
    expect(team.name).toBe("Test Team");
    expect(team.workspace).toBe("/tmp");
    expect(team.leaderAgentId).toBe("claude-code");
    expect(team.agents.length).toBe(1);
    expect(team.agents[0].role).toBe("leader");
  });

  it("getTeams returns all teams", () => {
    createTeam("Team 1", "/tmp", "claude-code");
    createTeam("Team 2", "/tmp", "codex");
    const teams = getTeams();
    expect(teams.length).toBe(2);
  });

  it("deleteTeam removes team", () => {
    const team = createTeam("Delete Me", "/tmp", "claude-code");
    expect(deleteTeam(team.id)).toBe(true);
    expect(getTeams().length).toBe(0);
  });

  it("getTeam returns team by id", () => {
    const team = createTeam("Find Me", "/tmp", "claude-code");
    const found = getTeam(team.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe("Find Me");
  });

  it("getTeam returns undefined for missing", () => {
    expect(getTeam("nonexistent")).toBeUndefined();
  });

  it("deleteTeam returns false for missing", () => {
    expect(deleteTeam("nonexistent")).toBe(false);
  });

  it("addAgentToTeam adds teammate", () => {
    const team = createTeam("Team", "/tmp", "claude-code");
    const slot = addAgentToTeam(team.id, "codex");
    expect(slot).toBeTruthy();
    expect(slot!.role).toBe("teammate");
    expect(slot!.agentId).toBe("codex");
    expect(getTeam(team.id)!.agents.length).toBe(2);
  });

  it("addAgentToTeam returns undefined for unknown agent", () => {
    const team = createTeam("Team", "/tmp", "claude-code");
    const result = addAgentToTeam(team.id, "nonexistent-agent-xyz");
    expect(result).toBeUndefined();
  });

  it("removeAgentFromTeam removes teammate", () => {
    const team = createTeam("Team", "/tmp", "claude-code");
    const slot = addAgentToTeam(team.id, "codex")!;
    expect(removeAgentFromTeam(team.id, slot.slotId)).toBe(true);
    expect(getTeam(team.id)!.agents.length).toBe(1);
  });

  it("removeAgentFromTeam cannot remove leader", () => {
    const team = createTeam("Team", "/tmp", "claude-code");
    expect(removeAgentFromTeam(team.id, team.agents[0].slotId)).toBe(false);
  });

  it("updateAgentStatus updates agent state", () => {
    const team = createTeam("Team", "/tmp", "claude-code");
    updateAgentStatus(team.id, team.agents[0].slotId, "active", { model: "gpt-4" });
    const updated = getTeam(team.id);
    expect(updated!.agents[0].status).toBe("active");
    expect(updated!.agents[0].model).toBe("gpt-4");
  });

  it("getTeamContext returns context with team info", () => {
    const team = createTeam("Context Team", "/tmp/work", "claude-code");
    addAgentToTeam(team.id, "codex");
    const ctx = getTeamContext(team.id);
    expect(ctx).toContain("Context Team");
    expect(ctx).toContain("/tmp/work");
    expect(ctx).toContain("shared");
  });
});
