import { trackCost } from "./cost-tracker";

export interface ModelRoute {
  tier: "cheap" | "balanced" | "capable" | "reasoning";
  provider: string;
  model: string;
}

const MODELS: Record<string, ModelRoute> = {
  // Sonnet — default capable
  "claude-sonnet-4": { tier: "capable", provider: "anthropic", model: "claude-sonnet-4" },
  "claude-haiku-3.5": { tier: "cheap", provider: "anthropic", model: "claude-haiku-3.5" },
  // OpenAI
  "gpt-4o": { tier: "capable", provider: "openai", model: "gpt-4o" },
  "gpt-4o-mini": { tier: "cheap", provider: "openai", model: "gpt-4o-mini" },
  // Gemini
  "gemini-2.5-flash": { tier: "balanced", provider: "google", model: "gemini-2.5-flash" },
  "gemini-2.5-pro": { tier: "capable", provider: "google", model: "gemini-2.5-pro" },
};

const DEFAULT_ROUTES: Record<string, string> = {
  cheap: "gpt-4o-mini",
  balanced: "gemini-2.5-flash",
  capable: "claude-sonnet-4",
  reasoning: "claude-sonnet-4",
};

let currentRoutes = { ...DEFAULT_ROUTES };

export function resolveModelForTask(task: {
  complexity: "simple" | "moderate" | "complex" | "reasoning";
  estimatedTokens?: number;
}): ModelRoute {
  const tierMap: Record<string, "cheap" | "balanced" | "capable" | "reasoning"> = {
    simple: "cheap",
    moderate: "balanced",
    complex: "capable",
    reasoning: "reasoning",
  };

  const tier = tierMap[task.complexity] || "balanced";
  const modelId = currentRoutes[tier];
  return MODELS[modelId] || MODELS["claude-sonnet-4"];
}

export function getModelRouteForTier(tier: string): string {
  return currentRoutes[tier] || "claude-sonnet-4";
}

export function setModelRoute(tier: string, modelId: string): boolean {
  if (!MODELS[modelId]) return false;
  if (!["cheap", "balanced", "capable", "reasoning"].includes(tier)) return false;
  currentRoutes[tier] = modelId;
  return true;
}

export function getAvailableModels(): { id: string; tier: string; label: string }[] {
  return Object.entries(MODELS).map(([id, route]) => ({
    id,
    tier: route.tier,
    label: `${route.provider}/${route.model}`,
  }));
}

export function getCurrentRouting(): Record<string, string> {
  return { ...currentRoutes };
}

export function resetRouting(): void {
  currentRoutes = { ...DEFAULT_ROUTES };
}

export function trackCostWithRetry(
  sessionId: string,
  agent: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  retries?: number,
) {
  const result = trackCost(sessionId, agent, provider, model, inputTokens, outputTokens);
  return {
    ...result,
    retries: retries ?? 0,
  };
}

export function getModelCostProfile(modelId: string): { input: number; output: number } | null {
  const route = MODELS[modelId];
  if (!route) return null;
  return null; // cost-tracker manages rates
}
