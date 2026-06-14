import { useRef, useMemo, useCallback, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type GlobeState = "idle" | "listening" | "thinking" | "speaking";

const STAR_COUNT = 8000;
const GLOW_COUNT = 2000;
const DISK_COUNT = 12000;
const BH_RADIUS = 0.8;
const DISK_INNER = 0.9;
const DISK_OUTER = 3.5;

// ── Anime Style Sprites (Harder edges, stylized) ──────────────────────
function makeAnimeSprite(inner = 0, colorStops: { stop: number; color: string }[]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, inner * 128, 128, 128, 128);
  for (const { stop, color } of colorStops) {
    g.addColorStop(stop, color);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const starSprite = makeAnimeSprite(0, [
  { stop: 0, color: "rgba(255,255,255,1)" },
  { stop: 0.15, color: "rgba(255,255,255,0.9)" }, // Harder core
  { stop: 0.3, color: "rgba(255,100,200,0.5)" },  // Anime pink/magenta halo
  { stop: 1, color: "rgba(0,0,0,0)" }
]);

const glowSprite = makeAnimeSprite(0, [
  { stop: 0, color: "rgba(200,255,255,0.8)" },
  { stop: 0.2, color: "rgba(100,200,255,0.5)" },
  { stop: 0.5, color: "rgba(255,100,255,0.1)" },
  { stop: 1, color: "rgba(0,0,0,0)" }
]);

const wideGlow = makeAnimeSprite(0, [
  { stop: 0, color: "rgba(255,100,255,0.4)" },
  { stop: 0.4, color: "rgba(100,200,255,0.15)" },
  { stop: 0.8, color: "rgba(50,50,200,0.05)" },
  { stop: 1, color: "rgba(0,0,0,0)" }
]);

// ── Position helpers ──────────────────────────────────────────────
function randomSpherePos(r: number): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const rr = r * Math.cbrt(Math.random()); 
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta) * rr,
    Math.sin(phi) * Math.sin(theta) * rr,
    Math.cos(phi) * rr,
  );
}

