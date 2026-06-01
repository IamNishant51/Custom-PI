import { trackCost, calculateCpuw, COST_UNITS } from "./cost-tracker";
import { isProviderHealthy } from "./mcp-catalog";

export interface ModelRoute {
  tier: "cheap" | "balanced" | "capable" | "reasoning";
  provider: string;
  model: string;
}

export interface ProviderHealth {
  provider: string;
  healthy: boolean;
  fallback?: string;
}

const FALLBACK_CHAIN: Record<string, string[]> = {
  anthropic: ["openai", "google"],
  openai: ["anthropic", "google"],
  google: ["openai", "anthropic"],
};

const MODELS: Record<string, ModelRoute> = {
  "claude-sonnet-4": { tier: "capable", provider: "anthropic", model: "claude-sonnet-4" },
  "claude-haiku-3.5": { tier: "cheap", provider: "anthropic", model: "claude-haiku-3.5" },
  "gpt-4o": { tier: "capable", provider: "openai", model: "gpt-4o" },
  "gpt-4o-mini": { tier: "cheap", provider: "openai", model: "gpt-4o-mini" },
  "gemini-2.5-flash": { tier: "balanced", provider: "google", model: "gemini-2.5-flash" },
  "gemini-2.5-pro": { tier: "capable", provider: "google", model: "gemini-2.5-pro" },
};

const TIER_COST_ORDER: ("cheap" | "balanced" | "capable" | "reasoning")[] = ["cheap", "balanced", "capable", "reasoning"];

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
  budget?: "strict" | "normal" | "unlimited";
}): ModelRoute {
  const tierMap: Record<string, "cheap" | "balanced" | "capable" | "reasoning"> = {
    simple: "cheap",
    moderate: "balanced",
    complex: "capable",
    reasoning: "reasoning",
  };

  let tier = tierMap[task.complexity] || "balanced";

  // Budget-aware downgrade: if strict, try one tier cheaper
  if (task.budget === "strict" && tier !== "cheap") {
    const idx = TIER_COST_ORDER.indexOf(tier);
    if (idx > 0) tier = TIER_COST_ORDER[idx - 1];
  }

  const modelId = currentRoutes[tier];
  return resolveWithFallback(modelId);
}

export function resolveModelWithCpuw(
  sessionId: string,
  task: {
    complexity: "simple" | "moderate" | "complex" | "reasoning";
    estimatedTokens?: number;
    budget?: "strict" | "normal" | "unlimited";
  }
): { route: ModelRoute; cpuw: ReturnType<typeof calculateCpuw> } {
  const route = resolveModelForTask(task);
  const cpuw = calculateCpuw(sessionId);

  // If efficiency is low and budget is strict, downgrade further
  if (task.budget === "strict" && cpuw.efficiency === "low") {
    const currentTier = route.tier;
    const idx = TIER_COST_ORDER.indexOf(currentTier);
    if (idx > 0) {
      const cheaperTier = TIER_COST_ORDER[idx - 1];
      const cheaperId = currentRoutes[cheaperTier];
      const cheaper = MODELS[cheaperId];
      if (cheaper) return { route: cheaper, cpuw };
    }
  }

  return { route, cpuw };
}

function resolveWithFallback(modelId: string): ModelRoute {
  const primary = MODELS[modelId];
  if (!primary) return MODELS["claude-sonnet-4"];

  if (isProviderHealthy(primary.provider)) return primary;

  const fallbacks = FALLBACK_CHAIN[primary.provider] || [];
  for (const fbProvider of fallbacks) {
    if (!isProviderHealthy(fbProvider)) continue;
    const fbModel = findModelForTier(primary.tier, fbProvider);
    if (fbModel) return fbModel;
  }

  return primary;
}

function findModelForTier(tier: string, provider: string): ModelRoute | null {
  for (const m of Object.values(MODELS)) {
    if (m.tier === tier && m.provider === provider) return m;
  }
  return null;
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

export function getAvailableModels(): { id: string; tier: string; label: string; estimatedCostPer1kTokens: number }[] {
  return Object.entries(MODELS).map(([id, route]) => ({
    id,
    tier: route.tier,
    label: `${route.provider}/${route.model}`,
    estimatedCostPer1kTokens: getEstimatedCost(route),
  }));
}

function getEstimatedCost(route: ModelRoute): number {
  const RATES: Record<string, { input: number; output: number }> = {
    "anthropic/claude-sonnet-4": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
    "anthropic/claude-haiku-3.5": { input: 0.8 / 1_000_000, output: 4.0 / 1_000_000 },
    "openai/gpt-4o": { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
    "openai/gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    "google/gemini-2.5-flash": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    "google/gemini-2.5-pro": { input: 1.25 / 1_000_000, output: 5.0 / 1_000_000 },
  };
  const key = `${route.provider}/${route.model}`;
  const rate = RATES[key];
  if (!rate) return 0;
  return (rate.input + rate.output) * 1000; // per 1K tokens
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
  return null;
}
