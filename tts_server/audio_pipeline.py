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
    
    # 5. Safe fallback cutoff
    LowpassFilter(cutoff_frequency_hz=8000),
    
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
    
    # Apply the Pedalboard effects chain dynamically adjusted for sample rate
    # Pedalboard expects shape (channels, samples) for mono: (1, N)
    try:
        # Cutoff frequency must be strictly less than half of sample_rate (Nyquist limit)
        lowpass_cutoff = min(14000.0, sample_rate * 0.45)
        
        board = Pedalboard([
            HighpassFilter(cutoff_frequency_hz=80),
            LowShelfFilter(cutoff_frequency_hz=250, gain_db=2.5),
            Compressor(
                threshold_db=-18.0,
                ratio=3.0,
                attack_ms=5.0,
                release_ms=80.0,
            ),
            LowpassFilter(cutoff_frequency_hz=lowpass_cutoff),
            Gain(gain_db=1.5),
        ])
        
        processed = board(
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
            # Limit the loudness normalization gain to a max of +12dB boost / -12dB attenuation.
            # This prevents silent/whispering frames from being scaled up to massive static/distortion.
            gain_db = TARGET_LUFS - current_lufs
            clamped_gain_db = min(max(gain_db, -12.0), 12.0)
            gain_factor = 10.0 ** (clamped_gain_db / 20.0)
            processed = processed * gain_factor
    except Exception as e:
        print(f"Error performing LUFS normalization: {e}")
    
    # Final safety clip
    processed = np.clip(processed, -0.99, 0.99)
    
    return processed
