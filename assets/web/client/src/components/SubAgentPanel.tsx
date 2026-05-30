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

// 3D coordinates optimized for visual balance and hierarchy
const AGENT_POSITIONS: Record<string, THREE.Vector3> = {
  ceo: new THREE.Vector3(0, 2.2, 0),
  builder: new THREE.Vector3(-3.2, -0.4, 1.2),
  researcher: new THREE.Vector3(3.2, -0.4, 1.2),
  reviewer: new THREE.Vector3(0, -1.8, -1.8),
  default: new THREE.Vector3(0, 0, 0),
};

// Curated futuristic neon color palette
const STATUS_COLORS = {
  idle: 0x4f46e5,       // Neon Indigo
  running: 0xd946ef,    // Intense Fuchsia
  calling_tool: 0x06b6d4, // Cyan Glow
  done: 0x10b981,       // Cyber Green
  error: 0xf43f5e,      // Crimson Red
};

export default function SubAgentPanel({ ws }: { ws: WebSocket | null }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [task, setTask] = useState("");
  const [activeTab, setActiveTab] = useState<"command" | "swarm">("command");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ text: string; type: string; timestamp: string }>>([]);
  const { toast } = useToast();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // States dictionary for the React layer
  const [agentStates, setAgentStates] = useState<Record<string, AgentVisualState>>({
    ceo: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    builder: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    researcher: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    reviewer: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
  });

  // Hot ref for immediate frame-loop updates
  const agentStatesRef = useRef<Record<string, AgentVisualState>>({
    ceo: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    builder: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    researcher: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
    reviewer: { status: "idle", currentTool: "", task: "", lastUpdated: 0 },
  });

  // Load agents on startup
  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => {
        setAgents(d.agents || []);
        if (d.agents?.length > 0) {
          setSelectedAgent(d.agents[0].name);
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

  // Sync WebSocket messages to visual statuses
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
          text: `✦ Activated ${data.agentId}: ${data.task?.slice(0, 100)}`,
          type: "start",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_tool") {
        updateState({ status: "calling_tool", currentTool: data.name || "" });
        setLogs(prev => [...prev, {
          text: `  [${data.agentId}] executes ${data.name}`,
          type: "tool",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_done") {
        updateState({ status: "done", currentTool: "" });
        setRunning(false);
        toast(`Sub-agent ${data.agentId} completed`, "success");
        setLogs(prev => [...prev, {
          text: `✔ Swarm member ${data.agentId} idle (completed)`,
          type: "done",
          timestamp: timeStr
        }]);
      } else if (data.type === "subagent_error") {
        updateState({ status: "error", currentTool: "" });
        setRunning(false);
        toast(`Sub-agent error: ${data.message}`, "error");
        setLogs(prev => [...prev, {
          text: `❌ Failure ${data.agentId}: ${data.message}`,
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
      text: `📡 Establishing neural swarm connection with ${selectedAgent}...`,
      type: "delegate",
      timestamp: timeStr
    }]);
    ws.send(JSON.stringify({ type: "subagent_delegate", agentId: selectedAgent, task }));
    setTask("");
  }, [selectedAgent, task, ws, running]);

  // Redundant safety checks during Three.js instantiation
  useEffect(() => {
    if (activeTab !== "swarm" || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = Math.max(380, parent.clientHeight || 500);

    // 1. Scene & Atmosphere Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070708); // Ultra deep space blue-black
    scene.fog = new THREE.FogExp2(0x070708, 0.07);

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
    camera.position.set(0, 1.5, 9.5);

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 4. Advanced Lighting Systems
    const ambient = new THREE.AmbientLight(0x11111d, 0.4);
    scene.add(ambient);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(10, 15, 10);
    scene.add(mainLight);

    // Neon spot lights at node positions
    const pointLights: Record<string, THREE.PointLight> = {};
    Object.entries(AGENT_POSITIONS).forEach(([name, pos]) => {
      if (name === "default") return;
      const pl = new THREE.PointLight(STATUS_COLORS.idle, 2, 7, 1.5);
      pl.position.copy(pos);
      scene.add(pl);
      pointLights[name] = pl;
    });

    // 5. Polar grid helper for a tactical holographic sonar grid
    const polarGrid = new THREE.PolarGridHelper(7.5, 16, 8, 64, 0x1f1f2e, 0x101018);
    polarGrid.position.y = -2.5;
    scene.add(polarGrid);

    // 6. Deep Cosmos Particle Networks
    const particleGeometry = new THREE.BufferGeometry();
    const particlesCount = 400;
    const particlePositions = new Float32Array(particlesCount * 3);
    const particleColors = new Float32Array(particlesCount * 3);

    const palette = [0x6366f1, 0xd946ef, 0x06b6d4];
    for (let i = 0; i < particlesCount * 3; i += 3) {
      // Random sphere distribution
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 4.0 + Math.random() * 8.0;

      particlePositions[i] = r * Math.sin(phi) * Math.cos(theta);
      particlePositions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      particlePositions[i + 2] = r * Math.cos(phi);

      const color = new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
      particleColors[i] = color.r;
      particleColors[i + 1] = color.g;
      particleColors[i + 2] = color.b;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.07,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending
    });
    const starfield = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(starfield);

    // 7. Futuristic Gyroscopic Drones (Agility Nodes)
    const nodeGroups: Record<string, {
      group: THREE.Group;
      core: THREE.Mesh;
      shell: THREE.Mesh;
      ringX: THREE.Mesh;
      ringY: THREE.Mesh;
      pingRing: THREE.Mesh;
      labelSprite: THREE.Sprite | null;
      activeLabelText: string;
      bobOffset: number;
    }> = {};

    const createHUDLabel = (name: string, status: string, tool: string, colorHex: string) => {
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 110;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 300, 110);
        // Glassmorphic translucent panel
        ctx.fillStyle = "rgba(10, 10, 14, 0.9)";
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 2.5;

        // Custom cyber shape border drawing
        ctx.beginPath();
        ctx.moveTo(6, 6);
        ctx.lineTo(260, 6);
        ctx.lineTo(294, 40);
        ctx.lineTo(294, 104);
        ctx.lineTo(40, 104);
        ctx.lineTo(6, 70);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Technical scanner graphics (crosshairs in corner)
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.strokeRect(12, 12, 10, 10);
        ctx.beginPath();
        ctx.moveTo(17, 8); ctx.lineTo(17, 26);
        ctx.moveTo(8, 17); ctx.lineTo(26, 17);
        ctx.stroke();

        // Header Title
        ctx.font = "bold 20px monospace";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.fillText(name.toUpperCase(), 40, 34);

        // Status Indicators
        ctx.font = "bold 13px monospace";
        ctx.fillStyle = colorHex;
        ctx.fillText(`STATUS // ${status.toUpperCase()}`, 40, 58);

        // Current Action/Tool
        ctx.font = "12px monospace";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText(tool ? `EXE: [${tool}]` : "SYS: IDLE_MONITOR", 40, 80);
      }

      const texture = new THREE.CanvasTexture(c);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(0, 1.6, 0);
      sprite.scale.set(2.4, 0.88, 1);
      return sprite;
    };

    Object.entries(AGENT_POSITIONS).forEach(([name, pos]) => {
      if (name === "default") return;

      const group = new THREE.Group();
      group.position.copy(pos);

      // Core: Emissive Solid Icosahedron
      const coreGeom = new THREE.IcosahedronGeometry(0.24, 0);
      const coreMat = new THREE.MeshPhongMaterial({
        color: STATUS_COLORS.idle,
        emissive: STATUS_COLORS.idle,
        emissiveIntensity: 1.0,
        shininess: 80,
      });
      const core = new THREE.Mesh(coreGeom, coreMat);
      group.add(core);

      // Outer Shell: Octahedron Wireframe Cage
      const shellGeom = new THREE.OctahedronGeometry(0.48, 1);
      const shellMat = new THREE.MeshPhongMaterial({
        color: STATUS_COLORS.idle,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      });
      const shell = new THREE.Mesh(shellGeom, shellMat);
      group.add(shell);

      // Orbital Gyro Ring X
      const rxGeom = new THREE.RingGeometry(0.62, 0.65, 36);
      const ringMatX = new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.idle,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4
      });
      const ringX = new THREE.Mesh(rxGeom, ringMatX);
      group.add(ringX);

      // Orbital Gyro Ring Y
      const ryGeom = new THREE.RingGeometry(0.70, 0.73, 36);
      const ringMatY = new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.idle,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.3
      });
      const ringY = new THREE.Mesh(ryGeom, ringMatY);
      ringY.rotation.x = Math.PI / 2;
      group.add(ringY);

      // Radar pulse ring (Sonar waves)
      const pulseGeom = new THREE.RingGeometry(0.1, 0.75, 32);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.idle,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.0,
      });
      const pingRing = new THREE.Mesh(pulseGeom, pulseMat);
      pingRing.rotation.x = Math.PI / 2;
      group.add(pingRing);

      // Label Overlay Sprite
      const sprite = createHUDLabel(name, "idle", "", "#4f46e5");
      group.add(sprite);

      scene.add(group);

      nodeGroups[name] = {
        group,
        core,
        shell,
        ringX,
        ringY,
        pingRing,
        labelSprite: sprite,
        activeLabelText: "idle-",
        bobOffset: Math.random() * Math.PI * 2
      };
    });

    // 8. Communication grid connections (Neon Channels)
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

      const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
      const mat = new THREE.LineBasicMaterial({
        color: 0x222233,
        transparent: true,
        opacity: 0.4
      });
      const line = new THREE.Line(geom, mat);
      scene.add(line);
      lines.push(line);
    });

    // 9. Continuous Neural Streams (Glow trail particles along channels)
    interface TrailParticle {
      mesh: THREE.Mesh;
      from: THREE.Vector3;
      to: THREE.Vector3;
      speed: number;
      progress: number;
    }
    const trails: TrailParticle[] = [];
    const trailGeom = new THREE.SphereGeometry(0.04, 6, 6);
    const trailMat = new THREE.MeshBasicMaterial({ color: 0x9333ea, transparent: true, opacity: 0.8 });

    const spawnTrailParticles = () => {
      connections.forEach(conn => {
        // Only spawn if any node is active or randomly for ambient vibes
        const states = agentStatesRef.current;
        const fromActive = states[conn.from]?.status !== "idle";
        const toActive = states[conn.to]?.status !== "idle";
        const probability = (fromActive || toActive) ? 0.35 : 0.08;

        if (Math.random() < probability) {
          const start = AGENT_POSITIONS[conn.from];
          const end = AGENT_POSITIONS[conn.to];
          if (!start || !end) return;

          const mesh = new THREE.Mesh(trailGeom, trailMat.clone());
          scene.add(mesh);
          trails.push({
            mesh,
            from: start,
            to: end,
            speed: 0.007 + Math.random() * 0.01,
            progress: 0
          });
        }
      });
    };

    // 10. Interactive Raycasting Mouse Hover target ring
    const hoverRingGeom = new THREE.RingGeometry(0.85, 0.9, 4, 1, 0, Math.PI * 2);
    const hoverRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0 });
    const hoverTargetRing = new THREE.Mesh(hoverRingGeom, hoverRingMat);
    hoverTargetRing.rotation.x = Math.PI / 2;
    scene.add(hoverTargetRing);

    let raycaster = new THREE.Raycaster();
    let mouse = new THREE.Vector2();
    let hoveredAgent: string | null = null;

    // Mouse controls parameters
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let cameraAngleX = 0.3;
    let cameraAngleY = 0.2;
    const cameraRadius = 9.0;

    const handleMouseDown = () => { isDragging = true; };
    const handleMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDragging) {
        const deltaMove = {
          x: e.offsetX - previousMousePosition.x,
          y: e.offsetY - previousMousePosition.y
        };
        cameraAngleX -= deltaMove.x * 0.004;
        cameraAngleY = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, cameraAngleY - deltaMove.y * 0.004));
      }
      previousMousePosition = { x: e.offsetX, y: e.offsetY };
    };
    const handleMouseUp = () => { isDragging = false; };
    const handleMouseWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.z = Math.max(5, Math.min(16, camera.position.z + e.deltaY * 0.006));
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("wheel", handleMouseWheel);

    const handleResize = () => {
      const w = parent.clientWidth;
      const h = Math.max(380, parent.clientHeight || 500);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // 11. Animation Frame Loop
    let animFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      const states = agentStatesRef.current;

      // Spawn highway data particles
      if (Math.random() < 0.2) spawnTrailParticles();

      // Check intersections
      raycaster.setFromCamera(mouse, camera);
      let closestAgent: string | null = null;
      let closestDist = Infinity;

      Object.entries(nodeGroups).forEach(([name, node]) => {
        const ray = new THREE.Ray(camera.position, node.group.position.clone().sub(camera.position).normalize());
        const distance = camera.position.distanceTo(node.group.position);
        
        // Sphere intersection threshold test
        const sphereBounds = new THREE.Sphere(node.group.position, 0.85);
        if (raycaster.ray.intersectsSphere(sphereBounds)) {
          if (distance < closestDist) {
            closestDist = distance;
            closestAgent = name;
          }
        }
      });

      hoveredAgent = closestAgent;

      // Animate connections and packets
      for (let i = trails.length - 1; i >= 0; i--) {
        const t = trails[i];
        t.progress += t.speed;

        t.mesh.position.lerpVectors(t.from, t.to, t.progress);
        
        // Fade out slightly near the end
        if (t.progress > 0.8) {
          (t.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - t.progress) * 5;
        }

        if (t.progress >= 1.0) {
          scene.remove(t.mesh);
          t.mesh.geometry.dispose();
          (t.mesh.material as THREE.Material).dispose();
          trails.splice(i, 1);
        }
      }

      // Render loops on active node meshes
      Object.entries(nodeGroups).forEach(([name, node]) => {
        const state = states[name] || { status: "idle", currentTool: "", task: "" };
        const color = STATUS_COLORS[state.status] ?? STATUS_COLORS.idle;

        // A. Gentle Drone Hover Oscillation (sine wave based)
        const bob = Math.sin(time * 2.2 + node.bobOffset) * 0.12;
        node.group.position.y = AGENT_POSITIONS[name].y + bob;

        // B. Spin wireframe octahedron & gyro rings
        node.shell.rotation.y += 0.006;
        node.shell.rotation.x += 0.003;
        
        node.ringX.rotation.z += 0.015;
        node.ringY.rotation.z -= 0.01;

        // C. Sonar radar wave animation
        if (state.status === "running" || state.status === "calling_tool") {
          node.pingRing.scale.addScalar(0.018);
          (node.pingRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.4 - (node.pingRing.scale.x * 0.22));

          if (node.pingRing.scale.x > 2.2) {
            node.pingRing.scale.set(0.1, 0.1, 0.1);
          }
        } else {
          // Fade out wave if idle
          (node.pingRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (node.pingRing.material as THREE.MeshBasicMaterial).opacity - 0.02);
        }

        // D. Highlight sizes on hover
        let targetScale = hoveredAgent === name ? 1.25 : 1.0;
        node.core.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);

        // Update colors dynamically
        (node.core.material as THREE.MeshPhongMaterial).color.setHex(color);
        (node.core.material as THREE.MeshPhongMaterial).emissive.setHex(color);
        (node.shell.material as THREE.MeshPhongMaterial).color.setHex(color);
        (node.ringX.material as THREE.MeshBasicMaterial).color.setHex(color);
        (node.ringY.material as THREE.MeshBasicMaterial).color.setHex(color);
        (node.pingRing.material as THREE.MeshBasicMaterial).color.setHex(color);
        pointLights[name].color.setHex(color);

        // Recreate sprites texture on status change
        const labelText = `${state.status}-${state.currentTool}`;
        if (node.activeLabelText !== labelText) {
          node.activeLabelText = labelText;
          node.group.remove(node.labelSprite!);
          node.labelSprite!.material.map?.dispose();
          node.labelSprite!.material.dispose();

          let colorStr = "#4f46e5";
          if (state.status === "running") colorStr = "#d946ef";
          else if (state.status === "calling_tool") colorStr = "#06b6d4";
          else if (state.status === "done") colorStr = "#10b981";
          else if (state.status === "error") colorStr = "#f43f5e";

          const newSprite = createHUDLabel(name, state.status, state.currentTool, colorStr);
          node.labelSprite = newSprite;
          node.group.add(newSprite);
        }
      });

      // Raycast HUD Hover effect ring tracking
      if (hoveredAgent && nodeGroups[hoveredAgent]) {
        hoverTargetRing.position.copy(nodeGroups[hoveredAgent].group.position);
        hoverTargetRing.rotation.z += 0.02;
        (hoverTargetRing.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(time * 8) * 0.2;
      } else {
        (hoverTargetRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (hoverTargetRing.material as THREE.MeshBasicMaterial).opacity - 0.05);
      }

      // Camera orientation mapping
      if (!isDragging) {
        cameraAngleX += 0.001; // Auto rotation
      }
      camera.position.x = Math.sin(cameraAngleX) * Math.cos(cameraAngleY) * cameraRadius;
      camera.position.z = Math.cos(cameraAngleX) * Math.cos(cameraAngleY) * cameraRadius;
      camera.position.y = Math.sin(cameraAngleY) * cameraRadius;
      camera.lookAt(0, 0.4, 0);

      // Rotate background particles
      starfield.rotation.y = time * 0.015;

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("wheel", handleMouseWheel);
      
      // Memory cleanup
      polarGrid.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      hoverRingGeom.dispose();
      hoverRingMat.dispose();

      Object.values(nodeGroups).forEach(node => {
        node.core.geometry.dispose();
        (node.core.material as THREE.Material).dispose();
        node.shell.geometry.dispose();
        (node.shell.material as THREE.Material).dispose();
        node.ringX.geometry.dispose();
        (node.ringX.material as THREE.Material).dispose();
        node.ringY.geometry.dispose();
        (node.ringY.material as THREE.Material).dispose();
        node.pingRing.geometry.dispose();
        (node.pingRing.material as THREE.Material).dispose();
        node.labelSprite!.material.map?.dispose();
        node.labelSprite!.material.dispose();
      });

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
            <div className="status-dot" style={{ background: running ? "#d946ef" : ws ? "#10b981" : "#ef4444" }} />
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
          {running && <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "#d946ef" }} />}
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
                      border: selectedAgent === a.name ? "1px solid #d946ef" : "1px solid rgba(255,255,255,0.08)",
                      background: selectedAgent === a.name ? "rgba(217, 70, 239, 0.08)" : "#191919",
                      padding: 12,
                      borderRadius: 8,
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#ffffff" }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{a.description}</div>
                    <div style={{ fontSize: 11, color: "var(--body)", marginTop: 4 }}>
                      <span style={{ color: "#d946ef" }}>Tools</span>: {a.tools.join(", ") || "none"}
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
              background: "#070708",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              height: 500
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
                background: "rgba(10,10,14,0.85)",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
              }}
            >
              <div style={{ fontWeight: "bold", color: "#d946ef", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#d946ef" }} />
                NEURAL_SWARM_GRID // ENGAGED
              </div>
              <div>DRAG MOUSE : Orbit Viewport</div>
              <div>SCROLL : Zoom Viewport</div>
              <div>HOVER NODE : Focus Agent Info</div>
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
                background: "rgba(10,10,14,0.85)",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 5
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4f46e5" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>IDLE</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#d946ef" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>ENGAGED</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#06b6d4" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>EXEC_TOOL</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>SUCCESS</span>
              </div>
            </div>
          </div>

          {/* Real-time Swarm logs next to visualizer */}
          <div className="card" style={{ display: "flex", flexDirection: "column", height: 500 }}>
            <div className="card-header" style={{ flexShrink: 0 }}>Holographic Output Stream</div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                lineHeight: 1.6,
                overflowY: "auto",
                flexGrow: 1,
                color: "#c5c5c5",
                background: "#0a0a0c",
                padding: 12,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.06)"
              }}
            >
              {logs.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.25)", textAlign: "center", marginTop: 60 }}>
                  [ Swarm network idle. Enter task to launch. ]
                </div>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: 8,
                      wordBreak: "break-all",
                      color:
                        log.type === "start" ? "#d946ef" :
                        log.type === "tool" ? "#06b6d4" :
                        log.type === "done" ? "#10b981" :
                        log.type === "error" ? "#f43f5e" : "#ffffff"
                    }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.2)", marginRight: 6 }}>[{log.timestamp}]</span>
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
