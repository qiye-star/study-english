# 跟读库句边界根治(服务端 + 网页)Implementation Plan(计划 B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 跟读库「前几句对不上」的根治(spec D5–D9):句子边界**优先用识别服务返回的真实时间**,字符比例估算降为后备;分句后做合理性检查并把可疑条目标 `low_confidence`(列表与播放页提示);已导入的素材可以单条「重新识别」(受每日识别额度限制,失败 / 取消回到原状);「译」开关默认开启。真实识别服务能否返回时间由 **Task 0**(手动运行的探针脚本 + 结果文档)裁决,VAD 只在 Task 0 证明没有时间、且用户再次确认后才引入(Task 11)。

**Architecture:** `server/app/speech/` 新增纯数据模块 `timed.py`(`Utterance` / `TimedText`),`asr_stream.py` 增加 `transcribe_pcm_timed`(请求体加 `show_utterances`,解析 `result.utterances`),`asr.py` 增加 `make_timed_transcriber`(流式带时间、回落路径只给文字)。`app/library/asr_chunks.py` 的 `Chunk` 多一个 `utterances`(相对块起点的毫秒),`transcribe_chunks_timed` 逐块转写并写 `chunks.json`(版本 2,仍可读版本 1),`fragments` 对「可信」的块直接给出**每个识别句一个带真实时间的片段**喂给现有 `segment.build`(`segment.py` 不改);不可信或没有时间的块逐块回落到旧的静音感知估算。新纯模块 `app/library/quality.py` 做合理性检查,`library_items.low_confidence`(迁移 `0019`)存结果。`POST /api/library/items/{id}/reprocess` 把 `ready` 的自动识别条目重新入队(旧句子留到新句子写入,所以失败 / 取消能回到原状)。网页:卡片「更多」菜单里的「重新识别」(二次确认)、低可信提示、`译` 开关默认开。

**Tech Stack:** FastAPI + SQLAlchemy + alembic + pytest(服务端,标准库为主;不新增依赖);React 18 + vitest(网页)。**不新增依赖**(VAD 除外,且那是 Task 11 的条件分支,须先问用户);不改 `enjoy/`。

**Spec:** `docs/superpowers/specs/2026-10-13-review-after-answer-and-library-alignment-design.md` §1(D5–D9)、§4(本计划实现全部 §4.3 / §4.4)。并行计划:A `2026-10-13-review-after-answer.md`(`features/wordbook` + `app/wordbook`,所有权不重叠)。前置:`2026-10-13-video-import-*.md`(跟读库)。

## Global Constraints

- **隐私(`server/app/library/CLAUDE.md` 的 Pitfalls 全部适用):** 日志、错误、审计、计量里永远没有标题、文件名、URL、字幕 / 转写文字(含识别服务返回的 `utterances[].text`)、ffmpeg 输出、票据;只记条目 id、阶段、`error_kind`、块数、毫秒数、数字。新路由进 `tests/test_library_privacy.py` 的 `ROUTES`。`chunks.json`(在 `_tmp/<id>/`,条目 ready / 失败清理时删除)本来就存转写文字,新增的 `utterances` 同样只在那里。**Task 0 探针脚本只打印字段名、条数、毫秒数 / 秒数,不打印密钥、URL、转写文字**(`tests/test_asr_timing_probe.py` 守着)。
- **分层:** `tests/test_architecture.py` 一字不改。`library → speech` 允许;`speech/timed.py` 只依赖标准库;`asr` → `asr_stream`,反向不允许。`segment.py` 与 `speech/sentence_split.py` **不改**(spec §6.3)。
- **不改 `enjoy/`;** 不向第三方发请求(识别只经 `speech.asr` 的转写器,带 `shared_asr_gate`);新依赖只有 Task 11 的 VAD,**开工前必须停下来问用户**(D9)。
- **迁移:** `alembic/versions/0019_library_low_confidence.py`(head 现为 `0018`),新列 `NOT NULL DEFAULT false`,SQLite 与 Postgres 同一条 `ADD COLUMN` 路径,降级用 batch;`tests/test_migrations.py` 里 5 处硬编码 `get_heads() == ["0018"]` 与 `tests/test_library_models.py::test_head_is_0018…` 同一提交改成 `0019`。
- **工作树是 CRLF:** 改现有文件用 Edit 工具(多行 `old_string` 匹配失败时改成逐行匹配);新文件用 Write。JSON 夹具由测试按 LF 写出。
- **提交:** conventional,一任务一提交,每个提交后该任务列出的测试全绿,信息以空一行后的 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **只在用户要求时:** 重建 / 重启容器、跑全量测试、跑 E2E、构建。每个任务只跑它列出的测试加 `tests/test_architecture.py`(服务端)/ `yarn web:typecheck` + 它列出的 vitest 文件(网页)。**Task 0 真实花钱:只有用户在对话里确认过才运行**(见 Task 0)。
- **验证口径(如实):** 写计划时**没有运行任何测试、构建或真实识别服务**——只读了真实代码(`speech/*`、`library/*`、`routers/library.py`、`models.py`、`store`、网页 `features/library/*`)。所有代码与测试块是按读到的签名写的,执行者第一次运行时以真实结果为准修正(尤其:`pytest` 里导入其他测试模块的 fixture、Radix `BottomSheet` / `AlertDialog` 在 jsdom 里的先后关闭、`alembic` 的 SQLite batch 降级)。**凡需要真实识别服务或真机的结论一律写「未验证」直到跑过:** 火山 `utterances` 的字段名 / 时间单位 / 是否出现在 `bigmodel_nostream`、Whisper `verbose_json`、边界误差、iOS 听感。
- **提示:** 文中「核对」= 写计划时已读真实代码得出结论(见裁定表),执行者不必再猜。

## 执行顺序与关口

| 顺序 | 任务 | 依赖 |
|---|---|---|
| 1 | **T0** 探针脚本 + 手动验证 + 记结果 | 无;**真实识别服务,花小钱,先于其余带时间的任务** |
| 2 | **T1** 迁移 `0019` + 模型 + `item_out` | 无(与 T0 结果无关) |
| 关口 G0 | 读 T0 结果:**A** 火山返回可用的 `utterances`(相对块起点、毫秒)→ 继续 T2…;**B** 没有 / 不可用 → **停,问用户(D9)**,可继续 T1;用户同意后先做 T11 再做 T2 之后的任务(T2 / T3 的带时间代码在没有时间时无害:块的 `utterances` 为空 → 回落估算) | T0 |
| 3–6 | **T2** 语音层带时间 → **T3** 块 / 分句器优先真实时间 → **T4** 合理性检查 + 流水线接线 + 持续背景音乐夹具 → **T5**(条件)Whisper 时间 | G0=A |
| 7 | **T6** 重新识别端点与状态机 | T1(列)、T4(流水线) |
| 8 | **T7** 契约夹具重录 + 网页类型 / 契约测试 | T1、T6 |
| 9–10 | **T8** 网页:重新识别菜单 / 确认 / 低可信提示;**T9** 网页:播放页提示 + 「译」默认开 | T7 |
| 11 | **T10** 文档、`CLAUDE.md`、结果文档的「未验证」 | 全部 |
| 条件 | **T11** VAD 后备(**开工前停下来问用户**) | G0=B 且用户同意 |

## 对 spec「核对」项的裁定(读真实代码得出)

| spec 核对项 | 结论 |
|---|---|
| 4.2:`make_transcriber` 返回 `wav -> str` | 对:`asr.make_transcriber` → `transcribe(wav) -> str`;流式路径 `asr_stream._collect` 只取 `result.text`,`_request_payload` 里**没有** `show_utterances`。 |
| `asr_realtime.py` 已带 `show_utterances` | 对:`_request_payload` 里 `"show_utterances": True`(还有 `enable_nonstream`、`end_window_size`),但全库没有任何代码**读** `utterances`;它只证明协议支持,不证明 `bigmodel_nostream`(库用的 URL,`asr_stream_url` 默认值)也返回——这是 Task 0 要答的。 |
| 4.3.2:`segment.py` 已有 `align` 接口 | 对:`segment.align(fragments)` / `build(fragments, adjust=…)`,`Fragment(start_ms, end_ms, text)`;句内按字符比例线性插值(`Aligned.time_at`),句首落在片段开头时就是片段的 `start_ms`。所以**每个识别句一个片段**即可得到真实边界,不用改 `segment.py`。 |
| `asr_chunks` 分块与 `chunks.json` | `Chunk(start_ms, end_ms, text)`;`STATE_VERSION = 1`;`load_state` 版本不符返回 `None`(整份丢弃,重新花钱)。T3 升到 2 并**仍读 1**。`plan_chunks` 无静音时在 40 s 硬切(用户的素材就是这样);≤ 50 s 的素材只有一块。 |
| 流水线与 worker | `pipeline._transcribe` 返回 `list[Sentence]`,`process` 写 `store.write_segments` 并置 `ready`;`PipelineDeps.transcriber: user_id -> (wav -> str)`,测试用 `FakeAsr` 经 `use_fakes(app, asr=…)` 替换。T4 加可选的 `timed_transcriber`(默认 `None`),`use_fakes` 在传 `asr=` 时把它置 `None`,所以既有测试不变。 |
| `store.fail` / `cancel_item` 与重新识别冲突 | `fail`:永久失败 → `status=failed`;`cancel_item`:`ACTIVE` → `canceled` 并**删除媒体**。对一个正在重新识别的 `ready` 条目这两条都会毁掉原状。R-R2 / R-R3 给出处理(以「`seg_count > 0` 且 `queued/processing`」识别重新识别,不加列)。 |
| 迁移号与硬编码 head | head `0018`;`tests/test_migrations.py` 5 处 + `tests/test_library_models.py` 1 处断言 head。`ADD COLUMN` 的先例:`0017`(可空 JSON)、`0008` / `0011`(`NOT NULL` + `server_default`)。 |
| `item_out` 键集合被测试钉死 | `tests/test_library_store.py::test_item_out_shape_and_upload_progress` 比较键集合;契约夹具 `library_contract.json` + 网页 `library-contract.test.ts` 的 `ITEM` 键表。 |
| 卡片「菜单」 | `item-card.tsx` **没有菜单**,只有一个删除 `IconButton`;删除确认是 `library-list-page.tsx` 里的 `AlertDialog`。跟读句有 `segment-menu.tsx`(`BottomSheet` + 条目按钮)可照做(R-W1)。 |
| 「译」开关的存储 | `use-translate-toggle.ts` 只存 `true`、关闭时删键(没有键 = 关)。默认开要改成存显式布尔(R-W2)。 |
| 网页契约测试要求每条服务端错误文本都有映射 | `library-contract.test.ts`:`c.errors` 的每个文本必须是 `LIBRARY_SERVER_ERRORS` 的键;新增 3 个错误码要同步(T7)。 |
| 识别额度 | `limits.SCOPE_ASR`(`library_asr`)按秒记,subject = 用户 id 与 `*`;`library_asr_minutes_daily_per_user`(60)/ `library_asr_minutes_global_daily`(600);`pipeline._transcribe` 在开始转写前 `reserve`,失败 `release` 未用的。重新识别沿用这条路径,端点只加一个**不扣额度**的预检(`usage.remaining`)。 |
| Task 0 脚本怎么进容器 | `server/Dockerfile` 只 `COPY server/app`、`alembic`、`dictionaries`,**`scripts/` 不在镜像里**。所以 Task 0 用 `docker compose cp` 把脚本和两段素材拷进运行中的容器、`docker compose exec -e PYTHONPATH=/app` 运行(不重建、不重启镜像)。镜像里有 `ffmpeg`。 |
| 现有测试里的网页默认值 | `player-page.test.tsx` 里「开关默认关」的断言在 T9 改;其余用例不依赖译文开关(已读全文)。 |

## 本计划的裁定

- **R-A1 时间基准与单位:** `utterances[].start_time / end_time` 是相对**所发送音频起点**的毫秒(库发送的是块的 WAV 切片,所以相对**块起点**;绝对时间 = `chunk.start_ms + start_time`)。单位与字段名依据厂商协议文档,**未验证,由 Task 0 确认**;`unit_guess` 不是 `ms` 时 G0 判 B 并停。
- **R-A2 类型放哪:** `app/speech/timed.py`(`Utterance(text, start_ms, end_ms)`、`TimedText(text, utterances=())`,冻结数据类,只依赖标准库);`asr_stream` / `asr` / `stt` 与 `app/library` 都从这里导入,避免 `stt → asr_stream` 新边。
- **R-A3 只有带时间的路径才加 `show_utterances`:** `asr_stream._request_payload(uid, utterances=False)`;既有 `transcribe_pcm`(上传识别、按住说话)请求体**不变**,既有测试不动。
- **R-A4 可信检查 `usable_utterances(chunk)`:** 每条 `0 ≤ start < end ≤ 块长 + 1500 ms`,起点不早于上一条终点 − 250 ms;把所有 `utterances[].text` 去掉标点空白后与块文本(同样处理)用 `difflib.SequenceMatcher` 比,`ratio ≥ 0.9`。任何一条不满足 → 整块当作没有时间(返回 `[]`)。**宁可回落估算,不可信一份对不上文字的时间。**
- **R-A5 逐块回落:** 一个素材里可信的块用真实时间、其余块仍用 `speech_span` 估算;识别服务在某块上走了 Whisper / chat 回落(只有文字)时同理。
- **R-A6 `chunks.json`:** `STATE_VERSION = 2`,`utterances` 存成 `[{text,start_ms,end_ms}]` 或 `null`;`load_state` 同时接受 1 和 2(版本 1 的块 `utterances = None`,继续用,不重花钱)。
- **R-A7 注入:** `PipelineDeps.timed_transcriber`(默认 `None`,位于最后一个字段)。`install` 里设为 `make_timed_transcriber`;为 `None` 时用 `deps.transcriber` 包成无时间(`_untimed`)。
- **R-Q1 阈值(偏离 spec 的示例值,理由见末尾「与 spec 的偏离」):** 句子字符数(含空格)≥ 20 才参与检查;字符速度 `< 6` 或 `> 25` 字符 / 秒算异常;**估算**块(没有可信时间)的说话占比(`speech_span` / 块长)`< 0.4` 异常;任一异常 → `low_confidence`。有可信真实时间的块**不**看说话占比(背景音乐 + 少量人声是合法的)。
- **R-Q2 只对 `sub_source == "asr"` 计算;** 上传 / 平台字幕一律 `false`;用户用 `PUT /items/{id}/subtitles` 换字幕时清 `low_confidence`;手动微调句子时间**不**清(用户可能只改了一句)。
- **R-R1 谁能重新识别:** `status == ready` **且** `sub_source == "asr"` **且** `seg_count > 0`;其余一律 `409 Item cannot be reprocessed`。(有字幕的条目不需要识别;换字幕走已有的字幕端点。)
- **R-R2 状态机(不加列):** 「重新识别中」= `seg_count > 0` 且 `status ∈ {queued, processing}`(首次处理时 `seg_count` 恒为 0:`write_segments` 与 `ready` 同事务写入)。端点只把 `ready → queued`(`progress=0, error_kind=None, attempts=0`),**旧句子留在库里**直到 `process` 写入新句子(`write_segments` 先删后写,与 `ready` 同事务)。
- **R-R3 失败 / 取消回到原状:** `store.fail` 在「不再重试」且 `seg_count > 0` 时置 `status=ready, progress=100, attempts=0`,`error_kind` 保留为失败种类(网页在 `ready` 卡上显示「重新识别没有成功…」);瞬时错误仍走退避重试(状态 `queued`)。`store.cancel_item` 对 `seg_count > 0` 的活动条目改为 `ready`(**不删媒体**,杀任务、清 `_tmp`),返回 `True`。`delete_item` 不受影响(先取消再删全部)。重新识别期间条目不可打开(`get_item` 只在 `ready` 给句子)。
- **R-R4 额度:** 端点预检 `limits.asr_seconds_left(...) >= ceil(duration_ms / 1000)`(每人与全站取小),不足 `429 Daily transcription limit reached`;预检**不扣额度**,真实 `reserve` 仍在流水线里(并发竞争时可能在流水线里才 `quota` 失败 → 按 R-R3 回到 `ready` + `error_kind=quota`)。
- **R-R5 手动修改会丢:** `write_segments` 整体替换句子,所以用户对句子文字 / 时间的微调与已生成的译文、分析都会被替换(按文字哈希记的成绩只对没变的句子仍有效)。确认对话框要明说。`resume_ms` 保留、`resume_idx` 钳到新句数。
- **R-R6 并发与 `_tmp`:** 端点在 `runtime.upload_lock(item.id)` 里复查状态、删掉 `_tmp/<id>`(陈旧的 `chunks.json` / `speech.wav` / `silences.json`)再翻状态;第二个并发请求在锁后看到 `queued` → 409。
- **R-W1 菜单:** 只有「`ready` 且 `subSource === "asr"` 且服务端 `config.asr`」的卡片显示 `⋯`(`ItemMenu`,`BottomSheet`,里面一条「重新识别」);`ItemCardHandlers.onReprocess` 是**可选**的(列表页只在 `config.asr` 时传),既有测试的 `handlers()` 不用改。
- **R-W2 「译」默认开:** `DEFAULT_TRANSLATE_ON = true`;存储改为显式布尔(`true` / `false`,没有键 = 默认);`library_ai_enabled` 关或英文界面时仍不显示、不取(`canTranslate` 不变)。老用户:以前关掉的人没有键,会看到一次「开」(他们再点一次就记住 `false`)。改回默认关只需把常量改 `false`。
- **R-W3 低可信提示:** 列表卡(`ready` 且 `lowConfidence`):琥珀色小徽标 + 一行说明;播放页:控制胶囊里一行 `lib-notice`(复用译文提示的样式)。文案:「句边界可能不准,可重新识别或微调」。
- **R-P 错误码:** `not_reprocessable` 409 `Item cannot be reprocessed`、`asr_unavailable` 503 `Transcription is not available`、`asr_daily` 429 `Daily transcription limit reached`;「没有媒体」复用 `no_material`(409 `Nothing left to retry`)、「没装 ffmpeg」复用 `unavailable`。

## 文件结构与共享文件风险

```
server/
  scripts/asr_timing_probe.py                 新(T0)
  alembic/versions/0019_library_low_confidence.py   新(T1)
  app/models.py                               [改] LibraryItem.low_confidence(T1)
  app/speech/timed.py                         新(T2)
  app/speech/asr_stream.py                    [改] 带时间的请求与解析(T2)
  app/speech/asr.py                           [改] _try_stream(timed)、make_timed_transcriber(T2)
  app/speech/stt.py                           [改,条件] verbose_json 时间(T5)
  app/library/asr_chunks.py                   [改] utterances、transcribe_chunks_timed、usable_utterances、fragments(T3)
  app/library/quality.py                      新(T4)
  app/library/pipeline.py                     [改] timed_transcriber、low_confidence 接线(T4)
  app/library/worker.py                       [改] install 接 timed_transcriber(T4);_failed 清暂存(T6)
  app/library/store.py                        [改] item_out、fail、cancel_item(T1、T6)
  app/library/limits.py                       [改] asr_seconds_left(T6)
  app/library/errors.py                       [改] 3 个错误码(T6)
  app/routers/library.py                      [改] reprocess 端点;换字幕清标记(T6)
  tests/test_asr_timing_probe.py              新(T0)
  tests/test_asr_stream_timed.py、test_asr_timed.py   新(T2)
  tests/test_asr_stream.py                    [改] FakeAsr 加 utterances(T2)
  tests/test_library_asr_timed.py             新(T3)
  tests/test_library_quality.py、test_library_alignment.py   新(T4)
  tests/library_helpers.py                    [改] FakeTimedAsr、use_fakes(timed_asr=)(T4)
  tests/test_library_reprocess.py             新(T6)
  tests/test_library_privacy.py               [改] ROUTES 加 reprocess(T6)
  tests/test_library_contract.py              [改] 录 reprocess(T7)
  tests/fixtures/library_contract.json        [改] 重录(T7)
  tests/test_migrations.py、test_library_models.py、test_library_store.py   [改](T1)
web/src/features/library/
  library-api.ts                              [改] lowConfidence、reprocessItem、3 条错误文本(T7、T8)
  item-menu.tsx(+测试)                       新(T8)
  item-card.tsx、library-list-page.tsx(+测试)  [改](T8)
  player-page.tsx、use-translate-toggle.ts(+测试)[改](T9)
  locales/en.json、locales/zh-CN.json         [改](T7、T8、T9)
  test-fixtures.ts、library-contract.test.ts  [改](T7)
docs/superpowers/plans/2026-10-13-video-import-results.md   [改] T0 / T10 追加
server/app/CLAUDE.md、app/library/CLAUDE.md、app/speech/CLAUDE.md、app/routers/CLAUDE.md、scripts/CLAUDE.md、tests/CLAUDE.md   [改](T10)
```

共享文件风险:(1) `server/app/library/CLAUDE.md`、`server/tests/CLAUDE.md` 等只在 T10 追加;(2) `library_contract.json` 只由 T7 重录,别的任务不碰;(3) 计划 A 不碰 `features/library` 与 `app/library`,无冲突;(4) `tests/library_helpers.py` 只加不删。

---

# Task 0:识别服务时间戳验证(手动运行的探针,D6)

