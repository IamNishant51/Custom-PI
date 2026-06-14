"""
Simple in-memory cache for TTS outputs.
Reduces GPU/CPU latency for repeated prompts.
"""
import hashlib
import time
import logging

logger = logging.getLogger("tts-server.cache")

class TTSCache:
    def __init__(self, max_size: int = 150, ttl_seconds: int = 3600):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self.cache = {}  # key -> (wav_bytes, sample_rate, peak, timestamp)

    def _get_key(self, text: str, voice: str) -> str:
        # Normalize text and voice to produce a consistent hash key
        normalized = f"{text.strip().lower()}:{voice.strip().lower()}"
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]

    def get(self, text: str, voice: str):
        key = self._get_key(text, voice)
        if key in self.cache:
            wav_bytes, sample_rate, peak, ts = self.cache[key]
            # Check TTL
            if time.time() - ts < self.ttl_seconds:
                logger.info(f"Cache hit for '{text[:30]}...' (voice: {voice})")
                return wav_bytes, sample_rate, peak
            else:
                # Evict expired
                del self.cache[key]
        return None

    def set(self, text: str, voice: str, wav_bytes: bytes, sample_rate: int, peak: int):
        if not text or not wav_bytes:
            return
        
        key = self._get_key(text, voice)
        
        # Evict oldest if cache is full
        if len(self.cache) >= self.max_size:
            # Find the oldest entry by timestamp
            oldest_key = min(self.cache, key=lambda k: self.cache[k][3])
            del self.cache[oldest_key]
            logger.info(f"Evicted oldest cache entry {oldest_key}")
            
        self.cache[key] = (wav_bytes, sample_rate, peak, time.time())
        logger.info(f"Cached TTS output for '{text[:30]}...' (key: {key})")

    def clear(self):
        self.cache.clear()
        logger.info("TTS Cache cleared")
