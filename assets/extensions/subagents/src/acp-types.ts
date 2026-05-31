export type AgentType = "acp" | "aionrs" | "openclaw-gateway" | "nanobot" | "builtin";
export type AgentSource = "internal" | "builtin" | "extension" | "custom";
export type AgentStatus = "idle" | "running" | "error" | "unavailable";
export type AgentMode = "default" | "plan" | "yolo" | "auto_edit" | "read_only";

export interface AgentMetadata {
  id: string;
  name: string;
  icon?: string;
  backend?: string;
  agentType: AgentType;
  agentSource: AgentSource;
  enabled: boolean;
  available: boolean;
  supportsTeam: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  modes: AgentMode[];
}

export interface AcpCapabilities {
  loadSession: boolean;
  mcpStdio: boolean;
  mcpHttp: boolean;
  mcpSse: boolean;
  sessionFork: boolean;
  sessionResume: boolean;
  sessionList: boolean;
  sessionClose: boolean;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  capabilities: AcpCapabilities;
  agentInfo: { name: string; version?: string } | null;
  availableModes: AgentMode[];
  availableModels: { id: string; label: string }[];
}

export interface AcpSessionConfig {
  id: string;
  workspace?: string;
  mode?: AgentMode;
  model?: string;
  mcpServerIds?: string[];
  context?: string;
  rules?: string[];
}

export interface AcpSessionInfo {
  sessionId: string;
  agentId: string;
  status: AgentStatus;
  config: AcpSessionConfig;
  createdAt: number;
  lastActiveAt: number;
}

export interface AcpToolCall {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  reason?: string;
}

export interface AcpMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  isBuiltin: boolean;
}

export interface McpToolDefinition {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
