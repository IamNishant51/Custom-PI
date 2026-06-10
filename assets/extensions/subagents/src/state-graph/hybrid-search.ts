import { PropertyGraph, getGraph } from "./property-graph";
import { cosineSimilarity } from "../memory-embedding";

export type SearchStrategy = "bm25" | "dense" | "graph" | "hybrid" | "rerank";

export interface SearchOptions {
  strategy?: SearchStrategy;
  topK?: number;
  minScore?: number;
  nodeTypes?: string[];
  filters?: Record<string, any>;
  rerank?: boolean;
  includeEdges?: boolean;
}

export interface SearchResult {
  nodeId: string;
  label: string;
  type: string;
  score: number;
  content: string;
  properties: Record<string, any>;
  matchedOn: SearchStrategy[];
  neighbors?: Array<{ id: string; label: string; relationship: string }>;
}

interface BM25Index {
  idf: Map<string, number>;
  docFreq: Map<string, number>;
  docLengths: Map<string, number>;
  termDocs: Map<string, Set<string>>;
  avgDocLength: number;
}

export class HybridSearch {
  private graph: PropertyGraph;
  private bm25Index: BM25Index | null = null;
  private denseIndex: Map<string, number[]> = new Map();
  private indexVersion = 0;
  private k1 = 1.5;
  private b = 0.75;

  constructor(graph?: PropertyGraph) {
    this.graph = graph || getGraph();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const strategy = options.strategy || "hybrid";
    const topK = options.topK || 10;
    const minScore = options.minScore || 0.0;

    let results: SearchResult[] = [];

    switch (strategy) {
      case "bm25":
        results = await this.bm25Search(query, topK);
        break;
      case "dense":
        results = await this.denseSearch(query, topK);
        break;
      case "graph":
        results = await this.graphSearch(query, options);
        break;
      case "rerank":
        results = await this.rerankSearch(query, topK);
        break;
      case "hybrid":
      default: {
        const [bm25Results, denseResults, graphResults] = await Promise.all([
          this.bm25Search(query, topK * 2),
          this.denseSearch(query, topK * 2),
          this.graphSearch(query, { ...options, topK: topK * 2 }),
        ]);
        results = this.fuseResults([bm25Results, denseResults, graphResults], topK);
        break;
      }
    }

    if (options.nodeTypes && options.nodeTypes.length > 0) {
      results = results.filter(r => options.nodeTypes!.includes(r.type));
    }

    if (options.filters) {
      results = results.filter(r => {
        for (const [key, value] of Object.entries(options.filters!)) {
          if (r.properties[key] !== value) return false;
        }
        return true;
      });
    }

    if (options.includeEdges) {
      for (const result of results) {
        const neighbors = this.graph.findNeighbors(result.nodeId, 1);
        result.neighbors = neighbors.nodes
          .filter(n => n.id !== result.nodeId)
          .map(n => {
            const edge = neighbors.edges.find(e => e.sourceId === result.nodeId && e.targetId === n.id);
            return {
              id: n.id,
              label: n.label,
              relationship: edge?.type || "unknown",
            };
          });
      }
    }

    return results
      .filter(r => r.score >= minScore)
      .slice(0, topK);
  }

  async rebuildIndex(): Promise<void> {
    const nodes = this.graph.queryNodes({ limit: 100000 });
    this.bm25Index = this.buildBM25Index(nodes);
    this.indexVersion++;
  }

  addToIndex(nodeId: string, embeddings?: number[]): void {
    if (embeddings && embeddings.length > 0) {
      this.denseIndex.set(nodeId, embeddings);
    }
    this.bm25Index = null;
    this.indexVersion++;
  }

  removeFromIndex(nodeId: string): void {
    this.denseIndex.delete(nodeId);
    this.bm25Index = null;
    this.indexVersion++;
  }

