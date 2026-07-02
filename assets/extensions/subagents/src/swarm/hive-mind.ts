import { bus, Topics } from "../event-bus/event-bus";
import { getGraph } from "../state-graph/property-graph";
import { logger } from "../logger";

export type AgentRole = "architect" | "backend-dev" | "frontend-dev" | "devops" | "security-reviewer" | "tester" | "researcher" | "writer" | "reviewer" | "planner" | "builder";

export type DecisionModel = "consensus" | "majority" | "unanimous" | "chief" | "weighted";

interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  capabilities: string[];
  status: "idle" | "working" | "blocked" | "error";
  currentTaskId?: string;
  performance: { tasksCompleted: number; successRate: number; averageTime: number };
  specializations: string[];
}

interface TeamFormationRequest {
  goal: string;
  requiredRoles: AgentRole[];
  decisionModel: DecisionModel;
  communicationPattern: "daily-standup" | "continuous" | "on-completion";
  context?: string;
}

interface Team {
  id: string;
  name: string;
  goal: string;
  agents: AgentProfile[];
  decisionModel: DecisionModel;
  status: "forming" | "active" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
}

interface ConsensusProposal {
  id: string;
  teamId: string;
  title: string;
  description: string;
  options: string[];
  votes: Map<string, string>;
  status: "voting" | "approved" | "rejected" | "tie";
  deadline: number;
  createdAt: number;
}

export class HiveMind {
  private agents: Map<string, AgentProfile> = new Map();
  private teams: Map<string, Team> = new Map();
  private proposals: Map<string, ConsensusProposal> = new Map();
  private sharedKnowledgeBase: Map<string, { value: any; source: string; timestamp: number; confidence: number }> = new Map();

  constructor() {
    this.registerDefaultAgents();
    this.setupListeners();
  }

  private registerDefaultAgents(): void {
    const defaultAgents: AgentProfile[] = [
      { id: "agent_ceo", name: "CEO", role: "architect", capabilities: ["planning", "delegation", "review"], status: "idle", performance: { tasksCompleted: 0, successRate: 1, averageTime: 0 }, specializations: ["system-design", "architecture"] },
      { id: "agent_researcher", name: "Researcher", role: "researcher", capabilities: ["search", "analysis", "documentation"], status: "idle", performance: { tasksCompleted: 0, successRate: 1, averageTime: 0 }, specializations: ["codebase-analysis", "trend-research"] },
      { id: "agent_builder", name: "Builder", role: "builder", capabilities: ["coding", "implementation", "refactoring"], status: "idle", performance: { tasksCompleted: 0, successRate: 1, averageTime: 0 }, specializations: ["fullstack", "api-dev"] },
      { id: "agent_reviewer", name: "Reviewer", role: "reviewer", capabilities: ["code-review", "security-audit", "quality-check"], status: "idle", performance: { tasksCompleted: 0, successRate: 1, averageTime: 0 }, specializations: ["security", "performance"] },
      { id: "agent_tester", name: "Tester", role: "tester", capabilities: ["testing", "coverage", "qa"], status: "idle", performance: { tasksCompleted: 0, successRate: 1, averageTime: 0 }, specializations: ["e2e-testing", "unit-testing"] },
      { id: "agent_planner", name: "Planner", role: "planner", capabilities: ["planning", "estimation", "risk-analysis"], status: "idle", performance: { tasksCompleted: 0, successRate: 1, averageTime: 0 }, specializations: ["project-planning", "sprint-planning"] },
    ];

    for (const agent of defaultAgents) {
      this.agents.set(agent.id, agent);
    }
  }

  private setupListeners(): void {
    bus.on(Topics.AGENT_COMPLETE, (event) => {
      this.updateAgentPerformance(event.data.agentId, true);
    });
    bus.on(Topics.AGENT_ERROR, (event) => {
      this.updateAgentPerformance(event.data.agentId, false);
    });
  }

  registerAgent(agent: AgentProfile): void {
    this.agents.set(agent.id, agent);
    this.broadcastKnowledge("agent_online", { agentId: agent.id, role: agent.role, capabilities: agent.capabilities }, agent.id);
  }

  getAgent(id: string): AgentProfile | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  findAgentsByRole(role: AgentRole): AgentProfile[] {
    return Array.from(this.agents.values()).filter(a => a.role === role && a.status === "idle");
  }

  findAgentsByCapability(capability: string): AgentProfile[] {
    return Array.from(this.agents.values()).filter(a => a.capabilities.includes(capability) && a.status === "idle");
  }

