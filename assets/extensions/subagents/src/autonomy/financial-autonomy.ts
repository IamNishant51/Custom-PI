import { bus, Topics } from "../event-bus/event-bus";
import { getDaemon, Daemon } from "../daemon/daemon";
import { getGraph } from "../state-graph/property-graph";

interface CostEntry {
  id: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  task: string;
  timestamp: number;
}

interface BudgetConfig {
  monthlyBudget: number;
  monthlySpent: number;
  budgetPeriod: string;
  alertThreshold: number;
  maxCostPerTask: number;
}

export class FinancialAutonomy {
  private costHistory: CostEntry[] = [];
  private budget: BudgetConfig;
  private providerCosts: Map<string, { per1kIn: number; per1kOut: number }> = new Map();

  constructor() {
    this.budget = {
      monthlyBudget: 50,
      monthlySpent: 0,
      budgetPeriod: new Date().toISOString().slice(0, 7),
      alertThreshold: 0.8,
      maxCostPerTask: 5,
    };
    this.initializeProviderCosts();
    this.setupListeners();
    this.loadBudget();
  }

  private initializeProviderCosts(): void {
    this.providerCosts.set("openai", { per1kIn: 0.01, per1kOut: 0.03 });
    this.providerCosts.set("anthropic", { per1kIn: 0.008, per1kOut: 0.024 });
    this.providerCosts.set("google", { per1kIn: 0.005, per1kOut: 0.015 });
    this.providerCosts.set("nvidia", { per1kIn: 0.002, per1kOut: 0.006 });
    this.providerCosts.set("ollama", { per1kIn: 0, per1kOut: 0 });
    this.providerCosts.set("lmstudio", { per1kIn: 0, per1kOut: 0 });
  }

  private setupListeners(): void {
    bus.on(Topics.TOOL_RESULT, (event) => {
      const data = event.data;
      if (data.model && (data.tokensIn || data.tokensOut)) {
        this.trackCost({
          model: data.model,
          provider: data.provider || "unknown",
          tokensIn: data.tokensIn || 0,
          tokensOut: data.tokensOut || 0,
          task: data.task || "unknown",
          timestamp: Date.now(),
        });
      }
    });
  }

  trackCost(entry: Omit<CostEntry, "id" | "cost">): void {
    const cost = this.calculateCost(entry.provider, entry.tokensIn, entry.tokensOut);
    const id = `cost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full: CostEntry = { ...entry, id, cost };
    this.costHistory.push(full);
    if (this.costHistory.length > 10000) this.costHistory.splice(0, 1000);

    this.budget.monthlySpent += cost;

    bus.emit(Topics.COST_TRACKED, {
      model: entry.model,
      tokensIn: entry.tokensIn,
      tokensOut: entry.tokensOut,
      cost,
      totalSpent: this.budget.monthlySpent,
    }, { source: "financial-autonomy" });

    if (this.budget.monthlySpent > this.budget.monthlyBudget * this.budget.alertThreshold) {
      bus.emit(Topics.BUDGET_ALERT, {
        spent: this.budget.monthlySpent,
        budget: this.budget.monthlyBudget,
        percentUsed: Math.round((this.budget.monthlySpent / this.budget.monthlyBudget) * 100),
        threshold: this.budget.alertThreshold,
      }, { source: "financial-autonomy" });
    }
  }

  getCostSummary(): { total: number; byModel: Record<string, number>; byProvider: Record<string, number>; byTask: Record<string, number>; monthlySpent: number; monthlyBudget: number; percentUsed: number } {
    const byModel: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const byTask: Record<string, number> = {};
    let total = 0;

    for (const entry of this.costHistory) {
      total += entry.cost;
      byModel[entry.model] = (byModel[entry.model] || 0) + entry.cost;
      byProvider[entry.provider] = (byProvider[entry.provider] || 0) + entry.cost;
      byTask[entry.task] = (byTask[entry.task] || 0) + entry.cost;
    }

    return {
      total,
      byModel,
      byProvider,
      byTask,
      monthlySpent: this.budget.monthlySpent,
      monthlyBudget: this.budget.monthlyBudget,
      percentUsed: this.budget.monthlyBudget > 0 ? Math.round((this.budget.monthlySpent / this.budget.monthlyBudget) * 100) : 0,
    };
  }

  getCheapestProvider(): string {
    let bestProvider = "ollama";
    let bestCost = Infinity;
    for (const [provider, costs] of this.providerCosts) {
      const avgCost = (costs.per1kIn + costs.per1kOut) / 2;
      if (avgCost < bestCost) {
        bestCost = avgCost;
        bestProvider = provider;
      }
    }
    return bestProvider;
  }

  selectOptimalModel(taskComplexity: number): { provider: string; model: string } {
    if (taskComplexity <= 3) {
      return { provider: "ollama", model: "llama3.2:1b" };
    }
    if (taskComplexity <= 6) {
      return { provider: "nvidia", model: "qwen/qwen3-coder-480b-a35b-instruct" };
    }
    return { provider: "nvidia", model: "qwen/qwen3-coder-480b-a35b-instruct" };
  }

  setBudget(config: Partial<BudgetConfig>): void {
    Object.assign(this.budget, config);
    this.persistBudget();
  }

  getBudget(): BudgetConfig {
    return { ...this.budget };
  }

  canAffordTask(estimatedCost: number): boolean {
    return this.budget.monthlySpent + estimatedCost <= this.budget.monthlyBudget;
  }

  estimateTaskCost(tokensIn: number, tokensOut: number, provider = "nvidia"): number {
    return this.calculateCost(provider, tokensIn, tokensOut);
  }

  getRecentCosts(hours = 24): CostEntry[] {
    const cutoff = Date.now() - hours * 3600000;
    return this.costHistory.filter(e => e.timestamp >= cutoff);
  }

  private calculateCost(provider: string, tokensIn: number, tokensOut: number): number {
    const rates = this.providerCosts.get(provider) || { per1kIn: 0.01, per1kOut: 0.03 };
    return (tokensIn / 1000) * rates.per1kIn + (tokensOut / 1000) * rates.per1kOut;
  }

  private persistBudget(): void {
    try {
      const graph = getGraph();
      graph.addNode("custom", "Financial Budget", { ...this.budget }, { id: "financial_budget" });
    } catch {}
  }

  private loadBudget(): void {
    try {
      const graph = getGraph();
      const node = graph.getNode("financial_budget");
      if (node?.properties) {
        Object.assign(this.budget, node.properties);
      }
    } catch {}
  }
}

export const financialAutonomy = new FinancialAutonomy();
