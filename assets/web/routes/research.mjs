import { searchWebRaw } from "../services/web-search.mjs";

export default function registerResearch(app, { sendError, getLLMCompletion }) {
  app.post("/api/research", { schema: { body: { type: "object", additionalProperties: true, properties: { query: { type: "string" }, depth: { type: "string" } } }, response: { 200: { type: "object", properties: { summary: { type: "string" }, findings: { type: "array" }, sources: { type: "array" }, depth: { type: "string" }, error: { type: "string" } } } } } }, async (req) => {
    const { query, depth } = req.body || {};
    if (!query) return { error: "query required" };
    const depths = { quick: 2, moderate: 4, deep: 8 };
    const maxResults = depths[depth] || 4;
    try {
      const results = await searchWebRaw(query, maxResults);
      let summary = "";
      if (results.length > 0) {
        try {
          const findingsText = results.map((r, i) => `[Source ${i + 1}]: Title: ${r.title}\nSnippet: ${r.snippet}`).join("\n\n");
          const systemPrompt = "You are a professional research summarizer. Synthesize the provided search snippets into a concise and informative executive summary. Cite sources in format [Source X] where appropriate.";
          const userPrompt = `Research query: "${query}"\n\nSearch snippets:\n${findingsText}`;
          summary = await getLLMCompletion(systemPrompt, userPrompt);
        } catch (e) {
          console.error("LLM summary generation failed:", e);
        }
      }
      if (!summary) {
        summary = results.slice(0, 3).map(r => r.snippet || r.title).join("\n\n") || `Research on "${query}" completed — 0 sources analyzed.`;
      }
      return {
        summary,
        findings: results.map((r, i) => ({
          title: r.title,
          content: r.snippet ? `${r.snippet}\n\nLink: ${r.url}` : `Link: ${r.url}`
        })),
        sources: results.map(r => r.url),
        depth,
      };
    } catch (e) { return { error: e.message }; }
  });
}