  async formTeam(request: TeamFormationRequest): Promise<Team> {
    const teamId = `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const teamAgents: AgentProfile[] = [];

    for (const role of request.requiredRoles) {
      const available = this.findAgentsByRole(role);
      if (available.length > 0) {
        const agent = available.sort((a, b) => b.performance.successRate - a.performance.successRate)[0]!;
        agent.status = "working";
        teamAgents.push(agent);
      }
    }

    const team: Team = {
      id: teamId,
      name: `Team for: ${request.goal.slice(0, 50)}`,
      goal: request.goal,
      agents: teamAgents,
      decisionModel: request.decisionModel,
      status: "forming",
      createdAt: Date.now(),
    };

    this.teams.set(teamId, team);
    team.status = "active";

    bus.emit(Topics.AGENT_SPAWN, {
      teamId,
      agentCount: teamAgents.length,
      roles: request.requiredRoles,
      goal: request.goal,
    }, { source: "hive-mind" });

    return team;
  }

  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  getAllTeams(): Team[] {
    return Array.from(this.teams.values());
  }

  proposeConsensus(teamId: string, title: string, description: string, options: string[]): ConsensusProposal {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    const proposal: ConsensusProposal = {
      id: `prop_${Date.now()}`,
      teamId,
      title,
      description,
      options,
      votes: new Map(),
      status: "voting",
      deadline: Date.now() + 60000,
      createdAt: Date.now(),
    };

    this.proposals.set(proposal.id, proposal);

    // Auto-resolve after deadline
    setTimeout(() => {
      if (proposal.status === "voting") {
        proposal.status = this.resolveVotes(proposal);
      }
    }, 60000);

    return proposal;
  }

  vote(proposalId: string, agentId: string, vote: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status !== "voting") throw new Error("Voting is closed");
    if (Date.now() > proposal.deadline) {
      proposal.status = this.resolveVotes(proposal);
      throw new Error("Voting deadline passed");
    }
    proposal.votes.set(agentId, vote);
  }

  resolveProposal(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return;
    proposal.status = this.resolveVotes(proposal);
  }

  shareKnowledge(topic: string, value: any, source: string, confidence = 1.0): void {
    const existing = this.sharedKnowledgeBase.get(topic);
    if (existing && existing.confidence >= confidence) return;

    this.sharedKnowledgeBase.set(topic, { value, source, timestamp: Date.now(), confidence });

    bus.emit(Topics.MEMORY_STORED, {
      type: "shared_knowledge",
      topic,
      source,
      confidence,
    }, { source: "hive-mind" });

    for (const agent of this.agents.values()) {
      if (agent.id !== source && agent.status === "idle") {
        this.broadcastKnowledge(topic, value, source);
      }
    }
  }

  querySharedKnowledge(topic: string): any {
    return this.sharedKnowledgeBase.get(topic)?.value;
  }

  getAllSharedKnowledge(): Array<{ topic: string; value: any; source: string; confidence: number }> {
    return Array.from(this.sharedKnowledgeBase.entries()).map(([topic, data]) => ({ topic, ...data }));
  }

  completeTeam(teamId: string): void {
    const team = this.teams.get(teamId);
    if (team) {
      team.status = "completed";
      team.completedAt = Date.now();
      for (const agent of team.agents) {
        agent.status = "idle";
      }
      bus.emit(Topics.AGENT_COMPLETE, { teamId, agentCount: team.agents.length }, { source: "hive-mind" });
    }
  }

  private broadcastKnowledge(topic: string, value: any, source: string): void {
    try {
      const graph = getGraph();
      graph.addNode("concept", topic.slice(0, 200), { topic, value, source, timestamp: Date.now() });
    } catch (err) {
      logger.error("Failed to broadcast knowledge", { topic, error: String(err) });
    }
  }

  private updateAgentPerformance(agentId: string, success: boolean): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.performance.tasksCompleted++;
      agent.performance.successRate = (agent.performance.successRate * (agent.performance.tasksCompleted - 1) + (success ? 1 : 0)) / agent.performance.tasksCompleted;
      agent.status = "idle";
    }
  }

  private resolveVotes(proposal: ConsensusProposal): "approved" | "rejected" | "tie" {
    const team = this.teams.get(proposal.teamId);
    const agentCount = team ? team.agents.length : 0;
    const quorum = Math.max(2, Math.ceil(agentCount * 0.4));

    if (proposal.votes.size < quorum) return "rejected";

    const voteCount = new Map<string, number>();
    for (const vote of proposal.votes.values()) {
      voteCount.set(vote, (voteCount.get(vote) || 0) + 1);
    }

    let maxVotes = 0;
    let winners: string[] = [];
    for (const [option, count] of voteCount) {
      if (count > maxVotes) { maxVotes = count; winners = [option]; }
      else if (count === maxVotes) winners.push(option);
    }

    const totalVotes = proposal.votes.size;
    if (winners.length > 1) return "tie";
    return maxVotes > totalVotes / 2 ? "approved" : "rejected";
  }
}

export const hiveMind = new HiveMind();
