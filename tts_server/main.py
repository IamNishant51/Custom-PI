#!/usr/bin/env python3
"""Local TTS server with Kokoro (CPU) + Piper (CPU, multi-voice)."""

import asyncio
import base64
import io
import json
import logging
import os
import struct
import time
import wave
import importlib.util

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server")

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_tts()
    init_piper_voices()
    voice_count = len(VOICES)
    logger.info(f"TTS server ready with {voice_count} voices, active: {ACTIVE_VOICE}")
    yield


app = FastAPI(title="Custom-PI TTS Server", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICES: dict[str, dict] = {}
ACTIVE_VOICE = "af_bella"

# ── Kokoro voices (warm, natural) ──────────────────────────────────
VOICE_PRESETS = {
    "af_bella":    {"name": "Bella",    "gender": "female", "desc": "Warm American female"},
    "af_nicole":   {"name": "Nicole",   "gender": "female", "desc": "Soft American female"},
    "af_heart":    {"name": "Heart",    "gender": "female", "desc": "Gentle female"},
    "am_adam":     {"name": "Adam",     "gender": "male",   "desc": "Deep American male"},
    "am_michael":  {"name": "Michael",  "gender": "male",   "desc": "Warm American male"},
    "bf_emma":     {"name": "Emma",     "gender": "female", "desc": "British female"},
    "bm_george":   {"name": "George",   "gender": "male",   "desc": "British male"},
}

# ── Piper voices (Indian accent + high-quality English + Hindi) ────
PIPER_VOICES = {
    "piper_indian": {
        "name": "Priya", "gender": "female",
        "desc": "Indian English female (Piper)",
        "model": "en_IN-spicor-medium",
        "config": {"length_scale": 1.02, "noise_scale": 0.7, "noise_w": 0.9},
    },
    "piper_ryan": {
        "name": "Ryan", "gender": "male",
        "desc": "American male (Piper)",
        "model": "en_US-ryan-medium",
        "config": {"length_scale": 0.92, "noise_scale": 0.667, "noise_w": 0.8},
    },
    "piper_alba": {
        "name": "Alba", "gender": "female",
        "desc": "British female (Piper)",
        "model": "en_GB-alba-medium",
        "config": {"length_scale": 0.95, "noise_scale": 0.7, "noise_w": 0.85},
    },
    "piper_northern_male": {
        "name": "James", "gender": "male",
        "desc": "British male (Piper)",
        "model": "en_GB-northern_english_male-medium",
        "config": {"length_scale": 0.9, "noise_scale": 0.667, "noise_w": 0.8},
    },
    "piper_hindi_male": {
        "name": "Pratham", "gender": "male",
        "desc": "Hindi male (Piper, speaks Hindi)",
        "model": "hi_IN-pratham-medium",
        "config": {"length_scale": 1.0, "noise_scale": 0.667, "noise_w": 0.8},
    },
}

PIPER_DIR = os.path.expanduser("~/.pi/tts/piper")

# Audio boost to make TTS louder and fuller (+6dB = 2x perceived loudness)
VOLUME_GAIN = 1.2

# ── Kokoro engine ─────────────────────────────────────────────────
_tts_pipeline = None

def get_tts():
    global _tts_pipeline
    if _tts_pipeline is not None:
        return _tts_pipeline
    try:
        from kokoro import KPipeline
        tts_device = os.environ.get("TTS_DEVICE", "cpu")
        logger.info(f"Loading Kokoro TTS pipeline (device={tts_device})...")
        _tts_pipeline = KPipeline(lang_code='a', device=tts_device)
        logger.info(f"Kokoro TTS loaded successfully on {tts_device}")
        for v in VOICE_PRESETS:
            VOICES[v] = {**VOICE_PRESETS[v], "type": "kokoro", "id": v}
    except ImportError as e:
        logger.warning(f"kokoro package not installed: {e}")
        _tts_pipeline = None
    except RuntimeError as e:
        if "out of memory" in str(e).lower() or "cuda" in str(e).lower():
            logger.warning(f"GPU OOM loading Kokoro, retrying on CPU: {e}")
            try:
                _tts_pipeline = KPipeline(lang_code='a', device='cpu')
                logger.info("Kokoro TTS loaded successfully on CPU (fallback)")
                for v in VOICE_PRESETS:
                    VOICES[v] = {**VOICE_PRESETS[v], "type": "kokoro", "id": v}
            except Exception as e2:
                logger.error(f"Kokoro CPU fallback also failed: {e2}")
                _tts_pipeline = None
        else:
            logger.error(f"Kokoro load error: {e}")
            _tts_pipeline = None
    return _tts_pipeline


# ── Piper engine ──────────────────────────────────────────────────
_piper_installed = False
_piper_voices: dict[str, dict] = {}
PIPER_REPO = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

def _piper_download_url(model_name: str) -> tuple[str, str]:
    """Build download URLs for a Piper voice model."""
    parts = model_name.split("-")
    lang_code = parts[0]
    quality = parts[-1]
    voice_id = "-".join(parts[1:-1])
    lang = lang_code.split("_")[0]
    base = f"{PIPER_REPO}/{lang}/{lang_code}/{voice_id}/{quality}"
    onnx_url = f"{base}/{model_name}.onnx"
    json_url = f"{base}/{model_name}.onnx.json"
    return onnx_url, json_url

def ensure_piper_voice(vid: str) -> None:
    """Download Piper voice model if not already present."""
    if vid in _piper_voices and os.path.exists(_piper_voices[vid]["model_path"]):
        return
    vinfo = PIPER_VOICES[vid]
    model_name = vinfo["model"]
    model_path = os.path.join(PIPER_DIR, f"{model_name}.onnx")
    config_path = os.path.join(PIPER_DIR, f"{model_name}.onnx.json")
    os.makedirs(PIPER_DIR, exist_ok=True)

    if os.path.exists(model_path) and os.path.exists(config_path):
        _piper_voices[vid] = {**vinfo, "model_path": model_path, "config_path": config_path}
        VOICES[vid] = {**vinfo, "type": "piper", "id": vid, "available": True}
        return

    import httpx
    onnx_url, json_url = _piper_download_url(model_name)
    for url, dest in [(onnx_url, model_path), (json_url, config_path)]:
        logger.info(f"Downloading Piper voice: {url}")
        try:
            resp = httpx.get(url, follow_redirects=True, timeout=300)
            resp.raise_for_status()
            with open(dest, "wb") as f:
                f.write(resp.content)
            logger.info(f"Downloaded {dest}")
        except Exception as e:
            logger.error(f"Failed to download {url}: {e}")
            raise RuntimeError(f"Failed to download Piper voice '{vinfo['name']}': {e}")

    _piper_voices[vid] = {**vinfo, "model_path": model_path, "config_path": config_path}
    VOICES[vid] = {**vinfo, "type": "piper", "id": vid, "available": True}

def init_piper_voices():
    global _piper_installed
    if importlib.util.find_spec("piper") is None:
        logger.info("piper-tts not installed, skipping Piper voices")
        return
    # Register all Piper voices (mark available if already downloaded)
    for vid, vinfo in PIPER_VOICES.items():
        model_name = vinfo["model"]
        model_path = os.path.join(PIPER_DIR, f"{model_name}.onnx")
        config_path = os.path.join(PIPER_DIR, f"{model_name}.onnx.json")
        if os.path.exists(model_path) and os.path.exists(config_path):
            _piper_voices[vid] = {"model_path": model_path, "config_path": config_path, **vinfo}
            VOICES[vid] = {**vinfo, "type": "piper", "id": vid, "available": True}
            logger.info(f"Piper voice loaded: {vinfo['name']} ({model_name})")
        else:
            VOICES[vid] = {**vinfo, "type": "piper", "id": vid, "available": False}
            logger.info(f"Piper voice registered (needs download): {vinfo['name']} ({model_name})")
    _piper_installed = True

def synthesize_piper(text: str, voice_id: str) -> tuple[bytes, int]:
    """Synthesize with Piper. Returns (WAV bytes, sample_rate)."""
    from piper import PiperVoice
    from piper.config import SynthesisConfig
    vi = _piper_voices[voice_id]
    voice = PiperVoice.load(vi["model_path"], config_path=vi["config_path"])
    sample_rate = voice.config.sample_rate or 22050

    # Use natural synthesis parameters
    syn_voice = vi.get("config", {})
    config = SynthesisConfig(
        length_scale=syn_voice.get("length_scale", 0.95),
        noise_scale=syn_voice.get("noise_scale", 0.667),
        noise_w_scale=syn_voice.get("noise_w", 0.8),
        volume=1.0,
    )
    audio = voice.synthesize(text.strip(), syn_config=config)

    # synthesize() returns Iterable[AudioChunk], extract float arrays
    chunks = [c.audio_float_array for c in audio]
    if not chunks:
        raise RuntimeError("Piper produced no audio")
    logger.info(f"Piper: {len(chunks)} chunks generated")
    audio_float = np.concatenate(chunks).astype(np.float32)
    pre_gain_peak = float(np.max(np.abs(audio_float)))
    logger.info(f"Piper: pre-gain peak={pre_gain_peak:.6f}, len={len(audio_float)}, dtype={audio_float.dtype}")

    # Apply volume gain (typical ~1.8x, still in [-1,1] float space)
    audio_float = audio_float * VOLUME_GAIN
    audio_float = np.clip(audio_float, -1.0, 1.0)
    post_gain_peak = float(np.max(np.abs(audio_float)))
    logger.info(f"Piper: post-gain peak={post_gain_peak:.6f}")

    # Scale to int16 range
    audio_int16 = (audio_float * 32767).astype(np.int16)
    peak = int(np.max(np.abs(audio_int16)))
    logger.info(f"Piper: int16 peak={peak}")
    # Write WAV
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_int16.tobytes())
    return buf.getvalue(), sample_rate, peak


