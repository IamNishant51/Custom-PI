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

interface FeedState {
  url: string;
  lastChecked: number;
  lastEntryIds: string[];
  entries: FeedEntry[];
}

interface FeedEntry {
  id: string;
  title: string;
  url: string;
  content: string;
  published: number;
}

interface MonitoredUrlState {
  url: string;
  lastHash: string;
  lastChecked: number;
  content: string;
  changes: UrlChangeRecord[];
}

interface UrlChangeRecord {
  previousHash: string;
  newHash: string;
  detected: number;
}

interface CorrelatedAlert {
  id: string;
  type: "cve" | "dependency" | "trend_spike";
  severity: "low" | "medium" | "high" | "critical";
  source: string;
  description: string;
  relatedResults: SearchResult[];
  detected: number;
  memoryKey?: string;
}

interface TrendAnalysis {
  topQueries: Array<{ query: string; count: number }>;
  patterns: Array<{ pattern: string; frequency: number; example: string }>;
  requestRate: number;
  totalRequests: number;
  timeWindow: number;
}

export class WebSentience {
  private watchedTopics: Map<string, WatchedTopic> = new Map();
  private trends: Map<string, TrendSignal> = new Map();
  private fetchHistory: Array<{ url: string; timestamp: number; content: string }> = [];
  private maxHistory = 1000;
  private feeds: Map<string, FeedState> = new Map();
  private monitoredUrls: Map<string, MonitoredUrlState> = new Map();
  private alerts: CorrelatedAlert[] = [];
  private queryHistory: string[] = [];

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
    this.trackQuery(topic.query);

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

  subscribeFeed(url: string): string {
    const id = `feed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const state: FeedState = { url, lastChecked: 0, lastEntryIds: [], entries: [] };
    this.feeds.set(id, state);

    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      `web-sentience:feed:${id}`,
      async () => { await this.checkFeed(id); },
      600000
    ));

    return id;
  }

  unsubscribeFeed(id: string): void {
    this.feeds.delete(id);
    getDaemon().unregisterTask(`web-sentience:feed:${id}`);
  }

  async checkFeed(id: string): Promise<FeedEntry[]> {
    const state = this.feeds.get(id);
    if (!state) return [];

    const newEntries: FeedEntry[] = [];
    const timestamp = Date.now();

    // Simplified feed parsing — simulate fetching RSS/Atom entries
    const mockFeed: FeedEntry[] = [
      { id: `${id}_1`, title: `Feed entry 1 from ${state.url}`, url: state.url + "/1", content: "Mock RSS entry 1", published: timestamp - 60000 },
      { id: `${id}_2`, title: `Feed entry 2 from ${state.url}`, url: state.url + "/2", content: "Mock RSS entry 2", published: timestamp - 120000 },
    ];

    for (const entry of mockFeed) {
      if (!state.lastEntryIds.includes(entry.id)) {
        newEntries.push(entry);
        state.lastEntryIds.push(entry.id);
        state.entries.push(entry);
      }
    }

    state.lastChecked = timestamp;

    if (newEntries.length > 0) {
      bus.emit(Topics.PROACTIVE_ACTION, {
        type: "feed_update",
        feedUrl: state.url,
        newEntries: newEntries.length,
      }, { source: "web-sentience" });
    }

    // Store in fetch history
    newEntries.forEach(e => {
      this.fetchHistory.push({ url: e.url, timestamp: e.published, content: e.content });
    });
    this.trimHistory();

    return newEntries;
  }

  getFeeds(): FeedState[] {
    return Array.from(this.feeds.values());
  }

  getFeedEntries(feedId: string): FeedEntry[] {
    return this.feeds.get(feedId)?.entries || [];
  }

  monitorUrl(url: string): string {
    const id = `urlmon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const state: MonitoredUrlState = { url, lastHash: "", lastChecked: 0, content: "", changes: [] };
    this.monitoredUrls.set(id, state);

    const daemon = getDaemon();
    daemon.registerTask(Daemon.createIntervalTask(
      `web-sentience:urlmon:${id}`,
      async () => { await this.checkUrlChange(id); },
      300000
    ));

    return id;
  }

  unmonitorUrl(id: string): void {
    this.monitoredUrls.delete(id);
    getDaemon().unregisterTask(`web-sentience:urlmon:${id}`);
  }

  async checkUrlChange(id: string): Promise<UrlChangeRecord | null> {
    const state = this.monitoredUrls.get(id);
    if (!state) return null;

    // Simulate fetching content — use URL itself as deterministic content source
    const content = `Content of ${state.url} at ${Date.now()}`;
    const newHash = this.simpleHash(content);

    if (state.lastHash && state.lastHash !== newHash) {
      const record: UrlChangeRecord = {
        previousHash: state.lastHash,
        newHash,
        detected: Date.now(),
      };
      state.changes.push(record);
      state.lastHash = newHash;
      state.content = content;
      state.lastChecked = Date.now();

      bus.emit(Topics.PROACTIVE_ACTION, {
        type: "url_change",
        url: state.url,
        previousHash: record.previousHash,
        newHash,
      }, { source: "web-sentience" });

      return record;
    }

    state.lastHash = state.lastHash || newHash;
    state.content = state.content || content;
    state.lastChecked = Date.now();
    return null;
  }

