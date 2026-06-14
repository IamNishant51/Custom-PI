"""
Normalize text for natural TTS pronunciation.
Converts numbers, abbreviations, URLs, etc. into speakable words.
"""
import re

def preprocess_for_tts(text: str) -> str:
    """Transform text into TTS-friendly format."""
    if not text:
        return ""

    # 1. Remove markdown formatting
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)  # bold
    text = re.sub(r'\*(.+?)\*', r'\1', text)       # italic
    text = re.sub(r'`(.+?)`', r'\1', text)         # inline code
    text = re.sub(r'```[\s\S]*?```', '', text)      # code blocks
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)  # headings
    
    # 2. Convert numbers to words (basic)
    text = re.sub(r'\b(\d{1,3}),(\d{3})\b', r'\1\2', text)  # Remove commas: 1,000 -> 1000
    
    # 3. Expand common abbreviations (case-insensitive where appropriate, or case-sensitive for capitalized abbreviations)
    abbrevs = {
        "API": "A P I", "URL": "U R L", "UI": "U I",
        "JS": "JavaScript", "TS": "TypeScript", "CSS": "C S S",
        "HTML": "H T M L", "SQL": "S Q L", "DB": "database",
        "GPU": "G P U", "CPU": "C P U", "RAM": "ram",
        "AI": "A I", "ML": "M L", "LLM": "L L M",
        "TTS": "text to speech", "STT": "speech to text",
        "e.g.": "for example", "i.e.": "that is",
        "etc.": "et cetera", "vs.": "versus",
    }
    for abbr, expansion in abbrevs.items():
        text = re.sub(r'\b' + re.escape(abbr) + r'\b', expansion, text)
    
    # 4. Remove URLs (unpronounceable)
    text = re.sub(r'https?://\S+', '', text)
    
    # 5. Remove emojis and special symbols
    text = re.sub(
        r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF'
        r'\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF'
        r'\U00002702-\U000027B0\U0001f926-\U0001f937'
        r'\U00010000-\U0010ffff\u2640-\u2642'
        r'\u2600-\u2B55\u200d\u23cf\u23e9\u231a'
        r'\ufe0f\u3030]+', '', text, flags=re.UNICODE
    )
    
    # 6. Insert natural pauses at clause boundaries
    text = re.sub(r'([;:])\s', r'.\n', text)    # semicolons/colons -> pause
    text = re.sub(r'\s*—\s*', '. ', text)        # em-dashes -> pause
    
    # 7. Clean up whitespace
    text = re.sub(r'\n+', '. ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    # 8. Remove parenthetical stage directions
    text = re.sub(r'\([^)]*\)', '', text)
    
    return text