# ── STT (Whisper) ─────────────────────────────────────────────────
SAMPLE_RATE = 24000
_stt_model = None

def get_stt():
    global _stt_model
    if _stt_model is not None:
        return _stt_model
    model_size = os.environ.get("STT_MODEL", "medium")
    try:
        from faster_whisper import WhisperModel
        logger.info(f"Loading Whisper {model_size} model (this may take a moment)...")
        _stt_model = WhisperModel(model_size, device="cpu", compute_type="int8")
        logger.info(f"Whisper {model_size} model loaded successfully")
    except Exception as e:
        logger.warning(f"Failed to load Whisper STT: {e}")
        _stt_model = None
    return _stt_model

def audio_to_pcm16_chunks(audio: np.ndarray, chunk_ms: int = 200) -> list[bytes]:
    chunk_samples = int(SAMPLE_RATE * chunk_ms / 1000)
    audio_int16 = (audio * 32767).astype(np.int16)
    chunks = []
    for start in range(0, len(audio_int16), chunk_samples):
        chunk = audio_int16[start:start + chunk_samples]
        if len(chunk) > 0:
            chunks.append(chunk.tobytes())
    return chunks


class TTSRequest(BaseModel):
    text: str
    voice: str = ""
    stream: bool = False


def apply_gain(pcm: np.ndarray, gain: float = VOLUME_GAIN) -> np.ndarray:
    if gain == 1.0:
        return pcm
    peak = np.max(np.abs(pcm))
    if peak > 0:
        safe_gain = min(gain, 1.0 / peak)
        pcm = pcm * safe_gain
    return pcm


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "tts_loaded": _tts_pipeline is not None,
        "stt_loaded": _stt_model is not None,
        "voices": list(VOICES.keys()),
        "active": ACTIVE_VOICE,
        "voice_count": len(VOICES),
    }


