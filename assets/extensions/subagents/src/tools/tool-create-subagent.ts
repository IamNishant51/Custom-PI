import { Type } from "typebox";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import chalk from "chalk";
import { SubAgentCreatedCard } from "../tui/components";
import { loadAgents, AGENTS_DIR_GLOBAL, invalidateAgentCache } from "../runtime/agent-config";
import { C } from "../tui-colors";

export const toolCreateSubagent = {
  name: "create_subagent",
  label: "Create Sub-Agent",
  description: "Dynamically create or update a specialized sub-agent template.",
  parameters: Type.Object({
    name: Type.String({ description: "Short alphanumeric name for the agent (e.g., coder, tester, researcher)" }),
    description: Type.String({ description: "Brief description of the agent's core capability" }),
    systemPrompt: Type.String({ description: "System prompt instructions defining its persona, rules, and behavior" }),
    tools: Type.Array(Type.String(), { description: "Allowed tools: read, write, edit, ls, grep, bash, web_search, web_fetch" }),
    model: Type.Optional(Type.String({ description: "Optional specific LLM model ID to use (e.g., qwen3.5:9b)" })),
    thinking: Type.Optional(Type.String({ description: "Optional thinking level: off, minimal, low, medium, high, xhigh" }))
  }),
  renderShell: "self",
  renderResult(result: any, options: any, _theme: any, ctx: any) {
    return new SubAgentCreatedCard(result, options);
  },
  async execute(id: string, params: {
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
    model?: string;
    thinking?: string;
  }, signal: any, update: any, context: any) {
    const agentsDir = AGENTS_DIR_GLOBAL;
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    const safeName = params.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const filePath = path.join(agentsDir, `${safeName}.md`);

    const frontmatter = {
      name: safeName,
      description: params.description,
      systemPrompt: params.systemPrompt,
      tools: params.tools,
      model: params.model || undefined,
      thinking: params.thinking || undefined
    };

    const markdownContent = `---
${yaml.stringify(frontmatter)}---

This specialized sub-agent is dynamically generated to handle complex tasks matching its capabilities.
`;

    fs.writeFileSync(filePath, markdownContent, "utf8");
    invalidateAgentCache();
    context.ui.notify(`${chalk.hex(C.teal)("\u2726")} Created sub-agent: ${chalk.hex(C.cream).bold(safeName)}`, "info");

    return {
      content: [{
        type: "text",
        text: `Name: ${safeName}\nDescription: ${params.description}\nTools: ${params.tools.join(", ")}\nModel: ${params.model || "default"}\nPath: ${filePath}`
      }],
    };
  },
};
