import { useState, useRef, useCallback, useEffect } from "react";
import AgentAvatar from "./AgentAvatar";
import { showToast } from "./Toast";
import { AudioEngine } from "../lib/audio-engine";
import Markdown from "./Markdown";

interface VoicePreset {
  id: string;
  name: string;
  gender: string;
  desc: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
}

type MicStatus = "prompt" | "granted" | "denied" | "unsupported";

async function requestMicPermission(): Promise<{ status: MicStatus; error?: string }> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return { status: "unsupported", error: "getUserMedia unavailable" };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return { status: "granted" };
  } catch (err: any) {
    console.error("[voice] getUserMedia error:", err?.name, err?.message);
    if (err?.name === "NotAllowedError") return { status: "denied", error: err.message };
    if (err?.name === "NotFoundError") return { status: "denied", error: "No microphone found" };
    if (err?.name === "NotReadableError") return { status: "denied", error: "Microphone busy or not available" };
    return { status: "unsupported", error: err?.message || "Unknown error" };
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buffer);
  const w = (s: string, o: number) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w("RIFF", 0); v.setUint32(4, 36 + dataSize, true);
  w("WAVE", 8); w("fmt ", 12); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, bitsPerSample, true);
  w("data", 36); v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    o += 2;
  }
  return buffer;
}

