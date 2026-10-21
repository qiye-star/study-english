# app/dubbing/

影视配音(plan `docs/superpowers/plans/10.21-plans/2026-10-21-l5-dubbing.md`;spec `2026-10-21-object-storage-fsrs-dubbing-design.md` §3)。
用户选一段连续句子(≤ 12 句、≤ 90 秒,占位),扮演一个角色,逐句录音并评分。Off unless `DUBBING_ENABLED`
(`/api/dubbing/*` 除 `config` 外 404;管理端角色接口不受影响)。

## What lives here
- `errors.py` – `API_ERRORS` / `api_error`:配音接口的固定英文错误串(契约夹具录给网页)。
- (S3 起)`clip.py` – 片段规则(纯函数):连续、≤ 12 句、≤ 90 000 ms、角色至少 1 句;占位常量。
- (S4 起)`scoring.py` – 逐句与整段打分(纯函数):词偏移 → 开口区间、同步度、`line_score`、`take_summary`。
- (S8 起)`takes.py` – 配音记录的建立、列表、详情、删除与逐句写入(持进程内每 take 的锁)。

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.speech`、`app.services`、`app.library`(只读库的句子与成绩)。
只有 `routers`、`admin` 与 `main.py` 导入本包(`tests/test_architecture.py::test_dubbing_layer_rules`);`library` 不得导入 `dubbing`。

## Pitfalls
- 日志、错误、审计、计量、URL 里永远没有句子文字、角色名、提示词、模型回复、评测结果文字、文件名与用户 id。
- 评分只经已有的 `POST /api/speech/assessments`;不改 `speech.py` 与 `providers/xfyun*`;不直接读写 `data_dir`。
- 占位数值(12 句 / 90 秒 / 权重 / 容忍)未用真实素材校准,见 plan 的风险一节。
