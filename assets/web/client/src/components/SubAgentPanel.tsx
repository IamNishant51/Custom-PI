import { useState, useEffect, useCallback, useRef } from "react";
import * as THREE from "three";
import { useToast } from "./Toast";

interface AgentInfo {
  name: string;
  description: string;
  tools: string[];
  model: string;
}

interface SubAgentMessage {
  type: "subagent_start" | "subagent_tool" | "subagent_done" | "subagent_error";
  agentId: string;
  task?: string;
  result?: string;
  name?: string;
  args?: any;
  message?: string;
}

interface AgentVisualState {
  status: "idle" | "running" | "calling_tool" | "done" | "error";
  currentTool: string;
  task: string;
  lastUpdated: number;
}

// Fixed positions in 3D space for standard agents
const AGENT_POSITIONS: Record<string, THREE.Vector3> = {
  ceo: new THREE.Vector3(0, 2.5, 0),
  builder: new THREE.Vector3(-2.5, -0.5, 1.5),
  researcher: new THREE.Vector3(2.5, -0.5, 1.5),
  reviewer: new THREE.Vector3(0, -2.0, -1.0),
  default: new THREE.Vector3(0, 0, 0), // fallback
};

// Node colors based on status
const STATUS_COLORS = {
  idle: 0x4f46e5,       // Indigo
  running: 0xa855f7,    // Purple
  calling_tool: 0x06b6d4, // Cyan
  done: 0x10b981,       // Green
  error: 0xef4444,      // Red
};

