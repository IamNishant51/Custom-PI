import { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type GlobeState = "idle" | "listening" | "thinking" | "speaking";

const STAR_COUNT = 14000;
const BH_RADIUS = 1.2;

function glxColor(p: THREE.Vector3, r: number): THREE.Color {
  const angle = Math.atan2(p.z, p.x);
  const dist = r / 3.5;
  const t = (dist * 0.4 + angle * 0.08 + 0.5) % 1;
  const c = new THREE.Color();
  if (dist < 0.15) {
    c.setHSL(0.08 + dist * 0.5, 0.9, 0.4 + dist);
  } else if (t < 0.25) {
    c.setHSL(0.62 - dist * 0.08, 0.7, 0.4 + Math.random() * 0.3);
  } else if (t < 0.5) {
    c.setHSL(0.55 - dist * 0.1, 0.5, 0.3 + Math.random() * 0.4);
  } else if (t < 0.7) {
    c.setHSL(0.08 + Math.random() * 0.06, 0.8, 0.5 + Math.random() * 0.4);
  } else {
    c.setHSL(0.6 + Math.random() * 0.08, 0.4, 0.6 + Math.random() * 0.3);
  }
  const brightness = 1.0 + Math.random() * 0.8;
  c.multiplyScalar(brightness);
  return c;
}

function randomStar(r: number): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const rr = r * (0.5 + Math.random() * 0.5);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta) * rr,
    Math.sin(phi) * Math.sin(theta) * rr,
    Math.cos(phi) * rr,
  );
}

