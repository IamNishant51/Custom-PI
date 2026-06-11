import { useEffect, useRef, type RefObject } from "react";

export function useCanvasFlowField(canvasRef: RefObject<HTMLCanvasElement | null>, colors?: string[]) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const COLORS = colors || ["#ff7a17", "#7c3aed", "#00d7ff", "#ff3b30"];
    const FADE = "rgba(10,10,10,0.06)";
    let animId = 0;
    let W = 0, H = 0;
    const particles: Array<{ x: number; y: number; life: number; c: string }> = [];

    function n2(x: number, y: number) {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return n - Math.floor(n);
    }

    function noise(x: number, y: number) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const a = n2(ix, iy), b = n2(ix + 1, iy);
      const c = n2(ix, iy + 1), d = n2(ix + 1, iy + 1);
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    }

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      W = parent.clientWidth;
      H = parent.clientHeight;
      canvas!.width = W * 2;
      canvas!.height = H * 2;
      canvas!.style.width = W + "px";
      canvas!.style.height = H + "px";
      ctx!.setTransform(2, 0, 0, 2, 0, 0);
      if (!particles.length) {
        for (let i = 0; i < 180; i++) {
          particles.push({
            x: Math.random() * W,
            y: Math.random() * H,
            life: Math.random(),
            c: COLORS[i % COLORS.length],
          });
        }
      }
    }

    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    function draw() {
      ctx!.fillStyle = FADE;
      ctx!.fillRect(0, 0, W, H);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const ang = noise(p.x * 0.004 + t * 0.0008, p.y * 0.004 + 100) * Math.PI * 6;
        const sp = 1 + noise(p.x * 0.003, p.y * 0.003 + 50) * 1.5;
        p.x += Math.cos(ang) * sp;
        p.y += Math.sin(ang) * sp;
        p.life -= 0.001;
        if (p.life <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
          p.x = Math.random() * W;
          p.y = Math.random() * H;
          p.life = 1;
        }
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
        ctx!.fillStyle = p.c;
        ctx!.globalAlpha = p.life * 0.2;
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      t++;
      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      particles.length = 0;
    };
  }, [canvasRef, colors]);
}

export function useSectionReveal(ref: RefObject<HTMLElement | null>, options?: IntersectionObserverInit) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("in");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, ...options }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, options]);
}

export function useTypewriter(
  text: string,
  speed: number = 40,
  enabled: boolean = true
): string {
  const idx = useRef(0);
  const displaying = useRef("");

  if (!enabled) return text;

  useEffect(() => {
    if (!enabled) return;
    idx.current = 0;
    displaying.current = "";
    const timer = setInterval(() => {
      if (idx.current < text.length) {
        displaying.current += text[idx.current];
        idx.current++;
      } else {
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed, enabled]);

  return enabled ? displaying.current : text;
}
