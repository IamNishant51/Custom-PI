// WebSocket Protocol — Shared types between client and server
// Version: 1
// All WS messages are JSON-encoded strings.

// ── Common Base ──────────────────────────────────────────
export interface WsMessageBase {
  type: string;
  [key: string]: unknown;
}

// ── Server → Client (WebSocket → Browser) ─────────────

export interface WsChatHistory {
  type: "chat_history";
  messages: Array<{ role: string; content: string }>;
}

export interface WsSessionStart {
  type: "session_start";
}

export interface WsError {
  type: "error";
  message: string;
}

export interface WsSwarmStart {
  type: "swarm_start";
  goal: string;
}

export interface WsCeoThought {
  type: "ceo_thought";
  message: string;
}

export interface WsCeoPlan {
  type: "ceo_plan";
  agents: Array<{ id: string; role: string; tools: string[]; task: string }>;
}

export interface WsAgentStatus {
  type: "agent_status";
  agentId: string;
  status: "idle" | "running" | "calling_tool" | "done" | "error";
  currentTool?: string;
  currentTask?: string;
}

export interface WsAgentLog {
  type: "agent_log";
  agentId: string;
  message: string;
}

export interface WsAgentDone {
  type: "agent_done";
  agentId: string;
  result?: string;
}

export interface WsToolRequest {
  type: "tool_request";
  agentId: string;
  toolName: string;
  reason?: string;
}

export interface WsToolProvisioned {
  type: "tool_provisioned";
  agentId: string;
  toolName: string;
}

export interface WsCeoSummary {
  type: "ceo_summary";
  summary: string;
}

export interface WsSwarmError {
  type: "swarm_error";
  message: string;
}

export interface WsInterrupted {
  type: "interrupted";
}

export interface WsSwarmPaused {
  type: "swarm_paused";
}

export interface WsSwarmResumed {
  type: "swarm_resumed";
}

export interface WsSwarmRecovery {
  type: "swarm_recovery";
  goal?: string;
  ceoLogs?: string[];
  agents?: Array<{
    id: string; role: string; tools: string[];
    status: string; currentTask?: string; logs?: string[];
  }>;
  summary?: string;
  status?: string;
  paused?: boolean;
}

export interface WsAgentChat {
  type: "agent_chat";
  agentId: string;
  message?: string;
  fromAgent?: boolean;
}

export interface WsMemoryResults {
  type: "memory_results";
  results: unknown[];
}

export interface WsGmailAuthRequired {
  type: "gmail_auth_required";
  verificationUrl: string;
  userCode: string;
}

export type ServerMessage =
  | WsChatHistory
  | WsSessionStart
  | WsError
  | WsSwarmStart
  | WsCeoThought
  | WsCeoPlan
  | WsAgentStatus
  | WsAgentLog
  | WsAgentDone
  | WsToolRequest
  | WsToolProvisioned
  | WsCeoSummary
  | WsSwarmError
  | WsInterrupted
  | WsSwarmPaused
  | WsSwarmResumed
  | WsSwarmRecovery
  | WsAgentChat
  | WsMemoryResults
  | WsGmailAuthRequired;

// ── Client → Server (Browser → WebSocket) ─────────────

export interface WsClientChat {
  type: "chat";
  message: string;
  cwd?: string;
  attachments?: Array<{ data?: string; text?: string; mime?: string }>;
}

export interface WsClientInterrupt {
  type: "interrupt";
}

export interface WsClientSwarmPause {
  type: "swarm_pause";
}

export interface WsClientSwarmResume {
  type: "swarm_resume";
}

export interface WsClientUserAnswer {
  type: "user_answer";
  questionId: string;
  answer: string;
}

export interface WsClientAgentChat {
  type: "agent_chat";
  agentId: string;
  message: string;
  cwd?: string;
}

export interface WsClientMemorySearch {
  type: "memory_search";
  query: string;
  k?: number;
}

export interface WsClientSubagentDelegate {
  type: "subagent_delegate";
  agentId: string;
  task: string;
}

export interface WsClientSwarmGoal {
  type: "swarm_goal";
  goal: string;
}

export interface WsClientRunDag {
  type: "run_dag";
  goal?: string;
}

export interface WsClientSwarmSavedTeam {
  type: "swarm_saved_team";
  goal: string;
  agents: Array<{ id: string; role: string; tools: string[]; task: string }>;
}

export type ClientMessage =
  | WsClientChat
  | WsClientInterrupt
  | WsClientSwarmPause
  | WsClientSwarmResume
  | WsClientUserAnswer
  | WsClientAgentChat
  | WsClientMemorySearch
  | WsClientSubagentDelegate
  | WsClientSwarmGoal
  | WsClientRunDag
  | WsClientSwarmSavedTeam;

// ── Message Type Enum ──────────────────────────────────
export const WS_TYPES = {
  // Server → Client
  CHAT_HISTORY: "chat_history",
  SESSION_START: "session_start",
  ERROR: "error",
  SWARM_START: "swarm_start",
  CEO_THOUGHT: "ceo_thought",
  CEO_PLAN: "ceo_plan",
  AGENT_STATUS: "agent_status",
  AGENT_LOG: "agent_log",
  AGENT_DONE: "agent_done",
  TOOL_REQUEST: "tool_request",
  TOOL_PROVISIONED: "tool_provisioned",
  CEO_SUMMARY: "ceo_summary",
  SWARM_ERROR: "swarm_error",
  INTERRUPTED: "interrupted",
  SWARM_PAUSED: "swarm_paused",
  SWARM_RESUMED: "swarm_resumed",
  SWARM_RECOVERY: "swarm_recovery",
  AGENT_CHAT: "agent_chat",
  MEMORY_RESULTS: "memory_results",
  GMAIL_AUTH_REQUIRED: "gmail_auth_required",

  // Client → Server
  CHAT: "chat",
  INTERRUPT: "interrupt",
  SWARM_PAUSE: "swarm_pause",
  SWARM_RESUME: "swarm_resume",
  USER_ANSWER: "user_answer",
  MEMORY_SEARCH: "memory_search",
  SUBAGENT_DELEGATE: "subagent_delegate",
  SWARM_GOAL: "swarm_goal",
  RUN_DAG: "run_dag",
  SWARM_SAVED_TEAM: "swarm_saved_team",
} as const;
