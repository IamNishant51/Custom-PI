#!/usr/bin/env python3
"""Local TTS server with Kokoro (CPU) + Piper (CPU, multi-voice) + F5-TTS (Voice Cloning) + Audio pipeline."""

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
import shutil

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Pipeline and Preprocessor imports
from audio_pipeline import process_audio
from text_preprocessor import preprocess_for_tts
from cache import TTSCache

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server")

from contextlib import asynccontextmanager

# In-memory cache
tts_cache = TTSCache()

# Concurrency semaphore
TTS_SEMAPHORE = asyncio.Semaphore(4)

@asynccontextmanager
async def lifespan(app: FastAPI):
    get_tts()
    init_melo_voices()
    init_piper_voices()
    init_cloned_voices()
    voice_count = len(VOICES)
    logger.info(f"TTS server ready with {voice_count} voices, active: {ACTIVE_VOICE}")
    yield


app = FastAPI(title="Custom-PI TTS Server", version="3.0.0", lifespan=lifespan)

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

# ── MeloTTS voices (lightweight, natural) ──────────────────────────
MELO_VOICES = {}

# ── Piper voices (Indian accent + high-quality English + Hindi, fallback) ────
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

# Audio boost is still kept as a reference, but we use process_audio for main output
VOLUME_GAIN = 1.2
SAMPLE_RATE = 24000

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


# ── F5-TTS engine ─────────────────────────────────────────────────
_f5_engine = None

def get_f5():
    global _f5_engine
    if _f5_engine is None:
        from f5_engine import F5TTSEngine
        _f5_engine = F5TTSEngine()
    return _f5_engine


# ── Cloned voices initialization ──────────────────────────────────
def init_cloned_voices():
    clones_dir = os.path.expanduser("~/.pi/tts/clones")
    if not os.path.exists(clones_dir):
        return
    for item in os.listdir(clones_dir):
        item_path = os.path.join(clones_dir, item)
        if os.path.isdir(item_path) and item.startswith("clone_"):
            meta_path = os.path.join(item_path, "metadata.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r") as f:
                        meta = json.load(f)
                    name = meta.get("name", item)
                    VOICES[item] = {
                        "name": name,
                        "gender": "custom",
                        "desc": meta.get("desc", f"Cloned voice '{name}'"),
                        "type": "clone",
                        "id": item,
                        "ref_audio": os.path.join(item_path, "reference.wav"),
                        "ref_text": meta.get("transcript", "")
                    }
                    logger.info(f"Registered cloned voice: {name} (id: {item})")
                except Exception as e:
                    logger.error(f"Error loading clone voice meta at {meta_path}: {e}")


# ── Piper engine ──────────────────────────────────────────────────
_piper_installed = False
_piper_voices: dict[str, dict] = {}
PIPER_REPO = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

def _piper_download_url(model_name: str) -> tuple[str, str]:
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

# ── MeloTTS initialization ──────────────────────────────────────────
_melo_engine = None

def get_melo():
    global _melo_engine
    if _melo_engine is None:
        from melo_engine import MeloTTSEngine, get_melo_voices
        _melo_engine = MeloTTSEngine(device="cpu")
        _melo_engine.load_model()
    return _melo_engine

def init_melo_voices():
    global MELO_VOICES
    from melo_engine import get_melo_voices
    MELO_VOICES = get_melo_voices()
    for vid, vinfo in MELO_VOICES.items():
        VOICES[vid] = {**vinfo, "type": "melo", "id": vid, "available": True}
        logger.info(f"MeloTTS voice registered: {vinfo['name']} ({vid})")

