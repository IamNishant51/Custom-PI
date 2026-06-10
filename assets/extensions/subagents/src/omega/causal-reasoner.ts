import { getGraph } from "../state-graph/property-graph";

interface CausalLink {
  cause: string;
  effect: string;
  strength: number;
  mechanism: string;
  evidence: string[];
  confidence: number;
}

interface CausalGraph {
  nodes: Map<string, { label: string; type: string; properties: any }>;
  edges: CausalLink[];
}

interface CounterfactualResult {
  question: string;
  outcome: string;
  confidence: number;
  reasoning: string[];
}

interface RootCauseResult {
  symptoms: string[];
  rootCause: string;
  causalChain: string[];
  confidence: number;
  recommendation: string;
}

export class CausalReasoner {
  private causalGraph: CausalGraph = { nodes: new Map(), edges: [] };

  inferCausalLink(cause: string, effect: string, context?: string): CausalLink {
    const strength = this.estimateCausalStrength(cause, effect, context);
    const link: CausalLink = {
      cause,
      effect,
      strength,
      mechanism: this.inferMechanism(cause, effect),
      evidence: [`Inferred from context: ${context || "general knowledge"}`],
      confidence: strength * 0.8 + 0.1,
    };

    this.causalGraph.edges.push(link);
    this.causalGraph.nodes.set(cause, { label: cause, type: "cause", properties: {} });
    this.causalGraph.nodes.set(effect, { label: effect, type: "effect", properties: {} });

    return link;
  }

  analyzeRootCause(symptoms: string[], events: Array<{ timestamp: number; description: string; type: string }>): RootCauseResult {
    const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);
    const causalChains: string[][] = [];
    const candidates: Array<{ cause: string; score: number }> = [];

    for (const symptom of symptoms) {
      for (const event of sorted) {
        if (this.isRelated(event, symptom)) {
          const chain = this.buildCausalChain(event, sorted, symptom);
          causalChains.push(chain);

          const rootCause = chain[chain.length - 1];
          const existing = candidates.find(c => c.cause === rootCause);
          if (existing) existing.score++;
          else candidates.push({ cause: rootCause, score: 1 });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const bestRoot = candidates[0];

    const bestChain = causalChains
      .filter(c => c[c.length - 1] === bestRoot?.cause)
      .sort((a, b) => a.length - b.length)[0] || [];

    return {
      symptoms,
      rootCause: bestRoot?.cause || "Unknown root cause",
      causalChain: bestChain,
      confidence: bestRoot ? Math.min(1, bestRoot.score / symptoms.length) : 0.1,
      recommendation: bestRoot
        ? `Address root cause: "${bestRoot.cause}". Then verify chain: ${bestChain.join(" → ")}`
        : "Insufficient data to determine root cause",
    };
  }

  evaluateCounterfactual(question: string, fact: string, alternative: string): CounterfactualResult {
    const reasoning: string[] = [
      `Original: ${fact}`,
      `Counterfactual: if ${alternative} instead`,
      ``,
    ];

    const relatedEdges = this.causalGraph.edges.filter(e =>
      fact.toLowerCase().includes(e.cause.toLowerCase()) ||
      fact.toLowerCase().includes(e.effect.toLowerCase())
    );

    if (relatedEdges.length > 0) {
      for (const edge of relatedEdges) {
        reasoning.push(`Causal relationship: ${edge.cause} → ${edge.effect} (strength: ${edge.strength.toFixed(2)})`);
        reasoning.push(`If ${alternative}, the effect on "${edge.effect}" would be affected by approximately ${(edge.strength * 100).toFixed(0)}%`);
      }
    } else {
      reasoning.push(`No direct causal links found in knowledge base for this scenario`);
      reasoning.push(`Estimated impact of change: moderate (based on similarity to known patterns)`);
    }

    const confidence = relatedEdges.length > 0
      ? Math.min(1, relatedEdges.reduce((s, e) => s + e.confidence, 0) / relatedEdges.length)
      : 0.3;

    return {
      question,
      outcome: `If "${alternative}" instead of "${fact}", the most likely outcome is: ${this.simulateOutcome(fact, alternative, relatedEdges)}`,
      confidence,
      reasoning,
    };
  }

  getCausalGraph(): CausalGraph {
    return this.causalGraph;
  }

  findStrongestCausalPath(from: string, to: string): CausalLink[] {
    const visited = new Set<string>();
    const queue: Array<{ node: string; path: CausalLink[] }> = [{ node: from, path: [] }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.node)) continue;
      visited.add(current.node);

      const outgoing = this.causalGraph.edges.filter(e => e.cause === current.node);
      for (const edge of outgoing) {
        const newPath = [...current.path, edge];
        if (edge.effect === to) return newPath;
        if (!visited.has(edge.effect)) {
          queue.push({ node: edge.effect, path: newPath });
        }
      }
    }

    return [];
  }

