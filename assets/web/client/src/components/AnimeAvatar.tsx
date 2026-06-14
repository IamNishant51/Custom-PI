import { useEffect, useRef, memo } from "react";

interface AnimeAvatarProps {
  state: "idle" | "listening" | "thinking" | "speaking";
  analyserNode?: AnalyserNode | null;
  size?: number;
  gender?: "male" | "female";
}

function AnimeAvatar({ state, analyserNode, size = 280, gender = "female" }: AnimeAvatarProps) {
  const mouthRef = useRef<SVGGElement>(null);
  const lipSyncRef = useRef(0);
  const animRef = useRef(0);
  const breatheRef = useRef(0);
  const blinkRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const earWaveRef = useRef(0);

  const f = gender === "female";

  // Palette
  const skin = f ? "#ffe4d6" : "#f5d5b8";
  const skinShadow = f ? "#e8c8b8" : "#e0c0a8";
  const skinDark = f ? "#d4a090" : "#c09080";
  const hair1 = f ? "#3d1c70" : "#0f1f3a";
  const hair2 = f ? "#5a2a9a" : "#1e3a5a";
  const hairHi = f ? "#7a4ab5" : "#3a6a8a";
  const irisC = f ? "#8a4fff" : "#4a7aff";
  const irisHi = f ? "#b080ff" : "#80b0ff";
  const lipC = f ? "#e8707a" : "#d48080";
  const lipDark = f ? "#c0505a" : "#b06060";
  const blushC = f ? "#ff9eb5" : "#e8a090";
  const cloth1 = f ? "#2a1a3a" : "#1a2a3a";
  const cloth2 = f ? "#4a2a5a" : "#2a4a5a";
  const eyeLiner = "#1a0a1a";

  // ── Animation loop ────────────────────────────────────────────────
  useEffect(() => {
    let stopped = false;
    const animate = () => {
      if (stopped) return;
      let target = 0;
      if (state === "speaking") {
        if (analyserNode) {
          const d = new Uint8Array(analyserNode.frequencyBinCount);
          analyserNode.getByteFrequencyData(d);
          let s = 0;
          for (let i = 0; i < d.length; i++) s += d[i];
          target = Math.min(1, (s / d.length / 255) * 3.2);
        } else {
          target = 0.35 + 0.3 * Math.sin(Date.now() / 90);
        }
      }
      lipSyncRef.current += (target - lipSyncRef.current) * 0.3;
      breatheRef.current += (0 - breatheRef.current) * 0.05;
      const o = lipSyncRef.current;

      // Breathing
      const breathe = state === "idle" ? Math.sin(Date.now() / 2400) * 0.003 : 0;
      if (rootRef.current) {
        rootRef.current.style.transform = `scale(${1 + breathe})`;
      }

      // Ear wave phase for listening
      earWaveRef.current = state === "listening" ? (earWaveRef.current + 0.04) % (Math.PI * 2) : 0;

      // Mouth
      if (mouthRef.current) {
        const int = mouthRef.current.querySelector<SVGEllipseElement>("#mi");
        const ul = mouthRef.current.querySelector<SVGPathElement>("#ul");
        const ll = mouthRef.current.querySelector<SVGPathElement>("#ll");
        if (int) int.setAttribute("ry", String(o * 13));
        const base = 258;
        if (ul) {
          const up = base - o * 8;
          ul.setAttribute("d", `M 168 ${up} Q 185 ${up - 4 - o * 5} 200 ${up - 1 - o * 3} Q 215 ${up - 4 - o * 5} 232 ${up}`);
        }
        if (ll) {
          const dn = base + o * 8;
          ll.setAttribute("d", `M 168 ${dn} Q 185 ${dn + 4 + o * 5} 200 ${dn + 1 + o * 3} Q 215 ${dn + 4 + o * 5} 232 ${dn}`);
        }
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { stopped = true; cancelAnimationFrame(animRef.current); };
  }, [state, analyserNode]);

  // ── Blink timer ──────────────────────────────────────────────────
  useEffect(() => {
    const ll = document.getElementById("lel");
    const rl = document.getElementById("rel");
    const blink = () => {
      [ll, rl].forEach(el => {
        if (!el) return;
        el.style.transition = "transform 0.05s ease";
        el.style.transform = "scaleY(1)";
      });
      setTimeout(() => {
        [ll, rl].forEach(el => {
          if (!el) return;
          el.style.transition = "transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)";
          el.style.transform = "scaleY(0.01)";
        });
        blinkRef.current = window.setTimeout(blink, 1800 + Math.random() * 3500);
      }, 75);
    };
    blinkRef.current = window.setTimeout(blink, 800 + Math.random() * 2500);
    return () => clearTimeout(blinkRef.current);
  }, []);

  const s = size;
  const sc = state === "listening" ? 1.025 : state === "thinking" ? 0.975 : 1;
  const rot = state === "listening" ? -2 : state === "thinking" ? 3 : 0;

  return (
    <div
      style={{
        width: s, height: s, position: "relative", overflow: "hidden",
        transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `scale(${sc}) rotate(${rot}deg)`,
      }}
    >
      <div ref={rootRef} style={{ width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width={s} height={s} viewBox="0 0 400 400" style={{ display: "block" }}>
          <defs>
            <radialGradient id="sg" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={skin} /><stop offset="100%" stopColor={skinShadow} />
            </radialGradient>
            <radialGradient id="igF" cx="45%" cy="38%" r="55%">
              <stop offset="0%" stopColor={irisHi} /><stop offset="55%" stopColor={irisC} /><stop offset="100%" stopColor="#3a1080" />
            </radialGradient>
            <radialGradient id="igM" cx="45%" cy="38%" r="55%">
              <stop offset="0%" stopColor={irisHi} /><stop offset="55%" stopColor={irisC} /><stop offset="100%" stopColor="#102860" />
            </radialGradient>
            <linearGradient id="hgF" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={hair2} /><stop offset="50%" stopColor={hair1} /><stop offset="100%" stopColor="#201040" />
            </linearGradient>
            <linearGradient id="hgM" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={hair2} /><stop offset="50%" stopColor={hair1} /><stop offset="100%" stopColor="#080e1a" />
            </linearGradient>
            <linearGradient id="clothGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={cloth2} /><stop offset="100%" stopColor={cloth1} />
            </linearGradient>
            <filter id="sgf"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="sgf2"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          {/* ── HAIR BACK ── */}
          {f ? (
            <path d="M 88 200 C 65 115, 110 52, 200 42 C 290 52, 335 115, 312 200 C 325 275, 305 345, 278 375 C 262 392, 238 378, 232 355 C 226 332, 244 305, 250 268 C 256 240, 268 210, 275 188 C 275 165, 270 142, 252 125 C 234 108, 215 102, 200 102 C 185 102, 166 108, 148 125 C 130 142, 125 165, 125 188 C 132 210, 144 240, 150 268 C 156 305, 174 332, 168 355 C 162 378, 138 392, 122 375 C 95 345, 75 275, 88 200 Z" fill="url(#hgF)" />
          ) : (
            <path d="M 83 205 C 65 130, 102 62, 200 52 C 298 62, 335 130, 317 205 C 325 245, 320 278, 308 300 C 295 315, 276 302, 270 282 C 264 262, 275 240, 278 218 C 280 195, 276 168, 262 148 C 245 128, 225 120, 200 118 C 175 120, 155 128, 138 148 C 124 168, 120 195, 122 218 C 125 240, 136 262, 130 282 C 124 302, 105 315, 92 300 C 80 278, 75 245, 83 205 Z" fill="url(#hgM)" />
          )}

          {/* ── EARS ── */}
          <g>
            <ellipse cx="91" cy="215" rx="15" ry="24" fill="url(#sg)" />
            <ellipse cx="91" cy="215" rx="6" ry="13" fill={skinDark} opacity="0.35" />
            <path d="M 84 208 Q 91 202 98 208" fill="none" stroke={skinShadow} strokeWidth="1" opacity="0.4" />
            <ellipse cx="309" cy="215" rx="15" ry="24" fill="url(#sg)" />
            <ellipse cx="309" cy="215" rx="6" ry="13" fill={skinDark} opacity="0.35" />
            <path d="M 302 208 Q 309 202 316 208" fill="none" stroke={skinShadow} strokeWidth="1" opacity="0.4" />
            {/* Earrings - female */}
            {f && (
              <>
                <circle cx="91" cy="240" r="4" fill="#c0a0e0" stroke="#8a5aaa" strokeWidth="1" />
                <circle cx="309" cy="240" r="4" fill="#c0a0e0" stroke="#8a5aaa" strokeWidth="1" />
              </>
            )}
          </g>

          {/* ── FACE ── */}
          <g>
            <ellipse cx="200" cy="220" rx={f ? 108 : 102} ry={f ? 136 : 128} fill="url(#sg)" />
            <ellipse cx="200" cy="220" rx={f ? 108 : 102} ry={f ? 136 : 128} fill="none" stroke={skinShadow} strokeWidth="6" opacity="0.25" />
            {/* Jawline shadow */}
            <path d={f ? "M 120 270 Q 200 335 280 270" : "M 120 265 Q 200 340 280 265"} fill="none" stroke={skinShadow} strokeWidth="2" opacity="0.3" />
            {!f && <path d="M 128 260 Q 200 318 272 260" fill="none" stroke={skinShadow} strokeWidth="2.5" opacity="0.35" />}
            {/* Chin highlight */}
            <ellipse cx="200" cy="305" rx="28" ry="6" fill={skin} opacity="0.4" filter="url(#sgf2)" />
          </g>

          {/* ── BLUSH ── */}
          {f && (
            <g filter="url(#sgf2)">
              <ellipse cx="142" cy="210" rx="22" ry="11" fill={blushC} opacity="0.22" />
              <ellipse cx="258" cy="210" rx="22" ry="11" fill={blushC} opacity="0.22" />
            </g>
          )}

          {/* ── EYEBROWS ── */}
          <g>
            <path d={f ? "M 132 136 Q 158 124 185 132" : "M 132 138 Q 158 128 185 135"} fill="none" stroke="#2a1a1a" strokeWidth="2.5" strokeLinecap="round" opacity={state === "thinking" ? 0.65 : 1}>
              {state === "thinking" && <animate attributeName="d" values="M 132 136 Q 158 124 185 132;M 132 132 Q 158 120 185 128;M 132 136 Q 158 124 185 132" dur="1.5s" repeatCount="indefinite" />}
            </path>
            <path d={f ? "M 215 132 Q 242 124 268 136" : "M 215 135 Q 242 128 268 138"} fill="none" stroke="#2a1a1a" strokeWidth="2.5" strokeLinecap="round" opacity={state === "thinking" ? 0.65 : 1}>
              {state === "thinking" && <animate attributeName="d" values="M 215 132 Q 242 124 268 136;M 215 128 Q 242 120 268 132;M 215 132 Q 242 124 268 136" dur="1.5s" repeatCount="indefinite" />}
            </path>
          </g>

          {/* ── EYES ── */}
          <g>
            {/* ── Left eye ── */}
            <ellipse cx="160" cy="176" rx="25" ry="30" fill={skinShadow} opacity="0.25" />
            <path d="M 135 156 Q 160 142 185 156" fill="none" stroke={skinShadow} strokeWidth="1.5" opacity="0.45" />
            {/* White */}
            <ellipse cx="160" cy="178" rx="23" ry={f ? 27 : 23} fill="#f4f4ff" />
            {/* Eyeliner */}
            <ellipse cx="160" cy="178" rx="23" ry={f ? 27 : 23} fill="none" stroke={eyeLiner} strokeWidth="2.5" />
            {/* Upper lashes */}
            <path d="M 137 170 Q 139 158 143 154" fill="none" stroke={eyeLiner} strokeWidth="2" strokeLinecap="round" />
            <path d="M 145 164 Q 148 154 152 151" fill="none" stroke={eyeLiner} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 153 160 Q 156 153 160 151" fill="none" stroke={eyeLiner} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 183 170 Q 181 158 177 154" fill="none" stroke={eyeLiner} strokeWidth="2" strokeLinecap="round" />
            <path d="M 175 164 Q 172 154 168 151" fill="none" stroke={eyeLiner} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 167 160 Q 164 153 160 151" fill="none" stroke={eyeLiner} strokeWidth="1.5" strokeLinecap="round" />
            {/* Lower lashes */}
            <path d="M 142 192 Q 145 196 149 195" fill="none" stroke={eyeLiner} strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <path d="M 178 192 Q 175 196 171 195" fill="none" stroke={eyeLiner} strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            {/* Iris */}
            <ellipse cx="162" cy="179" rx={f ? 15 : 13} ry={f ? 18 : 15} fill={`url(${f ? "#igF" : "#igM"})`} />
            {/* Iris outer ring */}
            <ellipse cx="162" cy="179" rx={f ? 15 : 13} ry={f ? 18 : 15} fill="none" stroke={f ? "#3a1080" : "#102860"} strokeWidth="1.5" opacity="0.6" />
            {/* Pupil */}
            <ellipse cx="162" cy="179" rx={f ? 7 : 6} ry={f ? 9 : 7} fill="#08081a" />
            {/* Catchlights */}
            <ellipse cx="155" cy="170" rx="5.5" ry="6" fill="white" />
            <ellipse cx="171" cy="174" rx="2.5" ry="3.5" fill="white" />
            <ellipse cx="157" cy="184" rx="1.5" ry="1.5" fill="white" opacity="0.3" />
            {/* Eyelid (blink) */}
            <ellipse id="lel" cx="160" cy="178" rx="24" ry={f ? 28 : 24} fill={skin} style={{ transformOrigin: "160px 178px", transform: "scaleY(0.01)" }} />

            {/* ── Right eye ── */}
            <ellipse cx="240" cy="176" rx="25" ry="30" fill={skinShadow} opacity="0.25" />
            <path d="M 215 156 Q 240 142 265 156" fill="none" stroke={skinShadow} strokeWidth="1.5" opacity="0.45" />
            <ellipse cx="240" cy="178" rx="23" ry={f ? 27 : 23} fill="#f4f4ff" />
            <ellipse cx="240" cy="178" rx="23" ry={f ? 27 : 23} fill="none" stroke={eyeLiner} strokeWidth="2.5" />
            <path d="M 217 170 Q 219 158 223 154" fill="none" stroke={eyeLiner} strokeWidth="2" strokeLinecap="round" />
            <path d="M 225 164 Q 228 154 232 151" fill="none" stroke={eyeLiner} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 233 160 Q 236 153 240 151" fill="none" stroke={eyeLiner} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 263 170 Q 261 158 257 154" fill="none" stroke={eyeLiner} strokeWidth="2" strokeLinecap="round" />
            <path d="M 255 164 Q 252 154 248 151" fill="none" stroke={eyeLiner} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 247 160 Q 244 153 240 151" fill="none" stroke={eyeLiner} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 222 192 Q 225 196 229 195" fill="none" stroke={eyeLiner} strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <path d="M 258 192 Q 255 196 251 195" fill="none" stroke={eyeLiner} strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <ellipse cx="238" cy="179" rx={f ? 15 : 13} ry={f ? 18 : 15} fill={`url(${f ? "#igF" : "#igM"})`} />
            <ellipse cx="238" cy="179" rx={f ? 15 : 13} ry={f ? 18 : 15} fill="none" stroke={f ? "#3a1080" : "#102860"} strokeWidth="1.5" opacity="0.6" />
            <ellipse cx="238" cy="179" rx={f ? 7 : 6} ry={f ? 9 : 7} fill="#08081a" />
            <ellipse cx="231" cy="170" rx="5.5" ry="6" fill="white" />
            <ellipse cx="247" cy="174" rx="2.5" ry="3.5" fill="white" />
            <ellipse cx="233" cy="184" rx="1.5" ry="1.5" fill="white" opacity="0.3" />
            <ellipse id="rel" cx="240" cy="178" rx="24" ry={f ? 28 : 24} fill={skin} style={{ transformOrigin: "240px 178px", transform: "scaleY(0.01)" }} />
          </g>

          {/* ── NOSE ── */}
          <g>
            <path d="M 196 194 Q 199 210 204 194" fill="none" stroke={skinDark} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 200 210 Q 200 212 201 210" fill="none" stroke={skinDark} strokeWidth="1" strokeLinecap="round" />
            {/* Nose shadow */}
            <path d="M 205 198 Q 208 208 205 212" fill="none" stroke={skinShadow} strokeWidth="1.5" opacity="0.3" strokeLinecap="round" />
          </g>

          {/* ── MOUTH ── */}
          <g ref={mouthRef}>
            {/* Smile lines */}
            <path d="M 165 257 Q 168 260 170 258" fill="none" stroke={skinDark} strokeWidth="1" opacity="0.3" strokeLinecap="round" />
            <path d="M 235 257 Q 232 260 230 258" fill="none" stroke={skinDark} strokeWidth="1" opacity="0.3" strokeLinecap="round" />
            {/* Interior */}
            <ellipse id="mi" cx="200" cy="258" rx="30" ry="0" fill="#1a0505" />
            {/* Upper lip */}
            <path id="ul" d="M 168 258 Q 185 262 200 259 Q 215 262 232 258" fill="none" stroke={lipC} strokeWidth="2.2" strokeLinecap="round" />
            {/* Lower lip */}
            <path id="ll" d="M 168 258 Q 185 262 200 259 Q 215 262 232 258" fill="none" stroke={lipC} strokeWidth="2.2" strokeLinecap="round" />
            {/* Lip highlight */}
            <path d="M 185 257 Q 200 254 215 257" fill="none" stroke={lipDark} strokeWidth="0.8" opacity="0.3" strokeLinecap="round" />
          </g>

          {/* ── NECK ── */}
          <g>
            <path d={f ? "M 176 345 L 176 376 Q 200 384 224 376 L 224 345" : "M 174 342 L 174 376 Q 200 386 226 376 L 226 342"} fill="url(#sg)" />
            <path d={f ? "M 176 345 L 176 376 Q 200 384 224 376 L 224 345" : "M 174 342 L 174 376 Q 200 386 226 376 L 226 342"} fill="none" stroke={skinShadow} strokeWidth="2" opacity="0.3" />
            {/* Neck shadow (jawline drop shadow) */}
            <ellipse cx="200" cy="340" rx="28" ry="4" fill={skinShadow} opacity="0.2" filter="url(#sgf)" />
          </g>

          {/* ── CLOTHING ── */}
          <g>
            {/* Shoulders */}
            <path d="M 105 376 C 82 392, 68 408, 62 430 L 338 430 C 332 408, 318 392, 295 376" fill="url(#clothGrad)" />
            {/* Collar */}
            {f ? (
              <>
                <path d="M 170 376 L 200 396 L 230 376" fill="none" stroke="#5a3a6a" strokeWidth="2" opacity="0.7" />
                <path d="M 170 376 L 200 396" fill="none" stroke="#7a5a8a" strokeWidth="1" opacity="0.4" />
                <path d="M 230 376 L 200 396" fill="none" stroke="#7a5a8a" strokeWidth="1" opacity="0.4" />
                {/* Fabric folds */}
                <path d="M 115 395 Q 140 400 165 390" fill="none" stroke="#4a2a5a" strokeWidth="1" opacity="0.3" />
                <path d="M 285 395 Q 260 400 235 390" fill="none" stroke="#4a2a5a" strokeWidth="1" opacity="0.3" />
                {/* Choker */}
                <path d="M 160 378 Q 200 386 240 378" fill="none" stroke="#8a5aaa" strokeWidth="2.5" />
                <circle cx="200" cy="384" r="3" fill="#c0a0e0" stroke="#8a5aaa" strokeWidth="1" />
              </>
            ) : (
              <>
                <path d="M 168 376 L 200 394 L 232 376" fill="none" stroke="#3a4a5a" strokeWidth="2" opacity="0.7" />
                <path d="M 168 376 L 200 394" fill="none" stroke="#5a6a7a" strokeWidth="1" opacity="0.4" />
                <path d="M 232 376 L 200 394" fill="none" stroke="#5a6a7a" strokeWidth="1" opacity="0.4" />
                {/* Jacket lapel */}
                <path d="M 168 376 Q 175 395 200 415" fill="none" stroke="#2a3a4a" strokeWidth="1.5" opacity="0.5" />
                <path d="M 232 376 Q 225 395 200 415" fill="none" stroke="#2a3a4a" strokeWidth="1.5" opacity="0.5" />
              </>
            )}
            {/* Shoulder line highlight */}
            <path d="M 105 376 C 130 382, 160 385, 200 386 C 240 385, 270 382, 295 376" fill="none" stroke={cloth2} strokeWidth="1" opacity="0.3" />
          </g>

          {/* ── HAIR FRONT ── */}
          {f ? (
            <>
              {/* Main bangs */}
              <path d="M 82 195 C 78 125, 118 72, 165 60 C 178 56, 190 55, 200 57 C 188 64, 178 74, 170 86 C 155 79, 138 83, 125 96 C 113 110, 105 128, 100 146 C 95 164, 90 182, 84 198 Z" fill="url(#hgF)" />
              <path d="M 200 57 C 215 55, 235 60, 248 68 C 260 76, 270 90, 278 106 C 285 122, 292 142, 300 162 C 305 178, 310 194, 318 208 C 312 184, 305 162, 296 142 C 286 122, 275 106, 262 94 C 248 82, 234 74, 218 68 C 210 65, 202 62, 200 57 Z" fill="url(#hgF)" />
              {/* Side strands */}
              <path d="M 82 195 C 78 218, 80 250, 86 278 C 88 290, 92 302, 98 312 C 95 296, 92 274, 91 252 C 90 230, 88 212, 82 195 Z" fill="url(#hgF)" />
              <path d="M 318 208 C 322 238, 318 268, 312 292 C 308 304, 304 314, 298 320 C 302 304, 305 282, 307 260 C 309 238, 312 222, 318 208 Z" fill="url(#hgF)" />
              {/* Forehead strand */}
              <path d="M 170 86 C 165 98, 160 112, 158 126 C 156 140, 158 152, 162 158 C 160 148, 158 132, 160 118 C 162 104, 166 92, 170 86 Z" fill={hairHi} opacity="0.35" />
              {/* Hair highlights */}
              <path d="M 120 96 C 138 84, 165 72, 195 68 C 225 72, 252 84, 270 96" fill="none" stroke={hairHi} strokeWidth="1.5" opacity="0.2" />
              <path d="M 135 112 C 150 102, 175 92, 200 90 C 225 92, 250 102, 265 112" fill="none" stroke={hairHi} strokeWidth="1" opacity="0.15" />
            </>
          ) : (
            <>
              {/* Male hair front */}
              <path d="M 83 205 C 85 150, 108 102, 145 82 C 162 73, 180 68, 200 65 C 192 72, 185 80, 178 92 C 165 86, 150 92, 138 106 C 125 120, 113 142, 106 165 C 100 182, 95 198, 86 210 Z" fill="url(#hgM)" />
              <path d="M 200 65 C 220 68, 240 75, 256 86 C 270 98, 282 116, 290 138 C 296 156, 302 176, 310 198 C 315 180, 318 160, 315 138 C 312 116, 304 95, 290 80 C 276 66, 258 60, 242 56 C 228 54, 214 56, 200 65 Z" fill="url(#hgM)" />
              {/* Spikes */}
              <path d="M 145 82 C 152 68, 162 54, 178 46 C 166 58, 158 72, 150 86 Z" fill={hair2} opacity="0.5" />
              <path d="M 256 86 C 248 72, 236 58, 222 50 C 234 62, 244 76, 252 90 Z" fill={hair2} opacity="0.5" />
              <path d="M 200 65 C 200 50, 206 38, 212 32 C 206 44, 204 56, 200 65 Z" fill={hair2} opacity="0.5" />
              <path d="M 178 46 C 185 42, 192 38, 200 38 C 195 42, 188 48, 178 46 Z" fill={hairHi} opacity="0.3" />
              {/* Highlights */}
              <path d="M 130 110 C 145 98, 170 88, 200 84 C 230 88, 255 98, 270 110" fill="none" stroke={hairHi} strokeWidth="1" opacity="0.15" />
            </>
          )}

          {/* ── STATE OVERLAYS ── */}

          {/* Listening: Ear waves + pulse rings */}
          {state === "listening" && (
            <g filter="url(#sgf)">
              {/* Left ear wave */}
              <g>
                <path d="M 45 200 Q 35 215 45 230" fill="none" stroke="#6bcf" strokeWidth="2" strokeLinecap="round" opacity="0.6">
                  <animate attributeName="d" values="M 45 200 Q 35 215 45 230;M 35 195 Q 20 215 35 235;M 45 200 Q 35 215 45 230" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0;0.6" dur="1.2s" repeatCount="indefinite" />
                </path>
                <path d="M 55 205 Q 48 215 55 225" fill="none" stroke="#6bcf" strokeWidth="1.5" strokeLinecap="round" opacity="0.4">
                  <animate attributeName="d" values="M 55 205 Q 48 215 55 225;M 48 200 Q 38 215 48 230;M 55 205 Q 48 215 55 225" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
                </path>
              </g>
              {/* Right ear wave */}
              <g>
                <path d="M 355 200 Q 365 215 355 230" fill="none" stroke="#6bcf" strokeWidth="2" strokeLinecap="round" opacity="0.6">
                  <animate attributeName="d" values="M 355 200 Q 365 215 355 230;M 365 195 Q 380 215 365 235;M 355 200 Q 365 215 355 230" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0;0.6" dur="1.2s" repeatCount="indefinite" />
                </path>
                <path d="M 345 205 Q 352 215 345 225" fill="none" stroke="#6bcf" strokeWidth="1.5" strokeLinecap="round" opacity="0.4">
                  <animate attributeName="d" values="M 345 205 Q 352 215 345 225;M 352 200 Q 362 215 352 230;M 345 205 Q 352 215 345 225" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
                </path>
              </g>
              {/* Aura pulse */}
              <ellipse cx="200" cy="215" rx="115" ry="138" fill="none" stroke="#6bcf" strokeWidth="1.5" opacity="0.35">
                <animate attributeName="rx" values="115;126;115" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="ry" values="138;150;138" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0.08;0.35" dur="1.6s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx="200" cy="215" rx="120" ry="142" fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.2">
                <animate attributeName="rx" values="120;136;120" dur="1.6s" begin="0.4s" repeatCount="indefinite" />
                <animate attributeName="ry" values="142;160;142" dur="1.6s" begin="0.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.2;0;0.2" dur="1.6s" begin="0.4s" repeatCount="indefinite" />
              </ellipse>
            </g>
          )}

          {/* Speaking: glow */}
          {state === "speaking" && (
            <g filter="url(#sgf2)">
              <ellipse cx="200" cy="215" rx="110" ry="132" fill="none" stroke={irisC} strokeWidth="1.5" opacity="0.25">
                <animate attributeName="opacity" values="0.25;0.04;0.25" dur="0.7s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx="200" cy="215" rx="116" ry="138" fill="none" stroke={irisHi} strokeWidth="0.8" opacity="0.15">
                <animate attributeName="opacity" values="0.15;0.02;0.15" dur="0.7s" begin="0.2s" repeatCount="indefinite" />
              </ellipse>
            </g>
          )}

          {/* Thinking: sparkles */}
          {state === "thinking" && (
            <g opacity="0.8" filter="url(#sgf)">
              <text x="294" y="98" fontSize="18" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                &#10022;
                <animate attributeName="opacity" values="0;1;0" dur="1.3s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-10;0,0" dur="1.3s" repeatCount="indefinite" />
              </text>
              <text x="278" y="84" fontSize="12" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                &#10022;
                <animate attributeName="opacity" values="0;0.5;0" dur="1.3s" begin="0.4s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-8;0,0" dur="1.3s" begin="0.4s" repeatCount="indefinite" />
              </text>
              <text x="310" y="110" fontSize="10" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                &#10022;
                <animate attributeName="opacity" values="0;0.4;0" dur="1.3s" begin="0.7s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-6;0,0" dur="1.3s" begin="0.7s" repeatCount="indefinite" />
              </text>
            </g>
          )}
        </svg>

        {/* State label */}
        <div
          style={{
            position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
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
    </div>
  );
}

export default memo(AnimeAvatar);
