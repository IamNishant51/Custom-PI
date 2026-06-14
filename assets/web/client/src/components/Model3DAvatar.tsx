import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { useFBX, useAnimations, useProgress, ContactShadows } from "@react-three/drei";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import * as THREE from "three";

const MOUTH_KEYWORDS = ["jaw", "mouth", "open", "lip", "aa", "ih", "ou", "oh", "eh", "ah", "ee"];

useLoader.preload(FBXLoader, "/Yelling.fbx");

interface ModelSceneProps {
  state: "idle" | "listening" | "thinking" | "speaking";
  analyserNode?: AnalyserNode | null;
  onLoaded: () => void;
}

function ModelScene({ state, analyserNode, onLoaded }: ModelSceneProps) {
  const group = useRef<THREE.Group>(null);
  const fbxScene = useFBX("/Yelling.fbx");
  const animations = (fbxScene as any).animations as THREE.AnimationClip[] | undefined;
  const { actions, mixer } = useAnimations(animations ?? [], group);

  const mouthMeshes = useRef<Map<THREE.Mesh, number[]>>(new Map());
  const smoothOpenness = useRef(0);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const found: Map<THREE.Mesh, number[]> = new Map();

    fbxScene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const mtn = (mesh as any).morphTargetNames as string[] | undefined;
      if (!mesh.isMesh || !mtn || mtn.length === 0) return;
      console.log("[Model3D] Mesh morph targets:", mesh.name, mtn);
      const indices: number[] = [];
      mtn.forEach((name: string, i: number) => {
        if (MOUTH_KEYWORDS.some((k) => name.toLowerCase().includes(k))) {
          indices.push(i);
        }
      });
      if (indices.length > 0) {
        found.set(mesh, indices);
        console.log(`[Model3D] Mouth targets at indices ${indices} on "${mesh.name}"`);
      }
    });

    if (found.size === 0) {
      fbxScene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.morphTargetInfluences) return;
        const count = Math.min(5, mesh.morphTargetInfluences.length);
        found.set(mesh, Array.from({ length: count }, (_, i) => i));
      });
    }

    mouthMeshes.current = found;
    onLoaded();
  }, [fbxScene, onLoaded]);

  useEffect(() => {
    if (!actions || Object.keys(actions).length === 0) return;
    const name = Object.keys(actions)[0];
    const action = actions[name];
    if (action) {
      action.reset().play();
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    return () => {
      if (action) action.stop();
    };
  }, [actions]);

  useFrame(() => {
    if (mixer) {
      const speedMap: Record<string, number> = { idle: 0.5, listening: 0.85, thinking: 0.7, speaking: 1 };
      mixer.timeScale = speedMap[state] ?? 0.5;
    }

    if (state === "speaking" && analyserNode) {
      const data = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const raw = Math.min(1, (sum / data.length / 255) * 3.5);
      smoothOpenness.current += (raw - smoothOpenness.current) * 0.25;

      for (const [mesh, indices] of mouthMeshes.current) {
        if (!mesh.morphTargetInfluences) continue;
        for (const idx of indices) {
          mesh.morphTargetInfluences[idx] = smoothOpenness.current;
        }
      }
    }
  });

  return <primitive ref={group} object={fbxScene} scale={1} />;
}

function Loader({ size }: { size: number }) {
  const { progress, active } = useProgress();
  if (!active) return null;
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 2, color: "#6bcf", fontSize: 11, flexDirection: "column", gap: 4,
    }}>
      <div>Loading avatar…</div>
      <div style={{ width: 80, height: 3, background: "rgba(107,207,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: "#6bcf", borderRadius: 2, transition: "width 0.2s" }} />
      </div>
    </div>
  );
}

interface Model3DAvatarProps {
  state: "idle" | "listening" | "thinking" | "speaking";
  analyserNode?: AnalyserNode | null;
  size?: number;
}

export default function Model3DAvatar({ state, analyserNode, size = 280 }: Model3DAvatarProps) {
  const [loaded, setLoaded] = useState(false);

  const stateScale = state === "listening" ? 1.03 : state === "thinking" ? 0.97 : 1;
  const stateRotate = state === "listening" ? -3 : state === "thinking" ? 4 : 0;

  return (
    <div
      style={{
        width: size, height: size, position: "relative",
        transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `scale(${stateScale}) rotate(${stateRotate}deg)`,
      }}
    >
      <Canvas
        dpr={[0.5, 1.5]}
        camera={{ position: [0, 0, 3.5], fov: 30, near: 0.1, far: 10 }}
        style={{ width: "100%", height: "100%" }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 3]} intensity={1.5} />
        <directionalLight position={[-3, 2, 3]} intensity={0.8} />
        <directionalLight position={[0, -2, -3]} intensity={0.4} color="#6bcf" />
        <hemisphereLight args={["#b1e1ff", "#1a0a20", 0.4]} />

        <ContactShadows position={[0, -0.8, 0]} opacity={0.3} scale={5} blur={3.5} far={1.2} />

        <ModelScene state={state} analyserNode={analyserNode} onLoaded={() => setLoaded(true)} />
      </Canvas>

      {!loaded && <Loader size={size} />}
    </div>
  );
}