**目的:** 回答 G0 的四个问题,**不写任何产品代码**:① 火山 `bigmodel_nostream`(库用的 `asr_stream_url`)在请求体加 `show_utterances` 后,最终帧 `result.utterances` 是否存在、字段形状;② 时间基准与单位(相对块起点?毫秒?);③ 与真实人声边界的误差(带持续背景音乐的素材尤其要看);④ 若配置了 Whisper(`UPSTREAM_WHISPER_MODE=openai`)`verbose_json` 是否有 `segments`(`chat` 模式协议上没有时间,脚本直接标「不适用」)。

**Files:** Create `server/scripts/asr_timing_probe.py`、`server/tests/test_asr_timing_probe.py`;Modify `docs/superpowers/plans/2026-10-13-video-import-results.md`(追加)。

**花费与密钥:** 每段素材只发前 `--seconds`(默认 60,最多 90)秒;脚本没有 `--yes` 拒绝运行;密钥只在容器里经 `Settings()` 读环境变量,**不打印**;输出只有字段名 / 条数 / 数字。

- [ ] **Step 1:写测试(先红)** `server/tests/test_asr_timing_probe.py`:

```python
"""Task 0 探针的纯函数与隐私:只输出字段名、条数、数字,从不输出文字、密钥或 URL。"""
import json

import pytest

from scripts.asr_timing_probe import (
    compare_truth, field_names, main, render_markdown, summarize_frames, summarize_utterances, summarize_whisper,
    unit_guess,
)

SECRET = "SECRET-TRANSCRIPT"
RAW = [
    {"text": f"{SECRET} one.", "start_time": 120, "end_time": 2400, "definite": True,
     "words": [{"text": SECRET, "start_time": 120, "end_time": 500, "blank_duration": 0}]},
    {"text": f"{SECRET} two.", "start_time": 2900, "end_time": 5100, "definite": True},
    {"text": f"{SECRET} three.", "start_time": 2000, "end_time": 1500},  # inverted, earlier than the one before, overlapping
    "not a dict",
]


def test_field_names_are_identifiers_only_and_never_values():
    assert field_names({"text": SECRET, "start_time": 1, f"{SECRET} words": 2, "": 3}) == ["<other>", "start_time", "text"]
    assert field_names(None) == [] and field_names([1, 2]) == []


@pytest.mark.parametrize("max_end, audio_ms, expected", [
    (None, 60_000, "none"), (58_400, 60_000, "ms"), (59.2, 60_000, "seconds?"), (900_000, 60_000, "out_of_range"),
    (3.0, 5_000, "ms"),  # a short clip cannot tell seconds from milliseconds: ms wins (>= 20 s needed to guess seconds)
])
def test_unit_guess(max_end, audio_ms, expected):
    assert unit_guess(max_end, audio_ms) == expected


def test_summary_counts_shapes_and_checks_without_any_text():
    s = summarize_utterances(RAW, 60_000)
    assert s["count"] == 3 and s["unit_guess"] == "ms"
    assert s["monotonic"] is False and s["overlaps"] == 1 and s["negative_or_inverted"] == 1
    assert (s["first_start"], s["last_end"]) == (120.0, 1500.0)
    assert s["rows"][0]["fields"] == ["definite", "end_time", "start_time", "text", "words"]
    assert s["rows"][0]["word_fields"] == ["blank_duration", "end_time", "start_time", "text"]
    assert s["rows"][0]["chars"] == len(f"{SECRET} one.") and s["rows"][0]["definite"] is True
    assert SECRET not in json.dumps(s)


def test_frames_summary_and_markdown_never_contain_the_transcript():
    frames = [
        {"last": False, "sequence": 1, "payload": {"result": {"text": SECRET}}},
        {"last": True, "sequence": -2, "payload": {"result": {"text": f"{SECRET} one. {SECRET} two.", "utterances": RAW},
                                                   "audio_info": {"duration": 5000}}},
    ]
    stream = {**summarize_frames(frames, 60_000), "seconds": 1.5}
    assert stream["frames"] == 2 and stream["error_code"] is None
    assert stream["final"]["has_utterances"] is True and stream["final"]["result_fields"] == ["text", "utterances"]
    assert stream["final"]["payload_fields"] == ["audio_info", "result"]
    text = render_markdown("A-music", 60_000, stream, None, [])
    assert SECRET not in text and "A-music" in text and "utterances" in text and "ms" in text


def test_no_utterances_is_reported_plainly():
    frames = [{"last": True, "sequence": -2, "payload": {"result": {"text": SECRET}}}]
    stream = {**summarize_frames(frames, 60_000), "seconds": 0.4}
    assert stream["final"]["has_utterances"] is False
    assert "没有" in render_markdown("B", 60_000, stream, None, [])


def test_an_error_frame_keeps_only_its_code():
    stream = {**summarize_frames([{"error": True, "code": 45000001}], 60_000), "seconds": 0.1}
    assert stream["error_code"] == 45000001 and stream["final"] is None
    assert "45000001" in render_markdown("A", 60_000, stream, None, [])


def test_whisper_summary_reads_segments_in_seconds():
    payload = {"text": SECRET, "segments": [{"id": 0, "start": 0.0, "end": 2.4, "text": SECRET},
                                            {"id": 1, "start": 2.9, "end": 5.1, "text": SECRET}]}
    s = summarize_whisper(200, payload, 60_000)
    assert s["has_segments"] is True and s["segments"]["count"] == 2 and s["segments"]["unit_guess"] == "seconds?"
    assert s["payload_fields"] == ["segments", "text"] and SECRET not in json.dumps(s)
    assert summarize_whisper(400, None, 60_000)["has_segments"] is False
    # a 60 s clip whose largest end is 58.4 means seconds (what Whisper really returns)
    far = summarize_whisper(200, {"segments": [{"start": 1.0, "end": 58.4, "text": "x"}]}, 60_000)
    assert far["segments"]["unit_guess"] == "seconds?"


def test_compare_truth_reports_signed_millisecond_errors():
    rows = summarize_utterances(RAW[:2], 60_000)["rows"]
    assert compare_truth(rows, [[100, 2500], [3000, 5000]]) == [
        {"index": 0, "start_error_ms": 20, "end_error_ms": -100}, {"index": 1, "start_error_ms": -100, "end_error_ms": 100}]
    sec = summarize_whisper(200, {"segments": [{"start": 0.1, "end": 2.5, "text": "x"}]}, 60_000)["segments"]["rows"]
    assert compare_truth(sec, [[100, 2400]], scale=1000.0) == [{"index": 0, "start_error_ms": 0, "end_error_ms": 100}]
    assert compare_truth(rows, "garbage") == []


def test_main_refuses_without_yes_and_with_bad_seconds(capsys):
    assert main(["--clip", "nothing.mp3"]) == 2
    assert main(["--clip", "nothing.mp3", "--yes", "--seconds", "500"]) == 2
    assert main(["--clip", "does-not-exist.mp3", "--yes"]) == 2
    out = capsys.readouterr()
    assert "--yes" in out.err
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_asr_timing_probe.py`。预期:`ModuleNotFoundError: scripts.asr_timing_probe`。

- [ ] **Step 3:写脚本** `server/scripts/asr_timing_probe.py`:

```python
"""Task 0 of plan 2026-10-13-library-alignment: does the configured recognition service return per-sentence times?

Run BY HAND inside the running server container against ONE clip of about a minute per run (do two runs: one clip
with continuous background music, one without). It spends a small amount of the recognition quota (the clip is cut to
--seconds, default 60, at most 90) and refuses to start without --yes.

It prints only field NAMES, counts and timing numbers (milliseconds, or seconds for Whisper): never the key, the URL,
a transcript, or any text from a response. Field names that are not plain identifiers are shown as `<other>`.
`--append-to` appends the same Markdown block to the results document.

    docker compose cp server/scripts/asr_timing_probe.py server:/tmp/asr_timing_probe.py
    docker compose cp ./clip-a.mp3 server:/tmp/clip-a.mp3
    docker compose exec -e PYTHONPATH=/app server python /tmp/asr_timing_probe.py \
        --clip /tmp/clip-a.mp3 --label A-music --yes [--whisper] [--truth /tmp/truth-a.json]
    docker compose exec server rm -f /tmp/asr_timing_probe.py /tmp/clip-a.mp3 /tmp/truth-a.json

`--truth` is a JSON list `[[start_ms, end_ms], ...]` you wrote by listening to the first sentences (to about 100 ms);
the script then prints our minus yours for each. Without it the boundary error stays UNVERIFIED.
"""
import argparse
import asyncio
import io
import json
import re
import subprocess
import sys
import tempfile
import time
import uuid
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_SECONDS = 60
MAX_SECONDS = 90
MAX_ROWS_PRINTED = 40
FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")


# ---- pure helpers (unit-tested; they never return text taken from a response) ----

def field_names(value: object) -> list[str]:
    """Sorted key names of a dict; anything that is not a plain identifier is shown as `<other>`. Never a value."""
    if not isinstance(value, dict):
        return []
    return sorted({k if isinstance(k, str) and FIELD_NAME.match(k) else "<other>" for k in value})


def number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def unit_guess(max_end: float | None, audio_ms: int) -> str:
    """`seconds?` when the largest end time fits the clip length in seconds (clips >= 20 s only), `ms` when it fits in
    milliseconds, else `out_of_range`."""
    if max_end is None:
        return "none"
    if audio_ms >= 20_000 and max_end <= audio_ms / 1000 + 2:
        return "seconds?"
    if max_end <= audio_ms + 2000:
        return "ms"
    return "out_of_range"


def _rows(raw: object, start_key: str, end_key: str) -> list[dict]:
    rows = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, words, definite = item.get("text"), item.get("words"), item.get("definite")
        rows.append({
            "fields": field_names(item),
            "start": number(item.get(start_key)),
            "end": number(item.get(end_key)),
            "chars": len(text) if isinstance(text, str) else None,
            "definite": definite if isinstance(definite, bool) else None,
            "words": len(words) if isinstance(words, list) else None,
            "word_fields": field_names(words[0]) if isinstance(words, list) and words else [],
        })
    return rows


def summarize_rows(rows: list[dict], audio_ms: int) -> dict:
    pairs = [(r["start"], r["end"]) for r in rows if r["start"] is not None and r["end"] is not None]
    starts, ends = [s for s, _ in pairs], [e for _, e in pairs]
    return {
        "count": len(rows), "rows": rows, "unit_guess": unit_guess(max(ends) if ends else None, audio_ms),
        "monotonic": all(a <= b for a, b in zip(starts, starts[1:])),
        "overlaps": sum(1 for (_s1, e1), (s2, _e2) in zip(pairs, pairs[1:]) if s2 < e1),
        "negative_or_inverted": sum(1 for s, e in pairs if s < 0 or e <= s),
        "first_start": starts[0] if starts else None, "last_end": ends[-1] if ends else None,
    }


def summarize_utterances(raw: object, audio_ms: int) -> dict:
    return summarize_rows(_rows(raw, "start_time", "end_time"), audio_ms)


def summarize_whisper(status: int | None, payload: object, audio_ms: int) -> dict:
    segments = payload.get("segments") if isinstance(payload, dict) else None
    return {"status": status, "payload_fields": field_names(payload),
            "has_segments": isinstance(segments, list) and len(segments) > 0,
            "segments": summarize_rows(_rows(segments, "start", "end"), audio_ms)}


def summarize_frames(frames: list[dict], audio_ms: int) -> dict:
    """`frames`: {"last", "sequence", "payload"} per response frame, or {"error": True, "code"} for an error frame."""
    def result_of(frame: dict) -> object:
        payload = frame.get("payload")
        return payload.get("result") if isinstance(payload, dict) else None

    last = next((f for f in reversed(frames) if f.get("last")), None)
    out: dict = {"frames": len(frames), "final": None,
                 "error_code": next((f.get("code") for f in frames if f.get("error")), None),
                 "partial_frames_with_utterances": sum(
                     1 for f in frames if not f.get("last") and isinstance(result_of(f), dict) and result_of(f).get("utterances"))}
    if last is not None:
        result = result_of(last)
        raw = result.get("utterances") if isinstance(result, dict) else None
        text = result.get("text") if isinstance(result, dict) else None
        out["final"] = {
            "payload_fields": field_names(last.get("payload")), "result_fields": field_names(result),
            "text_chars": len(text) if isinstance(text, str) else None,
            "has_utterances": isinstance(raw, list) and len(raw) > 0,
            "utterances": summarize_utterances(raw, audio_ms),
        }
    return out


def compare_truth(rows: list[dict], truth: object, scale: float = 1.0) -> list[dict]:
    """Ours minus yours per listened-to sentence, in ms. `scale` converts the recognizer's unit to ms (1000 = seconds)."""
    out: list[dict] = []
    if not isinstance(truth, list):
        return out
    for index, (row, want) in enumerate(zip(rows, truth)):
        if row["start"] is None or row["end"] is None or not (isinstance(want, list) and len(want) == 2):
            continue
        out.append({"index": index, "start_error_ms": round(row["start"] * scale - want[0]),
                    "end_error_ms": round(row["end"] * scale - want[1])})
    return out


def _rows_markdown(summary: dict) -> list[str]:
    lines = [f"- 条数 {summary['count']};单位猜测 `{summary['unit_guess']}`;起点单调 {summary['monotonic']};"
             f"重叠 {summary['overlaps']};倒置或负值 {summary['negative_or_inverted']};"
             f"首条起点 {summary['first_start']},末条终点 {summary['last_end']}"]
    if summary["rows"]:
        first = summary["rows"][0]
        lines.append(f"- 每条的字段:{', '.join(first['fields']) or '(无)'};words 字段:{', '.join(first['word_fields']) or '(无)'}")
    shown = summary["rows"][:MAX_ROWS_PRINTED]
    lines.append("- 逐条(序号:起点 – 终点 / 字符数 / definite):" + ";".join(
        f"{i}:{r['start']} – {r['end']} / {r['chars']} / {r['definite']}" for i, r in enumerate(shown)))
    return lines


def render_markdown(label: str, audio_ms: int, stream: dict | None, whisper: dict | None, truth_errors: list[dict]) -> str:
    lines = [f"### 素材 {label}(音频 {audio_ms / 1000:.1f} s)", ""]
    if stream is None:
        lines.append("- 火山流式:未运行(没有配置密钥,或请求失败)")
    else:
        lines.append(f"- 火山流式:响应帧 {stream['frames']},错误码 {stream['error_code']},耗时 {stream.get('seconds', 0):.1f} s;"
                     f"中间帧带 utterances 的 {stream['partial_frames_with_utterances']} 帧")
        final = stream["final"]
        if final is None:
            lines.append("- 没有最终帧")
        else:
            lines += [f"- 最终帧顶层字段:{', '.join(final['payload_fields']) or '(无)'}",
                      f"- result 字段:{', '.join(final['result_fields']) or '(无)'};result.text 字符数 {final['text_chars']}",
                      f"- `utterances`:{'有' if final['has_utterances'] else '没有'}"]
            if final["has_utterances"]:
                lines += _rows_markdown(final["utterances"])
    if whisper is not None:
        lines.append(f"- Whisper verbose_json:HTTP {whisper['status']};顶层字段 {', '.join(whisper['payload_fields']) or '(无)'};"
                     f"`segments`:{'有' if whisper['has_segments'] else '没有'}")
        if whisper["has_segments"]:
            lines += _rows_markdown(whisper["segments"])
    if truth_errors:
        worst = max(max(abs(e["start_error_ms"]), abs(e["end_error_ms"])) for e in truth_errors)
        lines.append(f"- 与你听出来的边界相比(我方减你方,ms):最大绝对误差 {worst};"
                     + ";".join(f"{e['index']}:{e['start_error_ms']:+d} / {e['end_error_ms']:+d}" for e in truth_errors))
    else:
        lines.append("- 边界误差:**未验证**(没有提供 --truth)")
    return "\n".join(lines) + "\n"


# ---- the real run ----

def decode_clip(clip: Path, seconds: int, workdir: Path) -> Path:
    out = workdir / "probe.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-t", str(seconds), "-i", str(clip),
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", str(out)],
                   check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def read_pcm(wav: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(wav), "rb") as w:
        frames = w.getnframes()
        return w.readframes(frames), round(frames * 1000 / w.getframerate())


async def collect_frames(settings, pcm: bytes) -> tuple[list[dict], float]:
    """The same wire protocol as `app.speech.asr_stream`, with `show_utterances` added; keeps every response frame."""
    from websockets.asyncio.client import connect

    from app.speech import asr_stream as a

    payload = a._request_payload("timing-probe")
    payload["request"]["show_utterances"] = True
    headers = {"X-Api-Key": settings.asr_stream_key, "X-Api-Resource-Id": settings.asr_stream_resource_id,
               "X-Api-Connect-Id": str(uuid.uuid4())}
    frames: list[dict] = []
    started = time.perf_counter()
    async with asyncio.timeout(a.stream_budget(settings, len(pcm))):
        async with connect(settings.asr_stream_url, additional_headers=headers, open_timeout=a.OPEN_TIMEOUT,
                           max_size=a.MAX_MESSAGE_BYTES, close_timeout=a.CLOSE_TIMEOUT, logger=a._ws_logger) as ws:
            await ws.send(a.encode_full_request(payload))
            sender = asyncio.create_task(a._send_audio(ws, pcm))
            try:
                async for raw in ws:
                    frame = a.decode_frame(raw)
                    if frame.msg_type == a.MSG_ERROR:
                        frames.append({"error": True, "code": frame.code})
                        break
                    frames.append({"last": frame.last, "sequence": frame.sequence, "payload": frame.payload})
                    if frame.last:
                        break
            finally:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)
    return frames, time.perf_counter() - started


async def whisper_probe(settings, wav: bytes) -> tuple[int | None, object]:
    import httpx

    url = settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions"
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as http:
        reply = await http.post(url, files={"file": ("audio.wav", wav, "audio/wav")},
                                data={"model": "whisper-1", "response_format": "verbose_json", "language": "en"},
                                headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"})
    try:
        return reply.status_code, reply.json() if reply.is_success else None
    except ValueError:
        return reply.status_code, None


async def run(args: argparse.Namespace) -> int:
    from app.core.config import Settings

    settings = Settings()
    with tempfile.TemporaryDirectory() as tmp:
        try:
            wav = decode_clip(Path(args.clip), args.seconds, Path(tmp)).read_bytes()
        except (subprocess.SubprocessError, OSError) as e:
            print(f"ffmpeg failed: {type(e).__name__}", file=sys.stderr)
            return 1
    pcm, audio_ms = read_pcm(wav)
    print(f"audio_seconds={audio_ms / 1000:.1f} whisper={'yes' if args.whisper else 'no'}", file=sys.stderr)
    stream = None
    if settings.asr_stream_key:
        try:
            frames, took = await collect_frames(settings, pcm)
            stream = {**summarize_frames(frames, audio_ms), "seconds": took}
        except Exception as e:  # noqa: BLE001 - print the class name only
            print(f"stream request failed: {type(e).__name__}", file=sys.stderr)
    else:
        print("the streaming recognition key is not configured", file=sys.stderr)
    whisper = None
    if args.whisper:
        if settings.upstream_whisper_mode != "openai" or not settings.upstream_whisper_base_url:
            print("whisper: not applicable (needs UPSTREAM_WHISPER_MODE=openai and a base URL)", file=sys.stderr)
        else:
            try:
                status, payload = await whisper_probe(settings, wav)
                whisper = summarize_whisper(status, payload, audio_ms)
            except Exception as e:  # noqa: BLE001
                print(f"whisper request failed: {type(e).__name__}", file=sys.stderr)
    truth_errors: list[dict] = []
    if args.truth and stream and stream["final"] and stream["final"]["has_utterances"]:
        try:
            truth = json.loads(Path(args.truth).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            truth = None
        summary = stream["final"]["utterances"]
        truth_errors = compare_truth(summary["rows"], truth, 1000.0 if summary["unit_guess"] == "seconds?" else 1.0)
    block = render_markdown(args.label, audio_ms, stream, whisper, truth_errors)
    print(block)
    if args.append_to:
        with open(args.append_to, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n" + block)
    return 0 if stream is not None else 1


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--clip", required=True, help="audio or video file readable by ffmpeg (inside the container)")
    p.add_argument("--label", default="clip", help="short name for the results block, e.g. A-music")
    p.add_argument("--seconds", type=int, default=DEFAULT_SECONDS, help=f"first N seconds only (1-{MAX_SECONDS})")
    p.add_argument("--yes", action="store_true", help="really spend recognition quota")
    p.add_argument("--whisper", action="store_true", help="also try Whisper verbose_json (a second paid request)")
    p.add_argument("--truth", help="JSON [[start_ms, end_ms], ...] measured by listening, first sentences")
    p.add_argument("--append-to", help="append the Markdown block to this file (the results document)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.yes:
        print("refusing to spend recognition quota without --yes", file=sys.stderr)
        return 2
    if not 1 <= args.seconds <= MAX_SECONDS:
        print(f"--seconds must be 1-{MAX_SECONDS}", file=sys.stderr)
        return 2
    if not Path(args.clip).is_file():
        print("clip not found", file=sys.stderr)
        return 2
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4:跑测试变绿:** `cd server && uv run pytest -q tests/test_asr_timing_probe.py`。若 `argparse` 的 `--help` 取 `__doc__` 出错,以真实结果修。
- [ ] **Step 5:提交脚本与测试:** 

```
feat(server): add the ASR timestamp probe script (library alignment Task 0)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

