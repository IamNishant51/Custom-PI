type AudioStateCallback = (state: "idle" | "speaking") => void;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private onStateChange: AudioStateCallback | null = null;
  private _resumed = false;
  private _volume = 1.0;
  private _currentSource: AudioBufferSourceNode | null = null;
  private _currentResolve: (() => void) | null = null;

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

  setVolume(v: number) {
    this._volume = Math.max(0, v);
    if (this.gain) {
      this.gain.gain.value = this._volume;
    }
  }

  async resume() {
    if (this._resumed) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this._volume;
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      console.log(`[audio] AudioContext created, state: ${this.ctx.state}, gain=${this._volume}`);
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
      console.log(`[audio] AudioContext resumed, state: ${this.ctx.state}`);
    }
    this._resumed = true;
  }

  async playTestTone(): Promise<void> {
    if (!this.ctx || !this.analyser || !this.gain) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.15, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = 0.6 * Math.sin(2 * Math.PI * 440 * i / this.ctx.sampleRate) * (1 - i / d.length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    src.start();
    console.log(`[audio] Test tone playing at 440Hz`);
  }

  stop() {
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

  async playBase64Audio(base64: string, sampleRate: number): Promise<void> {
    if (this.ctx && this.analyser && this.gain) {
      try {
        const binary = atob(base64);
        const len = binary.length;
        const arrayBuf = new ArrayBuffer(len);
        const view = new Uint8Array(arrayBuf);
        for (let i = 0; i < len; i++) {
          view[i] = binary.charCodeAt(i);
        }
        console.log(`[audio] decodeAudioData, size=${len} bytes, ctx.state=${this.ctx.state}`);
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuf);
        const ch = audioBuffer.getChannelData(0);
        let maxVal = 0;
        for (let i = 0; i < ch.length; i++) {
          const abs = Math.abs(ch[i]);
          if (abs > maxVal) maxVal = abs;
        }
        console.log(`[audio] Decoded buffer: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch, peak=${maxVal.toFixed(4)}`);
        if (maxVal < 0.001) console.warn("[audio] ⚠️ WARNING: Audio buffer is near-silent!");
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
        console.warn("[audio] AudioContext playback failed, falling back to Audio element:", e);
      }
    }

    // Fallback: use HTML Audio element (bypasses AudioContext issues)
    return new Promise((resolve) => {
      this._currentResolve = resolve;
      this.onStateChange?.("speaking");
      const audio = new Audio(`data:audio/wav;base64,${base64}`);
      audio.volume = 1.0;
      audio.onended = () => {
        this._currentResolve = null;
        this.onStateChange?.("idle");
        resolve();
      };
      audio.play().catch((e) => {
        console.error("[audio] Audio element playback failed:", e);
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
