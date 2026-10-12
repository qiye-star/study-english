"""回复语言(spec 2026-10-12-agents-addressing §5;计划 2026-10-12-agents-addressing-server L1)。纯函数,只用标准库。

- `want_note(setting, level)`:是否请模型写中文说明(用户设置 `zh_note` × 角色 / 题目水平,R-AS9)。
- `chat_rule(want)`:聊天模式(1:1 与联机的普通回合)的语言说明,编排器放在模式块之后(我们写的,不转义)。
- `MarkerFilter` / `split_marker`:`<<ZH>>` 及其后的内容边流边剥;标记可以被拆在多个增量里,括号变体与 `<<META>>` 一样宽容。
- `SentenceGate` / `sanitize`:兜底(R-AS10)。逐句判断是否「中文句」;中文句从第一个中文字符起不进公开文本、记进
  `removed`;英文句与只带短人名的句子原样放行。没有中文字符的文字立即放行,不增加首字延迟。
- `Chain`:把过滤器串起来(导师 `<<META>>` → `<<ZH>>` → 兜底)。
- `clean_note` / `resolve_note`:`note_zh` 清洗(≤ 80 字)与来源优先级(R-AS11)。
不变式:任意拆分下的流式输出 == 一次性输入的输出(`tests/test_agents_lang.py` 的模糊测试)。文本永不进日志。"""
import re

NOTE_MAX = 80
ZH_SETTINGS = ("auto", "always", "never")
NOTE_LEVELS = frozenset({"A1", "A2", "B1"})  # auto:A2 / B1 写中文说明(房间 A1 也算),B2 以上不写
RUN_MAX = 4  # 连续 ≤ 4 个中文字符当作人名 / 专有名词
COUNT_MAX = 8  # 一句里中文字符超过 8 个就是中文句
SHARE_MIN = 0.5  # 或:至少 3 个中文字符且占该句字母的一半以上
_WS = " \t\r\n"
_OPEN, _CLOSE = "<«‹＜〈《", ">»›＞〉》"
_CTRL = re.compile("[\\x00-\\x1f\\x7f-\\x9f  ]+")
# 句子边界:英文句末标点 + 空白,中文句末标点(可以没有空白),或换行。流式时只认后面还有字符的边界(贪婪量词已定)。
_BOUNDARY = re.compile(r"[.!?…]+[\"'”’)\]]*\s+|[。！？]+[\"'”’」』）)\]]*\s*|\n\s*")

CHAT_RULE_NOTE = (
    "Language: write your reply in simple English only, with no Chinese characters (a person's name may stay as "
    "written). If a short Chinese explanation would really help this learner, add it as the very last line in exactly "
    "this form: <<ZH>> <at most 40 Chinese characters>. That line is hidden from the reply and never read aloud.")
CHAT_RULE_EN = (
    "Language: write your reply in simple English only. Do not write any Chinese characters, not even a translation "
    "or a note.")


def want_note(setting: object, level: object) -> bool:
    if setting == "always":
        return True
    if setting == "never":
        return False
    return level in NOTE_LEVELS


def chat_rule(want: bool) -> str:
    return CHAT_RULE_NOTE if want else CHAT_RULE_EN


def _letter(ch: str) -> bool:
    """CJK 统一表意文字(含扩展 A、兼容区、扩展 B 起)与平假名 / 片假名。"""
    o = ord(ch)
    return (0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x2FA1F
            or 0x3040 <= o <= 0x30FF or 0x31F0 <= o <= 0x31FF)


def _punct(ch: str) -> bool:
    """CJK 符号与标点(U+3000–303F)与全角标点(不含全角字母、数字)。"""
    o = ord(ch)
    return (0x3000 <= o <= 0x303F or 0xFF01 <= o <= 0xFF0F or 0xFF1A <= o <= 0xFF20 or 0xFF3B <= o <= 0xFF40
            or 0xFF5B <= o <= 0xFF65)


def _first_zh(text: str) -> int | None:
    for i, ch in enumerate(text):
        if _letter(ch) or _punct(ch):
            return i
    return None


def is_chinese(sentence: str) -> bool:
    run = longest = count = letters = 0
    for ch in sentence:
        if _punct(ch):
            return True
        if _letter(ch):
            run += 1
            count += 1
            longest = max(longest, run)
        else:
            run = 0
        if ch.isalpha():
            letters += 1
    return longest > RUN_MAX or count > COUNT_MAX or (count >= 3 and count >= SHARE_MIN * letters)


