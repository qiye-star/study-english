"""联动段位点(spec §5、§6.6)。本联动不订阅事件、没有接口:它是 gate 键(全站 `link_rank_sources_enabled` + 每用户
「联动加段位点」)。具体来源由各联动登记(chat_words 登记 `word_in_chat`),写 `link_credits` 之前先问
`gate("rank_sources", user_id)`;段位经 `app.rank.extra_sources` 读 `app.models.LinkCredit`(只吃每日上限的剩余额度,
子上限 `points.sources_daily_cap`,不进阶段任务与活跃日)。关掉后联动不再写新行,已写的照常入账。"""
from app.links.spec import LinkSpec

SPEC = LinkSpec("rank_sources", "联动段位点", "Rank points from links")
