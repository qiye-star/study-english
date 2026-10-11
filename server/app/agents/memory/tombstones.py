"""规范化、文本哈希、敏感内容过滤与墓碑(spec 2026-10-12-agents §8.3、计划 A2 R-M9)。

`clean_text` 用于存储(NFKC、单行、去控制字符);`text_hash` 用于去重与墓碑(再去掉标点与大小写差异);
`unsafe_reason` 拒绝邮箱、URL、疑似密钥、长数字串、手机号(日期不算);`redact` 把同样的片段换成「[略]」(摘要 / 回顾用)。
墓碑只存哈希,不存文本。本模块不写日志。"""
import hashlib
import re
import unicodedata
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import insert_ignore
from app.models import AgentMemoryTombstone

TOMBSTONES_MAX = 1000
REDACTED = "[略]"

_SPACE = re.compile(r"\s+")
_PUNCT = re.compile(r"[\W_]+")
DATE = re.compile(r"\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b")
# 邮箱含「at / dot」拼写(tom at gmail dot com、tom (at) gmail (dot) com、艾特 / 点)
EMAIL = re.compile(
    r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"
    r"|[\w.+-]+\s*(?:[(\[]\s*at\s*[)\]]|\bat\b|艾特)\s*[\w-]+\s*(?:[(\[]\s*dot\s*[)\]]|\bdot\b|点)\s*(?:com|cn|net|org|edu|gov|io|me|co|uk|ai)\b",
    re.I,
)
# 带路径的任意域名(host.tld/path)与常见短链域名也算链接
URL = re.compile(
    r"(?:https?://|www\.)\S+|\b[\w-]+\.(?:com|cn|net|org|io|me|app|dev|top|xyz|ai)\b(?:/\S*)?"
    r"|\b(?:bit\.ly|t\.co|t\.cn|url\.cn|dwz\.cn|tinyurl\.com|goo\.gl|is\.gd|ow\.ly|buff\.ly|rb\.gy|cutt\.ly|reurl\.cc)\b(?:/\S*)?"
    r"|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/\S+",
    re.I,
)
SECRET = re.compile(
    r"\b(?:sk|pk|ak|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_\-]{8,}"
    r"|\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{12,}\b|\bAIza[\w\-]{20,}|\b(?:github_pat|glpat)[-_][\w\-]{12,}"
    r"|\beyJ[\w\-]{10,}\.[\w\-]{5,}|-----BEGIN [A-Z ]*PRIVATE KEY"
    r"|\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{24,}\b"
    r"|password|passwd|密码|口令|验证码|api[\s_-]?key|access[\s_-]?token"
    r"|\b(?:pw|pwd|pswd|passcode)\b\s*[:=：]?\s*\S",
    re.I,
)
# 微信 / 微信号 / wechat / vx 后面跟含数字或下划线的账号
CONTACT = re.compile(
    r"(?:微信|v信|wechat|weixin|\bvx|\bwx)\s*(?:号|id)?\s*[:：=是为]?\s*(?=[A-Za-z0-9_\-]*[\d_])[A-Za-z][\w\-]{5,}",
    re.I,
)
LONG_DIGITS = re.compile(r"\d{6,}|[零〇一二三四五六七八九幺壹贰叁肆伍陆柒捌玖]{7,}")
PHONE = re.compile(r"(?<!\w)\+?\d(?:[\s.\-/_|·]?\d){6,}(?!\w)")
_RULES = (("email", EMAIL), ("url", URL), ("secret", SECRET), ("contact", CONTACT), ("digits", LONG_DIGITS),
          ("phone", PHONE))
_HOLD = re.compile(r"⟦(\d+)⟧")


def clean_text(text: str) -> str:
    text = _SPACE.sub(" ", unicodedata.normalize("NFKC", text))
    return "".join(ch for ch in text if unicodedata.category(ch)[0] != "C").strip()


def text_hash(text: str) -> str:
    return hashlib.sha256(_PUNCT.sub("", clean_text(text).casefold()).encode("utf-8")).hexdigest()


def unsafe_reason(text: str) -> str | None:
    probe = DATE.sub(" ", text)
    for name, rule in _RULES:
        if rule.search(probe):
            return name
    return None


def redact(text: str) -> str:
    dates: list[str] = []

    def hold(match: re.Match) -> str:
        dates.append(match.group(0))
        return f"⟦{len(dates) - 1}⟧"

    out = DATE.sub(hold, text)
    for _, rule in _RULES:
        out = rule.sub(REDACTED, out)
    return _HOLD.sub(lambda m: dates[int(m.group(1))], out)


async def buried(session: AsyncSession, user_id: int, hashes: Iterable[str]) -> set[str]:
    wanted = sorted(set(hashes))
    if not wanted:
        return set()
    rows = await session.scalars(select(AgentMemoryTombstone.text_hash).where(
        AgentMemoryTombstone.user_id == user_id, AgentMemoryTombstone.text_hash.in_(wanted)))
    return set(rows.all())


async def bury(session: AsyncSession, user_id: int, hashes: Iterable[str], now: datetime) -> None:
    """写墓碑(不提交;调用方提交)。每人最多 TOMBSTONES_MAX 条,超出删最旧的。"""
    values = [{"user_id": user_id, "text_hash": h, "created_at": now} for h in sorted(set(hashes))][-TOMBSTONES_MAX:]
    if not values:
        return
    await session.execute(insert_ignore(session, AgentMemoryTombstone).values(values))
    total = await session.scalar(select(func.count()).select_from(AgentMemoryTombstone)
                                 .where(AgentMemoryTombstone.user_id == user_id))
    extra = int(total or 0) - TOMBSTONES_MAX
    if extra > 0:
        old = (await session.scalars(select(AgentMemoryTombstone.text_hash)
                                     .where(AgentMemoryTombstone.user_id == user_id)
                                     .order_by(AgentMemoryTombstone.created_at, AgentMemoryTombstone.text_hash)
                                     .limit(extra))).all()
        await session.execute(delete(AgentMemoryTombstone).where(
            AgentMemoryTombstone.user_id == user_id, AgentMemoryTombstone.text_hash.in_(list(old))))
