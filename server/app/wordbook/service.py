"""背单词编排(S 车道实现;F3 先放 config_out)。"""
from app.core.config import Settings
from app.wordbook.books import BOOKS, enabled_books


def config_out(settings: Settings) -> dict:
    """GET /api/wordbook/config(开关打开时)。available = 数据文件存在(校验和由管理端/诊断检查,这里不做 I/O 以外的事)。"""
    data_dir = settings.resolved_wordbook_data_dir
    enabled = enabled_books(settings.wordbook_books)
    return {
        "enabled": True,
        "ai_available": settings.wordbook_ai_available,
        "defaults": {"daily_new": settings.wordbook_daily_new, "review_cap": settings.wordbook_review_cap},
        "books": [{"id": b.id, "title_zh": b.title_zh, "title_en": b.title_en, "level": b.level, "words": b.unique,
                   "available": (data_dir / b.file).is_file()} for b in BOOKS if b.id in enabled],
    }
