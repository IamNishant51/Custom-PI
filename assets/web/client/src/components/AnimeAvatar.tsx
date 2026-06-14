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

  const isFemale = gender === "female";

  const skin = isFemale ? "#ffe4d6" : "#f5d5b8";
  const skinShadow = isFemale ? "#e8c8b8" : "#e0c0a8";
  const hairMain = isFemale ? "#3d1c70" : "#1a2a4a";
  const hairLight = isFemale ? "#5a2a9a" : "#2a4a6a";
  const lipColor = isFemale ? "#e8707a" : "#d48080";
  const skinTone = isFemale ? "#d4a090" : "#c09080";

  useEffect(() => {
    let stopped = false;

    const animate = () => {
      if (stopped) return;

      let target = 0;
      if (state === "speaking") {
        if (analyserNode) {
          const data = new Uint8Array(analyserNode.frequencyBinCount);
          analyserNode.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          target = Math.min(1, (sum / data.length / 255) * 3.2);
        } else {
          target = 0.35 + 0.3 * Math.sin(Date.now() / 90);
        }
      }

      lipSyncRef.current += (target - lipSyncRef.current) * 0.3;
      const o = lipSyncRef.current;

      if (state !== "speaking") {
        breatheRef.current += (0 - breatheRef.current) * 0.05;
      }
      const breathe = state === "idle" ? Math.sin(Date.now() / 2500) * 0.004 : 0;

      if (rootRef.current) {
        rootRef.current.style.transform = `scale(${1 + breathe})`;
      }

      if (mouthRef.current) {
        const interior = mouthRef.current.querySelector<SVGEllipseElement>("#mouth-interior");
        const upperLip = mouthRef.current.querySelector<SVGPathElement>("#upper-lip");
        const lowerLip = mouthRef.current.querySelector<SVGPathElement>("#lower-lip");

        if (interior) {
          interior.setAttribute("ry", String(o * 12));
        }
        if (upperLip) {
          const up = 250 - o * 7;
          upperLip.setAttribute("d", `M 172 ${up} Q 200 ${up - 3 - o * 4} 228 ${up}`);
        }
        if (lowerLip) {
          const down = 250 + o * 7;
          lowerLip.setAttribute("d", `M 172 ${down} Q 200 ${down + 3 + o * 4} 228 ${down}`);
        }
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => { stopped = true; cancelAnimationFrame(animRef.current); };
  }, [state, analyserNode]);

  useEffect(() => {
    const leftEyelid = document.getElementById("lefteyelid");
    const rightEyelid = document.getElementById("righteyelid");

    const blink = () => {
      [leftEyelid, rightEyelid].forEach((el) => {
        if (!el) return;
        el.style.transition = "transform 0.05s ease";
        el.style.transform = "scaleY(0.02)";
      });
      setTimeout(() => {
        [leftEyelid, rightEyelid].forEach((el) => {
          if (!el) return;
          el.style.transition = "transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)";
          el.style.transform = "scaleY(1)";
        });
        const delay = 2000 + Math.random() * 4000;
        blinkRef.current = window.setTimeout(blink, delay);
      }, 70);
    };

    blinkRef.current = window.setTimeout(blink, 1000 + Math.random() * 3000);
    return () => clearTimeout(blinkRef.current);
  }, []);

  const s = size;

  const stateScale = state === "listening" ? 1.02 : state === "thinking" ? 0.98 : 1;
  const stateRotate = state === "listening" ? -2 : state === "thinking" ? 3 : 0;

  return (
    <div
      style={{
        width: s, height: s, position: "relative", overflow: "hidden",
        transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `scale(${stateScale}) rotate(${stateRotate}deg)`,
      }}
    >
      <div
        ref={rootRef}
        style={{
          width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
        }}
      >
        <svg
          width={s} height={s} viewBox="0 0 400 400"
          style={{ display: "block" }}
        >
          <defs>
            <radialGradient id="skinGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={skin} />
              <stop offset="100%" stopColor={skinShadow} />
            </radialGradient>
            <radialGradient id="irisGradF" cx="45%" cy="40%" r="55%">
              <stop offset="0%" stopColor="#b080ff" />
              <stop offset="60%" stopColor="#8a4fff" />
              <stop offset="100%" stopColor="#4a1a8a" />
            </radialGradient>
            <radialGradient id="irisGradM" cx="45%" cy="40%" r="55%">
              <stop offset="0%" stopColor="#80b0ff" />
              <stop offset="60%" stopColor="#4a7aff" />
              <stop offset="100%" stopColor="#1a3a6a" />
            </radialGradient>
            <linearGradient id="hairGradF" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={hairLight} />
              <stop offset="60%" stopColor={hairMain} />
              <stop offset="100%" stopColor="#2a1050" />
            </linearGradient>
            <linearGradient id="hairGradM" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={hairLight} />
              <stop offset="60%" stopColor={hairMain} />
              <stop offset="100%" stopColor="#0a1a2a" />
            </linearGradient>
            <filter id="softGlow">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Hair back */}
          {isFemale ? (
            <path d="M 90 200 C 70 120, 110 60, 200 50 C 290 60, 330 120, 310 200 C 320 270, 300 340, 275 370 C 260 385, 240 370, 235 350 C 230 330, 245 300, 250 265 C 255 240, 265 210, 270 190 C 270 170, 265 150, 250 135 C 235 120, 215 115, 200 115 C 185 115, 165 120, 150 135 C 135 150, 130 170, 130 190 C 135 210, 145 240, 150 265 C 155 300, 170 330, 165 350 C 160 370, 140 385, 125 370 C 100 340, 80 270, 90 200 Z" fill="url(#hairGradF)" />
          ) : (
            <path d="M 85 205 C 70 135, 105 70, 200 60 C 295 70, 330 135, 315 205 C 320 240, 315 270, 305 290 C 295 300, 280 290, 275 275 C 270 260, 278 240, 280 220 C 282 200, 278 175, 265 158 C 250 140, 230 132, 200 130 C 170 132, 150 140, 135 158 C 122 175, 118 200, 120 220 C 122 240, 130 260, 125 275 C 120 290, 105 300, 95 290 C 85 270, 80 240, 85 205 Z" fill="url(#hairGradM)" />
          )}

          {/* Hair highlight strands - female */}
          {isFemale && (
            <>
              <path d="M 120 100 C 140 90, 170 80, 200 78 C 230 80, 260 90, 280 100" fill="none" stroke="#7a4ab5" strokeWidth="1.5" opacity="0.3" />
              <path d="M 135 115 C 155 105, 180 95, 200 93 C 220 95, 245 105, 265 115" fill="none" stroke="#7a4ab5" strokeWidth="1" opacity="0.25" />
            </>
          )}

          {/* Ears */}
          <ellipse cx="95" cy="215" rx="14" ry="22" fill="url(#skinGrad)" />
          <ellipse cx="95" cy="215" rx="6" ry="12" fill={skinShadow} opacity="0.5" />
          <ellipse cx="305" cy="215" rx="14" ry="22" fill="url(#skinGrad)" />
          <ellipse cx="305" cy="215" rx="6" ry="12" fill={skinShadow} opacity="0.5" />

          {/* Face */}
          <ellipse cx="200" cy="218" rx={isFemale ? 105 : 100} ry={isFemale ? 132 : 125} fill="url(#skinGrad)" />
          <ellipse cx="200" cy="218" rx={isFemale ? 105 : 100} ry={isFemale ? 132 : 125} fill="none" stroke={skinShadow} strokeWidth="8" opacity="0.3" />

          {/* Jawline - male */}
          {!isFemale && (
            <path d="M 130 260 Q 200 310 270 260" fill="none" stroke={skinShadow} strokeWidth="2" opacity="0.4" />
          )}

          {/* Blush - female */}
          {isFemale && (
            <>
              <ellipse cx="145" cy="208" rx="20" ry="10" fill="#ff9eb5" opacity="0.25" filter="url(#softGlow)" />
              <ellipse cx="255" cy="208" rx="20" ry="10" fill="#ff9eb5" opacity="0.25" filter="url(#softGlow)" />
            </>
          )}

          {/* Eyebrows */}
          <g>
            <path
              d={isFemale ? "M 135 138 Q 160 128 185 135" : "M 135 140 Q 160 132 185 138"}
              fill="none" stroke="#2a1a1a" strokeWidth="2.5" strokeLinecap="round"
              opacity={state === "thinking" ? 0.7 : 1}
            >
              {state === "thinking" && (
                <animate attributeName="d" values="M 135 138 Q 160 128 185 135;M 135 134 Q 160 124 185 131;M 135 138 Q 160 128 185 135" dur="1.5s" repeatCount="indefinite" />
              )}
            </path>
            <path
              d={isFemale ? "M 215 135 Q 240 128 265 138" : "M 215 138 Q 240 132 265 140"}
              fill="none" stroke="#2a1a1a" strokeWidth="2.5" strokeLinecap="round"
              opacity={state === "thinking" ? 0.7 : 1}
            >
              {state === "thinking" && (
                <animate attributeName="d" values="M 215 135 Q 240 128 265 138;M 215 131 Q 240 124 265 134;M 215 135 Q 240 128 265 138" dur="1.5s" repeatCount="indefinite" />
              )}
            </path>
          </g>

          {/* Eyes */}
          <g>
            {/* Left eye shadow */}
            <ellipse cx="162" cy="180" rx="24" ry="28" fill={skinShadow} opacity="0.3" />
            <path d="M 138 160 Q 162 148 186 160" fill="none" stroke={skinShadow} strokeWidth="1.5" opacity="0.5" />

            {/* Left eye white */}
            <ellipse cx="162" cy="178" rx="22" ry={isFemale ? 26 : 22} fill="#f8f8ff" />
            <ellipse cx="162" cy="178" rx="22" ry={isFemale ? 26 : 22} fill="none" stroke="#1a0a1a" strokeWidth="2.5" />
            <path d="M 140 172 Q 142 162 146 158" fill="none" stroke="#1a0a1a" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 148 165 Q 150 158 154 155" fill="none" stroke="#1a0a1a" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 184 172 Q 182 162 178 158" fill="none" stroke="#1a0a1a" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 176 165 Q 174 158 170 155" fill="none" stroke="#1a0a1a" strokeWidth="1.5" strokeLinecap="round" />

            {/* Left iris */}
            <ellipse cx="164" cy="179" rx={isFemale ? 14 : 12} ry={isFemale ? 17 : 14} fill={`url(${isFemale ? "#irisGradF" : "#irisGradM"})`} />
            <ellipse cx="164" cy="179" rx={isFemale ? 7 : 6} ry={isFemale ? 9 : 7} fill="#0a0a1a" />
            <ellipse cx="158" cy="171" rx="5" ry="5.5" fill="white" />
            <ellipse cx="172" cy="175" rx="2" ry="3" fill="white" />

            {/* Left eyelid (blink) */}
            <ellipse id="lefteyelid" cx="162" cy="178" rx="23" ry={isFemale ? 27 : 23} fill={skin} style={{ transformOrigin: "162px 178px" }} opacity="0" />

            {/* Right eye shadow */}
            <ellipse cx="238" cy="180" rx="24" ry="28" fill={skinShadow} opacity="0.3" />
            <path d="M 214 160 Q 238 148 262 160" fill="none" stroke={skinShadow} strokeWidth="1.5" opacity="0.5" />

            {/* Right eye white */}
            <ellipse cx="238" cy="178" rx="22" ry={isFemale ? 26 : 22} fill="#f8f8ff" />
            <ellipse cx="238" cy="178" rx="22" ry={isFemale ? 26 : 22} fill="none" stroke="#1a0a1a" strokeWidth="2.5" />
            <path d="M 216 172 Q 218 162 222 158" fill="none" stroke="#1a0a1a" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 224 165 Q 226 158 230 155" fill="none" stroke="#1a0a1a" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 260 172 Q 258 162 254 158" fill="none" stroke="#1a0a1a" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 252 165 Q 250 158 246 155" fill="none" stroke="#1a0a1a" strokeWidth="1.5" strokeLinecap="round" />

            {/* Right iris */}
            <ellipse cx="236" cy="179" rx={isFemale ? 14 : 12} ry={isFemale ? 17 : 14} fill={`url(${isFemale ? "#irisGradF" : "#irisGradM"})`} />
            <ellipse cx="236" cy="179" rx={isFemale ? 7 : 6} ry={isFemale ? 9 : 7} fill="#0a0a1a" />
            <ellipse cx="230" cy="171" rx="5" ry="5.5" fill="white" />
            <ellipse cx="244" cy="175" rx="2" ry="3" fill="white" />

            {/* Right eyelid (blink) */}
            <ellipse id="righteyelid" cx="238" cy="178" rx="23" ry={isFemale ? 27 : 23} fill={skin} style={{ transformOrigin: "238px 178px" }} opacity="0" />
          </g>

          {/* Nose */}
          <path d="M 197 194 Q 200 208 204 194" fill="none" stroke={skinTone} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 200 208 Q 200 210 201 208" fill="none" stroke={skinTone} strokeWidth="1" strokeLinecap="round" />

          {/* Mouth */}
          <g ref={mouthRef}>
            <ellipse id="mouth-interior" cx="200" cy="250" rx="28" ry="0" fill="#1a0505" />
            <path id="upper-lip" d="M 172 250 Q 200 255 228 250" fill="none" stroke={lipColor} strokeWidth="2.2" strokeLinecap="round" />
            <path id="lower-lip" d="M 172 250 Q 200 255 228 250" fill="none" stroke={lipColor} strokeWidth="2.2" strokeLinecap="round" />
          </g>

          {/* Chin highlight */}
          <ellipse cx="200" cy="290" rx="25" ry="5" fill={skin} opacity="0.5" filter="url(#softGlow)" />

          {/* Neck */}
          <path
            d={isFemale
              ? "M 178 340 L 178 370 Q 200 378 222 370 L 222 340"
              : "M 175 338 L 175 370 Q 200 380 225 370 L 225 338"
            }
            fill="url(#skinGrad)"
          />
          <path
            d={isFemale
              ? "M 178 340 L 178 370 Q 200 378 222 370 L 222 340"
              : "M 175 338 L 175 370 Q 200 380 225 370 L 225 338"
            }
            fill="none" stroke={skinShadow} strokeWidth="2" opacity="0.3"
          />

          {/* Shoulders */}
          <path
            d="M 110 370 C 90 385, 75 400, 70 420 L 330 420 C 325 400, 310 385, 290 370"
            fill={isFemale ? "#2a1a3a" : "#1a2a3a"}
          />
          {isFemale && (
            <>
              <path d="M 110 370 C 130 380, 150 385, 170 382" fill="none" stroke="#4a2a5a" strokeWidth="1" opacity="0.5" />
              <path d="M 290 370 C 270 380, 250 385, 230 382" fill="none" stroke="#4a2a5a" strokeWidth="1" opacity="0.5" />
            </>
          )}

          {/* Collar */}
          <path
            d={isFemale ? "M 175 375 L 200 390 L 225 375" : "M 178 375 L 200 388 L 222 375"}
            fill="none" stroke={isFemale ? "#5a3a6a" : "#3a4a5a"} strokeWidth="1.5" opacity="0.6"
          />

          {/* Bangs */}
          {isFemale ? (
            <>
              <path d="M 85 200 C 85 130, 120 80, 165 68 C 175 65, 185 64, 195 66 C 185 72, 175 80, 168 90 C 155 85, 140 88, 128 100 C 118 110, 110 125, 105 142 C 100 158, 95 178, 88 195 Z" fill="url(#hairGradF)" />
              <path d="M 195 66 C 210 64, 230 68, 240 75 C 250 82, 260 92, 268 105 C 275 118, 282 135, 290 155 C 295 170, 300 185, 310 200 C 305 178, 298 158, 290 140 C 282 122, 272 108, 260 98 C 248 88, 235 80, 220 75 C 210 72, 200 70, 195 66 Z" fill="url(#hairGradF)" />
              <path d="M 85 200 C 82 220, 85 250, 90 275 C 92 285, 95 295, 100 305 C 98 290, 95 270, 94 250 C 93 230, 92 215, 85 200 Z" fill="url(#hairGradF)" />
              <path d="M 310 200 C 315 230, 312 260, 308 285 C 305 295, 302 305, 298 310 C 300 295, 303 275, 304 255 C 305 235, 308 218, 310 200 Z" fill="url(#hairGradF)" />
              <path d="M 175 68 C 168 78, 162 90, 158 105 C 155 115, 153 128, 152 140 C 153 128, 157 115, 162 105 C 168 92, 175 80, 175 68 Z" fill="#7a4ab5" opacity="0.4" />
            </>
          ) : (
            <>
              <path d="M 85 205 C 88 155, 110 110, 145 90 C 160 82, 178 76, 200 72 C 195 78, 188 85, 182 95 C 170 90, 155 95, 142 108 C 130 120, 118 140, 110 162 C 105 178, 100 195, 90 208 Z" fill="url(#hairGradM)" />
              <path d="M 200 72 C 220 76, 240 82, 255 92 C 268 102, 278 118, 286 138 C 292 155, 298 175, 305 195 C 310 178, 312 160, 310 140 C 308 120, 300 100, 288 88 C 275 76, 260 70, 245 66 C 230 64, 215 64, 200 72 Z" fill="url(#hairGradM)" />
              <path d="M 145 90 C 150 78, 160 65, 175 58 C 165 68, 158 80, 150 90 Z" fill={hairLight} opacity="0.5" />
              <path d="M 255 92 C 248 80, 238 68, 225 62 C 235 72, 243 84, 250 92 Z" fill={hairLight} opacity="0.5" />
              <path d="M 200 72 C 200 60, 205 50, 210 45 C 205 55, 205 65, 200 72 Z" fill={hairLight} opacity="0.5" />
            </>
          )}

          {/* Active listening pulse */}
          {state === "listening" && (
            <g filter="url(#softGlow)">
              <ellipse cx="200" cy="210" rx="115" ry="135" fill="none" stroke="#6bcf" strokeWidth="1.5" opacity="0.4">
                <animate attributeName="rx" values="115;125;115" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="ry" values="135;145;135" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.1;0.4" dur="1.5s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx="200" cy="210" rx="120" ry="140" fill="none" stroke="#6bcf" strokeWidth="1" opacity="0.2">
                <animate attributeName="rx" values="120;135;120" dur="1.5s" begin="0.3s" repeatCount="indefinite" />
                <animate attributeName="ry" values="140;155;140" dur="1.5s" begin="0.3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.2;0;0.2" dur="1.5s" begin="0.3s" repeatCount="indefinite" />
              </ellipse>
            </g>
          )}

          {/* Speaking glow */}
          {state === "speaking" && (
            <g filter="url(#softGlow)">
              <ellipse cx="200" cy="210" rx="112" ry="132" fill="none" stroke="#8a4fff" strokeWidth="1.5" opacity="0.3">
                <animate attributeName="opacity" values="0.3;0.05;0.3" dur="0.8s" repeatCount="indefinite" />
              </ellipse>
            </g>
          )}

          {/* Thinking sparkle */}
          {state === "thinking" && (
            <g opacity="0.7" filter="url(#softGlow)">
              <text x="290" y="100" fontSize="16" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                &#10022;
                <animate attributeName="opacity" values="0;1;0" dur="1.2s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-8;0,0" dur="1.2s" repeatCount="indefinite" />
              </text>
              <text x="275" y="88" fontSize="11" fill="#6bcf" textAnchor="middle" fontFamily="sans-serif">
                &#10022;
                <animate attributeName="opacity" values="0;0.6;0" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-6;0,0" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
              </text>
            </g>
          )}
        </svg>

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
