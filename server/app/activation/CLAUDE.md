# app/activation/

词汇激活(spec `docs/superpowers/specs/2026-10-21-object-storage-fsrs-dubbing-design.md` §2.4–§2.5;计划
`docs/superpowers/plans/10.21-plans/2026-10-21-l4-activation-context.md`)。Off unless `ACTIVATION_ENABLED` (default off):
`/api/activation/*` 除 `config` 外 404 `Activation is off`;关时总线不入队、索引器不收活、智能体来源返回 None。

## What lives here
- `setup.py` – `require_activation(limited=)` (接口依赖,开关关 → 404) 与 `install(app)`(装订阅、索引器、智能体来源;由 `main.create_app` 调用)
- 之后的任务会加入:`matcher.py`(文本 → 候选原形)、`states.py`(沉睡 / 萌芽 / 激活纯函数与占位阈值)、`usage.py`(chat /
  realtime / shadow / room 三个处理器)、`indexer.py`(句子倒排 `segment_lemma`)、`backfill.py`、`purge.py`、`words.py`、`agent_source.py`

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.speech`、`app.services`、`app.wordbook`、`app.agents`。
只有 `app/routers/` 与 `app/main.py` 可以导入本包(`tests/test_architecture.py::test_activation_is_a_top_layer`)。
不导入 `app.links`、`app.library`、`app.rooms`、`app.realtime`、`app.rank`:库、房间、实时的数据只经事件或 `app.models` 读。

## Handler contract (同 links)
`async def handle(app, event)`:自己开会话、自己提交;幂等;≤ 6 次数据库往返;单查询 ≤ 200 行;不发上游请求;
不判断开关(订阅的 `flag="activation_enabled"` 在总线上统一判断)。日志只允许记类名、计数与耗时,不记词、文本、用户 id。

## Pitfalls
- **R2 只存词元与计数。** `word_usage` 没有文字列;`last_session` 是会话标识的 sha256 前 16 位。词、句子、转写、用户 id 不进 URL、日志、异常、计数名或管理端错误。路由查询参数只允许 `page`、`offset`、`state`。
- **R9 主动使用不改调度。** 任何处理器都不得写 `vocabulary_items` 的调度列(`box / due_at / reps / lapses`,以及 L3 的 `stability / difficulty / fsrs_state / last_review`),
  不导入 `services/vocabulary.py`、`wordbook/grading.py`、`wordbook/plan.py`。"用过"不等于"记得"。
- **R10 句子倒排无外键。** `segment_lemma` 的 owner 有两种 scope(`lib` / `cat`),读侧必须 join 属主表(属主 + `status='ready'`),孤儿不可见,由 `purge.py` 清扫。
  `lemma = "#v1"`、`idx = -1` 的行是「已按 v1 建索引」标记,查询一律 `idx >= 0`。
- 阈值(`GRACE_DAYS`、`DORMANT_DAYS`、`ACTIVE_SESSIONS`、`HINT_WORDS`、`HINT_MIN_BOX`)都是占位,未用真实数据校准,写在代码常量里,不是设置项。
- 事件通道进程内、重启丢事件、队列满丢弃:计数只是尽力而为,不做去重表。
