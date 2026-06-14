import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import GlobeAvatar from "./GlobeAvatar";
import { showToast } from "./Toast";
import { AudioEngine } from "../lib/audio-engine";
import { Volume2, Plus, X } from "lucide-react";
import Markdown from "./Markdown";

interface VoicePreset {
  id: string;
  name: string;
  gender: string;
  desc: string;
  type?: string;
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
  const [activeVoice, setActiveVoice] = useState(() => localStorage.getItem("voiceAgentActiveVoice") || "af_bella");
  const [interimText, setInterimText] = useState("");
  const [ttsConnected, setTtsConnected] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("prompt");
  const [micStatusText, setMicStatusText] = useState("");
  const [textInput, setTextInput] = useState("");
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("voiceAgentVolume");
    return saved ? Number(saved) : 40;
  });

  // Voice cloning modal state
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneTranscript, setCloneTranscript] = useState("");
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  const audioEngineRef = useRef<AudioEngine | null>(null);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const [topbarActionsEl, setTopbarActionsEl] = useState<HTMLElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const activeWsRef = useRef<WebSocket | null>(null);

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
      audioEngineRef.current.setVolume((volume / 100) * 2.5);
    }
    return audioEngineRef.current;
  }, [volume, setStateSafe]);

  const ensureAudioContext = useCallback(async () => {
    const engine = getEngine();
    try {
      await engine.resume();
    } catch {
      // AudioContext resume may fail outside user gesture; ignore
    }
  }, [getEngine]);

  useEffect(() => {
    setTopbarActionsEl(document.getElementById("topbar-actions"));
    
    mountedRef.current = true;
    const fetchVoices = async () => {
      try {
        const r = await fetch("/api/voice/voices");
        const d = await r.json();
        if (!mountedRef.current) return;
        setVoices(d.voices || []);
        if (d.active && !localStorage.getItem("voiceAgentActiveVoice")) {
          setActiveVoice(d.active);
        }
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
      if (activeWsRef.current) {
        activeWsRef.current.close();
      }
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

  const playAudioResponse = useCallback(async (llmD: any) => {
    if (llmD.ttsError) {
      showToast(`Voice output: ${llmD.ttsError}`, "info");
      return;
    }
    if (!llmD.audio) {
      showToast("No audio response generated", "info");
      return;
    }
    const engine = getEngine();
    await engine.resume();
    await engine.playBase64Audio(llmD.audio, llmD.sampleRate || 24000);
  }, [getEngine]);

  const playSpecificText = useCallback(async (textToPlay: string) => {
    try {
      showToast("Generating voice...", "info");
      const r = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToPlay, voice: activeVoice }),
      });
      if (!r.ok) {
        showToast(`Failed to generate TTS: ${r.status}`, "error");
        return;
      }
      const d = await r.json();
      if (d.error) {
        showToast(`TTS error: ${d.error}`, "error");
        return;
      }
      await playAudioResponse(d);
    } catch (err: any) {
      showToast(`TTS failed: ${err.message}`, "error");
    }
  }, [activeVoice, playAudioResponse]);

  // WebSocket-based streaming pipeline integration
  const sendStreamingMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    await ensureAudioContext();
    const engine = getEngine();
    engine.stop(); // Clear any ongoing audio and stream queues

    // Add user message to history
    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);

    // Create placeholder message for agent streaming text
    const agentMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: agentMsgId, role: "agent", text: "" }]);

    setStateSafe("thinking");

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/voice/chat-stream`;
    const ws = new WebSocket(wsUrl);
    activeWsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "text", text, voice: activeVoice }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "status") {
          setStateSafe(msg.status);
        } else if (msg.type === "text_delta") {
          setMessages((prev) =>
            prev.map((m) => (m.id === agentMsgId ? { ...m, text: m.text + msg.delta } : m))
          );
        } else if (msg.type === "audio_chunk") {
          engine.enqueueStreamChunk(msg.audio);
        } else if (msg.type === "done") {
          setStateSafe("idle");
          ws.close();
        } else if (msg.type === "error") {
          showToast(msg.message, "error");
          setStateSafe("idle");
          ws.close();
        }
      } catch (e) {
        console.error("[voice-stream] parse error:", e);
      }
    };

    ws.onerror = (err) => {
      console.error("[voice-stream] error:", err);
      showToast("Voice stream connection error", "error");
      setStateSafe("idle");
    };

    ws.onclose = () => {
      activeWsRef.current = null;
      const cur = stateRef.current;
      setStateSafe(cur === "thinking" || cur === "speaking" ? "idle" : cur);
    };

  }, [activeVoice, getEngine, setStateSafe, ensureAudioContext]);

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
        showToast("No speech detected. Try speaking again.", "info");
        setStateSafe("idle");
        setInterimText("");
        return;
      }

      setInterimText("");
      await sendStreamingMessage(text);
    } catch (err: any) {
      if (!mountedRef.current) return;
      showToast(`Voice processing failed: ${err.message}`, "error");
      setStateSafe("idle");
      setInterimText("");
    }
  }, [sendStreamingMessage, setStateSafe]);

  const toggleMic = useCallback(async () => {
    await ensureAudioContext();

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
  }, [state, micStatus, startRecording, stopRecording, ensureAudioContext]);

  const sendTextMessage = useCallback(async () => {
    const txt = textInput.trim();
    if (!txt) return;
    setTextInput("");
    await sendStreamingMessage(txt);
  }, [textInput, sendStreamingMessage]);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  }, [sendTextMessage]);

  const changeVoice = useCallback(async (voiceId: string) => {
    setActiveVoice(voiceId);
    localStorage.setItem("voiceAgentActiveVoice", voiceId);
    try {
      await fetch("/api/voice/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voiceId }),
      });
    } catch {}
  }, []);

  const testAudio = useCallback(async () => {
    await ensureAudioContext();
    const engine = getEngine();
    await engine.playTestTone();
    showToast("Test tone played at 440Hz", "success");
  }, [ensureAudioContext, getEngine]);

  const handleCloneSubmit = async () => {
    if (!cloneName.trim() || !cloneTranscript.trim() || !cloneAudioFile) return;
    setIsCloning(true);
    showToast("Reading audio file...", "info");

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const base64Data = result.split(",")[1];
          resolve(base64Data);
        };
        reader.onerror = (err) => reject(err);
      });
      reader.readAsDataURL(cloneAudioFile);
      const audioBase64 = await base64Promise;

      showToast("Uploading and cloning voice (takes 10-30s)...", "info");

      const r = await fetch("/api/voice/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cloneName.trim(),
          transcript: cloneTranscript.trim(),
          audio: audioBase64
        })
      });

      if (!r.ok) {
        const errData = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(errData.error || r.statusText);
      }

      const d = await r.json();
      showToast(`Voice cloned successfully as ${d.name}!`, "success");
      
      setActiveVoice(d.voice_id);
      localStorage.setItem("voiceAgentActiveVoice", d.voice_id);

      const voicesR = await fetch("/api/voice/voices");
      const voicesD = await voicesR.json();
      setVoices(voicesD.voices || []);

      setIsCloneModalOpen(false);
      setCloneName("");
      setCloneTranscript("");
      setCloneAudioFile(null);
    } catch (err: any) {
      showToast(`Voice cloning failed: ${err.message}`, "error");
    } finally {
      setIsCloning(false);
    }
  };

  const groupVoices = (vs: VoicePreset[]) => {
    const groups: Record<string, VoicePreset[]> = {};
    for (const v of vs) {
      const type = v.type;
      const g = type === "clone" ? "Custom Clones" : (v.gender === "male" ? "Male" : "Female");
      if (!groups[g]) groups[g] = [];
      groups[g].push(v);
    }
    return groups;
  };

  const grouped = groupVoices(voices);
  const engine = getEngine();
  const analyserNode = engine.analyserNode;
  const needsMic = micStatus !== "granted";

  const stopSpeaking = useCallback(() => {
    getEngine().stop();
    setStateSafe("idle");
    setInterimText("");
  }, [getEngine, setStateSafe]);

  const renderTopBarActions = () => {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {needsMic ? (
          <button className="btn btn-primary" onClick={toggleMic}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 12px", fontSize: 12, height: 28, borderRadius: 14
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            {micStatus === "denied" ? "Try Again" : "Allow Mic"}
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className={`btn ${state === "listening" ? "btn-danger" : "btn-primary"}`}
              onClick={toggleMic}
              style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, transition: "all 0.2s", position: "relative", padding: 0
              }}
              title={state === "listening" ? "Stop recording" : "Start recording"}
            >
              {state === "listening" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="4" height="12" rx="1" /><rect x="14" y="6" width="4" height="12" rx="1" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              )}
            </button>
            {(state === "speaking" || state === "thinking") && (
              <button
                className="btn btn-danger"
                onClick={stopSpeaking}
                title="Stop speaking"
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, padding: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="5" height="12" rx="1" /><rect x="13" y="6" width="5" height="12" rx="1" /></svg>
              </button>
            )}
          </div>
        )}
        <div style={{ width: 1, height: 16, background: "var(--hairline)", margin: "0 4px" }} />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }} title={ttsConnected ? "TTS Server Online" : "TTS Server Offline"}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: ttsConnected ? "var(--success)" : "var(--danger)", animation: ttsConnected ? "pulse 2s infinite" : "none" }} />
          <span style={{ fontSize: 11, color: "var(--mute)", whiteSpace: "nowrap" }}>TTS</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 0, height: "100%" }}>
      {topbarActionsEl && createPortal(renderTopBarActions(), topbarActionsEl)}

      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        {/* Background Avatar */}
        <div style={{ position: "absolute", inset: 0, zIndex: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}>
          <GlobeAvatar state={state} analyserNode={analyserNode} size="100%" />
        </div>

        {/* Foreground Overlay */}
        <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", pointerEvents: "none" }}>
          {/* Top spacer to push content to bottom or center messages */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
            {!ttsConnected && (
              <div style={{ pointerEvents: "auto", fontSize: 11, color: "var(--danger)", textAlign: "center", maxWidth: 280, lineHeight: 1.5, padding: "6px 12px", background: "rgba(255,59,48,0.1)", backdropFilter: "blur(4px)", borderRadius: 6 }}>
                TTS server offline — responses will be text-only. Make sure the TTS server is running on port 8000.
              </div>
            )}

            {state === "listening" && (
              <div style={{ pointerEvents: "auto", fontSize: 12, color: "var(--accent)", textAlign: "center", maxWidth: 300, lineHeight: 1.5, animation: "pulse 1s infinite", background: "rgba(0,0,0,0.5)", padding: "4px 12px", borderRadius: 12 }}>
                Recording… tap the mic again to stop
              </div>
            )}

            {micStatus === "denied" && (
              <div style={{
                pointerEvents: "auto",
                background: "rgba(30,30,30,0.8)", backdropFilter: "blur(8px)",
                borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "var(--text)", textAlign: "left", maxWidth: 320, lineHeight: 1.6, border: "1px solid var(--hairline)"
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
              <div style={{ pointerEvents: "auto", background: "rgba(30,30,30,0.8)", backdropFilter: "blur(8px)", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "var(--mute)", textAlign: "center", maxWidth: 320, lineHeight: 1.6, border: "1px solid var(--hairline)" }}>
                {micStatusText}
              </div>
            )}

            {micStatus === "prompt" && !topbarActionsEl && (
              <div style={{ pointerEvents: "auto", fontSize: 12, color: "var(--mute)", textAlign: "center", maxWidth: 300, lineHeight: 1.5, background: "rgba(0,0,0,0.5)", padding: "4px 12px", borderRadius: 12 }}>
                Click the Allow Mic button in the top bar to enable voice.
              </div>
            )}

            {interimText && (
              <div style={{ pointerEvents: "auto", fontSize: 12, color: "var(--mute)", fontStyle: "italic", textAlign: "center", maxWidth: 300, background: "rgba(0,0,0,0.5)", padding: "4px 12px", borderRadius: 12 }}>
                {interimText}
              </div>
            )}

            {!needsMic && state === "idle" && messages.length === 0 && (
              <div style={{ pointerEvents: "auto", fontSize: 12, color: "var(--mute)", textAlign: "center", maxWidth: 300, lineHeight: 1.5, background: "rgba(0,0,0,0.5)", padding: "4px 12px", borderRadius: 12 }}>
                Tap the mic icon in the top bar and speak to talk with your AI agent.
              </div>
            )}
          </div>

          {/* Chat Interface pinned at the bottom */}
          <div style={{ pointerEvents: "auto", display: "flex", gap: 8, padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(12px)" }}>
            <input
              className="input"
              type="text"
              placeholder="Type a message…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleTextKeyDown}
              style={{ flex: 1, fontSize: 12, padding: "6px 10px", background: "rgba(0,0,0,0.4)" }}
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
            <div style={{ pointerEvents: "auto", flex: "0 0 auto", maxHeight: 180, overflowY: "auto", borderTop: "1px solid rgba(255,255,255,0.05)", padding: "8px 12px", background: "rgba(0,0,0,0.3)", backdropFilter: "blur(12px)" }}>
              {messages.map((m) => (
                <div key={m.id} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: m.role === "user" ? "var(--accent)" : "var(--text)", whiteSpace: "nowrap" }}>
                    {m.role === "user" ? "You:" : "AI:"}
                  </span>
                  {m.role === "user" ? (
                    <span style={{ color: "var(--mute)", lineHeight: 1.4 }}>{m.text}</span>
                  ) : (
                    <div style={{ lineHeight: 1.4, overflow: "hidden", color: "var(--text)", flex: 1 }}>
                      <Markdown content={m.text || "Thinking…"} />
                    </div>
                  )}
                  {m.role === "agent" && m.text && (
                    <button
                      className="btn"
                      onClick={() => playSpecificText(m.text)}
                      title="Play Audio"
                      style={{ padding: 4, height: "fit-content", background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <Volume2 size={14} style={{ color: "var(--accent)" }} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ pointerEvents: "auto", padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(12px)" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>Voice:</span>
            <select
              className="input"
              value={activeVoice}
              onChange={(e) => changeVoice(e.target.value)}
              style={{ flex: 1, minWidth: 120, fontSize: 11, padding: "4px 6px", background: "rgba(0,0,0,0.5)" }}
            >
              {Object.entries(grouped).map(([group, vs]) => (
                <optgroup key={group} label={group}>
                  {vs.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} — {v.desc}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              className="btn btn-secondary"
              onClick={() => setIsCloneModalOpen(true)}
              style={{ fontSize: 11, padding: "4px 8px", height: 24, display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              title="Clone a new voice"
            >
              <Plus size={10} />
              Clone
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                className="btn"
                onClick={testAudio}
                title="Play test tone"
                style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, padding: 0, border: "none", background: "transparent" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(255,255,255,0.7)" }}>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {volume > 0 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
                  {volume > 30 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
                </svg>
              </button>
              <input
                type="range" min="0" max="100" value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  localStorage.setItem("voiceAgentVolume", v.toString());
                  getEngine().setVolume((v / 100) * 2.5);
                }}
                style={{ width: 64, height: 4, accentColor: "var(--accent)", cursor: "pointer" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Voice Cloning Modal */}
      {isCloneModalOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          padding: 16, pointerEvents: "auto"
        }}>
          <div style={{
            background: "rgba(20,20,22,0.92)", backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12,
            width: "100%", maxWidth: 400, padding: 20,
            display: "flex", flexDirection: "column", gap: 16,
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Clone Voice</h3>
              <button
                onClick={() => {
                  setIsCloneModalOpen(false);
                  setCloneName("");
                  setCloneTranscript("");
                  setCloneAudioFile(null);
                }}
                style={{ background: "transparent", border: "none", color: "var(--mute)", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <X size={16} />
              </button>
            </div>
            
            <div style={{ fontSize: 11, color: "var(--mute)", lineHeight: 1.5, background: "rgba(255,255,255,0.02)", padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.04)" }}>
              🔒 <strong>Local GPU Required:</strong> Voice cloning uses F5-TTS locally. Upload a 10-30s clean WAV/MP3 clip of the speaker and provide its exact transcription.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "var(--mute)", fontWeight: 500 }}>Voice Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. My Voice"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                style={{ fontSize: 12, padding: "6px 10px", background: "rgba(0,0,0,0.3)" }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "var(--mute)", fontWeight: 500 }}>Reference Clip Transcript</label>
              <textarea
                className="input"
                placeholder="Type the exact text spoken in the audio clip..."
                value={cloneTranscript}
                onChange={(e) => setCloneTranscript(e.target.value)}
                rows={3}
                style={{ fontSize: 12, padding: "6px 10px", background: "rgba(0,0,0,0.3)", resize: "none" }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "var(--mute)", fontWeight: 500 }}>Reference Audio File (WAV/MP3)</label>
              <input
                type="file"
                accept="audio/wav,audio/mpeg,audio/mp3"
                onChange={(e) => setCloneAudioFile(e.target.files?.[0] || null)}
                style={{ fontSize: 11, color: "var(--text)", background: "transparent", border: "none" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 8, justifyContent: "flex-end" }}>
              <button
                className="btn"
                onClick={() => {
                  setIsCloneModalOpen(false);
                  setCloneName("");
                  setCloneTranscript("");
                  setCloneAudioFile(null);
                }}
                style={{ fontSize: 12, padding: "6px 12px" }}
                disabled={isCloning}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCloneSubmit}
                style={{ fontSize: 12, padding: "6px 16px" }}
                disabled={isCloning || !cloneName.trim() || !cloneTranscript.trim() || !cloneAudioFile}
              >
                {isCloning ? "Cloning..." : "Start Cloning"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
