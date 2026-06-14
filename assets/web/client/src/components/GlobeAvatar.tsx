import { useRef, useMemo, useCallback, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type GlobeState = "idle" | "listening" | "thinking" | "speaking";

const STAR_COUNT = 10000;
const BH_RADIUS = 1.2;

// ── Soft glow sprite ──────────────────────────────────────────────
function makeGlowSprite(inner = 0, falloff = 0.5): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, inner * 32, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(falloff * 0.3, "rgba(255,220,170,0.85)");
  g.addColorStop(falloff * 0.6, "rgba(255,150,80,0.3)");
  g.addColorStop(falloff * 0.85, "rgba(200,80,40,0.08)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const starSprite = makeGlowSprite(0, 0.45);
const glowSprite = makeGlowSprite(0, 0.6);
const wideGlow = makeGlowSprite(0, 0.8);

// ── Position helpers ──────────────────────────────────────────────
function randomSpherePos(r: number): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const rr = r * (0.25 + Math.random() * 0.75);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta) * rr,
    Math.sin(phi) * Math.sin(theta) * rr,
    Math.cos(phi) * rr,
  );
}

function randomDiskPos(r: number): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const rr = r * (0.2 + Math.random() * 0.8);
  return new THREE.Vector3(
    Math.cos(theta) * rr,
    (Math.random() - 0.5) * 0.1 * rr,
    Math.sin(theta) * rr,
  );
}

function starHueColor(p: THREE.Vector3, r: number): THREE.Color {
  const angle = Math.atan2(p.z, p.x);
  const dist = r / (BH_RADIUS * 1.1);
  const t = (dist * 0.25 + angle * 0.05 + 0.5) % 1;
  const c = new THREE.Color();
  if (dist < 0.12) c.setHSL(0.07 + dist * 0.35, 0.85, 0.4 + dist * 0.6);
  else if (t < 0.25) c.setHSL(0.58 - dist * 0.08, 0.6, 0.35 + Math.random() * 0.35);
  else if (t < 0.5) c.setHSL(0.5 - dist * 0.1, 0.4, 0.3 + Math.random() * 0.4);
  else if (t < 0.7) c.setHSL(0.07 + Math.random() * 0.04, 0.7, 0.5 + Math.random() * 0.35);
  else c.setHSL(0.55 + Math.random() * 0.08, 0.3, 0.6 + Math.random() * 0.25);
  c.multiplyScalar(1.8 + Math.random() * 1.0);
  return c;
}

