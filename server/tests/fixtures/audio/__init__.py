"""Test audio generated on the fly (plan P2-7): no binary fixtures are committed."""
import io
import math
import struct
import wave


def wav_bytes(seconds: float, rate: int = 16000, channels: int = 1) -> bytes:
    """A 440 Hz sine as a PCM16 WAV."""
    frames = int(seconds * rate)
    pcm = b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / rate))) * channels
                   for i in range(frames))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()
