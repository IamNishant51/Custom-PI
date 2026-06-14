type AudioStateCallback = (state: "idle" | "speaking") => void;

class StreamingAudioQueue {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private queue: AudioBuffer[] = [];
  private nextPlayTime = 0;
  private fadeDuration = 0.05; // 50ms crossfade
  private activeSources: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private onStateChange: AudioStateCallback;

  constructor(ctx: AudioContext, analyser: AnalyserNode, onStateChange: AudioStateCallback) {
    this.ctx = ctx;
    this.analyser = analyser;
    this.onStateChange = onStateChange;
  }

  async enqueueBase64(base64: string) {
    if (!base64 || base64.length < 100) return;
    try {
      const binary = atob(base64);
      const len = binary.length;
      const arrayBuf = new ArrayBuffer(len);
      const view = new Uint8Array(arrayBuf);
      for (let i = 0; i < len; i++) {
        view[i] = binary.charCodeAt(i);
      }
      const buffer = await this.ctx.decodeAudioData(arrayBuf);
      this.enqueue(buffer);
    } catch (e) {
      console.error("[audio] decode failed in stream:", e);
    }
  }

  enqueue(buffer: AudioBuffer) {
    this.queue.push(buffer);
    this.scheduleNext();
  }

  private scheduleNext() {
    if (this.queue.length === 0) {
      this.checkIdle();
      return;
    }

    const now = this.ctx.currentTime;
    if (this.nextPlayTime < now) {
      // Reset playhead if we're starting fresh or fell behind
      this.nextPlayTime = now + 0.02; // Small 20ms offset to avoid clipping
    }

    const buffer = this.queue.shift()!;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.ctx.createGain();
    source.connect(gainNode);
    gainNode.connect(this.analyser);

    const startTime = this.nextPlayTime;
    const duration = buffer.duration;
    const startFadeOut = startTime + duration - this.fadeDuration;

    // Fade in
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(1, startTime + this.fadeDuration);

    // Fade out (crossfade start)
    gainNode.gain.setValueAtTime(1, startFadeOut);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    source.start(startTime);
    this.onStateChange("speaking");

    const item = { source, gain: gainNode };
    this.activeSources.push(item);

    source.onended = () => {
      this.activeSources = this.activeSources.filter(x => x.source !== source);
      source.disconnect();
      gainNode.disconnect();
      this.checkIdle();
    };

    // Calculate start time for next buffer (overlap during fadeout)
    this.nextPlayTime = startFadeOut;

    // Recursively schedule next if available
    this.scheduleNext();
  }

  private checkIdle() {
    if (this.activeSources.length === 0 && this.queue.length === 0) {
      this.onStateChange("idle");
    }
  }

  stop() {
    this.queue = [];
    this.activeSources.forEach(x => {
      try { x.source.stop(); } catch {}
      try { x.source.disconnect(); } catch {}
      try { x.gain.disconnect(); } catch {}
    });
    this.activeSources = [];
    this.nextPlayTime = 0;
    this.onStateChange("idle");
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private onStateChange: AudioStateCallback | null = null;
  private _resumed = false;
  private _volume = 1.0;
  private _currentSource: AudioBufferSourceNode | null = null;
  private _currentResolve: (() => void) | null = null;
  private streamQueue: StreamingAudioQueue | null = null;

  setStateCallback(fn: AudioStateCallback) {
    this.onStateChange = fn;
  }

  get analyserNode() {
    return this.analyser;
  }

  get context() {
    return this.ctx;
  }

  get resumed() {
    return this._resumed;
  }

  get isRunning() {
    return this.ctx?.state === "running";
  }

  setVolume(v: number) {
    this._volume = Math.max(0, v);
    if (this.gain) {
      this.gain.gain.value = this._volume;
    }
  }

  async resume() {
    if (this._resumed && this.ctx?.state === "running") return;
    if (this.ctx && this.ctx.state === "closed") {
      this.ctx = null;
      this.analyser = null;
      this.gain = null;
      this._resumed = false;
      this.streamQueue = null;
    }
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this._volume;
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch (e) {
        console.warn("[audio] resume failed:", e);
        this._resumed = false;
        throw e;
      }
    }
    this._resumed = true;
  }

