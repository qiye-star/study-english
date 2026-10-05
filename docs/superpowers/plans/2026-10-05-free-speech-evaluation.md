# 自由说话评测与语法检查实测(计划 2026-10-05,Task 5.2)

**状态:未运行(NOT RUN — blocked)。** 脚本、用例与离线单测已完成并通过;真实评测因上游不可用无法执行:

- 转写(方舟 chat 模式):方舟 STT 账号欠费,返回 403 `AccountOverdueError`。
- TTS(`volcengine/seed-tts-2.0`):火山 TTS 当前返回 403 `resource not granted`。

本文档中**没有任何实测数字**;所有"结果"和"结论"小节都明确标为未运行。账号恢复后按下文步骤补跑,把脚本输出贴进对应小节。

## 方法
- 脚本 `server/scripts/eval_free_speech.py` + 用例 `server/scripts/eval_free_speech_cases.json`(A 组 10 句故意的语法错误、B 组 10 句正确句含停顿词与自我修正、C 组 6 句"读错"变体),两个英文音色(`en_male_tim_uranus_bigtts`、`en_female_dacey_uranus_bigtts`),外加真人录音 `enjoy/samples/jfk.wav`。
- 每条:转写(不带语言提示,与语音消息一致)→ 以转写为参考评测 → 语法检查;C 组再以本意句为参考评测一次(相当于跟读页)。
- 纯函数(`norm`、`contains_phrase`、`poor_words`、`grammar_hits`、`summarize`、`recommendations`)与上游错误处理由 `server/tests/test_eval_free_speech.py` 离线覆盖,不访问网络。
- 上游返回 403/502/503 时脚本打印 `BLOCKED: <endpoint> <status> <error>`(只含状态码与简短错误码,不回显响应体、不打印密钥),退出码 3,不写 `--json` 文件。ffmpeg 缺失退出码 2。
- 合成的 WAV 缓存在 `.superpowers/eval/tts-cache/`(git 忽略),中断后重跑不会重复花 TTS 调用。

## 复现步骤(账号恢复后)
前提:本机有 `ffmpeg`(`ffmpeg -version`);密钥只在 `server/.env`。

1. 启动评估用服务端(临时库、开放注册、放宽 AI 限流),Git Bash:
   ```bash
   cd /e/workspace/everyone-can-use-english/server
   export DATABASE_URL=sqlite+aiosqlite:///./data/eval.db REGISTRATION_MODE=open AI_RATE_LIMIT_PER_MINUTE=600 DATA_DIR=./data/eval-data
   uv run alembic upgrade head && uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
   ```
   探活:`curl -s --retry 30 --retry-connrefused --retry-delay 1 http://127.0.0.1:8000/up`。
2. 运行评估(另一个终端):
   ```bash
   cd /e/workspace/everyone-can-use-english/server
   uv run python scripts/eval_free_speech.py --base-url http://127.0.0.1:8000 \
     --json ../.superpowers/eval/free-speech-run1.json > ../.superpowers/eval/free-speech-run1.md
   ```
   若出现 `BLOCKED: ...`,说明上游仍不可用,先解决账号/授权问题。个别条目报错就重跑一次(TTS 已缓存)。
3. 收尾:停掉服务端,删除 `server/data/eval.db` 与 `server/data/eval-data/`;确认 `git status` 里没有音频与 `.superpowers/` 文件。

### 预计调用量与耗时(由用例文件推算,每轮)
26 句 × 2 音色 = 52 句,外加 1 条 jfk.wav:
- TTS:52 次(有缓存时重跑为 0)。
- 转写(方舟 chat 模式,LLM 调用):53 次。
- 发音评测(讯飞 ISE):53 次(以转写为参考)+ 12 次(C 组 6 句 × 2 音色以本意句为参考)= 65 次。
- 语法检查(LLM):至多 53 次(转写少于 3 个词的不检查)。
- 合计约 52 TTS + 53 转写 + 65 ISE + ≤53 语法;费用与耗时未实测,取决于各上游计价与速度。按每句 4–5 次串行调用估计,运行时间量级为十几分钟到半小时,仅为估计。若重新调整规则重跑第 2 轮,TTS 走缓存,其余调用量相同。

## 判定规则(计划 R22)与各结果的含义
| 指标 | 阈值 | 触发后的动作 |
|---|---|---|
| A 组转写保留错误的比例 | < 70% | 转写会悄悄改对语法错误,语音消息的语法检查没有意义 → **执行 Task 5.3 降级**:把 `web/src/features/chat/turn-results.ts` 第 14 行的导出常量 `GRAMMAR_FOR_VOICE`(现为 `true`)改为 `false`,语法只对文字输入生效(其测试 `turn-results.test.ts` 中的断言需同步)。 |
| B 组(正确句)误报率 | > 10% | **内置规则修改一轮**:逐条看被误报的句子,只在 `server/app/grammar.py` 的 `DEFAULT_GRAMMAR_RULES` 里加/改针对性规则(不动 `GRAMMAR_OUTPUT_CONTRACT`),`uv run pytest -q` 仍全绿,重启服务端重跑第 2 轮,两轮都记录。 |
| 两项都达标 | — | 不降级(`GRAMMAR_FOR_VOICE` 保持 `true`),内置规则不改。 |

两项判定相互独立;脚本末尾会按这些阈值打印"建议(R22)",最终决定由人写入下面的"决定"小节。

## 第 1 轮结果
**NOT RUN — blocked (Ark STT account overdue; Volcengine TTS resource not granted)**

## 第 2 轮结果(仅在调整了内置规则时)
**NOT RUN — blocked (Ark STT account overdue; Volcengine TTS resource not granted)**

## 结论(逐条回答设计文档 §1 与 §5 的问题)
**NOT RUN — blocked (Ark STT account overdue; Volcengine TTS resource not granted)**

1. 转写是否会把语法错误悄悄改对?—— 待实测。
2. 读错的词能否被标出?(含"对话里的分数只能作发音提示"的依据)—— 待实测。
3. 正确句误报率?—— 待实测。
4. 真人录音(jfk.wav):转写、发音分、语法 —— 待实测。

## 决定
**NOT RUN — blocked (Ark STT account overdue; Volcengine TTS resource not granted)**
- 降级(语法只对文字输入,Task 5.3):**未决定**,待实测数据;当前保持 `GRAMMAR_FOR_VOICE = true`,Task 5.3 未执行。
- 内置规则:**未决定**,当前未改。

## 局限
- TTS 合成是母语音质;C 组的"读错"是近音真实词替换,不等于学习者的口音或含混发音,真实学习者录音的表现可能更差。
- 样本量小(26 句 × 2 音色 + 1 条真人录音),结论只用于决定 v1 是否降级,不代表准确率。
- 讯飞评测的并发/配额未专门压测。
- 真机未验证(见 e2e-results.md)。
- 本次未运行,以上均为方法说明,不含任何实测结论。
