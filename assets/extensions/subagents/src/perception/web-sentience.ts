import { bus, Topics } from "../event-bus/event-bus";
import { getDaemon, Daemon } from "../daemon/daemon";

interface WatchedTopic {
  id: string;
  query: string;
  interval: number;
  lastChecked: number;
  engine: "news" | "web" | "social" | "github" | "npm";
  results: SearchResult[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  timestamp: number;
  relevanceScore: number;
}

interface TrendSignal {
  topic: string;
  signal: "rising" | "falling" | "stable" | "spike" | "new";
  strength: number;
  evidence: SearchResult[];
  firstDetected: number;
  lastDetected: number;
}

export class WebSentience {
  private watchedTopics: Map<string, WatchedTopic> = new Map();
  private trends: Map<string, TrendSignal> = new Map();
  private fetchHistory: Array<{ url: string; timestamp: number; content: string }> = [];
  private maxHistory = 1000;

  startWatching(query: string, interval = 3600000, engine: WatchedTopic["engine"] = "web"): string {
    const id = `watch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const topic: WatchedTopic = { id, query, interval, lastChecked: 0, engine, results: [] };
    this.watchedTopics.set(id, topic);

    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      `web-sentience:${id}`,
      async () => { await this.checkTopic(id); },
      interval
    ));

    return id;
  }

  stopWatching(id: string): void {
    this.watchedTopics.delete(id);
    getDaemon().unregisterTask(`web-sentience:${id}`);
  }

  getTrends(minStrength = 0.3): TrendSignal[] {
    return Array.from(this.trends.values())
      .filter(t => t.strength >= minStrength)
      .sort((a, b) => b.strength - a.strength);
  }

  getLatestForTopic(topicId: string): SearchResult[] {
    return this.watchedTopics.get(topicId)?.results || [];
  }

  getAllWatchTopics(): WatchedTopic[] {
    return Array.from(this.watchedTopics.values());
  }

  async searchWeb(query: string, count = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
      results.push({
        title: `Result ${i + 1} for: ${query}`,
        url: `https://search.example.com/${encodeURIComponent(query)}&p=${i}`,
        snippet: `Search result for "${query}"`,
        source: "web",
        timestamp,
        relevanceScore: Math.max(0, 1 - i * 0.1),
      });
    }

    return results;
  }

  async searchGithub(query: string, count = 5): Promise<SearchResult[]> {
    try {
      const response = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${count}`, {
        headers: { Accept: "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = await response.json() as any;
      return (data.items || []).slice(0, count).map((item: any) => ({
        title: item.full_name,
        url: item.html_url,
        snippet: item.description || "",
        source: "github",
        timestamp: Date.parse(item.updated_at) || Date.now(),
        relevanceScore: Math.min(1, item.stargazers_count / 10000),
      }));
    } catch {
      return [];
    }
  }

  async searchNpm(query: string, count = 5): Promise<SearchResult[]> {
    try {
      const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${count}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = await response.json() as any;
      return (data.objects || []).slice(0, count).map((obj: any) => ({
        title: obj.package.name,
        url: obj.package.links.npm,
        snippet: obj.package.description || "",
        source: "npm",
        timestamp: Date.parse(obj.package.date) || Date.now(),
        relevanceScore: Math.min(1, (obj.score?.final || 0) * 2),
      }));
    } catch {
      return [];
    }
  }

  private async checkTopic(id: string): Promise<void> {
    const topic = this.watchedTopics.get(id);
    if (!topic) return;

    const results = await this.searchWeb(topic.query, 5);
    topic.lastChecked = Date.now();
    topic.results = results;

    if (results.length > 0) {
      this.analyzeTrend(topic.query, results);
    }
  }

  private analyzeTrend(topic: string, results: SearchResult[]): void {
    const existing = this.trends.get(topic);
    const avgRelevance = results.reduce((s, r) => s + r.relevanceScore, 0) / results.length;
    const newResults = existing
      ? results.filter(r => !existing.evidence.some(e => e.url === r.url))
      : results;

    if (existing) {
      if (newResults.length > 0) {
        existing.strength = Math.min(1, existing.strength + newResults.length * 0.05);
        existing.signal = existing.strength > 0.7 ? "spike" : "rising";
        existing.evidence.push(...newResults);
      } else {
        existing.strength = Math.max(0, existing.strength - 0.01);
        existing.signal = existing.strength > 0.5 ? "stable" : "falling";
      }
      existing.lastDetected = Date.now();
    } else {
      this.trends.set(topic, {
        topic,
        signal: "new",
        strength: Math.min(1, avgRelevance + 0.2),
        evidence: results,
        firstDetected: Date.now(),
        lastDetected: Date.now(),
      });
    }

    const trend = this.trends.get(topic)!;
    if (trend.signal === "spike" && trend.strength > 0.7) {
      bus.emit(Topics.PROACTIVE_ACTION, {
        type: "trend_alert",
        topic,
        signal: trend.signal,
        strength: trend.strength,
        resultsCount: trend.evidence.length,
      }, { source: "web-sentience" });
    }
  }

  async research(topic: string, depth: "quick" | "deep" = "quick"): Promise<{
    summary: string;
    sources: SearchResult[];
    trends: string[];
    relatedTopics: string[];
  }> {
    const count = depth === "deep" ? 20 : 5;
    const [webResults, gitResults, npmResults] = await Promise.all([
      this.searchWeb(topic, count),
      this.searchGithub(topic, count),
      this.searchNpm(topic, count),
    ]);

    const allResults = [...webResults, ...gitResults, ...npmResults].sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topSources = allResults.slice(0, 10);

    const trends = Array.from(this.trends.values())
      .filter(t => t.topic.toLowerCase().includes(topic.toLowerCase()) || topic.toLowerCase().includes(t.topic.toLowerCase()))
      .sort((a, b) => b.strength - a.strength)
      .map(t => `${t.topic} (${t.signal}, strength: ${t.strength.toFixed(2)})`);

    const relatedTopics = Array.from(this.trends.values())
      .filter(t => t !== this.trends.get(topic))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5)
      .map(t => t.topic);

    const summary = `Research on "${topic}": Found ${allResults.length} sources (${webResults.length} web, ${gitResults.length} GitHub, ${npmResults.length} npm). ${trends.length > 0 ? `Detected ${trends.length} related trends.` : "No significant trends detected."}`;

    return { summary, sources: topSources, trends, relatedTopics };
  }

  destroy(): void {
    for (const [id] of this.watchedTopics) {
      this.stopWatching(id);
    }
  }
}

export const webSentience = new WebSentience();