def synthesize_piper(text: str, voice_id: str) -> tuple[bytes, int, int]:
    """Synthesize with Piper. Returns (WAV bytes, sample_rate, peak)."""
    from piper import PiperVoice
    from piper.config import SynthesisConfig
    vi = _piper_voices[voice_id]
    voice = PiperVoice.load(vi["model_path"], config_path=vi["config_path"])
    sample_rate = voice.config.sample_rate or 22050

    syn_voice = vi.get("config", {})
    config = SynthesisConfig(
        length_scale=syn_voice.get("length_scale", 0.95),
        noise_scale=syn_voice.get("noise_scale", 0.667),
        noise_w_scale=syn_voice.get("noise_w", 0.8),
        volume=1.0,
    )
    audio = voice.synthesize(text.strip(), syn_config=config)

    chunks = [c.audio_float_array for c in audio]
    if not chunks:
        raise RuntimeError("Piper produced no audio")
    
    audio_float = np.concatenate(chunks).astype(np.float32)
    
    # Process audio with Pedalboard and LUFS normalizer
    audio_float = process_audio(audio_float, sample_rate)

    # Scale to int16 range
    audio_int16 = (audio_float * 32767).astype(np.int16)
    peak = int(np.max(np.abs(audio_int16))) if len(audio_int16) > 0 else 0
    
    # Write WAV
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_int16.tobytes())
    return buf.getvalue(), sample_rate, peak


# ── STT (Whisper) ─────────────────────────────────────────────────
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

class CloneRequest(BaseModel):
    name: str
    transcript: str
    audio_base64: str  # Base64 encoded WAV reference

class SelectVoiceRequest(BaseModel):
    voice_id: str


def apply_gain(pcm: np.ndarray, gain: float = VOLUME_GAIN) -> np.ndarray:
    if gain == 1.0:
        return pcm
    peak = np.max(np.abs(pcm))
    if peak > 0:
        safe_gain = min(gain, 1.0 / peak)
        pcm = pcm * safe_gain
    return pcm


def _wav_from_pcm(pcm: np.ndarray, sr: int) -> bytes:
    int16 = np.clip(pcm, -1.0, 1.0) * 32767
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(int16.astype(np.int16).tobytes())
    return buf.getvalue()


