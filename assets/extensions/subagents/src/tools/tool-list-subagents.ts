import { Type } from "typebox";
import { SubAgentListCard } from "../tui/components";
import { loadAgents } from "../runtime/agent-config";

export const toolListSubagents = {
  name: "list_subagents",
  label: "List Sub-Agents",
  description: "List all available specialized sub-agents and their capabilities",
  parameters: Type.Object({
    includeDetails: Type.Optional(Type.Boolean({ description: "Set to true to see full system prompts" })),
  }),
  renderShell: "self",
  renderResult(result: any, options: any, _theme: any, ctx: any) {
    return new SubAgentListCard(result, options);
  },
  async execute(id: string, params: { includeDetails?: boolean }, signal: any, update: any, context: any) {
    const agents = loadAgents();
    const list = Array.from(agents.values()).map(a =>
      `- **${a.name}**: ${a.description} (Model: ${a.model || "default"}, Tools: ${a.tools?.join(", ") || "none"})`
    ).join("\n");

    return {
      content: [{
        type: "text",
        text: list || "No sub-agents configured. Create them dynamically using create_subagent."
      }],
    };
  },
};