- [ ] **Step 6:停,取得用户的确认再花钱。** 在对话里告诉用户:将对**两段约 1 分钟**的素材各发一次识别(其一带持续背景音乐,即用户导入出问题的那条的前 60 秒最好),密钥只在容器里读、不打印,不重建镜像、不重启容器(只做 `docker compose cp` 与 `exec`)。**没有用户在对话里的明确同意,不要运行 Step 7。** 执行者没有容器访问权限时,把 Step 7–8 在结果文档里写成 `PENDING(未运行:需要用户在容器里执行)` 并把下面的命令原样交给用户,然后**停在 G0**。

- [ ] **Step 7:运行(用户同意后;在仓库根目录,用户的 compose 环境里):**

```bash
docker compose cp server/scripts/asr_timing_probe.py server:/tmp/asr_timing_probe.py
docker compose cp ./clip-a-music.mp3 server:/tmp/clip-a.mp3
docker compose cp ./clip-b-clean.mp3 server:/tmp/clip-b.mp3
docker compose exec -e PYTHONPATH=/app server python /tmp/asr_timing_probe.py --clip /tmp/clip-a.mp3 --label A-music --yes --whisper
docker compose exec -e PYTHONPATH=/app server python /tmp/asr_timing_probe.py --clip /tmp/clip-b.mp3 --label B-clean --yes
docker compose exec server rm -f /tmp/asr_timing_probe.py /tmp/clip-a.mp3 /tmp/clip-b.mp3
```

可选的边界误差:用任意播放器听 A 素材前几句,把每句真实的起止毫秒写成 `[[start,end],…]` 存成 `/tmp/truth-a.json`(**不提交**),运行时加 `--truth /tmp/truth-a.json`。没做就在结果里写「边界误差:未验证」。

- [ ] **Step 8:把输出贴进结果文档。** 在 `docs/superpowers/plans/2026-10-13-video-import-results.md` **末尾**追加(用 Edit 在文件末尾追加,或脚本的 `--append-to`;日期用运行当天):

```markdown

## B 句边界根治 · Task 0 识别服务时间戳验证(plans/2026-10-13-library-alignment.md)

- 日期 / 基于提交:<YYYY-MM-DD> / <git rev-parse --short HEAD>
- 识别路径:`UPSTREAM_ASR_MODE=<volc_stream|…>`,`asr_stream_url` 的路径末段 `<bigmodel_nostream|bigmodel|bigmodel_async>`(只写路径末段,不写域名与密钥)
- 素材:A = 带持续背景音乐 ~60 s;B = 干净人声 ~60 s(只写时长,不写标题与内容)

(此处是脚本打印的两个「### 素材 …」块)

### G0 结论
| 问题 | 结果 |
|---|---|
| `result.utterances` 是否存在、字段名 | <有 / 没有;字段名 …> |
| 时间字段与单位 | <`start_time` / `end_time`,ms / seconds / 其他> |
| 基准 | <相对所发音频起点 / 其他>(最大终点 ≤ 音频长度 + 误差?) |
| 条数、单调、重叠、倒置 | <…> |
| 与真实边界的误差 | <最大绝对误差 … ms / 未验证> |
| Whisper `verbose_json` `segments` | <有(秒)/ 没有 / 不适用(chat 模式)/ 未运行> |
| **G0** | **A**(可用,继续 T2…)/ **B**(不可用,停,问用户 D9) |
```

- [ ] **Step 9:G0 决策。** A:要求全部成立——`utterances` 在最终帧里、单位 `ms`、相对块起点(最大终点不超过音频长度 + 2 s)、`monotonic` 为真且 `negative_or_inverted == 0`、`overlaps` 很少(逐条看)。**任何一条不成立 → B**:把「不成立的那条」写进结果文档,**停,把结果交给用户,问是否引入 VAD(Task 11)**;可以先做 T1。若字段名 / 单位与 R-A1 不同(例如毫秒但字段叫别的名字),**不要自作主张改**:在结果文档记下,按真实字段名修改 T2 的 `parse_utterances`(含它的测试)后继续。
- [ ] **Step 10:提交结果文档:** `docs: record the ASR timestamp verification (library alignment Task 0)`(+ Co-Authored-By 行)。

---

# Task 1:迁移 `0019` + 模型列 + `item_out`

**Files:** Create `server/alembic/versions/0019_library_low_confidence.py`;Modify `server/app/models.py`、`server/app/library/store.py`、`server/tests/test_migrations.py`、`server/tests/test_library_models.py`、`server/tests/test_library_store.py`。

- [ ] **Step 1:写测试(先红)。**

  `tests/test_library_models.py`:把 `test_head_is_0018_and_down_revision_is_0017` 整个替换为

```python
def test_head_is_0019_and_the_chain_is_linear(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0019"]
    assert script.get_revision("0019").down_revision == "0018"
    assert script.get_revision("0018").down_revision == "0017"


def test_0019_adds_low_confidence_keeps_rows_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0018")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-13')")
    con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                "values ('i1', 12345678, 'video', 'upload', 't', 'ready', '2026-10-13', '2026-10-13')")
    con.commit()
    con.close()
    command.upgrade(cfg, "0019")
    con = sqlite3.connect(db)
    assert "low_confidence" in {r[1] for r in con.execute("pragma table_info(library_items)")}
    assert con.execute("select low_confidence from library_items where id = 'i1'").fetchone() == (0,)
    con.close()
    command.downgrade(cfg, "0018")
    con = sqlite3.connect(db)
    assert "low_confidence" not in {r[1] for r in con.execute("pragma table_info(library_items)")}
    assert con.execute("select count(*) from library_items").fetchone() == (1,)
    assert {"ix_library_items_user_id_created_at", "ix_library_items_status_next_run_at"} <= {
        r[1] for r in con.execute("pragma index_list(library_items)")}
    con.close()
    command.upgrade(cfg, "head")
```

  `tests/test_migrations.py`:用 Edit 的 `replace_all` 把 `get_heads() == ["0018"]` 换成 `get_heads() == ["0019"]`(5 处:原第 365、432、497、548、628 行附近)。

  `tests/test_library_store.py::test_item_out_shape_and_upload_progress`:键集合末尾加 `"low_confidence"`,并在 `assert out["progress"] == 25 ...` 那行后加一行 `assert out["low_confidence"] is False`。

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_models.py tests/test_library_store.py tests/test_migrations.py -k "0019 or head or item_out or heads"`。预期:head 断言失败、`low_confidence` 键缺失。

- [ ] **Step 3:迁移** `server/alembic/versions/0019_library_low_confidence.py`:

```python
"""library: low_confidence flag on items (plan 2026-10-13-library-alignment, spec D5 §4.3.4)

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-13 18:00:00.000000

One NOT NULL boolean with a server default on library_items: a plain ADD COLUMN on SQLite and Postgres (no table
rewrite on Postgres 11+), existing rows read false. The downgrade uses batch mode for SQLite (like 0017).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0019'
down_revision: Union[str, Sequence[str], None] = '0018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('library_items', sa.Column('low_confidence', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('library_items') as batch:
        batch.drop_column('low_confidence')
```

- [ ] **Step 4:模型。** `server/app/models.py` 的 `LibraryItem`,在 `rate_pct` 那行之后加(`false` 已在文件顶部从 sqlalchemy 导入):

```python
    low_confidence: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())  # D5:句边界可能不准
```

- [ ] **Step 5:`item_out`。** `server/app/library/store.py` 的 `item_out` 返回字典里,`"has_poster": ...` 那行之前加 `"low_confidence": row.low_confidence,`(同一个字典,逗号对齐)。

- [ ] **Step 6:跑测试:** `cd server && uv run pytest -q tests/test_migrations.py tests/test_library_models.py tests/test_library_store.py tests/test_architecture.py`。注意 `test_models_match_migrations` 必须绿(模型与迁移无漂移)。
- [ ] **Step 7:提交:**

```
feat(server): add library_items.low_confidence (migration 0019)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 2:语音层带时间(G0 = A 之后)

**Files:** Create `server/app/speech/timed.py`、`server/tests/test_asr_stream_timed.py`、`server/tests/test_asr_timed.py`;Modify `server/app/speech/asr_stream.py`、`server/app/speech/asr.py`、`server/tests/test_asr_stream.py`(一处,给假服务器加 `utterances`)。

- [ ] **Step 1:假服务器能返回 utterances。** `tests/test_asr_stream.py` 的 `FakeAsr.__init__` 里 `self.text = "Hello, world."` 之后加一行 `self.utterances = None`;`handler` 末尾把

```python
            await ws.send(server_response({"result": {"text": self.text}}, seq=-seq, last=True))
            return
```

  换成

```python
            result = {"text": self.text}
            if self.utterances is not None:
                result["utterances"] = self.utterances
            await ws.send(server_response({"result": result}, seq=-seq, last=True))
            return
```

  (这是 `handler` 里唯一带 `self.text` 的 `server_response`;`seq=1` 那条开头应答不动。)

- [ ] **Step 2:写测试(先红)** `server/tests/test_asr_stream_timed.py`:

```python
"""带时间的流式识别(plan 2026-10-13-library-alignment R-A1 / R-A3)。字段名与单位以 Task 0 的结果为准。"""
import logging

import pytest

from app.speech.asr_stream import AsrStreamError, parse_utterances, transcribe_pcm, transcribe_pcm_timed
from app.speech.timed import TimedText, Utterance
from tests.test_asr_stream import decode_frame_request, fake, settings_for  # noqa: F401  (`fake` is a fixture)

PCM = b"\x00\x00" * 10


@pytest.mark.parametrize("raw, expected", [
    ({"utterances": [{"text": " Hello,  world. ", "start_time": 120, "end_time": 900, "definite": True}]},
     (Utterance("Hello, world.", 120, 900),)),
    ({"utterances": [{"text": "kept", "start_time": 0, "end_time": 5.4}]}, (Utterance("kept", 0, 5),)),  # no `definite`
    ({"utterances": [{"text": "unfinished", "start_time": 0, "end_time": 900, "definite": False}]}, ()),
    ({"utterances": [{"text": "x", "start_time": True, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": "0", "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": None, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": 900, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": -5, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "   ", "start_time": 0, "end_time": 900}]}, ()),
    ({"utterances": [{"start_time": 0, "end_time": 900}]}, ()),
    ({"utterances": ["not a dict", 7, None]}, ()),
    ({"utterances": "nope"}, ()), ({}, ()), (None, ()), ("text", ()),
])
def test_parse_utterances(raw, expected):
    assert parse_utterances(raw) == expected


async def test_only_the_timed_call_asks_for_utterances(fake):  # noqa: F811
    await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert decode_frame_request(fake.frames[0])["request"]["show_utterances"] is True
    fake.frames.clear()
    await transcribe_pcm(settings_for(fake.url), PCM)
    assert "show_utterances" not in decode_frame_request(fake.frames[0])["request"]


async def test_the_timed_result_carries_text_and_utterances(fake):  # noqa: F811
    fake.text = " Hello, world. "
    fake.utterances = [{"text": "Hello,", "start_time": 120, "end_time": 500, "definite": True},
                       {"text": "world.", "start_time": 560, "end_time": 900, "definite": True}]
    got = await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert got == TimedText("Hello, world.", (Utterance("Hello,", 120, 500), Utterance("world.", 560, 900)))


async def test_the_plain_call_still_returns_a_string_and_ignores_utterances(fake):  # noqa: F811
    fake.utterances = [{"text": "Hello, world.", "start_time": 0, "end_time": 900}]
    assert await transcribe_pcm(settings_for(fake.url), PCM) == "Hello, world."


async def test_a_reply_without_utterances_gives_an_empty_tuple(fake):  # noqa: F811
    assert await transcribe_pcm_timed(settings_for(fake.url), PCM) == TimedText("Hello, world.", ())


async def test_empty_text_is_still_the_empty_error_when_timed(fake):  # noqa: F811
    fake.text = "  "
    fake.utterances = [{"text": "x", "start_time": 0, "end_time": 900}]
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert e.value.kind == "empty"


async def test_utterance_text_never_reaches_the_logs(fake, caplog):  # noqa: F811
    caplog.set_level(logging.DEBUG, logger="app")
    fake.text = "SECRET-TRANSCRIPT here."
    fake.utterances = [{"text": "SECRET-TRANSCRIPT here.", "start_time": 0, "end_time": 900}]
    await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert all("SECRET-TRANSCRIPT" not in f"{r.getMessage()} {r.args!r}" for r in caplog.records)
```

  `server/tests/test_asr_timed.py`:

```python
"""make_timed_transcriber:流式带时间,回落路径只给文字(R-A5)。"""
import types

import pytest

from app.speech.asr import AsrError, make_timed_transcriber
from app.speech.asr_stream import AsrGate, AsrStreamError
from app.speech.stt import pcm_to_wav
from app.speech.timed import TimedText, Utterance
from tests.conftest import make_settings
from tests.test_asr_buffered import ARK, CHAT, NO_FALLBACK, PCM, STREAM, chat_reply

TIMED = TimedText("streamed", (Utterance("streamed", 0, 500),))


@pytest.fixture
def timed_stream(monkeypatch):
    """Fake `transcribe_pcm_timed`: records PCM and returns / raises the queued outcomes in order."""
    state = types.SimpleNamespace(calls=[], outcomes=[])

    async def fake(settings, pcm, uid="server"):
        state.calls.append((pcm, uid))
        outcome = state.outcomes.pop(0) if state.outcomes else TIMED
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("app.speech.asr.transcribe_pcm_timed", fake)
    return state


async def test_the_stream_path_returns_text_and_times(respx_mock, timed_stream):
    import httpx

    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), uid="7")(pcm_to_wav(PCM))
    assert got == TIMED and timed_stream.calls == [(PCM, "7")] and not route.called


async def test_a_stream_failure_falls_back_to_chat_without_times(respx_mock, timed_stream):
    import httpx

    timed_stream.outcomes = [AsrStreamError("upstream")]
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM))(pcm_to_wav(PCM))
    assert got == TimedText("from chat", ())


async def test_a_busy_gate_skips_the_stream_and_uses_the_fallback(respx_mock, timed_stream):
    import httpx

    gate = AsrGate(1)
    assert await gate.try_enter() is None  # occupy the only slot
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), gate=gate)(pcm_to_wav(PCM))
    assert got == TimedText("from chat", ()) and timed_stream.calls == []


async def test_without_a_fallback_errors_map_like_the_plain_transcriber(respx_mock, timed_stream):
    import httpx

    timed_stream.outcomes = [AsrStreamError("auth"), AsrStreamError("empty")]
    async with httpx.AsyncClient() as http:
        transcribe = make_timed_transcriber(http, make_settings(**NO_FALLBACK))
        with pytest.raises(AsrError) as e:
            await transcribe(pcm_to_wav(PCM))
        assert e.value.kind == "auth"
        assert await transcribe(pcm_to_wav(PCM)) == TimedText("", ())  # "nothing heard" is not an error


async def test_without_the_stream_mode_it_is_the_plain_chat_path(respx_mock, timed_stream):
    import httpx

    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**CHAT))(pcm_to_wav(PCM))
    assert got == TimedText("from chat", ()) and timed_stream.calls == []
```

- [ ] **Step 3:跑一次确认红:** `cd server && uv run pytest -q tests/test_asr_stream_timed.py tests/test_asr_timed.py`。预期:`ImportError`(`app.speech.timed` 不存在)。

- [ ] **Step 4:`app/speech/timed.py`(新):**

```python
"""识别结果「带时间」的形状(plan 2026-10-13-library-alignment R-A2):纯数据,没有协议细节,只依赖标准库。

`Utterance`:识别服务自己切出的一句(或一段),`start_ms` / `end_ms` 相对**发送出去的那段音频的起点**(跟读库发送的是识别块的
WAV 切片,所以相对块起点,R-A1)。`TimedText.utterances` 为空 = 这条识别路径没有给时间(Whisper chat 回落、旧协议)。
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Utterance:
    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class TimedText:
    text: str
    utterances: tuple[Utterance, ...] = ()
```

- [ ] **Step 5:`app/speech/asr_stream.py`(Edit,四处):**

  (a)导入区(`from app.core.config import Settings` 之后)加:`from app.speech.timed import TimedText, Utterance`。

  (b)把 `_request_payload` 换成:

```python
def _request_payload(uid: str, utterances: bool = False) -> dict:
    """`utterances=True` adds `show_utterances` so the final frame carries per-sentence times (R-A3: only the timed path)."""
    request = {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True}
    if utterances:
        request["show_utterances"] = True
    return {
        "user": {"uid": uid},
        "audio": {"format": "pcm", "codec": "raw", "rate": SAMPLE_RATE, "bits": 16, "channel": 1},
        "request": request,
    }


def parse_utterances(result: object) -> tuple[Utterance, ...]:
    """`result.utterances[{text, start_time, end_time, definite?}]` -> `Utterance`s in ms (R-A1). Entries that are not
    finished (`definite` is false), have no usable times or no text are dropped; whether the rest can be trusted is the
    caller's decision (`app.library.asr_chunks.usable_utterances`)."""
    raw = result.get("utterances") if isinstance(result, dict) else None
    out: list[Utterance] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or item.get("definite") is False:
            continue
        text, start, end = item.get("text"), item.get("start_time"), item.get("end_time")
        if not isinstance(text, str) or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in (start, end)):
            continue
        text = " ".join(text.split())
        if text and start >= 0 and end > start:
            out.append(Utterance(text, round(start), round(end)))
    return tuple(out)
```

  (c)把 `transcribe_pcm` 整个函数换成这三个函数(`meter_status` / `_meter` 保持原样在其后):

```python
async def transcribe_pcm(settings: Settings, pcm: bytes, uid: str = "server") -> str:
    """Final transcript, or AsrStreamError for any failure (so callers can always fall back).
    Cancellation (BaseException) still propagates."""
    return (await _run(settings, pcm, uid, utterances=False)).text


async def transcribe_pcm_timed(settings: Settings, pcm: bytes, uid: str = "server") -> TimedText:
    """`transcribe_pcm` plus the recognizer's own sentence times (plan 2026-10-13-library-alignment)."""
    return await _run(settings, pcm, uid, utterances=True)


async def _run(settings: Settings, pcm: bytes, uid: str, *, utterances: bool) -> TimedText:
    connect_id = str(uuid.uuid4())
    timer = metering.Timer()
    try:
        result = await _transcribe(settings, pcm, uid, connect_id, utterances)
    except AsrStreamError as e:
        e.connect_id = connect_id
        _meter(settings, meter_status(e), timer.ms(), len(pcm))
        raise
    except Exception as e:  # noqa: BLE001 - RecursionError, MemoryError, library bugs...
        err = AsrStreamError("protocol", f"unexpected {type(e).__name__}")
        err.connect_id = connect_id
        _meter(settings, meter_status(err), timer.ms(), len(pcm))
        raise err from None
    _meter(settings, 200, timer.ms(), len(pcm))
    return result
```

  (d)把 `_transcribe` 与 `_collect` 换成(其余函数不动):

```python
async def _transcribe(settings: Settings, pcm: bytes, uid: str, connect_id: str, utterances: bool = False) -> TimedText:
    key = settings.asr_stream_key
    if not key:
        raise AsrStreamError("not_configured")
    headers = {
        "X-Api-Key": key,
        "X-Api-Resource-Id": settings.asr_stream_resource_id,
        "X-Api-Connect-Id": connect_id,
    }
    logid = ""
    try:
        async with asyncio.timeout(stream_budget(settings, len(pcm))):
            async with connect(
                settings.asr_stream_url,
                additional_headers=headers,
                open_timeout=OPEN_TIMEOUT,
                max_size=MAX_MESSAGE_BYTES,
                close_timeout=CLOSE_TIMEOUT,
                logger=_ws_logger,
            ) as ws:
                logid = _logid(ws.response.headers)
                await ws.send(encode_full_request(_request_payload(uid, utterances)))
                sender = asyncio.create_task(_send_audio(ws, pcm))
                try:
                    result = await _collect(ws, utterances)
                finally:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
    except AsrStreamError as e:
        e.logid = logid
        raise
    except TimeoutError:
        err = AsrStreamError("timeout")
        err.logid = logid
        raise err from None
    except websockets.InvalidStatus as e:
        status = e.response.status_code
        kind: Kind = "auth" if status in AUTH_STATUSES else "upstream"
        err = AsrStreamError(kind, f"http={status}")
        err.logid = _logid(e.response.headers)
        raise err from None
    except (OSError, websockets.WebSocketException) as e:
        err = AsrStreamError("upstream", type(e).__name__)
        err.logid = logid
        raise err from None
    text = result.text.strip()
    if not text:
        err = AsrStreamError("empty")
        err.logid = logid
        raise err
    return TimedText(text, result.utterances)