  async playTestTone(): Promise<void> {
    if (!this.ctx || !this.analyser || !this.gain) return;
    this.stop();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.15, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = 0.6 * Math.sin(2 * Math.PI * 440 * i / this.ctx.sampleRate) * (1 - i / d.length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    src.start();
  }

  stop() {
    this.stopStreamQueue();
    if (this._currentSource) {
      try { this._currentSource.stop(); } catch {}
      try { this._currentSource.disconnect(); } catch {}
      this._currentSource = null;
    }
    const r = this._currentResolve;
    this._currentResolve = null;
    this.onStateChange?.("idle");
    r?.();
  }

  initStreamQueue() {
    if (!this.ctx || !this.analyser) return;
    this.streamQueue = new StreamingAudioQueue(this.ctx, this.analyser, (state) => {
      this.onStateChange?.(state);
    });
  }

  enqueueStreamChunk(base64: string) {
    if (!this.streamQueue) {
      this.initStreamQueue();
    }
    this.streamQueue?.enqueueBase64(base64);
  }

  stopStreamQueue() {
    if (this.streamQueue) {
      this.streamQueue.stop();
      this.streamQueue = null;
    }
  }

  async playBase64Audio(base64: string, sampleRate: number): Promise<void> {
    if (!base64 || base64.length < 100) {
      console.warn("[audio] Audio data too short, skipping playback");
      return;
    }

    if (this.ctx && this.analyser && this.gain) {
      try {
        const binary = atob(base64);
        const len = binary.length;
        const arrayBuf = new ArrayBuffer(len);
        const view = new Uint8Array(arrayBuf);
        for (let i = 0; i < len; i++) {
          view[i] = binary.charCodeAt(i);
        }
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuf);
        const ch = audioBuffer.getChannelData(0);
        let maxVal = 0;
        for (let i = 0; i < ch.length; i++) {
          const abs = Math.abs(ch[i]);
          if (abs > maxVal) maxVal = abs;
        }
        if (maxVal < 0.001) {
          console.warn("[audio] Audio buffer is near-silent, skipping playback");
          return;
        }

        this.stop();
        const source = this.ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.analyser);
        this._currentSource = source;

        return new Promise((resolve) => {
          this._currentResolve = resolve;
          this.onStateChange?.("speaking");
          source.start();
          source.onended = () => {
            if (this._currentSource === source) {
              this._currentSource = null;
              this._currentResolve = null;
            }
            this.onStateChange?.("idle");
            resolve();
          };
        });
      } catch (e) {
        console.warn("[audio] AudioContext playback failed, falling back:", e);
      }
    }

    return new Promise((resolve) => {
      this.onStateChange?.("speaking");
      this._currentResolve = resolve;
      const audio = new Audio(`data:audio/wav;base64,${base64}`);
      audio.volume = 1.0;
      audio.onended = () => {
        this._currentResolve = null;
        this.onStateChange?.("idle");
        resolve();
      };
      audio.play().catch((e) => {
        this._currentResolve = null;
        this.onStateChange?.("idle");
        resolve();
      });
    });
  }

  playPcm16Chunks(chunks: Int16Array[], sampleRate: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ctx || !this.analyser || !this.gain) {
        reject(new Error("AudioEngine not initialized"));
        return;
      }

      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Int16Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
      }

      const floatData = new Float32Array(combined.length);
      for (let i = 0; i < combined.length; i++) {
        floatData[i] = combined[i] / 32768;
      }

      const buffer = this.ctx.createBuffer(1, floatData.length, sampleRate);
      buffer.getChannelData(0).set(floatData);

      this.stop();
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyser);

      this.onStateChange?.("speaking");
      source.start();
      source.onended = () => {
        this.onStateChange?.("idle");
        resolve();
      };
    });
  }

  destroy() {
    this.stop();
    if (this.ctx && this.ctx.state !== "closed") {
      this.ctx.close();
    }
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this._resumed = false;
  }
}
