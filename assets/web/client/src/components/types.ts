export interface Agent {
  id: string;
  role: string;
  tools: string[];
  status: "idle" | "running" | "calling_tool" | "paused" | "done" | "error" | "completed" | "planning";
  currentTool?: string;
  currentTask?: string;
  logs: string[];
  result?: string;
}

export interface SavedTeam {
  name: string;
  goal: string;
  agents: Array<{ id: string; role: string; tools: string[]; task: string }>;
  createdAt: string;
  default?: boolean;
}

export interface SwarmMessage {
  type: "swarm_start" | "ceo_thought" | "ceo_plan" | "agent_status" | "agent_log" | "agent_done" | "tool_request" | "tool_provisioned" | "ceo_summary" | "swarm_error" | "interrupted" | "swarm_recovery" | "swarm_paused" | "swarm_resumed" | "agent_chat" | "gmail_auth_required";
  goal?: string;
  message?: string;
  agents?: Array<{ id: string; role: string; tools: string[]; task: string; status?: string; currentTask?: string; logs?: string[] }>;
  agentId?: string;
  status?: Agent["status"];
  currentTool?: string;
  currentTask?: string;
  toolName?: string;
  reason?: string;
  result?: string;
  summary?: string;
  paused?: boolean;
  agentResults?: Record<string, string>;
  ceoLogs?: string[];
  fromAgent?: boolean;
}
