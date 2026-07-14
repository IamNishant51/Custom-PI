import { spawn } from "node:child_process";
import readline from "node:readline";
import { logger } from "../logger";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  enabled: boolean;
  description?: string;
}

export class McpCliConnection {
  cfg: McpServerConfig;
  proc: any;
  tools: any[];
  pendingRequests: Map<number, { resolve: Function; reject: Function }>;
  nextRequestId: number;
  initialized: boolean;

  constructor(cfg: McpServerConfig) {
    this.cfg = cfg;
    this.proc = null;
    this.tools = [];
    this.pendingRequests = new Map();
    this.nextRequestId = 1;
    this.initialized = false;
  }

  async start() {
    return new Promise<void>((resolve, reject) => {
      try {
        this.proc = spawn(this.cfg.command, this.cfg.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32'
        });

        this.proc.on('error', (err: any) => {
          reject(err);
        });

        this.proc.on('exit', () => {
          this.cleanup();
        });

        const rl = readline.createInterface({ input: this.proc.stdout });
        rl.on('line', (line) => {
          this.handleMessage(line);
        });

        if (this.proc.stderr) {
          const rlErr = readline.createInterface({ input: this.proc.stderr });
          rlErr.on('line', (line) => {
            logger.debug(`[MCP Server ${this.cfg.name} Stderr] ${line}`);
          });
        }

        this.initializeHandshake().then(() => {
          resolve();
        }).catch(reject);

      } catch (err) {
        reject(err);
      }
    });
  }

  cleanup() {
    this.initialized = false;
    this.tools = [];
    for (const req of this.pendingRequests.values()) {
      req.reject(new Error("MCP server connection closed"));
    }
    this.pendingRequests.clear();
    if (this.proc) {
      try { this.proc.kill(); } catch (e: any) { logger.warn("MCP config init write failed", e?.message || String(e)); }
      this.proc = null;
    }
  }

  sendRequest(method: string, params: any) {
    return new Promise<any>((resolve, reject) => {
      if (!this.proc) return reject(new Error("MCP server not running"));
      const id = this.nextRequestId++;
      const req = { jsonrpc: "2.0", id, method, params };
      this.pendingRequests.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    });
  }

  sendNotification(method: string, params: any) {
    if (!this.proc) return;
    const notification = { jsonrpc: "2.0", method, params };
    this.proc.stdin.write(JSON.stringify(notification) + "\n");
  }

  handleMessage(line: string) {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || "Unknown MCP error"));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    } catch (e) { logger.warn("MCP message parse failed", { error: e }); }
  }

  async initializeHandshake() {
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "custom-pi-client", version: "1.0.0" }
    });

    this.sendNotification("notifications/initialized", {});
    this.initialized = true;

    const toolsResult = await this.sendRequest("tools/list", {});
    this.tools = toolsResult.tools || [];
  }

  async callTool(name: string, args: any) {
    const res = await this.sendRequest("tools/call", { name, arguments: args });
    return res;
  }
}
