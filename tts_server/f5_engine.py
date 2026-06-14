"""
F5-TTS Engine Wrapper for voice cloning and high-quality local speech synthesis.
Handles CUDA out-of-memory errors by gracefully falling back to CPU execution.
"""
import os
import logging
import numpy as np

logger = logging.getLogger("tts-server.f5")

class F5TTSEngine:
    def __init__(self, device: str = None):
        self.device = device
        self.model = None
        self.available = False
        
        if self.device is None:
            # Auto-detect device
            import torch
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            
        logger.info(f"Initializing F5-TTS Engine on device: {self.device}")
        
    def load_model(self):
        if self.model is not None:
            return True
            
        try:
            from f5_tts.api import F5TTS
            logger.info(f"Trying to load F5-TTS on {self.device}...")
            self.model = F5TTS(model="F5TTS_v1_Base", device=self.device)
            self.available = True
            logger.info(f"F5-TTS model loaded successfully on {self.device}.")
            return True
        except Exception as e:
            logger.warning(f"Failed to load F5-TTS on {self.device}: {e}")
            if self.device == "cuda":
                logger.info("Retrying F5-TTS load on CPU...")
                try:
                    from f5_tts.api import F5TTS
                    self.device = "cpu"
                    self.model = F5TTS(model="F5TTS_v1_Base", device="cpu")
                    self.available = True
                    logger.info("F5-TTS model loaded successfully on CPU (fallback).")
                    return True
                except Exception as cpu_err:
                    logger.error(f"F5-TTS CPU fallback also failed: {cpu_err}")
            
            self.available = False
            return False
            
    def synthesize(self, text: str, ref_audio_path: str = None, ref_text: str = "") -> tuple[np.ndarray, int]:
        """
        Synthesize text. If ref_audio_path is provided, clones the voice of the reference audio.
        Returns:
            (audio_numpy, sample_rate)
        """
        if not self.load_model() or self.model is None:
            raise RuntimeError("F5-TTS model is not available or failed to load")
            
        try:
            if not ref_audio_path:
                raise ValueError("F5-TTS requires a reference audio file for voice generation.")
                
            logger.info(f"Synthesizing with F5-TTS on {self.device} (ref: {ref_audio_path}, ref_text: '{ref_text}')")
            
            wav, sr, _ = self.model.infer(
                ref_file=ref_audio_path,
                ref_text=ref_text,
                gen_text=text,
            )
            
            return wav, sr
        except Exception as e:
            logger.error(f"F5-TTS synthesis failed: {e}")
            raise e
