const FRAMES: Record<string, string[]> = {
  requesting: ["◐", "◓", "◑", "◒"],
  thinking: ["◇", "◈", "◆", "◈"],
  responding: ["▃", "▄", "▅", "▆", "▇", "▆", "▅", "▄", "▃"],
};
const VERBS = [
  "Thinking", "Processing", "Reasoning", "Analyzing", "Researching",
  "Reading", "Searching", "Fetching", "Writing", "Editing",
  "Coding", "Building", "Planning", "Reviewing", "Testing",
  "Fixing", "Updating", "Creating", "Working",
];

type AnimState = "requesting" | "thinking" | "responding" | "idle";

export class AnimManager {
  private state: AnimState = "idle";
  private fi = 0;
  private vi = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private alive = false;
  private lastMsg = "";

  constructor(
    private setMessage: (msg: string) => void,
    private setIndicator: (indicator?: { frames: string[]; intervalMs: number }) => void,
  ) {}

  private getFrames(): string[] {
    return FRAMES[this.state] || FRAMES.requesting;
  }

  private build(): string {
    const f = this.getFrames();
    this.lastMsg = `${f[this.fi % f.length]} ${VERBS[this.vi]}...`;
    return this.lastMsg;
  }

  private tick() {
    if (!this.alive) return;
    const f = this.getFrames();
    this.fi = (this.fi + 1) % f.length;
    if (this.fi === 0) {
      this.vi = (this.vi + 1) % VERBS.length;
    }
    this.setMessage(this.build());
    this.timer = setTimeout(() => this.tick(), 120);
    if (typeof this.timer?.unref === "function") this.timer.unref();
  }

  start(initialState: AnimState = "requesting") {
    if (this.alive) return;
    this.alive = true;
    this.state = initialState;
    this.fi = 0;
    this.vi = 0;
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
      this.fi = 0;
      if (this.alive) {
        this.setIndicator({ frames: this.getFrames(), intervalMs: 80 });
      }
    }
  }

  getState(): AnimState { return this.state; }
  getLastMessage(): string { return this.lastMsg; }
}
