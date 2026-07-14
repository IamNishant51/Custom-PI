import { logger } from "../logger";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bus, Topics } from "../event-bus/event-bus";
import { getGraph } from "../state-graph/property-graph";

export type EpisodeType = "session" | "task" | "interaction" | "failure" | "success" | "learning" | "observation";
export type EmotionalValence = "very_positive" | "positive" | "neutral" | "negative" | "very_negative";

export interface Episode {
  id: string;
  type: EpisodeType;
  title: string;
  summary: string;
  content: string;
  valence: EmotionalValence;
  confidence?: number;
  tags: string[];
  context: Record<string, any>;
  relatedEpisodeIds?: string[];
  importance: number;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  compressed: boolean;
}

export class EpisodicMemory {
  private episodes: Map<string, Episode> = new Map();
  private episodesDir: string;
  private indexFile: string;
  private dirty = false;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const baseDir = path.join(os.homedir(), ".pi", "agent", "memory");
    this.episodesDir = path.join(baseDir, "episodes");
    this.indexFile = path.join(baseDir, "episodes-index.json");
    if (!fs.existsSync(this.episodesDir)) fs.mkdirSync(this.episodesDir, { recursive: true });
    this.loadIndex();
    this.persistTimer = setInterval(() => this.persistIndex(), 30_000);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    bus.on(Topics.SESSION_END, (event) => {
      this.storeEpisode({
        type: "session",
        title: `Session ${event.data.sessionId}`,
        summary: `Session ended. ${event.data.messageCount || 0} messages.`,
        content: JSON.stringify(event.data),
        valence: "neutral",
        tags: ["session", event.data.sessionId],
        context: { sessionId: event.data.sessionId },
      });
    });

    bus.on(Topics.TOOL_ERROR, (event) => {
      this.storeEpisode({
        type: "failure",
        title: `Tool Error: ${event.data.toolName}`,
        summary: event.data.error?.slice(0, 200) || "Unknown tool error",
        content: JSON.stringify(event.data),
        valence: "negative",
        tags: ["error", "tool", event.data.toolName],
        context: { toolName: event.data.toolName, error: event.data.error },
      });
    });

    bus.on(Topics.DEPLOYMENT_COMPLETE, (event) => {
      this.storeEpisode({
        type: "success",
        title: `Deployment: ${event.data.target}`,
        summary: `Successfully deployed to ${event.data.target}`,
        content: JSON.stringify(event.data),
        valence: "very_positive",
        tags: ["deployment", "success", event.data.target],
        context: { target: event.data.target, stages: event.data.stages },
      });
    });

