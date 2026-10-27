"""简单英英释义的后台部分(计划 2026-10-27 R-S5)。

S4:启动时把缓存表读进内存(`warm`);读路径从不等待这里。失败只记异常类型,读路径退回原文。
日志只记种类与计数,不记词、原文、改写文本或提示词。"""
import logging

from app.wordbook.simple_defs import simple_of

logger = logging.getLogger(__name__)


async def warm(app) -> None:
    try:
        await simple_of(app).warm(app.state.sessionmaker)
    except Exception as e:  # e.g. the table is missing on an old database: the read path keeps the originals
        logger.warning("simple defs warm failed kind=%s", type(e).__name__)