```

```python
async def _collect(ws, utterances: bool = False) -> TimedText:
    try:
        async for raw in ws:
            frame = decode_frame(raw)
            if frame.msg_type == MSG_ERROR:
                message = _clean(frame.payload.get("error") or frame.payload.get("message") or "")
                quota = frame.code in QUOTA_CODES or "quota" in message.lower()
                kind: Kind = "quota" if quota else "upstream"
                raise AsrStreamError(kind, f"code={frame.code} message={message}")
            if frame.last:
                result = frame.payload.get("result")
                text = result.get("text") if isinstance(result, dict) else None
                return TimedText(text if isinstance(text, str) else "", parse_utterances(result) if utterances else ())
    except websockets.ConnectionClosedError:
        pass
    raise AsrStreamError("protocol", "closed before the final result")
```

- [ ] **Step 6:`app/speech/asr.py`(Edit):**

  (a)导入:`from app.speech.asr_stream import SAMPLE_RATE, AsrGate, AsrStreamError, transcribe_pcm, wav_to_pcm` 末尾加 `transcribe_pcm_timed`;并加 `from app.speech.timed import TimedText`。

  (b)把 `_try_stream` 换成(只多一个 `timed` 参数,`transcribe_pcm` 仍按名字在调用时查找,既有测试的 monkeypatch 目标不变):

```python
async def _try_stream(settings: Settings, gate: AsrGate, pcm: bytes, uid: str, fallback: bool, *,
                      timed: bool = False) -> str | TimedText | None:
    """流式识别的文本;None 表示应走回落(没有回落时直接抛 AsrError)。`timed=True` 同时要句子时间,返回 `TimedText`。
    没有回落时,流式结果为空(`empty`)= 没听清,返回 "" / `TimedText("")`,不是错误(复核 1.5-I1;
    上传识别接口 ai_audio 仍按 R4 口径处理,不受影响)。取消对熔断计数是中性的。"""
    audio_s = len(pcm) / (SAMPLE_RATE * 2)
    skip = await gate.try_enter()
    if skip is not None:
        logger.warning("asr volc_stream skipped reason=%s audio_s=%.2f fallback=%s", skip, audio_s, fallback)
        if not fallback:
            raise AsrError("upstream")
        return None
    started = time.perf_counter()
    kind = "aborted"  # cancelled (or anything unexpected) → neutral for the breaker
    try:
        text = await (transcribe_pcm_timed if timed else transcribe_pcm)(settings, pcm, uid)
        kind = None
    except AsrStreamError as e:
        kind = e.kind
        ms = round((time.perf_counter() - started) * 1000)
        log_timing("stt_volc_stream", ms=ms, audio_bytes=len(pcm), status=0)
        logger.warning(
            "asr volc_stream failed kind=%s detail=%s ms=%d audio_s=%.2f fallback=%s connect_id=%s logid=%s",
            e.kind, e.detail, ms, audio_s, fallback, e.connect_id, e.logid,
        )
        if not fallback:
            if e.kind == "empty":
                return TimedText("") if timed else ""
            raise _map_stream(e.kind) from None
        return None
    finally:
        gate.leave(kind)
    log_timing("stt_volc_stream", ms=round((time.perf_counter() - started) * 1000), audio_bytes=len(pcm), status=200)
    return text
```

  (c)在 `make_transcriber` 之后加:

```python
def make_timed_transcriber(
    http: httpx.AsyncClient,
    settings: Settings,
    language: str | None = "en",
    *,
    gate: AsrGate | None = None,
    uid: str = "server",
) -> Callable[[bytes], Awaitable[TimedText]]:
    """WAV → `TimedText`(跟读库的识别块用,plan 2026-10-13-library-alignment)。流式路径带句子时间;流式不可用 / 失败时回落
    到 chat / Whisper,那条路径只给文字(`utterances` 为空,调用方逐块回落到估算,R-A5)。错误口径与 `make_transcriber` 相同。"""
    if gate is None and settings.asr_stream_enabled:
        gate = AsrGate(settings.asr_stream_max_concurrency)

    async def transcribe(wav: bytes) -> TimedText:
        if settings.asr_stream_enabled:
            pcm = wav_to_pcm(wav)
            if pcm is not None:
                result = await _try_stream(settings, gate, pcm, uid, _fallback_configured(settings), timed=True)
                if result is not None:
                    return result  # type: ignore[return-value]  # timed=True always yields TimedText
        try:
            return TimedText(await transcribe_wav(http, settings, wav, language))
        except HTTPException as e:
            raise _map_http(e) from None

    return transcribe
```

  (注意 `asr.py` 里 `transcribe_wav` 已从 `app.speech.stt` 导入;`Callable` / `Awaitable` 已在文件顶部导入。)

- [ ] **Step 7:跑测试:** `cd server && uv run pytest -q tests/test_asr_stream_timed.py tests/test_asr_timed.py tests/test_asr_stream.py tests/test_asr_buffered.py tests/test_asr_realtime.py tests/test_architecture.py`。既有 `test_asr_stream.py` / `test_asr_buffered.py` 必须仍全绿(请求体、`transcribe_pcm` 返回类型都没变)。
- [ ] **Step 8:提交:**

```
feat(server): timed streaming ASR (show_utterances) behind make_timed_transcriber

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 3:块与分句器优先真实时间(`asr_chunks.py`)

**Files:** Modify `server/app/library/asr_chunks.py`;Create `server/tests/test_library_asr_timed.py`。`segment.py` **不改**;既有 `tests/test_library_asr_chunks.py` 不改且必须仍绿。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_asr_timed.py`:

```python
"""句边界:识别服务给出的真实时间优先,持续背景音乐下不再平摊(plan 2026-10-13-library-alignment)。"""
import pytest

from app.library import asr_chunks as ac
from app.library.segment import Fragment, build
from app.speech.timed import TimedText, Utterance

LINES = ["Welcome back to the show everyone.", "Today we are talking about learning English.",
         "Let us begin with a simple question."]
TEXT = " ".join(LINES)
# 用户素材的形状:40 s 硬切块里,前 18 s 只有背景音乐,三句人声在已知的时间(没有任何静音可供 silencedetect 找到)
UTTS = [Utterance(LINES[0], 18_000, 21_200), Utterance(LINES[1], 22_000, 26_400), Utterance(LINES[2], 27_300, 30_100)]


def chunk_with(utts, text=TEXT, start=0, end=40_000):
    return ac.Chunk(start, end, text, utts)


def test_state_keeps_utterances_and_still_reads_version_1(tmp_path):
    path = tmp_path / "chunks.json"
    chunks = [ac.Chunk(0, 1000, "hi there", [Utterance("hi there", 100, 900)]), ac.Chunk(1000, 2000, "x", []),
              ac.Chunk(2000, 3000)]
    ac.save_state(path, chunks)
    assert ac.STATE_VERSION == 2 and ac.load_state(path) == chunks
    path.write_text('{"version": 1, "chunks": [{"start_ms": 0, "end_ms": 1000, "text": "old"}]}', encoding="utf-8")
    assert ac.load_state(path) == [ac.Chunk(0, 1000, "old")]
    path.write_text('{"version": 3, "chunks": []}', encoding="utf-8")
    assert ac.load_state(path) is None


GOOD = list(UTTS)
CASES = {
    "good": (GOOD, True),
    "case and punctuation differences are fine": (
        [Utterance(LINES[0].upper().replace(".", ""), 18_000, 21_200), *UTTS[1:]], True),
    "none": (None, False),
    "empty": ([], False),
    "ends beyond the chunk plus slack": ([*UTTS[:2], Utterance(LINES[2], 27_300, 41_600)], False),
    "overlap beyond tolerance": ([Utterance(LINES[0], 18_000, 23_000), *UTTS[1:]], False),
    "inverted times": ([Utterance(LINES[0], 21_200, 18_000), *UTTS[1:]], False),
    "text does not match": ([Utterance("Something else entirely different.", 18_000, 21_200)], False),
    "covers only part of the text": ([UTTS[0]], False),
}


@pytest.mark.parametrize("utts, ok", list(CASES.values()), ids=list(CASES))
def test_usable_utterances(utts, ok):
    assert bool(ac.usable_utterances(chunk_with(utts))) is ok


def test_a_chunk_without_text_never_has_usable_utterances():
    assert ac.usable_utterances(chunk_with(UTTS, text=None)) == []
    assert ac.usable_utterances(chunk_with(UTTS, text="")) == []


def test_fragments_use_the_recognizers_times_offset_by_the_chunk_start():
    out = ac.fragments([ac.Chunk(40_000, 80_000, TEXT, UTTS)], [])
    assert out == [Fragment(58_000, 61_200, LINES[0]), Fragment(62_000, 66_400, LINES[1]),
                   Fragment(67_300, 70_100, LINES[2])]


def test_an_untrusted_chunk_falls_back_to_the_estimate_and_trusted_ones_do_not():
    estimated = ac.Chunk(0, 40_000, TEXT, [])
    assert ac.fragments([estimated], []) == [Fragment(0, 40_000, TEXT)]
    mixed = ac.fragments([ac.Chunk(0, 40_000, TEXT, UTTS), ac.Chunk(40_000, 80_000, "No times here at all.")],
                         [ac.Silence(39_000, 41_000)])
    assert mixed[:3] == [Fragment(18_000, 21_200, LINES[0]), Fragment(22_000, 26_400, LINES[1]),
                         Fragment(27_300, 30_100, LINES[2])]
    assert mixed[3] == Fragment(41_000, 80_000, "No times here at all.")  # the old speech_span estimate


def test_an_utterance_slightly_past_the_chunk_end_is_clamped():
    chunk = ac.Chunk(0, 40_000, "Hello there my friend.", [Utterance("Hello there my friend.", 39_000, 40_900)])
    assert ac.fragments([chunk], []) == [Fragment(39_000, 40_000, "Hello there my friend.")]


def test_continuous_background_music_no_longer_spreads_the_first_sentences_flat():
    """Old behaviour (no silences found, text spread over the whole hard-cut chunk) vs real times."""
    old = build(ac.fragments([ac.Chunk(0, 40_000, TEXT)], []), adjust=ac.snapper([]))
    assert old[0].start_ms == 0 and old[0].end_ms > 10_000 and old[1].start_ms < 13_000  # the reported bug
    new = build(ac.fragments([chunk_with(UTTS)], []), adjust=ac.snapper([]))
    assert [(s.start_ms, s.end_ms, s.text) for s in new] == [
        (18_000, 21_200, LINES[0]), (22_000, 26_400, LINES[1]), (27_300, 30_100, LINES[2])]


def test_estimated_chunks_lists_only_chunks_that_have_text_but_no_trusted_times():
    chunks = [chunk_with(UTTS), ac.Chunk(40_000, 80_000, "No times."), ac.Chunk(80_000, 90_000, ""), ac.Chunk(90_000, 99_000)]
    assert ac.estimated_chunks(chunks) == [chunks[1]]


async def test_timed_transcription_stores_text_and_utterances_and_counts_only_new_seconds():
    chunks = [ac.Chunk(0, 10_000), ac.Chunk(10_000, 20_000, "kept")]
    seen = []

    async def read(chunk):
        return str(chunk.start_ms).encode()

    async def transcribe(wav):
        seen.append(wav)
        return TimedText(" Hi  there. ", (Utterance("Hi there.", 500, 1500),))

    async def progress(done, total):
        pass

    spent = await ac.transcribe_chunks_timed(chunks, read=read, transcribe=transcribe, save=lambda c: None, progress=progress)
    assert spent == 10 and seen == [b"0"]
    assert chunks[0].text == "Hi there." and chunks[0].utterances == [Utterance("Hi there.", 500, 1500)]
    assert chunks[1].utterances is None  # finished before: untouched
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_asr_timed.py`。预期:`ImportError`(`app.speech.timed`)/ `AttributeError: usable_utterances`(T2 未做时先做 T2)。

- [ ] **Step 3:`asr_chunks.py`(Edit)。**

  (a)模块文档串第一行之后补一句:`带时间的识别(plan 2026-10-13-library-alignment):块里存识别服务给的 `utterances`,`usable_utterances` 判断可信,`fragments` 对可信的块给出每个识别句一个真实时间的片段,其余块回落到估算。`

  (b)导入区:在 `import wave` 之后(标准库段)加 `from difflib import SequenceMatcher`;在 `from app.library.segment import Aligned, Fragment, set_span` 之后加 `from app.speech.timed import TimedText, Utterance`。

  (c)常量区(`STATE_VERSION = 1` 那行)改成并追加:

```python
STATE_VERSION = 2
READABLE_VERSIONS = (1, 2)  # version 1 chunks carry no utterances: still usable, nothing is paid for twice (R-A6)
UTTERANCE_SLACK_MS = 1500  # an utterance may end this far past the chunk (rounding, trailing silence)
UTTERANCE_OVERLAP_MS = 250  # an utterance may start this far before the previous one ended
TEXT_AGREEMENT = 0.9  # SequenceMatcher ratio between the chunk text and the utterance texts (letters and digits only)
```

  (d)`Chunk` 数据类换成:

```python
@dataclass
class Chunk:
    start_ms: int
    end_ms: int
    text: str | None = None  # None = not transcribed yet
    # the recognizer's own sentences, ms from the chunk start; None = never asked / legacy state, [] = none returned
    utterances: list[Utterance] | None = None

    @property
    def seconds(self) -> int:
        return math.ceil((self.end_ms - self.start_ms) / 1000)
```

  (e)把 `fragments` 整个函数换成下面三个函数(`nearest_mid` / `snapper` 不动):

```python
def _letters(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum())


def usable_utterances(chunk: Chunk) -> list[Utterance]:
    """The chunk's recognizer-reported sentences when they can be trusted, else [] (R-A4): every one inside the chunk (plus
    slack), in order (small overlap allowed), and their texts agree with the chunk text. A time list that does not
    match the words must not be believed: the caller then estimates this chunk the old way."""
    utts = chunk.utterances or []
    if not utts or not chunk.text:
        return []
    length = chunk.end_ms - chunk.start_ms
    previous_end = 0
    for u in utts:
        if not 0 <= u.start_ms < u.end_ms <= length + UTTERANCE_SLACK_MS or u.start_ms < previous_end - UTTERANCE_OVERLAP_MS:
            return []
        previous_end = u.end_ms
    a, b = _letters(chunk.text), _letters("".join(u.text for u in utts))
    if not a or not b or SequenceMatcher(None, a, b, autojunk=False).ratio() < TEXT_AGREEMENT:
        return []
    return list(utts)


def estimated_chunks(chunks: list[Chunk]) -> list[Chunk]:
    """Chunks that have text but no trustworthy times: their sentence times are character-share estimates."""
    return [c for c in chunks if " ".join((c.text or "").split()) and not usable_utterances(c)]


def fragments(chunks: list[Chunk], silences: list[Silence]) -> list[Fragment]:
    """One fragment per recognizer sentence for a trusted chunk (real times, offset by the chunk start); one fragment for
    the whole speech span of any other chunk (the character-share estimate, silences trimmed at both edges)."""
    out: list[Fragment] = []
    for chunk in chunks:
        text = " ".join((chunk.text or "").split())
        if not text:
            continue
        length = chunk.end_ms - chunk.start_ms
        real = [Fragment(chunk.start_ms + u.start_ms, chunk.start_ms + min(length, u.end_ms), u.text)
                for u in usable_utterances(chunk) if u.start_ms < length]
        if real:
            out += real
            continue
        s0, s1 = speech_span(chunk, silences)
        out.append(Fragment(s0, s1, text))
    return out
```

  (f)`load_state` 换成(`save_state` 不动:`asdict` 会把 `Utterance` 递归转成字典):

```python
def _load_utterances(raw) -> list[Utterance] | None:
    if not isinstance(raw, list):
        return None
    return [Utterance(str(u["text"]), int(u["start_ms"]), int(u["end_ms"])) for u in raw]


def load_state(path: Path) -> list[Chunk] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") not in READABLE_VERSIONS:
            return None
        return [Chunk(int(c["start_ms"]), int(c["end_ms"]), c.get("text"), _load_utterances(c.get("utterances")))
                for c in data["chunks"]]
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
```

  (g)把 `transcribe_chunks` 整个函数换成 `transcribe_chunks_timed` + 薄包装:

```python
async def transcribe_chunks_timed(chunks: list[Chunk], *, read: Callable[[Chunk], Awaitable[bytes]],
                                  transcribe: Callable[[bytes], Awaitable[TimedText]],
                                  save: Callable[[list[Chunk]], None],
                                  progress: Callable[[int, int], Awaitable[None]],
                                  concurrency: int = ASR_CONCURRENCY, retries: int = ASR_CHUNK_RETRIES) -> int:
    """Fill `text` (and `utterances`) of every chunk that has no text (concurrency <= 2, each chunk tried 1 + `retries`
    times). `save` runs after every finished chunk; `progress(done, total)` after every chunk. Returns the seconds
    actually transcribed in this call. Any chunk failing for good -> LibraryError("upstream") (the others finish first)."""
    todo = [c for c in chunks if c.text is None]
    total, done = len(chunks), len(chunks) - len(todo)
    gate = asyncio.Semaphore(max(1, concurrency))
    spent = 0
    failed = False
    lock = asyncio.Lock()

    async def one(chunk: Chunk) -> None:
        nonlocal spent, done, failed
        async with gate:
            if failed:
                return
            wav = await read(chunk)
            for attempt in range(retries + 1):
                try:
                    result = await transcribe(wav)
                    break
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 - recognizer errors are classified by kind only
                    if attempt == retries:
                        failed = True
                        return
            async with lock:
                chunk.text = " ".join((result.text or "").split())
                chunk.utterances = list(result.utterances)
                spent += chunk.seconds
                done += 1
                save(chunks)
        await progress(done, total)

    await asyncio.gather(*(one(c) for c in todo))
    if failed:
        raise LibraryError("upstream")
    return spent


async def transcribe_chunks(chunks: list[Chunk], *, read: Callable[[Chunk], Awaitable[bytes]],
                            transcribe: Callable[[bytes], Awaitable[str]], save: Callable[[list[Chunk]], None],
                            progress: Callable[[int, int], Awaitable[None]],
                            concurrency: int = ASR_CONCURRENCY, retries: int = ASR_CHUNK_RETRIES) -> int:
    """The text-only form (no times): `transcribe_chunks_timed` with every result wrapped as `TimedText(text)`."""
    async def timed(wav: bytes) -> TimedText:
        return TimedText(await transcribe(wav))

    return await transcribe_chunks_timed(chunks, read=read, transcribe=timed, save=save, progress=progress,
                                         concurrency=concurrency, retries=retries)
```

- [ ] **Step 4:跑测试:** `cd server && uv run pytest -q tests/test_library_asr_timed.py tests/test_library_asr_chunks.py tests/test_library_segment.py tests/test_architecture.py`。既有 `test_library_asr_chunks.py`(含 `test_state_round_trip_and_bad_files` 的版本 99 → `None`、重试 / 断点用例)必须不改而绿。
- [ ] **Step 5:提交:**

```
feat(server): prefer the recognizer's real sentence times when aligning library chunks

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 4:合理性检查 + 流水线接线 + 持续背景音乐夹具

**Files:** Create `server/app/library/quality.py`、`server/tests/test_library_quality.py`、`server/tests/test_library_alignment.py`;Modify `server/app/library/pipeline.py`、`server/app/library/worker.py`(只 `install`)、`server/tests/library_helpers.py`。

- [ ] **Step 1:测试助手** `server/tests/library_helpers.py`:顶部导入加 `from app.speech.timed import TimedText`;在 `FakeAsr` 之后加:

```python
class FakeTimedAsr:
    """timed transcriber(user_id) -> async (wav) -> TimedText. `results` are returned in order: a `TimedText`, a plain str
    (a recognizer that gives no times) or an Exception instance (raised)."""

    def __init__(self, results: list):
        self.results = list(results)
        self.calls: list[int] = []

    def __call__(self, user_id: int):
        async def transcribe(wav: bytes) -> TimedText:
            with wave.open(io.BytesIO(wav)) as w:
                self.calls.append(w.getnframes() * 1000 // 16000)
            item = self.results.pop(0) if self.results else ""
            if isinstance(item, Exception):
                raise item
            return item if isinstance(item, TimedText) else TimedText(item)
        return transcribe
```

  并把 `use_fakes` 换成:

```python
def use_fakes(app, tools: FakeTools | None = None, asr: FakeAsr | None = None,
              timed_asr: FakeTimedAsr | None = None) -> FakeTools:
    """`asr=` (text only) turns the timed transcriber off so the fake is what runs; `timed_asr=` turns it on."""
    tools = tools or FakeTools()
    app.state.library.deps.tools = tools
    if asr is not None:
        app.state.library.deps.transcriber = asr
        app.state.library.deps.timed_transcriber = None
    if timed_asr is not None:
        app.state.library.deps.timed_transcriber = timed_asr
    return tools
```

- [ ] **Step 2:写测试(先红)。**

  `server/tests/test_library_quality.py`:

```python
"""合理性检查(spec §4.3.4、裁定 R-Q1):表驱动。用户那条素材:62 个字符摊在 13 s = 4.8 字符/秒 → 必须被抓到。"""
import pytest

from app.library import quality
from app.library.asr_chunks import Chunk, Silence
from app.library.segment import Sentence
from app.speech.timed import Utterance


def sentence(chars: int, seconds: float) -> Sentence:
    return Sentence(0, round(seconds * 1000), "x" * chars)


@pytest.mark.parametrize("chars, seconds, outlier", [
    (62, 13.0, True),    # the reported case: 4.77 chars/s
    (62, 4.5, False),    # normal speech: 13.8 chars/s
    (62, 2.0, True),     # 31 chars/s: faster than anyone speaks
    (19, 20.0, False),   # too short to judge
    (100, 16.0, False),  # 6.25 chars/s: slow but real
    (100, 17.0, True),   # 5.88 chars/s
    (150, 6.0, False),   # exactly 25 chars/s
    (151, 6.0, True),
    (60, 0.0, True),     # no duration at all
])
def test_a_long_enough_sentence_outside_the_normal_speed_range_is_an_outlier(chars, seconds, outlier):
    assert quality.rate_outliers([sentence(chars, seconds)]) == int(outlier)


def test_outliers_are_counted_across_sentences():
    assert quality.rate_outliers([sentence(62, 4.5), sentence(62, 13.0), sentence(62, 2.0)]) == 2
    assert quality.rate_outliers([]) == 0


def test_an_estimated_chunk_that_is_mostly_silence_is_flagged():
    chunk = Chunk(0, 30_000, "some words that were said somewhere in here")
    silences = [Silence(0, 20_000)]
    assert quality.estimated_share(chunk, silences) == pytest.approx(1 / 3)
    assert quality.is_low_confidence([], [chunk], silences) is True
    assert quality.is_low_confidence([], [chunk], [Silence(0, 1000)]) is False  # 29 of 30 s are speech


def test_a_chunk_with_trusted_real_times_is_never_judged_by_its_speech_share():
    text = "Welcome back to the show everyone."
    chunk = Chunk(0, 30_000, text, [Utterance(text, 18_000, 21_200)])
    assert quality.is_low_confidence([sentence(34, 3.2)], [chunk], [Silence(0, 20_000)]) is False


def test_the_two_rules_combine_and_empty_input_is_fine():
    flat = [Chunk(0, 40_000, "x" * 40)]
    assert quality.is_low_confidence([sentence(62, 13.0)], flat, []) is True
    assert quality.is_low_confidence([sentence(62, 4.5)], flat, []) is False
    assert quality.is_low_confidence([], [], []) is False
```

  `server/tests/test_library_alignment.py`:

```python
"""流水线里的真实时间与 low_confidence(plan 2026-10-13-library-alignment):没有任何静音的素材(持续背景音乐)。"""
import shutil
import subprocess

import pytest

from app.library import limits, paths
from app.library.asr_chunks import Silence, load_state, plan_chunks
from app.library.media import Ffmpeg
from app.speech.timed import TimedText, Utterance
from tests.library_helpers import FakeAsr, FakeTimedAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_library_worker import UID, get, seed, sentences  # noqa: F401

LINES = ["Welcome back to the show everyone.", "Today we are talking about learning English.",
         "Let us begin with a simple question."]
TEXT = " ".join(LINES)
UTTS = (Utterance(LINES[0], 18_000, 21_200), Utterance(LINES[1], 22_000, 26_400), Utterance(LINES[2], 27_300, 30_100))
HELLO = "Hello and welcome to this lesson today."
THREE = "Now we practice speaking together today. Then we listen and repeat out loud now. After that we sing a short song."


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True)


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def test_real_times_beat_the_character_estimate_under_continuous_music(app):
    use_fakes(app, FakeTools(silences=[]), timed_asr=FakeTimedAsr([TimedText(TEXT, UTTS)]))
    item_id = await seed(app, fake_media(40_000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.sub_source, item.asr_seconds, item.low_confidence) == ("ready", "asr", 40, False)
    assert await sentences(app, item_id) == [(18_000, 21_200, LINES[0]), (22_000, 26_400, LINES[1]), (27_300, 30_100, LINES[2])]


async def test_without_times_the_same_audio_is_spread_flat_and_flagged(app):
    """The old behaviour, kept as the fallback: no silences, no times -> text spread over the whole hard-cut chunk."""
    use_fakes(app, FakeTools(silences=[]), asr=FakeAsr([TEXT]))
    item_id = await seed(app, fake_media(40_000, video=False))
    await process(app)
    out = await sentences(app, item_id)
    item = await get(app, item_id)
    assert out[0][0] == 0 and out[0][1] > 10_000  # the first sentence "starts" at 0 s although the voice starts at 18 s
    assert item.low_confidence is True  # ... which is exactly what the check exists to tell the learner


async def test_utterances_that_do_not_match_the_text_are_not_believed(app):
    wrong = TimedText(TEXT, (Utterance("Something else entirely different.", 18_000, 21_200),))
    use_fakes(app, FakeTools(silences=[]), timed_asr=FakeTimedAsr([wrong]))
    item_id = await seed(app, fake_media(40_000, video=False))
    await process(app)
    out = await sentences(app, item_id)
    assert out[0][0] == 0 and (await get(app, item_id)).low_confidence is True


async def test_trusted_and_estimated_chunks_mix_in_one_item(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)  # chunk order = call order
    first = TimedText(HELLO, (Utterance(HELLO, 5_000, 8_000),))
    use_fakes(app, FakeTools(silences=[Silence(29_800, 30_400)]), timed_asr=FakeTimedAsr([first, THREE]))
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    assert plan_chunks(60_000, [Silence(29_800, 30_400)])[0].end_ms == 30_100  # two chunks
    out = await sentences(app, item_id)
    assert out[0] == (5_000, 8_000, HELLO)  # real times
    assert len(out) == 4 and out[1][0] == 30_400 and out[-1][1] == 60_000  # the second chunk: speech span of the estimate


async def test_a_failed_chunk_keeps_the_finished_chunks_times_in_the_checkpoint(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)
    first = TimedText(HELLO, (Utterance(HELLO, 5_000, 8_000),))
    boom = RuntimeError("x")
    use_fakes(app, FakeTools(silences=[Silence(29_800, 30_400)]), timed_asr=FakeTimedAsr([first, boom, boom, boom]))
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    state = load_state(paths.tmp_dir(app.state.library.deps.data_dir, item_id) / "chunks.json")
    assert state[0].utterances == list(first.utterances) and state[1].text is None


async def test_low_confidence_is_exposed_by_the_api_and_false_for_subtitles(app, client, auth_headers):
    use_fakes(app, FakeTools(silences=[]), asr=FakeAsr([TEXT]))
    flat = await upload(client, auth_headers, fake_media(40_000, video=False), filename="a.m4a")
    await process(app)
    body = (await client.get(f"/api/library/items/{flat}", headers=auth_headers)).json()
    assert body["item"]["low_confidence"] is True and body["item"]["sub_source"] == "asr"
    listed = (await client.get("/api/library/items", headers=auth_headers)).json()["items"]
    assert [i["low_confidence"] for i in listed] == [True]
    from tests.library_helpers import SRT
    use_fakes(app)
    subs = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    assert (await client.get(f"/api/library/items/{subs}", headers=auth_headers)).json()["item"]["low_confidence"] is False


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
async def test_the_fixture_audio_really_has_no_silence_for_the_pipelines_detector(tmp_path):
    """A continuous tone stands in for background music: `silencedetect=noise=-35dB:d=0.35` finds nothing, so the old
    chunker hard-cuts at 40 s (the reported cause)."""
    src = tmp_path / "music.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "sine=f=220:d=40", str(src)], check=True, timeout=120)
    silences = await Ffmpeg().speech_wav(src, tmp_path / "speech.wav", 40_000, home=tmp_path)
    assert silences == []
    assert plan_chunks(100_000, silences)[0].end_ms == 40_000
```

- [ ] **Step 3:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_quality.py tests/test_library_alignment.py`。预期:`ModuleNotFoundError: app.library.quality`。

- [ ] **Step 4:`app/library/quality.py`(新):**

```python
"""句边界的合理性检查(spec §4.3.4、裁定 R-Q1;纯函数)。

不是判官,只是给学习者一个提示:这条素材的句边界可能不准(列表与播放页显示「可重新识别或微调」)。两条规则,任一成立即可疑:
1. 某个够长(≥ 20 个字符,含空格)的句子,字符速度 < 6 或 > 25 字符 / 秒。正常语速约 12–17,慢速教学音频约 7–9;
   用户那条素材 62 个字符被摊成 13 s = 4.8 字符 / 秒,会被抓到。
2. 某个**估算**块(识别服务没给可信的时间)里说话占比(`speech_span` / 块长)< 40%。
有可信真实时间的块不看说话占比:背景音乐 + 少量人声是合法的。
"""
from collections.abc import Sequence

from app.library.asr_chunks import Chunk, Silence, estimated_chunks, speech_span
from app.library.segment import Sentence

MIN_CHARS = 20
MIN_CPS = 6.0
MAX_CPS = 25.0
MIN_SPEECH_SHARE = 0.4


def rate_outliers(sentences: Sequence[Sentence]) -> int:
    count = 0
    for s in sentences:
        if len(s.text) < MIN_CHARS:
            continue
        seconds = (s.end_ms - s.start_ms) / 1000
        if seconds <= 0 or not MIN_CPS <= len(s.text) / seconds <= MAX_CPS:
            count += 1
    return count


def estimated_share(chunk: Chunk, silences: list[Silence]) -> float:
    s0, s1 = speech_span(chunk, silences)
    return (s1 - s0) / max(1, chunk.end_ms - chunk.start_ms)


def is_low_confidence(sentences: Sequence[Sentence], chunks: list[Chunk], silences: list[Silence]) -> bool:
    if rate_outliers(sentences) > 0:
        return True
    return any(estimated_share(c, silences) < MIN_SPEECH_SHARE for c in estimated_chunks(chunks))
```

- [ ] **Step 5:`pipeline.py`(Edit):**

  (a)导入:`from app.library import asr_chunks, limits, paths, segment, store, subtitles` 改为 `from app.library import asr_chunks, limits, paths, quality, segment, store, subtitles`;在 `from app.models import LibraryItem` 之后加 `from app.speech.timed import TimedText`。

  (b)`PipelineDeps` 末尾(`clock` 之后)加:

```python
    # plan 2026-10-13-library-alignment R-A7: user id -> (16 kHz WAV -> TimedText); None = use `transcriber` (text only)
    timed_transcriber: Callable[[int], Callable[[bytes], Awaitable[TimedText]]] | None = None
```

  (c)把 `_transcribe` 整个函数换成下面两个函数:

```python
def _untimed(transcribe: Callable[[bytes], Awaitable[str]]) -> Callable[[bytes], Awaitable[TimedText]]:
    async def timed(wav: bytes) -> TimedText:
        return TimedText(await transcribe(wav))

    return timed


async def _transcribe(deps: PipelineDeps, item: LibraryItem, media: Path, duration_ms: int, tmp: Path,
                      progress: Progress, t0: int) -> tuple[list[segment.Sentence], bool]:
    """Chunked recognition -> sentences, plus the `low_confidence` verdict (spec D5: the recognizer's real times first)."""
    settings = deps.settings()
    wav, state_path, silences_path = tmp / SPEECH_WAV, tmp / CHUNKS, tmp / SILENCES
    chunks = asr_chunks.load_state(state_path)
    silences: list[asr_chunks.Silence] | None = None
    try:
        silences = [asr_chunks.Silence(int(a), int(b)) for a, b in json.loads(silences_path.read_text("utf-8"))]
    except (OSError, ValueError, TypeError):
        silences = None
    if silences is None or not wav.is_file():
        silences = await deps.tools.speech_wav(media, wav, duration_ms, home=tmp)
        silences_path.write_text(json.dumps([[s.start_ms, s.end_ms] for s in silences]), encoding="utf-8")
    if chunks is None:
        chunks = asr_chunks.plan_chunks(duration_ms, silences)
        asr_chunks.save_state(state_path, chunks)
    need = sum(c.seconds for c in chunks if c.text is None)
    uid, day = str(item.user_id), limits.day_of(deps.clock())
    async with deps.sessionmaker() as s:
        if not await limits.reserve(s, limits.SCOPE_ASR, uid, day, need,
                                    settings.library_asr_minutes_daily_per_user * 60):
            raise LibraryError("quota")
        if not await limits.reserve(s, limits.SCOPE_ASR, limits.GLOBAL, day, need,
                                    settings.library_asr_minutes_global_daily * 60):
            await limits.release(s, limits.SCOPE_ASR, uid, day, need)
            raise LibraryError("quota")
    t1 = 95
    transcribe = (deps.timed_transcriber(item.user_id) if deps.timed_transcriber is not None
                  else _untimed(deps.transcriber(item.user_id)))

    async def read(chunk: asr_chunks.Chunk) -> bytes:
        return await asyncio.to_thread(asr_chunks.slice_wav, wav, chunk.start_ms, chunk.end_ms)

    async def on_chunk(done: int, total: int) -> None:
        await progress.set("transcribe", t0 + (t1 - t0) * done // max(1, total))

    await progress.set("transcribe", t0)
    try:
        spent = await asr_chunks.transcribe_chunks_timed(
            chunks, read=read, transcribe=transcribe,
            save=lambda c: asr_chunks.save_state(state_path, c), progress=on_chunk,
            concurrency=limits.ASR_CONCURRENCY, retries=limits.ASR_CHUNK_RETRIES)
    except BaseException:
        unspent = sum(c.seconds for c in chunks if c.text is None)
        async with deps.sessionmaker() as s:  # give back what was not transcribed (spec §6.4 step 7)
            await limits.release(s, limits.SCOPE_ASR, uid, day, unspent)
            await limits.release(s, limits.SCOPE_ASR, limits.GLOBAL, day, unspent)
        await _add_asr_seconds(deps, item.id, need - unspent)
        raise
    await _add_asr_seconds(deps, item.id, spent)
    timed_chunks = sum(1 for c in chunks if asr_chunks.usable_utterances(c))
    logger.info("library transcribed item=%s chunks=%d timed=%d seconds=%d", item.id, len(chunks), timed_chunks, spent)
    sentences = segment.build(asr_chunks.fragments(chunks, silences), adjust=asr_chunks.snapper(silences))
    return sentences, quality.is_low_confidence(sentences, chunks, silences)
```

  (d)`process` 里:把

```python
    sentences: list[segment.Sentence]
```

  换成

```python
    sentences: list[segment.Sentence]
    low_confidence = False
```

  把 ASR 分支

```python
    elif settings.library_asr_available:
        sentences, sub_source = await _transcribe(deps, item, media, duration_ms, tmp, progress, t0), "asr"
```

  换成

```python
    elif settings.library_asr_available:
        sentences, low_confidence = await _transcribe(deps, item, media, duration_ms, tmp, progress, t0)
        sub_source = "asr"
```

  并在最终写行处 `row.sub_source, row.status, row.stage, row.progress = sub_source, "ready", None, 100` 之后加一行 `row.low_confidence = low_confidence`。

- [ ] **Step 6:`worker.py` 的 `install`(Edit):** 导入 `from app.speech.asr import make_timed_transcriber, make_transcriber, shared_asr_gate`;在 `def transcriber(user_id)` 之后加

```python
    def timed_transcriber(user_id: int):
        s = settings()
        return make_timed_transcriber(state.http, s, "en", gate=shared_asr_gate(state, s), uid=str(user_id))
```

  并把 `PipelineDeps(...)` 里 `transcriber=transcriber, clock=utcnow)` 改为 `transcriber=transcriber, clock=utcnow,\n                        timed_transcriber=timed_transcriber)`。

- [ ] **Step 7:跑测试:** `cd server && uv run pytest -q tests/test_library_quality.py tests/test_library_alignment.py tests/test_library_worker.py tests/test_library_asr_chunks.py tests/test_library_privacy.py tests/test_architecture.py`。既有 `test_library_worker.py`(特别是 `test_transcription_path_counts_seconds_and_snaps_to_silences` 与重试用例)必须不改而绿:`use_fakes(app, …, asr)` 现在会把 `timed_transcriber` 置 `None`,走 `_untimed`。
- [ ] **Step 8:提交:**

```
feat(server): low_confidence check and timed transcription in the library pipeline

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 5(条件):Whisper `verbose_json` 的句子时间

**只在 Task 0 记录了「Whisper verbose_json `segments`:有」时做**;结果是「没有 / 不适用 / 未运行」就**跳过本任务**并在结果文档里写明(chat 模式协议上没有时间)。

**Files:** Modify `server/app/speech/stt.py`、`server/app/speech/asr.py`;Create `server/tests/test_stt_timed.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_stt_timed.py`:

```python
"""Whisper verbose_json 的 segments → Utterance(秒 → 毫秒);网关不认 verbose_json(400 / 415 / 422)时退回普通 json。"""
import httpx
import pytest

from app.speech.stt import pcm_to_wav, transcribe_wav, transcribe_wav_timed
from app.speech.timed import TimedText, Utterance
from tests.conftest import make_settings

WHISPER = "https://whisper.test/v1/audio/transcriptions"
ARK = "https://ark.test/api/v3/chat/completions"
WAV = pcm_to_wav(b"\x00\x00" * 160)
VERBOSE = {"text": " Hello there. Bye. ", "segments": [
    {"id": 0, "start": 0.0, "end": 1.2, "text": " Hello there."}, {"id": 1, "start": 1.5, "end": 2.04, "text": " Bye."}]}


async def test_segments_become_utterances_in_milliseconds(respx_mock):
    route = respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json=VERBOSE))
    async with httpx.AsyncClient() as http:
        got = await transcribe_wav_timed(http, make_settings(), WAV, "en")
    assert got == TimedText("Hello there. Bye.", (Utterance("Hello there.", 0, 1200), Utterance("Bye.", 1500, 2040)))
    assert b"verbose_json" in route.calls.last.request.content


async def test_a_reply_without_segments_is_text_only(respx_mock):
    respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json={"text": "Hi."}))
    async with httpx.AsyncClient() as http:
        assert await transcribe_wav_timed(http, make_settings(), WAV) == TimedText("Hi.", ())


@pytest.mark.parametrize("status", [400, 415, 422])
async def test_a_gateway_that_rejects_verbose_json_gets_the_plain_request_once(respx_mock, status):
    route = respx_mock.post(WHISPER).mock(side_effect=[httpx.Response(status, json={"error": "x"}),
                                                       httpx.Response(200, json={"text": "Plain."})])
    async with httpx.AsyncClient() as http:
        assert await transcribe_wav_timed(http, make_settings(), WAV) == TimedText("Plain.", ())
    assert route.call_count == 2 and b"verbose_json" not in route.calls.last.request.content


async def test_chat_mode_has_no_times_by_protocol(respx_mock):
    settings = make_settings(upstream_whisper_mode="chat", upstream_whisper_base_url="https://ark.test/api/v3",
                             upstream_whisper_key="k", upstream_whisper_model="m")
    respx_mock.post(ARK).mock(return_value=httpx.Response(200, json={"choices": [{"message": {"content": "From chat."}}]}))
    async with httpx.AsyncClient() as http:
        assert await transcribe_wav_timed(http, settings, WAV) == TimedText("From chat.", ())


async def test_the_plain_transcriber_is_unchanged(respx_mock):
    route = respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json={"text": " whisper text "}))
    async with httpx.AsyncClient() as http:
        assert await transcribe_wav(http, make_settings(), WAV, "en") == "whisper text"
    assert b"verbose_json" not in route.calls.last.request.content
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_stt_timed.py`(`ImportError: transcribe_wav_timed`)。

- [ ] **Step 3:`stt.py`(Edit):** 导入加 `from app.speech.timed import TimedText, Utterance`;把 `transcribe_wav` 整个函数换成下面三个(普通请求体与原来逐字相同:`response_format: json`、`language`、计量):

```python
class VerboseUnsupported(Exception):
    """The gateway refused `response_format=verbose_json` (400 / 415 / 422): ask again for plain json."""


async def _whisper_json(http: httpx.AsyncClient, settings: Settings, wav: bytes, language: str | None,
                        response_format: str) -> dict:
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")
    data = {"model": "whisper-1", "response_format": response_format}
    if language:
        data["language"] = language
    units, unit = metering.audio_units(wav)
    provider, timer, status = metering.provider_of(settings.upstream_whisper_base_url), metering.Timer(), 0
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions",
            files={"file": ("audio.wav", wav, "audio/wav")}, data=data,
            headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"}, timeout=TIMEOUT,
        )
        status = upstream.status_code
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    finally:
        metering.record("stt", provider, "whisper-1", status, timer.ms(), units_in=units, unit=unit)
    check_upstream_auth(upstream.status_code)
    if response_format != "json" and upstream.status_code in (400, 415, 422):
        raise VerboseUnsupported()
    if not upstream.is_success:
        raise HTTPException(502, "Upstream unavailable")
    try:
        payload = upstream.json()
    except ValueError:
        raise HTTPException(502, "Upstream unavailable")
    if not isinstance(payload, dict):
        raise HTTPException(502, "Upstream unavailable")
    return payload


def _text_of(payload: dict) -> str:
    text = payload.get("text")
    if not isinstance(text, str):
        raise HTTPException(502, "Upstream unavailable")
    return text.strip()


async def transcribe_wav(http: httpx.AsyncClient, settings: Settings, wav: bytes, language: str | None = "en") -> str:
    if settings.upstream_whisper_mode == "chat":
        return await transcribe_chat(http, settings, wav, "wav", language)
    return _text_of(await _whisper_json(http, settings, wav, language, "json"))


def _segments(payload: dict) -> tuple[Utterance, ...]:
    """Whisper `segments[{start, end, text}]` in seconds -> `Utterance`s in ms."""
    raw = payload.get("segments")
    out: list[Utterance] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, start, end = item.get("text"), item.get("start"), item.get("end")
        if not isinstance(text, str) or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in (start, end)):
            continue
        text = " ".join(text.split())
        if text and start >= 0 and end > start:
            out.append(Utterance(text, round(start * 1000), round(end * 1000)))
    return tuple(out)


async def transcribe_wav_timed(http: httpx.AsyncClient, settings: Settings, wav: bytes,
                               language: str | None = "en") -> TimedText:
    """`transcribe_wav` plus segment times when the Whisper-compatible gateway returns them (`verbose_json`). `chat` mode
    has no times by protocol; a gateway that rejects `verbose_json` gets the plain request once."""
    if settings.upstream_whisper_mode == "chat":
        return TimedText(await transcribe_chat(http, settings, wav, "wav", language))
    try:
        payload = await _whisper_json(http, settings, wav, language, "verbose_json")
    except VerboseUnsupported:
        return TimedText(await transcribe_wav(http, settings, wav, language))
    return TimedText(_text_of(payload), _segments(payload))
```

  注意原 `transcribe_wav` 在 `base_url` 为空时抛 503 的**顺序**:原函数里 `chat` 分支先判断、再判断 `base_url`;新代码 `chat` 先判,`_whisper_json` 里再判 `base_url`,行为一致。

