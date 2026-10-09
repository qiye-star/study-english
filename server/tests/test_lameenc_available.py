import math
import struct


def test_lameenc_encodes_16k_mono_pcm_to_mpeg2_layer3():
    import lameenc

    pcm = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(16000))
    enc = lameenc.Encoder()
    enc.set_bit_rate(24)
    enc.set_in_sample_rate(16000)
    enc.set_channels(1)
    enc.set_quality(5)
    mp3 = bytes(enc.encode(pcm)) + bytes(enc.flush())
    assert mp3[0] == 0xFF and mp3[1] & 0xE0 == 0xE0  # MPEG frame sync
    assert 2_000 < len(mp3) < 5_000  # ~3 000 bytes for one second at 24 kbps