@app.post("/v1/stt")
async def transcribe(request: Request):
    model = get_stt()
    if model is None:
        raise HTTPException(503, "STT engine not available")
    wav_bytes = await request.body()
    if not wav_bytes or len(wav_bytes) < 44:
        raise HTTPException(400, "Invalid or empty audio data")

    try:
        wf = wave.open(io.BytesIO(wav_bytes), 'rb')
        framerate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
        wf.close()
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception as e:
        raise HTTPException(400, f"Could not decode WAV audio: {e}")

    if len(samples) == 0:
        raise HTTPException(400, "No audio data received")

    max_val = np.max(np.abs(samples))
    if max_val > 0 and max_val < 0.3:
        samples = samples * (0.3 / max_val)
        logger.info(f"STT audio normalized (peak {max_val:.3f} → 0.3)")

    segments, info = model.transcribe(
        samples, beam_size=5, language="en",
        vad_filter=True, vad_parameters=dict(min_silence_duration_ms=200, threshold=0.3),
        condition_on_previous_text=False,
    )
    text = " ".join(seg.text for seg in segments).strip()
    prob = info.language_probability if info else 0
    logger.info(f"STT ({len(samples) / framerate:.1f}s, {len(wav_bytes)} bytes, {prob:.2f}): {text[:80]}")
    return {"text": text}


