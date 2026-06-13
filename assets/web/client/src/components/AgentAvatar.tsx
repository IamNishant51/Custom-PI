import { useEffect, useRef, memo, useState } from "react";
import animeGirlSvg from "../assets/anime_girl.svg";

interface AgentAvatarProps {
  state: "idle" | "listening" | "thinking" | "speaking";
  analyserNode?: AnalyserNode | null;
  size?: number;
  gender?: "male" | "female";
}

function AgentAvatar({ state, analyserNode, size = 200, gender }: AgentAvatarProps) {
  const s = size;
  const mouthRef = useRef<SVGPathElement>(null);
  const animRef = useRef(0);
  const blinkRef = useRef(0);
  const [eyelid, setEyelid] = useState(0);

  const c = s / 2;

  // Map SVG viewBox (338x190) to container pixel coords.
  // Image is rendered with object-fit:cover in a square, so it fills height
  // and is horizontally centered.
  const scale = s / 190;
  const leftOff = (s - 338 * scale) / 2;
  const toX = (vx: number) => leftOff + vx * scale;
  const toY = (vy: number) => vy * scale;

  // Face landmark positions in viewBox coords (estimated from SVG structure)
  const mouthX = toX(169), mouthY = toY(102);
  const eyeLX = toX(123), eyeRX = toX(215), eyeY = toY(65);
  const eyeRx = (eyeRX - eyeLX) * 0.08;
  const eyeRy = (eyeRX - eyeLX) * 0.12;

  // Face center and radius for glow ring
  const fcx = c;
  const fcy = toY(62);
  const fr = toX(169) - toX(120);

  const id = `ag-${Math.random().toString(36).slice(2, 6)}`;

  const p = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const P = (x: number) => x.toFixed(2);

  useEffect(() => {
    const nextBlink = () => {
      blinkRef.current = window.setTimeout(() => {
        setEyelid(1);
        setTimeout(() => setEyelid(0), 120);
        nextBlink();
      }, 2000 + Math.random() * 3000);
    };
    nextBlink();
    return () => clearTimeout(blinkRef.current);
  }, []);

  useEffect(() => {
    let stopped = false;
    const animate = () => {
      if (stopped) return;
      const el = mouthRef.current;
      if (!el) { animRef.current = requestAnimationFrame(animate); return; }

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

      const mw = 14 + open * 10;
      const mh = 3 + open * 14;
      const hl = mw / 2;
      const vm = mh;
      const mx = mouthX;
      const my = mouthY;

      if (open > 0.1) {
        el.setAttribute("d", [
          `M${p(mx - hl, my)}`,
          `Q${p(mx - hl * 0.4, my + vm * 1.2)} ${p(mx, my + vm)}`,
          `Q${p(mx + hl * 0.4, my + vm * 1.2)} ${p(mx + hl, my)}`,
          `Q${p(mx + hl * 0.4, my + vm * 0.5)} ${p(mx, my + vm * 0.3)}`,
          `Q${p(mx - hl * 0.4, my + vm * 0.5)} ${p(mx - hl, my)}Z`,
        ].join(" "));
        el.setAttribute("fill", "#b04050");
        el.setAttribute("stroke", "none");
      } else {
        el.setAttribute("d", `M${p(mx - hl, my)} Q${p(mx, my - 2)} ${p(mx + hl, my)}`);
        el.setAttribute("fill", "none");
        el.setAttribute("stroke", "#cc6666");
      }
      el.setAttribute("stroke-width", "2");

      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { stopped = true; cancelAnimationFrame(animRef.current); };
  }, [state, analyserNode, s, mouthX, mouthY]);

  const stateScale = state === "listening" ? 1.03 : state === "thinking" ? 0.97 : 1;
  const stateRotate = state === "listening" ? -4 : state === "thinking" ? 6 : 0;

  return (
    <div
      className="agent-avatar-root"
      style={{
        width: s, height: s, position: "relative", overflow: "hidden", borderRadius: "50%",
        transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `scale(${stateScale}) rotate(${stateRotate}deg)`,
      }}
    >
      <img
        src={animeGirlSvg} alt=""
        style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          objectFit: "cover", objectPosition: "50% 30%",
        }}
        draggable={false}
      />

      <svg width={s} height={s} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
        <defs>
          <filter id={`${id}g`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={state === "speaking" ? 6 : state === "listening" ? 10 : 3} result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g filter={`url(#${id}g)`}>
          {eyelid > 0 && (
            <>
              <ellipse cx={P(eyeLX)} cy={P(eyeY)} rx={P(eyeRx)} ry={P(eyeRy)} fill="#F9D7D2" opacity={eyelid * 0.9} />
              <ellipse cx={P(eyeRX)} cy={P(eyeY)} rx={P(eyeRx)} ry={P(eyeRy)} fill="#F9D7D2" opacity={eyelid * 0.9} />
            </>
          )}

          <path ref={mouthRef} d={`M${p(mouthX - 12, mouthY)} Q${p(mouthX, mouthY + 2)} ${p(mouthX + 12, mouthY)}`}
            fill="none" stroke="rgba(200,80,80,0.7)" strokeWidth="2.5" strokeLinecap="round" />

          {state === "speaking" && (
            <ellipse cx={fcx} cy={fcy} rx={P(fr + 14)} ry={P(fr + 16)} fill="none" stroke="#6bcf" strokeWidth="1.5" opacity="0.4">
              <animate attributeName="rx" values={`${P(fr + 14)};${P(fr + 24)};${P(fr + 14)}`} dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="ry" values={`${P(fr + 16)};${P(fr + 26)};${P(fr + 16)}`} dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="0.8s" repeatCount="indefinite" />
            </ellipse>
          )}

          {state === "listening" && (
            <>
              <ellipse cx={fcx} cy={fcy} rx={P(fr + 10)} ry={P(fr + 12)} fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.5">
                <animate attributeName="rx" values={`${P(fr + 10)};${P(fr + 30)};${P(fr + 10)}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="ry" values={`${P(fr + 12)};${P(fr + 32)};${P(fr + 12)}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx={fcx} cy={fcy} rx={P(fr + 10)} ry={P(fr + 12)} fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.3">
                <animate attributeName="rx" values={`${P(fr + 10)};${P(fr + 36)};${P(fr + 10)}`} dur="1.5s" begin="0.5s" repeatCount="indefinite" />
                <animate attributeName="ry" values={`${P(fr + 12)};${P(fr + 38)};${P(fr + 12)}`} dur="1.5s" begin="0.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0;0.3" dur="1.5s" begin="0.5s" repeatCount="indefinite" />
              </ellipse>
            </>
          )}

          {state === "thinking" && (
            <g opacity="0.8">
              <text x={P(fcx + fr + 6)} y={P(fcy - fr - 10)} fontSize="14" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                ✦<animate attributeName="opacity" values="0;1;0" dur="1.2s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-10;0,0" dur="1.2s" repeatCount="indefinite" />
              </text>
            </g>
          )}
        </g>
      </svg>

      <div style={{
        position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)",
        fontSize: 10, color: "var(--mute)", background: "var(--surface)", padding: "1px 10px", borderRadius: 8,
        whiteSpace: "nowrap", border: "1px solid var(--hairline)", lineHeight: 1.5, zIndex: 1,
      }}>
        {state === "idle" && "Tap mic to speak"}
        {state === "listening" && "Listening..."}
        {state === "thinking" && "Thinking..."}
        {state === "speaking" && "Speaking..."}
      </div>
    </div>
  );
}

export default memo(AgentAvatar);