  private async bm25Search(query: string, topK: number): Promise<SearchResult[]> {
    if (!this.bm25Index || this.indexVersion > 0) {
      const nodes = this.graph.queryNodes({ limit: 100000 });
      this.bm25Index = this.buildBM25Index(nodes);
    }
    const index = this.bm25Index;
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    const scores = new Map<string, number>();
    for (const term of queryTerms) {
      const idf = index.idf.get(term) || 0;
      if (idf === 0) continue;
      const docs = index.termDocs.get(term);
      if (!docs) continue;
      for (const docId of docs) {
        const docLen = index.docLengths.get(docId) || 1;
        const tf = this.termFrequency(docId, term);
        const score = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (docLen / index.avgDocLength))));
        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }

    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return sorted.map(([nodeId, score]) => {
      const node = this.graph.getNode(nodeId);
      if (!node) return null;
      return {
        nodeId: node.id,
        label: node.label,
        type: node.type,
        score,
        content: node.label,
        properties: node.properties,
        matchedOn: ["bm25"] as SearchStrategy[],
      };
    }).filter(Boolean) as SearchResult[];
  }

  private async denseSearch(query: string, topK: number): Promise<SearchResult[]> {
    let queryVec: number[];
    try {
      const { embed } = await import("../memory-embedding");
      queryVec = await embed(query);
    } catch {
      return [];
    }
    if (!queryVec || queryVec.length === 0) return [];

    const nodes = this.graph.queryNodes({ limit: 100000 });
    const scored: Array<{ nodeId: string; score: number }> = [];

    for (const node of nodes) {
      const nodeEmbedding = node.properties._embedding;
      if (!nodeEmbedding || !Array.isArray(nodeEmbedding)) continue;
      const sim = cosineSimilarity(queryVec, nodeEmbedding);
      if (sim > 0.1) {
        scored.push({ nodeId: node.id, score: sim });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ nodeId, score }) => {
        const node = this.graph.getNode(nodeId);
        if (!node) return null;
        return {
          nodeId: node.id,
          label: node.label,
          type: node.type,
          score,
          content: node.label,
          properties: node.properties,
          matchedOn: ["dense"] as SearchStrategy[],
        };
      }).filter(Boolean) as SearchResult[];
  }

  private async graphSearch(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const topK = options.topK || 10;
    const nodes = this.graph.queryNodes({ limit: 100000 });
    const queryLower = query.toLowerCase();
    const queryTokens = this.tokenize(query);

    const scored: Array<{ nodeId: string; score: number; matched: boolean }> = [];

    for (const node of nodes) {
      let score = 0;
      let matched = false;

      if (node.label.toLowerCase().includes(queryLower)) {
        score += 2.0;
        matched = true;
      }

      const labelTokens = this.tokenize(node.label);
      const overlap = queryTokens.filter(t => labelTokens.includes(t)).length;
      if (overlap > 0) {
        score += (overlap / Math.max(queryTokens.length, labelTokens.length)) * 1.5;
        matched = true;
      }

      const neighbors = this.graph.queryEdges(node.id);
      const neighborLabels = neighbors
        .map(e => {
          const n = e.targetId !== node.id ? this.graph.getNode(e.targetId) : this.graph.getNode(e.sourceId);
          return n?.label || "";
        })
        .filter(Boolean);

      const neighborMatch = neighborLabels.filter(l => l.toLowerCase().includes(queryLower)).length;
      if (neighborMatch > 0) {
        score += neighborMatch * 0.5;
        matched = true;
      }

      if (matched) {
        scored.push({ nodeId: node.id, score, matched });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ nodeId, score }) => {
        const node = this.graph.getNode(nodeId);
        if (!node) return null;
        return {
          nodeId: node.id,
          label: node.label,
          type: node.type,
          score,
          content: node.label,
          properties: node.properties,
          matchedOn: ["graph"] as SearchStrategy[],
        };
      }).filter(Boolean) as SearchResult[];
  }

  private async rerankSearch(query: string, topK: number): Promise<SearchResult[]> {
    const bm25Results = await this.bm25Search(query, topK * 3);
    if (bm25Results.length === 0) return [];

    const pairs = bm25Results.map(r => ({ query, text: r.label }));
    const scores = await this.lexicalRerank(pairs);
    const reranked = bm25Results.map((r, i) => ({ ...r, score: scores[i] || 0 }));
    return reranked
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(r => ({ ...r, matchedOn: [...r.matchedOn, "rerank"] as SearchStrategy[] }));
  }

  /** Lexical overlap reranking (Jaccard + exact match) — NOT a neural cross-encoder */
  private async lexicalRerank(pairs: Array<{ query: string; text: string }>): Promise<number[]> {
    return pairs.map(p => {
      const q = p.query.toLowerCase();
      const t = p.text.toLowerCase();
      const qTokens = new Set(q.split(/\s+/));
      const tTokens = t.split(/\s+/);
      const overlap = tTokens.filter(w => qTokens.has(w)).length;
      const jaccard = qTokens.size > 0 ? overlap / (qTokens.size + tTokens.length - overlap) : 0;
      const exactMatch = t.includes(q) ? 0.3 : 0;
      return jaccard + exactMatch;
    });
  }

  private fuseResults(resultSets: SearchResult[][], topK: number): SearchResult[] {
    const fused = new Map<string, SearchResult>();

    const weights = [0.5, 0.3, 0.2];
    for (let setIdx = 0; setIdx < resultSets.length; setIdx++) {
      const results = resultSets[setIdx];
      const weight = weights[setIdx] || 0.1;

      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const existing = fused.get(result.nodeId);
        const score = weight / (rank + 1);

        if (existing) {
          existing.score += score;
          existing.matchedOn = [...new Set([...existing.matchedOn, ...result.matchedOn])];
        } else {
          fused.set(result.nodeId, {
            ...result,
            score,
            matchedOn: result.matchedOn,
          });
        }
      }
    }

    return Array.from(fused.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private buildBM25Index(nodes: any[]): BM25Index {
    const idf = new Map<string, number>();
    const docFreq = new Map<string, number>();
    const docLengths = new Map<string, number>();
    const termDocs = new Map<string, Set<string>>();
    let totalDocLength = 0;
    const numDocs = nodes.length;

    for (const node of nodes) {
      const terms = this.tokenize(node.label + " " + JSON.stringify(node.properties));
      const uniqueTerms = new Set(terms);
      docLengths.set(node.id, terms.length);
      totalDocLength += terms.length;

      for (const term of uniqueTerms) {
        const docs = termDocs.get(term) || new Set();
        docs.add(node.id);
        termDocs.set(term, docs);
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }

    const avgDocLength = numDocs > 0 ? totalDocLength / numDocs : 1;

    for (const [term, df] of docFreq) {
      idf.set(term, Math.log(1 + (numDocs - df + 0.5) / (df + 0.5)));
    }

    return { idf, docFreq, docLengths, termDocs, avgDocLength };
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1 && t.length < 50);
  }

  private termFrequency(docId: string, term: string): number {
    const node = this.graph.getNode(docId);
    if (!node) return 0;
    const tokens = this.tokenize(node.label + " " + JSON.stringify(node.properties));
    return tokens.filter(t => t === term).length;
  }
}
