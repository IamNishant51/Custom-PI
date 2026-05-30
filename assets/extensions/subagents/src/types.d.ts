// Module declarations for packages without published types

declare module "@earendil-works/pi-coding-agent" {
  export type Component = any;
  export type ExtensionAPI = any;
  export type ExtensionContext = any;
  export const ToolRenderContext: any;
  export type ToolRenderResultOptions = any;
  export type AgentToolUpdateCallback<T> = any;
  export type AgentToolResult<T> = any;
  export function completeSimple(model: any, options: any): Promise<any>;
}

declare module "@earendil-works/pi-tui" {
  export type Component = any;
}

declare module "typebox" {
  export const Type: any;
}

declare module "yaml" {
  export function parse(str: string): any;
  export function stringify(obj: any): string;
}

declare module "chalk" {
  const chalk: any;
  export default chalk;
}

declare module "@earendil-works/pi-ai" {
  export function completeSimple(model: any, options: {
    messages: any[];
    system?: string;
    systemPrompt?: string;
    tools?: any[];
    maxTokens?: number;
    signal?: AbortSignal;
  }, overrides?: {
    apiKey?: string;
    headers?: Record<string, string>;
    reasoning?: any;
  }): Promise<any>;
}

// Global types used in the extension
type ToolRenderContext<T1 = any, T2 = any> = any;

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}
interface SubAgentProgress {
  id: string;
  task: string;
  status: string;
  currentTool?: string;
  currentToolArgs?: string;
  toolCallCount: number;
  startTime: number;
  endTime?: number;
  agent?: string;
  name?: string;
  turn?: number;
  maxTurns?: number;
  type?: string;
  result?: string;
  error?: string;
  outputLines?: string[];
  ceoRequest?: {
    status: 'requesting' | 'ceo_evaluating' | 'ceo_approved' | 'ceo_denied';
    toolName: string;
    startedAt: number;
    ceoName?: string;
  };
}

interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
  maxTurns?: number;
  temperature?: number;
  description?: string;
  thinking?: boolean;
}

interface SkillMeta {
  problemType: string;
  approach: string;
  keySteps: string[];
  complexityScore: number;
  successCount: number;
}
