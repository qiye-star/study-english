# app/dubbing/

影视配音(plan `docs/superpowers/plans/10.21-plans/2026-10-21-l5-dubbing.md`;spec `2026-10-21-object-storage-fsrs-dubbing-design.md` §3)。
用户选一段连续句子(≤ 12 句、≤ 90 秒,占位),扮演一个角色,逐句录音并评分。Off unless `DUBBING_ENABLED`
(`/api/dubbing/*` 除 `config` 外 404;管理端角色接口不受影响)。

## What lives here
- `errors.py` – `API_ERRORS` / `api_error`:配音接口的固定英文错误串(契约夹具录给网页)。
- `clip.py` – 片段规则(纯函数):`check_span`(范围与大小,建议用)、`check`(再加角色)、`mine`、`speakers_in`;占位常量 `MAX_LINES = 12`、`MAX_MS = 90_000`;窗口 `WINDOW_BEFORE_MS` / `WINDOW_AFTER_MS` 只用于下发配置。角色规则(`ROLE_KEYS`、`clean_role`、`clean_name`)实际定义在 `app/library/roles.py`,这里再导出。
- `scoring.py` – 打分(纯函数,只依赖标准库):`spoken_span`(词偏移 → 开口区间,不可信则 None)、`onset_score`、`ratio_score`、`sync_score`(`words` / `duration` / `none`)、`line_score`(60/20/20,无同步时 75/25)、`take_summary`(缺句计 0)。
- `takes.py` – 配音记录:`create`、`list_for_item`(最近 20 条)、`get_owned`、`stale_lines`(按 `LibraryAttempt.text_hash` 判断句子已改)、`take_out`、`remove`(只删记录,评测的 `dub_id` 置空);逐句 `score_line` / `timing_problem` / `line_out`;每个 take 一把进程内 `asyncio.Lock`(`lock_for`,与 `library/ai.py` 同一做法)。

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.speech`、`app.services`、`app.library`(只读库的句子与成绩)。
只有 `routers`、`admin` 与 `main.py` 导入本包(`tests/test_architecture.py::test_dubbing_layer_rules`);`library` 不得导入 `dubbing`。

## Pitfalls
- 日志、错误、审计、计量、URL 里永远没有句子文字、角色名、提示词、模型回复、评测结果文字、文件名与用户 id。
- 评分只经已有的 `POST /api/speech/assessments`;不改 `speech.py` 与 `providers/xfyun*`;不直接读写 `data_dir`。
- 占位数值(12 句 / 90 秒 / 权重 / 容忍)未用真实素材校准,见 plan 的风险一节。
