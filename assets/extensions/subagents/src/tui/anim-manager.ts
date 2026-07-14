import { logger } from "../logger";

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const THINKING = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const VERBS = [
  "Analyzing", "Synthesizing", "Exploring", "Architecting", "Weaving",
  "Scaffolding", "Resonating", "Iterating", "Deep-diving", "Aligning",
  "Optimizing", "Translating", "Indexing", "Reconfiguring", "Bootstrapping",
  "Calibrating", "Orchestrating", "Manifesting", "Crafting", "Forging",
  "Sculpting", "Decoding", "Cracking", "Solving", "Unraveling",
  "Churning", "Fermenting", "Composing", "Harmonizing", "Illuminating",
  "Enchanting", "Concocting", "Hatching", "Catalyzing", "Crystallizing",
  "Coalescing", "Reticulating", "Splining", "Frobnicating",
];

type AnimState = "requesting" | "thinking" | "responding" | "idle";

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const FAST = Array.from({ length: 40 }, () => 180 + Math.random() * 170);
const NORMAL = Array.from({ length: 30 }, () => 350 + Math.random() * 250);
const SLOW = Array.from({ length: 20 }, () => 600 + Math.random() * 400);
const HANG = Array.from({ length: 10 }, () => 1000 + Math.random() * 1000);
const POOL = shuffle([...FAST, ...NORMAL, ...SLOW, ...HANG]);
let poolIdx = 0;
function nextMs(): number {
  const v = POOL[poolIdx % POOL.length];
  poolIdx++;
  return v;
}

interface VerbInfo {
  verb: string;
  verbIndex: number;
  progress: number;
}

export class AnimManager {
  private state: AnimState = "idle";
  private frame = 0;
  private vi: VerbInfo = { verb: VERBS[0], verbIndex: 0, progress: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private alive = false;
  private lastMsg = "";

  constructor(
    private setMessage: (msg: string) => void,
    private setIndicator: (indicator?: { frames: string[]; intervalMs: number }) => void,
  ) {}

  private getFrames(): string[] {
    return this.state === "thinking" ? THINKING : BRAILLE;
  }

  private build(): string {
    const f = this.getFrames();
    const sp = f[this.frame % f.length];
    const v = this.vi.verb;
    const show = Math.min(this.vi.progress, v.length);
    const partial = v.slice(0, show);
    const suffix = show < v.length ? "…" : "...";
    this.lastMsg = `${sp} ${partial}${suffix}`;
    return this.lastMsg;
  }

  private tick() {
    if (!this.alive) return;
    const f = this.getFrames();
    this.frame = (this.frame + 1) % f.length;
    this.vi.progress++;
    if (this.vi.progress > this.vi.verb.length + 3) {
      this.vi.verbIndex = (this.vi.verbIndex + 1) % VERBS.length;
      this.vi.verb = VERBS[this.vi.verbIndex];
      this.vi.progress = 0;
    }
    this.setMessage(this.build());
    const delay = this.state === "idle" ? 500 : this.state === "thinking" ? nextMs() * 1.5 : nextMs();
    this.timer = setTimeout(() => this.tick(), delay);
    if (typeof this.timer?.unref === "function") this.timer.unref();
  }

  start(initialState: AnimState = "requesting") {
    if (this.alive) return;
    this.alive = true;
    this.state = initialState;
    this.frame = 0;
    this.vi = { verb: VERBS[0], verbIndex: 0, progress: 0 };
    this.setIndicator({ frames: this.getFrames(), intervalMs: 80 });
    this.timer = setTimeout(() => this.tick(), 50);
    if (typeof this.timer?.unref === "function") this.timer.unref();
  }

  stop() {
    this.alive = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.setMessage("");
    this.setIndicator();
    this.state = "idle";
  }

  setState(s: AnimState) {
    if (s !== this.state) {
      this.state = s;
      this.frame = 0;
      if (this.alive) {
        this.setIndicator({ frames: this.getFrames(), intervalMs: 80 });
      }
    }
  }

  getState(): AnimState { return this.state; }
  getLastMessage(): string { return this.lastMsg; }
}
