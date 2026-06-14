"""
Production audio post-processing pipeline.
Transforms raw TTS output into broadcast-quality speech.
"""
import numpy as np
from pedalboard import (
    Pedalboard, 
    HighpassFilter, 
    LowShelfFilter, 
    Compressor, 
    Gain,
    LowpassFilter,
)
import pyloudnorm as pyln

# ── The Pipeline ─────────────────────────────────────────
VOICE_PIPELINE = Pedalboard([
    # 1. Remove sub-bass rumble (mic pops, electrical hum)
    HighpassFilter(cutoff_frequency_hz=80),
    
    # 2. Add vocal warmth (low-shelf boost at 250Hz)
    LowShelfFilter(cutoff_frequency_hz=250, gain_db=2.5),
    
    # 4. Compress dynamics (even out loud/quiet parts)
    Compressor(
        threshold_db=-18.0,
        ratio=3.0,
        attack_ms=5.0,
        release_ms=80.0,
    ),
    
    # 5. Remove harsh frequencies above 12kHz (anti-alias)
    LowpassFilter(cutoff_frequency_hz=14000),
    
    # 6. Final makeup gain
    Gain(gain_db=1.5),
])

# Target loudness: -16 LUFS (podcast/streaming standard)
TARGET_LUFS = -16.0


def process_audio(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """
    Full post-processing pipeline.
    Input: float32 array in [-1.0, 1.0]
    Output: float32 array, loudness-normalized, broadcast quality.
    """
    if len(audio) == 0:
        return audio
    
    # Ensure float32
    audio = audio.astype(np.float32)
    
    # Apply the Pedalboard effects chain
    # Pedalboard expects shape (channels, samples) for mono: (1, N)
    try:
        processed = VOICE_PIPELINE(
            audio.reshape(1, -1), 
            sample_rate
        ).flatten()
    except Exception as e:
        print(f"Error applying voice pipeline: {e}")
        processed = audio
    
    # LUFS normalization (perceived loudness, not just peak)
    try:
        meter = pyln.Meter(sample_rate)
        current_lufs = meter.integrated_loudness(processed)
        
        if not np.isinf(current_lufs) and not np.isnan(current_lufs):
            processed = pyln.normalize.loudness(
                processed, current_lufs, TARGET_LUFS
            )
    except Exception as e:
        print(f"Error performing LUFS normalization: {e}")
    
    # Final safety clip
    processed = np.clip(processed, -0.99, 0.99)
    
    return processed
