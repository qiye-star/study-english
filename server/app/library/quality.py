"""句边界的合理性检查(spec §4.3.4、裁定 R-Q1;纯函数)。

不是判官,只是给学习者一个提示:这条素材的句边界可能不准(列表与播放页显示「可重新识别或微调」)。两条规则,任一成立即可疑:
1. 某个够长(≥ 20 个字符,含空格)的句子,字符速度 < 6 或 > 25 字符 / 秒。正常语速约 12–17,慢速教学音频约 7–9;
   用户那条素材 62 个字符被摊成 13 s = 4.8 字符 / 秒,会被抓到。
2. 某个**估算**块(识别服务没给可信的时间)里说话占比(`speech_span` / 块长)< 40%。
有可信真实时间的块不看说话占比:背景音乐 + 少量人声是合法的。
"""
from collections.abc import Sequence

from app.library.asr_chunks import Chunk, Silence, estimated_chunks, speech_span
from app.library.segment import Sentence

MIN_CHARS = 20
MIN_CPS = 6.0
MAX_CPS = 25.0
MIN_SPEECH_SHARE = 0.4


def rate_outliers(sentences: Sequence[Sentence]) -> int:
    count = 0
    for s in sentences:
        if len(s.text) < MIN_CHARS:
            continue
        seconds = (s.end_ms - s.start_ms) / 1000
        if seconds <= 0 or not MIN_CPS <= len(s.text) / seconds <= MAX_CPS:
            count += 1
    return count


def estimated_share(chunk: Chunk, silences: list[Silence]) -> float:
    s0, s1 = speech_span(chunk, silences)
    return (s1 - s0) / max(1, chunk.end_ms - chunk.start_ms)


def is_low_confidence(sentences: Sequence[Sentence], chunks: list[Chunk], silences: list[Silence]) -> bool:
    if rate_outliers(sentences) > 0:
        return True
    return any(estimated_share(c, silences) < MIN_SPEECH_SHARE for c in estimated_chunks(chunks))
