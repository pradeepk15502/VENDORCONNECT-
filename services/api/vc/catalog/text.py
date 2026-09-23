import re
import unicodedata

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s@\u0900-\u097F-]", re.UNICODE)


def normalize_text(value: str) -> str:
    """Lowercase, strip Latin accents, drop punctuation, collapse spaces. Devanagari is kept as-is."""
    value = unicodedata.normalize("NFKC", value or "").strip().lower()
    decomposed = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in decomposed if not (unicodedata.combining(c) and ord(c) < 0x0900))
    value = unicodedata.normalize("NFC", value).replace("\u093c", "")  # nukta: ज़ == ज for search
    value = _PUNCT.sub(" ", value)
    return _WS.sub(" ", value).strip()
