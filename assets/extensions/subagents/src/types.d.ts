// Module declarations for packages without published types

declare module "@earendil-works/pi-coding-agent" {
  export interface ToolRenderContext<TArgs = any, TResult = any> {
    toolCallId: string;
    args: TArgs;
    result: TResult;
    isError?: boolean;
    invalidate: () => void;
  }

  export interface ToolRenderResultOptions {
    expanded: boolean;
  }

  export interface AgentToolUpdateCallback<T> {
    (result: T): void;
  }

  export interface AgentToolResult<T> {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
    details?: { fullResult?: string };
  }

  export interface ExtensionAPI {
    registerTool: {
      (name: string, definition: any, handler: any): void;
      (opts: { name: string; label?: string; description?: string; parameters?: any; renderShell?: ((...args: any[]) => string) | string; execute: (...args: any[]) => any }): void;
    };
    registerComponent: (name: string, component: any) => void;
    registerCardRenderer: (name: string, renderer: any) => void;
    registerCommand: (name: string, handler: any, description?: string) => void;
    applyPatches: () => void;
    sendMessage: (message: any) => void;
    on: (event: string, handler: (...args: any[]) => void) => void;
  }

  export interface ModelInfo {
    id: string;
    provider: string;
    label?: string;
  }

  export interface ModelRegistry {
    getAll: () => ModelInfo[];
    getById: (id: string) => ModelInfo | undefined;
    getApiKeyAndHeaders: (model: any) => Promise<{ apiKey?: string; headers?: Record<string, string>; ok?: boolean; error?: string }>;
  }

  export interface ExtensionContext {
    model?: ModelInfo;
    modelRegistry: ModelRegistry;
    cwd: string;
    sessionId: string;
    metrics?: {
      increment?: (name: string, value: number) => void;
      timing?: (name: string, value: number) => void;
    };
    ui: {
      setWorkingIndicator: (indicator?: string) => void;
      setWorkingMessage: (msg?: string) => void;
      setStatus: (key: string, value: any) => void;
      notify: (message: string, type?: string) => void;
      setWidget: (name: string, widget: any, options?: { placement?: string }) => void;
    };
  }

  export type ComponentConstructor = new (...args: any[]) => any;
  export const UserMessageComponent: ComponentConstructor;
  export const AssistantMessageComponent: ComponentConstructor;
}

declare module "@earendil-works/pi-tui" {
  export interface Component {
    invalidate(): void;
    render(width: number): string[];
    dispose?(): void;
    setTheme?(t: any): void;
  }

  export interface Container {
    children: Component[];
    render(width: number): string[];
  }

  export interface TUI {
    onKey: (key: string, handler: () => void) => void;
    setHeader: (header: string) => void;
    setFooter: (footer: string) => void;
    render: () => void;
  }

  export const visibleWidth: (text: string) => number;
  export const CURSOR_MARKER: string;
}

declare module "typebox" {
  interface TypeBuilder {
    Object(properties: Record<string, any>, options?: { additionalProperties?: boolean }): any;
    String(options?: { description?: string }): any;
    Number(options?: { description?: string }): any;
    Boolean(options?: { description?: string }): any;
    Array(item: any, options?: { description?: string }): any;
    Optional(schema: any): any;
  }
  export const Type: TypeBuilder;
}

declare module "yaml" {
  interface YAMLParseOptions {
    schema?: string;
  }
  export function parse(str: string, options?: YAMLParseOptions): any;
  export function stringify(obj: any, options?: { indent?: number }): string;
}

declare module "chalk" {
  interface ChalkInstance {
    (text: string): string;
    hex(color: string): ChalkInstance;
    bold: (text: string) => string;
  }
  interface Chalk extends ChalkInstance {
    hex: (color: string) => ChalkInstance;
  }
  const chalk: Chalk;
  export default chalk;
}

declare module "better-sqlite3" {
  interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(sql: string, options?: { simple?: boolean }): any;
    close(): void;
  }
  interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    bind(...params: unknown[]): Statement;
  }
  interface DatabaseConstructor {
    new (path: string, options?: { readonly?: boolean }): Database;
    (path: string, options?: { readonly?: boolean }): Database;
  }
  declare const Database: DatabaseConstructor;
  export default Database;
}

declare module "@earendil-works/pi-ai" {
  export function completeSimple(
    model: any,
    options: {
      messages: any[];
      system?: string;
      systemPrompt?: string;
      tools?: any[];
      maxTokens?: number;
      signal?: AbortSignal;
    },
    overrides?: {
      apiKey?: string;
      headers?: Record<string, string>;
      reasoning?: any;
    },
  ): Promise<any>;
}

// Global types used in the extension
interface ToolRenderContext<T1 = any, T2 = any> {
  toolCallId: string;
  args: T1;
  result: T2;
  isError?: boolean;
  invalidate: () => void;
}

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
  thinking?: string | boolean;
}

interface SkillMeta {
  problemType: string;
  approach: string;
  keySteps: string[];
  complexityScore: number;
  successCount: number;
}
