import { Type } from "typebox";
import { ConfigurationError } from "../errors";

export const SUBAGENT_TOOLS = {
  read: {
    name: "read",
    description: "Read the contents of a file from the local filesystem.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative or absolute path to the file to read" })
    }, { additionalProperties: false })
  },
  write: {
    name: "write",
    description: "Create or overwrite a file with the specified content.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative or absolute path to the file to write" }),
      content: Type.String({ description: "The complete content to write to the file" })
    }, { additionalProperties: false })
  },
  edit: {
    name: "edit",
    description: "Edit an existing file by searching for a specific block of text and replacing it.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative or absolute path to the file to edit" }),
      find: Type.String({ description: "The exact block of text in the file to find" }),
      replace: Type.String({ description: "The replacement block of text" })
    }, { additionalProperties: false })
  },
  ls: {
    name: "ls",
    description: "List the files and folders in a directory.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Relative or absolute path to the directory (defaults to current directory)" }))
    }, { additionalProperties: false })
  },
  grep: {
    name: "grep",
    description: "Find lines matching a search pattern (regex or substring) inside files.",
    parameters: Type.Object({
      pattern: Type.String({ description: "The pattern/substring to search for" }),
      path: Type.Optional(Type.String({ description: "Optional relative/absolute path to search inside (defaults to current directory)" }))
    }, { additionalProperties: false })
  },
  bash: {
    name: "bash",
    description: "Run a bash shell command on the host system. Use this only for building, testing, or running projects.",
    parameters: Type.Object({
      command: Type.String({ description: "The shell command to execute" })
    }, { additionalProperties: false })
  },
  web_search: {
    name: "web_search",
    description: "Perform a web search to get up-to-date information.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query to lookup on the web" })
    }, { additionalProperties: false })
  },
  web_fetch: {
    name: "web_fetch",
    description: "Fetch and extract text content from a web page/URL.",
    parameters: Type.Object({
      url: Type.String({ description: "The absolute URL of the web page to fetch" })
    }, { additionalProperties: false })
  },
  request_tool: {
    name: "request_tool",
    description: "Request a missing tool from the CEO agent. The CEO evaluates and adds it to your toolkit if approved.",
    parameters: Type.Object({
      toolName: Type.String({ description: "Name of the tool you need (e.g., write, bash, edit, web_fetch)" }),
      reason: Type.String({ description: "Why you need this tool for your current task" }),
      requestingAgent: Type.String({ description: "Your own agent name (e.g., builder, researcher, reviewer)" }),
    })
  },
  create_subagent: {
    name: "create_subagent",
    description: "Update a sub-agent's configuration to add new tools. Only the CEO agent should use this.",
    parameters: Type.Object({
      name: Type.String({ description: "The agent name to update" }),
      tools: Type.Array(Type.String(), { description: "Full list of allowed tools for this agent" }),
    })
  }
};

export function resolveModel(ctx: any, modelNameOrId?: string): any {
  const allModels = ctx.modelRegistry.getAll();
  const targetId = modelNameOrId || (ctx.model ? ctx.model.id : "");
  if (!targetId) {
    if (allModels.length > 0) return allModels[0];
    throw new ConfigurationError("No models available in model registry.");
  }
  if (targetId.includes("/")) {
    const [provider, id] = targetId.split("/");
    const found = allModels.find((m: any) => m.provider === provider && m.id === id);
    if (found) return found;
  }
  const exactMatch = allModels.find((m: any) => m.id === targetId);
  if (exactMatch) return exactMatch;
  const caseInsensitiveMatch = allModels.find((m: any) => m.id.toLowerCase() === targetId.toLowerCase());
  if (caseInsensitiveMatch) return caseInsensitiveMatch;
  return ctx.model || allModels[0];
}

export function resolveFastModel(ctx: any): any {
  if (ctx.model) return ctx.model;
  const allModels = ctx.modelRegistry.getAll();
  const fastKeywords = ["flash", "mini", "haiku", "llama-3-8b", "qwen-7b", "qwen-2.5-7b"];
  for (const kw of fastKeywords) {
    const found = allModels.find((m: any) => m.id.toLowerCase().includes(kw));
    if (found) return found;
  }
  return resolveModel(ctx);
}
