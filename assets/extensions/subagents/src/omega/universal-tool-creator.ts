import { logger } from "../logger";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config";
import os from "node:os";
import { bus, Topics } from "../event-bus/event-bus";

interface APISpec {
  name: string;
  baseUrl: string;
  authType: "none" | "api-key" | "bearer" | "basic" | "oauth2";
  authInstructions?: string;
  endpoints: Array<{
    path: string;
    method: string;
    description: string;
    parameters: Array<{ name: string; type: string; required: boolean; location: "query" | "body" | "path" | "header" }>;
    responseType: string;
  }>;
}

interface CreatedTool {
  name: string;
  description: string;
  apiSpec: APISpec;
  code: string;
  createdAt: number;
  usageCount: number;
  successCount: number;
  lastUsed?: number;
}

export class UniversalToolCreator {
  private createdTools: Map<string, CreatedTool> = new Map();
  private toolsDir: string;

  constructor() {
    this.toolsDir = PATHS.CUSTOM_TOOLS;
    if (!fs.existsSync(this.toolsDir)) fs.mkdirSync(this.toolsDir, { recursive: true });
    this.loadTools();
  }

  async createToolFromAPI(spec: APISpec): Promise<CreatedTool> {
    const code = this.generateToolCode(spec);
    const name = `custom_${spec.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const description = `Custom tool for ${spec.name}: ${spec.baseUrl}`;

    const tool: CreatedTool = {
      name,
      description,
      apiSpec: spec,
      code,
      createdAt: Date.now(),
      usageCount: 0,
      successCount: 0,
    };

    this.createdTools.set(name, tool);
    this.saveToolCode(name, code);
    this.persistTool(tool);

    bus.emit(Topics.PLUGIN_LOADED, {
      tool: name,
      source: "universal-creator",
      endpoints: spec.endpoints.length,
    }, { source: "universal-tool-creator" });

    return tool;
  }

  async createToolFromReadme(readme: string, packageName: string): Promise<CreatedTool | null> {
    const spec = this.parseReadmeForAPI(readme, packageName);
    if (!spec) return null;
    return this.createToolFromAPI(spec);
  }

  getTool(name: string): CreatedTool | undefined {
    return this.createdTools.get(name);
  }

  getAllTools(): CreatedTool[] {
    return Array.from(this.createdTools.values());
  }

  recordUsage(name: string, success: boolean): void {
    const tool = this.createdTools.get(name);
    if (tool) {
      tool.usageCount++;
      if (success) tool.successCount++;
      tool.lastUsed = Date.now();
    }
  }

  getTopTools(k = 10): CreatedTool[] {
    return Array.from(this.createdTools.values())
      .sort((a, b) => {
        const aScore = a.successCount / Math.max(1, a.usageCount);
        const bScore = b.successCount / Math.max(1, b.usageCount);
        return bScore - aScore;
      })
      .slice(0, k);
  }

  private generateToolCode(spec: APISpec): string {
    const lines: string[] = [];
    lines.push(`// Auto-generated tool: ${spec.name}`);
    lines.push(`// Source: ${spec.baseUrl}`);
    lines.push(`// Generated: ${new Date().toISOString()}`);
    lines.push(``);
    lines.push(`export async function ${spec.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}(params = {}) {`);
    lines.push(`  const results = [];`);
    lines.push(``);

    for (const endpoint of spec.endpoints) {
      const fnName = `${spec.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${endpoint.path.replace(/[/{}]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "root"}`;
      const method = endpoint.method.toLowerCase();
      const queryParams = endpoint.parameters.filter(p => p.location === "query").map(p => p.name);
      const pathParams = endpoint.parameters.filter(p => p.location === "path").map(p => p.name);

      lines.push(`  async function ${fnName}(params = {}) {`);
      lines.push(`    try {`);

      const url = endpoint.path;
      if (pathParams.length > 0) {
        lines.push(`      let url = \`${endpoint.path}\`;`);
        lines.push(`      ${pathParams.map(p => `url = url.replace(\`:${p}\`, encodeURIComponent(params.${p}));`).join("\n      ")}`);
      } else {
        lines.push(`      const url = \`${spec.baseUrl}${endpoint.path}\`;`);
      }

      if (queryParams.length > 0) {
        lines.push(`      const qs = new URLSearchParams();`);
        lines.push(`      ${queryParams.map(p => `if (params.${p}) qs.set("${p}", params.${p});`).join("\n      ")}`);
        lines.push(`      const fullUrl = url + "?" + qs.toString();`);
      } else {
        lines.push(`      const fullUrl = url;`);
      }

      lines.push(`      const options = { method: "${method.toUpperCase()}", headers: {} };`);
      if (spec.authType === "api-key") lines.push(`      options.headers["X-API-Key"] = process.env.${spec.name.toUpperCase()}_API_KEY || "";`);
      if (spec.authType === "bearer") lines.push(`      options.headers["Authorization"] = \`Bearer \${process.env.${spec.name.toUpperCase()}_TOKEN || ""}\`;`);
      if (endpoint.parameters.some(p => p.location === "body")) lines.push(`      options.headers["Content-Type"] = "application/json";\n      options.body = JSON.stringify(params.body || {});`);

      lines.push(`      const response = await fetch(fullUrl, options);`);
      lines.push(`      if (!response.ok) throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);`);
      lines.push(`      return await response.json();`);
      lines.push(`    } catch (err) {`);
      lines.push(`      return { error: err.message, endpoint: "${endpoint.path}" };`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(``);
      lines.push(`  results.push({ endpoint: "${endpoint.path}", execute: ${fnName} });`);
      lines.push(``);
    }

    lines.push(`  return results;`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`export const toolMeta = {`);
    lines.push(`  name: "${spec.name}",`);
    lines.push(`  description: "Auto-generated tool from ${spec.baseUrl}",`);
    lines.push(`  version: "1.0.0",`);
    lines.push(`  endpoints: ${JSON.stringify(spec.endpoints.map(e => e.path))},`);
    lines.push(`};`);

    return lines.join("\n");
  }

