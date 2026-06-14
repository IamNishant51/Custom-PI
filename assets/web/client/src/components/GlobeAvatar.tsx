import { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type GlobeState = "idle" | "listening" | "thinking" | "speaking";

const STAR_COUNT = 8000;
const GLOW_COUNT = 2500;
const DISK_COUNT = 14000;
const JET_COUNT = 1200;
const BH_RADIUS = 0.8;
const DISK_INNER = 0.95;
const DISK_OUTER = 3.8;

// ── Sprite Textures ──────────────────────────────────────────────
function makeSprite(colorStops: { stop: number; color: string }[]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const { stop, color } of colorStops) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const starSprite = makeSprite([
  { stop: 0, color: "rgba(255,255,255,1)" },
  { stop: 0.12, color: "rgba(255,255,255,0.9)" },
  { stop: 0.3, color: "rgba(255,120,220,0.45)" },
  { stop: 1, color: "rgba(0,0,0,0)" },
]);

const glowSprite = makeSprite([
  { stop: 0, color: "rgba(220,255,255,0.85)" },
  { stop: 0.2, color: "rgba(120,200,255,0.5)" },
  { stop: 0.5, color: "rgba(255,120,255,0.12)" },
  { stop: 1, color: "rgba(0,0,0,0)" },
]);

const softGlow = makeSprite([
  { stop: 0, color: "rgba(255,140,255,0.5)" },
  { stop: 0.3, color: "rgba(120,180,255,0.2)" },
  { stop: 0.7, color: "rgba(80,60,200,0.06)" },
  { stop: 1, color: "rgba(0,0,0,0)" },
]);

const jetSprite = makeSprite([
  { stop: 0, color: "rgba(200,220,255,1)" },
  { stop: 0.15, color: "rgba(140,180,255,0.7)" },
  { stop: 0.4, color: "rgba(180,120,255,0.3)" },
  { stop: 1, color: "rgba(0,0,0,0)" },
]);

// ── Position helpers ──────────────────────────────────────────────
function randomSpherePos(r: number): [number, number, number] {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const rr = r * Math.cbrt(Math.random());
  return [
    Math.sin(phi) * Math.cos(theta) * rr,
    Math.sin(phi) * Math.sin(theta) * rr,
    Math.cos(phi) * rr,
  ];
}

function randomDiskPos(inner: number, outer: number): [number, number, number] {
  const theta = Math.random() * Math.PI * 2;
  const r = inner + Math.pow(Math.random(), 2.5) * (outer - inner);
  const y = (Math.random() - 0.5) * 0.04 * (r - inner + 0.1);
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
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
  const jetTopRef = useRef<THREE.Points>(null);
  const jetBotRef = useRef<THREE.Points>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);

  const hitRef = useRef<THREE.Mesh>(null);
  const hoverPos = useRef(new THREE.Vector3(0, 10, 0));
  const hoverActive = useRef(false);

  const smoothAudio = useRef(0);
  const smoothPulse = useRef(0);
  const diskAngle = useRef(0);
  const prevTime = useRef(0);
  const thinkIntensity = useRef(0);

  const { pointer, camera } = useThree();

  // ── Build particle data ──
  const data = useMemo(() => {
    const mk = (n: number) => ({
      base: new Float32Array(n * 3),
      pos: new Float32Array(n * 3),
      size: new Float32Array(n),
      col: new Float32Array(n * 3),
      baseSize: new Float32Array(n),
      baseDist: new Float32Array(n),
      vel: new Float32Array(n), // per-particle velocity factor
    });

    const stars = mk(STAR_COUNT);
    const glow = mk(GLOW_COUNT);
    const disk = mk(DISK_COUNT);
    const jetT = mk(JET_COUNT);
    const jetB = mk(JET_COUNT);

    // ── Stars (nebula background) ──
    for (let i = 0; i < STAR_COUNT; i++) {
      const [x, y, z] = randomSpherePos(DISK_OUTER * 1.6);
      const i3 = i * 3;
      stars.base[i3] = x; stars.base[i3 + 1] = y; stars.base[i3 + 2] = z;
      stars.pos[i3] = x; stars.pos[i3 + 1] = y; stars.pos[i3 + 2] = z;
      const r = Math.sqrt(x * x + y * y + z * z);
      stars.baseDist[i] = r + 0.001;
      stars.vel[i] = 0.5 + Math.random();

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
      stars.col[i3] = c.r; stars.col[i3 + 1] = c.g; stars.col[i3 + 2] = c.b;
      stars.baseSize[i] = 0.04 + Math.random() * 0.07;
      stars.size[i] = stars.baseSize[i];
    }

    // ── Glow cloud (around event horizon) ──
    for (let i = 0; i < GLOW_COUNT; i++) {
      const [x, y, z] = randomSpherePos(BH_RADIUS * 2.2);
      const i3 = i * 3;
      glow.base[i3] = x; glow.base[i3 + 1] = y; glow.base[i3 + 2] = z;
      glow.pos[i3] = x; glow.pos[i3 + 1] = y; glow.pos[i3 + 2] = z;
      glow.baseDist[i] = Math.sqrt(x * x + y * y + z * z) + 0.001;
      glow.vel[i] = 0.3 + Math.random() * 0.7;

      const c = new THREE.Color("#00ffff").lerp(new THREE.Color("#ff00ff"), Math.random());
      c.multiplyScalar(2.2);
      glow.col[i3] = c.r; glow.col[i3 + 1] = c.g; glow.col[i3 + 2] = c.b;
      glow.baseSize[i] = 0.15 + Math.random() * 0.35;
      glow.size[i] = glow.baseSize[i];
    }

    // ── Accretion disk ──
    for (let i = 0; i < DISK_COUNT; i++) {
      const [x, y, z] = randomDiskPos(DISK_INNER, DISK_OUTER);
      const i3 = i * 3;
      disk.base[i3] = x; disk.base[i3 + 1] = y; disk.base[i3 + 2] = z;
      disk.pos[i3] = x; disk.pos[i3 + 1] = y; disk.pos[i3 + 2] = z;
      disk.baseDist[i] = Math.sqrt(x * x + y * y + z * z) + 0.001;

      const rr = Math.sqrt(x * x + z * z);
      const t = (rr - DISK_INNER) / (DISK_OUTER - DISK_INNER);
      // Kepler: inner orbits faster
      disk.vel[i] = 1 / Math.pow(rr / DISK_INNER, 1.5);

      const c = new THREE.Color();
      if (t < 0.15) {
        c.setHSL(0.85, 1.0, 0.8);   // Hot pink inner edge
        c.multiplyScalar(3.0);
      } else if (t < 0.5) {
        c.setHSL(0.55, 1.0, 0.6);   // Electric blue/cyan middle
        c.multiplyScalar(2.0);
      } else {
        c.setHSL(0.7, 1.0, 0.4);   // Deep violet outer
        c.multiplyScalar(1.2);
      }
      disk.col[i3] = c.r; disk.col[i3 + 1] = c.g; disk.col[i3 + 2] = c.b;

      const heat = 1 - Math.min(1, t);
      disk.baseSize[i] = 0.03 + heat * 0.07 + Math.random() * 0.03;
      disk.size[i] = disk.baseSize[i];
    }

    // ── Relativistic jets (top & bottom polar beams) ──
    const initJet = (jet: ReturnType<typeof mk>, dir: number) => {
      for (let i = 0; i < JET_COUNT; i++) {
        const height = (Math.pow(Math.random(), 1.5)) * 3.5 * dir;
        const spread = (0.02 + Math.abs(height) * 0.08) * (0.5 + Math.random());
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * spread;
        const z = Math.sin(theta) * spread;
        const i3 = i * 3;
        jet.base[i3] = x; jet.base[i3 + 1] = height; jet.base[i3 + 2] = z;
        jet.pos[i3] = x; jet.pos[i3 + 1] = height; jet.pos[i3 + 2] = z;
        jet.baseDist[i] = Math.abs(height) + 0.001;
        jet.vel[i] = 2 + Math.random() * 4;

        const distNorm = Math.abs(height) / 3.5;
        const c = new THREE.Color();
        if (distNorm < 0.15) {
          c.setHSL(0.55, 1.0, 0.8);   // Bright cyan
          c.multiplyScalar(3.0);
        } else if (distNorm < 0.5) {
          c.setHSL(0.85, 1.0, 0.6);    // Hot pink mid
          c.multiplyScalar(2.0);
        } else {
          c.setHSL(0.7, 1.0, 0.4);    // Deep violet
          c.multiplyScalar(1.0);
        }
        jet.col[i3] = c.r; jet.col[i3 + 1] = c.g; jet.col[i3 + 2] = c.b;
        jet.baseSize[i] = 0.06 + (1 - distNorm) * 0.12;
        jet.size[i] = jet.baseSize[i];
      }
    };
    initJet(jetT, 1);
    initJet(jetB, -1);

    return { stars, glow, disk, jetT, jetB };
  }, []);

  // ── Events ──
  const onPointerMove = useCallback((e: any) => {
    hoverPos.current.copy(e.point);
    hoverActive.current = true;
  }, []);

  const onPointerLeave = useCallback(() => {
    hoverActive.current = false;
  }, []);

  // ── Per-frame animation ──
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const dt = prevTime.current === 0 ? 0.016 : Math.min(t - prevTime.current, 0.05);
    prevTime.current = t;

    // ── Audio analysis ──
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
    smoothAudio.current += (rawAudio - smoothAudio.current) * Math.min(1, dt * 18);

    // ── Pulse target ──
    let pTarget = 0.12;
    if (state === "listening") pTarget = 0.35 + 0.2 * Math.sin(t * 2.0);
    else if (state === "thinking") pTarget = 0.3 + 0.25 * Math.sin(t * 10.0);
    else if (state === "speaking") pTarget = 0.4 + 1.0 * smoothAudio.current;
    smoothPulse.current += (pTarget - smoothPulse.current) * 0.12;

    // ── Thinking intensity (smooth ramp up/down) ──
    const thinkTarget = state === "thinking" ? 1 : 0;
    thinkIntensity.current += (thinkTarget - thinkIntensity.current) * dt * 3;
    const thi = thinkIntensity.current;

    // ── Disk rotation (Keplerian feel) ──
    let diskRotSpeed = 0.15 + smoothAudio.current * 0.35;
    diskRotSpeed += thi * 1.8; // Faster while thinking
    diskAngle.current += dt * diskRotSpeed;

    // ── Group rotations ──
    const starRotY = t * 0.025;
    const starRotX = Math.sin(t * 0.004) * 0.015;

    if (starsRef.current) {
      starsRef.current.rotation.y = starRotY;
      starsRef.current.rotation.x = starRotX;
    }
    if (glowRef.current) {
      glowRef.current.rotation.y = t * 0.035;
      glowRef.current.rotation.x = Math.sin(t * 0.008) * 0.015;
    }
    if (diskRef.current) {
      diskRef.current.rotation.y = diskAngle.current;
      diskRef.current.rotation.x = 0.22 + Math.sin(t * 0.008) * 0.02;
    }

    // ── Photon ring pulse ──
    if (ringRef.current) {
      const ringMat = ringRef.current.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.4 + smoothPulse.current * 0.4 + thi * 0.2;
      ringRef.current.rotation.x = 0.22 + Math.sin(t * 0.008) * 0.02;
      ringRef.current.rotation.y = diskAngle.current;
    }
    if (ring2Ref.current) {
      const ringMat = ring2Ref.current.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.2 + smoothPulse.current * 0.25 + thi * 0.15;
      ring2Ref.current.rotation.x = 0.22 + Math.sin(t * 0.008) * 0.02;
      ring2Ref.current.rotation.y = diskAngle.current;
    }

    const hc = hoverPos.current;
    const hAct = hoverActive.current;
    const audioAmp = smoothAudio.current;
    const pulseAmp = smoothPulse.current;

    // ── Shared particle physics ──
    const applyPhysics = (
      i: number,
      base: Float32Array,
      pos: Float32Array,
      baseDist: Float32Array,
      isDisk: boolean,
    ): number => {
      const i3 = i * 3;
      const bx = base[i3], by = base[i3 + 1], bz = base[i3 + 2];
      const bd = baseDist[i];

      let tx = bx, ty = by, tz = bz;
      let sMult = 1.0;

      // ── Mouse ripple ──
      if (hAct) {
        const dx = hc.x - bx, dy = hc.y - by, dz = hc.z - bz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 6.25) { // 2.5^2
          const dist = Math.sqrt(distSq);
          const pull = Math.pow(Math.max(0, 1 - dist / 2.5), 2);
          const ripple = Math.sin(dist * 10 - t * 12) * 0.15 * pull;
          const invD = 1 / (dist + 0.001);

          tx += dx * pull * 0.15 + dx * invD * ripple;
          ty += dy * pull * 0.15 + dy * invD * ripple;
          tz += dz * pull * 0.15 + dz * invD * ripple;
          sMult += pull * 0.6 + Math.abs(ripple) * 2;
        }
      }

      // ── Audio reactive wave ──
      if (audioAmp > 0.01) {
        const wave = Math.sin(bd * 7 - t * 5.5) * audioAmp * (isDisk ? 0.15 : 0.08);
        const invBd = 1 / bd;
        tx += bx * invBd * wave;
        ty += by * invBd * wave;
        tz += bz * invBd * wave;
        sMult += audioAmp * 0.8;
      }

      // ── Thinking shockwave ──
      if (thi > 0.01) {
        const shockRadius = ((t * 3) % 4.0); // Repeating expanding ring
        const distFromShock = Math.abs(bd - shockRadius);
        if (distFromShock < 0.6) {
          const shockAmt = (1 - distFromShock / 0.6) * thi * 0.15;
          const invBd = 1 / bd;
          tx += bx * invBd * shockAmt;
          ty += by * invBd * shockAmt;
          tz += bz * invBd * shockAmt;
          sMult += (1 - distFromShock / 0.6) * thi * 1.5;
        }
      }

      sMult += pulseAmp * 0.25;

      // Smooth interpolation
      const lerp = 0.12;
      pos[i3] += (tx - pos[i3]) * lerp;
      pos[i3 + 1] += (ty - pos[i3 + 1]) * lerp;
      pos[i3 + 2] += (tz - pos[i3 + 2]) * lerp;

      return sMult;
    };

    // ── Update Stars ──
    const { stars, glow, disk, jetT, jetB } = data;
    for (let i = 0; i < STAR_COUNT; i++) {
      const sMult = applyPhysics(i, stars.base, stars.pos, stars.baseDist, false);
      // Twinkle
      const twinkle = 0.7 + 0.3 * Math.sin(t * (2 + stars.vel[i] * 2) + i * 1.7);
      stars.size[i] = stars.baseSize[i] * sMult * twinkle;
    }

    // ── Update Glow ──
    for (let i = 0; i < GLOW_COUNT; i++) {
      const sMult = applyPhysics(i, glow.base, glow.pos, glow.baseDist, false);
      const breathe = 0.8 + 0.2 * Math.sin(t * 1.5 + i * 0.5);
      glow.size[i] = glow.baseSize[i] * sMult * breathe;
    }

    // ── Update Disk ──
    for (let i = 0; i < DISK_COUNT; i++) {
      const sMult = applyPhysics(i, disk.base, disk.pos, disk.baseDist, true);
      disk.size[i] = disk.baseSize[i] * sMult;
    }

    // ── Update Jets ──
    const jetAlpha = 0.3 + thi * 0.7 + audioAmp * 0.3;
    const updateJet = (jet: typeof jetT, ref: React.RefObject<THREE.Points | null>, dir: number) => {
      for (let i = 0; i < JET_COUNT; i++) {
        const i3 = i * 3;
        let by = jet.base[i3 + 1];
        // Animate jet particles flowing outward
        const speed = jet.vel[i] * (0.5 + thi * 2.5 + audioAmp * 1.5);
        let newY = by + dt * speed * dir * 0.3;
        // Wrap around when too far
        const maxH = 3.5 * dir;
        if (dir > 0 && newY > maxH) newY = 0.1;
        if (dir < 0 && newY < maxH) newY = -0.1;
        jet.base[i3 + 1] = newY;

        const absH = Math.abs(newY);
        const spread = (0.02 + absH * 0.08);
        // Slight spiral
        const angle = Math.atan2(jet.base[i3 + 2], jet.base[i3]) + dt * 2;
        jet.base[i3] = Math.cos(angle) * spread;
        jet.base[i3 + 2] = Math.sin(angle) * spread;

        jet.pos[i3] += (jet.base[i3] - jet.pos[i3]) * 0.2;
        jet.pos[i3 + 1] += (jet.base[i3 + 1] - jet.pos[i3 + 1]) * 0.2;
        jet.pos[i3 + 2] += (jet.base[i3 + 2] - jet.pos[i3 + 2]) * 0.2;

        const distNorm = absH / 3.5;
        jet.size[i] = jet.baseSize[i] * (1 - distNorm * 0.6) * jetAlpha;
      }
      if (ref.current) {
        ref.current.geometry.attributes.position.needsUpdate = true;
        (ref.current.geometry.attributes as any).size.needsUpdate = true;
        const mat = ref.current.material as THREE.PointsMaterial;
        mat.opacity = jetAlpha * 0.7;
      }
    };
    updateJet(jetT, jetTopRef, 1);
    updateJet(jetB, jetBotRef, -1);

    // ── Mark dirty ──
    const mark = (p: THREE.Points | null) => {
      if (!p) return;
      p.geometry.attributes.position.needsUpdate = true;
      (p.geometry.attributes as any).size.needsUpdate = true;
    };
    mark(starsRef.current);
    mark(glowRef.current);
    mark(diskRef.current);
  });

  const { stars, glow, disk, jetT, jetB } = data;

  return (
    <group>
      {/* Black hole event horizon */}
      <mesh>
        <sphereGeometry args={[BH_RADIUS * 0.95, 64, 64]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Wide soft glow halos */}
      <points>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={1} array={new Float32Array([0, 0, 0])} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial map={softGlow} size={BH_RADIUS * 5.5} transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} color="#ff40ff" sizeAttenuation />
      </points>
      <points>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={1} array={new Float32Array([0, 0, 0])} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial map={softGlow} size={BH_RADIUS * 10} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} color="#40ddff" sizeAttenuation />
      </points>

      {/* Photon ring (inner bright ring) */}
      <mesh ref={ringRef}>
        <ringGeometry args={[BH_RADIUS * 0.97, BH_RADIUS * 1.06, 128]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Second photon ring (slightly wider, colored) */}
      <mesh ref={ring2Ref}>
        <ringGeometry args={[BH_RADIUS * 1.05, BH_RADIUS * 1.18, 128]} />
        <meshBasicMaterial color="#cc80ff" transparent opacity={0.25} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Accretion disk */}
      <points ref={diskRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={DISK_COUNT} array={disk.pos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={DISK_COUNT} array={disk.col} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={DISK_COUNT} array={disk.size} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={starSprite} size={0.06} vertexColors transparent opacity={0.85} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Stars / Nebula */}
      <points ref={starsRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={STAR_COUNT} array={stars.pos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={STAR_COUNT} array={stars.col} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={STAR_COUNT} array={stars.size} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={starSprite} size={0.07} vertexColors transparent opacity={0.7} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Glow cloud */}
      <points ref={glowRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={GLOW_COUNT} array={glow.pos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={GLOW_COUNT} array={glow.col} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={GLOW_COUNT} array={glow.size} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={glowSprite} size={0.3} vertexColors transparent opacity={0.45} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Relativistic jet (top) */}
      <points ref={jetTopRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={JET_COUNT} array={jetT.pos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={JET_COUNT} array={jetT.col} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={JET_COUNT} array={jetT.size} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={jetSprite} size={0.1} vertexColors transparent opacity={0.3} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Relativistic jet (bottom) */}
      <points ref={jetBotRef}>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" count={JET_COUNT} array={jetB.pos} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-color" count={JET_COUNT} array={jetB.col} itemSize={3} />
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-size" count={JET_COUNT} array={jetB.size} itemSize={1} />
        </bufferGeometry>
        <pointsMaterial map={jetSprite} size={0.1} vertexColors transparent opacity={0.3} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      {/* Hit detection mesh */}
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
  const sc = state === "listening" ? 1.04 : state === "thinking" ? 0.97 : 1;

  return (
    <div style={{
      width: size, height: size, position: "relative",
      transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
      transform: `scale(${sc})`, cursor: "pointer",
    }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "visible", position: "relative" }}>
        <Canvas
          dpr={[1, 2]}
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