export default function SubAgentPanel({ ws }: { ws: WebSocket | null }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [task, setTask] = useState("");
  const [activeTab, setActiveTab] = useState<"command" | "swarm">("command");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ text: string; type: string; timestamp: string }>>([]);
  const { toast } = useToast();

  // Reference for the Three.js viewport canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Swarm visual state tracking
  const [agentStates, setAgentStates] = useState<Record<string, AgentVisualState>>({
    ceo: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    builder: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    researcher: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    reviewer: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
  });

  // Trackers ref for Three.js render loop access
  const agentStatesRef = useRef<Record<string, AgentVisualState>>({
    ceo: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    builder: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    researcher: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    reviewer: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
  });

  // Load available agents
  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => {
        setAgents(d.agents || []);
        if (d.agents?.length > 0) {
          setSelectedAgent(d.agents[0].name);
          // Initialize states
          const initialStates: Record<string, AgentVisualState> = {};
          d.agents.forEach((a: AgentInfo) => {
            initialStates[a.name.toLowerCase()] = { status: "idle", currentTool: "", task: "", lastUpdated: 0 };
          });
          setAgentStates(initialStates);
          agentStatesRef.current = initialStates;
        }
      })
      .catch(() => {});
  }, []);

  // Listen to WebSocket subagent notifications
  useEffect(() => {
    if (!ws) return;

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as SubAgentMessage;
      const agentKey = data.agentId.toLowerCase();
      const timeStr = new Date().toLocaleTimeString();

      const updateState = (updates: Partial<AgentVisualState>) => {
        setAgentStates(prev => {
          const next = {
            ...prev,
            [agentKey]: {
              ...(prev[agentKey] || { status: "idle", currentTool: "", task: "", lastUpdated: 0 }),
              ...updates,
              lastUpdated: Date.now()
            }
          };
          agentStatesRef.current = next;
          return next;
        });
      };

      if (data.type === "subagent_start") {
        setRunning(true);
        setActiveTab("swarm");
        updateState({ status: "running", task: data.task || "", currentTool: "" });
        setLogs(prev => [...prev, {
          text: `✦ Started ${data.agentId}: ${data.task?.slice(0, 100)}`,
          type: "start",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_tool") {
        updateState({ status: "calling_tool", currentTool: data.name || "" });
        setLogs(prev => [...prev, {
          text: `  ↳ ${data.agentId} calling tool: [${data.name}]`,
          type: "tool",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_done") {
        updateState({ status: "done", currentTool: "" });
        setRunning(false);
        toast(`Sub-agent ${data.agentId} completed`, "success");
        setLogs(prev => [...prev, {
          text: `✔ Completed ${data.agentId}`,
          type: "done",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_error") {
        updateState({ status: "error", currentTool: "" });
        setRunning(false);
        toast(`Sub-agent error: ${data.message}`, "error");
        setLogs(prev => [...prev, {
          text: `❌ Error ${data.agentId}: ${data.message}`,
          type: "error",
          timestamp: timeStr
        }]);
      }
    };

    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws, toast]);

  const delegate = useCallback(() => {
    if (!selectedAgent || !task.trim() || !ws || running) return;
    const timeStr = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, {
      text: `▶ Delegating tasks to ${selectedAgent}...`,
      type: "delegate",
      timestamp: timeStr
    }]);
    ws.send(JSON.stringify({ type: "subagent_delegate", agentId: selectedAgent, task }));
    setTask("");
  }, [selectedAgent, task, ws, running]);

  // Three.js Render Logic
  useEffect(() => {
    if (activeTab !== "swarm" || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = Math.max(350, parent.clientHeight || 450);

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.08);

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(0, 0, 8);

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    // Glowing point lights
    const pointLights: Record<string, THREE.PointLight> = {};
    Object.entries(AGENT_POSITIONS).forEach(([name, pos]) => {
      if (name === "default") return;
      const pl = new THREE.PointLight(STATUS_COLORS.idle, 1.5, 6);
      pl.position.copy(pos);
      scene.add(pl);
      pointLights[name] = pl;
    });

    // 5. Grid/Holographic Guides
    const gridHelper = new THREE.GridHelper(16, 16, 0x333333, 0x181818);
    gridHelper.position.y = -3;
    scene.add(gridHelper);

    // 6. Data Particle Clouds (Drifting background stars)
    const particleCount = 200;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 15;
      positions[i + 1] = (Math.random() - 0.5) * 15;
      positions[i + 2] = (Math.random() - 0.5) * 15;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x6366f1,
      size: 0.08,
      transparent: true,
      opacity: 0.6
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // 7. Node meshes
    const nodeMeshes: Record<string, {
      sphere: THREE.Mesh;
      ring: THREE.Mesh;
      group: THREE.Group;
      labelSprite: THREE.Sprite | null;
      activeLabelText: string;
      activeLabelColor: number;
    }> = {};

    // Helper to render text labels inside the 3D view using HTML canvas sprites
    const createTextSprite = (name: string, status: string, tool: string, colorHex: string) => {
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 256;
      labelCanvas.height = 96;
      const ctx = labelCanvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 256, 96);
        // Rounded border card
        ctx.fillStyle = "rgba(25, 25, 25, 0.85)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(4, 4, 248, 88, 8);
        ctx.fill();
        ctx.stroke();

        // Label name
        ctx.font = "bold 20px monospace";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(name.toUpperCase(), 128, 32);

        // Status text
        ctx.font = "14px monospace";
        ctx.fillStyle = colorHex;
        ctx.fillText(status.toUpperCase(), 128, 54);

        // Tool text
        if (tool) {
          ctx.font = "italic 12px monospace";
          ctx.fillStyle = "#a5f3fc"; // Cyan-200
          ctx.fillText(`calling: ${tool}`, 128, 76);
        }
      }
      const texture = new THREE.CanvasTexture(labelCanvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(0, 1.3, 0);
      sprite.scale.set(2.0, 0.75, 1);
      return sprite;
    };

    Object.entries(AGENT_POSITIONS).forEach(([name, pos]) => {
      if (name === "default") return;

      const group = new THREE.Group();
      group.position.copy(pos);

      // Inner wireframe sphere
      const sphereGeom = new THREE.SphereGeometry(0.35, 12, 12);
      const sphereMat = new THREE.MeshPhongMaterial({
        color: STATUS_COLORS.idle,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
        emissive: STATUS_COLORS.idle,
        emissiveIntensity: 0.5,
      });
      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      group.add(sphere);

      // Outer orbital ring
      const ringGeom = new THREE.RingGeometry(0.55, 0.58, 30);
      const ringMat = new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.idle,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = Math.random() * Math.PI;
      ring.rotation.y = Math.random() * Math.PI;
      group.add(ring);

      // Initial label
      const sprite = createTextSprite(name, "idle", "", "#4f46e5");
      group.add(sprite);

      scene.add(group);
      nodeMeshes[name] = {
        sphere,
        ring,
        group,
        labelSprite: sprite,
        activeLabelText: "idle-",
        activeLabelColor: STATUS_COLORS.idle
      };
    });

    // 8. Visual links between agents (Glowing network channels)
    const connections = [
      { from: "ceo", to: "builder" },
      { from: "ceo", to: "researcher" },
      { from: "ceo", to: "reviewer" },
      { from: "researcher", to: "builder" },
      { from: "builder", to: "reviewer" },
    ];

    const lines: THREE.Line[] = [];
    connections.forEach(conn => {
      const start = AGENT_POSITIONS[conn.from];
      const end = AGENT_POSITIONS[conn.to];
      if (!start || !end) return;

      const lineGeom = new THREE.BufferGeometry().setFromPoints([start, end]);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x333333,
        transparent: true,
        opacity: 0.4
      });
      const line = new THREE.Line(lineGeom, lineMat);
      scene.add(line);
      lines.push(line);
    });

    // 9. Data packets flowing along the connections (Visualizing active swarm)
    interface Packet {
      mesh: THREE.Mesh;
      from: string;
      to: string;
      progress: number;
      speed: number;
    }
    const activePackets: Packet[] = [];
    const packetGeom = new THREE.SphereGeometry(0.06, 8, 8);
    const packetMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });

    const spawnPacket = (from: string, to: string) => {
      const pMesh = new THREE.Mesh(packetGeom, packetMat);
      scene.add(pMesh);
      activePackets.push({
        mesh: pMesh,
        from,
        to,
        progress: 0,
        speed: 0.015 + Math.random() * 0.01
      });
    };

    // Camera Orbit Mouse Controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let cameraAngleX = 0;
    let cameraAngleY = 0.2;
    const cameraRadius = 8;

    const handleMouseDown = () => { isDragging = true; };
    const handleMouseMove = (e: MouseEvent) => {
      const deltaMove = {
        x: e.offsetX - previousMousePosition.x,
        y: e.offsetY - previousMousePosition.y
      };

      if (isDragging) {
        cameraAngleX -= deltaMove.x * 0.005;
        cameraAngleY = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraAngleY - deltaMove.y * 0.005));
      }
      previousMousePosition = { x: e.offsetX, y: e.offsetY };
    };
    const handleMouseUp = () => { isDragging = false; };
    const handleMouseWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Zoom limits
      camera.position.z = Math.max(4, Math.min(15, camera.position.z + e.deltaY * 0.008));
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("wheel", handleMouseWheel);

    // Track resize
    const handleResize = () => {
      const w = parent.clientWidth;
      const h = Math.max(350, parent.clientHeight || 450);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // 10. Frame render loop
    let animFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const states = agentStatesRef.current;

      // Rotate nodes and pulse active ones
      Object.entries(nodeMeshes).forEach(([name, meshGroup]) => {
        const state = states[name] || { status: "idle", currentTool: "", task: "" };
        const color = STATUS_COLORS[state.status] ?? STATUS_COLORS.idle;

        // Spin orbital rings
        meshGroup.ring.rotation.z += 0.01;
        meshGroup.ring.rotation.y += 0.005;

        // Pulsating motion if running/calling tool
        let scale = 1.0;
        if (state.status === "running") {
          scale = 1.0 + Math.sin(elapsed * 6) * 0.15;
          meshGroup.ring.rotation.z += 0.03;
        } else if (state.status === "calling_tool") {
          scale = 1.0 + Math.sin(elapsed * 12) * 0.22;
          meshGroup.ring.rotation.z += 0.06;
          // Spawn packets randomly between active nodes
          if (Math.random() < 0.03 && activePackets.length < 5) {
            const targets = Object.keys(AGENT_POSITIONS).filter(k => k !== name && k !== "default");
            const dest = targets[Math.floor(Math.random() * targets.length)];
            spawnPacket(name, dest);
          }
        }

        meshGroup.sphere.scale.set(scale, scale, scale);

        // Update colors dynamically
        (meshGroup.sphere.material as THREE.MeshPhongMaterial).color.setHex(color);
        (meshGroup.sphere.material as THREE.MeshPhongMaterial).emissive.setHex(color);
        (meshGroup.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
        pointLights[name].color.setHex(color);

        // Recreate sprites only when status/tool changes
        const labelText = `${state.status}-${state.currentTool}`;
        if (meshGroup.activeLabelText !== labelText) {
          meshGroup.activeLabelText = labelText;
          meshGroup.group.remove(meshGroup.labelSprite!);

          // Determine status color string
          let statusColorStr = "#4f46e5";
          if (state.status === "running") statusColorStr = "#a855f7";
          else if (state.status === "calling_tool") statusColorStr = "#06b6d4";
          else if (state.status === "done") statusColorStr = "#10b981";
          else if (state.status === "error") statusColorStr = "#ef4444";

          const newSprite = createTextSprite(name, state.status, state.currentTool, statusColorStr);
          meshGroup.labelSprite = newSprite;
          meshGroup.group.add(newSprite);
        }
      });

      // Animate packet movements
      for (let i = activePackets.length - 1; i >= 0; i--) {
        const p = activePackets[i];
        p.progress += p.speed;

        const start = AGENT_POSITIONS[p.from];
        const end = AGENT_POSITIONS[p.to];
        if (start && end) {
          p.mesh.position.lerpVectors(start, end, p.progress);
        }

        if (p.progress >= 1.0) {
          scene.remove(p.mesh);
          activePackets.splice(i, 1);
        }
      }

      // Slowly rotate camera or update from mouse coordinates
      if (!isDragging) {
        cameraAngleX += 0.0015;
      }
      camera.position.x = Math.sin(cameraAngleX) * Math.cos(cameraAngleY) * cameraRadius;
      camera.position.z = Math.cos(cameraAngleX) * Math.cos(cameraAngleY) * cameraRadius;
      camera.position.y = Math.sin(cameraAngleY) * cameraRadius;
      camera.lookAt(0, 0, 0);

      // Rotate background particles
      particles.rotation.y = elapsed * 0.02;

      renderer.render(scene, camera);
    };

    animate();

    // Clean up
    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("wheel", handleMouseWheel);
      activePackets.forEach(p => scene.remove(p.mesh));
      renderer.dispose();
    };
  }, [activeTab]);

  return (
    <div>
      {/* 3D Dashboard HUD Header */}
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-card">
          <div className="stat-label">Available Swarm</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{agents.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Running States</div>
          <div style={{ fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <div className="status-dot" style={{ background: running ? "#a855f7" : ws ? "#10b981" : "#ef4444" }} />
            {running ? "Swarm Engaged" : ws ? "Ready" : "Disconnected"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Neural Connection</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{ws ? "Active WebSocket" : "No link"}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${activeTab === "command" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("command")}
          style={{ cursor: "pointer" }}
        >
          Swarm Command
        </button>
        <button
          className={`btn ${activeTab === "swarm" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setActiveTab("swarm")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          {running && <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7" }} />}
          Running Swarm View (3D)
        </button>
      </div>

      {activeTab === "command" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div className="card-header">Swarm Task Delegation</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <select
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "#191919",
                  color: "#ffffff"
                }}
                disabled={running}
              >
                {agents.map(a => (
                  <option key={a.name} value={a.name}>{a.name} — {a.description}</option>
                ))}
              </select>
              <textarea
                className="chat-input"
                rows={5}
                placeholder="Describe the task for the specialized agent swarm..."
                value={task}
                onChange={e => setTask(e.target.value)}
                disabled={running}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={delegate} disabled={running || !task.trim() || !ws}>
                  {running ? "Swarm Busy..." : "Delegate Swarm Task"}
                </button>
                <button className="btn btn-ghost" onClick={() => setLogs([])} disabled={logs.length === 0}>
                  Clear Logs
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Active Swarm Profiles</div>
            {agents.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>
                <div className="empty-state-desc">No sub-agents configured. Create them in the CLI first.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 330, overflowY: "auto" }}>
                {agents.map(a => (
                  <div
                    key={a.name}
                    className={`agent-card ${selectedAgent === a.name ? "active" : ""}`}
                    onClick={() => setSelectedAgent(a.name)}
                    style={{
                      border: selectedAgent === a.name ? "1px solid #a855f7" : "1px solid rgba(255,255,255,0.08)",
                      background: selectedAgent === a.name ? "rgba(168, 85, 247, 0.08)" : "#191919",
                      padding: 12,
                      borderRadius: 8,
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#ffffff" }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{a.description}</div>
                    <div style={{ fontSize: 11, color: "var(--body)", marginTop: 4 }}>
                      <span style={{ color: "#a855f7" }}>Tools</span>: {a.tools.join(", ") || "none"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--body)", marginTop: 2 }}>
                      <span style={{ color: "#06b6d4" }}>Model</span>: {a.model}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 3D Scene Viewport tab */
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
          <div
            className="card"
            style={{
              padding: 0,
              overflow: "hidden",
              position: "relative",
              background: "#0a0a0a",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              height: 480
            }}
          >
            {/* Visualizer Canvas */}
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

            {/* Hologram Controls Overlay */}
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                fontFamily: "monospace",
                fontSize: 10,
                color: "rgba(255,255,255,0.4)",
                pointerEvents: "none",
                background: "rgba(10,10,10,0.75)",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              <div style={{ fontWeight: "bold", color: "#a855f7", marginBottom: 4 }}>SWARM_VISUALIZER // ACTIVE</div>
              <div>DRAG MOUSE : Orbit Camera</div>
              <div>MOUSE SCROLL : Zoom In/Out</div>
            </div>

            {/* Neural Net State Legends */}
            <div
              style={{
                position: "absolute",
                bottom: 12,
                right: 12,
                fontFamily: "monospace",
                fontSize: 10,
                pointerEvents: "none",
                background: "rgba(10,10,10,0.75)",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.05)",
                display: "flex",
                flexDirection: "column",
                gap: 4
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4f46e5" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>IDLE</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a855f7" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>RUNNING</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#06b6d4" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>CALLING_TOOL</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>DONE</span>
              </div>
            </div>
          </div>

          {/* Real-time Swarm logs next to visualizer */}
          <div className="card" style={{ display: "flex", flexDirection: "column", height: 480 }}>
            <div className="card-header" style={{ flexShrink: 0 }}>Real-Time Swarm Output</div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                lineHeight: 1.5,
                overflowY: "auto",
                flexGrow: 1,
                color: "#c5c5c5",
                background: "#0d0d0d",
                padding: 10,
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              {logs.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.35)", textAlign: "center", marginTop: 40 }}>
                  [ Ready to execute tasks ]
                </div>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: 8,
                      wordBreak: "break-all",
                      color:
                        log.type === "start" ? "#a855f7" :
                        log.type === "tool" ? "#06b6d4" :
                        log.type === "done" ? "#10b981" :
                        log.type === "error" ? "#ef4444" : "#ffffff"
                    }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.25)", marginRight: 6 }}>[{log.timestamp}]</span>
                    {log.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
