"""<<META>> 输出协议(spec 2026-10-12-agents §7.3;R-T3、R-T5):纯函数。

模型输出纯文本(点评 + 下一题),末尾一行 `<<META>>{json}`。StreamFilter 边流边剥:标记及其后的内容永不放行,
即使标记被拆在多个增量里;标记前的尾随空白也不放行。回合结束后用 parse_meta 解析原文;缺失或无效交给 resolve。"""
import json
import re
from dataclasses import dataclass, replace

from app.agents.tutor.plan import KINDS

META_MARKER = "<<META>>"
VERDICTS: tuple[str, ...] = ("good", "ok", "weak", "skip")
MAX_FOCUS, MAX_HINT, MAX_SAY = 60, 120, 160
_WS = " \t\r\n"
_OPEN, _CLOSE = "<«‹＜〈《", ">»›＞〉》"
# 标记容忍大小写、括号内外的空白、全角 / 法文引号(`<< META >>`、`«META»`);只匹配「括号 + META + 括号」
_MARK = re.compile(rf"[{_OPEN}]+\s{{0,8}}META\s{{0,8}}[{_CLOSE}]+", re.IGNORECASE)
# 缓冲区末尾「可能是标记开头」的部分(含前导空白由 _hold 另行处理)
_PARTIAL = re.compile(rf"[{_OPEN}]+(?:\s{{0,8}}(?:M(?:E(?:T(?:A\s{{0,8}})?)?)?)?)?$", re.IGNORECASE)
_CTRL = re.compile("[\\x00-\\x1f\\x7f-\\x9f   ]+")


@dataclass(frozen=True)
class Meta:
    verdict: str | None = None
    kind: str | None = None
    next_focus: str = ""
    hint: str = ""
    say: str = ""
    done: bool = False


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(_CTRL.sub(" ", value).replace("<", "‹").replace(">", "›").split())[:limit]


def parse_meta(text: str) -> tuple[str, Meta | None]:
    text = text or ""
    found = _MARK.search(text)
    if found is None:
        return text.rstrip(_WS), None
    visible = text[: found.start()].rstrip(_WS)
    raw = text[found.end():]
    start = raw.find("{")
    if start < 0:
        return visible, None
    try:
        data, _ = json.JSONDecoder().raw_decode(raw[start:])
    except ValueError:
        return visible, None
    if not isinstance(data, dict):
        return visible, None
    verdict, kind = data.get("verdict"), data.get("kind")
    return visible, Meta(
        verdict=verdict if isinstance(verdict, str) and verdict in VERDICTS else None,
        kind=kind if isinstance(kind, str) and kind in KINDS else None,
        next_focus=_text(data.get("next_focus"), MAX_FOCUS),
        hint=_text(data.get("hint"), MAX_HINT),
        say=_text(data.get("say"), MAX_SAY),
        done=data.get("done") is True,
    )


def _hold(buf: str) -> int:
    """缓冲区末尾需要暂扣的字符数:可能是标记开头的后缀,以及它前面的空白。"""
    found = _PARTIAL.search(buf)
    j = found.start() if found is not None else len(buf)
    while j > 0 and buf[j - 1] in _WS:
        j -= 1
    return len(buf) - j


class StreamFilter:
    """每回合一个实例。feed 返回可以立刻发给用户的文本;flush 在流结束时放出暂扣的部分。"""

    def __init__(self) -> None:
        self._pending = ""
        self._tail: str | None = None

    @property
    def seen(self) -> bool:
        return self._tail is not None

    @property
    def tail(self) -> str:
        return self._tail or ""

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        if self._tail is not None:
            self._tail += chunk
            return ""
        buf = self._pending + chunk
        found = _MARK.search(buf)
        if found is not None:
            self._tail = buf[found.end():]
            self._pending = ""
            return buf[: found.start()].rstrip(_WS)
        cut = len(buf) - _hold(buf)
        self._pending = buf[cut:]
        return buf[:cut]

    def flush(self) -> str:
        if self._tail is not None:
            return ""
        out, self._pending = self._pending, ""
        return out.rstrip(_WS)


def resolve(meta: Meta | None, *, answering: bool) -> tuple[Meta, bool]:
    """缺失或无效 → 代码规则(spec §7.3):回答回合 verdict 记 ok;出题回合没有 verdict。题型、结束永远由计划决定。"""
    if meta is None:
        return Meta(verdict="ok" if answering else None), True
    if not answering:
        return replace(meta, verdict=None), False
    if meta.verdict is None:
        return replace(meta, verdict="ok"), True
    return meta, False