function accretionPos(r: number): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const rr = r * (0.35 + Math.random() * 0.65);
  const thickness = (Math.random() - 0.5) * 0.15 * rr;
  return new THREE.Vector3(
    Math.cos(theta) * rr,
    thickness,
    Math.sin(theta) * rr,
  );
}

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
  const hitMeshRef = useRef<THREE.Mesh>(null);

  const { pointer, camera } = useThree();

  const hoverCenter = useRef(new THREE.Vector3(0, 10, 0));
  const hoverActive = useRef(false);
  const hoverCount = useRef(0);
  const hoverBuf = useRef(new Uint16Array(2000));

  const smoothAudio = useRef(0);
  const smoothPulse = useRef(0);
  const breathePhase = useRef(0);
  const diskAngle = useRef(0);

  const { starBase, starPos, starSize, starCol, glowBase, glowPos, glowSize, glowCol, diskBase, diskPos, diskSize, diskCol } = useMemo(() => {
    const sb = new Float32Array(STAR_COUNT * 3);
    const sp = new Float32Array(STAR_COUNT * 3);
    const ss = new Float32Array(STAR_COUNT);
    const sc = new Float32Array(STAR_COUNT * 3);

    const gb = new Float32Array(4000 * 3);
    const gp = new Float32Array(4000 * 3);
    const gs = new Float32Array(4000);
    const gc = new Float32Array(4000 * 3);

    const db = new Float32Array(6000 * 3);
    const dp = new Float32Array(6000 * 3);
    const ds = new Float32Array(6000);
    const dc = new Float32Array(6000 * 3);

    for (let i = 0; i < STAR_COUNT; i++) {
      const p = randomStar(BH_RADIUS);
      sb[i * 3] = p.x; sb[i * 3 + 1] = p.y; sb[i * 3 + 2] = p.z;
      sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const c = glxColor(p, r);
      sc[i * 3] = c.r; sc[i * 3 + 1] = c.g; sc[i * 3 + 2] = c.b;
      ss[i] = 0.015 + (1 - r / BH_RADIUS) * 0.045 + Math.random() * 0.025;
    }

    for (let i = 0; i < 4000; i++) {
      const p = randomStar(BH_RADIUS * 0.6);
      gb[i * 3] = p.x; gb[i * 3 + 1] = p.y; gb[i * 3 + 2] = p.z;
      gp[i * 3] = p.x; gp[i * 3 + 1] = p.y; gp[i * 3 + 2] = p.z;
      const c = new THREE.Color("#ff8844");
      c.lerp(new THREE.Color("#ffcc66"), Math.random());
      c.multiplyScalar(1.8);
      gc[i * 3] = c.r; gc[i * 3 + 1] = c.g; gc[i * 3 + 2] = c.b;
      gs[i] = 0.04 + Math.random() * 0.08;
    }

    for (let i = 0; i < 6000; i++) {
      const p = accretionPos(BH_RADIUS);
      db[i * 3] = p.x; db[i * 3 + 1] = p.y; db[i * 3 + 2] = p.z;
      dp[i * 3] = p.x; dp[i * 3 + 1] = p.y; dp[i * 3 + 2] = p.z;
      const r = Math.sqrt(p.x * p.x + p.z * p.z);
      const heat = 1 - Math.min(1, (r - BH_RADIUS * 0.3) / (BH_RADIUS * 0.7));
      const c = new THREE.Color().setHSL(0.08 - heat * 0.05, 0.9, 0.5 + heat * 0.5);
      c.multiplyScalar(1.5 + heat * 0.8);
      dc[i * 3] = c.r; dc[i * 3 + 1] = c.g; dc[i * 3 + 2] = c.b;
      ds[i] = 0.02 + heat * 0.06 + Math.random() * 0.015;
    }

    return {
      starBase: sb, starPos: sp, starSize: ss, starCol: sc,
      glowBase: gb, glowPos: gp, glowSize: gs, glowCol: gc,
      diskBase: db, diskPos: dp, diskSize: ds, diskCol: dc,
    };
  }, []);

  const updateHoverIndices = useCallback((center: THREE.Vector3) => {
    const infl = 0.5;
    const buf = hoverBuf.current;
    let c = 0;
    for (let i = 0; i < STAR_COUNT && c < 2000; i++) {
      const dx = starBase[i * 3] - center.x;
      const dy = starBase[i * 3 + 1] - center.y;
      const dz = starBase[i * 3 + 2] - center.z;
      if (dx * dx + dy * dy + dz * dz < infl * infl) {
        buf[c++] = i;
      }
    }
    hoverCount.current = c;
  }, [starBase]);

  const onPointerMove = useCallback((e: any) => {
    hoverCenter.current.copy(e.point);
    hoverActive.current = true;
  }, []);

  const onPointerLeave = useCallback(() => {
    hoverActive.current = false;
    hoverCount.current = 0;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const dt = Math.min(clock.getDelta(), 0.05);

    // Audio
    let rawAudio = 0;
    if (state === "speaking" && analyserNode) {
      const d = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(d);
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i];
      rawAudio = Math.min(1, (s / d.length / 255) * 3.5);
    } else if (state === "speaking") {
      rawAudio = 0.25 + 0.2 * Math.sin(t * 5);
    }
    smoothAudio.current += (rawAudio - smoothAudio.current) * Math.min(1, dt * 15);

    let pulseTarget = 0.1;
    if (state === "listening") pulseTarget = 0.3 + 0.18 * Math.sin(t * 1.3);
    else if (state === "thinking") pulseTarget = 0.2 + 0.1 * Math.sin(t * 0.9);
    else if (state === "speaking") pulseTarget = 0.3 + 0.7 * smoothAudio.current;
    smoothPulse.current += (pulseTarget - smoothPulse.current) * 0.06;

    breathePhase.current += dt * 0.35;
    const breath = 1 + Math.sin(breathePhase.current) * 0.004;

    // Rotation
    if (starsRef.current) {
      starsRef.current.rotation.y = t * 0.045;
      starsRef.current.rotation.x = Math.sin(t * 0.015) * 0.03;
    }
    if (glowRef.current) {
      glowRef.current.rotation.y = t * 0.05;
      glowRef.current.rotation.x = Math.sin(t * 0.012) * 0.02;
    }
    diskAngle.current += dt * 0.3;
    if (diskRef.current) {
      diskRef.current.rotation.y = t * 0.15 + diskAngle.current;
      diskRef.current.rotation.x = 0.15;
    }

    // Hover
    if (hoverActive.current) {
      updateHoverIndices(hoverCenter.current);
    }

    const hc = hoverCenter.current;
    const hCount = hoverCount.current;
    const hBuf = hoverBuf.current;
    const audioAmp = smoothAudio.current;
    const pulseAmp = smoothPulse.current;

    // Update star positions
    for (let i = 0; i < STAR_COUNT; i++) {
      let hWave = 0;
      if (hCount > 0 && hoverActive.current) {
        for (let j = 0; j < hCount; j++) {
          if (hBuf[j] === i) {
            const dx = starBase[i * 3] - hc.x;
            const dy = starBase[i * 3 + 1] - hc.y;
            const dz = starBase[i * 3 + 2] - hc.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            hWave = Math.sin(dist * 22 - t * 6) * Math.exp(-dist * 3.8) * 0.1 * pulseAmp;
            break;
          }
        }
      }

      let aWave = 0;
      if (audioAmp > 0.02) {
        const bx = starBase[i * 3], by = starBase[i * 3 + 1], bz = starBase[i * 3 + 2];
        const bd = Math.sqrt(bx * bx + by * by + bz * bz) + 0.001;
        aWave = Math.sin(bd * (7 + audioAmp * 6) - t * 4) * audioAmp * 0.04;
      }

      const tw = hWave + aWave;
      const bx = starBase[i * 3], by = starBase[i * 3 + 1], bz = starBase[i * 3 + 2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) + 0.001;

      const tx = bx + (bx / bd) * tw * breath;
      const ty = by + (by / bd) * tw * breath;
      const tz = bz + (bz / bd) * tw * breath;

      const l = hoverActive.current ? 0.2 : audioAmp > 0.02 ? 0.1 : 0.012;
      starPos[i * 3] += (tx - starPos[i * 3]) * l;
      starPos[i * 3 + 1] += (ty - starPos[i * 3 + 1]) * l;
      starPos[i * 3 + 2] += (tz - starPos[i * 3 + 2]) * l;

      const boost = 1 + pulseAmp * 0.5 + audioAmp * 0.4;
      const baseSize = 0.015 + (1 - bd / BH_RADIUS) * 0.045;
      starSize[i] += (baseSize * boost - starSize[i]) * 0.04;
    }

    // Glow layer
    for (let i = 0; i < 4000; i++) {
      const bx = glowBase[i * 3], by = glowBase[i * 3 + 1], bz = glowBase[i * 3 + 2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) + 0.001;
      const aw = audioAmp > 0.02 ? Math.sin(bd * 8 - t * 3) * audioAmp * 0.05 : 0;
      const l = audioAmp > 0.02 ? 0.1 : 0.01;
      glowPos[i * 3] += ((bx + (bx / bd) * aw) - glowPos[i * 3]) * l;
      glowPos[i * 3 + 1] += ((by + (by / bd) * aw) - glowPos[i * 3 + 1]) * l;
      glowPos[i * 3 + 2] += ((bz + (bz / bd) * aw) - glowPos[i * 3 + 2]) * l;
      glowSize[i] += (0.04 + Math.sin(bd * 5 - t * 2) * 0.02 * pulseAmp + 0.06 * audioAmp - glowSize[i]) * 0.04;
    }

    // Accretion disk
    for (let i = 0; i < 6000; i++) {
      const bx = diskBase[i * 3], by = diskBase[i * 3 + 1], bz = diskBase[i * 3 + 2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) + 0.001;
      const aw = audioAmp > 0.02 ? Math.sin(bd * 10 - t * 5) * audioAmp * 0.06 : 0;
      diskPos[i * 3] += ((bx + (bx / bd) * aw) - diskPos[i * 3]) * 0.12;
      diskPos[i * 3 + 1] += (by - diskPos[i * 3 + 1]) * 0.06;
      diskPos[i * 3 + 2] += ((bz + (bz / bd) * aw) - diskPos[i * 3 + 2]) * 0.12;
      diskSize[i] += ((0.02 + (1 - Math.min(1, (bd - BH_RADIUS * 0.3) / (BH_RADIUS * 0.7))) * 0.06) * (1 + audioAmp * 0.6) - diskSize[i]) * 0.04;
    }

    starsRef.current!.geometry.attributes.position.needsUpdate = true;
    (starsRef.current!.geometry.attributes as any).size.needsUpdate = true;
    glowRef.current!.geometry.attributes.position.needsUpdate = true;
    (glowRef.current!.geometry.attributes as any).size.needsUpdate = true;
    diskRef.current!.geometry.attributes.position.needsUpdate = true;
    (diskRef.current!.geometry.attributes as any).size.needsUpdate = true;
  });

  return (
    <group>
      {/* Black hole core — dark sphere */}
      <mesh>
        <sphereGeometry args={[BH_RADIUS * 0.25, 24, 24]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Event horizon glow ring */}
      <mesh rotation={[0.2, 0, 0]}>
        <ringGeometry args={[BH_RADIUS * 0.22, BH_RADIUS * 0.35, 64]} />
        <meshBasicMaterial color="#ff4400" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>

      {/* Accretion disk */}
      <points ref={diskRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={6000} array={diskPos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={6000} array={diskCol} itemSize={3} />
          <bufferAttribute attach="attributes-size" count={6000} array={diskSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial size={0.035} vertexColors transparent opacity={0.7} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Star field */}
      <points ref={starsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={STAR_COUNT} array={starPos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={STAR_COUNT} array={starCol} itemSize={3} />
          <bufferAttribute attach="attributes-size" count={STAR_COUNT} array={starSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial size={0.03} vertexColors transparent opacity={0.85} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Glow/halo layer — large soft particles */}
      <points ref={glowRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={4000} array={glowPos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={4000} array={glowCol} itemSize={3} />
          <bufferAttribute attach="attributes-size" count={4000} array={glowSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial size={0.06} vertexColors transparent opacity={0.3} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Invisible hit mesh for hover */}
      <mesh ref={hitMeshRef} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} visible={false}>
        <sphereGeometry args={[BH_RADIUS, 32, 32]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}

function AccretionGlowRing({ state }: { state: GlobeState }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) {
      ref.current.rotation.x = 0.15 + Math.sin(t * 0.02) * 0.05;
      ref.current.rotation.z = Math.sin(t * 0.015) * 0.04;
      const mat = ref.current.material as THREE.MeshBasicMaterial;
      const p = state === "speaking" ? 0.12 + 0.1 * Math.sin(t * 2.5)
        : state === "listening" ? 0.08 + 0.04 * Math.sin(t * 1.2)
        : 0.035 + 0.015 * Math.sin(t * 0.6);
      mat.opacity = p;
    }
  });

  return (
    <mesh ref={ref} rotation={[0.15, 0.2, 0]}>
      <ringGeometry args={[1.4, 1.55, 64]} />
      <meshBasicMaterial color="#ff6622" transparent opacity={0.04} side={THREE.DoubleSide} />
    </mesh>
  );
}

function OrbitRing({ radius, tilt, phase, color, opacity }: { radius: number; tilt: number; phase: number; color: string; opacity?: number }) {
  const ref = useRef<THREE.Group>(null);

  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return pts;
  }, [radius]);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.x = tilt;
      ref.current.rotation.z = clock.getElapsedTime() * 0.025 + phase;
    }
  });

  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);

  return (
    <group ref={ref}>
      <line geometry={geom}>
        <lineBasicMaterial color={color} transparent opacity={opacity ?? 0.05} />
      </line>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 + phase;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, 0, Math.sin(a) * radius]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshBasicMaterial color={color} transparent opacity={(opacity ?? 0.05) * 2} />
          </mesh>
        );
      })}
    </group>
  );
}