- [ ] **Step 4:`asr.py`(Edit):** 导入 `from app.speech.stt import pcm_to_wav, transcribe_wav` 末尾加 `transcribe_wav_timed`;`make_timed_transcriber` 里把 `return TimedText(await transcribe_wav(http, settings, wav, language))` 换成 `return await transcribe_wav_timed(http, settings, wav, language)`。并把 `tests/test_asr_timed.py` 里回落到 chat 的三个用例不用改(chat 模式仍是 `TimedText(text, ())`)。
- [ ] **Step 5:跑测试:** `cd server && uv run pytest -q tests/test_stt_timed.py tests/test_stt_prompt.py tests/test_asr_timed.py tests/test_asr_buffered.py tests/test_ai_audio_volc_stream.py tests/test_architecture.py`(既有 `test_stt_prompt.py` 必须不改而绿)。
- [ ] **Step 6:提交:**

```
feat(server): Whisper verbose_json segment times for timed transcription

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 6:重新识别(端点、状态机、额度)

**Files:** Modify `server/app/library/errors.py`、`limits.py`、`store.py`、`worker.py`(只 `_failed`)、`server/app/routers/library.py`、`server/tests/test_library_privacy.py`;Create `server/tests/test_library_reprocess.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_reprocess.py`:

```python
"""POST /api/library/items/{id}/reprocess(spec D7、裁定 R-R1…R-R6):状态机、额度、失败 / 取消回到原状。"""
import logging

import pytest
from sqlalchemy import select

from app.library import limits, paths
from app.models import DailyUsage, LibraryItem
from tests.library_helpers import SRT, FakeAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_library_privacy import leaked

OLD = ["Old words are spoken here today.", "More old words follow after that."]
FIRST = " ".join(OLD)
NEW = ["New words are spoken here now.", "And more new words follow after that."]
FRESH = " ".join(NEW)


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True)


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


def data_dir(app):
    return app.state.library.deps.data_dir


async def asr_item(app, client, h, text: str = FIRST) -> str:
    use_fakes(app, FakeTools(), FakeAsr([text]))
    item_id = await upload(client, h, fake_media(6000, video=False), filename="Pod.m4a", title="Pod")
    await process(app)
    return item_id


async def detail(client, h, item_id) -> dict:
    return (await client.get(f"/api/library/items/{item_id}", headers=h)).json()


def reprocess(client, h, item_id):
    return client.post(f"/api/library/items/{item_id}/reprocess", headers=h)


async def row(app, item_id) -> LibraryItem:
    async with app.state.sessionmaker() as s:
        return await s.get(LibraryItem, item_id)


async def test_only_a_ready_automatically_recognized_item_can_be_reprocessed(app, client, auth_headers):
    h = auth_headers
    use_fakes(app)
    subs = await upload(client, h, fake_media(), subs=SRT)
    waiting = await upload(client, h, fake_media(), subs=SRT)  # queued: not processed yet
    uploading = await upload(client, h, fake_media(), complete=False)
    await process(app)  # one worker round (concurrency 1): `subs` becomes ready with uploaded subtitles, `waiting` may still be queued
    expected = (409, {"error": "Item cannot be reprocessed"})
    for item_id in (subs, waiting, uploading):
        r = await reprocess(client, h, item_id)
        assert (r.status_code, r.json()) == expected, item_id
    assert (await reprocess(client, h, "0f0e0d0c-0b0a-4908-8706-050403020100")).status_code == 404
    bob = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    other = {"Authorization": f"Bearer {bob.json()['access_token']}"}
    mine = await asr_item(app, client, h)
    assert (await reprocess(client, other, mine)).status_code == 404
    assert (await client.post(f"/api/library/items/{mine}/reprocess")).status_code == 401