@app.get("/v1/voices")
async def list_voices():
    return {"voices": [{"id": k, **v} for k, v in VOICES.items()], "active": ACTIVE_VOICE}


class SelectVoiceRequest(BaseModel):
    voice_id: str


@app.post("/v1/voices/select")
async def select_voice(req: SelectVoiceRequest):
    global ACTIVE_VOICE
    if req.voice_id not in VOICES:
        raise HTTPException(404, f"Voice '{req.voice_id}' not found")
    ACTIVE_VOICE = req.voice_id
    logger.info(f"Active voice changed to: {ACTIVE_VOICE}")
    return {"active": ACTIVE_VOICE}


def _wav_from_pcm(pcm: np.ndarray, sr: int) -> bytes:
    int16 = np.clip(pcm, -1.0, 1.0) * 32767
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(int16.astype(np.int16).tobytes())
    return buf.getvalue()


@app.post("/v1/tts")
async def synthesize(req: TTSRequest):
    voice = req.voice or ACTIVE_VOICE
    if voice not in VOICES:
        voice = "af_bella"

    vinfo = VOICES[voice]

    # ── Piper engine path ──
    if vinfo["type"] == "piper":
        if not _piper_installed:
            raise HTTPException(503, "Piper TTS engine not available")
        try:
            ensure_piper_voice(voice)
            wav_bytes, sr, peak = synthesize_piper(req.text, voice)
            logger.info(f"Piper TTS: peak={peak}, {len(wav_bytes)} bytes, {sr}Hz")
            return {
                "audio": base64.b64encode(wav_bytes).decode(),
                "sampleRate": sr,
                "peak": peak,
            }
        except Exception as e:
            logger.error(f"Piper TTS error: {e}")
            raise HTTPException(500, f"Piper TTS failed: {e}")

    # ── Kokoro engine path ──
    pipeline = get_tts()
    if pipeline is None:
        raise HTTPException(503, "TTS engine not available")

    try:
        gen = pipeline(req.text, voice=voice, speed=1.0)
        all_audio = []
        for _, _, audio in gen:
            all_audio.append(audio)
    except RuntimeError as e:
        if "out of memory" in str(e).lower():
            logger.error(f"CUDA OOM during Kokoro inference: {e}")
            raise HTTPException(500, "TTS GPU out of memory. Set TTS_DEVICE=cpu in environment and restart.")
        raise HTTPException(500, f"Kokoro inference error: {e}")
    except Exception as e:
        logger.error(f"Kokoro inference error: {e}")
        raise HTTPException(500, f"Kokoro inference error: {e}")
    if not all_audio:
        logger.warning(f"No audio generated for text: '{req.text}'. Returning 0.1s silence.")
        silence = np.zeros(int(SAMPLE_RATE * 0.1), dtype=np.float32)
        wav_bytes = _wav_from_pcm(silence, SAMPLE_RATE)
        return {"audio": base64.b64encode(wav_bytes).decode(), "sampleRate": SAMPLE_RATE, "peak": 0}

    combined = np.concatenate(all_audio)
    logger.info(f"Kokoro raw: dtype={combined.dtype}, shape={combined.shape}, "
                f"min={float(combined.min()):.6f}, max={float(combined.max()):.6f}, "
                f"mean={float(combined.mean()):.6f}, nan={bool(np.any(np.isnan(combined)))}, "
                f"inf={bool(np.any(np.isinf(combined)))}")

    # Apply gain for louder, richer audio
    combined = apply_gain(combined)
    combined = np.clip(combined, -0.99, 0.99)

    wav_bytes = _wav_from_pcm(combined, SAMPLE_RATE)
    samples = np.frombuffer(wav_bytes[44:], dtype=np.int16)
    peak_int = int(np.max(np.abs(samples))) if len(samples) > 0 else 0
    logger.info(f"Kokoro TTS: peak={peak_int}, {len(wav_bytes)} bytes, {SAMPLE_RATE}Hz, "
                f"nonzero={int(np.count_nonzero(samples))}/{len(samples)}")

    # Fallback: if generated audio is silent, generate a test tone
    if peak_int < 1000:
        logger.warning("Kokoro produced near-silent audio! Generating 440Hz test tone instead.")
        sr = SAMPLE_RATE
        duration = 2.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False, dtype=np.float32)
        tone = np.sin(2 * np.pi * 440 * t) * 0.8
        wav_bytes = _wav_from_pcm(tone, sr)
        peak_int = 32767
        logger.info(f"Kokoro fallback: generated test tone, peak={peak_int}")

    return {"audio": base64.b64encode(wav_bytes).decode(), "sampleRate": SAMPLE_RATE, "peak": peak_int}


