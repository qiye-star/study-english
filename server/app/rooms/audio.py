"""Room voice audio (spec 2026-10-10 §4.2, §4.8, §12): WAV checks, MP3 encoding and the file layout.

Uploads are 16 kHz mono 16-bit WAV only; the stored copy is MP3 24 kbps (or the WAV itself when
ROOMS_VOICE_STORE_FORMAT=wav, or when encoding fails). Files live under `{DATA_DIR}/room_audio/`, never under
`recordings/` (R2-18: the orphan-recordings tool only knows assessment audio). Every path goes through
`services.recordings.absolute_path` (directory-escape check). Room audio is kept forever: nothing here deletes
a stored clip on its own; `delete_file` is for staging WAVs and for undoing a failed upload. Never logs audio."""
import logging
from dataclasses import dataclass
from pathlib import Path

from app.services.recordings import absolute_path, delete_recording, write_recording
from app.speech.asr_stream import wav_to_pcm

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 2_100_000  # 60.5 s of 16 kHz mono WAV (~1 936 044 bytes) plus form overhead
MP3_KBPS = 24
SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2
OVER_CAP_MS = 500  # the gesture stops 250 ms before the cap; allow some slack (spec §4.2: up to 60.5 s)
MEDIA_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav"}
ROOT = "room_audio"


class AudioError(Exception):
    def __init__(self, code: str):  # "bad_audio" | "too_short" | "too_long"
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class WavInfo:
    pcm: bytes
    duration_ms: int


def inspect_wav(data: bytes, *, min_ms: int, max_ms: int) -> WavInfo:
    """The PCM and duration of a 16 kHz mono PCM16 WAV; anything else is `bad_audio`."""
    pcm = wav_to_pcm(data) if data else None
    if pcm is None:
        raise AudioError("bad_audio")
    duration_ms = len(pcm) * 1000 // BYTES_PER_SECOND
    if duration_ms < min_ms:
        raise AudioError("too_short")
    if duration_ms > max_ms + OVER_CAP_MS:
        raise AudioError("too_long")
    return WavInfo(pcm=pcm, duration_ms=duration_ms)


def encode_mp3(pcm: bytes) -> bytes:
    """16 kHz mono PCM16 -> MPEG-2 Layer III, 24 kbps CBR (same parameters as the F0 smoke test)."""
    import lameenc  # imported lazily: a missing wheel only disables MP3, not the whole app

    enc = lameenc.Encoder()
    enc.set_bit_rate(MP3_KBPS)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(5)
    return bytes(enc.encode(pcm)) + bytes(enc.flush())


def stored_audio(wav: bytes, pcm: bytes, fmt: str) -> tuple[bytes, str]:
    """(bytes, format) to store. `mp3` encodes; if encoding fails the WAV is kept as is (clean fallback)."""
    if fmt != "mp3":
        return wav, "wav"
    try:
        data = encode_mp3(pcm)
        if not data:
            raise ValueError("empty mp3")
        return data, "mp3"
    except Exception as e:  # ImportError, encoder errors: keep the clip rather than lose it
        logger.warning("room voice mp3 encoding failed error=%s; storing wav", type(e).__name__)
        return wav, "wav"


def audio_relpath(room_id: str, message_id: str, fmt: str) -> str:
    return f"{ROOT}/{room_id}/{message_id}.{fmt}"


def staging_relpath(message_id: str) -> str:
    return f"{ROOT}/_staging/{message_id}.wav"


def write_file(data_dir: Path, relpath: str, data: bytes) -> None:
    """Atomic write inside the data dir (ValueError on an escaping path)."""
    write_recording(data_dir, relpath, data)


def read_file(data_dir: Path, relpath: str) -> bytes:
    return absolute_path(data_dir, relpath).read_bytes()


def delete_file(data_dir: Path, relpath: str) -> None:
    """Never raises (missing file, escaping path)."""
    delete_recording(data_dir, relpath)
