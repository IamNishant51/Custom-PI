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

  app.get("/ws", { websocket: true }, (socket, req) => {
    if (apiKey) {
      const wsToken = req.query?.token || "";
      if (!wsToken || wsToken.length !== apiKey.length || !crypto.timingSafeEqual(Buffer.from(wsToken), Buffer.from(apiKey))) {
        try { socket.send(JSON.stringify({ type: "error", message: "Unauthorized — provide token query parameter" })); } catch {}
        setTimeout(() => socket.close(), 500);
        return;
      }
    }
    console.log("WebSocket connected from", req.ip);

    let session;
    try { session = getOrCreateSession(); }
    catch (e) {
      try { socket.send(JSON.stringify({ type: "error", message: "Server init error" })); } catch {}
      setTimeout(() => socket.close(), 500);
      return;
    }

    if (session.messages && session.messages.length > 0) {
      try { socket.send(JSON.stringify({ type: "chat_history", messages: session.messages })); } catch {}
    }

    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        try { socket.close(); } catch {}
        return;
      }
      alive = false;
      try { socket.ping(); } catch {}
    }, WS_PING_INTERVAL);

    socket.on("pong", () => { alive = true; });

    const current = getCurrentSwarmState();
    if (current) {
      swarmSockets.add(socket);
      try {
        socket.send(JSON.stringify({
          type: "swarm_recovery",
          ...current,
          paused: getSwarmPaused()
        }));
      } catch {}
    }

    socket.on("close", () => {
      clearInterval(pingTimer);
      swarmSockets.delete(socket);
      console.log("WebSocket disconnected from", req.ip);
    });
    socket.on("error", (err) => {
      clearInterval(pingTimer);
      swarmSockets.delete(socket);
      console.error("WebSocket error:", err?.message);
    });

    socket.on("message", async (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); }
      catch { try { socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" })); } catch {} return; }

      if (data.type === "chat") {
        if (data.attachments) {
          let totalSize = 0;
          for (const att of data.attachments) {
            if (att.data) totalSize += att.data.length;
            if (att.text) totalSize += att.text.length;
          }
          if (totalSize > MAX_FILE_SIZE) {
            try { socket.send(JSON.stringify({ type: "error", message: `Attachment total size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please reduce file sizes.` })); } catch {}
            return;
          }
        }
        try { socket.send(JSON.stringify({ type: "session_start" })); } catch {}
        try {
          await session.handleMessage(data.message, data.cwd || process.cwd(), (event) => {
            try { socket.send(JSON.stringify(event)); } catch {}
          }, data.attachments);
        } catch (e) {
          try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {}
        }
      }

      if (data.type === "interrupt") {
        if (session) session.interrupt();
      }

      if (data.type === "swarm_pause") {
        await withSwarmLock(async () => {
          setSwarmPaused(true);
          try { socket.send(JSON.stringify({ type: "swarm_paused" })); } catch {}
        });
        return;
      }

      if (data.type === "swarm_resume") {
        await withSwarmLock(async () => {
          setSwarmPaused(false);
          const resolve = getSwarmPauseResolve();
          if (resolve) { try { resolve(); } catch {} setSwarmPauseResolve(null); }
          try { socket.send(JSON.stringify({ type: "swarm_resumed" })); } catch {}
        });
        return;
      }

      if (data.type === "user_answer") {
        const q = pendingQuestions[data.questionId];
        if (q && q.resolve) {
          q.resolve(data.answer);
        }
      }

      if (data.type === "agent_chat") {
        const { agentId, message } = data;
        if (agentId && message) {
          getAgentChatBuffer(agentId).push({ role: "user", content: message, timestamp: Date.now() });
          bcast({ type: "agent_chat", agentId, message, fromAgent: false });

          const currentState = getCurrentSwarmState();
          const isSwarmRunning = currentState && currentState.status === "running";
          if (!isSwarmRunning || !currentState?.agents?.find(a => a.id === agentId)) {
            try {
              socket.send(JSON.stringify({ type: "session_start" }));
              session.handleMessage(`[Message for agent '${agentId}']: ${message}`, data.cwd || process.cwd(), (event) => {
                try { socket.send(JSON.stringify(event)); } catch {}
              }, null);
            } catch (e) {
              try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {}
            }
          }
        }
      }

      if (data.type === "memory_search") {
        try { socket.send(JSON.stringify({ type: "memory_results", results: memorySearch(data.query, data.k ?? 5) })); }
        catch (e) { try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {} }
      }

      if (data.type === "subagent_delegate") {
        const { agentId, task } = data;
        try { await handleSubAgent(socket, agentId, task); }
        catch (e) { try { socket.send(JSON.stringify({ type: "error", message: e.message })); } catch {} }
      }

      if (data.type === "swarm_goal") {
        const { goal } = data;
        try { await handleSwarmGoal(socket, goal); }
        catch (e) { try { socket.send(JSON.stringify({ type: "swarm_error", message: "Swarm execution failed" })); } catch {} }
      }

      if (data.type === "run_dag") {
        try {
          const dagConfig = loadDagConfig();
          if (!dagConfig) {
            try { socket.send(JSON.stringify({ type: "swarm_error", message: "DAG config not found at ~/.pi/agent/dag-config.yaml" })); } catch {}
            return;
          }
          await handleDagGoal(socket, data.goal || "DAG Swarm Goal", dagConfig);
        } catch (e) { try { socket.send(JSON.stringify({ type: "swarm_error", message: "Swarm execution failed" })); } catch {} }
      }

      if (data.type === "swarm_saved_team") {
        const { goal, agents } = data;
        try {
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
        }
        catch (e) { try { socket.send(JSON.stringify({ type: "swarm_error", message: "Swarm execution failed" })); } catch {} }
      }
    });
  });
}
