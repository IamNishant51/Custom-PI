import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSentience } from "../perception/web-sentience";

describe("WebSentience", () => {
  let ws: WebSentience;

  beforeEach(() => {
    ws = new WebSentience();
  });

  describe("feed subscription and checking", () => {
    it("subscribes to a feed and checks for new entries", async () => {
      const feedId = ws.subscribeFeed("https://example.com/rss");
      expect(feedId).toContain("feed_");

      const feeds = ws.getFeeds();
      expect(feeds).toHaveLength(1);
      expect(feeds[0].url).toBe("https://example.com/rss");

      const entries = await ws.checkFeed(feedId);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]).toHaveProperty("id");
      expect(entries[0]).toHaveProperty("title");
      expect(entries[0]).toHaveProperty("url");
      expect(entries[0]).toHaveProperty("published");

      // Second check returns empty (no new entries)
      const secondCheck = await ws.checkFeed(feedId);
      expect(secondCheck).toHaveLength(0);

      ws.unsubscribeFeed(feedId);
      expect(ws.getFeeds()).toHaveLength(0);
    });

    it("getFeedEntries returns stored entries", async () => {
      const feedId = ws.subscribeFeed("https://blog.example.com/feed");
      await ws.checkFeed(feedId);
      const entries = ws.getFeedEntries(feedId);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("URL change detection", () => {
    it("monitors a url and detects changes", async () => {
      vi.useFakeTimers();
      const monId = ws.monitorUrl("https://example.com/page");
      expect(monId).toContain("urlmon_");

      const urls = ws.getMonitoredUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].url).toBe("https://example.com/page");

      // First check sets the baseline hash
      const firstCheck = await ws.checkUrlChange(monId);
      expect(firstCheck).toBeNull();

      // Second check also null when time hasn't advanced
      const secondCheck = await ws.checkUrlChange(monId);
      expect(secondCheck).toBeNull();

      // Advance time to simulate content change
      vi.advanceTimersByTime(1000);
      const thirdCheck = await ws.checkUrlChange(monId);
      expect(thirdCheck).not.toBeNull();
      expect(thirdCheck).toHaveProperty("previousHash");
      expect(thirdCheck).toHaveProperty("newHash");

      ws.unmonitorUrl(monId);
      expect(ws.getMonitoredUrls()).toHaveLength(0);
      vi.useRealTimers();
    });

    it("returns change history", async () => {
      const monId = ws.monitorUrl("https://example.com/history");
      await ws.checkUrlChange(monId);
      const history = ws.getUrlChangeHistory(monId);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe("alert correlation", () => {
    it("returns empty correlated alerts when no topics watched", () => {
      const alerts = ws.correlateAlerts();
      expect(Array.isArray(alerts)).toBe(true);
      expect(alerts).toHaveLength(0);
    });

    it("detects CVE patterns in watched topic results", async () => {
      const topicId = ws.startWatching("test-package", 100000, "npm");

      // Manually inject a result with CVE pattern
      const topic = ws.getAllWatchTopics().find(t => t.id === topicId)!;
      topic.results.push({
        title: "test-package v1.2.3",
        url: "https://npmjs.com/package/test-package",
        snippet: "Fixes CVE-2024-1234 and other security issues",
        source: "npm",
        timestamp: Date.now(),
        relevanceScore: 0.9,
      });

      const alerts = ws.correlateAlerts();
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].type).toBe("cve");
      expect(alerts[0].severity).toBe("high");
      expect(alerts[0].memoryKey).toContain("cve:");

      // Correlating again should not duplicate
      const alerts2 = ws.correlateAlerts();
      const cveAlerts = alerts2.filter(a => a.type === "cve");
      expect(cveAlerts.length).toBe(0);
    });

    it("detects dependency vulnerability keywords", async () => {
      const topicId = ws.startWatching("express", 100000, "github");

      const topic = ws.getAllWatchTopics().find(t => t.id === topicId)!;
      topic.results.push({
        title: "express",
        url: "https://github.com/expressjs/express",
        snippet: "New security vulnerability found in parser",
        source: "github",
        timestamp: Date.now(),
        relevanceScore: 0.8,
      });

      const alerts = ws.correlateAlerts();
      const depAlerts = alerts.filter(a => a.type === "dependency");
      expect(depAlerts.length).toBeGreaterThanOrEqual(1);
      expect(depAlerts[0].description).toContain("security");
    });
  });

  describe("trend analysis", () => {
    it("returns trend analysis with default values when no history", () => {
      const analysis = ws.analyzeTrends();
      expect(analysis).toHaveProperty("topQueries");
      expect(analysis).toHaveProperty("patterns");
      expect(analysis).toHaveProperty("requestRate");
      expect(analysis).toHaveProperty("totalRequests");
      expect(analysis).toHaveProperty("timeWindow");
      expect(analysis.totalRequests).toBe(0);
      expect(analysis.topQueries).toHaveLength(0);
    });

    it("reflects tracked queries", () => {
      ws.trackQuery("react hooks");
      ws.trackQuery("react hooks");
      ws.trackQuery("react hooks");

      const analysis = ws.analyzeTrends();
      expect(analysis.totalRequests).toBe(0); // fetchHistory empty
      expect(analysis.topQueries.length).toBeGreaterThanOrEqual(1);
      expect(analysis.topQueries[0].query).toBe("react hooks");
      expect(analysis.topQueries[0].count).toBe(3);

      // Should detect pattern for queries asked 3+ times
      expect(analysis.patterns.length).toBeGreaterThanOrEqual(1);
      expect(analysis.patterns[0].frequency).toBe(3);
    });
  });

  describe("research aggregation", () => {
    it("aggregates research results from multiple sources", async () => {
      const result = await ws.research("typescript testing", "quick");

      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("sources");
      expect(result).toHaveProperty("trends");
      expect(result).toHaveProperty("relatedTopics");

      expect(result.summary).toContain("typescript testing");
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.sources[0]).toHaveProperty("title");
      expect(result.sources[0]).toHaveProperty("url");
      expect(result.sources[0]).toHaveProperty("relevanceScore");
    });

    it("deep research returns more sources", async () => {
      const quick = await ws.research("testing", "quick");
      const deep = await ws.research("testing", "deep");

      expect(deep.sources.length).toBeGreaterThanOrEqual(quick.sources.length);
    });

    it("includes trend information when trends exist", async () => {
      // Create a trend first
      const topicId = ws.startWatching("machine learning", 100000);
      const topic = ws.getAllWatchTopics().find(t => t.id === topicId)!;
      topic.results.push({
        title: "ML results",
        url: "https://example.com/ml",
        snippet: "Machine learning advances",
        source: "web",
        timestamp: Date.now(),
        relevanceScore: 0.9,
      });

      const research = await ws.research("machine learning", "quick");
      expect(research.summary).toContain("machine learning");
      expect(Array.isArray(research.trends)).toBe(true);
    });
  });
});
