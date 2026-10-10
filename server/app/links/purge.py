"""保留期清理(spec §12):link_word_uses 超过 links_retention_days、易错词 / 弱词移出超过 30 天的行。"""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete

from app.models import LinkMistakeWord, LinkWeakWord, LinkWordUse, utcnow

logger = logging.getLogger(__name__)
CLEARED_DAYS = 30


async def purge(session, now: datetime, retention_days: int) -> dict[str, int]:
    uses = await session.execute(delete(LinkWordUse).where(LinkWordUse.created_at < now - timedelta(days=retention_days)))
    cut = now - timedelta(days=CLEARED_DAYS)
    mistakes = await session.execute(delete(LinkMistakeWord).where(LinkMistakeWord.cleared_at < cut))
    weak = await session.execute(delete(LinkWeakWord).where(LinkWeakWord.cleared_at < cut))
    await session.commit()
    return {"word_uses": uses.rowcount, "mistakes": mistakes.rowcount, "weak_words": weak.rowcount}


async def daily_loop(app, interval: float = 21600.0) -> None:
    while True:
        try:
            async with app.state.sessionmaker() as session:
                counts = await purge(session, utcnow(), app.state.settings.links_retention_days)
            logger.info("links purge word_uses=%d mistakes=%d weak_words=%d", counts["word_uses"], counts["mistakes"],
                        counts["weak_words"])
        except Exception as exc:  # noqa: BLE001 - housekeeping must not die
            logger.warning("links purge failed error=%s", type(exc).__name__)
        await asyncio.sleep(interval)