@app.websocket("/v1/tts/stream")
async def tts_stream(ws: WebSocket):
    await ws.accept()
    pipeline = get_tts()
    if pipeline is None:
        await ws.send_json({"type": "error", "message": "TTS engine not available"})
        await ws.close()
        return

    voice = ACTIVE_VOICE
    try:
        data = await ws.receive_text()
        msg = json.loads(data)
        text = msg.get("text", "")
        voice = msg.get("voice", voice) or ACTIVE_VOICE
        if voice not in VOICES:
            voice = "af_bella"

        if not text:
            await ws.send_json({"type": "error", "message": "No text provided"})
            await ws.close()
            return

        await ws.send_json({"type": "start", "sampleRate": SAMPLE_RATE, "voice": voice})

        gen = pipeline(text, voice=voice, speed=1.0)
        for gs, ps, audio in gen:
            chunks = audio_to_pcm16_chunks(audio, 100)
            for chunk in chunks:
                await ws.send_bytes(struct.pack(">I", len(chunk)) + chunk)
                await asyncio.sleep(0)

        await ws.send_json({"type": "done"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"TTS stream error: {e}")
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


@app.websocket("/v1/chat")
async def voice_chat(ws: WebSocket):
    """Full-duplex voice chat: receive audio → STT → LLM → TTS → send audio."""
    await ws.accept()
    pipeline = get_tts()
    if pipeline is None:
        await ws.send_json({"type": "error", "message": "TTS engine not available"})
        await ws.close()
        return

    import aiohttp

    LLM_URL = os.environ.get("LLM_URL", "http://host.docker.internal:1234/v1/chat/completions")
    LLM_MODEL = os.environ.get("LLM_MODEL", "local-model")
    voice = ACTIVE_VOICE

    await ws.send_json({"type": "ready", "message": "Voice chat ready"})

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "text":
                user_text = msg.get("text", "")
                if not user_text:
                    continue

                await ws.send_json({"type": "agent_status", "status": "thinking"})

                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        LLM_URL,
                        json={
                            "model": LLM_MODEL,
                            "messages": [
                                {"role": "system", "content": "You are a helpful AI assistant. Respond conversationally and concisely."},
                                {"role": "user", "content": user_text}
                            ],
                            "stream": True,
                        }
                    ) as resp:
                        full_response = ""
                        async for line in resp.content:
                            line = line.decode().strip()
                            if line.startswith("data: ") and line != "data: [DONE]":
                                try:
                                    chunk = json.loads(line[6:])
                                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                    if delta:
                                        full_response += delta
                                except json.JSONDecodeError:
                                    pass

                await ws.send_json({"type": "agent_status", "status": "speaking"})

                gen = pipeline(full_response, voice=voice, speed=1.0)
                await ws.send_json({"type": "text_start", "text": full_response})
                for gs, ps, audio in gen:
                    chunks = audio_to_pcm16_chunks(audio, 100)
                    for chunk in chunks:
                        await ws.send_bytes(struct.pack(">I", len(chunk)) + chunk)
                        await asyncio.sleep(0)

                await ws.send_json({"type": "done"})

            elif msg.get("type") == "voice":
                voice = msg.get("voice_id", voice)
                if voice in VOICES:
                    ACTIVE_VOICE = voice

            elif msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Voice chat error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
