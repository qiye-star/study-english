"""识别结果「带时间」的形状(plan 2026-10-13-library-alignment R-A2;词级时间见 plan 2026-10-14-library-alignment-v2 R-V1):
纯数据,没有协议细节,只依赖标准库。

`Utterance`:识别服务自己切出的一句(或一段),`start_ms` / `end_ms` 相对**发送出去的那段音频的起点**(跟读库发送的是识别块的
WAV 切片,所以相对块起点,R-A1)。`words`:这一句里每个真实词的时间(占位条目已在解析时丢掉),与句子同一个时间基准
(v2 Task 0 验证);空 = 识别服务没给。
`TimedText.utterances` 为空 = 这条识别路径没有给时间(Whisper chat 回落、旧协议)。
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Word:
    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class Utterance:
    text: str
    start_ms: int
    end_ms: int
    words: tuple[Word, ...] = ()


@dataclass(frozen=True)
class TimedText:
    text: str
    utterances: tuple[Utterance, ...] = ()
