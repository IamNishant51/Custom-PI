// WebSocket Protocol — Shared types between client and server
// Prefix: "ws/"  Version: 1

// ── Server → Client Messages ─────────────────────────
export interface WsMessage<T = any> {
  type: string;
  payload: T;
  timestamp: number;
  version?: number;
}

// Agent status updates
export interface AgentStatusPayload {
  agentId: string;
  status: "idle" | "working" | "done" | "error";
  currentTool?: string;
  currentTask?: string;
}

// Swarm lifecycle
export interface SwarmStartPayload { goal: string; teamSize: number; }
export interface SwarmProgressPayload { agentId: string; message: string; }
export interface SwarmCompletePayload { goal: string; summary: string; }

// CEO thoughts & logs
export interface CeoThoughtPayload { message: string; }
export interface AgentLogPayload { agentId: string; message: string; }

// Tool requests/provisioning
export interface ToolRequestPayload { agentId: string; toolName: string; reason: string; }
export interface ToolProvisionedPayload { agentId: string; toolName: string; }

// Cost tracking
export interface CostPayload {
  sessionId: string; agent: string; provider: string;
  modelId: string; inputTokens: number; outputTokens: number;
  totalTokens: number; costUsd: number; timestamp: string;
}

// Budget updates
export interface BudgetPayload { action: string; config: Record<string, unknown>; }

// ── Client → Server Messages ─────────────────────────
export interface ClientMessage {
  type: "ping" | "subscribe" | "unsubscribe";
  channel?: string;
}

// ── Message Type Enum ────────────────────────────────
export const WS_MESSAGE_TYPES = {
  AGENT_STATUS: "agent_status",
  AGENT_LOG: "agent_log",
  CEO_THOUGHT: "ceo_thought",
  SWARM_START: "swarm_start",
  SWARM_PROGRESS: "swarm_progress",
  SWARM_COMPLETE: "swarm_complete",
  TOOL_REQUEST: "tool_request",
  TOOL_PROVISIONED: "tool_provisioned",
  COST: "cost",
  BUDGET: "budget",
  PONG: "pong",
} as const;
