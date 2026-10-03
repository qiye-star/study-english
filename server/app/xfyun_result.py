"""Convert iFlytek ISE XML results into the Azure-shaped structure the client expects."""

import xml.etree.ElementTree as ET

TICKS_PER_FRAME = 100_000  # ISE positions are 10 ms frames; Azure uses 100 ns ticks.
MISPRONUNCIATION_THRESHOLD = 60

DP_OMISSION = 16
DP_INSERTION = (32, 64)
DP_SUBSTITUTION = 128

ARPABET_TO_IPA: dict[str, str] = {
    "aa": "ɑ", "ae": "æ", "ah": "ʌ", "ao": "ɔ", "aw": "aʊ", "ax": "ə",
    "ay": "aɪ", "b": "b", "ch": "tʃ", "d": "d", "dh": "ð", "eh": "ɛ",
    "er": "ɝ", "ey": "eɪ", "f": "f", "g": "ɡ", "hh": "h", "ih": "ɪ",
    "iy": "i", "jh": "dʒ", "k": "k", "l": "l", "m": "m", "n": "n",
    "ng": "ŋ", "oo": "ɔ", "ow": "oʊ", "oy": "ɔɪ", "p": "p", "r": "ɹ", "s": "s",
    "sh": "ʃ", "t": "t", "th": "θ", "uh": "ʊ", "uw": "u", "v": "v",
    "w": "w", "y": "j", "z": "z", "zh": "ʒ",
}  # fmt: skip


def normalise_score(value: float) -> float:
    """Clamp to [0, 100] and round to two decimals."""
    return round(min(max(float(value), 0.0), 100.0), 2)


def arpabet_to_ipa(symbol: str) -> str:
    if symbol in ARPABET_TO_IPA:
        return ARPABET_TO_IPA[symbol]
    stripped = symbol.replace("'", "")
    return ARPABET_TO_IPA.get(stripped, stripped if stripped != symbol else symbol)


def _score(element: ET.Element, attr: str, default: float | None = None) -> float:
    raw = element.get(attr)
    if raw is None:
        if default is None:
            raise ValueError(f"Missing attribute {attr!r} on <{element.tag}>")
        return default
    try:
        return normalise_score(float(raw))
    except ValueError as exc:
        raise ValueError(f"Invalid {attr!r} on <{element.tag}>") from exc


def _int(element: ET.Element, attr: str, default: int = 0) -> int:
    try:
        return int(element.get(attr, default))
    except ValueError as exc:
        raise ValueError(f"Invalid {attr!r} on <{element.tag}>") from exc


def _timing(element: ET.Element) -> dict:
    begin, end = _int(element, "beg_pos"), _int(element, "end_pos")
    return {
        "offset": begin * TICKS_PER_FRAME,
        "duration": max(end - begin, 0) * TICKS_PER_FRAME,
    }


def _parse(xml: str) -> ET.Element:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ValueError("Invalid ISE result XML") from exc
    chapter = root.find(".//read_chapter")
    if chapter is None:
        raise ValueError("ISE result has no read_chapter")
    return chapter


def _error_type(dp_message: int, word_score: float) -> str:
    if dp_message == DP_OMISSION:
        return "Omission"
    if dp_message in DP_INSERTION:
        return "Insertion"
    if dp_message == DP_SUBSTITUTION:
        return "Mispronunciation"
    if dp_message == 0 and word_score < MISPRONUNCIATION_THRESHOLD:
        return "Mispronunciation"
    return "None"


def _convert_phoneme(phone: ET.Element, word_score: float, syll_score: float) -> dict:
    accuracy = 0.0 if _int(phone, "dp_message") != 0 else min(word_score, syll_score)
    return {
        "phoneme": arpabet_to_ipa(phone.get("content", "")),
        **_timing(phone),
        "pronunciation_assessment": {"accuracy_score": accuracy},
    }


def _convert_syllable(syll: ET.Element, word_score: float) -> tuple[dict, list[dict]]:
    syll_score = _score(syll, "syll_score", 0.0)
    phonemes = [_convert_phoneme(p, word_score, syll_score) for p in syll.findall("phone")]
    syllable = {
        "syllable": "".join(p["phoneme"] for p in phonemes),
        **_timing(syll),
        "pronunciation_assessment": {"accuracy_score": syll_score},
    }
    return syllable, phonemes


def _convert_word(word: ET.Element) -> dict:
    score = _score(word, "total_score")
    syllables, phonemes = [], []
    for syll in word.findall("syll"):
        syllable, syll_phonemes = _convert_syllable(syll, score)
        syllables.append(syllable)
        phonemes.extend(syll_phonemes)
    return {
        "word": word.get("content", ""),
        **_timing(word),
        "pronunciation_assessment": {
            "accuracy_score": score,
            "error_type": _error_type(_int(word, "dp_message"), score),
        },
        "syllables": syllables,
        "phonemes": phonemes,
    }


def _is_speech_word(word: ET.Element) -> bool:
    return word.get("content") != "sil" and word.get("total_score") is not None


def to_assessment(xml: str, reference: str) -> dict:
    chapter = _parse(xml)
    pron = _score(chapter, "total_score")
    accuracy = _score(chapter, "accuracy_score")
    fluency = _score(chapter, "fluency_score")
    completeness = _score(chapter, "integrity_score")
    words = [_convert_word(w) for w in chapter.iter("word") if _is_speech_word(w)]
    return {
        "pronunciation_score": pron,
        "accuracy_score": accuracy,
        "fluency_score": fluency,
        "completeness_score": completeness,
        "detail_result": {
            "confidence": 1.0,
            "display": reference,
            "itn": reference,
            "lexical": " ".join(w["word"].lower() for w in words),
            "masked_itn": reference,
            "pronunciation_assessment": {
                "accuracy_score": accuracy,
                "completeness_score": completeness,
                "fluency_score": fluency,
                "pron_score": pron,
            },
            "rejected": chapter.get("is_rejected", "false").lower() == "true",
            "reject_type": chapter.get("reject_type", "0"),
            "words": words,
        },
    }
