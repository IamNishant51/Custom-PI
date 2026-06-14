"""
MeloTTS Engine — lightweight, natural-sounding TTS with CPU support.
Replaces Piper as the fallback engine for non-cloned, non-Kokoro voices.
"""
import os
import logging
import numpy as np

logger = logging.getLogger("tts-server.melo")

# Voice presets mapping
MELO_VOICES = {
    "melo_us_female": {
        "name": "Mia",
        "gender": "female",
        "desc": "American female (MeloTTS)",
        "lang": "EN_US",
        "speaker": "EN-US",
    },
    "melo_us_male": {
        "name": "Leo",
        "gender": "male",
        "desc": "American male (MeloTTS)",
        "lang": "EN_US",
        "speaker": "EN-US",
    },
    "melo_gb_female": {
        "name": "Lily",
        "gender": "female",
        "desc": "British female (MeloTTS)",
        "lang": "EN_GB",
        "speaker": "EN-GB",
    },
    "melo_gb_male": {
        "name": "Oliver",
        "gender": "male",
        "desc": "British male (MeloTTS)",
        "lang": "EN_GB",
        "speaker": "EN-GB",
    },
    "melo_hindi_female": {
        "name": "Priya",
        "gender": "female",
        "desc": "Hindi female (MeloTTS)",
        "lang": "ZH",  # MeloTTS uses ZH_MIX_EN for Hindi-esque; fallback to EN
        "speaker": "EN-US",
    },
}


class MeloTTSEngine:
    def __init__(self, device: str = "cpu"):
        self.device = device
        self.model = None
        self.available = False
        self.voices = {}

    def load_model(self):
        if self.model is not None:
            return True
        try:
            from melo_tts import MeloTTS
            logger.info(f"Loading MeloTTS on {self.device}...")
            self.model = MeloTTS(language="EN", device=self.device)
            self.available = True
            logger.info("MeloTTS loaded successfully.")
            return True
        except ImportError:
            logger.warning("melo-tts package not installed. MeloTTS unavailable.")
            self.available = False
            return False
        except Exception as e:
            logger.error(f"Failed to load MeloTTS: {e}")
            self.available = False
            return False

    def synthesize(self, text: str, voice_id: str = "melo_us_female") -> tuple[np.ndarray, int]:
        if not self.load_model() or self.model is None:
            raise RuntimeError("MeloTTS model not available")

        vi = MELO_VOICES.get(voice_id, MELO_VOICES["melo_us_female"])
        lang = vi["lang"]
        speaker = vi["speaker"]

        logger.info(f"MeloTTS synthesizing (voice={voice_id}, lang={lang}): {text[:50]}...")
        try:
            audio = self.model.tts(text, speaker, speed=1.0)
            audio_np = np.array(audio, dtype=np.float32)
            return audio_np, 24000
        except Exception as e:
            logger.error(f"MeloTTS synthesis failed: {e}")
            raise


def get_melo_voices():
    return {k: {**v, "type": "melo", "id": k} for k, v in MELO_VOICES.items()}
