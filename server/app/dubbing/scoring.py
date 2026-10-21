"""逐句与整段打分(纯函数,只依赖标准库;plan L5 R11、R12)。

所有权重与曲线都是占位,未用真机样本校准(plan L5 风险一节)。
- 词偏移单位:`providers/xfyun_result.py` 的 `TICKS_PER_FRAME = 100_000`,即 100 ns 刻度,10 000 刻度 = 1 ms(`TICKS_PER_MS`)。
- 同步度只在词偏移可用时看开口时刻;否则只看时长比;两者都没有时为 None(不计同步)。
"""
import math
from dataclasses import dataclass

# PLACEHOLDER: weights, tolerance and curves are not calibrated (plan L5 R11). Tune with device samples only.
W_PRON = 0.6
W_FLUENCY = 0.2
W_SYNC = 0.2
SYNC_TOLERANCE_MS = 400  # the opening may be this late or early without losing points (mic / playback delay)
ONSET_FALLOFF_MS = 1000  # then the onset score falls linearly to 0 over this many ms
RATIO_LOW, RATIO_HIGH = 0.8, 1.25  # full marks for the duration ratio inside this band
RATIO_ZERO_LOW, RATIO_ZERO_HIGH = 0.4, 2.5  # zero at and beyond these ends, linear in between
TICKS_PER_MS = 10_000  # xfyun_result.TICKS_PER_FRAME (100 000 ticks = 10 ms) / 10 ms = 10 000 ticks per ms
WAV_TAIL_MS = 100  # a word may end this long after the WAV without making the timing unusable


@dataclass(frozen=True)
class Span:
    start_ms: int  # relative to the WAV's first sample
    end_ms: int


def _num(value: object) -> float | None:
    """A finite real number, or None. bool, strings and NaN are not numbers here."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _clamp(value: float) -> float:
    return min(100.0, max(0.0, value))


def _int_field(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def spoken_span(result: object, wav_ms: int) -> Span | None:
    """The part of the WAV where the user spoke, from the ISE word offsets, or None when the offsets are not trustworthy.

    Uses the words that are not omissions and have a positive duration: the first one opens, the last one closes.
    None when: there is no such word; the offsets go backwards; the last word ends later than the WAV plus 100 ms;
    every offset is zero; or the result has an unexpected shape (never raises)."""
    if not isinstance(result, dict):
        return None
    detail = result.get("detail_result")
    words = detail.get("words") if isinstance(detail, dict) else None
    if not isinstance(words, list):
        return None
    spoken: list[tuple[int, int]] = []
    for word in words:
        if not isinstance(word, dict):
            continue
        offset, duration = _int_field(word.get("offset")), _int_field(word.get("duration"))
        pa = word.get("pronunciation_assessment")
        error_type = pa.get("error_type") if isinstance(pa, dict) else None
        if offset is None or duration is None or error_type == "Omission" or duration <= 0:
            continue
        spoken.append((offset, duration))
    if not spoken:
        return None
    offsets = [offset for offset, _ in spoken]
    if any(later < earlier for earlier, later in zip(offsets, offsets[1:])):
        return None
    if all(offset == 0 for offset in offsets):
        return None
    last_offset, last_duration = spoken[-1]
    start_ms = round(offsets[0] / TICKS_PER_MS)
    end_ms = round((last_offset + last_duration) / TICKS_PER_MS)
    if end_ms > wav_ms + WAV_TAIL_MS:
        return None
    return Span(start_ms=start_ms, end_ms=end_ms)


def onset_score(err_ms: float) -> float:
    """100 within the tolerance, then linear to 0 over ONSET_FALLOFF_MS. Symmetric; NaN and infinity score 0."""
    if not math.isfinite(err_ms):
        return 0.0
    excess = abs(err_ms) - SYNC_TOLERANCE_MS
    if excess <= 0:
        return 100.0
    return _clamp(100.0 * (1.0 - excess / ONSET_FALLOFF_MS))


def ratio_score(ratio: float) -> float:
    """100 inside [RATIO_LOW, RATIO_HIGH], linear to 0 at RATIO_ZERO_LOW / RATIO_ZERO_HIGH; not positive or finite: 0."""
    if not math.isfinite(ratio) or ratio <= 0:
        return 0.0
    if RATIO_LOW <= ratio <= RATIO_HIGH:
        return 100.0
    if ratio < RATIO_LOW:
        return _clamp(100.0 * (ratio - RATIO_ZERO_LOW) / (RATIO_LOW - RATIO_ZERO_LOW))
    return _clamp(100.0 * (RATIO_ZERO_HIGH - ratio) / (RATIO_ZERO_HIGH - RATIO_HIGH))


def _valid_voiced(voiced_ms: object) -> int | None:
    value = _int_field(voiced_ms)
    return value if value is not None and value >= 0 else None


def sync_score(*, seg_start_ms: int, seg_end_ms: int, rec_start_ms: int | None, capture: str,
               span: Span | None, voiced_ms: int | None) -> tuple[int | None, str]:
    """Synchronisation 0–100 and its basis: "words" (opening and length), "duration" (length only) or "none" (None).

    `capture == "pcm"` with a span and a record start: opening + length from the words ("words").
    Otherwise a span gives the length alone ("duration"); the recorder path never trusts the opening.
    Without a span, `voiced_ms` (energy gate) gives the length alone ("duration")."""
    original = seg_end_ms - seg_start_ms
    if original <= 0:
        return None, "none"
    if span is not None:
        duration = ratio_score((span.end_ms - span.start_ms) / original)
        if capture == "pcm" and rec_start_ms is not None:
            onset = onset_score((rec_start_ms + span.start_ms) - seg_start_ms)
            return round(0.5 * onset + 0.5 * duration), "words"
        return round(duration), "duration"
    voiced = _valid_voiced(voiced_ms)
    if voiced is not None:
        return round(ratio_score(voiced / original)), "duration"
    return None, "none"


def line_score(pron: object, fluency: object, sync: int | None) -> int:
    """One line's score. Without sync the weights renormalise to 75 % pronunciation and 25 % fluency."""
    p = _clamp(_num(pron) or 0.0)
    f = _clamp(_num(fluency) or 0.0)
    if sync is None:
        return round(0.75 * p + 0.25 * f)
    s = _clamp(_num(sync) or 0.0)
    return round(W_PRON * p + W_FLUENCY * f + W_SYNC * s)


def _average(values: list[float]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def take_summary(lines: dict, expected: list[int]) -> tuple[int | None, dict]:
    """Total over the role's sentences (missing ones count as 0) and per-metric averages over the recorded ones.

    `lines` may have string keys (after a JSON round trip). No role sentences in `expected` gives total None."""
    empty = {"pronunciation": None, "fluency": None, "sync": None}
    if not expected:
        return None, empty
    by_idx: dict[int, object] = {}
    for key, entry in lines.items():
        try:
            by_idx[int(key)] = entry
        except (TypeError, ValueError):
            continue
    totals: list[float] = []
    pron: list[float] = []
    flu: list[float] = []
    sync: list[float] = []
    for idx in expected:
        entry = by_idx.get(idx)
        score = _num(entry.get("score")) if isinstance(entry, dict) and "missing" not in entry else None
        if score is None:
            totals.append(0.0)
            continue
        totals.append(_clamp(score))
        for values, field in ((pron, "pronunciation"), (flu, "fluency"), (sync, "sync")):
            value = _num(entry.get(field))
            if value is not None:
                values.append(_clamp(value))
    total = round(sum(totals) / len(totals))
    return total, {"pronunciation": _average(pron), "fluency": _average(flu), "sync": _average(sync)}