async def test_reprocess_replaces_the_sentences_keeps_title_and_resume_and_spends_the_allowance_again(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await client.patch(f"/api/library/items/{item_id}", headers=h, json={"title": "My pod", "resume_ms": 2000, "resume_idx": 1})
    assert [s["text"] for s in (await detail(client, h, item_id))["segments"]] == OLD
    r = await reprocess(client, h, item_id)
    assert r.status_code == 200
    item = r.json()["item"]
    assert (item["status"], item["progress"], item["error_kind"], item["title"], item["resume_idx"]) == ("queued", 0, None, "My pod", 1)
    assert (await detail(client, h, item_id))["segments"] == []  # not openable while it is re-recognized
    use_fakes(app, FakeTools(), FakeAsr([FRESH]))
    await process(app)
    after = await detail(client, h, item_id)
    assert (after["item"]["status"], after["item"]["sub_source"]) == ("ready", "asr")
    assert [s["text"] for s in after["segments"]] == NEW
    assert (after["item"]["title"], after["item"]["resume_ms"], after["item"]["resume_idx"]) == ("My pod", 2000, 1)
    async with app.state.sessionmaker() as s:
        assert (await s.get(LibraryItem, item_id)).asr_seconds == 12
        counts = {r.subject: r.count for r in (await s.scalars(select(DailyUsage).where(DailyUsage.scope == "library_asr"))).all()}
    assert set(counts.values()) == {12}


async def test_reprocess_clears_a_stale_checkpoint(app, client, auth_headers):
    item_id = await asr_item(app, client, auth_headers)
    tmp = paths.tmp_dir(data_dir(app), item_id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "chunks.json").write_text("STALE", encoding="utf-8")
    assert (await reprocess(client, auth_headers, item_id)).status_code == 200
    assert not tmp.exists()


async def test_a_second_request_while_it_runs_is_refused(app, client, auth_headers):
    item_id = await asr_item(app, client, auth_headers)
    assert (await reprocess(client, auth_headers, item_id)).status_code == 200
    r = await reprocess(client, auth_headers, item_id)
    assert (r.status_code, r.json()) == (409, {"error": "Item cannot be reprocessed"})


async def test_a_failed_reprocess_gives_the_item_back_as_it_was(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await reprocess(client, h, item_id)
    use_fakes(app, FakeTools(fail={"speech_wav": "corrupt"}), FakeAsr([]))
    await process(app)
    body = await detail(client, h, item_id)
    assert (body["item"]["status"], body["item"]["error_kind"], body["item"]["seg_count"], body["item"]["progress"]) == ("ready", "corrupt", 2, 100)
    assert [s["text"] for s in body["segments"]] == OLD
    stored = await row(app, item_id)
    assert (data_dir(app) / stored.media_path).is_file() and not paths.tmp_dir(data_dir(app), item_id).exists()
    r = await reprocess(client, h, item_id)  # the note goes away with the next attempt
    assert r.json()["item"]["error_kind"] is None


async def test_a_transient_failure_keeps_re_recognizing_and_retries(app, client, auth_headers, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await reprocess(client, h, item_id)
    use_fakes(app, FakeTools(), FakeAsr([RuntimeError("x")] * 3))
    await process(app)
    item = (await detail(client, h, item_id))["item"]
    assert (item["status"], item["error_kind"]) == ("queued", "upstream")  # retry with backoff, still re-recognizing
    async with app.state.sessionmaker() as s:
        stored = await s.get(LibraryItem, item_id)
        stored.next_run_at = None
        await s.commit()
    use_fakes(app, FakeTools(), FakeAsr([FRESH]))
    await process(app)
    after = await detail(client, h, item_id)
    assert after["item"]["status"] == "ready" and [s["text"] for s in after["segments"]] == NEW


async def test_reprocess_respects_the_daily_recognition_allowance_without_spending_it(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)  # 6 s spent today
    app.state.settings = app.state.settings.model_copy(update={"library_asr_minutes_daily_per_user": 0})
    r = await reprocess(client, h, item_id)
    assert (r.status_code, r.json()) == (429, {"error": "Daily transcription limit reached"})
    assert (await detail(client, h, item_id))["item"]["status"] == "ready"
    app.state.settings = app.state.settings.model_copy(update={"library_asr_minutes_daily_per_user": 60,
                                                               "library_asr_minutes_global_daily": 0})
    assert (await reprocess(client, h, item_id)).status_code == 429
    app.state.settings = app.state.settings.model_copy(update={"library_asr_minutes_global_daily": 600})
    assert (await reprocess(client, h, item_id)).status_code == 200
    async with app.state.sessionmaker() as s:
        counts = {r.subject: r.count for r in (await s.scalars(select(DailyUsage).where(DailyUsage.scope == "library_asr"))).all()}
    assert set(counts.values()) == {6}  # the pre-check spends nothing; the pipeline reserves when it runs


async def test_reprocess_needs_transcription_and_the_media_file(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    app.state.settings = app.state.settings.model_copy(update={"library_asr_enabled": False})
    r = await reprocess(client, h, item_id)
    assert (r.status_code, r.json()) == (503, {"error": "Transcription is not available"})
    app.state.settings = app.state.settings.model_copy(update={"library_asr_enabled": True})
    (data_dir(app) / (await row(app, item_id)).media_path).unlink()
    r = await reprocess(client, h, item_id)
    assert (r.status_code, r.json()) == (409, {"error": "Nothing left to retry"})


async def test_canceling_a_reprocess_gives_the_item_back_with_its_media(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await reprocess(client, h, item_id)
    r = await client.post(f"/api/library/items/{item_id}/cancel", headers=h)
    assert r.status_code == 200 and r.json()["item"]["status"] == "ready"
    body = await detail(client, h, item_id)
    assert [s["text"] for s in body["segments"]] == OLD
    assert (data_dir(app) / (await row(app, item_id)).media_path).is_file()
    assert await app.state.library.run_once() == 0  # nothing is left in the queue


async def test_deleting_an_item_that_is_being_reprocessed_removes_everything(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    await reprocess(client, h, item_id)
    assert (await client.delete(f"/api/library/items/{item_id}", headers=h)).json() == {"deleted": True}
    assert not paths.item_dir(data_dir(app), uid, item_id).exists() and await row(app, item_id) is None


async def test_replacing_the_subtitles_of_a_ready_item_clears_the_failure_note_and_the_flag(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    async with app.state.sessionmaker() as s:
        stored = await s.get(LibraryItem, item_id)
        stored.error_kind, stored.low_confidence = "corrupt", True
        await s.commit()
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    item = r.json()["item"]
    assert (item["sub_source"], item["error_kind"], item["low_confidence"]) == ("uploaded", None, False)


async def test_reprocess_never_logs_text(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = auth_headers
    item_id = await asr_item(app, client, h, "SECRET-TRANSCRIPT is spoken here today. And more words follow after that.")
    await reprocess(client, h, item_id)
    use_fakes(app, FakeTools(), FakeAsr([RuntimeError("SECRET-UPSTREAM")] * 3))
    await process(app)
    async with app.state.sessionmaker() as s:
        stored = await s.get(LibraryItem, item_id)
        stored.next_run_at = None
        await s.commit()
    use_fakes(app, FakeTools(fail={"speech_wav": "corrupt"}))
    await process(app)
    await reprocess(client, h, item_id)
    await client.post(f"/api/library/items/{item_id}/cancel", headers=h)
    assert any("library" in r.name for r in caplog.records)
    assert leaked(caplog) == []
```

  `tests/test_library_privacy.py`:`ROUTES` 集合里 `("POST", "/api/library/items/{item_id}/cancel"),` 之后加 `("POST", "/api/library/items/{item_id}/reprocess"),`。

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_reprocess.py tests/test_library_privacy.py`(404 / 路由不存在,`ROUTES <= seen` 失败)。

- [ ] **Step 3:`errors.py`:** `API_ERRORS` 里 `"not_active": ...` 之后加:

```python
    # 重新识别(plan 2026-10-13-library-alignment R-P)
    "not_reprocessable": (409, "Item cannot be reprocessed"),
    "asr_unavailable": (503, "Transcription is not available"),
    "asr_daily": (429, "Daily transcription limit reached"),
```

- [ ] **Step 4:`limits.py`:** 在 `item_count` 之前加:

```python
async def asr_seconds_left(session: AsyncSession, user_id: int, settings, now: datetime) -> int:
    """Seconds of recognition still available today: the smaller of the user's and the site-wide allowance. Reads only
    (the real `reserve` happens in the pipeline when the job runs)."""
    day = day_of(now)
    mine = await usage.remaining(session, SCOPE_ASR, str(user_id), day, settings.library_asr_minutes_daily_per_user * 60)
    site = await usage.remaining(session, SCOPE_ASR, GLOBAL, day, settings.library_asr_minutes_global_daily * 60)
    return min(mine, site)
```

- [ ] **Step 5:`store.py`(Edit):**

  (a)`fail` 换成:

```python
async def fail(session: AsyncSession, item_id: str, kind: str, *, retry_at: datetime | None, now: datetime) -> bool:
    """A failed job: transient with retries left -> back to `queued` with `next_run_at`; else `failed`.
    A re-recognition (the item still has its finished sentences, R-R2) is given back as it was instead: `ready`, with
    `error_kind` kept so the card can say the attempt did not work (R-R3)."""
    values = dict(error_kind=kind, updated_at=now, stage=None)
    if retry_at is not None:
        values.update(status="queued", next_run_at=retry_at, attempts=LibraryItem.attempts + 1)
    else:
        kept = int(await session.scalar(select(LibraryItem.seg_count).where(LibraryItem.id == item_id)) or 0)
        if kept > 0:
            values.update(status="ready", progress=100, attempts=0, next_run_at=None)
        else:
            values.update(status="failed", next_run_at=None)
    result = await session.execute(update(LibraryItem).where(LibraryItem.id == item_id,
                                                             LibraryItem.status == "processing").values(**values))
    await session.commit()
    return result.rowcount == 1
```

  (b)`cancel_item` 换成(新增 `_cancel_reprocess`;原有取消逻辑原样保留在第二段):

```python
async def _cancel_reprocess(session: AsyncSession, app, item: LibraryItem) -> bool:
    """Canceling a re-recognition gives the item back as it was (R-R3): `ready`, with its media and sentences."""
    done = await session.execute(update(LibraryItem).where(
        LibraryItem.id == item.id, LibraryItem.status.in_(("queued", "processing")))
        .values(status="ready", stage=None, progress=100, error_kind=None, attempts=0, next_run_at=None,
                updated_at=utcnow()))
    await session.commit()
    if done.rowcount != 1:
        return False
    worker = app.state.library
    await worker.cancel(item.id)
    paths.remove_tree(paths.tmp_dir(worker.deps.data_dir, item.id))
    await session.refresh(item)
    return True


async def cancel_item(session: AsyncSession, app, item: LibraryItem) -> bool:
    """spec §6.5: an uploading / queued / processing item becomes `canceled`, its job and subprocesses stop, its
    staging and media files go, its tickets die. False = it was not active (nothing changed). Commits.
    A re-recognition (`seg_count > 0`) is reverted to `ready` instead and keeps its files (`_cancel_reprocess`).
    Shared by `POST /api/library/items/{id}/cancel` and the admin console (plan A)."""
    if item.seg_count > 0 and item.status in ("queued", "processing"):
        return await _cancel_reprocess(session, app, item)
    done = await session.execute(update(LibraryItem).where(LibraryItem.id == item.id, LibraryItem.status.in_(ACTIVE))
                                 .values(status="canceled", stage=None, updated_at=utcnow()))
    await session.commit()
    if done.rowcount != 1:
        return False
    worker = app.state.library
    await worker.cancel(item.id)
    worker.tickets.revoke_item(item.id)
    paths.remove_item_files(app.state.library.deps.data_dir, item.user_id, item.id)
    await session.execute(update(LibraryItem).where(LibraryItem.id == item.id).values(
        media_path=None, poster_path=None, library_bytes=0, error_kind=None, source_url=None))
    await session.commit()
    await session.refresh(item)
    return True
```

- [ ] **Step 6:`worker.py` 的 `_failed`(Edit):** 把

```python
            await store.fail(s, item_id, kind, retry_at=retry_at, now=now)
        if retry_at is None and kind in DROP_STAGING:
            self._drop_staging(item_id)
```

  换成

```python
            await store.fail(s, item_id, kind, retry_at=retry_at, now=now)
            await s.refresh(row)
            restored = row.status == "ready"  # a failed re-recognition: the item is playable again (R-R3)
        if retry_at is None and (kind in DROP_STAGING or restored):
            self._drop_staging(item_id)
```

- [ ] **Step 7:`routers/library.py`(Edit):** 顶部标准库导入加 `import math`(`import logging` 之前或之后均可)。在 `cancel_item` 路由之后(`@router.put("/items/{item_id}/subtitles")` 之前)加:

```python
@router.post("/items/{item_id}/reprocess")
async def reprocess_item(request: Request, item_id: ItemId, user: User = Depends(limited_user),
                         settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    """D7:重新识别一条 `ready` 的自动识别条目(裁定 R-R1…R-R6)。旧句子留到新句子写入(失败 / 取消回到原状);
    预检今天的识别额度(不扣,真实预留在流水线里);陈旧的 `_tmp`(chunks.json 等)在锁内清掉再入队。"""
    item = await owned(session, user, item_id)
    if item.status != "ready" or item.sub_source != "asr" or item.seg_count <= 0:
        raise fail("not_reprocessable")
    if not settings.library_available:
        raise fail("unavailable")
    if not settings.library_asr_available:
        raise fail("asr_unavailable")
    data_dir = settings.resolved_data_dir
    if not item.media_path or not (data_dir / item.media_path).is_file():
        raise fail("no_material")
    now = utcnow()
    need = max(1, math.ceil((item.duration_ms or 0) / 1000))
    if await limits.asr_seconds_left(session, user.id, settings, now) < need:
        raise fail("asr_daily")
    async with runtime(request).upload_lock(item.id):
        await session.refresh(item)
        if item.status != "ready":
            raise fail("not_reprocessable")
        paths.remove_tree(paths.tmp_dir(data_dir, item.id))
        item.status, item.stage, item.progress, item.error_kind = "queued", None, 0, None
        item.attempts, item.next_run_at, item.updated_at = 0, None, now
        await session.commit()
    runtime(request).wake()
    logger.info("library reprocess queued item=%s", item.id)
    return {"item": store.item_out(item)}
```

  并在 `put_item_subtitles` 的 `ready` 分支里把 `item.sub_source, item.updated_at = "uploaded", utcnow()` 换成 `item.sub_source, item.error_kind, item.low_confidence, item.updated_at = "uploaded", None, False, utcnow()`。

- [ ] **Step 8:跑测试:** `cd server && uv run pytest -q tests/test_library_reprocess.py tests/test_library_privacy.py tests/test_library_api.py tests/test_library_worker.py tests/test_library_store.py tests/test_admin_library.py tests/test_library_alignment.py tests/test_architecture.py`。注意 `test_library_contract.py` 此时会因 `errors` 键新增而失败——由 T7 重录,**本任务不跑它**。
- [ ] **Step 9:提交:**

```
feat(server): reprocess a library item's recognition (D7) with quota pre-check and revert-on-failure

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 7:契约夹具重录 + 网页类型 / 契约测试

**Files:** Modify `server/tests/test_library_contract.py`、`server/tests/fixtures/library_contract.json`(重录)、`web/src/features/library/library-api.ts`、`library-contract.test.ts`、`test-fixtures.ts`、`item-card.test.tsx`、`locales/en.json`、`locales/zh-CN.json`。

- [ ] **Step 1:服务端契约测试加录制。** `test_library_contract.py`:

  (a)导入行改为 `from tests.library_helpers import SRT, FakeAsr, enable, fake_media, library_settings, process, use_fakes`;`settings_overrides` 改为 `return library_settings(tmp_path, library_ai_enabled=True, library_asr_enabled=True)`。

  (b)在 `out["cancel"] = ...` 与 `out["delete"] = ...` 之间加:

```python
    use_fakes(app, asr=FakeAsr(["Hello there, my friend. How are you doing today?"]))
    asr_id = await upload(client, h, fake_media(6000, video=False), filename="Pod.m4a", title="Pod")
    await process(app)
    out["reprocess_error"] = (await client.post(f"/api/library/items/{item_id}/reprocess", headers=h)).json()
    out["reprocess"] = (await client.post(f"/api/library/items/{asr_id}/reprocess", headers=h)).json()
```

  并把导入里的 `upload` 补进:`from tests.library_helpers import SRT, FakeAsr, enable, fake_media, library_settings, process, upload, use_fakes`(本文件原来没有导入 `upload`)。末尾 `assert out["item_detail"]...` 之后再加 `assert out["reprocess"]["item"]["status"] == "queued" and out["reprocess_error"] == {"error": "Item cannot be reprocessed"}`。

- [ ] **Step 2:重录并核对 diff。** `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_library_contract.py`,再不带变量跑一次 `uv run pytest -q tests/test_library_contract.py` 确认绿。`git diff --stat server/tests/fixtures/library_contract.json` 后**逐项读 diff**,只应出现:每个条目对象多一个 `"low_confidence": false`(`reprocess` 里的条目也是)、`errors` 多 3 条(`asr_daily`、`asr_unavailable`、`not_reprocessable`)、`config.asr` 可能 `false → true`、新增 `reprocess` / `reprocess_error` 两个键。出现别的变化先查原因,不要直接提交。

- [ ] **Step 3:网页类型与测试夹具。**
  - `library-api.ts`:`LibraryItem` 里 `hasPoster: boolean;` 之后加 `/** D5:句边界可能不准(服务端合理性检查;重新识别后重算) */\n  lowConfidence: boolean;`。
  - `test-fixtures.ts`:`itemRaw` 的对象里 `has_poster: true,` 之后加 `low_confidence: false,`(同一行风格:`has_poster: true, low_confidence: false,`)。
  - `item-card.test.tsx`:`base` 里 `hasPoster: true,` 之后加 `lowConfidence: false,`。
  - `library-api.ts` 的 `LIBRARY_SERVER_ERRORS` 里 `"Nothing left to retry": ...` 之后加:

```ts
  "Item cannot be reprocessed": "web.library.errors.notReprocessable",
  "Transcription is not available": "web.library.errors.asrUnavailable",
  "Daily transcription limit reached": "web.library.errors.asrLimited",
```

  - 两个 `locales/*.json` 的 `errors` 里(锚点:`"aiUnavailable": ...,` 那一行,第 130 行)之后分别加(zh-CN / en;JSON 里这行以逗号结尾,后面是 `"kind": {`):

```json
        "notReprocessable": "这条素材现在不能重新识别。",
        "asrUnavailable": "本服务器没有开启自动转写。",
        "asrLimited": "今天的自动转写额度已用完,明天再试。",
```

```json
        "notReprocessable": "This item cannot be re-recognized right now.",
        "asrUnavailable": "Automatic transcription is not enabled on this server.",
        "asrLimited": "Today's transcription allowance is used up. Try again tomorrow.",
```

- [ ] **Step 4:网页契约测试。** `library-contract.test.ts`:`ITEM` 键表里 `createdAt: true, lastOpenedAt: true,` 之前加 `lowConfidence: true,`(键序无所谓);在 `it("every fixed server error text is translated ..."` 之前加:

```ts
  it("reprocess returns the queued item, and refuses a non-recognized item with the fixed text (D7)", () => {
    const queued = unwrapItem(cc<unknown>(c.reprocess));
    expect(keysOf(queued)).toEqual(keys(ITEM));
    expect(queued.status).toBe("queued");
    expect(queued.lowConfidence).toBe(false);
    expect(c.reprocess_error).toEqual({ error: "Item cannot be reprocessed" });
  });

  it("every item carries the low_confidence flag as a boolean", () => {
    const page = cc<{ items: LibraryItem[] }>(c.items);
    for (const item of page.items) expect(typeof item.lowConfidence).toBe("boolean");
    expect(typeof unwrapDetail(cc<unknown>(c.item_detail)).lowConfidence).toBe("boolean");
  });
```

- [ ] **Step 5:跑测试:** `cd server && uv run pytest -q tests/test_library_contract.py tests/test_architecture.py`;`cd web && yarn web:typecheck && yarn vitest run src/features/library/library-contract.test.ts src/features/library/library-api.test.ts src/features/library/locales.test.ts src/features/library/item-card.test.tsx`(`locales.test.ts` 要求 en / zh 键与占位符一致)。
- [ ] **Step 6:提交:**

```
test(web): record the reprocess contract and add lowConfidence to the library item type

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 8:网页:重新识别菜单、确认、低可信 / 失败提示(卡片与列表页)

**Files:** Create `web/src/features/library/item-menu.tsx`、`item-menu.test.tsx`;Modify `library-api.ts`、`library-api.test.ts`、`item-card.tsx`、`item-card.test.tsx`、`library-list-page.tsx`、`library-list-page.test.tsx`、`locales/en.json`、`locales/zh-CN.json`。

- [ ] **Step 1:文案(先加,测试要用)。** 两个 locales(`web.library` 下),用单行锚点 Edit:
  - 锚点 `"progress": "{{stage}} · {{pct}}%",`(第 29 行)之后加一行:zh `"lowConfidence": "句边界可能不准,可重新识别或微调。",` / en `"lowConfidence": "Sentence boundaries may be off. You can re-recognize or fine-tune them.",`
  - `card` 对象:锚点 zh `"uploadFailed": "上传中断:{{reason}}"` / en `"uploadFailed": "Upload stopped: {{reason}}"`(最后一项,无逗号)改成带逗号并追加:

```json
        "uploadFailed": "上传中断:{{reason}}",
        "more": "更多",
        "menuTitle": "素材操作",
        "menuDescription": "对这条素材的更多操作。",
        "reprocess": "重新识别",
        "lowConfidenceBadge": "边界可能不准",
        "reprocessFailed": "重新识别没有成功,原来的句子还在:{{reason}}"
```

```json
        "uploadFailed": "Upload stopped: {{reason}}",
        "more": "More",
        "menuTitle": "Item actions",
        "menuDescription": "More actions for this item.",
        "reprocess": "Re-recognize",
        "lowConfidenceBadge": "Boundaries may be off",
        "reprocessFailed": "Re-recognition did not work; your earlier sentences are still here: {{reason}}"
```

  - 在 `"resume": { "mismatch": ... },` 那行(第 45 行)**之前**加(zh / en):

```json
      "confirmReprocess": {
        "title": "重新识别这条素材?",
        "body": "会重新转写整段音频,并再用掉今天的自动转写额度。你对句子文字和时间的修改、已生成的译文会被替换。重新识别期间这条素材暂时不能打开;如果失败,会保留现在的句子。",
        "confirm": "重新识别"
      },
```

```json
      "confirmReprocess": {
        "title": "Re-recognize this item?",
        "body": "The whole audio is transcribed again and uses today's transcription allowance once more. Your edits to sentence text and times, and any translations, are replaced. The item cannot be opened while it runs; if it fails, your current sentences are kept.",
        "confirm": "Re-recognize"
      },
```

  - `toast`:锚点 `"retrying": "正在重试。"` / `"retrying": "Trying again."`(最后一项)改成带逗号并追加 zh `"reprocessing": "已开始重新识别。"` / en `"reprocessing": "Re-recognition started."`。

- [ ] **Step 2:API。** `library-api.ts` 在 `cancelItem` 之后加:

```ts
/** D7:重新识别一条自动识别的条目(旧句子保留到新句子写入;额度不足 429 / 不可重新识别 409 / 没开转写 503)。 */
export async function reprocessItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("POST", `${itemPath(id)}/reprocess`));
}
```

  `library-api.test.ts`:导入加 `reprocessItem`;在「sends patches, retries, cancels and deletes ...」用例之后加:

```ts
  it("reprocesses with a bodyless POST and unwraps the queued item", async () => {
    const { mock, api } = client({
      "POST /api/library/items/i1/reprocess": () => json({ item: itemRaw({ status: "queued", progress: 0, sub_source: "asr" }) }),
    });
    const next = await reprocessItem(api, "i1");
    expect(next).toMatchObject({ id: "i1", status: "queued", subSource: "asr", lowConfidence: false });
    expect(mock.calls[0].url.search).toBe("");
    expect(mock.calls[0].body ?? null).toBeNull();
  });

  it("maps the three reprocess errors to their texts", () => {
    for (const text of ["Item cannot be reprocessed", "Transcription is not available", "Daily transcription limit reached"]) {
      expect(LIBRARY_SERVER_ERRORS).toHaveProperty([text]);
    }
  });
```

- [ ] **Step 3:菜单组件测试(先红)** `item-menu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "./test-i18n";
import { ItemMenu } from "./item-menu";
import type { LibraryItem } from "./library-api";

const item: LibraryItem = {
  id: "i1", kind: "audio", source: "upload", title: "Pod", status: "ready", stage: null, progress: 100, errorKind: null, durationMs: 60_000,
  segCount: 4, libraryBytes: 1000, subSource: "asr", resumeMs: 0, resumeIdx: 0, ratePct: 100, hasPoster: false, lowConfidence: false,
  createdAt: "2026-10-13T08:00:00Z", lastOpenedAt: null,
};

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("ItemMenu (D7)", () => {
  it("opens an action sheet from the more button and hands the item to onReprocess, closing first", async () => {
    const onReprocess = vi.fn();
    render(<ItemMenu item={item} onReprocess={onReprocess} />);
    const more = screen.getByTestId("library-item-more-i1");
    expect(more).toHaveAccessibleName("更多");
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(await screen.findByTestId("library-item-menu")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("menu-reprocess"));
    expect(onReprocess).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
    expect(screen.queryByTestId("library-item-menu")).toBeNull();
  });
});
```

- [ ] **Step 4:`item-menu.tsx`:**

```tsx
import { EllipsisIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { IconButton } from "~/components/icon-button";
import type { LibraryItem } from "./library-api";
import "./locales";

const ITEM = cn(
  "flex min-h-tap w-full items-center gap-3 rounded-button px-3 text-left text-body text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

/** 卡片的 ⋯ 菜单(裁定 R-W1):目前只有「重新识别」。先关闭面板,再把条目交给调用方(调用方弹确认)。 */
export function ItemMenu({ item, onReprocess }: { item: LibraryItem; onReprocess(item: LibraryItem): void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        label={t("web.library.card.more")} data-testid={`library-item-more-${item.id}`} aria-haspopup="dialog" aria-expanded={open}
        className="text-ink-2" onClick={() => setOpen(true)}
      >
        <EllipsisIcon aria-hidden />
      </IconButton>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent data-testid="library-item-menu">
          <BottomSheetHeader title={t("web.library.card.menuTitle")} description={t("web.library.card.menuDescription")} srOnlyDescription />
          <div className="space-y-1">
            <button
              type="button" data-testid="menu-reprocess" className={ITEM}
              onClick={() => {
                setOpen(false);
                onReprocess(item);
              }}
            >
              <RefreshCwIcon aria-hidden />
              <span className="min-w-0 flex-1">{t("web.library.card.reprocess")}</span>
            </button>
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
```

- [ ] **Step 5:卡片测试(先红)。** `item-card.test.tsx`:`handlers()` 里加 `onReprocess: vi.fn(),`(可选属性,既有用例不受影响);在 `describe` 末尾加:

```tsx
  it("offers re-recognition in the more menu only for ready, automatically recognized items", async () => {
    const h = handlers();
    card({ item: { ...base, subSource: "asr" }, ...h });
    fireEvent.click(screen.getByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    expect(h.onReprocess).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
  });

  it("has no more menu for uploaded subtitles, non-ready items, or when the server offers no transcription", () => {
    card({ item: base, ...handlers() });
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
    card({ item: { ...base, id: "i2", subSource: "asr", status: "processing", stage: "transcribe" }, ...handlers() });
    expect(screen.queryByTestId("library-item-more-i2")).toBeNull();
    const { onReprocess: _omitted, ...without } = handlers();
    card({ item: { ...base, id: "i3", subSource: "asr" }, ...without });
    expect(screen.queryByTestId("library-item-more-i3")).toBeNull();
  });

  it("tells the learner when the sentence boundaries may be off (D5)", () => {
    card({ item: { ...base, subSource: "asr", lowConfidence: true }, ...handlers() });
    expect(screen.getByTestId("library-item-lowconf")).toHaveTextContent("句边界可能不准,可重新识别或微调");
    expect(screen.getByText("边界可能不准")).toBeInTheDocument();
  });

  it("says a failed re-recognition kept the earlier sentences, with the translated reason", () => {
    card({ item: { ...base, subSource: "asr", errorKind: "quota" }, ...handlers() });
    expect(screen.getByTestId("library-item-reprocess-failed")).toHaveTextContent("重新识别没有成功,原来的句子还在:今天的自动转写额度已用完");
    expect(screen.getByRole("link", { name: /Lecture 1/ })).toBeInTheDocument(); // still playable
  });

  it("shows no notes on a clean ready item", () => {
    card({ item: base, ...handlers() });
    expect(screen.queryByTestId("library-item-lowconf")).toBeNull();
    expect(screen.queryByTestId("library-item-reprocess-failed")).toBeNull();
  });
```

  (文件顶部已有 `fireEvent` / `screen` 导入;`card()` 多次调用同一测试会叠加渲染,第二个用例里分别用不同 `id` 的 testid 区分。)

- [ ] **Step 6:`item-card.tsx`(Edit):**
  - 导入:`import { ItemMenu } from "./item-menu";`(放在 `./library-api` 导入之后)。
  - `ItemCardHandlers` 里 `onDismissUpload(job: UploadJob): void;` 之后加:

```ts
  /** 只在服务端开着自动转写时传(裁定 R-W1);没有就不显示 ⋯ 菜单 */
  onReprocess?(item: LibraryItem): void;
```

  - `const ready = item?.status === "ready";` 之后加:

```tsx
  const lowConfidence = ready && item?.lowConfidence === true;
  const reprocessFailed = ready && item?.errorKind != null; // 重新识别失败:原句子还在,原因留在 error_kind(裁定 R-R3)
  const canReprocess = ready && item?.subSource === "asr" && h.onReprocess !== undefined;
```

  - `ready && item` 的徽标块里,`{item.subSource ? <ToneBadge tone="gray">…</ToneBadge> : null}` 之后加:

```tsx
            {lowConfidence ? <ToneBadge tone="amber">{t("web.library.card.lowConfidenceBadge")}</ToneBadge> : null}
```

  - `body` 的 if-else 链末尾,在 `} else if (item?.status === "canceled") {…}` 这一支之后(闭合 `}` 之前)加一支:

```tsx
  } else if (ready && item && (lowConfidence || reprocessFailed)) {
    body = (
      <>
        {lowConfidence ? <p data-testid="library-item-lowconf" className="mt-2 text-meta text-ink-2">{t("web.library.lowConfidence")}</p> : null}
        {reprocessFailed ? (
          <p data-testid="library-item-reprocess-failed" className="mt-2 text-meta text-ink-2">
            {t("web.library.card.reprocessFailed", { reason: t(errorKindKey(item.errorKind)) })}
          </p>
        ) : null}
      </>
    );
  }
```

    (实现时把前一支 `canceled` 的 `body = <p …/>;` 之后紧接这个 `else if`,保持一条链;若 Edit 后括号不对,按真实代码调整。)

  - 头部一行里删除按钮之前加菜单:

```tsx
          {item && canReprocess && h.onReprocess ? <ItemMenu item={item} onReprocess={h.onReprocess} /> : null}
```

- [ ] **Step 7:列表页测试(先红)。** `library-list-page.test.tsx` 末尾(最后一个 `it` 之后、`});` 之前)加:

```tsx
  it("re-recognizes an automatically recognized item after confirmation", async () => {
    const mock = render([itemRaw({ sub_source: "asr" })], {
      "POST /api/library/items/i1/reprocess": () => json({ item: itemRaw({ sub_source: "asr", status: "queued", stage: null, progress: 0 }) }),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("重新识别这条素材?")).toBeInTheDocument();
    expect(within(dialog).getByText(/再用掉今天的自动转写额度/)).toBeInTheDocument();
    expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/reprocess"))).toBe(false); // nothing before the confirm
    fireEvent.click(within(dialog).getByRole("button", { name: "重新识别" }));
    await waitFor(() => expect(screen.getByTestId("library-item-i1")).toHaveAttribute("data-state", "queued"));
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/library/items/i1/reprocess")).toHaveLength(1);
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith("已开始重新识别。");
  });

  it("sends nothing when the confirmation is canceled", async () => {
    const mock = render([itemRaw({ sub_source: "asr" })]);
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the server's reason as a toast when the allowance is used up", async () => {
    render([itemRaw({ sub_source: "asr" })], {
      "POST /api/library/items/i1/reprocess": () => json({ error: "Daily transcription limit reached" }, 429),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "重新识别" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("今天的自动转写额度已用完,明天再试。"));
    expect(screen.getByTestId("library-item-i1")).toHaveAttribute("data-state", "ready");
  });

  it("has no re-recognize action when the server has transcription off", async () => {
    render([itemRaw({ sub_source: "asr" })], {}, { ...CONFIG_RAW, asr: false });
    await screen.findByTestId("library-item-i1");
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
  });
```

- [ ] **Step 8:`library-list-page.tsx`(Edit):**
  - `library-api` 导入里 `putItemSubtitles, retryItem,` 之间加 `reprocessItem,`(保持字母序:`putItemSubtitles, reprocessItem, retryItem`)。
  - `const [pendingDelete, ...]` 之后加 `const [pendingReprocess, setPendingReprocess] = useState<LibraryItem | null>(null);`
  - `const onRetry = ...` 之前加:

```tsx
  const confirmReprocess = async () => {
    const item = pendingReprocess;
    setPendingReprocess(null);
    if (!item) return;
    try {
      list.replace(await reprocessItem(api, item.id));
      toast.success(t("web.library.toast.reprocessing"));
    } catch (err) {
      fail(err);
    }
  };
```

  - `handlers` 对象里 `onDelete: setPendingDelete,` 之后加 `onReprocess: config.asr ? setPendingReprocess : undefined,`。
  - 在删除的 `</AlertDialog>` 之后、`</LibraryRoot>` 之前加第二个对话框:

```tsx
      <AlertDialog open={!!pendingReprocess} onOpenChange={(open) => { if (!open) setPendingReprocess(null); }}>
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmReprocess.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sub text-ink-2">{t("web.library.confirmReprocess.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 rounded-button" onClick={() => void confirmReprocess()}>
              {t("web.library.confirmReprocess.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 9:跑测试:** `cd web && yarn web:typecheck && yarn vitest run src/features/library/item-menu.test.tsx src/features/library/item-card.test.tsx src/features/library/library-list-page.test.tsx src/features/library/library-api.test.ts src/features/library/locales.test.ts src/architecture.test.ts`。Radix `BottomSheet` 关闭与 `AlertDialog` 打开前后相继、jsdom 里 `findByRole("alertdialog")` 的时序是**未验证点**:若第一次运行有时序失败,用 `await waitFor(...)` 包住,不要改产品代码。
- [ ] **Step 10:提交:**

```
feat(web): re-recognize a library item from its card menu, with confirmation and low-confidence notes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 9:网页:播放页低可信提示 + 「译」默认开启(D8)

**Files:** Modify `web/src/features/library/player-page.tsx`、`player-page.test.tsx`、`use-translate-toggle.ts`、`use-translate-toggle.test.ts`、`locales/*.json`(不需要:复用 `web.library.lowConfidence`)。

- [ ] **Step 1:开关测试改写(先红)。** 把 `use-translate-toggle.test.ts` 整个文件换成:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRANSLATE_ON, readTranslateOn, translateKey, useTranslateToggle, writeTranslateOn } from "./use-translate-toggle";

beforeEach(() => localStorage.clear());

describe("translation toggle (D8, R-L32, R-W2)", () => {
  it("is on by default (D8) and remembers an explicit choice per item on this device", () => {
    expect(DEFAULT_TRANSLATE_ON).toBe(true);
    expect(readTranslateOn("a")).toBe(true);
    writeTranslateOn("a", false);
    expect(readTranslateOn("a")).toBe(false);
    expect(readTranslateOn("b")).toBe(true);
    expect(localStorage.getItem(translateKey("a"))).toBe("false");
    writeTranslateOn("a", true);
    expect(localStorage.getItem(translateKey("a"))).toBe("true");
  });

  it("stores nothing but the item id in the key and a boolean as the value", () => {
    writeTranslateOn("item-1", false);
    expect(Object.keys(localStorage)).toEqual(["enjoy-web.library.translate.item-1"]);
  });

  it("keeps an earlier `true`, and treats a corrupt stored value as the default", () => {
    localStorage.setItem(translateKey("a"), "true");
    expect(readTranslateOn("a")).toBe(true);
    localStorage.setItem(translateKey("a"), "banana");
    expect(readTranslateOn("a")).toBe(DEFAULT_TRANSLATE_ON);
  });

  it("works through a hook and survives unavailable storage", () => {
    const { result } = renderHook(() => useTranslateToggle("x"));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(readTranslateOn("x")).toBe(false);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => act(() => result.current[1](true))).not.toThrow();
    expect(result.current[0]).toBe(true);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2:`use-translate-toggle.ts` 整个文件换成:**

```ts
import { useCallback, useState } from "react";
import { readJson, writeJson } from "~/lib/storage";

/** D8:「译」默认开启(设计者的假设,用户未明确回复;改回默认关只需把它改成 false)。 */
export const DEFAULT_TRANSLATE_ON = true;

/** 「译」开关按条目记在本机(spec §11.4):键里只有条目 id,值只有布尔,没有任何内容(隐私);存储不可用时本次不记。 */
export const translateKey = (itemId: string) => `enjoy-web.library.translate.${itemId}`;
const isBool = (value: unknown): value is boolean => typeof value === "boolean";

/** 没有键(或值损坏)= 默认;显式的 `true` / `false` 都记下来(以前只记 true,所以关掉过的人会看到一次「开」,裁定 R-W2)。 */
export function readTranslateOn(itemId: string): boolean {
  return readJson(translateKey(itemId), isBool) ?? DEFAULT_TRANSLATE_ON;
}

export function writeTranslateOn(itemId: string, on: boolean): void {
  writeJson(translateKey(itemId), on);
}

export function useTranslateToggle(itemId: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readTranslateOn(itemId));
  const set = useCallback((next: boolean) => {
    setOn(next);
    writeTranslateOn(itemId, next);
  }, [itemId]);
  return [on, set];
}
```

  先 `Read` `web/src/lib/storage.ts` 确认 `readJson(key, guard)` 在没有键 / 守卫不过时返回 `null` 还是 `undefined`:`?? DEFAULT_TRANSLATE_ON` 对两者都成立;若返回别的哨兵值,按真实签名改这一行。

- [ ] **Step 3:播放页测试(先红)。** `player-page.test.tsx`:
  - 把 `it("offers the switch when the server has AI on …")` 整个用例换成:

```tsx
  it("offers the switch, on by default (D8), when the server has AI on and the UI language has a native target", async () => {
    render(detailRaw());
    const chip = await screen.findByTestId("library-translate");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAccessibleName("隐藏译文");
  });
```

  - 把 `it("turns the translation on, remembers it per item and starts fetching around the current sentence", …)` 整个用例换成:

```tsx
  it("turns the translation off, remembers the choice per item and stops fetching", async () => {
    render(detailRaw({ resume_idx: 1 }));
    const chip = await screen.findByTestId("library-translate");
    expect(tr.args).toMatchObject({ itemId: "i1", enabled: true, native: "zh-CN", anchorIdx: 1 });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAccessibleName("显示译文");
    expect(tr.args).toMatchObject({ enabled: false });
    expect(JSON.parse(localStorage.getItem(ON_KEY)!)).toBe(false);
    fireEvent.click(chip);
    expect(JSON.parse(localStorage.getItem(ON_KEY)!)).toBe(true);
  });

  it("stays off for an item the learner turned off earlier", async () => {
    localStorage.setItem(ON_KEY, "false");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(tr.args?.enabled).toBe(false);
    expect(screen.queryByTestId("segment-zh-1")).toBeNull();
  });
```

  - 在 `it("does not show the note while the translation switch is off", …)` 里,`tr.state.notice = "limited";` 之后加一行 `localStorage.setItem(ON_KEY, "false");`。
  - 在 `describe("LibraryPlayerPage (spec §11.4)")` 里(例如「shows audio items…」之后)加:

```tsx
  it("tells the learner the sentence boundaries may be off, only when the server flagged the item (D5)", async () => {
    render(detailRaw({ low_confidence: true }));
    expect(await screen.findByTestId("library-lowconf-notice")).toHaveTextContent("句边界可能不准,可重新识别或微调");
    cleanup();
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-lowconf-notice")).toBeNull();
  });
```

  (`detailRaw` 是扁平形状,`unwrapDetail` 兼容,`low_confidence` 经 camelCase 变成 `lowConfidence`。)

- [ ] **Step 4:`player-page.tsx`(Edit):** 在控制胶囊里 `{showTranslation && translations.notice ? (` 那段之前加:

```tsx
        {detail.lowConfidence ? (
          <p role="status" data-testid="library-lowconf-notice" className="lib-notice">{t("web.library.lowConfidence")}</p>
        ) : null}
```

- [ ] **Step 5:跑测试:** `cd web && yarn web:typecheck && yarn vitest run src/features/library/use-translate-toggle.test.ts src/features/library/player-page.test.tsx src/features/library/use-translations.test.tsx src/features/library/library-css.test.ts src/architecture.test.ts`。`library-css.test.ts` 钉了 `.lib-glass` 层数(2 层)与样式类:本任务只加一个 `<p class="lib-notice">`,不加玻璃层;若它因别的原因失败按真实输出判断。其他播放页用例(`player-page.test.tsx` 第 66–160 行)已读,不依赖译文默认值;若仍有因默认开启而失败的断言(例如按文本找元素撞上了译文),**改测试**(给该用例先 `localStorage.setItem(ON_KEY, "false")`),不要改产品行为。
- [ ] **Step 6:提交:**

```
feat(web): translation switch on by default (D8) and a low-confidence notice in the player

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 10:文档与结果记录

**Files:** Modify `server/app/CLAUDE.md`、`server/app/library/CLAUDE.md`、`server/app/speech/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/scripts/CLAUDE.md`、`server/tests/CLAUDE.md`、`docs/superpowers/plans/2026-10-13-video-import-results.md`。(`web/README.md` 没有跟读库一节,不动。`web/src/features/library/CLAUDE.md` 不存在,不创建。)

- [ ] **Step 1:`server/app/CLAUDE.md`:** Pitfalls 里 `alembic/versions/` 一行的 `(head \`0018\`)` 改成 `(head \`0019\`)`。
- [ ] **Step 2:`server/app/library/CLAUDE.md`:**
  - What lives here:`asr_chunks.py` 那行末尾补「;`Chunk.utterances` / `usable_utterances` / `transcribe_chunks_timed`:识别服务给的真实句子时间优先(plan 2026-10-13-library-alignment),不可信的块逐块回落估算;`chunks.json` 版本 2(仍读 1)」;`segment.py` 之后加一条 `quality.py` – 合理性检查(纯函数):字符速度 6–25 / 秒、估算块说话占比 ≥ 40%,结果写 `library_items.low_confidence`;`store.py` 那条补「`fail` / `cancel_item` 对重新识别(`seg_count > 0`)回到 `ready`」;`pipeline.py` 那条补「`PipelineDeps.timed_transcriber`」。
  - Pitfalls 加三条:「重新识别(`POST /items/{id}/reprocess`):`ready` 且 `sub_source=asr`;状态由 `seg_count > 0` 且 `queued/processing` 推出,**不要**在这种条目上直接删媒体;失败 / 取消回到 `ready`(失败保留 `error_kind`);旧句子到新句子写入前一直在,手动修改与译文会被替换」「识别服务返回的 `utterances[].text` 与转写一样永不进日志;`chunks.json` 在 `_tmp`,条目 ready 时随目录清掉」「`low_confidence` 只对 ASR 条目有意义,换字幕时清」。
- [ ] **Step 3:`server/app/speech/CLAUDE.md`:** What lives here 加 `timed.py` – `Utterance` / `TimedText`(识别结果带时间的纯数据);`asr_stream.py` 那条补「`transcribe_pcm_timed`(请求体加 `show_utterances`,解析 `result.utterances`;只有它加,既有请求体不变)」;`asr.py` 那条补「`make_timed_transcriber`」;(若做了 T5)`stt.py` 那条补「`transcribe_wav_timed`(Whisper `verbose_json`)」。Tests 行加 `tests/test_asr_stream_timed.py tests/test_asr_timed.py`(+ `tests/test_stt_timed.py`)。Pitfalls 加:「`utterances` 的时间相对所发音频起点、毫秒(厂商文档,Task 0 验证见 results 文档);文字永不进日志」。
- [ ] **Step 4:`server/app/routers/CLAUDE.md`:** `library` 那条里 `retry/cancel` 后面加 `reprocess`(重新识别:ready 的自动识别条目,额度预检)。
- [ ] **Step 5:`server/scripts/CLAUDE.md`:** What lives here 加 `asr_timing_probe.py` – Task 0 的手动探针(只打印字段名 / 条数 / 数字,`--yes` 才花钱;不在镜像里,用 `docker compose cp` + `exec -e PYTHONPATH=/app`);Tests 行加 `tests/test_asr_timing_probe.py`。
- [ ] **Step 6:`server/tests/CLAUDE.md`:** What lives here 的 `library_helpers.py` 那条补 `FakeTimedAsr`、`use_fakes(timed_asr=)`(传 `asr=` 会关掉带时间的转写器);加 `test_library_asr_timed.py` / `test_library_quality.py` / `test_library_alignment.py`(真实时间、合理性检查、持续背景音乐夹具)、`test_library_reprocess.py`(重新识别状态机与额度)。
- [ ] **Step 7:结果文档的「未验证」。** 在 `docs/superpowers/plans/2026-10-13-video-import-results.md` 末尾追加:

```markdown

### B 句边界根治 · 完成情况与未验证(plans/2026-10-13-library-alignment.md)

- 日期 / 基于提交:<YYYY-MM-DD> / <git rev-parse --short HEAD>;alembic head:0019
- 自动化:只列实际运行并通过的文件与用例数(`test_asr_timing_probe` / `test_asr_stream_timed` / `test_asr_timed` / `test_library_asr_timed` / `test_library_quality` / `test_library_alignment` / `test_library_reprocess` / `test_library_contract` / 网页的 library 目录目标文件);没跑的写「未跑」,不要写数字
- 持续背景音乐夹具:单元与流水线用例用已知时间证明「有真实时间时不再平摊」;`ffmpeg` 的 `sine` 夹具用例(没有 ffmpeg 会 skip)证明 `silencedetect` 在连续音上零静音

**未验证(按规矩写明,直到真环境 / 真机跑过):**

| 项 | 状态 |
|---|---|
| 火山 `result.utterances` 字段名 / 单位 / 相对块起点 / 是否出现在 `bigmodel_nostream` | 见本文档 Task 0 一节;没有该节 = 未验证 |
| 真实素材上的边界误差(与人耳比) | <数字 / 未验证> |
| Whisper `verbose_json` 的 `segments` | <有 / 无 / 不适用 / 未验证> |
| 用户那条素材重新识别后前三句是否对上 | 未验证(需要用户在部署后点「重新识别」听) |
| `low_confidence` 的阈值(6 / 25 字符每秒、占比 40%)在真实素材上的误报率 | 未验证 |
| 迁移 `0019` 在 Postgres 上 | 未验证(只在 SQLite 上跑) |
| iOS Safari 上卡片 ⋯ 面板与确认对话框的先后关闭、「译」默认开时的请求量 | 未验证 |
| 重新识别时并发 worker(`library_job_concurrency > 1`)与取消的竞争 | 只有单 worker 的测试 |
```

- [ ] **Step 8:校验文档与代码一致:** `cd server && uv run pytest -q tests/test_architecture.py`;文档里提到的文件名逐个 `ls` 确认存在。
- [ ] **Step 9:提交:** `docs: library alignment notes, CLAUDE.md updates and the unverified list`(+ Co-Authored-By 行)。**计划里的复选框只在合并且测试通过后才勾**(`docs/CLAUDE.md` 约定)。

---

# Task 11(条件分支,D9):VAD 后备 —— 开工前必须停下来问用户

**只在同时满足时才做:** ① Task 0 的 G0 结论是 **B**(火山不返回 / 返回不可用的 `utterances`,且 T5 的 Whisper 路径也不可用);② **用户在对话里明确同意引入新依赖**。**不要因为「更完整」而主动开工。**

- [ ] **Step 1:停,问用户(原文照此问,不要替用户决定):**

> Task 0 的结果显示识别服务不返回句子时间(见结果文档)。要根治「持续背景音乐下前几句对不上」,只能再引入一个**语音活动检测(VAD)**,只用来找真正说话的区间,字符比例只在说话区间内摊。候选两个:
> 1. **silero-vad 的 onnx 版**(模型约 2 MB,经 `onnxruntime`;准确,能区分人声与音乐);
> 2. **webrtcvad**(`webrtcvad-wheels`,体积很小,但对背景音乐区分能力弱,可能在持续音乐下把音乐也判成语音)。
> 两者都会让镜像变大(具体增量要在构建后测,我不预估数字),并多一个依赖要长期维护。要引入吗?选哪个?不引入的话,我们只保留 `low_confidence` 提示和重新识别。

用户拒绝 → 把决定写进结果文档、本任务整体跳过。用户同意 → 在本计划末尾追加 `## Addendum(日期)`,写下选定的候选、`pyproject.toml` / `uv.lock` 的改动(`uv lock` 需要联网,**只改依赖行**,`git diff --stat` 核对)、适配器的完整代码与测试(见 Step 3),裁定以 Addendum 为准。

- [ ] **Step 2(用户同意后,与具体 VAD 库无关的纯函数 —— 先写、先测):** 在 `server/app/library/asr_chunks.py` 加 `fragments_in_regions`,并让 `fragments` 接受可选的 `regions`(每块的说话区间,绝对毫秒;没有就是现在的行为)。测试 `server/tests/test_library_vad_regions.py`:

```python
"""VAD 后备(D9):字符只在真正说话的区间内摊,不摊在音乐上。"""
from app.library import asr_chunks as ac
from app.library.segment import Fragment, build

TEXT = "Welcome back to the show everyone. Today we are talking about learning English. Let us begin with a simple question."


def test_words_are_spread_over_the_speech_regions_in_proportion_to_their_length_and_none_is_lost():
    chunk = ac.Chunk(0, 40_000, TEXT)
    out = ac.fragments_in_regions(chunk, [(18_000, 21_200), (22_000, 26_400), (27_300, 30_100)])
    assert " ".join(f.text for f in out) == TEXT
    assert all(18_000 <= f.start_ms and f.end_ms <= 30_100 for f in out)
    assert [f.start_ms for f in out] == sorted(f.start_ms for f in out)


def test_a_region_that_gets_no_words_is_dropped_and_regions_are_clipped_to_the_chunk():
    chunk = ac.Chunk(10_000, 20_000, "Hi there.")
    out = ac.fragments_in_regions(chunk, [(5_000, 10_400), (12_000, 12_050), (15_000, 25_000)])
    assert out and out[0].start_ms >= 10_000 and out[-1].end_ms <= 20_000
    assert " ".join(f.text for f in out) == "Hi there."


def test_no_regions_or_no_words_means_no_fragments_so_the_caller_falls_back_to_the_estimate():
    assert ac.fragments_in_regions(ac.Chunk(0, 10_000, TEXT), []) == []
    assert ac.fragments_in_regions(ac.Chunk(0, 10_000, ""), [(0, 5_000)]) == []


def test_with_regions_the_old_flat_spreading_is_gone():
    chunk = ac.Chunk(0, 40_000, TEXT)
    flat = build(ac.fragments([chunk], []), adjust=ac.snapper([]))
    spoken = build(ac.fragments([chunk], [], regions={0: [(18_000, 21_200), (22_000, 26_400), (27_300, 30_100)]}),
                   adjust=ac.snapper([]))
    assert flat[0].start_ms == 0 and spoken[0].start_ms >= 18_000
```

  实现(`asr_chunks.py`):

```python
MIN_REGION_MS = 200  # a speech region shorter than this is noise, not words


def fragments_in_regions(chunk: Chunk, regions: list[tuple[int, int]]) -> list[Fragment]:
    """VAD fallback (D9): spread the chunk's words over the regions where someone really speaks, in proportion to region
    length, never over music or silence. [] when there is nothing to spread (the caller then estimates the old way)."""
    words = [w for w in " ".join((chunk.text or "").split()).split(" ") if w]
    inside = [(max(chunk.start_ms, s), min(chunk.end_ms, e)) for s, e in sorted(regions)]
    inside = [(s, e) for s, e in inside if e - s >= MIN_REGION_MS]
    if not words or not inside:
        return []
    total = sum(e - s for s, e in inside)
    total_chars = sum(len(w) for w in words) + len(words) - 1
    cumulative = [0]
    for s, e in inside:
        cumulative.append(cumulative[-1] + (e - s))
    buckets: list[list[str]] = [[] for _ in inside]
    offset = 0
    for word in words:
        target = (offset + len(word) / 2) / max(1, total_chars) * total
        index = next((i for i in range(len(inside)) if target < cumulative[i + 1]), len(inside) - 1)
        buckets[index].append(word)
        offset += len(word) + 1
    return [Fragment(s, e, " ".join(ws)) for (s, e), ws in zip(inside, buckets) if ws]
```

  `fragments` 增加参数 `regions: dict[int, list[tuple[int, int]]] | None = None`(键 = 块在列表里的序号):对**不可信**的块,先 `fragments_in_regions(chunk, regions.get(i, []))`,非空就用它,否则落到 `speech_span` 估算;可信块不受影响。

- [ ] **Step 3(用户同意并选定候选后,写进 Addendum 再做):** 适配器 `app/library/vad.py::speech_regions(wav_path: Path, start_ms: int, end_ms: int) -> list[tuple[int, int]]`(读 `_tmp/<id>/speech.wav` 的块切片,返回绝对毫秒的说话区间;**与文字无关,日志只记区间数**),在 `pipeline._transcribe` 里于转写完成后对每个不可信块调用并传给 `fragments(..., regions=…)`;`quality` 的「估算块说话占比」改用 VAD 区间总长。依赖、模型文件的随镜像打包方式(`Dockerfile` 的 `COPY`)、镜像体积实测、`test_architecture.py` 对新依赖的放行(`app.library` 只许 core/models/providers/speech/services,第三方库不受限)一并写进 Addendum;每项都要先有失败测试。
- [ ] **Step 4:提交(纯函数部分可单独提交):** `feat(server): spread unseen-time chunk text over VAD speech regions`(+ Co-Authored-By 行);依赖提交单独一个:`chore(server): add <chosen VAD> for speech-region detection`。

---

## 与 spec 的偏离(及理由)

1. **合理性阈值:** spec §4.3.4 的示例是「< 4 或 > 30 字符 / 秒」。用 spec §4.1 自己的证据算:前三句各 62 个字符、约 13 s = **4.8 字符 / 秒**,不会被 `< 4` 抓到。所以改为 `< 6` 或 `> 25`(正常语速约 12–17,慢速教学约 7–9),并加「句子 ≥ 20 个字符才判」避免短句误报。spec 写的是「例如」,阈值是计划作者的设定,**未用真实素材校准**(见未验证清单)。
2. **「清掉句子」与「失败回到原状」:** spec §4.3.5 同时写了「清掉 chunks.json 与句子」和「失败回到原状态」,二者字面冲突。计划取后者:旧句子留到新句子写入(`write_segments` 本来就是先删后写、与 `ready` 同事务),所以失败 / 取消都能回到 `ready`;重新识别期间条目不可打开,效果上等同于「清掉」。代价:用「`seg_count > 0` 且处理中」推断重新识别状态,而不是新增一列。
3. **只有自动识别的条目能重新识别:** spec 没限定。有字幕的条目没有可重做的识别,换字幕走已有端点。
4. **新增的采信检查:** 带时间的块先过「文字一致性」检查(`usable_utterances`)才采信,不可信逐块回落——spec 只说「优先用真实时间」,这是防止把一份对不上文字的时间当真。
5. **Whisper 时间(T5)是条件任务:** spec 只要求 Task 0 验证它;实现只在验证显示有 `segments` 时做。
6. **译文默认开的存储:** 从「只存 true」改为存显式布尔(否则无法表达「用户关掉了」);老用户里以前关掉的会看到一次「开」。

## 手动验证清单(未验证,由用户在部署后 / 真机勾选)

- [ ] Task 0:两段素材(含背景音乐的一段)的探针输出已贴进结果文档,G0 结论为 A(或 B 且已走 T11)。
- [ ] 部署后对用户那条素材点卡片 ⋯ →「重新识别」:前三句的起止时间对得上人声(逐句点播放听),不再是「每句 13 s、从 0 秒起」。
- [ ] 重新识别期间那条素材显示处理进度、不能打开;故意制造失败(例如把当天额度用到不够)时卡片回到「可以跟读」并显示「重新识别没有成功…」。
- [ ] 有字幕的条目与未开自动转写的服务器:卡片没有 ⋯ 菜单。
- [ ] `low_confidence` 的条目:列表卡有琥珀徽标与说明,播放页控制胶囊里有同一句提示;换字幕后消失。
- [ ] 「译」默认开:打开一条条目直接看到译文(需 `library_ai_enabled` 与非英文界面);关掉后下次进来仍是关;第一次进来的 AI 额度消耗符合预期(视野附近各 10 句)。
- [ ] iOS Safari:卡片 ⋯ 面板能打开 / 关闭、确认对话框能点到;360 px 宽下卡片头部(缩略图 + 标题 + ⋯ + 删除)不溢出。

## 已知限制 / 不做

- 不做批量重新识别(spec §5);不做本地 Whisper 强制对齐;不改 `segment.py` / `sentence_split.py`。
- 重新识别会替换用户对句子文字 / 时间的手动修改与译文(R-R5,确认框说明);只对自动识别的条目开放。
- 重新识别期间条目不能打开(旧句子留在库里但接口只在 `ready` 时返回);`resume_idx` 钳到新句数,`resume_ms` 保留。
- `low_confidence` 是启发式提示,可能误报 / 漏报;它不阻止跟读。
- 真实时间的精度取决于识别服务;句内仍按字符比例插值(一个识别句里含多句时,句内边界是估计的)。
- Task 0 之外的所有数字(阈值、容差)是写计划时的设定,不是实测值。
