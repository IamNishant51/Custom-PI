import { useEffect, useRef, memo, useState } from "react";
import rawSvg from "../assets/anime_girl.svg?raw";

interface AgentAvatarProps {
  state: "idle" | "listening" | "thinking" | "speaking";
  analyserNode?: AnalyserNode | null;
  size?: number;
  gender?: "male" | "female";
}

// Fix SVG dimensions so it stretches to fill the container
const inlineSvg = rawSvg
  .replace('width="338"', 'width="100%"')
  .replace('height="190"', 'height="100%"');

function AgentAvatar({ state, analyserNode, size = 200, gender }: AgentAvatarProps) {
  const s = size;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const animRef = useRef(0);
  const blinkRef = useRef(0);

  const leftEyePaths = useRef<SVGPathElement[]>([]);
  const rightEyePaths = useRef<SVGPathElement[]>([]);
  const mouthPaths = useRef<SVGPathElement[]>([]);
  const ready = useRef(false);

  const c = s / 2;

  // Face center in SVG viewBox (338×190). With xMidYMid meet in a square container,
  // the SVG height = s, SVG width = s*338/190, centered horizontally.
  // viewBox(169, 65) → container center.
  const fcx = c;
  const fcy = (65 / 190) * s;
  const fr = ((169 - 120) / 190) * s;

  const id = `ag-${Math.random().toString(36).slice(2, 6)}`;

  const P = (x: number) => x.toFixed(2);

  // --- initialise: classify paths by bounding box ---
  useEffect(() => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector("svg");
    if (!svg) return;
    svgRef.current = svg;

    const left: SVGPathElement[] = [];
    const right: SVGPathElement[] = [];
    const mouth: SVGPathElement[] = [];

    svg.querySelectorAll("path").forEach((p) => {
      try {
        const bb = p.getBBox();
        const cx = bb.x + bb.width / 2;
        const cy = bb.y + bb.height / 2;
        if (cx > 105 && cx < 150 && cy > 50 && cy < 85) left.push(p);
        else if (cx > 185 && cx < 230 && cy > 50 && cy < 85) right.push(p);
        else if (cx > 140 && cx < 200 && cy > 85 && cy < 120) mouth.push(p);
      } catch {}
    });

    leftEyePaths.current = left;
    rightEyePaths.current = right;
    mouthPaths.current = mouth;
    ready.current = true;

    // --- blink animation ---
    const allEyes = [...left, ...right];
    const nextBlink = () => {
      blinkRef.current = window.setTimeout(() => {
        allEyes.forEach((el) => {
          el.style.transition = "transform 0.06s";
          el.style.transformOrigin = `${el.getBBox().x + el.getBBox().width / 2}px ${el.getBBox().y + el.getBBox().height / 2}px`;
          el.style.transform = "scaleY(0.01)";
        });
        setTimeout(() => {
          allEyes.forEach((el) => {
            el.style.transition = "transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)";
            el.style.transform = "scaleY(1)";
          });
          nextBlink();
        }, 80);
      }, 2000 + Math.random() * 3000);
    };
    nextBlink();

    return () => clearTimeout(blinkRef.current);
  }, []);

  // --- mouth animation (speaking) ---
  useEffect(() => {
    let stopped = false;
    const animate = () => {
      if (stopped) return;

      let open = 0;
      if (state === "speaking") {
        if (analyserNode) {
          const data = new Uint8Array(analyserNode.frequencyBinCount);
          analyserNode.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          open = Math.min(1, (sum / data.length / 255) * 3.5);
        } else {
          open = 0.3 + 0.35 * Math.sin(Date.now() / 100);
        }
      }

      const mp = mouthPaths.current;
      if (mp.length > 0) {
        const bb = mp[0].getBBox();
        const oy = bb.y + bb.height / 2;
        // Scale Y: close mouth (0.3) to open (1.5)
        const sy = 1 - open * 0.4;
        const ty = open * 0.5;
        mp.forEach((el) => {
          el.style.transition = "transform 0.04s";
          el.style.transformOrigin = `${bb.x + bb.width / 2}px ${oy}px`;
          el.style.transform = `scaleY(${sy}) translateY(${ty}px)`;
        });
      }

      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { stopped = true; cancelAnimationFrame(animRef.current); };
  }, [state, analyserNode]);

  const stateScale = state === "listening" ? 1.03 : state === "thinking" ? 0.97 : 1;
  const stateRotate = state === "listening" ? -3 : state === "thinking" ? 4 : 0;

  return (
    <div
      className="agent-avatar-root"
      style={{
        width: s, height: s, position: "relative", overflow: "hidden", borderRadius: "50%",
        background: "#1a0a20",
        transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `scale(${stateScale}) rotate(${stateRotate}deg)`,
      }}
    >
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
        dangerouslySetInnerHTML={{ __html: inlineSvg }}
      />

      <svg
        width={s} height={s}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
        viewBox={`0 0 ${s} ${s}`}
      >
        <defs>
          <filter id={`${id}g`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur
              stdDeviation={state === "speaking" ? 6 : state === "listening" ? 10 : 3}
              result="blur"
            />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g filter={`url(#${id}g)`}>
          {state === "speaking" && (
            <ellipse cx={fcx} cy={fcy} rx={P(fr + 14)} ry={P(fr + 18)} fill="none" stroke="#6bcf" strokeWidth="1.5" opacity="0.4">
              <animate attributeName="rx" values={`${P(fr + 14)};${P(fr + 24)};${P(fr + 14)}`} dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="ry" values={`${P(fr + 18)};${P(fr + 28)};${P(fr + 18)}`} dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="0.8s" repeatCount="indefinite" />
            </ellipse>
          )}

          {state === "listening" && (
            <>
              <ellipse cx={fcx} cy={fcy} rx={P(fr + 10)} ry={P(fr + 14)} fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.5">
                <animate attributeName="rx" values={`${P(fr + 10)};${P(fr + 32)};${P(fr + 10)}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="ry" values={`${P(fr + 14)};${P(fr + 34)};${P(fr + 14)}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx={fcx} cy={fcy} rx={P(fr + 10)} ry={P(fr + 14)} fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.3">
                <animate attributeName="rx" values={`${P(fr + 10)};${P(fr + 38)};${P(fr + 10)}`} dur="1.5s" begin="0.5s" repeatCount="indefinite" />
                <animate attributeName="ry" values={`${P(fr + 14)};${P(fr + 40)};${P(fr + 14)}`} dur="1.5s" begin="0.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0;0.3" dur="1.5s" begin="0.5s" repeatCount="indefinite" />
              </ellipse>
            </>
          )}

          {state === "thinking" && (
            <g opacity="0.8">
              <text x={P(fcx + fr + 6)} y={P(fcy - fr - 10)} fontSize="14" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                ✦
                <animate attributeName="opacity" values="0;1;0" dur="1.2s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-10;0,0" dur="1.2s" repeatCount="indefinite" />
              </text>
            </g>
          )}
        </g>
      </svg>

      <div
        style={{
          position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)",
          fontSize: 10, color: "var(--mute)", background: "var(--surface)", padding: "1px 10px",
          borderRadius: 8, whiteSpace: "nowrap", border: "1px solid var(--hairline)",
          lineHeight: 1.5, zIndex: 1,
        }}
      >
        {state === "idle" && "Tap mic to speak"}
        {state === "listening" && "Listening..."}
        {state === "thinking" && "Thinking..."}
        {state === "speaking" && "Speaking..."}
      </div>
    </div>
  );
}

export default memo(AgentAvatar);