interface GlobeAvatarProps {
  state: GlobeState;
  analyserNode?: AnalyserNode | null;
  size?: number;
}

export default function GlobeAvatar({ state, analyserNode, size = 280 }: GlobeAvatarProps) {
  const stateScale = state === "listening" ? 1.03 : state === "thinking" ? 0.97 : 1;

  return (
    <div
      style={{
        width: size, height: size, position: "relative",
        transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `scale(${stateScale})`,
        cursor: "pointer",
      }}
    >
      <div style={{
        width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden",
        position: "relative",
      }}>
        <Canvas
          dpr={[0.5, 1.5]}
          camera={{ position: [0, 0.3, 3.5], fov: 36, near: 0.1, far: 10 }}
          style={{ width: "100%", height: "100%" }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <BlackHoleScene state={state} analyserNode={analyserNode} />
          <AccretionGlowRing state={state} />
          <OrbitRing radius={1.75} tilt={0.3} phase={0} color="#ff6622" opacity={0.04} />
          <OrbitRing radius={2.0} tilt={-0.22} phase={1.8} color="#4488ff" opacity={0.03} />
        </Canvas>
      </div>

      <div style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "60%", height: "60%", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,68,0,0.04) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      <div style={{
        position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
        fontSize: 10, color: "var(--mute)", background: "var(--surface)", padding: "1px 10px",
        borderRadius: 8, whiteSpace: "nowrap", border: "1px solid var(--hairline)",
        lineHeight: 1.5, zIndex: 1,
      }}>
        {state === "idle" && "Tap mic to speak"}
        {state === "listening" && "Listening..."}
        {state === "thinking" && "Thinking..."}
        {state === "speaking" && "Speaking..."}
      </div>
    </div>
  );
}