@app.get("/health")
async def health():
    f5 = get_f5()
    return {
        "status": "ok",
        "engines": {
            "kokoro": {"loaded": _tts_pipeline is not None},
            "f5": {"loaded": f5.available, "device": f5.device},
            "piper": {"loaded": _piper_installed, "voices": list(_piper_voices.keys())},
            "whisper": {"loaded": _stt_model is not None},
        },
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


@app.post("/v1/voices/select")
async def select_voice(req: SelectVoiceRequest):
    global ACTIVE_VOICE
    if req.voice_id not in VOICES:
        raise HTTPException(404, f"Voice '{req.voice_id}' not found")
    ACTIVE_VOICE = req.voice_id
    logger.info(f"Active voice changed to: {ACTIVE_VOICE}")
    return {"active": ACTIVE_VOICE}


@app.post("/v1/voices/clone")
async def clone_voice(req: CloneRequest):
    try:
        import uuid
        clone_id = f"clone_{uuid.uuid4().hex[:8]}"
        clones_dir = os.path.expanduser("~/.pi/tts/clones")
        clone_dir = os.path.join(clones_dir, clone_id)
        os.makedirs(clone_dir, exist_ok=True)
        
        # Decode base64 audio reference
        audio_data = base64.b64decode(req.audio_base64)
        ref_path = os.path.join(clone_dir, "reference.wav")
        with open(ref_path, "wb") as f:
            f.write(audio_data)
            
        # Write metadata
        meta = {
            "name": req.name,
            "transcript": req.transcript,
            "created_at": int(time.time()),
            "engine": "f5-tts"
        }
        with open(os.path.join(clone_dir, "metadata.json"), "w") as f:
            json.dump(meta, f)
            
        # Register voice
        VOICES[clone_id] = {
            "name": req.name,
            "gender": "custom",
            "desc": f"Cloned voice '{req.name}'",
            "type": "clone",
            "id": clone_id,
            "ref_audio": ref_path,
            "ref_text": req.transcript
        }
        logger.info(f"Registered cloned voice: {req.name} (id: {clone_id})")
        return {"voice_id": clone_id, "name": req.name}
    except Exception as e:
        logger.error(f"Failed to clone voice: {e}")
        raise HTTPException(500, f"Failed to clone voice: {e}")


@app.delete("/v1/voices/clone/{voice_id}")
async def delete_clone(voice_id: str):
    if voice_id not in VOICES or VOICES[voice_id]["type"] != "clone":
        raise HTTPException(404, f"Cloned voice '{voice_id}' not found")
    try:
        clones_dir = os.path.expanduser("~/.pi/tts/clones")
        clone_dir = os.path.join(clones_dir, voice_id)
        if os.path.exists(clone_dir):
            shutil.rmtree(clone_dir)
        del VOICES[voice_id]
        logger.info(f"Deleted cloned voice: {voice_id}")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Failed to delete voice {voice_id}: {e}")
        raise HTTPException(500, f"Failed to delete voice: {e}")


# ── Main Synthesis Flow with Cache and Fallbacks ───────────────────
async def do_synthesize(text: str, voice: str) -> tuple[bytes, int, int]:
    # 1. Text Preprocessing
    preprocessed_text = preprocess_for_tts(text)
    if not preprocessed_text.strip():
        # Fallback for empty/near-empty text
        silence = np.zeros(int(SAMPLE_RATE * 0.1), dtype=np.float32)
        return _wav_from_pcm(silence, SAMPLE_RATE), SAMPLE_RATE, 0

    # 2. Caching layer check
    cached = tts_cache.get(preprocessed_text, voice)
    if cached:
        return cached

    # Resolve voice info
    vinfo = VOICES.get(voice)
    if not vinfo:
        logger.warning(f"Voice '{voice}' not found. Falling back to default 'af_bella'")
        voice = "af_bella"
        vinfo = VOICES.get(voice)
        if not vinfo:
            raise RuntimeError("Default voice not initialized")

    # ── Engine Chain with Fallback ──
    
    # 1. Custom Cloned Voice (F5-TTS)
    if vinfo["type"] == "clone":
        try:
            f5 = get_f5()
            ref_audio = vinfo["ref_audio"]
            ref_text = vinfo["ref_text"]
            
            raw_audio, sr = f5.synthesize(preprocessed_text, ref_audio_path=ref_audio, ref_text=ref_text)
            processed_audio = process_audio(raw_audio, sr)
            
            wav_bytes = _wav_from_pcm(processed_audio, sr)
            samples = np.frombuffer(wav_bytes[44:], dtype=np.int16)
            peak_int = int(np.max(np.abs(samples))) if len(samples) > 0 else 0
            
            tts_cache.set(preprocessed_text, voice, wav_bytes, sr, peak_int)
            return wav_bytes, sr, peak_int
        except Exception as e:
            logger.error(f"F5-TTS clone synthesis failed: {e}. Falling back to default Kokoro voice.")
            # Fall back to default Kokoro voice
            voice = "af_bella"
            vinfo = VOICES[voice]

    # 2. MeloTTS voice (lightweight, natural)
    if vinfo["type"] == "melo":
        try:
            melo = get_melo()
            if not melo.available:
                raise RuntimeError("MeloTTS not installed")
            raw_audio, sr = melo.synthesize(preprocessed_text, voice)
            processed_audio = process_audio(raw_audio, sr)

            wav_bytes = _wav_from_pcm(processed_audio, sr)
            samples = np.frombuffer(wav_bytes[44:], dtype=np.int16)
            peak_int = int(np.max(np.abs(samples))) if len(samples) > 0 else 0

            tts_cache.set(preprocessed_text, voice, wav_bytes, sr, peak_int)
            return wav_bytes, sr, peak_int
        except Exception as e:
            logger.error(f"MeloTTS synthesis failed: {e}. Falling back to default Kokoro voice.")
            voice = "af_bella"
            vinfo = VOICES[voice]

    # 3. Piper voice (fallback)
    if vinfo["type"] == "piper":
        try:
            if not _piper_installed:
                raise RuntimeError("Piper TTS not installed")
            ensure_piper_voice(voice)
            wav_bytes, sr, peak = synthesize_piper(preprocessed_text, voice)
            
            tts_cache.set(preprocessed_text, voice, wav_bytes, sr, peak)
            return wav_bytes, sr, peak
        except Exception as e:
            logger.error(f"Piper synthesis failed: {e}. Falling back to default Kokoro voice.")
            voice = "af_bella"
            vinfo = VOICES[voice]

    # 4. Kokoro voice (or Kokoro fallback)
    if vinfo["type"] == "kokoro":
        try:
            pipeline = get_tts()
            if pipeline is None:
                raise RuntimeError("Kokoro pipeline not loaded")
                
            gen = pipeline(preprocessed_text, voice=voice, speed=1.0)
            all_audio = []
            for _, _, audio in gen:
                all_audio.append(audio)
            
            if not all_audio:
                raise RuntimeError("Kokoro generated no audio chunks")
                
            combined = np.concatenate(all_audio)
            processed_audio = process_audio(combined, SAMPLE_RATE)
            
            wav_bytes = _wav_from_pcm(processed_audio, SAMPLE_RATE)
            samples = np.frombuffer(wav_bytes[44:], dtype=np.int16)
            peak_int = int(np.max(np.abs(samples))) if len(samples) > 0 else 0
            
            tts_cache.set(preprocessed_text, voice, wav_bytes, SAMPLE_RATE, peak_int)
            return wav_bytes, SAMPLE_RATE, peak_int
        except Exception as e:
            logger.error(f"Kokoro synthesis failed: {e}.")
            # Fall back to Piper if installed
            if _piper_installed:
                try:
                    logger.info("Falling back to Piper (piper_indian)")
                    ensure_piper_voice("piper_indian")
                    wav_bytes, sr, peak = synthesize_piper(preprocessed_text, "piper_indian")
                    return wav_bytes, sr, peak
                except Exception as e2:
                    logger.error(f"Piper fallback also failed: {e2}")

    # Ultimate silence fallback
    logger.critical("All TTS engines failed. Returning silence fallback.")
    silence = np.zeros(int(SAMPLE_RATE * 0.1), dtype=np.float32)
    wav_bytes = _wav_from_pcm(silence, SAMPLE_RATE)
    return wav_bytes, SAMPLE_RATE, 0


@app.post("/v1/tts")
async def synthesize(req: TTSRequest):
    voice = req.voice or ACTIVE_VOICE
    if voice not in VOICES:
        voice = "af_bella"

    # Use semaphore to limit concurrency and avoid GPU OOM
    async with TTS_SEMAPHORE:
        try:
            wav_bytes, sr, peak = await do_synthesize(req.text, voice)
            return {
                "audio": base64.b64encode(wav_bytes).decode(),
                "sampleRate": sr,
                "peak": peak
            }
        except Exception as e:
            logger.error(f"Synthesize endpoint error: {e}")
            raise HTTPException(500, f"Synthesis failed: {e}")


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

        preprocessed = preprocess_for_tts(text)
        await ws.send_json({"type": "start", "sampleRate": SAMPLE_RATE, "voice": voice})

        async with TTS_SEMAPHORE:
            gen = pipeline(preprocessed, voice=voice, speed=1.0)
            for gs, ps, audio in gen:
                # Apply post-processing pipeline to streaming chunks
                processed_chunk = process_audio(audio, SAMPLE_RATE)
                chunks = audio_to_pcm16_chunks(processed_chunk, 100)
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

                preprocessed = preprocess_for_tts(full_response)
                
                async with TTS_SEMAPHORE:
                    gen = pipeline(preprocessed, voice=voice, speed=1.0)
                    await ws.send_json({"type": "text_start", "text": full_response})
                    for gs, ps, audio in gen:
                        processed_chunk = process_audio(audio, SAMPLE_RATE)
                        chunks = audio_to_pcm16_chunks(processed_chunk, 100)
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
