"""联动清单(计划 P-L3):删掉一行 = 删掉一个联动(它的订阅、接口与配置项一起消失)。"""
from app.links import chat_words, daily_tasks, mistakes, pron_shadow, rank_sources, word_actions
from app.links.spec import LinkSpec

LINKS: tuple[LinkSpec, ...] = (
    word_actions.SPEC,
    daily_tasks.SPEC,
    mistakes.SPEC,
    pron_shadow.SPEC,
    chat_words.SPEC,
    rank_sources.SPEC,
)


def keys() -> tuple[str, ...]:
    return tuple(s.key for s in LINKS)