  private estimateCausalStrength(cause: string, effect: string, context?: string): number {
    const temporalWords = ["after", "then", "subsequently", "later", "following"];
    const causalWords = ["because", "therefore", "thus", "hence", "so", "since"];

    let strength = 0.5;
    if (context) {
      const hasTemporal = temporalWords.some(w => context.includes(w));
      const hasCausal = causalWords.some(w => context.includes(w));
      if (hasCausal) strength += 0.3;
      if (hasTemporal) strength += 0.1;
    }

    const similarLinks = this.causalGraph.edges.filter(e =>
      (e.cause.includes(cause) || cause.includes(e.cause)) &&
      (e.effect.includes(effect) || effect.includes(e.effect))
    );

    if (similarLinks.length > 0) {
      strength = Math.min(1, strength + similarLinks.reduce((s, e) => s + e.strength, 0) * 0.1);
    }

    return Math.min(1, Math.max(0, strength));
  }

  private inferMechanism(cause: string, effect: string): string {
    const mechanismPatterns: Array<{ match: string; mechanism: string }> = [
      { match: "deploy", mechanism: "deployment triggers state change" },
      { match: "error", mechanism: "error propagates through dependency chain" },
      { match: "change", mechanism: "modification cascades through related components" },
      { match: "test", mechanism: "verification validates or invalidates assumptions" },
    ];

    for (const pattern of mechanismPatterns) {
      if (cause.includes(pattern.match) || effect.includes(pattern.match)) {
        return pattern.mechanism;
      }
    }
    return "unspecified causal mechanism";
  }

  private isRelated(event: { description: string; type: string }, symptom: string): boolean {
    return event.description.toLowerCase().includes(symptom.toLowerCase()) ||
           event.type.toLowerCase().includes(symptom.toLowerCase()) ||
           symptom.toLowerCase().includes(event.type.toLowerCase());
  }

  private buildCausalChain(event: any, allEvents: any[], symptom: string): string[] {
    const chain: string[] = [event.description];
    const eventTime = event.timestamp;

    const preceding = allEvents.filter(e =>
      e.timestamp < eventTime &&
      e.timestamp > eventTime - 3600000 &&
      !chain.includes(e.description)
    ).sort((a, b) => b.timestamp - a.timestamp);

    for (const e of preceding.slice(0, 3)) {
      chain.push(e.description);
    }

    chain.push(symptom);
    return chain;
  }

  private simulateOutcome(fact: string, alternative: string, relatedEdges: CausalLink[]): string {
    if (relatedEdges.length === 0) {
      return `Changing "${fact}" to "${alternative}" would likely produce a different outcome, but the exact nature is uncertain without established causal patterns.`;
    }

    const strongest = relatedEdges.sort((a, b) => b.strength - a.strength)[0];
    const impact = (strongest.strength * 100).toFixed(0);

    return `The change would primarily affect "${strongest.effect}" with approximately ${impact}% impact. The causal link "${strongest.cause} → ${strongest.effect}" suggests that "${alternative}" would modify the outcome through "${strongest.mechanism}".`;
  }
}

export const causalReasoner = new CausalReasoner();