export default function VoicePanel() {
  const [state, setState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [voices, setVoices] = useState<VoicePreset[]>([]);
  const [activeVoice, setActiveVoice] = useState("af_bella");
  const [interimText, setInterimText] = useState("");
  const [ttsConnected, setTtsConnected] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("prompt");
  const [micStatusText, setMicStatusText] = useState("");
  const [textInput, setTextInput] = useState("");
  const [volume, setVolume] = useState(40);

  const audioEngineRef = useRef<AudioEngine | null>(null);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const setStateSafe = useCallback((s: typeof state) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const getEngine = useCallback(() => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new AudioEngine();
      audioEngineRef.current.setStateCallback((s) => {
        if (mountedRef.current) setStateSafe(s);
      });
    }
    return audioEngineRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const fetchVoices = async () => {
      try {
        const r = await fetch("/api/voice/voices");
        const d = await r.json();
        if (!mountedRef.current) return;
        setVoices(d.voices || []);
        if (d.active) setActiveVoice(d.active);
        setTtsConnected(true);
      } catch {
        if (mountedRef.current) setTtsConnected(false);
      }
    };
    fetchVoices();
    const iv = setInterval(fetchVoices, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      audioEngineRef.current?.destroy();
      cleanupRecording();
    };
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("unsupported");
      setMicStatusText("Your browser doesn't support microphone access. Use Chrome or Edge on localhost.");
    }
  }, []);

  function cleanupRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    recordedChunksRef.current = [];
  }

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { for (const t of stream.getTracks()) t.stop(); return; }
      streamRef.current = stream;
      recordedChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.start(100);
      setStateSafe("listening");
      setInterimText("");
    } catch (err: any) {
      console.error("[voice] startRecording error:", err);
      showToast(`Failed to start recording: ${err.message}`, "error");
    }
  }, [setStateSafe]);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }

    const chunks = recordedChunksRef.current;
    recordedChunksRef.current = [];
    if (chunks.length === 0) {
      setStateSafe("idle");
      return;
    }

    const blob = new Blob(chunks, { type: chunks[0].type });

    setInterimText("Transcribing...");
    setStateSafe("thinking");

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } finally {
        audioCtx.close();
      }
      const sampleRate = audioBuffer.sampleRate;
      const samples = audioBuffer.getChannelData(0);

      const wavBuf = encodeWav(samples, sampleRate);

      const r = await fetch("/api/voice/stt", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: new Blob([wavBuf], { type: "audio/wav" }),
      });
      if (!mountedRef.current) return;
      if (!r.ok) {
        const errData = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        showToast(`STT failed: ${errData.error || r.statusText}`, "error");
        setStateSafe("idle");
        setInterimText("");
        return;
      }
      const d = await r.json();
      const text = (d.text || "").trim();
      if (!text) {
        showToast("No speech detected. Try speaking again.", "error");
        setStateSafe("idle");
        setInterimText("");
        return;
      }

      setInterimText("");
      const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text };
      setMessages((prev) => [...prev, userMsg]);

      setInterimText("Thinking…");
      const llmR = await fetch("/api/voice/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: activeVoice }),
      });
      if (!mountedRef.current) return;
      if (!llmR.ok) {
        showToast(`LLM request failed (${llmR.status})`, "error");
        setStateSafe("idle");
        setInterimText("");
        return;
      }
      const llmD = await llmR.json();
      if (llmD.error) {
        showToast(llmD.error, "error");
        setStateSafe("idle");
        setInterimText("");
        return;
      }

      const replyText = llmD.reply || llmD.text || text;
      const agentMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: "agent", text: replyText };
      setMessages((prev) => [...prev, agentMsg]);

      setInterimText("Speaking…");
      if (llmD.audio) {
        console.log(`[voice] Playing audio (${llmD.audio.length} chars base64, ${llmD.sampleRate || 24000}Hz, server peak=${llmD.peak !== undefined ? llmD.peak : 'N/A'})`);
        const engine = getEngine();
        await engine.resume();
        await engine.playBase64Audio(llmD.audio, llmD.sampleRate || 24000);
        console.log(`[voice] Audio playback finished`);
      } else {
        console.log(`[voice] No audio in response`);
      }
      setInterimText("");
      setStateSafe("idle");
    } catch (err: any) {
      if (!mountedRef.current) return;
      console.error("[voice] stopRecording error:", err);
      showToast(`STT processing failed: ${err.message}`, "error");
      setStateSafe("idle");
      setInterimText("");
    }
  }, [activeVoice, getEngine, setStateSafe]);

  const toggleMic = useCallback(async () => {
    // Initialize audio engine inside user gesture (required for browser autoplay policy)
    const engine = getEngine();
    await engine.resume().catch(() => {});

    if (state === "listening") {
      await stopRecording();
      return;
    }

    if (micStatus !== "granted") {
      const { status, error } = await requestMicPermission();
      if (!mountedRef.current) return;
      setMicStatus(status);
      if (status === "granted") {
        setMicStatusText("");
      } else if (status === "denied") {
        setMicStatusText(
          error === "No microphone found"
            ? "No microphone detected. Connect a mic and try again."
            : "Microphone access blocked. Follow the steps below to fix it."
        );
        return;
      } else {
        setMicStatusText(
          error
            ? `Microphone unavailable (${error}). Use Chrome on localhost or HTTPS.`
            : "Microphone access is not available on this page. Use Chrome on localhost or HTTPS."
        );
        return;
      }
    }

    await startRecording();
  }, [state, micStatus, startRecording, stopRecording]);

  const sendTextMessage = useCallback(async () => {
    const txt = textInput.trim();
    if (!txt) return;
    setTextInput("");

    if (!mountedRef.current) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text: txt };
    setMessages((prev) => [...prev, userMsg]);
    setStateSafe("thinking");

    try {
      setInterimText("Thinking…");
      const r = await fetch("/api/voice/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: txt, voice: activeVoice }),
      });
      if (!mountedRef.current) return;
      const d = await r.json();
      if (d.error) {
        showToast(d.error, "error");
        setStateSafe("idle");
        setInterimText("");
        return;
      }
      const replyText = d.reply || d.text || txt;
      const agentMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: "agent", text: replyText };
      setMessages((prev) => [...prev, agentMsg]);

      setInterimText("Speaking…");
      if (d.audio) {
        console.log(`[voice] Playing audio (${d.audio.length} chars base64, server peak=${d.peak !== undefined ? d.peak : 'N/A'})`);
        const engine = getEngine();
        await engine.resume();
        await engine.playBase64Audio(d.audio, d.sampleRate || 24000);
        console.log(`[voice] Audio playback finished`);
      }
      setInterimText("");
      setStateSafe("idle");
    } catch (err: any) {
      if (!mountedRef.current) return;
      showToast(err.message || "Failed to get response", "error");
      setStateSafe("idle");
      setInterimText("");
    }
  }, [textInput, activeVoice, getEngine, setStateSafe]);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  }, [sendTextMessage]);

  const changeVoice = useCallback(async (voiceId: string) => {
    setActiveVoice(voiceId);
    try {
      await fetch("/api/voice/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voiceId }),
      });
    } catch {}
  }, []);

  const groupVoices = (vs: VoicePreset[]) => {
    const groups: Record<string, VoicePreset[]> = {};
    for (const v of vs) {
      const g = v.gender === "male" ? "Male" : "Female";
      if (!groups[g]) groups[g] = [];
      groups[g].push(v);
    }
    return groups;
  };

  const grouped = groupVoices(voices);
  const engine = getEngine();
  const analyserNode = engine.analyserNode;
  const needsMic = micStatus !== "granted";

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", padding: 0, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--hairline)", flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Voice Agent</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: ttsConnected ? "var(--success)" : "var(--danger)" }} />
          <span style={{ fontSize: 11, color: "var(--mute)" }}>{ttsConnected ? "TTS Ready" : "TTS Offline"}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 16, overflow: "hidden", minHeight: 0 }}>
        <AgentAvatar state={state} analyserNode={analyserNode} size={220} />

        {needsMic ? (
          <button className="btn btn-primary" onClick={toggleMic}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 20px", fontSize: 13,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            {micStatus === "denied" ? "Try Again" : "Allow Microphone Access"}
          </button>
        ) : (
          <button
            className={`btn ${state === "listening" ? "btn-danger" : "btn-primary"}`}
            onClick={toggleMic}
            style={{
              width: 64, height: 64, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, transition: "all 0.2s", position: "relative",
            }}
          >
            {state === "listening" ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="4" height="12" rx="1" /><rect x="14" y="6" width="4" height="12" rx="1" /></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        )}

        {state === "listening" && (
          <div style={{ fontSize: 12, color: "var(--accent)", textAlign: "center", maxWidth: 300, lineHeight: 1.5, animation: "pulse 1s infinite" }}>
            Recording… tap the mic again to stop
          </div>
        )}

        {micStatus === "denied" && (
          <div style={{
            background: "var(--bg-secondary)",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 12,
            color: "var(--text)",
            textAlign: "left",
            maxWidth: 320,
            lineHeight: 1.6,
            border: "1px solid var(--hairline)",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--danger)" }}>
              Microphone is blocked
            </div>
            <div style={{ color: "var(--mute)", marginBottom: 6 }}>
              Chrome has blocked microphone access for this site. To fix this:
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, color: "var(--mute)" }}>
              <li>Click the <strong>Not Secure</strong> or lock icon in the address bar (left of the URL)</li>
              <li>Click <strong>Site settings</strong></li>
              <li>Find <strong>Microphone</strong> and change it to <strong>Allow</strong></li>
              <li>Reload this page</li>
            </ol>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--mute)", borderTop: "1px solid var(--hairline)", paddingTop: 6 }}>
              Or type <code style={{ background: "var(--bg)", padding: "1px 4px", borderRadius: 3 }}>chrome://settings/content/microphone</code> in the address bar.
            </div>
          </div>
        )}

        {micStatus === "unsupported" && micStatusText && (
          <div style={{
            background: "var(--bg-secondary)",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 12,
            color: "var(--mute)",
            textAlign: "center",
            maxWidth: 320,
            lineHeight: 1.6,
            border: "1px solid var(--hairline)",
          }}>
            {micStatusText}
          </div>
        )}

        {micStatus === "prompt" && (
          <div style={{ fontSize: 12, color: "var(--mute)", textAlign: "center", maxWidth: 300, lineHeight: 1.5 }}>
            Click the button above to allow microphone access. Your browser will show a permission prompt.
          </div>
        )}

        {interimText && (
          <div style={{ fontSize: 12, color: "var(--mute)", fontStyle: "italic", textAlign: "center", maxWidth: 300 }}>
            {interimText}
          </div>
        )}

        {!needsMic && state === "idle" && messages.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--mute)", textAlign: "center", maxWidth: 300, lineHeight: 1.5 }}>
            Tap the mic and speak to talk with your AI agent.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, padding: "8px 16px", borderTop: "1px solid var(--hairline)", flexShrink: 0 }}>
        <input
          className="input"
          type="text"
          placeholder="Type a message…"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleTextKeyDown}
          style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}
          disabled={state === "listening" || state === "thinking" || state === "speaking"}
        />
        <button
          className="btn btn-primary"
          onClick={sendTextMessage}
          style={{ fontSize: 12, padding: "6px 14px" }}
          disabled={!textInput.trim() || state === "listening" || state === "thinking" || state === "speaking"}
        >
          Send
        </button>
      </div>

      {messages.length > 0 && (
        <div style={{ flex: "0 0 auto", maxHeight: 180, overflowY: "auto", borderTop: "1px solid var(--hairline)", padding: "8px 12px" }}>
          {messages.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: m.role === "user" ? "var(--accent)" : "var(--text)", whiteSpace: "nowrap" }}>
                {m.role === "user" ? "You:" : "AI:"}
              </span>
              {m.role === "user" ? (
                <span style={{ color: "var(--mute)", lineHeight: 1.4 }}>{m.text}</span>
              ) : (
                <div style={{ lineHeight: 1.4, overflow: "hidden" }}>
                  <Markdown content={m.text} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "8px 16px", borderTop: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "var(--mute)", whiteSpace: "nowrap" }}>Voice:</span>
        <select
          className="input"
          value={activeVoice}
          onChange={(e) => changeVoice(e.target.value)}
          style={{ flex: 1, minWidth: 120, fontSize: 11, padding: "4px 6px" }}
        >
          {Object.entries(grouped).map(([group, vs]) => (
            <optgroup key={group} label={group}>
              {vs.map((v) => (
                <option key={v.id} value={v.id}>{v.name} — {v.desc}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mute)", flexShrink: 0 }}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {volume > 0 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
            {volume > 30 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
          </svg>
          <input
            type="range" min="0" max="100" value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              getEngine().setVolume((v / 100) * 2.5);
            }}
            style={{ width: 64, height: 4, accentColor: "var(--accent)", cursor: "pointer" }}
          />
        </div>
      </div>
    </div>
  );
}
