export function serializeMessageContent(msg: any, maxLen?: number): string {
  if (typeof msg.content === "string") return maxLen ? msg.content.slice(0, maxLen) : msg.content;
  if (!Array.isArray(msg.content)) return "";
  const parts = msg.content.map((c: any) => {
    if (typeof c === "string") return c;
    if (!c || typeof c !== "object") return "";
    if (c.type === "text") return c.text || "";
    if (c.type === "toolCall") return `[Tool Call: ${c.name}(${JSON.stringify(c.arguments)})]`;
    if (c.type === "toolCallData") return `[Tool Call: ${c.name}(${JSON.stringify(c.args || c.arguments)})]`;
    if (c.type === "toolResult") {
      const text = c.content?.[0]?.text || c.text || "";
      return `[Tool Result: ${text.slice(0, 1000)}]`;
    }
    return "";
  });
  const result = parts.join("\n");
  return maxLen ? result.slice(0, maxLen) : result;
}

export function extractToolName(msg: any): string | null {
  if (!Array.isArray(msg.content)) return null;
  const tc = msg.content.find((c: any) => c?.type === "toolCall" || c?.type === "toolCallData");
  return tc?.name || null;
}

export function extractToolArgs(msg: any): string | null {
  if (!Array.isArray(msg.content)) return null;
  const tc = msg.content.find((c: any) => c?.type === "toolCall" || c?.type === "toolCallData");
  return tc?.arguments ? JSON.stringify(tc.arguments) : tc?.args ? JSON.stringify(tc.args) : null;
}

export function hasToolCalls(msg: any): boolean {
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((c: any) => c?.type === "toolCall" || c?.type === "toolCallData");
}

export function countToolCalls(msg: any): number {
  if (!Array.isArray(msg.content)) return 0;
  return msg.content.filter((c: any) => c?.type === "toolCall" || c?.type === "toolCallData").length;
}

export function getConversationText(messages: any[], maxLen: number = 500): string {
  return messages.map((m: any) => {
    const text = serializeMessageContent(m, maxLen);
    return `${m.role.toUpperCase()}: ${text}`;
  }).join("\n\n");
}