// ── Hover indicator ring ──────────────────────────────────────────
function HoverRing({ posRef, visible }: { posRef: React.MutableRefObject<THREE.Vector3>; visible: boolean }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.position.copy(posRef.current);
    ref.current.lookAt(new THREE.Vector3(0, 0, 0));
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = visible ? 0.3 + 0.15 * Math.sin(t * 3.5) : 0;
  });

  return (
    <mesh ref={ref}>
      <ringGeometry args={[0.08, 0.16, 24]} />
      <meshBasicMaterial color="#ffaa44" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ── Main scene ────────────────────────────────────────────────────
function BlackHoleScene({
  state,
  analyserNode,
}: {
  state: GlobeState;
  analyserNode?: AnalyserNode | null;
}) {
  const starsRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Points>(null);
  const diskRef = useRef<THREE.Points>(null);

  const hitRef = useRef<THREE.Mesh>(null);
  const hoverPos = useRef(new THREE.Vector3(0, 10, 0));
  const hoverActive = useRef(false);
  const [showHover, setShowHover] = useState(false);

  const smoothAudio = useRef(0);
  const smoothPulse = useRef(0);
  const breathePhase = useRef(0);
  const diskAngle = useRef(0);

  const { pointer, camera } = useThree();

  // Particle data
  const { starBase, starPos, starSize, starCol, glowBase, glowPos, glowSize, glowCol, diskBase, diskPos, diskSize, diskCol } = useMemo(() => {
    const Ns = STAR_COUNT, Ng = 4000, Nd = 5000;

    const sb = new Float32Array(Ns * 3), sp = new Float32Array(Ns * 3), ss = new Float32Array(Ns), sc = new Float32Array(Ns * 3);
    const gb = new Float32Array(Ng * 3), gp = new Float32Array(Ng * 3), gs = new Float32Array(Ng), gc = new Float32Array(Ng * 3);
    const db = new Float32Array(Nd * 3), dp = new Float32Array(Nd * 3), ds = new Float32Array(Nd), dc = new Float32Array(Nd * 3);

    for (let i = 0; i < Ns; i++) {
      const p = randomSpherePos(BH_RADIUS);
      sb[i * 3] = p.x; sb[i * 3 + 1] = p.y; sb[i * 3 + 2] = p.z;
      sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const c = starHueColor(p, r);
      sc[i * 3] = c.r; sc[i * 3 + 1] = c.g; sc[i * 3 + 2] = c.b;
      ss[i] = 0.045 + (1 - r / BH_RADIUS) * 0.085 + Math.random() * 0.04;
    }

    for (let i = 0; i < Ng; i++) {
      const p = randomSpherePos(BH_RADIUS * 0.45);
      gb[i * 3] = p.x; gb[i * 3 + 1] = p.y; gb[i * 3 + 2] = p.z;
      gp[i * 3] = p.x; gp[i * 3 + 1] = p.y; gp[i * 3 + 2] = p.z;
      const c = new THREE.Color("#ff8833").lerp(new THREE.Color("#ffbb55"), Math.random());
      c.multiplyScalar(2.4);
      gc[i * 3] = c.r; gc[i * 3 + 1] = c.g; gc[i * 3 + 2] = c.b;
      gs[i] = 0.15 + Math.random() * 0.18;
    }

    for (let i = 0; i < Nd; i++) {
      const p = randomDiskPos(BH_RADIUS);
      db[i * 3] = p.x; db[i * 3 + 1] = p.y; db[i * 3 + 2] = p.z;
      dp[i * 3] = p.x; dp[i * 3 + 1] = p.y; dp[i * 3 + 2] = p.z;
      const r = Math.sqrt(p.x * p.x + p.z * p.z);
      const heat = 1 - Math.min(1, (r - BH_RADIUS * 0.15) / (BH_RADIUS * 0.85));
      const c = new THREE.Color().setHSL(0.07 - heat * 0.035, 0.9, 0.45 + heat * 0.5);
      c.multiplyScalar(2.0 + heat * 1.0);
      dc[i * 3] = c.r; dc[i * 3 + 1] = c.g; dc[i * 3 + 2] = c.b;
      ds[i] = 0.045 + heat * 0.11 + Math.random() * 0.03;
    }

    return { starBase: sb, starPos: sp, starSize: ss, starCol: sc, glowBase: gb, glowPos: gp, glowSize: gs, glowCol: gc, diskBase: db, diskPos: dp, diskSize: ds, diskCol: dc };
  }, []);

  // ── Events ──
  const onPointerMove = useCallback((e: any) => {
    hoverPos.current.copy(e.point);
    hoverActive.current = true;
    setShowHover(true);
  }, []);

  const onPointerLeave = useCallback(() => {
    hoverActive.current = false;
    setShowHover(false);
  }, []);

  const prevTime = useRef(0);

  // ── Animation ──
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const dt = prevTime.current === 0 ? 0.016 : Math.min(t - prevTime.current, 0.05);
    prevTime.current = t;

    // Audio
    let rawAudio = 0;
    if (state === "speaking" && analyserNode) {
      const d = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(d);
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i];
      rawAudio = Math.min(1, (s / d.length / 255) * 4.5);
    } else if (state === "speaking") {
      rawAudio = 0.35 + 0.3 * Math.sin(t * 5.5);
    }
    smoothAudio.current += (rawAudio - smoothAudio.current) * Math.min(1, dt * 20);

    // Pulse target
    let pTarget = 0.15;
    if (state === "listening") pTarget = 0.4 + 0.25 * Math.sin(t * 1.5);
    else if (state === "thinking") pTarget = 0.25 + 0.1 * Math.sin(t * 1.1);
    else if (state === "speaking") pTarget = 0.45 + 0.9 * smoothAudio.current;
    smoothPulse.current += (pTarget - smoothPulse.current) * 0.08;

    // Breathing
    breathePhase.current += dt * 0.3;
    const breath = 1 + Math.sin(breathePhase.current) * 0.005;

    // Rotation
    const starRotY = t * 0.035, starRotX = Math.sin(t * 0.01) * 0.035;
    const diskRotSpeed = 0.1 + smoothAudio.current * 0.25;
    diskAngle.current += dt * diskRotSpeed;

    if (starsRef.current) {
      starsRef.current.rotation.y = starRotY;
      starsRef.current.rotation.x = starRotX;
    }
    if (glowRef.current) {
      glowRef.current.rotation.y = t * 0.04;
      glowRef.current.rotation.x = Math.sin(t * 0.008) * 0.025;
    }
    if (diskRef.current) {
      diskRef.current.rotation.y = t * diskRotSpeed + diskAngle.current;
      diskRef.current.rotation.x = 0.2 + Math.sin(t * 0.015) * 0.025;
    }

    // Audio shockwave ring
    const shockRadius = BH_RADIUS + smoothAudio.current * 0.6;
    const shockOpacity = smoothAudio.current * 0.3;

    const hc = hoverPos.current;
    const hAct = hoverActive.current;
    const audioAmp = smoothAudio.current;
    const pulseAmp = smoothPulse.current;

    // ── Stars ──
    for (let i = 0; i < STAR_COUNT; i++) {
      const bx = starBase[i * 3], by = starBase[i * 3 + 1], bz = starBase[i * 3 + 2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) + 0.001;

      let hWave = 0;
      if (hAct) {
        const dx = bx - hc.x, dy = by - hc.y, dz = bz - hc.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.35) {
          const dist = Math.sqrt(d2);
          hWave = Math.sin(dist * 20 - t * 7) * Math.exp(-dist * 3.5) * 0.22 * pulseAmp;
        }
      }

      let aWave = 0;
      if (audioAmp > 0.02) {
        aWave = Math.sin(bd * (7 + audioAmp * 6) - t * 4) * audioAmp * 0.08;
      }

      const tw = hWave + aWave;
      const tx = bx + (bx / bd) * tw * breath;
      const ty = by + (by / bd) * tw * breath;
      const tz = bz + (bz / bd) * tw * breath;
      const l = hAct ? 0.28 : audioAmp > 0.02 ? 0.14 : 0.012;
      starPos[i * 3] += (tx - starPos[i * 3]) * l;
      starPos[i * 3 + 1] += (ty - starPos[i * 3 + 1]) * l;
      starPos[i * 3 + 2] += (tz - starPos[i * 3 + 2]) * l;

      const boost = 1 + pulseAmp * 0.7 + audioAmp * 0.6;
      const baseSize = 0.045 + (1 - bd / BH_RADIUS) * 0.085;
      starSize[i] += (baseSize * boost - starSize[i]) * 0.06;
    }

    // ── Glow layer ──
    for (let i = 0; i < 4000; i++) {
      const bx = glowBase[i * 3], by = glowBase[i * 3 + 1], bz = glowBase[i * 3 + 2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) + 0.001;
      const aw = audioAmp > 0.02 ? Math.sin(bd * 6 - t * 3) * audioAmp * 0.1 : 0;
      const l2 = audioAmp > 0.02 ? 0.15 : 0.01;
      glowPos[i * 3] += ((bx + (bx / bd) * aw) - glowPos[i * 3]) * l2;
      glowPos[i * 3 + 1] += ((by + (by / bd) * aw) - glowPos[i * 3 + 1]) * l2;
      glowPos[i * 3 + 2] += ((bz + (bz / bd) * aw) - glowPos[i * 3 + 2]) * l2;
      const gs = 0.15 + Math.sin(bd * 3.5 - t * 1.2) * 0.05 * pulseAmp + 0.12 * audioAmp;
      glowSize[i] += (gs - glowSize[i]) * 0.05;
    }

    // ── Disk ──
    for (let i = 0; i < 5000; i++) {
      const bx = diskBase[i * 3], by = diskBase[i * 3 + 1], bz = diskBase[i * 3 + 2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) + 0.001;
      const aw = audioAmp > 0.02 ? Math.sin(bd * 8 - t * 4.5) * audioAmp * 0.12 : 0;
      diskPos[i * 3] += ((bx + (bx / bd) * aw) - diskPos[i * 3]) * 0.18;
      diskPos[i * 3 + 1] += (by - diskPos[i * 3 + 1]) * 0.08;
      diskPos[i * 3 + 2] += ((bz + (bz / bd) * aw) - diskPos[i * 3 + 2]) * 0.18;
      const heat = 1 - Math.min(1, (bd - BH_RADIUS * 0.15) / (BH_RADIUS * 0.85));
      diskSize[i] += ((0.045 + heat * 0.11) * (1 + audioAmp * 0.9) - diskSize[i]) * 0.05;
    }

    // Mark dirty
    const mark = (p: THREE.Points) => {
      p.geometry.attributes.position.needsUpdate = true;
      (p.geometry.attributes as any).size.needsUpdate = true;
    };
    mark(starsRef.current!);
    mark(glowRef.current!);
    mark(diskRef.current!);
  });

  return (
    <group>
      {/* Black hole core */}
      <mesh>
        <sphereGeometry args={[BH_RADIUS * 0.2, 20, 20]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Event horizon ring */}
      <mesh rotation={[0.15, 0.3, 0]}>
        <ringGeometry args={[BH_RADIUS * 0.18, BH_RADIUS * 0.45, 48]} />
        <meshBasicMaterial color="#ff4400" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* Central glow corona */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={1} array={new Float32Array([0, 0, 0])} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial map={wideGlow} size={BH_RADIUS * 2.0} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} color="#ff6633" sizeAttenuation />
      </points>

      {/* Accretion disk */}
      <points ref={diskRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={5000} array={diskPos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={5000} array={diskCol} itemSize={3} />
          <bufferAttribute attach="attributes-size" count={5000} array={diskSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={starSprite} size={0.07} vertexColors transparent opacity={0.75} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Stars */}
      <points ref={starsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={STAR_COUNT} array={starPos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={STAR_COUNT} array={starCol} itemSize={3} />
          <bufferAttribute attach="attributes-size" count={STAR_COUNT} array={starSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={starSprite} size={0.07} vertexColors transparent opacity={0.88} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Glow/halo layer */}
      <points ref={glowRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={4000} array={glowPos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={4000} array={glowCol} itemSize={3} />
          <bufferAttribute attach="attributes-size" count={4000} array={glowSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={glowSprite} size={0.22} vertexColors transparent opacity={0.3} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Ambient outer glow sphere */}
      <mesh>
        <sphereGeometry args={[BH_RADIUS * 1.8, 20, 20]} />
        <meshBasicMaterial color="#ff5522" transparent opacity={0.018} side={THREE.BackSide} />
      </mesh>

      {/* Audio shockwave ring */}
      <AudioShockwaveRing audio={smoothAudio} />

      {/* Hover indicator */}
      <HoverRing posRef={hoverPos} visible={showHover} />

      {/* Hit detection mesh — transparent but raycastable */}
      <mesh ref={hitRef} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        <sphereGeometry args={[BH_RADIUS, 32, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}

// ── Audio shockwave ring ──────────────────────────────────────────
function AudioShockwaveRing({ audio }: { audio: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const a = audio.current;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    const scale = 1 + a * 1.2;
    ref.current.scale.set(scale, scale, scale);
    mat.opacity = a * 0.25;
    ref.current.rotation.x = 0.1 + Math.sin(clock.getElapsedTime() * 0.02) * 0.05;
  });

  return (
    <mesh ref={ref}>
      <ringGeometry args={[BH_RADIUS * 0.9, BH_RADIUS * 0.95, 48]} />
      <meshBasicMaterial color="#ff8844" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ── Orbit ring ────────────────────────────────────────────────────
function OrbitRing({ radius, tilt, phase, color }: { radius: number; tilt: number; phase: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  const pts = useMemo(() => {
    const a: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) a.push(new THREE.Vector3(Math.cos(i / 48 * Math.PI * 2) * radius, 0, Math.sin(i / 48 * Math.PI * 2) * radius));
    return a;
  }, [radius]);
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints(pts), [pts]);

  useFrame(({ clock }) => {
    if (ref.current) { ref.current.rotation.x = tilt; ref.current.rotation.z = clock.getElapsedTime() * 0.02 + phase; }
  });

  return (
    <group ref={ref}>
      <line geometry={geom}><lineBasicMaterial color={color} transparent opacity={0.035} /></line>
    </group>
  );
}

// ── Public component ──────────────────────────────────────────────
interface GlobeAvatarProps {
  state: GlobeState;
  analyserNode?: AnalyserNode | null;
  size?: number;
}

export default function GlobeAvatar({ state, analyserNode, size = 280 }: GlobeAvatarProps) {
  const sc = state === "listening" ? 1.04 : state === "thinking" ? 0.96 : 1;

  return (
    <div style={{
      width: size, height: size, position: "relative",
      transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
      transform: `scale(${sc})`, cursor: "pointer",
    }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", position: "relative" }}>
        <Canvas
          dpr={[0.5, 1.5]}
          camera={{ position: [0, 0.3, 3.6], fov: 36, near: 0.1, far: 10 }}
          style={{ width: "100%", height: "100%" }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <BlackHoleScene state={state} analyserNode={analyserNode} />
          <OrbitRing radius={1.85} tilt={0.25} phase={0} color="#ff6622" />
        </Canvas>
      </div>
      <div style={{
        position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
        fontSize: 10, color: "var(--mute)", background: "var(--surface)", padding: "1px 10px",
        borderRadius: 8, whiteSpace: "nowrap", border: "1px solid var(--hairline)", lineHeight: 1.5, zIndex: 1,
      }}>
        {state === "idle" && "Tap mic to speak"}
        {state === "listening" && "Listening..."}
        {state === "thinking" && "Thinking..."}
        {state === "speaking" && "Speaking..."}
      </div>
    </div>
  );
}
