import path from "node:path";
import { streamSimple } from "@earendil-works/pi-ai";
import { resolveModel, getModelAuth, loadSettings } from "../services/settings.mjs";
import { trackCost } from "../services/cost-tracker.mjs";

export default function registerChatVoice(app, { sendError, getActiveTools, executeTool, broadcast, loadSystemPrompt }) {
  const TTS_SERVER = process.env.TTS_SERVER || "http://127.0.0.1:8000";
  const voiceMessages = [];
  const MAX_VOICE_HISTORY = 50;

  app.post("/api/chat/completions", {
    schema: {
      body: { type: "object", required: ["messages"], properties: { model: { type: "string" }, messages: { type: "array", items: { type: "object" } }, stream: { type: "boolean" }, max_tokens: { type: "number" } } },
      response: { 200: { type: "object", properties: { choices: { type: "array", items: { type: "object" } }, usage: { type: "object" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { model: reqModel, messages, stream, max_tokens } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { error: "messages array is required" };
    }
    const model = resolveModel();
    const baseUrl = model.baseUrl || "http://127.0.0.1:1234/v1";
    const { apiKey } = getModelAuth(model);
    const body = {
      model: reqModel || model.id,
      messages,
      stream: !!stream,
      max_tokens: max_tokens || 1024,
    };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600000);
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        return { error: `Upstream error ${r.status}: ${errText.slice(0, 200)}` };
      }
      const data = await r.json();
      if (data.choices?.[0]?.message) {
        const msg = data.choices[0].message;
        if (!msg.content && msg.reasoning_content) {
          msg.content = msg.reasoning_content;
        }
      }
      return data;
    } catch (e) {
      const tried = `${baseUrl}/chat/completions`;
      if (e.name === "AbortError") {
        return { error: `LLM at ${tried} timed out after 600s (10 min). The local model is slow for long documents. Try a narrower topic or check LM Studio GPU settings.` };
      }
      if (e.code === "ECONNREFUSED" || e.message?.includes("refused")) {
        return { error: `Cannot connect to ${tried} — connection refused. Start your LLM server (LM Studio / Ollama).` };
      }
      return { error: `LLM request to ${tried} failed: ${e.message || e}` };
    }
  });

  app.post("/api/voice/chat", {
    schema: {
      body: { type: "object", additionalProperties: true, properties: { text: { type: "string" }, voice: { type: "string" } } },
      response: { 200: { type: "object", properties: { reply: { type: "string" }, audio: { type: "string" }, sampleRate: { type: "number" }, ttsError: { type: "string" }, error: { type: "string" } } } },
    },
  }, async (req, reply) => {
    const { text, voice } = req.body || {};
    if (!text) return reply.code(400).send({ error: "text is required" });
    const voiceId = voice || "af_bella";

    const model = resolveModel();
    let systemPrompt = loadSystemPrompt();
    systemPrompt += `\n\nCRITICAL INSTRUCTION FOR VOICE MODE: You are currently operating in VOICE INTERFACE mode. The user is speaking to you, and your responses are being read aloud by a Text-To-Speech engine. Therefore, you MUST follow these strict rules:
1. NO MARKDOWN: Do not use bold (**), italics (*), code blocks (\`\`\`), or list formatting (-). Speak in plain text.
2. NO EMOJIS OR SYMBOLS: Emojis and special symbols cannot be pronounced properly.
3. NO NARRATIVE ACTIONS: Do not include parenthetical actions or tones like "(Narrative Tone: Confident)" or "(smiles)".
4. CONCISE & CONVERSATIONAL: Keep your responses highly conversational, natural, and relatively short. Do NOT generate long, multi-paragraph essays or huge code blocks. Provide brief summaries and offer to elaborate if needed.`;
    const tools = getActiveTools();
    const auth = getModelAuth(model);
    const settings = loadSettings();

    voiceMessages.push({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
    while (voiceMessages.length > MAX_VOICE_HISTORY) voiceMessages.shift();

    let toolCallIndex = 0;
    let accumulatedText = "";
    const MAX_TURNS = 10;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let stream, currentText = "";
      try {
        stream = streamSimple(model, {
          systemPrompt,
          messages: voiceMessages,
          tools,
        }, {
          apiKey: auth.apiKey,
          headers: auth.headers,
          reasoning: "off",
          maxTokens: model.maxTokens || 8192,
          signal: AbortSignal.timeout(120000),
        });
      } catch (e) {
        voiceMessages.pop();
        return { reply: text, error: `Model error: ${e.message}. Check that your local AI server (LM Studio/Ollama) is running.` };
      }

      try {
        for await (const event of stream) {
          if (event.type === "text_delta") currentText += event.delta;
        }
      } catch (e) {
        if (e.name === "AbortError") return { reply: currentText || text, error: "Request timed out after 120 seconds." };
        return { reply: text, error: `Stream error: ${e.message}` };
      }

      let finalMessage;
      try { finalMessage = await stream.result(); } catch (e) {
        return { reply: text, error: `Result error: ${e.message}` };
      }

      try {
        const usage = finalMessage.usage;
        trackCost("voice-session", "voice-agent", model.provider, model.id,
          usage?.inputTokens || 0, usage?.outputTokens || 0);
      } catch {} // Ignored

      voiceMessages.push(finalMessage);
      if (currentText.trim()) {
        accumulatedText += (accumulatedText ? " " : "") + currentText.trim();
      }

      const toolCalls = finalMessage.content.filter(c => c.type === "toolCall" || c.type === "toolUse");
      if (toolCalls.length === 0) break;

      for (const tc of toolCalls) {
        const args = tc.arguments || tc.input || {};
        const id = tc.id || `tc_${Date.now()}_${toolCallIndex++}`;
        let resultText;
        try { resultText = await executeTool(tc.name, args, process.cwd()); }
        catch (e) { resultText = `Error: ${e.message}`; }
        voiceMessages.push({
          role: "toolResult", toolCallId: id, toolName: tc.name,
          content: [{ type: "text", text: resultText }],
          isError: resultText.startsWith("Error:"),
          timestamp: Date.now(),
        });
      }
    }

    try {
      const cleanTextForTTS = accumulatedText
        .replace(/\*/g, "").replace(/_/g, "").replace(/#/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "")
        .replace(/\([^)]+\)/g, "").replace(/\s+/g, " ").trim();

      const ttsStart = Date.now();
      const ttsR = await fetch(`${TTS_SERVER}/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanTextForTTS, voice: voiceId }),
        signal: AbortSignal.timeout(60000),
      });
      if (ttsR.ok) {
        const ttsData = await ttsR.json();
        return { reply: accumulatedText, audio: ttsData.audio, sampleRate: ttsData.sampleRate };
      }
      const ttsErr = await ttsR.text().catch(() => `HTTP ${ttsR.status}`);
      return { reply: accumulatedText, ttsError: `TTS server error (${ttsR.status})` };
    } catch (e2) {
      if (e2.message?.includes("connect") || e2.message?.includes("ECONNREFUSED")) {
        return { reply: accumulatedText, ttsError: "TTS server not running on port 8000." };
      }
      return { reply: accumulatedText, ttsError: `TTS failed: ${e2.message}` };
    }
  });

  app.get("/api/voice/chat-stream", { websocket: true }, (socket, req) => {
    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) { try { socket.close(); } catch {} /* cleanup */ return; }
      alive = false;
      try { socket.ping(); } catch {} /* cleanup */
    }, 30000);

    socket.on("pong", () => { alive = true; });
    socket.on("close", () => { clearInterval(pingTimer); });
    socket.on("error", () => { clearInterval(pingTimer); });

    socket.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); }
      catch (e) { try { socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" })); } catch {} /* Ignored */ return; }

      if (msg.type === "ping") { try { socket.send(JSON.stringify({ type: "pong" })); } catch {} /* Ignored */ return; }

      if (msg.type === "text") {
        const { text, voice } = msg;
        if (!text) { try { socket.send(JSON.stringify({ type: "error", message: "text is required" })); } catch {} /* Ignored */ return; }
        const voiceId = voice || "af_bella";

        const model = resolveModel();
        let systemPrompt = loadSystemPrompt();
        systemPrompt += `\n\nCRITICAL INSTRUCTION FOR VOICE MODE: You are currently operating in VOICE INTERFACE mode. The user is speaking to you, and your responses are being read aloud by a Text-To-Speech engine. Therefore, you MUST follow these strict rules:
1. NO MARKDOWN: Do not use bold (**), italics (*), code blocks (\`\`\`), or list formatting (-). Speak in plain text.
2. NO EMOJIS OR SYMBOLS: Emojis and special symbols cannot be pronounced properly.
3. NO NARRATIVE ACTIONS: Do not include parenthetical actions or tones like "(Narrative Tone: Confident)" or "(smiles)".
4. CONCISE & CONVERSATIONAL: Keep your responses highly conversational, natural, and relatively short. Do NOT generate long, multi-paragraph essays or huge code blocks. Provide brief summaries and offer to elaborate if needed.`;
        const tools = getActiveTools();
        const auth = getModelAuth(model);

        voiceMessages.push({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
        while (voiceMessages.length > MAX_VOICE_HISTORY) voiceMessages.shift();

        let toolCallIndex = 0;
        let accumulatedText = "";
        const MAX_TURNS = 10;

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          let stream, currentText = "";
          try {
            stream = streamSimple(model, {
              systemPrompt, messages: voiceMessages, tools,
            }, {
              apiKey: auth.apiKey, headers: auth.headers,
              reasoning: "off", maxTokens: model.maxTokens || 8192,
              signal: AbortSignal.timeout(120000),
            });
          } catch (e) {
            voiceMessages.pop();
            try { socket.send(JSON.stringify({ type: "error", message: `Model error: ${e.message}` })); } catch {} /* Ignored */
            return;
          }

          try {
            for await (const event of stream) {
              if (event.type === "text_delta") currentText += event.delta;
            }
          } catch (e) {
            if (e.name === "AbortError") {
              try { socket.send(JSON.stringify({ type: "text", text: currentText, done: true })); } catch {} /* Ignored */
            }
            return;
          }

          let finalMessage;
          try { finalMessage = await stream.result(); } catch (e) { return; }

          try {
            const usage = finalMessage.usage;
            trackCost("voice-session", "voice-agent", model.provider, model.id,
              usage?.inputTokens || 0, usage?.outputTokens || 0);
          } catch {} // Ignored

          voiceMessages.push(finalMessage);
          if (currentText.trim()) accumulatedText += (accumulatedText ? " " : "") + currentText.trim();

          const toolCalls = finalMessage.content.filter(c => c.type === "toolCall" || c.type === "toolUse");
          if (toolCalls.length === 0) break;

          for (const tc of toolCalls) {
            const args = tc.arguments || tc.input || {};
            const id = tc.id || `tc_${Date.now()}_${toolCallIndex++}`;
            let resultText;
            try { resultText = await executeTool(tc.name, args, process.cwd()); }
            catch (e) { resultText = `Error: ${e.message}`; }
            voiceMessages.push({
              role: "toolResult", toolCallId: id, toolName: tc.name,
              content: [{ type: "text", text: resultText }],
              isError: resultText.startsWith("Error:"),
              timestamp: Date.now(),
            });
          }
        }

        try { socket.send(JSON.stringify({ type: "text", text: accumulatedText, done: true })); } catch {} /* Ignored */
      }
    });
  });
}
