"""联动的静态描述(spec 2026-10-11-learning-links §6、§7)。"""
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.vocabulary import MAX_WORD, validate_word

LINK_KEYS: tuple[str, ...] = ("word_actions", "daily_tasks", "mistakes", "pron_shadow", "chat_words", "rank_sources")


def flag_of(key: str) -> str:
    return f"link_{key}_enabled"


@dataclass(frozen=True)
class LinkSpec:
    key: str
    label_zh: str
    label_en: str
    install: Callable[[Any, Any], None] | None = None  # (app, bus) -> None:订阅事件、登记段位来源
    router: Any = None  # fastapi.APIRouter | None,挂在 /api/links 下

    @property
    def flag(self) -> str:
        return flag_of(self.key)


class WordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str = Field(min_length=1, max_length=2 * MAX_WORD)

    @field_validator("word")
    @classmethod
    def _word(cls, value: str) -> str:
        return validate_word(value)