def clean_note(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(_CTRL.sub(" ", value).replace("<", "‹").replace(">", "›").split())[:NOTE_MAX].strip()
    return text or None


def resolve_note(setting: object, mode_note: object, marker_note: object, removed: list[str]) -> str | None:
    """`never` = 永远没有中文说明;否则取第一个非空来源:模式 META 的 `note_zh` → `<<ZH>>` 行 → 被拿掉的中文片段。"""
    if setting == "never":
        return None
    for candidate in (mode_note, marker_note, " ".join(removed)):
        note = clean_note(candidate)
        if note:
            return note
    return None


def _marker(word: str) -> re.Pattern:
    return re.compile(rf"[{_OPEN}]+\s{{0,8}}{re.escape(word)}\s{{0,8}}[{_CLOSE}]+", re.IGNORECASE)


def _partial(word: str) -> re.Pattern:
    """缓冲区末尾「可能是标记开头」的部分(`<`、`<<Z`、`<< ZH ` …),与 tutor.parse 的 `_PARTIAL` 同一写法。"""
    inner = ""
    for ch in reversed(word):
        inner = re.escape(ch) + (f"(?:{inner})?" if inner else r"(?:\s{0,8})?")
    return re.compile(rf"[{_OPEN}]+(?:\s{{0,8}}(?:{inner})?)?$", re.IGNORECASE)


_ZH, _ZH_PARTIAL = _marker("ZH"), _partial("ZH")


def split_marker(text: str) -> tuple[str, str]:
    """一次性版本:(标记前的可见文字,去掉尾随空白;标记后的原文);没有标记 → (原文, "")。"""
    text = text or ""
    found = _ZH.search(text)
    if found is None:
        return text, ""
    return text[: found.start()].rstrip(_WS), text[found.end():]


class MarkerFilter:
    """`<<ZH>>` 流式过滤,每回合一个实例。`tail` 是标记之后的原文(回合结束后是 `note_zh` 的候选)。"""

    def __init__(self) -> None:
        self._pending = ""
        self._tail: str | None = None
        self._closing = False  # the marker matched at the end of a chunk: more closing brackets may still follow

    @property
    def tail(self) -> str:
        return self._tail or ""

    @staticmethod
    def _hold(buf: str) -> int:
        found = _ZH_PARTIAL.search(buf)
        j = found.start() if found is not None else len(buf)
        while j > 0 and buf[j - 1] in _WS:
            j -= 1
        return len(buf) - j

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        if self._tail is not None:
            if self._closing:  # `<<ZH>` + `>` split across chunks: the stray closer is not part of the note
                chunk = chunk.lstrip(_CLOSE)
                self._closing = not chunk
            self._tail += chunk
            return ""
        buf = self._pending + chunk
        found = _ZH.search(buf)
        if found is not None:
            self._tail, self._pending = buf[found.end():], ""
            self._closing = found.end() == len(buf)
            return buf[: found.start()].rstrip(_WS)
        cut = len(buf) - self._hold(buf)
        self._pending = buf[cut:]
        return buf[:cut]

    def flush(self) -> str:
        if self._tail is not None:
            return ""
        out, self._pending = self._pending, ""
        return out


class SentenceGate:
    """中文句兜底(R-AS10),每回合一个实例。`removed` 是被拿掉的中文片段(按出现顺序)。"""

    def __init__(self) -> None:
        self._buf = ""  # 当前未结束的句子:已放行的前缀 + 暂扣的部分
        self._sent = 0  # _buf 里已放行的字符数
        self.removed: list[str] = []

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self._buf += chunk
        out: list[str] = []
        while True:
            found = _BOUNDARY.search(self._buf)
            if found is None or found.end() >= len(self._buf):
                break
            out.append(self._finish(self._buf[: found.end()]))
            self._buf, self._sent = self._buf[found.end():], 0
        out.append(self._eager())
        return "".join(out)

    def flush(self) -> str:
        out = self._finish(self._buf) if self._buf else ""
        self._buf, self._sent = "", 0
        return out

    def _eager(self) -> str:
        stop = _first_zh(self._buf)
        end = len(self._buf) if stop is None else stop
        if end <= self._sent:
            return ""
        out, self._sent = self._buf[self._sent:end], end
        return out

    def _finish(self, sentence: str) -> str:
        stop = _first_zh(sentence)
        if stop is not None and is_chinese(sentence):
            rest = sentence[stop:].strip()
            if rest:
                self.removed.append(rest)
            return sentence[self._sent:stop] if stop > self._sent else ""
        return sentence[self._sent:]


def sanitize(text: str) -> tuple[str, list[str]]:
    """一次性版本(落库前的公开文本):(保留的文字, 被拿掉的中文片段)。"""
    gate = SentenceGate()
    out = gate.feed(text or "") + gate.flush()
    return out, gate.removed


class Chain:
    """依次经过每个过滤器(`feed` / `flush` 协议同 orchestrator.StreamFilter)。"""

    def __init__(self, *filters) -> None:
        self._filters = filters

    def feed(self, chunk: str) -> str:
        for f in self._filters:
            if not chunk:
                return ""
            chunk = f.feed(chunk)
        return chunk

    def flush(self) -> str:
        carry = ""
        for f in self._filters:
            carry = (f.feed(carry) if carry else "") + f.flush()
        return carry