function randomDiskPos(inner: number, outer: number): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const r = inner + Math.pow(Math.random(), 3) * (outer - inner);
  const y = (Math.random() - 0.5) * 0.05 * (r - inner + 0.1); // Flatter disk for anime style
  return new THREE.Vector3(
    Math.cos(theta) * r,
    y,
    Math.sin(theta) * r,
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

  const smoothAudio = useRef(0);
  const smoothPulse = useRef(0);
  const diskAngle = useRef(0);

  const { pointer, camera } = useThree();

  // Particle data
  const { 
    starBase, starPos, starSize, starCol, starBaseSize, starBaseDist,
    glowBase, glowPos, glowSize, glowCol, glowBaseSize, glowBaseDist,
    diskBase, diskPos, diskSize, diskCol, diskBaseSize, diskBaseDist
  } = useMemo(() => {
    const Ns = STAR_COUNT, Ng = GLOW_COUNT, Nd = DISK_COUNT;

    const sb = new Float32Array(Ns * 3), sp = new Float32Array(Ns * 3), ss = new Float32Array(Ns), sc = new Float32Array(Ns * 3), sbs = new Float32Array(Ns), sbd = new Float32Array(Ns);
    const gb = new Float32Array(Ng * 3), gp = new Float32Array(Ng * 3), gs = new Float32Array(Ng), gc = new Float32Array(Ng * 3), gbs = new Float32Array(Ng), gbd = new Float32Array(Ng);
    const db = new Float32Array(Nd * 3), dp = new Float32Array(Nd * 3), ds = new Float32Array(Nd), dc = new Float32Array(Nd * 3), dbs = new Float32Array(Nd), dbd = new Float32Array(Nd);

    // Stars/Nebula (Anime magic particles)
    for (let i = 0; i < Ns; i++) {
      const p = randomSpherePos(DISK_OUTER * 1.5);
      sb[i * 3] = p.x; sb[i * 3 + 1] = p.y; sb[i * 3 + 2] = p.z;
      sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      sbd[i] = r + 0.001;
      
      const c = new THREE.Color();
      if (r < BH_RADIUS) {
         c.setRGB(0, 0, 0);
      } else {
         // Vibrant Anime Pink/Cyan/Purple
         if (Math.random() > 0.5) {
           c.setHSL(0.5 + Math.random() * 0.1, 1.0, 0.7); // Cyan
         } else {
           c.setHSL(0.8 + Math.random() * 0.1, 1.0, 0.6); // Magenta
         }
      }
      sc[i * 3] = c.r; sc[i * 3 + 1] = c.g; sc[i * 3 + 2] = c.b;
      sbs[i] = 0.05 + Math.random() * 0.08;
      ss[i] = sbs[i];
    }

    // Glow Layer
    for (let i = 0; i < Ng; i++) {
      const p = randomSpherePos(BH_RADIUS * 2.0);
      gb[i * 3] = p.x; gb[i * 3 + 1] = p.y; gb[i * 3 + 2] = p.z;
      gp[i * 3] = p.x; gp[i * 3 + 1] = p.y; gp[i * 3 + 2] = p.z;
      gbd[i] = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) + 0.001;

      const c = new THREE.Color("#00ffff").lerp(new THREE.Color("#ff00ff"), Math.random());
      c.multiplyScalar(2.0); // Super bright
      gc[i * 3] = c.r; gc[i * 3 + 1] = c.g; gc[i * 3 + 2] = c.b;
      gbs[i] = 0.2 + Math.random() * 0.4;
      gs[i] = gbs[i];
    }

    // Accretion Disk (Vibrant Anime Rings)
    for (let i = 0; i < Nd; i++) {
      const p = randomDiskPos(DISK_INNER, DISK_OUTER);
      db[i * 3] = p.x; db[i * 3 + 1] = p.y; db[i * 3 + 2] = p.z;
      dp[i * 3] = p.x; dp[i * 3 + 1] = p.y; dp[i * 3 + 2] = p.z;
      dbd[i] = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) + 0.001;

      const r = Math.sqrt(p.x * p.x + p.z * p.z);
      const t = (r - DISK_INNER) / (DISK_OUTER - DISK_INNER);
      
      const c = new THREE.Color();
      if (t < 0.15) {
        c.setHSL(0.85, 1.0, 0.8); // Hot pink inner edge
        c.multiplyScalar(3.0);
      } else if (t < 0.5) {
        c.setHSL(0.55, 1.0, 0.6); // Electric blue/cyan middle
        c.multiplyScalar(2.0);
      } else {
        c.setHSL(0.7, 1.0, 0.4); // Deep violet outer
        c.multiplyScalar(1.2);
      }

      dc[i * 3] = c.r; dc[i * 3 + 1] = c.g; dc[i * 3 + 2] = c.b;
      const heat = 1 - Math.min(1, (r - DISK_INNER) / (DISK_OUTER - DISK_INNER));
      dbs[i] = 0.05 + heat * 0.08 + Math.random() * 0.04;
      ds[i] = dbs[i];
    }

    return { 
      starBase: sb, starPos: sp, starSize: ss, starCol: sc, starBaseSize: sbs, starBaseDist: sbd,
      glowBase: gb, glowPos: gp, glowSize: gs, glowCol: gc, glowBaseSize: gbs, glowBaseDist: gbd,
      diskBase: db, diskPos: dp, diskSize: ds, diskCol: dc, diskBaseSize: dbs, diskBaseDist: dbd 
    };
  }, []);

  // ── Events ──
  const onPointerMove = useCallback((e: any) => {
    hoverPos.current.copy(e.point);
    hoverActive.current = true;
  }, []);

  const onPointerLeave = useCallback(() => {
    hoverActive.current = false;
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

    let pTarget = 0.15;
    if (state === "listening") pTarget = 0.4 + 0.25 * Math.sin(t * 2.0);
    else if (state === "thinking") pTarget = 0.4 + 0.3 * Math.sin(t * 12.0); // Fast intense heartbeat pulse
    else if (state === "speaking") pTarget = 0.5 + 1.2 * smoothAudio.current;
    smoothPulse.current += (pTarget - smoothPulse.current) * 0.1;

    // Rotation (Anime disk spins a bit faster)
    const starRotY = t * 0.03, starRotX = Math.sin(t * 0.005) * 0.02;
    let diskRotSpeed = 0.2 + smoothAudio.current * 0.4;
    if (state === "thinking") {
      diskRotSpeed += 2.0; // Visibly spin much faster while processing
    }
    diskAngle.current += dt * diskRotSpeed;

    if (starsRef.current) {
      starsRef.current.rotation.y = starRotY;
      starsRef.current.rotation.x = starRotX;
    }
    if (glowRef.current) {
      glowRef.current.rotation.y = t * 0.04;
      glowRef.current.rotation.x = Math.sin(t * 0.01) * 0.02;
    }
    if (diskRef.current) {
      diskRef.current.rotation.y = diskAngle.current;
      diskRef.current.rotation.x = 0.2 + Math.sin(t * 0.01) * 0.03;
    }

    const hc = hoverPos.current;
    const hAct = hoverActive.current;
    const audioAmp = smoothAudio.current;
    const pulseAmp = smoothPulse.current;

    // Apply ripple to mouse and audio waves
    const applyParticlePhysics = (
      i: number,
      base: Float32Array,
      pos: Float32Array,
      baseDist: Float32Array,
      isDisk: boolean
    ) => {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const bd = baseDist[i];

      let tx = bx, ty = by, tz = bz;
      let sMult = 1.0;

      // Ripple to mouse
      if (hAct) {
        const dx = hc.x - bx, dy = hc.y - by, dz = hc.z - bz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist < 2.5) {
          const pull = Math.pow(Math.max(0, 1 - dist / 2.5), 2);
          const ripple = Math.sin(dist * 12 + t * 15) * 0.2 * pull;
          
          tx += dx * pull * 0.2 + (dx / dist) * ripple;
          ty += dy * pull * 0.2 + (dy / dist) * ripple;
          tz += dz * pull * 0.2 + (dz / dist) * ripple;
          
          sMult += pull * 0.8 + ripple;
        }
      }

      // Audio reactive
      if (audioAmp > 0.01) {
        const aWave = Math.sin(bd * 8 - t * 6) * audioAmp * (isDisk ? 0.2 : 0.1);
        tx += (bx / bd) * aWave;
        ty += (by / bd) * aWave;
        tz += (bz / bd) * aWave;
        sMult += audioAmp * 1.0;
      }

      sMult += pulseAmp * 0.3;

      const l = 0.15;
      pos[i * 3] += (tx - pos[i * 3]) * l;
      pos[i * 3 + 1] += (ty - pos[i * 3 + 1]) * l;
      pos[i * 3 + 2] += (tz - pos[i * 3 + 2]) * l;

      return sMult;
    };

    // ── Stars ──
    for (let i = 0; i < STAR_COUNT; i++) {
      const sMult = applyParticlePhysics(i, starBase, starPos, starBaseDist, false);
      starSize[i] = starBaseSize[i] * sMult;
    }

    // ── Glow layer ──
    for (let i = 0; i < GLOW_COUNT; i++) {
      const sMult = applyParticlePhysics(i, glowBase, glowPos, glowBaseDist, false);
      glowSize[i] = glowBaseSize[i] * sMult;
    }

    // ── Disk ──
    for (let i = 0; i < DISK_COUNT; i++) {
      const sMult = applyParticlePhysics(i, diskBase, diskPos, diskBaseDist, true);
      diskSize[i] = diskBaseSize[i] * sMult;
    }

    // Mark dirty
    const mark = (p: THREE.Points) => {
      p.geometry.attributes.position.needsUpdate = true;
      (p.geometry.attributes as any).size.needsUpdate = true;
    };
    if (starsRef.current) mark(starsRef.current);
    if (glowRef.current) mark(glowRef.current);
    if (diskRef.current) mark(diskRef.current);
  });

  return (
    <group>
      {/* Black hole core (Pitch Black Event Horizon) */}
      <mesh>
        <sphereGeometry args={[BH_RADIUS * 0.95, 64, 64]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Vibrant Anime Glow Planes */}
      <points>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={1} array={new Float32Array([0, 0, 0])} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial map={wideGlow} size={BH_RADIUS * 5.0} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} color="#ff00ff" sizeAttenuation />
      </points>
      <points>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={1} array={new Float32Array([0, 0, 0])} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial map={wideGlow} size={BH_RADIUS * 9.0} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} color="#00ffff" sizeAttenuation />
      </points>

      {/* Inner photon ring (Bright cyan/white) */}
      <mesh rotation={[0, 0, 0]}>
        <ringGeometry args={[BH_RADIUS * 0.98, BH_RADIUS * 1.05, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Accretion disk */}
      <points ref={diskRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={DISK_COUNT} array={diskPos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={DISK_COUNT} array={diskCol} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={DISK_COUNT} array={diskSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={starSprite} size={0.07} vertexColors transparent opacity={0.9} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Stars/Nebula */}
      <points ref={starsRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={STAR_COUNT} array={starPos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={STAR_COUNT} array={starCol} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={STAR_COUNT} array={starSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={starSprite} size={0.08} vertexColors transparent opacity={0.7} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Glow layer */}
      <points ref={glowRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={GLOW_COUNT} array={glowPos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={GLOW_COUNT} array={glowCol} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={GLOW_COUNT} array={glowSize} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={glowSprite} size={0.35} vertexColors transparent opacity={0.5} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Hit detection mesh — transparent but raycastable */}
      <mesh ref={hitRef} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        <sphereGeometry args={[DISK_OUTER, 32, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}

// ── Public component ──────────────────────────────────────────────
interface GlobeAvatarProps {
  state: GlobeState;
  analyserNode?: AnalyserNode | null;
  size?: number | string;
}

export default function GlobeAvatar({ state, analyserNode, size = 320 }: GlobeAvatarProps) {
  const sc = state === "listening" ? 1.05 : state === "thinking" ? 0.98 : 1;

  return (
    <div style={{
      width: size, height: size, position: "relative",
      transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
      transform: `scale(${sc})`, cursor: "pointer",
    }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "visible", position: "relative" }}>
        <Canvas
          dpr={[1, 2]} // Better resolution
          camera={{ position: [0, 1.2, 4.5], fov: 45, near: 0.1, far: 20 }}
          style={{ width: "100%", height: "100%", overflow: "visible" }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <BlackHoleScene state={state} analyserNode={analyserNode} />
        </Canvas>
      </div>
    </div>
  );
}