  private parseReadmeForAPI(readme: string, packageName: string): APISpec | null {
    const urlMatch = readme.match(/https?:\/\/[^\s)]+/);
    if (!urlMatch) return null;

    const baseUrl = urlMatch[0].replace(/\/+$/, "");
    const name = packageName || baseUrl.split("/").pop() || "api";

    const endpoints: APISpec["endpoints"] = [];

    const pathMatches = readme.matchAll(/`(GET|POST|PUT|DELETE|PATCH)\s+(\/[a-zA-Z0-9_/{}.-]*)`/g);
    for (const match of pathMatches) {
      const method = match[1];
      const urlPath = match[2];
      endpoints.push({
        path: urlPath,
        method,
        description: `Endpoint: ${method} ${urlPath}`,
        parameters: [],
        responseType: "json",
      });
    }

    if (endpoints.length === 0) {
      endpoints.push({
        path: "/",
        method: "GET",
        description: "Root endpoint",
        parameters: [],
        responseType: "json",
      });
    }

    let authType: APISpec["authType"] = "none";
    if (readme.includes("API key") || readme.includes("api-key")) authType = "api-key";
    else if (readme.includes("Bearer") || readme.includes("bearer")) authType = "bearer";
    else if (readme.includes("OAuth") || readme.includes("oauth")) authType = "oauth2";

    return { name, baseUrl, authType, endpoints };
  }

  private saveToolCode(name: string, code: string): void {
    const filePath = path.join(this.toolsDir, `${name}.mjs`);
    fs.writeFileSync(filePath, code, "utf8");
  }

  private persistTool(tool: CreatedTool): void {
    const indexPath = path.join(this.toolsDir, "index.json");
    let tools: CreatedTool[] = [];
    try { tools = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
    const existing = tools.findIndex(t => t.name === tool.name);
    if (existing >= 0) tools[existing] = tool;
    else tools.push(tool);
    const tmp = indexPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(tools, null, 2));
    fs.renameSync(tmp, indexPath);
  }

  private loadTools(): void {
    try {
      const indexPath = path.join(this.toolsDir, "index.json");
      if (!fs.existsSync(indexPath)) return;
      const tools: CreatedTool[] = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      for (const tool of tools) {
        this.createdTools.set(tool.name, tool);
      }
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
  }
}

export const universalToolCreator = new UniversalToolCreator();
