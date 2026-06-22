export default function registerWebsocket(app, deps) {
  const {
    apiKey, crypto, getOrCreateSession, WS_PING_INTERVAL, MAX_FILE_SIZE,
    withSwarmLock, bcast, getAgentChatBuffer, memorySearch,
    handleSubAgent, handleSwarmGoal, handleDagGoal,
    executeSwarmCampaign, loadDagConfig,
    getCurrentSwarmState, setCurrentSwarmState,
    getSwarmPaused, setSwarmPaused,
    getSwarmPauseResolve, setSwarmPauseResolve,
    swarmSockets, pendingQuestions,
  } = deps;

  // Mutex to prevent concurrent session.handleMessage() calls
  let sessionMutex = Promise.resolve();

  function withSessionMutex(fn) {
    const prev = sessionMutex;
    let release;
    sessionMutex = new Promise(resolve => { release = resolve; });
    return prev.then(() => { try { return fn(); } finally { release(); } });
  }

  function safeSend(socket, obj) {
    try { socket.send(JSON.stringify(obj)); } catch (e) { console.error("WS send error:", e?.message); }
  }

  function cleanUpPendingQuestions() {
    for (const key of Object.keys(pendingQuestions)) {
      const q = pendingQuestions[key];
      if (q && q.reject) { try { q.reject(new Error("Disconnected")); } catch {} /* cleanup */ }
      delete pendingQuestions[key];
    }
  }

  app.get("/ws", { websocket: true }, (socket, req) => {
    if (apiKey) {
      const wsToken = req.query?.token || "";
      if (!wsToken || wsToken.length !== apiKey.length || !crypto.timingSafeEqual(Buffer.from(wsToken), Buffer.from(apiKey))) {
        safeSend(socket, { type: "error", message: "Unauthorized — provide token query parameter" });
        setTimeout(() => socket.close(), 500);
        return;
      }
    }
    console.log("WebSocket connected from", req.ip);

    let session;
    try { session = getOrCreateSession(); }
    catch (e) {
      console.error("WS session init error:", e?.message);
      safeSend(socket, { type: "error", message: "Server init error" });
      setTimeout(() => socket.close(), 500);
      return;
    }

    if (session.messages && session.messages.length > 0) {
      safeSend(socket, { type: "chat_history", messages: session.messages.slice(-100) });
    }

    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        try { socket.close(); } catch {} // cleanup
        return;
      }
      alive = false;
      try { socket.ping(); } catch {} // cleanup
    }, WS_PING_INTERVAL);

    socket.on("pong", () => { alive = true; });

    // Always add to swarmSockets so late swarm events are received
    swarmSockets.add(socket);

    withSwarmLock(async () => {
      const current = getCurrentSwarmState();
      if (current) {
        safeSend(socket, {
          type: "swarm_recovery",
          ...current,
          paused: getSwarmPaused()
        });
      }
    }).catch(() => {});

    socket.on("close", () => {
      clearInterval(pingTimer);
      swarmSockets.delete(socket);
      cleanUpPendingQuestions();
      console.log("WebSocket disconnected from", req.ip);
    });
    socket.on("error", (err) => {
      clearInterval(pingTimer);
      swarmSockets.delete(socket);
      cleanUpPendingQuestions();
      console.error("WebSocket error:", err?.message);
    });

    // Sliding-window rate limiter: max 20 messages/sec per IP
    const msgTimestamps = [];
    socket.on("message", async (raw) => {
      const now = Date.now();
      const windowStart = now - 1000;
      while (msgTimestamps.length > 0 && msgTimestamps[0] < windowStart) msgTimestamps.shift();
      if (msgTimestamps.length >= 20) {
        safeSend(socket, { type: "error", message: "Rate limit exceeded — try again later" });
        return;
      }
      msgTimestamps.push(now);
      let data;
      try { data = JSON.parse(raw.toString()); }
      catch {
        safeSend(socket, { type: "error", message: "Invalid JSON" });
        return;
      }

      try {
        if (data.type === "chat") {
          if (data.attachments) {
            let totalSize = 0;
            for (const att of data.attachments) {
              if (att.data) totalSize += att.data.length;
              if (att.text) totalSize += att.text.length;
            }
            if (Number.isNaN(totalSize)) totalSize = MAX_FILE_SIZE + 1;
            if (totalSize > MAX_FILE_SIZE) {
              safeSend(socket, { type: "error", message: `Attachment total size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please reduce file sizes.` });
              return;
            }
          }
          safeSend(socket, { type: "session_start" });
          await withSessionMutex(async () => {
            await session.handleMessage(data.message, data.cwd || process.cwd(), (event) => {
              safeSend(socket, event);
            }, data.attachments);
          });
          return;
        }

        if (data.type === "interrupt") {
          if (session) {
            session.interrupt();
            safeSend(socket, { type: "interrupted" });
            safeSend(socket, { type: "interrupt_ack" });
          }
          return;
        }

        if (data.type === "swarm_pause") {
          await withSwarmLock(async () => {
            setSwarmPaused(true);
            safeSend(socket, { type: "swarm_paused" });
          });
          return;
        }

        if (data.type === "swarm_resume") {
          await withSwarmLock(async () => {
            setSwarmPaused(false);
            const resolve = getSwarmPauseResolve();
            if (resolve) { try { resolve(); } catch {} /* cleanup */ setSwarmPauseResolve(null); }
            safeSend(socket, { type: "swarm_resumed" });
          });
          return;
        }

        if (data.type === "user_answer") {
          const q = pendingQuestions[data.questionId];
          if (q && q.resolve) {
            q.resolve(data.answer);
            delete pendingQuestions[data.questionId];
          }
          return;
        }

        if (data.type === "agent_chat") {
          const { agentId, message } = data;
          if (agentId && message) {
            getAgentChatBuffer(agentId).push({ role: "user", content: message, timestamp: Date.now() });
            bcast({ type: "agent_chat", agentId, message, fromAgent: false });

            const currentState = getCurrentSwarmState();
            const isSwarmRunning = currentState && currentState.status === "running";
            if (!isSwarmRunning || !currentState?.agents?.find(a => a.id === agentId)) {
              safeSend(socket, { type: "session_start" });
              await withSessionMutex(async () => {
                await session.handleMessage(`[Message for agent '${agentId}']: ${message}`, data.cwd || process.cwd(), (event) => {
                  safeSend(socket, event);
                }, null);
              });
            }
          }
          return;
        }

        if (data.type === "memory_search") {
          const results = memorySearch(data.query, data.k ?? 5);
          safeSend(socket, { type: "memory_results", results });
          return;
        }

        if (data.type === "subagent_delegate") {
          const { agentId, task } = data;
          await handleSubAgent(socket, agentId, task);
          return;
        }

        if (data.type === "swarm_goal") {
          const { goal } = data;
          await handleSwarmGoal(socket, goal);
          return;
        }

        if (data.type === "run_dag") {
          const dagConfig = loadDagConfig();
          if (!dagConfig) {
            safeSend(socket, { type: "swarm_error", message: "DAG config not found at ~/.pi/agent/dag-config.yaml" });
            return;
          }
          await handleDagGoal(socket, data.goal || "DAG Swarm Goal", dagConfig);
          return;
        }

        if (data.type === "swarm_saved_team") {
          const { goal, agents } = data;
          const platformMatch = goal.match(/\[Platforms:\s*(.+?)\]/);
          const selectedPlatformNames = platformMatch ? platformMatch[1].split(/,\s*/).filter(Boolean) : [];
          const selectedPlatformKeys = selectedPlatformNames.map(n => {
            const lower = n.toLowerCase();
            if (lower.includes("twitter") || lower.includes("x")) return "twitter";
            if (lower.includes("reddit")) return "reddit";
            if (lower.includes("bluesky")) return "bluesky";
            if (lower.includes("discord")) return "discord";
            if (lower.includes("telegram")) return "telegram";
            if (lower.includes("linkedin")) return "linkedin";
            return null;
          }).filter(Boolean);

          const platformTaskSuffix = selectedPlatformNames.length > 0
            ? `Target platforms: ${selectedPlatformNames.join(", ")}. Only write drafts for these platforms — do NOT write for any others.`
            : "";

          const platformToolMap = {
            twitter: "post_to_twitter", reddit: "post_to_reddit",
            bluesky: "post_to_bluesky", discord: "post_to_discord",
            telegram: "post_to_telegram",
          };
          const allPostTools = new Set(Object.values(platformToolMap));
          const allowedPostTools = new Set(selectedPlatformKeys.map(k => platformToolMap[k]).filter(Boolean));

          const normalized = (agents || []).map(a => {
            if (typeof a === "string") {
              return { id: a, role: "sub-agent", task: `${platformTaskSuffix} Contribute to: ${goal}`, tools: ["bash", "glob", "grep", "view_file", "write", "edit", "list_dir", "web_search", "web_fetch"] };
            }
            const modified = { ...a };
            if (platformTaskSuffix) {
              if (modified.id === "writer" || modified.id === "publisher") {
                modified.task = `${platformTaskSuffix} ${modified.task}`;
              }
              if (modified.id === "publisher" && modified.tools) {
                modified.tools = modified.tools.filter(t => !allPostTools.has(t) || allowedPostTools.has(t));
                modified.tools.push("request_post_approval", "read");
              }
            }
            return modified;
          });

          const newState = {
            goal,
            status: "running",
            agents: normalized.map(a => ({ ...a, status: "pending", logs: [] })),
            agentResults: {},
            ceoLogs: [],
            summary: null
          };
          await withSwarmLock(async () => { setCurrentSwarmState(newState); });
          bcast({ type: "swarm_start", goal });
          await executeSwarmCampaign(socket, goal, normalized);
          return;
        }

        // Unknown message type
        safeSend(socket, { type: "error", message: `Unknown message type: ${data.type}` });
      } catch (e) {
        console.error("WS message handler error:", e?.message, e?.stack);
        safeSend(socket, { type: "error", message: "Internal error processing message" });
      }
    });
  });
}