  getMonitoredUrls(): MonitoredUrlState[] {
    return Array.from(this.monitoredUrls.values());
  }

  getUrlChangeHistory(id: string): UrlChangeRecord[] {
    return this.monitoredUrls.get(id)?.changes || [];
  }

  correlateAlerts(): CorrelatedAlert[] {
    const newAlerts: CorrelatedAlert[] = [];

    // Check watched topics results for CVE-like patterns
    for (const [id, topic] of this.watchedTopics) {
      for (const result of topic.results) {
        const cveMatch = result.snippet.match(/\bCVE-\d{4}-\d{4,7}\b/i);
        if (cveMatch) {
          const existing = this.alerts.find(a => a.source === result.url);
          if (!existing) {
            const alert: CorrelatedAlert = {
              id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              type: "cve",
              severity: "high",
              source: result.url,
              description: `Potential CVE mentioned in topic "${topic.query}": ${cveMatch[0]}`,
              relatedResults: [result],
              detected: Date.now(),
              memoryKey: `cve:${cveMatch[0].toLowerCase()}`,
            };
            newAlerts.push(alert);
            this.alerts.push(alert);
          }
        }
      }
    }

    // Check for trend spikes that correlate with watched topics
    for (const trend of this.trends.values()) {
      if (trend.signal === "spike" && trend.strength > 0.7) {
        const existing = this.alerts.find(a =>
          a.type === "trend_spike" && a.description.includes(trend.topic)
        );
        if (!existing) {
          const alert: CorrelatedAlert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: "trend_spike",
            severity: "medium",
            source: "trend_detection",
            description: `Trend spike detected for "${trend.topic}" (strength: ${trend.strength.toFixed(2)})`,
            relatedResults: trend.evidence.slice(0, 3),
            detected: Date.now(),
            memoryKey: `trend_spike:${trend.topic.toLowerCase().replace(/\s+/g, "_")}`,
          };
          newAlerts.push(alert);
          this.alerts.push(alert);
        }
      }
    }

    // Check dependency names in watched topics for known vulnerability keywords
    for (const topic of this.watchedTopics.values()) {
      if (topic.engine === "npm" || topic.engine === "github") {
        const vulnKeywords = ["vulnerability", "security", "exploit", "malicious", "backdoor"];
        for (const result of topic.results) {
          const matched = vulnKeywords.find(k => result.snippet.toLowerCase().includes(k));
          if (matched) {
            const existing = this.alerts.find(a => a.source === result.url);
            if (!existing) {
              const alert: CorrelatedAlert = {
                id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type: "dependency",
                severity: "medium",
                source: result.url,
                description: `Dependency "${result.title}" has potential security concern (${matched})`,
                relatedResults: [result],
                detected: Date.now(),
              };
              newAlerts.push(alert);
              this.alerts.push(alert);
            }
          }
        }
      }
    }

    return newAlerts;
  }

  getAlerts(): CorrelatedAlert[] {
    return this.alerts;
  }

  analyzeTrends(): TrendAnalysis {
    const now = Date.now();
    const timeWindow = 3600000; // 1 hour
    const recentQueries = this.queryHistory.filter(q => {
      // We don't store timestamps per query, so use a proxy: entries in fetchHistory
      return true;
    });

    // Count query frequencies
    const queryCounts = new Map<string, number>();
    for (const q of recentQueries) {
      queryCounts.set(q, (queryCounts.get(q) || 0) + 1);
    }

    const topQueries = Array.from(queryCounts.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Detect patterns — repeated queries signal "user always asks about X"
    const patterns: Array<{ pattern: string; frequency: number; example: string }> = [];
    for (const [query, count] of queryCounts) {
      if (count >= 3) {
        const words = query.split(/\s+/);
        patterns.push({
          pattern: words.length > 1 ? words.slice(0, 2).join(" ") : query,
          frequency: count,
          example: query,
        });
      }
    }

    // Calculate request rate
    const requestCount = this.fetchHistory.length;
    const requestRate = timeWindow > 0 ? requestCount / (timeWindow / 60000) : 0;

    return {
      topQueries,
      patterns: patterns.sort((a, b) => b.frequency - a.frequency).slice(0, 10),
      requestRate,
      totalRequests: requestCount,
      timeWindow,
    };
  }

  trackQuery(query: string): void {
    this.queryHistory.push(query);
    if (this.queryHistory.length > 1000) {
      this.queryHistory.splice(0, this.queryHistory.length - 1000);
    }
  }

  private simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  private trimHistory(): void {
    if (this.fetchHistory.length > this.maxHistory) {
      this.fetchHistory.splice(0, this.fetchHistory.length - this.maxHistory);
    }
  }

  destroy(): void {
    for (const [id] of this.watchedTopics) {
      this.stopWatching(id);
    }
  }
}

export const webSentience = new WebSentience();