    bus.on(Topics.DEPLOYMENT_FAIL, (event) => {
      this.storeEpisode({
        type: "failure",
        title: `Deployment Failed: ${event.data.target}`,
        summary: event.data.error?.slice(0, 200) || "Deployment failed",
        content: JSON.stringify(event.data),
        valence: "very_negative",
        tags: ["deployment", "failure", event.data.target],
        context: { target: event.data.target, error: event.data.error },
      });
    });
  }

  async storeEpisode(episode: Omit<Episode, "id" | "createdAt" | "lastAccessed" | "accessCount" | "compressed" | "importance">): Promise<string> {
    const id = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const newEpisode: Episode = {
      ...episode,
      id,
      confidence: episode.confidence ?? 0.8,
      relatedEpisodeIds: episode.relatedEpisodeIds ?? [],
      importance: this.calculateImportance(episode),
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      compressed: false,
    };

    this.episodes.set(id, newEpisode);
    this.dirty = true;
    this.saveEpisodeContent(newEpisode);

    bus.emit(Topics.MEMORY_STORED, {
      type: "episode",
      episodeId: id,
      title: episode.title,
      importance: newEpisode.importance,
    }, { source: "episodic-memory" });

    try {
      const graph = getGraph();
      const nodeId = graph.addNode("episode", episode.title.slice(0, 200), {
        episodeId: id,
        type: episode.type,
        valence: episode.valence,
        importance: newEpisode.importance,
        tags: episode.tags,
      });
      if (episode.relatedEpisodeIds?.length) {
        for (const relId of episode.relatedEpisodeIds) {
          const relEpisode = this.episodes.get(relId);
          if (relEpisode) {
            const relNodeId = graph.addNode("episode", relEpisode.title, { episodeId: relId });
            graph.addEdge(nodeId, relNodeId, "relates_to", { reason: "user_specified" });
          }
        }
      }
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }

    return id;
  }

  getEpisode(id: string): Episode | undefined {
    const ep = this.episodes.get(id);
    if (ep) {
      ep.accessCount++;
      ep.lastAccessed = Date.now();
    }
    return ep;
  }

  searchEpisodes(query: string, options?: {
    types?: EpisodeType[];
    minImportance?: number;
    valenceFilter?: EmotionalValence[];
    limit?: number;
    tags?: string[];
  }): Episode[] {
    const queryLower = query.toLowerCase();
    let results = Array.from(this.episodes.values());

    if (options?.types?.length) results = results.filter(e => options.types!.includes(e.type));
    if (options?.minImportance) results = results.filter(e => e.importance >= options.minImportance!);
    if (options?.valenceFilter?.length) results = results.filter(e => options.valenceFilter!.includes(e.valence));
    if (options?.tags?.length) results = results.filter(e => options.tags!.some(t => e.tags.includes(t)));

    results = results.filter(e =>
      e.title.toLowerCase().includes(queryLower) ||
      e.summary.toLowerCase().includes(queryLower) ||
      e.tags.some(t => t.toLowerCase().includes(queryLower))
    );

    results.sort((a, b) => {
      const aRelevance = this.relevanceScore(a, queryLower);
      const bRelevance = this.relevanceScore(b, queryLower);
      return bRelevance - aRelevance;
    });

    return results.slice(0, options?.limit || 20);
  }

  getRecentEpisodes(k = 10): Episode[] {
    return Array.from(this.episodes.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, k);
  }

  getEpisodesByType(type: EpisodeType, k = 20): Episode[] {
    return Array.from(this.episodes.values())
      .filter(e => e.type === type)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, k);
  }

  getFailurePatterns(): Array<{ pattern: string; count: number; episodes: Episode[] }> {
    const failures = this.getEpisodesByType("failure", 100);
    const patternMap = new Map<string, Episode[]>();

    for (const ep of failures) {
      const key = this.extractFailurePattern(ep);
      const existing = patternMap.get(key) || [];
      existing.push(ep);
      patternMap.set(key, existing);
    }

    return Array.from(patternMap.entries())
      .map(([pattern, episodes]) => ({ pattern, count: episodes.length, episodes }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  getSuccessPatterns(): Array<{ pattern: string; count: number; episodes: Episode[] }> {
    const successes = this.getEpisodesByType("success", 100);
    const patternMap = new Map<string, Episode[]>();

    for (const ep of successes) {
      const key = this.extractSuccessPattern(ep);
      const existing = patternMap.get(key) || [];
      existing.push(ep);
      patternMap.set(key, existing);
    }

    return Array.from(patternMap.entries())
      .map(([pattern, episodes]) => ({ pattern, count: episodes.length, episodes }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  async compressEpisodes(): Promise<number> {
    const compressible = Array.from(this.episodes.values())
      .filter(e => !e.compressed && e.accessCount === 0 && (Date.now() - e.createdAt) > 7 * 86_400_000);

    for (const ep of compressible) {
      ep.summary = this.compressText(ep.summary, 100);
      ep.content = this.compressText(ep.content, 200);
      ep.compressed = true;
    }

    if (compressible.length > 0) {
      this.dirty = true;
      await this.persistIndex();
    }

    return compressible.length;
  }

  async dreamConsolidation(): Promise<void> {
    const patterns = this.getFailurePatterns();
    const successPatterns = this.getSuccessPatterns();

    for (const pattern of patterns) {
      if (pattern.count >= 3) {
        await this.storeEpisode({
          type: "learning",
          title: `Learned Pattern: ${pattern.pattern}`,
          summary: `Identified recurring failure pattern (${pattern.count} occurrences): ${pattern.pattern}`,
          content: JSON.stringify(pattern),
          valence: "negative",
          tags: ["learned-pattern", "failure", "consolidation"],
          context: { pattern: pattern.pattern, occurrences: pattern.count },
          relatedEpisodeIds: pattern.episodes.map(e => e.id),
        });
      }
    }

    for (const pattern of successPatterns) {
      if (pattern.count >= 2) {
        await this.storeEpisode({
          type: "learning",
          title: `Learned Pattern: ${pattern.pattern}`,
          summary: `Identified recurring success pattern (${pattern.count} occurrences): ${pattern.pattern}`,
          content: JSON.stringify(pattern),
          valence: "positive",
          tags: ["learned-pattern", "success", "consolidation"],
          context: { pattern: pattern.pattern, occurrences: pattern.count },
          relatedEpisodeIds: pattern.episodes.map(e => e.id),
        });
      }
    }
  }

  getStats(): { total: number; byType: Record<string, number>; byValence: Record<string, number>; avgImportance: number } {
    const byType: Record<string, number> = {};
    const byValence: Record<string, number> = {};
    let totalImp = 0;

    for (const ep of this.episodes.values()) {
      byType[ep.type] = (byType[ep.type] || 0) + 1;
      byValence[ep.valence] = (byValence[ep.valence] || 0) + 1;
      totalImp += ep.importance;
    }

    return {
      total: this.episodes.size,
      byType,
      byValence,
      avgImportance: this.episodes.size > 0 ? +(totalImp / this.episodes.size).toFixed(1) : 0,
    };
  }

  private relevanceScore(episode: Episode, query: string): number {
    let score = 0;
    if (episode.title.toLowerCase().includes(query)) score += 5;
    if (episode.summary.toLowerCase().includes(query)) score += 3;
    const tagMatch = episode.tags.filter(t => t.toLowerCase().includes(query)).length;
    score += tagMatch * 2;

    const recencyFactor = Math.max(0, 1 - (Date.now() - episode.createdAt) / (365 * 86_400_000));
    score += recencyFactor * 2;

    const importanceFactor = episode.importance / 10;
    score += importanceFactor;

    return score;
  }

  private calculateImportance(episode: Omit<Episode, "id" | "createdAt" | "lastAccessed" | "accessCount" | "compressed" | "importance">): number {
    let importance = 5;

    if (episode.valence === "very_positive" || episode.valence === "very_negative") importance += 2;
    if (episode.type === "failure") importance += 1;
    if (episode.type === "success") importance += 1;
    if (episode.type === "learning") importance += 0.5;

    const contentSize = episode.content.length + episode.summary.length + episode.title.length;
    if (contentSize > 500) importance += 0.5;

    return Math.min(10, Math.max(1, Math.round(importance)));
  }

  private extractFailurePattern(episode: Episode): string {
    const ctx = episode.context;
    if (ctx.toolName) return `tool_error:${ctx.toolName}`;
    if (ctx.target && ctx.error) return `deploy_fail:${ctx.target}`;
    if (ctx.error) return ctx.error.slice(0, 100);
    return episode.summary.slice(0, 100);
  }

  private extractSuccessPattern(episode: Episode): string {
    const ctx = episode.context;
    if (ctx.target) return `deploy_success:${ctx.target}`;
    return episode.summary.slice(0, 100);
  }

  private compressText(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
  }

  private saveEpisodeContent(episode: Episode): void {
    try {
      const filePath = path.join(this.episodesDir, `${episode.id}.json`);
      const tmp = filePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(episode, null, 2));
      fs.renameSync(tmp, filePath);
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
  }

  private loadIndex(): void {
    try {
      if (!fs.existsSync(this.indexFile)) return;
      const data = JSON.parse(fs.readFileSync(this.indexFile, "utf8"));
      if (data.episodes) {
        for (const ep of data.episodes) {
          this.episodes.set(ep.id, ep);
        }
      }
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
  }

  private async persistIndex(): Promise<void> {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.indexFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = { episodes: Array.from(this.episodes.values()) };
      const tmp = this.indexFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, this.indexFile);
      this.dirty = false;
    } catch (e: any) { logger.warn(`empty catch: ${e?.message || e}`) }
  }

  destroy(): void {
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.persistIndex();
  }
}

export const episodicMemory = new EpisodicMemory();
