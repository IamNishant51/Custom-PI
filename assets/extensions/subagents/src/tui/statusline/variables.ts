export type StatusLineContext = {
  model: { id: string };
  session: { totalTokens: number; totalCost: number; turns: number };
  context: { used: number; window: number };
  version: string;
  status: "idle" | "thinking" | "working" | "error";
};

const STATUS_LIGHT_MAP: Record<string, string> = {
  idle: "\u{1F7E2}",
  thinking: "\u{1F7E1}",
  working: "\u{1F534}",
  error: "\u26A0\uFE0F",
};

export function resolveVariable(name: string, ctx: StatusLineContext): string | null {
  switch (name) {
    case "model_id":
      return ctx.model.id;
    case "total_tokens":
      return String(ctx.session.totalTokens);
    case "total_cost":
      return String(ctx.session.totalCost);
    case "context_used":
      return String(ctx.context.used);
    case "context_used_pct":
      return `${Math.round((ctx.context.used / ctx.context.window) * 100)}`;
    case "context_window":
      return String(ctx.context.window);
    case "session_turns":
      return String(ctx.session.turns);
    case "version":
      return ctx.version;
    case "status_light":
      return STATUS_LIGHT_MAP[ctx.status] ?? "\u{1F7E2}";
    default:
      return null;
  }
}
