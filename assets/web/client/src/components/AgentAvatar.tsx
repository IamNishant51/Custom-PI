import { useEffect, useRef, memo, useState } from "react";

interface AgentAvatarProps {
  state: "idle" | "listening" | "thinking" | "speaking";
  analyserNode?: AnalyserNode | null;
  size?: number;
}

function AgentAvatar({ state, analyserNode, size = 200 }: AgentAvatarProps) {
  const s = size;
  const mouthRef = useRef<SVGPathElement>(null);
  const animRef = useRef(0);
  const blinkRef = useRef(0);
  const [eyelid, setEyelid] = useState(0);

  const c = s / 2;
  const headY = s * 0.44;
  const faceR = s * 0.22;
  const faceRy = s * 0.26;
  const eyeOff = faceR * 0.42;
  const eyeY = headY - faceRy * 0.02;
  const mouthY = headY + faceRy * 0.34;
  const noseY = headY + faceRy * 0.08;

  const id = `ag-${Math.random().toString(36).slice(2, 6)}`;

  const p = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const P = (x: number) => x.toFixed(2);

  // Blink timer
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

  // Mouth sync with audio analyser
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

      const mw = 14 + open * 8;
      const mh = 3 + open * 14;
      const hl = mw / 2;
      const vm = mh;
      const mx = c;
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
  }, [state, analyserNode, s, c, mouthY]);

  // Pre-compute paths
  const backHairRx = P(faceR + 18);
  const backHairRy = P(faceRy + 20);
  const neckX = P(c - 12);
  const neckW = P(24);
  const neckH = P(14);

  const sL = c - faceR - 22;
  const sR = c + faceR + 22;
  const sB = headY + faceRy + 55;
  const sMid = headY + faceRy + 4;

  const shoulderPath = [
    `M${p(sL, sMid)}`,
    `Q${p(c - 38, sMid + 36)} ${p(c - 22, sB)}`,
    `L${p(c + 22, sB)}`,
    `Q${p(c + 38, sMid + 36)} ${p(sR, sMid)}Z`,
  ].join(" ");

  const stateScale = state === "listening" ? 1.03 : state === "thinking" ? 0.97 : 1;
  const stateRotate = state === "listening" ? -4 : state === "thinking" ? 6 : 0;

  return (
    <div
      className="agent-avatar-root"
      style={{
        width: s, height: s, position: "relative",
        transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `scale(${stateScale}) rotate(${stateRotate}deg)`,
      }}
    >
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        <defs>
          <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3d2a8a" /><stop offset="40%" stopColor="#2d1b69" /><stop offset="100%" stopColor="#1a0f3d" />
          </linearGradient>
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff0e8" /><stop offset="60%" stopColor="#fde0d0" /><stop offset="100%" stopColor="#f5c8b5" />
          </linearGradient>
          <radialGradient id={`${id}i`} cx="35%" cy="30%">
            <stop offset="0%" stopColor="#7dd8ff" /><stop offset="45%" stopColor="#4a9ecf" /><stop offset="85%" stopColor="#2a6e9f" /><stop offset="100%" stopColor="#1a4e7f" />
          </radialGradient>
          <radialGradient id={`${id}b`}>
            <stop offset="0%" stopColor="#ff9a9a" stopOpacity="0.35" /><stop offset="100%" stopColor="#ff9a9a" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}g`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={state === "speaking" ? 6 : state === "listening" ? 10 : 3} result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g filter={`url(#${id}g)`}>
          <ellipse cx={c} cy={headY - 6} rx={backHairRx} ry={backHairRy} fill={`url(#${id}h)`} />
          <rect x={neckX} y={headY + faceRy - 4} width={neckW} height={neckH} rx="5" fill={`url(#${id}s)`} />
          <path d={shoulderPath} fill="#1a1a2e" opacity="0.92" />

          <path d={`M${p(c - 18, headY + faceRy + 2)} L${p(c - 6, headY + faceRy + 18)} L${p(c, headY + faceRy + 8)} L${p(c + 6, headY + faceRy + 18)} L${p(c + 18, headY + faceRy + 2)}`}
            fill="none" stroke="#8a7fc0" strokeWidth="1.8" opacity="0.6" />

          <ellipse cx={c} cy={headY} rx={P(faceR)} ry={P(faceRy)} fill={`url(#${id}s)`} />

          {/* Blush */}
          <ellipse cx={P(c - faceR * 0.55)} cy={P(headY + faceRy * 0.18)} rx={P(faceR * 0.28)} ry={P(faceRy * 0.12)} fill={`url(#${id}b)`} />
          <ellipse cx={P(c + faceR * 0.55)} cy={P(headY + faceRy * 0.18)} rx={P(faceR * 0.28)} ry={P(faceRy * 0.12)} fill={`url(#${id}b)`} />

          {/* Left eye */}
          <ellipse cx={P(c - eyeOff)} cy={P(eyeY)} rx={P(faceR * 0.1)} ry={P(faceR * 0.12)} fill="#fff" />
          <ellipse cx={P(c - eyeOff)} cy={P(eyeY)} rx={P(faceR * 0.075)} ry={P(faceR * 0.095)} fill={`url(#${id}i)`} />
          <circle cx={P(c - eyeOff)} cy={P(eyeY)} r={P(faceR * 0.04)} fill="#111" />
          <ellipse cx={P(c - eyeOff - faceR * 0.03)} cy={P(eyeY - faceR * 0.05)} rx={P(faceR * 0.04)} ry={P(faceR * 0.055)} fill="#fff" opacity="0.9" />
          <circle cx={P(c - eyeOff + faceR * 0.03)} cy={P(eyeY + faceR * 0.02)} r={P(faceR * 0.018)} fill="#fff" opacity="0.5" />
          <path d={`M${p(c - eyeOff - faceR * 0.18, eyeY - faceR * 0.18)} Q${p(c - eyeOff, eyeY - faceR * 0.26)} ${p(c - eyeOff + faceR * 0.18, eyeY - faceR * 0.18)}`}
            fill="none" stroke="#222" strokeWidth="2.2" strokeLinecap="round" />

          {/* Right eye */}
          <ellipse cx={P(c + eyeOff)} cy={P(eyeY)} rx={P(faceR * 0.1)} ry={P(faceR * 0.12)} fill="#fff" />
          <ellipse cx={P(c + eyeOff)} cy={P(eyeY)} rx={P(faceR * 0.075)} ry={P(faceR * 0.095)} fill={`url(#${id}i)`} />
          <circle cx={P(c + eyeOff)} cy={P(eyeY)} r={P(faceR * 0.04)} fill="#111" />
          <ellipse cx={P(c + eyeOff - faceR * 0.03)} cy={P(eyeY - faceR * 0.05)} rx={P(faceR * 0.04)} ry={P(faceR * 0.055)} fill="#fff" opacity="0.9" />
          <circle cx={P(c + eyeOff + faceR * 0.03)} cy={P(eyeY + faceR * 0.02)} r={P(faceR * 0.018)} fill="#fff" opacity="0.5" />
          <path d={`M${p(c + eyeOff - faceR * 0.18, eyeY - faceR * 0.18)} Q${p(c + eyeOff, eyeY - faceR * 0.26)} ${p(c + eyeOff + faceR * 0.18, eyeY - faceR * 0.18)}`}
            fill="none" stroke="#222" strokeWidth="2.2" strokeLinecap="round" />

          {/* Eyelids (blinking) */}
          {eyelid > 0 && (
            <>
              <ellipse cx={P(c - eyeOff)} cy={P(eyeY)} rx={P(faceR * 0.1)} ry={P(faceR * 0.12)} fill={`url(#${id}s)`} opacity={eyelid} />
              <ellipse cx={P(c + eyeOff)} cy={P(eyeY)} rx={P(faceR * 0.1)} ry={P(faceR * 0.12)} fill={`url(#${id}s)`} opacity={eyelid} />
            </>
          )}

          {/* Eyebrows */}
          <path d={`M${p(c - eyeOff - faceR * 0.2, eyeY - faceR * 0.38)} Q${p(c - eyeOff, eyeY - faceR * 0.46)} ${p(c - eyeOff + faceR * 0.2, eyeY - faceR * 0.38)}`}
            fill="none" stroke="#3d2a1c" strokeWidth="2.5" strokeLinecap="round" opacity={state === "thinking" ? 0.65 : 0.85} />
          <path d={`M${p(c + eyeOff - faceR * 0.2, eyeY - faceR * 0.38)} Q${p(c + eyeOff, eyeY - faceR * 0.46)} ${p(c + eyeOff + faceR * 0.2, eyeY - faceR * 0.38)}`}
            fill="none" stroke="#3d2a1c" strokeWidth="2.5" strokeLinecap="round" opacity={state === "thinking" ? 0.65 : 0.85} />

          {/* Nose */}
          <path d={`M${p(c, noseY)} Q${p(c + 3, noseY + faceRy * 0.1)} ${p(c, noseY + faceRy * 0.14)}`}
            fill="none" stroke="#d4a090" strokeWidth="1.5" strokeLinecap="round" />

          {/* Mouth */}
          <path ref={mouthRef} d={`M${p(c - 12, mouthY)} Q${p(c, mouthY + 2)} ${p(c + 12, mouthY)}`}
            fill="none" stroke="#cc6666" strokeWidth="2" strokeLinecap="round" />
          <path d={`M${p(c - 10, mouthY + 4)} Q${p(c, mouthY + 6)} ${p(c + 10, mouthY + 4)}`}
            fill="none" stroke="#dda0a0" strokeWidth="0.8" strokeLinecap="round" opacity="0.3" />

          {/* Front hair bangs */}
          {(() => {
            const cx2 = c;
            const cy2 = headY - faceRy;
            const r = faceR;
            const ry = faceRy;
            const hd = [
              `M${p(cx2 - r - 8, cy2 + 6)}`,
              `C${p(cx2 - r * 0.7, cy2 - 16)} ${p(cx2 - r * 0.35, cy2 + 4)} ${p(cx2 - r * 0.1, cy2 - 10)}`,
              `C${p(cx2 + r * 0.1, cy2 - 10)} ${p(cx2 + r * 0.35, cy2 + 4)} ${p(cx2 + r * 0.7, cy2 - 16)}`,
              `C${p(cx2 + r + 8, cy2 + 6)} ${p(cx2 + r + 12, cy2 - 3)} ${p(cx2 + r + 14, cy2 + 1)}`,
              `L${p(cx2 + r + 16, cy2 + ry * 0.08)}`,
              `C${p(cx2 + r + 9, cy2 + ry * 0.02)} ${p(cx2 + r + 4, cy2 + ry * 0.06)} ${p(cx2 + r, cy2 + ry * 0.04)}`,
              `C${p(cx2 + r * 0.85, cy2 + ry * 0.15)} ${p(cx2 + r * 0.7, cy2 + ry * 0.12)} ${p(cx2 + r * 0.5, cy2 + ry * 0.08)}`,
              `C${p(cx2, cy2 + ry * 0.14)} ${p(cx2 - r * 0.5, cy2 + ry * 0.08)} ${p(cx2 - r * 0.7, cy2 + ry * 0.12)}`,
              `C${p(cx2 - r * 0.85, cy2 + ry * 0.15)} ${p(cx2 - r - 4, cy2 + ry * 0.06)} ${p(cx2 - r - 9, cy2 + ry * 0.02)}`,
              `L${p(cx2 - r - 16, cy2 + ry * 0.08)}`,
              `C${p(cx2 - r - 14, cy2 + 1)} ${p(cx2 - r - 12, cy2 - 3)} ${p(cx2 - r - 8, cy2 + 6)}Z`,
            ].join(" ");
            return <path d={hd} fill={`url(#${id}h)`} />;
          })()}

          {/* Hair shine */}
          <ellipse cx={P(c - faceR * 0.15)} cy={P(headY - faceRy - 6)} rx={P(faceR * 0.3)} ry={P(faceR * 0.07)}
            fill="#fff" opacity="0.08" transform={`rotate(-20, ${P(c - faceR * 0.15)}, ${P(headY - faceRy - 6)})`} />

          {/* Speaking glow */}
          {state === "speaking" && (
            <ellipse cx={c} cy={headY} rx={P(faceR + 14)} ry={P(faceRy + 16)} fill="none" stroke="#6bcf" strokeWidth="1.5" opacity="0.4">
              <animate attributeName="rx" values={`${P(faceR + 14)};${P(faceR + 22)};${P(faceR + 14)}`} dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="ry" values={`${P(faceRy + 16)};${P(faceRy + 24)};${P(faceRy + 16)}`} dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="0.8s" repeatCount="indefinite" />
            </ellipse>
          )}

          {/* Listening pulse */}
          {state === "listening" && (
            <>
              <ellipse cx={c} cy={headY} rx={P(faceR + 10)} ry={P(faceRy + 12)} fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.5">
                <animate attributeName="rx" values={`${P(faceR + 10)};${P(faceR + 28)};${P(faceR + 10)}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="ry" values={`${P(faceRy + 12)};${P(faceRy + 30)};${P(faceRy + 12)}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx={c} cy={headY} rx={P(faceR + 10)} ry={P(faceRy + 12)} fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.3">
                <animate attributeName="rx" values={`${P(faceR + 10)};${P(faceR + 34)};${P(faceR + 10)}`} dur="1.5s" begin="0.5s" repeatCount="indefinite" />
                <animate attributeName="ry" values={`${P(faceRy + 12)};${P(faceRy + 36)};${P(faceRy + 12)}`} dur="1.5s" begin="0.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0;0.3" dur="1.5s" begin="0.5s" repeatCount="indefinite" />
              </ellipse>
            </>
          )}

          {/* Thinking sparkles */}
          {state === "thinking" && (
            <g opacity="0.8">
              <text x={P(c + faceR + 6)} y={P(headY - faceRy - 20)} fontSize="14" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                ✦<animate attributeName="opacity" values="0;1;0" dur="1.2s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-10;0,0" dur="1.2s" repeatCount="indefinite" />
              </text>
            </g>
          )}
        </g>
      </svg>

      <div style={{
        position: "absolute", bottom: -2, left: "50%", transform: "translateX(-50%)",
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
