# 语音提速与抗噪、按住说话、实时对话 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先用打点测出语音链路的延迟基线,再把"松手 → 转写出现"和"回复 → 开始出声"的时间降到基线的 50% / 40% 以下(PCM 直采 + 静音裁剪 + 识别提示词收紧 + 按句流水线朗读 + TTS 分块透传,流式识别视 spike 结论接入),把输入栏改为按住说话(上滑取消 / 转文字),并新增一个级联流式的实时通话模式(浏览器 VAD → 服务端中继识别 → DeepSeek 流式 → 逐句 TTS → WebAudio 排队播放,可打断)。

**Architecture:** 服务端新增纯函数切句 `app/sentence_split.py`、识别抽象 `app/stt.py`/`app/asr.py`(上传识别兜底 + 视 spike 的火山流式识别 `app/asr_stream.py`)、TTS 分块生成器(`app/volcengine.py` 的 `synthesize_stream`)、实时通话的票据/协议/状态机/上游适配/路由(`app/realtime_*.py`、`app/routers/realtime.py`,WebSocket `/api/realtime`,状态机只依赖注入的假上游即可完整测试)。网页端新增 16 kHz PCM 采集(`audio/capture.ts`,AudioWorklet → ScriptProcessor → 旧 MediaRecorder 三级退路)、能量门限与静音裁剪(纯函数)、Silero VAD 封装(概率来源与判定逻辑分离,判定是纯函数 `SpeechGate`)、流式切句、按句排队的 TTS 播放、按住说话的纯 reducer + 组件、WebAudio PCM 播放队列和实时通话 hook / 全屏界面。延迟打点(`lib/latency.ts` + 服务端 `app/timing.py`)是第一件做的事,所有优化以它的数字验收。

**Tech Stack:** 服务端 Python ≥3.11、FastAPI(含 WebSocket)、SQLAlchemy 2(async)、httpx、`websockets>=13`(已是依赖)、pytest + pytest-asyncio + respx;网页端 React 18.3、TypeScript 5.8、Vite 6.2、Vitest 3 + Testing Library + jsdom、Playwright 1.51;Web Audio(AudioWorklet / ScriptProcessor / AudioBufferSourceNode);**唯一新增的依赖**是 `@ricky0123/vad-web` 与其对等依赖 `onnxruntime-web`(见 R18)。不新增 PyPI 依赖,不新增迁移。

**Spec:** `docs/superpowers/specs/2026-10-07-voice-speed-hold-to-talk-realtime-design.md`(唯一权威;本计划与其冲突时以设计文档为准;设计文档没写明的地方见下文「裁定」)。上级设计:`docs/superpowers/specs/2026-10-05-chat-enhancements-design.md`、`docs/superpowers/specs/2026-10-05-voice-chat-and-bilingual-design.md`(其约定继续有效,尤其单音频焦点、`prime()` 解锁、共享自动播放元素的"单驱动者"契约)。

**外部状态(开工前必读):** 截至 2026-10-05,火山 TTS 返回 403 `resource not granted`、方舟识别(chat 模式)返回 502 "Upstream authentication failed"(见 `docs/superpowers/plans/e2e-results.md` 未决项 1、2)。**本计划所有标〔需上游〕的步骤都依赖用户先恢复这两个账号**;任务顺序已安排成:绝大多数任务只用假上游、单元测试与 Playwright 路由模拟即可完成并验收,真实上游步骤集中在 Task 0.3–0.5、5.1、5.2、5.5,并在门槛里显式门控。上游未恢复时这些步骤记为"阻塞:上游(日期 + 返回码)",**不得**用模拟结果冒充。

**新增的上游调用(成本,显式写明):**

| 动作 | 上游调用 | 备注 |
|---|---|---|
| 按句流水线自动朗读 | 每句回复 TTS ×1(原来每条回复 ×1) | 句子级缓存命中即 0;之后手动点"朗读"整条仍按整条文本合成 ×1(R8) |
| 语音消息转写 | 不变(×1/条) | 能量门限判定"没有前景语音"时 0 次(直接提示"没听清") |
| 实时通话,每一轮 | 识别 ×1(流式:按连接时长计费;兜底:上传识别 ×1)+ LLM ×1(流式)+ 每句 TTS ×1 + 讯飞评测 ×1(异步) | 每用户并发 1 路、全局 `REALTIME_MAX_SESSIONS`、单次最长 `REALTIME_MAX_MINUTES`、静音 `REALTIME_IDLE_TIMEOUT_SECONDS` 自动挂断、每轮计入 `AI_RATE_LIMIT_PER_MINUTE` |
| spike / 测量脚本 | 识别 ≤ 30 次、TTS ≤ 40 次(Task 0.3–0.5、5.1 合计) | 只在用户确认额度后运行 |
| 可选端到端实时 spike(Task 5.5) | 1–3 次短会话 | 时间盒 2 小时,只读脚本 |

## 全局约束

(每个任务都隐含遵守本节。)

- 服务端沿用既有约定:JSON 一律 **snake_case**(WebSocket 上的 JSON 事件同样 snake_case);错误体 `{"error": "<message>"}`;Bearer token(`app.deps.current_user`;消耗上游额度的接口用 `app.deps.limited_user`,与 AI 接口共用每用户每分钟额度 `AI_RATE_LIMIT_PER_MINUTE`);**单 worker**(票据、并发计数、限流都在进程内)。
- 新接口均需登录、按用户隔离,**越权访问返回 404**(与"不存在"不可区分);WebSocket 用一次性 ticket 认证,失败/超限/超时用 R12 的关闭码,客户端把关闭码翻译成 i18n 文案。
- 路由注册顺序(`server/app/main.py`)最终为:`health, sessions, grammar_prompt, config_api, speech, conversations, assessments, practice_items, vocabulary, stats, ai_chat, grammar, ai_audio, realtime, stubs, web`。新 API 路由必须在 `stubs` 之前;`web` 最后。
- 设计文档的数字逐字遵守:按住说话极短按压 < 300 ms 视为误触;60 s 上限自动发送(`VOICE_MAX_MS`);通话默认最长 10 分钟、静音 60 s 自动挂断、每用户并发 1 路;ticket 有效期 60 s;PCM 上行 16 kHz 单声道 16 位;验收目标"转写 ≤ 原来的 50%、首句出声 ≤ 原来的 40%"(Task 0.6 可按实测修订并写明)。
- **不新增迁移**:消息、评测沿用既有表;通话时长与计数只写日志指标(`app/timing.py`),**日志里不得出现用户文本、转写、回复、密钥或签名 URL**。
- 网页端:web 自身源码别名 `~/`;新文案放各功能目录的 `i18n/en.json` 与 `i18n/zh-CN.json`(`web.*` 命名空间),**en 与 zh-CN 键集合必须完全一致**(`src/i18n/i18n.test.ts` 强制);不用 i18next 复数后缀;每个新服务端错误串在对应 `*_SERVER_ERRORS` 映射表里有键。
- 移动适配与无障碍:触控区 ≥ 44 px(`h-11`/`min-h-11`/`min-w-11`);输入框字号 ≥ 16 px;页面无横向滚动;每个只靠手势的操作都有键盘/读屏后备(按住说话保留 `Space`/`Enter` 两次激活、`Escape` 取消;通话界面所有按钮有 `aria-label`,状态变化用 `role="status"` 播报);"麦克风在用"指示必须可见。
- 组件卸载后不得 `setState`;所有进行中的请求与连接在卸载/切换会话时中止;**每一条退出路径都要释放麦克风轨道并关闭本模块创建的 `AudioContext`**(由测试断言,不靠目测);StrictMode 下副作用重跑不得重复连接、重复朗读。
- **iOS**:任何"点击 → 异步取音频 → 播放"的路径都在点击的同步阶段、任何 `await` 之前解锁(`<audio>` 用既有 `primeAudioElement`/`autoSpeak.prime()`;WebAudio 用 Task 2.1 的 `unlockAudioContext()`);共享自动播放元素 `sharedAutoplayAudio()` 的**单驱动者契约**不变(`use-auto-speak.ts` 顶部注释);录音/通话期间不得有其他播放(`claimAudio`)。
- `conversation-page.tsx` 的既有规则不得回退(见上一计划 R27 列出的守护测试,每个改它的任务都全量跑 `conversation-page.test.tsx`)。
- TDD:每个任务先写失败的测试、确认失败、再实现、再确认通过、再提交;门槛里的通过数 = 基线 + 新增(写进门槛记录)。
- 质量门槛:服务端 `cd server && uv run pytest -q` 0 failed(SQLite;Postgres 见门槛 1);web `yarn workspace web typecheck`、`yarn workspace web test`(**连跑 3 次**均 0 failed)、`yarn workspace web build` 全部通过。基线在开工时记录(本计划不写死数字,见「阶段 0」开头)。
- 不提交:`web/dist`、`web/public/vad/`(构建时复制的 VAD 资源)、`node_modules`、任何 `.env`(含 `server/.env.bak-*`)、密钥、生成的音频(`.superpowers/latency/`)与 `.superpowers/` 下的日志。**计划、代码、测试、提交信息、日志、记录文档里都不得出现真实密钥**;真实上游密钥只在 git 忽略的 `server/.env`,**执行者不得读取或打印 `server/.env*` 的内容**(spike 脚本通过 `Settings()` 在进程内读取,输出里只打印"已配置/未配置")。
- 环境:**Windows + Git Bash**(仓库根 `/e/workspace/everyone-can-use-english`)。Python 一律在 `server/` 下 `uv run …`;web 一律 `yarn workspace web …`;**不要运行 `yarn workspaces focus`**;`yarn add` 会打印一个无关的 sqlite3 node-gyp 错误但链接正常。前台 `sleep` 被禁止:等容器用 `docker compose … up -d --wait` 或 `pg_isready` 轮询,等页面用 Playwright `waitFor*`/`expect.poll`,后台服务用 `run_in_background` 启动后用带超时的 `curl --retry` 探活。Postgres 测试库用 `docker run postgres:16-alpine` 映射到 **127.0.0.1:55432**(主机 5432 被 Windows 保留;连接串一律写 `127.0.0.1`,**不要写 `localhost`**——本机 `localhost` 会先解析到 `::1` 导致连接失败)。
- 提交信息 `<type>(<scope>): <说明>`,一个提交一件事,末尾追加 `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`(若执行会话的系统提示规定了别的署名行,以系统提示为准)。分支 `feat/self-hosted-backend`。**只 `git add` 本任务列出的文件**(工作区里可能有用户未提交的改动,例如 `docker-compose.yml`,不得顺手提交)。不修改 `enjoy/`、`1000-hours/`、`1000h-portal/`、`book/`。

## 评审与记录约定

- 每个任务按 superpowers:subagent-driven-development 走两轮评审:**第 1 轮"是否符合设计/本计划"**(逐条对照任务的 Interfaces 与裁定),**第 2 轮"代码质量"**;两轮都通过才勾选任务。评审意见被拒绝时在任务末尾写一行理由(不删原意见)。
- 每个阶段门槛的结果(命令、通过数、日期、提交号)追加到 `docs/superpowers/plans/2026-10-07-voice-gate-log.md`(Task 0.1 创建),门槛未全部勾选不得进入下一阶段(「可并行开发」的例外除外)。
- 〔需上游〕步骤的三种合法结论:`通过(日期、数字)`/`失败(现象、返回码,不含密钥)`/`阻塞:上游(日期、返回码)`。

## 裁定(设计文档未写明或需要取舍之处)

| # | 裁定 |
|---|---|
| R1 | **上游门控**:标〔需上游〕的步骤只在用户确认火山 TTS 与方舟识别已恢复、并同意产生费用后运行;运行前先跑 Task 0.3 的"连通性预检"(一次 TTS、一次识别),失败即整段记为"阻塞:上游"。阻塞期间:`REALTIME_ENABLED` 保持默认 `false`,`UPSTREAM_ASR_MODE` 保持默认 `chat`,设计文档 §7 第 1、4 条(提速可量化、实时端到端)在 `e2e-results.md` 的 OPEN ACCEPTANCE ITEMS 里保持 OPEN。 |
| R2 | **基线先行**:Task 0.1(打点)与 Task 0.2(测量脚本)提交后立刻打标签 `git tag voice-latency-baseline`。基线**必须**在这个标签对应的代码上测(Task 0.5);若上游在优化落地之后才恢复,用 `git worktree add ../ecue-baseline voice-latency-baseline` 起一份旧代码测基线,再在最新代码上测"之后",两组数字同一天、同一网络测量。任何优化任务(阶段 1 起)都不得在这个标签之前提交。 |
| R3 | **识别走向与降级**:流式识别默认关(`UPSTREAM_ASR_MODE=chat`;开启为 `UPSTREAM_ASR_MODE=volc_stream`,已随 spike 落地,见 `2026-10-07-volc-streaming-asr-spike.md`),由用户在自己的 `.env` 里打开。下文代码中的 `settings.asr_stream_enabled` 是只读属性,等价于 `upstream_asr_mode == "volc_stream"`;`ASR_STREAM_URL` 已用于上传识别(`bigmodel_nostream`),实时通话需要的 `bigmodel_async` 地址要另设配置项(Task 1.6 时决定)。实时通话的识别选择 `make_recognizers`(Task 4.4)按此开关选择 `VolcStreamRecognizer` 或 `BufferedRecognizer`;流式识别器创建失败 → 该通话改用 `BufferedRecognizer` 并下发 `{"type": "degraded", "reason": "asr"}`,界面显示"网络/服务较慢"(不整体失败)。语音消息(非通话)始终走现有上传识别 `/api/ai/audio/transcriptions`(本计划只优化它的客户端与提示词)。 |
| R4 | **"没有清晰前景语音"的表示**:识别提示词要求此时**只输出 `<none>`**;服务端 `NO_SPEECH_TOKEN = "<none>"`,命中(去空白、忽略大小写)时返回 `200 {"text": "", "segments": []}`;上游返回空串仍是 `502 Upstream unavailable`(既有测试 `test_upstream_problems_are_502` 不改)。网页端空转写沿用既有 `web.chat.noSpeech` 提示。 |
| R5 | **识别请求的提速参数**(仅 chat 模式):加 `max_tokens = STT_MAX_TOKENS`(默认 512)与 `thinking = {"type": "disabled"}`(由 `STT_DISABLE_THINKING` 控制,默认 `true`)。后者是否被方舟当前模型接受**未验证**:Task 0.3 用真实上游各测一次带/不带;若带上返回 4xx,门槛 0 记录"把 `STT_DISABLE_THINKING=false` 写进 `.env.example` 默认值"的决定并在 Task 1.2 照做。 |
| R6 | **TTS 分块透传**:`POST /api/ai/audio/speech` 的请求体新增可选 `stream: bool = false`。`false`(缺省)行为与今天逐字节相同。`true` 且模型是火山时:服务端先从上游取到第一块音频再返回 `StreamingResponse`(`audio/mpeg`、`Cache-Control: no-store`、`X-Accel-Buffering: no`),所以"第一块之前"的错误仍是正常的 JSON 错误(502/503/400);第一块之后上游出错 → 截断响应并记日志(客户端会得到一段较短的音频)。`true` 但模型不是火山 → 忽略 `stream`,整段返回(向后兼容)。网页端的自动朗读**不**依赖这个开关(`<audio>` 需要完整 blob,R8 用"按句"实现提速);它的消费者是实时通话的服务端内部(直接用 `synthesize_stream` 生成器)与 Task 0.5/5.1 的首块延迟测量。 |
| R7 | **切句规则**(服务端 `SentenceSplitter` 与网页端 `createSentenceStream` 必须一致,共用 `server/tests/fixtures/sentence_cases.json` 一致性用例):句末 = `.` `!` `?`(可连写,如 `?!`)后可跟收尾符 `" ' ” ’ ) ]`,**再接空白**且下一个非空白字符是大写字母/数字/开引号/开括号,或到达文本末尾(仅 `flush` 时);中文句末 `。！？` 直接断(不要求空白);省略号 `…`、`...` **从不**断句;`.` 前是缩写(`Mr Mrs Ms Dr Prof Sr Jr St vs etc e.g i.e a.m p.m U.S U.K` 等,与 `web/src/features/chat/sentences.ts` 的表相同)或单个字母(姓名缩写)不断;数字中的点(`3.14`、`v1.2`)因后面没有空白天然不断;换行处断;单句超过 `MAX_SENTENCE_CHARS = 200` 字符时,在 200 以内最后一个 `, ; :` 或空格处强制断开(都没有就在 200 处断);输出去首尾空白,丢弃不含任何字母/汉字的片段。流式时,"句末标点在缓冲末尾"的情况要等下一段文本或 `flush` 才能确定。 |
| R8 | **按句流水线自动朗读**:回复流式进行中,`useAutoSpeak.progress(botKey, full)` 每次收到增量都把新完成的句子交给切句器;**第一句完成时**做一次判断(与 R4 of 上一计划相同的顺序,只是把 `status` 视为 `done`),结果为"读"就开一个 `TtsQueue`(`useTtsPlayer.playQueue`),之后每完成一句 `push` 一句;回复 `done` 时 `flush` 剩余并 `end()`;回复出错 → 立即 `stop()`(已读部分不补)。队列串行播放同一个共享 `<audio>`,**最多预取 2 句**合成;每句用句子文本做缓存键(`ttsKey(model, voice, sentence)`);整条回复读完前任何一次 `prime()`/`stop()`/新的 `play()` 都会清空队列。回复短到流式期间没有出现完整句子 → 回退到既有的整条朗读路径(`complete` 时 `speak`)。手动点"朗读"仍按整条文本合成(多一次 TTS,写进成本表)。 |
| R9 | **PCM 采集与退路**:`AudioContext` 按设备原生采样率创建(Firefox 不允许跨采样率连接 `MediaStreamSource`),在主线程用 `Downsampler`(盒式低通 + 线性插值)降到 16 kHz;采集节点优先 `AudioWorkletNode`(模块 `src/audio/pcm-capture.worklet.js`,用 `?url` 导入,构建后在 `/assets/` 下、由既有 SW 缓存),`audioWorklet` 不存在或 `addModule` 失败时退到 `ScriptProcessorNode(4096, 1, 1)`;`AudioContext` 也没有时退到旧的 MediaRecorder 路径(`recorder.ts` 原样保留)。约束 `{echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}`,浏览器 `getSupportedConstraints().voiceIsolation` 为真时再加 `voiceIsolation: true`。停止即出结果(没有 2 s 兜底):停止时同步取走已收集的样本,释放麦克风与 `AudioContext`。 |
| R10 | **抗噪分层的具体数值**(都可在测试里覆盖):帧长 20 ms;近讲门限 `NEAR_FIELD_DBFS = -38`(帧 RMS 低于它的不算语音);静音裁剪保留首尾 `PAD_MS = 200`;"有前景语音"= 连续 ≥ `MIN_SPEECH_MS = 250` 的高于门限帧;语音消息只用能量门限(快,零依赖),判定没有前景语音时**不上传**,直接走 `noSpeech` 提示;实时通话用 Silero 概率 + 能量双条件的 `SpeechGate`:`normal` 预设(概率 ≥ 0.5 开始、< 0.35 结束、最短 250 ms、结束等待 600 ms、能量 ≥ −38 dBFS)与 `bot-speaking` 预设(概率 ≥ 0.8、最短 400 ms、能量 ≥ −30 dBFS,其余同上),机器人说话期间自动切到后者。识别提示词追加"只转写最近、最清晰的说话人,忽略背景人声"(R4)。评测分数很低(`pronunciation_score < 40`)且评测识别出的词与转写的词重合率 < 50% 时,气泡旁提示"可能混入了他人声音"(`web.chat.voice.mixedVoices`,不阻断)。设置面板加一行说明"近讲模式:靠近麦克风说话、嘈杂环境建议戴耳机;无法完全排除旁人声音"(只是文案,不加开关)。 |
| R11 | **按住说话的几何与时序**:按下即开始申请麦克风(iOS 要求在手势里调用 `getUserMedia`);松手时距按下 < `SHORT_PRESS_MS = 300` → 丢弃并提示"按住说话"(`web.chat.hold.tooShort`);麦克风尚未就绪(权限弹窗期间)就松手 → 丢弃并提示"麦克风已准备好,请按住说话"(`web.chat.hold.notReady`);录音中手指上移 `dy ≤ -SLIDE_ARM_PX(80)` 进入"落点"模式,落点按视口左右半边划分:左半 = 取消、右半 = 转文字;回到 `dy > -SLIDE_DISARM_PX(40)` 退出落点模式(滞回);落在取消上松手 = 丢弃,落在转文字上松手 = 转写后**填入输入框不发送**,其他位置松手 = 发送;`pointercancel`/`lostpointercapture`/页面隐藏 = 丢弃不发送;60 s 上限:未进入落点 = 发送,在"取消"上 = 丢弃,在"转文字"上 = 填入。键盘:按钮获得焦点时 `Space`/`Enter` 第一次开始、第二次发送,`Escape` 取消。 |
| R12 | **实时协议**(详见 Task 4.2):上行二进制帧 = 16 kHz PCM16LE,单帧 ≤ 32000 字节;上行 JSON:`start`、`utterance_end`、`interrupt`、`hangup`;下行 JSON:`ready`、`state`、`transcript_partial`、`transcript_final`、`reply_delta`、`reply_done`、`assessment`、`degraded`、`error`;下行二进制 = 4 字节大端 `turn_id` + 24 kHz PCM16LE(客户端丢弃 `turn_id` 不是当前轮的块)。关闭码:`1000` 正常挂断、`4001` 票据无效/过期、`4003` 功能未开启、`4004` 会话不存在、`4008` 静音超时、`4009` 超过最长时长、`4013` 会话消息已满、`4029` 已有通话进行中或全局并发已满、`4400` 协议错误、`4502` 上游不可用(开始时连不上任何识别)。 |
| R13 | **通话消息的保存**:服务端在 `transcript_final` 后立即保存用户消息(空转写不保存、不回复),回复结束保存助手消息;被打断时保存"已完整下发音频的句子"拼接 + `" …"`,一句都没下发则不保存助手消息。保存走与 `POST /api/conversations/{id}/messages` 相同的上限(`MAX_MESSAGES_PER_CONVERSATION`,超限 → `error {code: "message_limit"}` 后关闭 `4013`)。LLM 上下文 = 客户端在 `start` 里给的系统提示词(客户端用既有 `effectiveSystemPrompt` 拼好,≤ 8000 字符)+ 服务端从库里读的最近 20 条消息(与 `HISTORY_LIMIT` 一致)。通话结束后网页端重新拉取消息列表,复盘/进度/词汇本直接可用。 |
| R14 | **通话中的评测与语法**:服务端为每条用户话语保留其 PCM(≤ 60 s,超过只取前 60 s),**异步**调用讯飞评测(参考文本 = 转写),完成后下发 `assessment`;`start.save_recordings` 为真时(网页端与语音消息一致,固定传 `true`)按既有规则保存录音与评测并把 `assessment_id` 关联到该用户消息(受录音配额限制,超额 → `assessment {status: "quota"}`,不阻断对话);讯飞未配置 → 不评测。语法检查在网页端做:收到 `transcript_final {message_id}` 后按设置开关调用既有语法接口并 `PATCH /api/messages/{id}`(沿用 `TurnResults` 的语法部分)。 |
| R15 | **限额**:`REALTIME_MAX_MINUTES`(默认 10)、`REALTIME_IDLE_TIMEOUT_SECONDS`(默认 60;"静音"= 连续这么久没有收到任何上行音频帧,且没有正在进行的一轮——客户端只在 VAD 判定说话时上传音频)、每用户并发 1 路(第二个连接 `4029`,第一个不受影响)、全局 `REALTIME_MAX_SESSIONS`(默认 5)、每一轮用户话语消耗一次 `user_limiter` 额度(超限 → `error {code: "rate_limited"}`,本轮不回复,不断开)、ticket 60 s 一次性(`REALTIME_TICKET_TTL_SECONDS`)。每次通话结束记一行 `timing event=realtime_call seconds=… turns=… interrupts=… close=…`。 |
| R16 | **切后台/锁屏**:通话界面监听 `visibilitychange`,变为 `hidden` 立即挂断(关闭码 1000,原因 `background`),回到前台时显示"通话因切到后台已结束"。不做后台保活(iOS 也不允许)。 |
| R17 | **既有测试允许的改动(仅此几处)**:`conversation-page.test.tsx` 中**点一下开始、再点一下停止**的录音用例,改为用 `web/src/test/hold.ts` 的 `holdMic(el, opts)` / `pressKey(el)`(两种都要有;每改一个用例在门槛记录里列出用例名),其 `routes()` 默认路由增加 `"GET /api/realtime/config"`(返回 `enabled: false`,Task 4.11);`web/e2e/chat.spec.ts` 的 "voice message" 用例里"开始/停止"两次点击合并为 `recordFor`(Task 3.5);`web/src/pwa/sw.test.ts`、`use-recorder.test.tsx`、`convert.test.ts`、`use-voice-turn.test.tsx`、`voice-ui.test.tsx` 只追加用例;对 TTS 请求**次数**或请求体 `input` 的断言,若对应回复含多句,改为断言"按句请求、拼接等于原文"(同样逐条列出);`use-auto-speak.test.tsx` 与 `use-tts-player.test.tsx` **不改**(新行为由新增用例覆盖)。除此之外既有测试一律不改。 |
| R18 | **新依赖例外**:允许新增 `@ricky0123/vad-web` 与 `onnxruntime-web` 两个依赖(精确版本号在 Task 2.3 Step 1 由 `yarn npm info` 确定后**锁死**,不用 `^`);模型与 wasm 由 `web/scripts/copy-vad-assets.mjs` 在 `dev`/`build` 前复制到 `web/public/vad/`(git 忽略),运行时从同源 `/vad/` 加载,**不访问任何 CDN**;`web/public/sw.js` 把 `/vad/` 纳入与 `/assets/` 相同的缓存规则。 |
| R19 | **真机与端到端**:Playwright Chromium 带 `--autoplay-policy=no-user-gesture-required` 与假麦克风,只能证明逻辑;iOS Safari 的 AudioWorklet、`AudioContext` 解锁、回声消除强度、系统手势取消、嘈杂环境效果一律"未验证",写进真机清单第 23–32 项。 |

## 延迟测量方法(设计文档 §7.1)

- **样本集**(Task 0.2 的 `server/scripts/latency_samples.py` 生成到 `.superpowers/latency/`,不提交):`s5.wav` = `enjoy/samples/jfk.wav` 前 5.0 s;`s15.wav` = `jfk.wav` 全长 + 从头补足到 15.0 s;都转为 16 kHz 单声道 16 位。回复文本固定为两句的 `REPLY_TEXT = "That sounds like a great plan. What time would you like to meet tomorrow?"`。
- **两层测量**:
  1. 服务端层(`server/scripts/measure_latency.py`,对着本机 uvicorn 跑):`stt_ms`(上传 WAV → 返回转写)、`tts_full_ms`(整段合成 `REPLY_TEXT`)、`tts_first_chunk_ms`(`stream=true` 时第一块到达,仅"之后"有)、`tts_first_sentence_ms`(只合成第一句)。
  2. 浏览器层(`web/e2e/latency.spec.ts`,`E2E_LATENCY=1` 才运行,chromium-mobile,假麦克风文件由 `E2E_FAKE_AUDIO` 指定):读取页面 `window.__enjoyLatency` 的 `transcriptMs`(松手/点停止 → 转写出现)、`firstAudioAfterReplyMs`(回复完成 → 开始出声,流水线后可为负数,照实记录)、`firstAudioAfterReleaseMs`(松手 → 开始出声)。
- **次数与统计**:每个样本先跑 1 次热身(不计),再跑 **N = 7** 次(浏览器层 N = 5),取**中位数**,同时记录最小/最大值;基线与"之后"在**同一天、同一台机器、同一网络**测量,记录日期时间、提交号、上游模型名(不含密钥)。
- **结果表**写在 `docs/superpowers/plans/2026-10-07-voice-latency.md`(Task 0.5 建表并填基线,Task 5.1 填"之后"与比值):

```markdown
| 指标 | 样本 | 基线中位数 (ms) | 之后中位数 (ms) | 之后/基线 | 目标 | 结论 |
|---|---|---|---|---|---|---|
| 松手 → 转写出现(浏览器) | s5 | | | | ≤ 50% | |
| 松手 → 转写出现(浏览器) | s15 | | | | ≤ 50% | |
| 回复完成 → 开始出声(浏览器) | s5 | | | | ≤ 40% | |
| 上传 → 转写(服务端) | s5 / s15 | | | | 参考 | |
| 整段合成 / 首句合成 / 首块(服务端) | REPLY_TEXT | | | | 参考 | |
```

## 降级规则(汇总)

| 情形 | 行为 |
|---|---|
| 流式识别未开启或 spike 未通过 | 通话用 `BufferedRecognizer`(客户端 VAD 断句 + 上传识别),`ready.asr = "buffered"` |
| 通话中流式识别连不上 | 本次通话退到 `BufferedRecognizer` + `degraded` 事件(界面"网络/服务较慢");没有兜底可用 → 关闭 `4502` |
| 讯飞未配置/失败 | 通话照常,不显示评测;失败下发 `assessment {status: "failed"}` |
| TTS 失败(通话中) | 该轮下发 `error {code: "tts_failed"}`,字幕照常显示文字,回到聆听 |
| LLM 失败(通话中) | `error {code: "llm_failed"}`,回到聆听;已保存的用户消息保留 |
| AudioWorklet 不可用 | ScriptProcessor;再不行用旧 MediaRecorder(语音消息)/ 通话按钮隐藏(`AudioContext` 不存在时) |
| VAD 资源加载失败 | 语音消息不受影响(只用能量门限);通话自动切到"按住说话"模式并提示 |
| `stream=true` 但非火山 TTS | 整段返回(R6) |
| 自动朗读被浏览器拦截 | 沿用上一计划 R6 的"点此朗读" |
| 切后台 | 录音沿用既有"保留草稿";通话直接挂断(R16) |
| `REALTIME_ENABLED=false` | 顶栏不显示"通话";`/api/realtime/ticket` 返回 `503 Realtime is not enabled`;WS 关闭 `4003` |

## 文件结构

服务端(新增 / 修改):

| 路径 | 职责 |
|---|---|
| `server/app/timing.py` | 耗时日志(只记数字与事件名) |
| `server/app/config.py`(改) | STT 提速参数、流式识别、实时通话配置项 |
| `server/app/stt.py` | chat 模式识别的可复用核心 `transcribe_chat`、`pcm_to_wav` |
| `server/app/routers/ai_audio.py`(改) | 提示词抗噪、`<none>`、`max_tokens`/`thinking`、`stream=true` 透传、打点 |
| `server/app/volcengine.py`(改) | 增量解析 `StreamParser`、异步生成器 `synthesize_stream` |
| `server/app/sentence_split.py` | 流式切句(纯函数) |
| `server/app/asr.py` | 逐句识别协议 `UtteranceRecognizer`、`RecognizerFactory`、上传识别兜底 `BufferedRecognizer` |
| `server/app/asr_stream.py` | 火山流式识别:二进制帧编解码 + `VolcStreamRecognizer`(视 spike) |
| `server/app/realtime_tickets.py` | 一次性票据 |
| `server/app/realtime_protocol.py` | 上下行消息、关闭码、音频帧 |
| `server/app/realtime_session.py` | 通话状态机(只依赖注入的上游) |
| `server/app/realtime_providers.py` | 真实上游适配(LLM 流、TTS 流、识别工厂、消息存储、评测) |
| `server/app/assessment_store.py` | 从 `speech.py` 抽出的"保存录音与评测"(Task 4.6) |
| `server/app/routers/speech.py`(改) | 改为调用 `assessment_store`(行为不变) |
| `server/app/routers/realtime.py` | `GET /api/realtime/config`、`POST /api/realtime/ticket`、`WS /api/realtime` |
| `server/app/main.py`(改) | 注册 `realtime`、`app.state` 初始化 |
| `server/scripts/latency_samples.py`、`measure_latency.py` | 样本生成与测量 |
| `server/scripts/spikes/asr_stream_spike.py`、`tts_chunk_spike.py`、`dialogue_spike.py` | 只读 spike(不是产品代码) |
| `server/tests/test_timing.py`、`test_stt_prompt.py`、`test_tts_stream.py`、`test_sentence_split.py`、`test_asr_buffered.py`、`test_asr_stream.py`、`test_realtime_settings.py`、`test_realtime_tickets.py`、`test_realtime_protocol.py`、`test_realtime_session.py`、`test_realtime_providers.py`、`test_realtime_ws.py`、`test_realtime_assessor.py`、`test_latency_tools.py`、`fixtures/sentence_cases.json` | 测试 |
| `server/.env.example`、`server/README.md`(改) | 配置与文档 |

网页端(`web/` 下):

| 路径 | 职责 |
|---|---|
| `src/lib/latency.ts` | 延迟打点与环形记录 `window.__enjoyLatency` |
| `src/api/ai.ts`(改) | 首个增量打点 |
| `src/audio/pcm.ts` | 降采样、浮点 ↔ PCM16、RMS(纯函数) |
| `src/audio/energy-gate.ts` | 静音裁剪、前景语音判定(纯函数) |
| `src/audio/capture.ts`、`src/audio/pcm-capture.worklet.js` | 16 kHz PCM 采集、`unlockAudioContext` |
| `src/audio/pcm-recording.ts` | 以 `RecordingSession` 契约包装 PCM 采集 |
| `src/audio/recorder.ts`、`use-recorder.ts`、`convert.ts`(改) | `noSpeech` 字段、可注入的启动器、WAV 快速路径 |
| `src/audio/speech-gate.ts`、`src/audio/vad.ts` | VAD 判定(纯)与 Silero 封装 |
| `src/audio/pcm-player.ts` | WebAudio 排队播放 |
| `src/test/fake-audio.ts`、`src/test/hold.ts` | 测试辅助(假 AudioContext/节点/流;按住手势) |
| `scripts/copy-vad-assets.mjs`、`public/sw.js`(改)、`package.json`(改)、`.gitignore`(改) | VAD 资源自托管与缓存 |
| `src/features/chat/sentence-stream.ts` | 流式切句 |
| `src/features/chat/use-tts-player.ts`、`use-auto-speak.ts`(改) | `playQueue`、`progress` |
| `src/features/chat/use-voice-turn.ts`(改) | 打点、`stop(deliver)`、`noSpeech` |
| `src/features/chat/hold-to-talk.ts`、`use-hold-to-talk.ts`、`hold-to-talk-button.tsx` | 按住说话 |
| `src/features/chat/mixed-voices.ts`、`result-badges.tsx`(改) | "可能混入他人声音"提示 |
| `src/features/chat/conversation-page.tsx`、`conversation-header-actions.tsx`、`conversation-settings-sheet.tsx`(改) | 集成 |
| `src/features/realtime/realtime-api.ts`、`protocol.ts`、`errors.ts`、`call-machine.ts`、`realtime-call.ts`、`use-realtime-call.ts`、`realtime-call-screen.tsx`、`i18n/*` | 实时通话 |
| `vite.config.ts`(改) | 开发代理 `ws: true` |
| `e2e/hold-to-talk.spec.ts`、`e2e/latency.spec.ts`、`e2e/realtime.spec.ts`、`e2e/support/mic.ts`、`touch.ts`、`leaks.ts`、`e2e/chat.spec.ts`(改)、`playwright.config.cts`(改);仓库根 `docker-compose.e2e.yml`(改) | 端到端 |

文档:`docs/superpowers/plans/2026-10-07-voice-gate-log.md`(门槛记录)、`2026-10-07-voice-spike-results.md`(spike 结论)、`2026-10-07-voice-latency.md`(延迟表)、`e2e-results.md`(改)、`web/README.md`、`server/README.md`(改)。

## 阶段总览(与设计文档 §8 一一对应)

| 阶段 | 目标 | 验收门槛(全部满足才进入下一阶段) |
|---|---|---|
| 0 | Spike:打点、测量工具、基线标签;〔需上游〕连通性、流式识别鉴权与帧协议、TTS 分块、基线测量;结论文档 | 打点与工具测试通过;标签已打;spike 结论文档写明 ASR 走向(stream / buffered)与目标值(或"阻塞:上游") |
| 1 | 服务端:配置项、识别提示词抗噪与提速参数、TTS 流式透传、切句、识别抽象与兜底、(视 spike)流式识别客户端 | pytest 0 failed(SQLite + Postgres);既有测试未改;无密钥 |
| 2 | 网页:PCM 采集、能量门限与裁剪、VAD、语音消息改用 PCM、流式切句、按句流水线自动朗读 | typecheck/test×3/build;i18n 一致;对话页既有测试按 R17 通过 |
| 3 | 网页:按住说话 + 上滑取消/转文字 | 同上 + 手势状态机穷举测试 + Playwright(路由模拟)通过 |
| 4 | 服务端 + 网页:实时通话(票据、协议、状态机、上游适配、WS 路由、评测、PCM 播放、hook、界面、入口) | 服务端与网页门槛同上;假上游下整轮/打断/超时/并发/关闭码测试全部通过;泄漏测试通过 |
| 5 | 端到端、延迟对比、抗噪合成测试汇总、文档、真机清单、最终回归;可选端到端实时 spike | 延迟表填写(或阻塞);E2E 结果表填写;真机清单第 23–32 项追加;门槛 5 全部满足 |

**规则:未满足本阶段验收门槛,不得开始下一阶段**(文末「可并行开发」的例外除外)。

---
## 阶段 0:Spike 与基线

开始前记录基线(门槛要用),写进 `docs/superpowers/plans/2026-10-07-voice-gate-log.md`(Task 0.1 Step 7 创建该文件):

```bash
cd /e/workspace/everyone-can-use-english
git rev-parse --short HEAD                              # 记为 BASE
(cd server && uv run pytest -q 2>&1 | tail -1)          # 记为 BASE_PY(形如 "N passed")
yarn workspace web test 2>&1 | tail -4                  # 记为 BASE_WEB(Tests  N passed)
git status --short                                      # 记下用户未提交的文件(例如 docker-compose.yml),之后一律不 git add 它们
```

### Task 0.1:延迟打点(网页 + 服务端)

**Files:**
- Create: `web/src/lib/latency.ts`、`web/src/lib/latency.test.ts`
- Modify: `web/src/features/chat/use-voice-turn.ts`(`stop()`、`accept()`、`transcribeDraft()` 三处打点)
- Modify: `web/src/features/chat/use-auto-speak.ts`(`complete()` 打 `reply_done`)
- Modify: `web/src/features/chat/use-tts-player.ts`(`play()` 打 `tts_request`、`first_audio`)
- Modify: `web/src/api/ai.ts`(`streamChatCompletion` 第一次 `onDelta` 打 `reply_first_delta`)
- Create: `server/app/timing.py`、`server/tests/test_timing.py`
- Modify: `server/app/routers/ai_audio.py`(`_chat_transcription` 与火山 TTS 分支打点)
- Create: `docs/superpowers/plans/2026-10-07-voice-gate-log.md`

**Interfaces:**
- Consumes:无(第一个任务)。
- Produces(网页):`type LatencyMark = "release" | "audio_ready" | "transcript" | "reply_first_delta" | "reply_done" | "tts_request" | "first_audio"`;`interface LatencySpans { transcriptMs?: number; replyMs?: number; firstAudioAfterReplyMs?: number; firstAudioAfterReleaseMs?: number }`;`interface LatencyRecord { id: number; kind: "voice" | "text"; marks: Partial<Record<LatencyMark, number>>; spans: LatencySpans }`;`latencySpans(marks): LatencySpans`;`startLatencyTrace(kind: "voice" | "text"): void`;`markLatency(mark: LatencyMark): void`(没有进行中的记录时为空操作;同一标记只记第一次;`first_audio` 记完即结束该记录);`finishLatencyTrace(): void`;`latencyLog(): readonly LatencyRecord[]`(最多 50 条,同时挂在 `window.__enjoyLatency`);`resetLatencyForTest(now?: () => number): void`。`localStorage["enjoy-web.debug.latency"] === "1"` 时每条结束的记录 `console.info("[latency]", spans)`。
- Produces(服务端):`log_timing(event: str, **fields: int | float | str) -> None`(logger `app.timing`,格式 `timing event=<event> k=v …`,键按字母序;字符串值只允许 `[A-Za-z0-9_.-]{1,40}`,否则写成 `?`——防止误把文本写进日志);`class Stopwatch(clock=time.perf_counter)`,`ms() -> int`。日志事件:`stt_chat`(`ms`、`audio_bytes`、`status`)、`tts_volcengine`(`ms`、`chars`、`stream`)。

- [ ] **Step 1: 写网页端失败的测试** —— `web/src/lib/latency.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishLatencyTrace, latencyLog, latencySpans, markLatency, resetLatencyForTest, startLatencyTrace } from "./latency";

let now = 0;
beforeEach(() => {
  now = 1000;
  resetLatencyForTest(() => now);
});
afterEach(() => vi.restoreAllMocks());

describe("latency trace", () => {
  it("computes spans from marks of one voice turn", () => {
    startLatencyTrace("voice");
    markLatency("release");
    now = 1300; markLatency("audio_ready");
    now = 2500; markLatency("transcript");
    now = 2700; markLatency("reply_first_delta");
    now = 4000; markLatency("reply_done");
    now = 4100; markLatency("tts_request");
    now = 4900; markLatency("first_audio"); // 结束该记录
    const [record] = latencyLog();
    expect(record.kind).toBe("voice");
    expect(record.spans).toEqual({ transcriptMs: 1500, replyMs: 1500, firstAudioAfterReplyMs: 900, firstAudioAfterReleaseMs: 3900 });
    expect((globalThis as unknown as { __enjoyLatency: unknown }).__enjoyLatency).toBe(latencyLog());
  });

  it("keeps only the first occurrence of a mark and ignores marks without a trace", () => {
    markLatency("release"); // 没有进行中的记录:忽略
    expect(latencyLog()).toHaveLength(0);
    startLatencyTrace("voice");
    markLatency("release");
    now = 5000; markLatency("release");
    finishLatencyTrace();
    expect(latencyLog()[0].marks.release).toBe(1000);
  });

  it("starting a new trace finishes the open one and the log is capped at 50", () => {
    for (let i = 0; i < 60; i++) {
      startLatencyTrace("text");
      markLatency("reply_done");
    }
    finishLatencyTrace();
    expect(latencyLog()).toHaveLength(50);
    expect(latencyLog()[49].id).toBe(60);
  });

  it("a negative first-audio span (pipelined read-aloud) is kept as is", () => {
    expect(latencySpans({ reply_done: 5000, first_audio: 4200 }).firstAudioAfterReplyMs).toBe(-800);
  });

  it("logs to the console only when the debug flag is set", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    startLatencyTrace("voice");
    finishLatencyTrace();
    expect(info).not.toHaveBeenCalled();
    localStorage.setItem("enjoy-web.debug.latency", "1");
    startLatencyTrace("voice");
    finishLatencyTrace();
    expect(info).toHaveBeenCalledWith("[latency]", expect.any(Object));
    localStorage.removeItem("enjoy-web.debug.latency");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `yarn workspace web test src/lib/latency.test.ts`
Expected: FAIL(`Cannot find module './latency'`)。

- [ ] **Step 3: 实现** —— `web/src/lib/latency.ts`:

```ts
/** 语音链路延迟打点(设计文档 §3.2;测量方法见计划「延迟测量方法」)。只记时间,不记文本。 */
export type LatencyMark = "release" | "audio_ready" | "transcript" | "reply_first_delta" | "reply_done" | "tts_request" | "first_audio";

export interface LatencySpans {
  transcriptMs?: number;
  replyMs?: number;
  firstAudioAfterReplyMs?: number;
  firstAudioAfterReleaseMs?: number;
}

export interface LatencyRecord {
  id: number;
  kind: "voice" | "text";
  marks: Partial<Record<LatencyMark, number>>;
  spans: LatencySpans;
}

const MAX_RECORDS = 50;
const DEBUG_KEY = "enjoy-web.debug.latency";
const defaultClock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
let clock: () => number = defaultClock;
let current: LatencyRecord | null = null;
let nextId = 1;
let records: LatencyRecord[] = [];

function publish(): void {
  (globalThis as unknown as { __enjoyLatency?: readonly LatencyRecord[] }).__enjoyLatency = records;
}

function debugEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function latencySpans(marks: Partial<Record<LatencyMark, number>>): LatencySpans {
  const span = (from: LatencyMark, to: LatencyMark) => {
    const a = marks[from];
    const b = marks[to];
    return a === undefined || b === undefined ? undefined : Math.round(b - a);
  };
  const spans: LatencySpans = {
    transcriptMs: span("release", "transcript"),
    replyMs: span("transcript", "reply_done"),
    firstAudioAfterReplyMs: span("reply_done", "first_audio"),
    firstAudioAfterReleaseMs: span("release", "first_audio"),
  };
  for (const key of Object.keys(spans) as Array<keyof LatencySpans>) if (spans[key] === undefined) delete spans[key];
  return spans;
}

export function finishLatencyTrace(): void {
  if (!current) return;
  const done = current;
  current = null;
  records = [...records, done].slice(-MAX_RECORDS);
  publish();
  if (debugEnabled()) console.info("[latency]", { kind: done.kind, ...done.spans });
}

export function startLatencyTrace(kind: "voice" | "text"): void {
  finishLatencyTrace();
  current = { id: nextId++, kind, marks: {}, spans: {} };
}

export function markLatency(mark: LatencyMark): void {
  if (!current || current.marks[mark] !== undefined) return;
  current.marks[mark] = clock();
  current.spans = latencySpans(current.marks);
  if (mark === "first_audio") finishLatencyTrace();
}

export function latencyLog(): readonly LatencyRecord[] {
  return records;
}

export function resetLatencyForTest(now?: () => number): void {
  clock = now ?? defaultClock;
  current = null;
  nextId = 1;
  records = [];
  publish();
}
```

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/lib/latency.test.ts` → PASS(5 项)。

- [ ] **Step 5: 在链路上打点(不改行为)**
  - `use-voice-turn.ts`:`import { markLatency, startLatencyTrace } from "~/lib/latency";`。`stop()` 里 `stopping.current = true;` 之后加 `startLatencyTrace("voice"); markLatency("release");`;`accept()` 里 `recording.stoppedBy === "max_duration"` 时同样先 `startLatencyTrace("voice"); markLatency("release");`(用户点停止时 `stop()` 已开始记录,不重复);`transcribeDraft()` 中 `draft.wav = converted.wav;` 之后加 `markLatency("audio_ready");`,`const clean = (text ?? "").trim();` 之后加 `markLatency("transcript");`。
  - `use-auto-speak.ts`:`complete` 改为先 `if (status === "done") markLatency("reply_done");` 再 `return run(...)`。
  - `use-tts-player.ts`:`play()` 里 `setState(messageKey, "loading");` 之后加 `markLatency("tts_request");`;`await audio.play().catch(...)` 之后加 `markLatency("first_audio");`。
  - `api/ai.ts`:`streamChatCompletion` 内部包一层:`let first = true; const deltaWithMark = (full: string, piece: string) => { if (first) { first = false; markLatency("reply_first_delta"); } onDelta(full, piece); };`,把原来调用 `onDelta` 的地方改为 `deltaWithMark`。

  Run: `yarn workspace web test src/features/chat src/api src/audio` → 全部 PASS(打点不改变任何行为;若有用例失败,说明打点代码改变了控制流,改打点代码而不是测试)。

- [ ] **Step 6: 服务端写失败的测试** —— `server/tests/test_timing.py`:

```python
import logging

import httpx
import pytest

from app.timing import Stopwatch, log_timing

ARK = "https://ark.test/api/v3/chat/completions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "doubao-seed-2-0-lite-260428",
}
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20


def test_log_timing_format_is_sorted_and_numeric(caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    log_timing("stt_chat", status=200, ms=12.6, audio_bytes=44)
    assert caplog.messages == ["timing event=stt_chat audio_bytes=44 ms=13 status=200"]


def test_log_timing_never_writes_free_text(caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    log_timing("tts_volcengine", model="seed-tts-2.0", text="hello world, secret")
    assert caplog.messages == ["timing event=tts_volcengine model=seed-tts-2.0 text=?"]


def test_stopwatch_uses_the_injected_clock():
    ticks = iter([1.0, 1.25])
    assert Stopwatch(clock=lambda: next(ticks)).ms() == 250


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
async def test_chat_transcription_logs_timing_without_text(client, auth_headers, respx_mock, caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    respx_mock.post(ARK).mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "secret words"}}]})
    )
    r = await client.post(
        "/api/ai/audio/transcriptions", files={"file": ("a.wav", WAV, "audio/wav")}, headers=auth_headers
    )
    assert r.status_code == 200
    lines = [m for m in caplog.messages if m.startswith("timing event=stt_chat")]
    assert len(lines) == 1 and "audio_bytes=36" in lines[0] and "status=200" in lines[0]
    assert "secret" not in " ".join(caplog.messages)
```

- [ ] **Step 7: 运行确认失败** —— `cd server && uv run pytest tests/test_timing.py -q` → FAIL(`No module named 'app.timing'`)。

- [ ] **Step 8: 实现** —— `server/app/timing.py`:

```python
"""耗时日志:只记事件名与数字(设计文档 §3.2)。绝不记录用户文本、转写、回复或密钥。"""
import logging
import re
import time
from collections.abc import Callable

logger = logging.getLogger("app.timing")
_SAFE = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")


def _fmt(value: int | float | str) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(round(value))
    return value if _SAFE.fullmatch(value) else "?"


def log_timing(event: str, **fields: int | float | str) -> None:
    parts = " ".join(f"{key}={_fmt(fields[key])}" for key in sorted(fields))
    logger.info("timing event=%s %s", event, parts)


class Stopwatch:
    def __init__(self, clock: Callable[[], float] = time.perf_counter):
        self._clock = clock
        self._start = clock()

    def ms(self) -> int:
        return round((self._clock() - self._start) * 1000)
```

  `ai_audio.py`:`from app.timing import Stopwatch, log_timing`;`_chat_transcription` 在 `http: httpx.AsyncClient = …` 之前 `watch = Stopwatch()`,在 `check_upstream_auth(upstream.status_code)` 之前加 `log_timing("stt_chat", ms=watch.ms(), audio_bytes=len(audio), status=upstream.status_code)`(`httpx.HTTPError` 分支里也记一次,`status=0`);火山分支在 `try:` 前 `watch = Stopwatch()`,成功后 `log_timing("tts_volcengine", ms=watch.ms(), chars=len(payload.input), stream=False)`。

  注意 `test_log_timing_format_is_sorted_and_numeric` 里没有 `bool`;`stream=False` 走 `bool` 分支输出 `false`(`bool` 是 `int` 子类,必须先判断)。

- [ ] **Step 9: 运行确认通过** —— `cd server && uv run pytest tests/test_timing.py tests/test_ai_audio.py tests/test_ai_audio_chat_mode.py tests/test_volcengine_tts.py -q` → PASS;再全量 `uv run pytest -q` → 0 failed,通过数 = BASE_PY + 4。

- [ ] **Step 10: 门槛记录文件** —— 新建 `docs/superpowers/plans/2026-10-07-voice-gate-log.md`:

```markdown
# 语音提速 / 按住说话 / 实时通话 —— 门槛记录(计划 2026-10-07-voice-speed-hold-to-talk-realtime)

| 日期 | 阶段/任务 | 提交 | 命令 | 结果 |
|---|---|---|---|---|
| <开工日期> | 基线 | BASE=<短哈希> | `uv run pytest -q`;`yarn workspace web test` | BASE_PY=<N> passed;BASE_WEB=<N> passed |
```

  把开工时记录的真实数字填进去(不得留尖括号)。

- [ ] **Step 11: 提交**

```bash
git add web/src/lib/latency.ts web/src/lib/latency.test.ts web/src/features/chat/use-voice-turn.ts web/src/features/chat/use-auto-speak.ts web/src/features/chat/use-tts-player.ts web/src/api/ai.ts server/app/timing.py server/tests/test_timing.py server/app/routers/ai_audio.py docs/superpowers/plans/2026-10-07-voice-gate-log.md
git commit -m "feat: add latency marks on the voice pipeline and server timing logs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.2:测量工具(样本、服务端测量脚本、浏览器测量用例)与基线标签

**Files:**
- Create: `server/scripts/latency_samples.py`、`server/scripts/measure_latency.py`、`server/tests/test_latency_tools.py`
- Create: `web/e2e/latency.spec.ts`、`web/e2e/support/mic.ts`
- Modify: `web/playwright.config.cts`(假麦克风文件可由 `E2E_FAKE_AUDIO` 覆盖)
- Modify: `.gitignore`(追加 `.superpowers/latency/`,若 `.superpowers/` 已整体忽略则不改)

**Interfaces:**
- Consumes:Task 0.1 的 `window.__enjoyLatency`(`LatencyRecord[]`)。
- Produces:`make_sample(src: bytes, seconds: float) -> bytes`(输入 16 kHz 单声道 16 位 WAV,输出同格式、恰好 `seconds` 秒;不足则从头循环补足);`summarize(values: list[float]) -> dict`(`{"n", "median", "min", "max"}`,空列表抛 `ValueError`);`ratio(base: float, after: float) -> float`(保留 2 位小数);`markdown_row(metric: str, sample: str, base: float | None, after: float | None, target: str) -> str`;CLI `uv run python scripts/measure_latency.py --base-url URL --label baseline|after --runs 7 --out PATH`(只打印数字与状态码);`web/e2e/support/mic.ts` 的 `recordFor(page: Page, ms: number): Promise<void>`(兼容"点一下/再点一下"与"按住说话"两种麦克风按钮,按 `data-hold-to-talk` 属性区分;Task 3.5 与 5.x 复用)。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_latency_tools.py`:

```python
import io
import wave

import pytest

from scripts.latency_samples import make_sample
from scripts.measure_latency import markdown_row, ratio, summarize


def wav_bytes(seconds: float, rate: int = 16000) -> bytes:
    frames = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(int(i % 100).to_bytes(2, "little", signed=True) for i in range(frames)))
    return buf.getvalue()


def duration(data: bytes) -> float:
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 16000)
        return w.getnframes() / w.getframerate()


@pytest.mark.parametrize("seconds", [5.0, 15.0])
def test_make_sample_trims_or_loops_to_the_exact_length(seconds):
    assert duration(make_sample(wav_bytes(11.0), seconds)) == seconds


def test_make_sample_rejects_other_formats():
    with pytest.raises(ValueError):
        make_sample(wav_bytes(1.0, rate=44100), 1.0)


def test_summarize_median_min_max():
    assert summarize([300, 100, 200, 500, 400]) == {"n": 5, "median": 300, "min": 100, "max": 500}
    assert summarize([1, 2, 3, 4])["median"] == 2.5
    with pytest.raises(ValueError):
        summarize([])


def test_ratio_and_markdown_row():
    assert ratio(2000, 900) == 0.45
    assert markdown_row("松手 → 转写出现(浏览器)", "s5", 2000, 900, "≤ 50%") == (
        "| 松手 → 转写出现(浏览器) | s5 | 2000 | 900 | 45% | ≤ 50% | 达标 |"
    )
    assert markdown_row("回复完成 → 开始出声(浏览器)", "s5", 1500, 900, "≤ 40%").endswith("| 60% | ≤ 40% | 未达标 |")
    assert markdown_row("x", "s5", None, None, "参考") == "| x | s5 | 未测 | 未测 | — | 参考 | — |"
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_latency_tools.py -q` → FAIL(`No module named 'scripts.latency_samples'`)。

- [ ] **Step 3: 实现样本生成** —— `server/scripts/latency_samples.py`:

```python
"""生成延迟测量样本(计划「延迟测量方法」):s5.wav、s15.wav,16 kHz 单声道 16 位。

用法:cd server && uv run python scripts/latency_samples.py --out ../.superpowers/latency
"""
import argparse
import io
import wave
from pathlib import Path

RATE = 16000
SOURCE = Path(__file__).resolve().parents[2] / "enjoy" / "samples" / "jfk.wav"


def make_sample(src: bytes, seconds: float) -> bytes:
    with wave.open(io.BytesIO(src)) as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, RATE):
            raise ValueError("source must be 16 kHz mono 16-bit WAV")
        pcm = w.readframes(w.getnframes())
    need = int(seconds * RATE) * 2
    out = bytearray()
    while len(out) < need:
        out += pcm[: need - len(out)]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(out))
    return buf.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    src = SOURCE.read_bytes()
    for name, seconds in (("s5.wav", 5.0), ("s15.wav", 15.0)):
        (args.out / name).write_bytes(make_sample(src, seconds))
        print(f"wrote {args.out / name} ({seconds:.0f} s)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 实现测量脚本** —— `server/scripts/measure_latency.py`:

```python
"""服务端层延迟测量(计划「延迟测量方法」)。只打印数字与状态码,不打印密钥。

用法(先按 server/README.md 起本机 uvicorn,开放注册的临时库):
  uv run python scripts/measure_latency.py --base-url http://127.0.0.1:8765 --label baseline \
      --samples ../.superpowers/latency --runs 7 --out ../.superpowers/latency/baseline.json
"""
import argparse
import json
import statistics
import time
import uuid
from pathlib import Path

import httpx

REPLY_TEXT = "That sounds like a great plan. What time would you like to meet tomorrow?"
FIRST_SENTENCE = "That sounds like a great plan."


def summarize(values: list[float]) -> dict:
    if not values:
        raise ValueError("no values")
    return {"n": len(values), "median": statistics.median(values), "min": min(values), "max": max(values)}


def ratio(base: float, after: float) -> float:
    return round(after / base, 2)


def markdown_row(metric: str, sample: str, base: float | None, after: float | None, target: str) -> str:
    if base is None or after is None:
        b = "未测" if base is None else f"{base:.0f}"
        a = "未测" if after is None else f"{after:.0f}"
        return f"| {metric} | {sample} | {b} | {a} | — | {target} | — |"
    r = ratio(base, after)
    verdict = "—"
    if target.startswith("≤ ") and target.endswith("%"):
        verdict = "达标" if r * 100 <= float(target[2:-1]) else "未达标"
    return f"| {metric} | {sample} | {base:.0f} | {after:.0f} | {r * 100:.0f}% | {target} | {verdict} |"


def _timed(fn) -> tuple[float, httpx.Response]:
    start = time.perf_counter()
    response = fn()
    return (time.perf_counter() - start) * 1000, response


def run(base_url: str, samples: Path, runs: int, voice: str, tts_model: str) -> dict:
    with httpx.Client(base_url=base_url, timeout=300) as http:
        creds = {"username": f"lat_{uuid.uuid4().hex[:10]}", "password": "latency-password-123"}
        token = http.post("/api/users", json=creds).raise_for_status().json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        out: dict[str, dict] = {}
        for name in ("s5", "s15"):
            wav = (samples / f"{name}.wav").read_bytes()
            values = []
            for i in range(runs + 1):
                ms, r = _timed(lambda: http.post(
                    "/api/ai/audio/transcriptions", headers=headers,
                    files={"file": ("a.wav", wav, "audio/wav")}, data={"model": "whisper-1"}))
                print(f"stt {name} run={i} status={r.status_code} ms={ms:.0f}")
                if r.status_code != 200:
                    raise SystemExit(f"transcription failed with HTTP {r.status_code}")
                if i > 0:  # 第 0 次是热身
                    values.append(ms)
            out[f"stt_ms_{name}"] = summarize(values)
        for metric, text, stream in (("tts_full_ms", REPLY_TEXT, False), ("tts_first_sentence_ms", FIRST_SENTENCE, False),
                                     ("tts_first_chunk_ms", REPLY_TEXT, True)):
            values = []
            for i in range(runs + 1):
                body = {"input": f"{text} ({i})", "model": tts_model, "voice": voice}  # 后缀避免任何缓存
                if stream:
                    body["stream"] = True
                start = time.perf_counter()
                with http.stream("POST", "/api/ai/audio/speech", headers=headers, json=body) as r:
                    first = None
                    for chunk in r.iter_bytes():
                        if chunk and first is None:
                            first = (time.perf_counter() - start) * 1000
                    total = (time.perf_counter() - start) * 1000
                print(f"{metric} run={i} status={r.status_code} first={first or 0:.0f} total={total:.0f}")
                if r.status_code != 200:
                    raise SystemExit(f"speech failed with HTTP {r.status_code}")
                if i > 0:
                    values.append(first if stream else total)
            out[metric] = summarize(values)
        return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", required=True)
    p.add_argument("--label", choices=["baseline", "after"], required=True)
    p.add_argument("--samples", type=Path, required=True)
    p.add_argument("--runs", type=int, default=7)
    p.add_argument("--voice", default="en_female_dacey_uranus_bigtts")
    p.add_argument("--tts-model", default="volcengine/seed-tts-2.0")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    result = {"label": a.label, "at": time.strftime("%Y-%m-%d %H:%M:%S"), **run(a.base_url, a.samples, a.runs, a.voice, a.tts_model)}
    a.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
```

  说明:基线代码不认识 `stream`,`tts_first_chunk_ms` 在基线上等于整段时间(整段返回),这正是"之前"的真实首块时间。

- [ ] **Step 5: 运行确认通过** —— `cd server && uv run pytest tests/test_latency_tools.py -q` → PASS(5 项)。

- [ ] **Step 6: 浏览器测量用例** —— `web/playwright.config.cts` 把 `--use-file-for-fake-audio-capture=${SPEECH_WAV}` 改为 `--use-file-for-fake-audio-capture=${process.env.E2E_FAKE_AUDIO ?? SPEECH_WAV}`。新建 `web/e2e/support/mic.ts`:

```ts
import { expect, type Page } from "@playwright/test";

/** 兼容两种麦克风按钮:旧的"点一下开始、再点一下停止",新的"按住说话"(data-hold-to-talk)。 */
export async function recordFor(page: Page, ms: number): Promise<void> {
  const mic = page.getByTestId("chat-mic");
  const hold = (await mic.getAttribute("data-hold-to-talk")) !== null;
  if (hold) {
    const box = await mic.boundingBox();
    if (!box) throw new Error("mic button is not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(mic).toHaveAttribute("data-state", "recording");
    await page.waitForTimeout(ms); // 模拟说话时长:这里必须真实等待
    await page.mouse.up();
  } else {
    await mic.click();
    await expect(mic).toHaveAttribute("data-state", "recording");
    await page.waitForTimeout(ms);
    await mic.click();
  }
}
```

  新建 `web/e2e/latency.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { recordFor } from "./support/mic";

// 只在 E2E_LATENCY=1 时运行(需要真实上游;结果写进 docs/superpowers/plans/2026-10-07-voice-latency.md)。
// E2E_FAKE_AUDIO 指向 .superpowers/latency/s5.wav 或 s15.wav;E2E_HOLD_MS 是"说话"时长(5000 或 15000)。
const RUNS = Number(process.env.E2E_LATENCY_RUNS ?? "5");
const HOLD_MS = Number(process.env.E2E_HOLD_MS ?? "5000");

test("latency: release → transcript and reply → first audio", async ({ page, request, browserName }) => {
  test.skip(process.env.E2E_LATENCY !== "1", "set E2E_LATENCY=1 (real upstream required)");
  test.skip(browserName !== "chromium", "fake microphone file is a Chromium flag");
  test.setTimeout(RUNS * (HOLD_MS + 90_000) + 60_000);
  await signIn(page, request);
  await page.goto("/chat");
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("scenario-free").click();
  await expect(page.getByTestId("chat-mic")).toBeEnabled();
  const results: unknown[] = [];
  for (let i = 0; i < RUNS + 1; i++) {
    await recordFor(page, HOLD_MS);
    await expect.poll(async () => page.evaluate(() =>
      ((window as unknown as { __enjoyLatency?: Array<{ spans: { firstAudioAfterReleaseMs?: number } }> }).__enjoyLatency ?? [])
        .filter((r) => r.spans.firstAudioAfterReleaseMs !== undefined).length), { timeout: 120_000 }).toBe(i + 1);
    await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
    await page.getByTestId("conversation-autospeak").click(); // 停掉正在进行的朗读:关
    await page.getByTestId("conversation-autospeak").click(); // 再打开,下一轮照常自动朗读
  }
  const spans = await page.evaluate(() =>
    ((window as unknown as { __enjoyLatency: Array<{ spans: Record<string, number> }> }).__enjoyLatency).map((r) => r.spans));
  results.push(...spans.slice(1)); // 第一轮热身
  console.log(`LATENCY_RESULTS ${JSON.stringify({ holdMs: HOLD_MS, runs: results })}`);
});
```

  然后确认类型与列表正常:`yarn workspace web typecheck` → 0 错误;`cd web && npx playwright test --list e2e/latency.spec.ts` 列出 2 个用例(两个项目)。(不设 `E2E_LATENCY` 时用例跳过,不需要上游。)

- [ ] **Step 7: 提交并打基线标签**

```bash
git add server/scripts/latency_samples.py server/scripts/measure_latency.py server/tests/test_latency_tools.py web/e2e/latency.spec.ts web/e2e/support/mic.ts web/playwright.config.cts .gitignore
git commit -m "test: add latency samples, a server measurement script and a browser latency spec" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag voice-latency-baseline
```

  (`.gitignore` 没改就不 `add` 它。)标签名写进门槛记录。**从此刻起,任何优化提交都在这个标签之后(R2)。**

### Task 0.3:〔需上游〕连通性预检与识别请求参数 spike

**Files:**
- Create: `server/scripts/spikes/stt_params_spike.py`
- Create: `docs/superpowers/plans/2026-10-07-voice-spike-results.md`(本任务写第 1 节)

**Interfaces:**
- Consumes:Task 0.2 的 `.superpowers/latency/s5.wav`;`app.config.Settings`(进程内读取 `server/.env`,不打印任何值)。
- Produces:结论文档第 1 节「连通性与识别参数」:TTS 预检状态码、识别预检状态码、四种请求变体(基线 / +`max_tokens` / +`thinking: disabled` / 两者)各 3 次的状态码与耗时中位数、`<none>` 指令在一段纯噪声上的输出(是否严格输出 `<none>`)。Task 1.2 据此确定 `STT_DISABLE_THINKING` 的默认值。

- [ ] **Step 1: 征得用户同意**:在会话里说明"将产生约 15 次识别与 1 次 TTS 调用",得到明确同意后继续;未同意或账号未恢复 → 结论文档第 1 节写"阻塞:上游(<日期>,用户未确认/账号未恢复)",跳到 Task 0.6。

- [ ] **Step 2: 写脚本** —— `server/scripts/spikes/stt_params_spike.py`(spike 脚本不是产品代码,不写单元测试;只打印状态码、耗时与转写文本——样本是公开的 JFK 演讲):

```python
"""Spike:识别请求参数对延迟的影响(计划 Task 0.3)。不打印任何密钥或 URL 查询参数。

用法:cd server && uv run python scripts/spikes/stt_params_spike.py --wav ../.superpowers/latency/s5.wav
"""
import argparse
import base64
import statistics
import struct
import time
from pathlib import Path

import httpx

from app.config import Settings

PROMPT = (
    "Transcribe the audio verbatim in its original language. "
    "Output only the transcript text, without any extra words, quotes or timestamps. "
    "Only transcribe the nearest, clearest speaker and ignore background voices. "
    "If there is no clear foreground speech, output exactly <none>."
)


def noise_wav(seconds: float = 2.0, rate: int = 16000) -> bytes:
    import random
    rng = random.Random(7)
    pcm = b"".join(struct.pack("<h", int(rng.gauss(0, 300))) for _ in range(int(seconds * rate)))
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    return header + b"data" + struct.pack("<I", len(pcm)) + pcm


def call(http: httpx.Client, s: Settings, wav: bytes, extra: dict) -> tuple[int, float, str]:
    body = {
        "model": s.upstream_whisper_model, "temperature": 0,
        "messages": [{"role": "user", "content": [
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav).decode(), "format": "wav"}},
            {"type": "text", "text": PROMPT}]}],
        **extra,
    }
    start = time.perf_counter()
    r = http.post(s.upstream_whisper_base_url.rstrip("/") + "/chat/completions", json=body,
                  headers={"Authorization": f"Bearer {s.upstream_whisper_key}"})
    ms = (time.perf_counter() - start) * 1000
    text = ""
    if r.status_code == 200:
        text = r.json()["choices"][0]["message"].get("content") or ""
    return r.status_code, ms, text.strip()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--wav", type=Path, required=True)
    a = p.parse_args()
    s = Settings()
    print("whisper mode:", s.upstream_whisper_mode, "| model configured:", bool(s.upstream_whisper_model),
          "| key configured:", bool(s.upstream_whisper_key))
    wav = a.wav.read_bytes()
    variants = {
        "baseline": {},
        "max_tokens": {"max_tokens": 512},
        "no_thinking": {"thinking": {"type": "disabled"}},
        "both": {"max_tokens": 512, "thinking": {"type": "disabled"}},
    }
    with httpx.Client(timeout=120) as http:
        for name, extra in variants.items():
            runs = [call(http, s, wav, extra) for _ in range(3)]
            codes = [c for c, _, _ in runs]
            print(f"{name}: status={codes} median_ms={statistics.median(ms for _, ms, _ in runs):.0f} text={runs[0][2][:80]!r}")
        code, ms, text = call(http, s, noise_wav(), {"max_tokens": 512})
        print(f"noise-only: status={code} ms={ms:.0f} text={text!r}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 运行** —— 先跑 TTS 预检(一次):起本机 uvicorn(`run_in_background`,临时 SQLite,开放注册,端口 8765),然后

```bash
cd /e/workspace/everyone-can-use-english/server
curl -s --retry 30 --retry-connrefused --retry-delay 1 http://127.0.0.1:8765/up
TOKEN=$(curl -s -X POST http://127.0.0.1:8765/api/users -H 'Content-Type: application/json' \
  -d '{"username":"spike0","password":"password123"}' | uv run python -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
curl -s -o /dev/null -w "tts status=%{http_code}\n" -X POST http://127.0.0.1:8765/api/ai/audio/speech \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"input":"Hello.","model":"volcengine/seed-tts-2.0","voice":"en_female_dacey_uranus_bigtts"}'
uv run python scripts/spikes/stt_params_spike.py --wav ../.superpowers/latency/s5.wav
```

  Expected:`tts status=200`;四个变体都打印状态码与中位数。

- [ ] **Step 4: 写结论第 1 节** —— `docs/superpowers/plans/2026-10-07-voice-spike-results.md`:

```markdown
# 语音提速 spike 结论(计划 2026-10-07-voice-speed-hold-to-talk-realtime,阶段 0)

## 1. 连通性与识别参数(Task 0.3)

- 日期:<实际日期>;TTS 预检:<状态码>;识别模型:<模型名>(不含密钥)
- | 变体 | 状态码 ×3 | 中位数 (ms) |
  |---|---|---|
  | baseline | | |
  | max_tokens | | |
  | no_thinking | | |
  | both | | |
- 纯噪声样本输出:<原样>(是否严格为 `<none>`)
- 决定:`STT_DISABLE_THINKING` 默认 = <true/false>(no_thinking 变体返回 200 且不更慢 → true;返回 4xx → false)
```

  上游失败时只写"阻塞:上游(日期、状态码)"一行与决定"`STT_DISABLE_THINKING` 默认 true(未验证,Task 5.1 复核)"。

- [ ] **Step 5: 提交**

```bash
git add server/scripts/spikes/stt_params_spike.py docs/superpowers/plans/2026-10-07-voice-spike-results.md
git commit -m "docs: record the transcription parameter spike" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.4:〔需上游〕火山流式识别鉴权与帧协议 spike

**Files:**
- Create: `server/scripts/spikes/asr_stream_spike.py`
- Modify: `docs/superpowers/plans/2026-10-07-voice-spike-results.md`(第 2 节)

**Interfaces:**
- Consumes:`Settings.volcengine_tts_key`(进程内)、`.superpowers/latency/s5.wav`。
- Produces:结论第 2 节:哪一组鉴权头与资源 ID 能连上(或全部失败及返回码)、三个端点(`bigmodel`、`bigmodel_async`、`bigmodel_nostream`)的可用性、首个部分结果时间、最后一包 → 最终结果时间、服务端断句(`definite`)是否出现、错误帧格式样例(去敏)。**Task 1.6 的帧格式与鉴权以本节为准**;本节结论为"不可用"时 Task 1.6 不做(见 Task 1.6 开头的条件)。

协议要点(**未验证,以本 spike 实测为准**):4 字节头 —— byte0 = `(版本 0b0001 << 4) | 头长 0b0001`;byte1 = `(消息类型 << 4) | 标志`,类型 `0b0001` 完整客户端请求(JSON)、`0b0010` 纯音频、`0b1001` 完整服务端响应、`0b1111` 错误;标志 `0b0000` 无序号、`0b0001` 正序号、`0b0010` 最后一包无序号、`0b0011` 最后一包负序号;byte2 = `(序列化 << 4) | 压缩`,序列化 `0b0001` JSON / `0b0000` 无,压缩 `0b0001` gzip / `0b0000` 无;byte3 保留。之后(有序号时)4 字节大端序号、4 字节大端负载长度、负载。错误帧:头之后 4 字节错误码、4 字节长度、UTF-8 消息。

- [ ] **Step 1: 征得用户同意**(约 10 次连接,按时长计费,合计 < 2 分钟音频);未同意/未恢复 → 第 2 节写"阻塞:上游",跳到 Task 0.5。

- [ ] **Step 2: 写脚本** —— `server/scripts/spikes/asr_stream_spike.py`:

```python
"""Spike:火山大模型流式识别(计划 Task 0.4)。自带最小帧编解码,不依赖 app.asr_stream。

用法:cd server && uv run python scripts/spikes/asr_stream_spike.py --wav ../.superpowers/latency/s5.wav
只打印状态、耗时、帧类型与识别文本;绝不打印请求头的值。
"""
import argparse
import asyncio
import gzip
import json
import struct
import time
import uuid
import wave
from pathlib import Path

import websockets
from websockets.asyncio.client import connect

from app.config import Settings

BASE = "wss://openspeech.bytedance.com/api/v3/sauc/"
ENDPOINTS = ["bigmodel_async", "bigmodel", "bigmodel_nostream"]
RESOURCES = ["volc.bigasr.sauc.duration", "volc.seedasr.sauc.duration", "volc.bigasr.sauc.concurrent"]


def header(msg_type: int, flags: int, serialization: int, compression: int) -> bytes:
    return bytes([0x11, (msg_type << 4) | flags, (serialization << 4) | compression, 0])


def full_request(seq: int) -> bytes:
    payload = gzip.compress(json.dumps({
        "user": {"uid": "spike"},
        "audio": {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1, "codec": "raw"},
        "request": {"model_name": "bigmodel", "enable_punc": True, "enable_itn": True, "show_utterances": True,
                    "end_window_size": 800},
    }).encode())
    return header(0b0001, 0b0001, 0b0001, 0b0001) + struct.pack(">iI", seq, len(payload)) + payload


def audio_packet(pcm: bytes, seq: int, last: bool) -> bytes:
    body = gzip.compress(pcm)
    flags = 0b0011 if last else 0b0001
    return header(0b0010, flags, 0b0000, 0b0001) + struct.pack(">iI", -seq if last else seq, len(body)) + body


def decode(data: bytes) -> dict:
    msg_type, flags = data[1] >> 4, data[1] & 0x0F
    compression = data[2] & 0x0F
    pos = 4
    out: dict = {"type": msg_type, "flags": flags}
    if msg_type == 0b1111:
        code, size = struct.unpack(">II", data[pos:pos + 8])
        out.update(error_code=code, message=data[pos + 8:pos + 8 + size].decode("utf-8", "replace")[:200])
        return out
    if flags & 0b0001:
        out["seq"] = struct.unpack(">i", data[pos:pos + 4])[0]
        pos += 4
    size = struct.unpack(">I", data[pos:pos + 4])[0]
    body = data[pos + 4:pos + 4 + size]
    if compression == 0b0001:
        body = gzip.decompress(body)
    out["payload"] = json.loads(body) if body else None
    return out


async def attempt(url: str, headers: dict, pcm: bytes, realtime: bool) -> dict:
    t0 = time.perf_counter()
    report: dict = {"url": url.rsplit("/", 1)[-1], "auth": sorted(headers), "realtime": realtime}
    try:
        async with connect(url, additional_headers=headers, max_size=8 * 1024 * 1024, open_timeout=10) as ws:
            report["connect_ms"] = round((time.perf_counter() - t0) * 1000)
            report["logid"] = bool(ws.response.headers.get("X-Tt-Logid"))
            await ws.send(full_request(1))
            first = decode(await ws.recv())
            report["handshake_frame"] = {k: v for k, v in first.items() if k != "payload"}
            chunk = 3200  # 100 ms
            seq = 2
            last_sent = 0.0

            async def sender():
                nonlocal seq, last_sent
                for i in range(0, len(pcm), chunk):
                    last = i + chunk >= len(pcm)
                    await ws.send(audio_packet(pcm[i:i + chunk], seq, last))
                    seq += 1
                    if realtime:
                        await asyncio.sleep(0.1)
                last_sent = time.perf_counter()

            task = asyncio.create_task(sender())
            first_partial = None
            final_text, definite = "", False
            async for raw in ws:
                frame = decode(raw)
                if frame["type"] == 0b1111:
                    report["error"] = {"code": frame["error_code"], "message": frame["message"]}
                    break
                result = (frame.get("payload") or {}).get("result") or {}
                text = result.get("text") or ""
                if text and first_partial is None:
                    first_partial = round((time.perf_counter() - t0) * 1000)
                definite = definite or any(u.get("definite") for u in result.get("utterances") or [])
                final_text = text or final_text
                if frame["flags"] in (0b0010, 0b0011):
                    break
            await task
            report.update(first_partial_ms=first_partial, final_after_last_packet_ms=round((time.perf_counter() - last_sent) * 1000),
                          definite_seen=definite, text=final_text[:120])
    except websockets.InvalidStatus as e:
        report["http_status"] = e.response.status_code
    except (OSError, websockets.WebSocketException, TimeoutError) as e:
        report["failure"] = type(e).__name__
    return report


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--wav", type=Path, required=True)
    a = p.parse_args()
    s = Settings()
    key = s.volcengine_tts_key
    print("volcengine key configured:", bool(key))
    with wave.open(str(a.wav)) as w:
        pcm = w.readframes(w.getnframes())
    for endpoint in ENDPOINTS:
        for resource in RESOURCES:
            headers = {"X-Api-Key": key, "X-Api-Resource-Id": resource, "X-Api-Connect-Id": str(uuid.uuid4())}
            print(json.dumps({"resource": resource, **await attempt(BASE + endpoint, headers, pcm, realtime=False)}, ensure_ascii=False))
    # 找到可用组合后,按实时节奏再跑一次(把它填进下面两行后重跑脚本):
    # print(json.dumps(await attempt(BASE + "<endpoint>", {...}, pcm, realtime=True)))


if __name__ == "__main__":
    asyncio.run(main())
```

  若 `X-Api-Key` 方式全部返回 401/403:按当时的火山文档改用 `X-Api-App-Key` + `X-Api-Access-Key`(需要用户在控制台开通"大模型流式语音识别"并提供 App ID 与 Access Token,写进 `server/.env` 的 `ASR_STREAM_APP_ID`/`ASR_STREAM_ACCESS_KEY`——**这两个配置项只有在此情况下才在 Task 1.1 增加**,并记录在结论里)。

- [ ] **Step 3: 运行** —— `cd server && uv run python scripts/spikes/asr_stream_spike.py --wav ../.superpowers/latency/s5.wav`;找到可用组合后取消注释最后两行、填入组合,再跑一次实时节奏。

- [ ] **Step 4: 写结论第 2 节**(格式):

```markdown
## 2. 流式识别(Task 0.4)

- 日期:<日期>
- | 端点 | 资源 ID | 鉴权方式 | 结果(HTTP 状态 / 错误码 / 成功) | 首个部分结果 (ms) | 最后一包 → 最终 (ms) | definite |
  |---|---|---|---|---|---|---|
- 帧格式与上文"协议要点"的差异:<逐条;没有差异写"一致">
- 结论:ASR 走向 = `stream`(端点 <…>、资源 <…>、鉴权 <…>)/ `buffered`(原因 <…>)
```

- [ ] **Step 5: 提交**

```bash
git add server/scripts/spikes/asr_stream_spike.py docs/superpowers/plans/2026-10-07-voice-spike-results.md
git commit -m "docs: record the streaming ASR auth and framing spike" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.5:〔需上游〕TTS 分块 spike 与延迟基线测量

**Files:**
- Create: `server/scripts/spikes/tts_chunk_spike.py`
- Create: `docs/superpowers/plans/2026-10-07-voice-latency.md`
- Modify: `docs/superpowers/plans/2026-10-07-voice-spike-results.md`(第 3 节)

**Interfaces:**
- Consumes:Task 0.2 的样本、`measure_latency.py`、`latency.spec.ts`、标签 `voice-latency-baseline`。
- Produces:结论第 3 节(火山单向 TTS 的首块时间 vs 整段时间、`format: "mp3"` 与 `format: "pcm"` 两种、块大小分布、`pcm` 的采样率是否按请求的 24000);延迟表的"基线"列;`.superpowers/latency/baseline.json` 与浏览器 `LATENCY_RESULTS` 原始输出(不提交)。

- [ ] **Step 1: 征得用户同意**(约 30 次 TTS、14 次识别);未同意/未恢复 → 第 3 节与延迟表基线列写"阻塞:上游",跳到 Task 0.6。

- [ ] **Step 2: 写 spike 脚本** —— `server/scripts/spikes/tts_chunk_spike.py`:

```python
"""Spike:火山单向 TTS 的分块到达时间(计划 Task 0.5)。不打印密钥。

用法:cd server && uv run python scripts/spikes/tts_chunk_spike.py
"""
import base64
import json
import statistics
import time

import httpx

from app.config import Settings

TEXT = "That sounds like a great plan. What time would you like to meet tomorrow?"


def run(fmt: str, s: Settings) -> dict:
    body = {"user": {"uid": "spike"}, "req_params": {"text": TEXT, "speaker": "en_female_dacey_uranus_bigtts",
                                                     "audio_params": {"format": fmt, "sample_rate": 24000}}}
    headers = {"X-Api-Key": s.volcengine_tts_key, "X-Api-Resource-Id": "seed-tts-2.0"}
    decoder = json.JSONDecoder()
    t0 = time.perf_counter()
    first, sizes, buf = None, [], ""
    with httpx.Client(timeout=60) as http, http.stream("POST", s.volcengine_tts_url, json=body, headers=headers) as r:
        status = r.status_code
        for text in r.iter_text():
            buf += text
            while True:
                stripped = buf.lstrip()
                if not stripped:
                    buf = ""
                    break
                try:
                    item, end = decoder.raw_decode(stripped)
                except ValueError:
                    buf = stripped
                    break
                buf = stripped[end:]
                data = item.get("data") if isinstance(item, dict) else None
                if isinstance(data, str) and data:
                    if first is None:
                        first = (time.perf_counter() - t0) * 1000
                    sizes.append(len(base64.b64decode(data)))
    total = (time.perf_counter() - t0) * 1000
    return {"format": fmt, "status": status, "first_ms": round(first or 0), "total_ms": round(total),
            "chunks": len(sizes), "median_chunk_bytes": statistics.median(sizes) if sizes else 0, "bytes": sum(sizes)}


if __name__ == "__main__":
    settings = Settings()
    print("volcengine key configured:", bool(settings.volcengine_tts_key))
    for fmt in ("mp3", "pcm"):
        for _ in range(3):
            print(json.dumps(run(fmt, settings)))
```

  `pcm` 的采样率核对:`bytes / 2 / 24000` 应约等于该句朗读时长(2–5 s);明显不符就记录实际采样率。

- [ ] **Step 3: 运行 spike** —— `cd server && uv run python scripts/spikes/tts_chunk_spike.py`。

- [ ] **Step 4: 基线测量(在标签代码上)**

```bash
cd /e/workspace/everyone-can-use-english
git worktree add ../ecue-baseline voice-latency-baseline
(cd server && uv run python scripts/latency_samples.py --out ../.superpowers/latency)
```

  服务端层:在 `../ecue-baseline/server` 下用临时 SQLite 起 uvicorn(端口 8765,`run_in_background`,`--env-file` 指向**本仓库**的 `server/.env`:`uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8765 --env-file /e/workspace/everyone-can-use-english/server/.env`,同时用环境变量覆盖 `DATABASE_URL=sqlite+aiosqlite:///./data/latency.db REGISTRATION_MODE=open`,先 `alembic upgrade head`),然后:

```bash
cd /e/workspace/everyone-can-use-english/server
uv run python scripts/measure_latency.py --base-url http://127.0.0.1:8765 --label baseline \
  --samples ../.superpowers/latency --runs 7 --out ../.superpowers/latency/baseline.json
```

  浏览器层:按 `web/README.md` 在 `../ecue-baseline` 起 E2E 栈(`docker compose -p enjoy-e2e …`,它用本仓库同一份 `server/.env`),然后每个样本各一次:

```bash
cd ../ecue-baseline/web
E2E_LATENCY=1 E2E_FAKE_AUDIO=/e/workspace/everyone-can-use-english/.superpowers/latency/s5.wav E2E_HOLD_MS=5000 \
  yarn playwright test e2e/latency.spec.ts --project=chromium-mobile 2>&1 | grep LATENCY_RESULTS
E2E_LATENCY=1 E2E_FAKE_AUDIO=/e/workspace/everyone-can-use-english/.superpowers/latency/s15.wav E2E_HOLD_MS=15000 \
  yarn playwright test e2e/latency.spec.ts --project=chromium-mobile 2>&1 | grep LATENCY_RESULTS
```

  (`latency.spec.ts` 在标签代码里已存在,见 Task 0.2。)测完 `docker compose -p enjoy-e2e … down`、停 uvicorn、`git worktree remove ../ecue-baseline`。

- [ ] **Step 5: 建延迟表** —— `docs/superpowers/plans/2026-10-07-voice-latency.md`:写「测量方法」(复制计划同名一节的要点:样本、两层、N、中位数、同日同网)、「环境」(日期时间、机器、网络、提交 `voice-latency-baseline` 的哈希、识别/TTS/LLM 模型名)、上文的结果表(基线列用中位数,其余列"未测"),附原始中位数/最小/最大值。用 `measure_latency.py` 的 `summarize` 处理浏览器 `LATENCY_RESULTS` 里的 `transcriptMs` 与 `firstAudioAfterReplyMs`(`uv run python -c` 读入 JSON 调用即可)。

- [ ] **Step 6: 写结论第 3 节**(格式):

```markdown
## 3. TTS 分块(Task 0.5)

- | 格式 | 状态码 | 首块 (ms) 中位数 | 整段 (ms) 中位数 | 块数 | 块大小中位数 | pcm 实测采样率 |
  |---|---|---|---|---|---|---|
- 结论:首块明显早于整段(差值 ≥ 300 ms)→ `stream=true` 透传值得做(R6);实时通话下行格式 = `pcm` 24 kHz(或 spike 实测的采样率,写进 Task 4.4 的 `REALTIME_TTS_SAMPLE_RATE`)。
```

- [ ] **Step 7: 提交**

```bash
git add server/scripts/spikes/tts_chunk_spike.py docs/superpowers/plans/2026-10-07-voice-latency.md docs/superpowers/plans/2026-10-07-voice-spike-results.md
git commit -m "docs: record the TTS chunk spike and the latency baseline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.6:Spike 结论与决定

**Files:**
- Modify: `docs/superpowers/plans/2026-10-07-voice-spike-results.md`(第 4 节「决定」)
- Modify: `docs/superpowers/plans/e2e-results.md`(OPEN ACCEPTANCE ITEMS 追加第 7 条)

**Interfaces:**
- Consumes:Task 0.3–0.5 的结论。
- Produces:四个决定,后续任务按它们分支:`ASR_MODE ∈ {stream, buffered}`(决定 Task 1.6 是否执行)、`STT_DISABLE_THINKING` 默认值、`REALTIME_TTS_SAMPLE_RATE`(默认 24000)、修订后的验收目标(没有实测依据时保持设计文档的 50% / 40%)。

- [ ] **Step 1: 写第 4 节**:

```markdown
## 4. 决定(Task 0.6)

| 决定 | 值 | 依据 |
|---|---|---|
| ASR 走向 | stream / buffered | 第 2 节 |
| STT_DISABLE_THINKING 默认值 | true / false | 第 1 节 |
| 实时下行 TTS 格式 | pcm,<采样率> Hz | 第 3 节 |
| 验收目标 | 转写 ≤ <x>%,首句出声 ≤ <y>% | 基线数字;无实测时保持 50% / 40% |
| 阻塞项 | <列出所有"阻塞:上游"的步骤,或"无"> | |
```

- [ ] **Step 2: OPEN 项** —— `e2e-results.md` 的 OPEN ACCEPTANCE ITEMS 追加:`7. **语音提速与实时通话的真实上游验收**(计划 2026-10-07):延迟基线/对比、流式识别、实时通话端到端依赖火山 TTS 与方舟识别恢复;状态见 docs/superpowers/plans/2026-10-07-voice-spike-results.md 与 2026-10-07-voice-latency.md。`

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/plans/2026-10-07-voice-spike-results.md docs/superpowers/plans/e2e-results.md
git commit -m "docs: decide the ASR path and latency targets from the spikes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 验收门槛 0

- [ ] `cd server && uv run pytest -q` → 0 failed,通过数 = BASE_PY + 9(Task 0.1 的 4 项 + Task 0.2 的 5 项;以输出为准写进门槛记录)。
- [ ] `yarn workspace web typecheck` 0 错误;`for i in 1 2 3; do yarn workspace web test 2>&1 | tail -3; done` 三次 0 failed,通过数 = BASE_WEB + 5。
- [ ] `git tag --list voice-latency-baseline` 有输出,且 `git log --oneline voice-latency-baseline..HEAD` 里没有任何 `feat`/`perf` 提交(只有 docs/test)。
- [ ] `2026-10-07-voice-spike-results.md` 第 4 节填写完整(每个决定都有值;阻塞项如实列出)。
- [ ] 〔需上游〕延迟表"基线"列已填,或明确写"阻塞:上游(日期、返回码)"。
- [ ] `git grep -nE "XFYUN_API_(KEY|SECRET)=.+|UPSTREAM_[A-Z]+_KEY=.+|VOLCENGINE_TTS_KEY=.+|X-Api-Key\": \"[0-9a-f-]{20,}" -- . ':!server/.env' ':!server/.env.bak-*'` → 无输出;`git status --short server/` 不含 `.env*`。

---
## 阶段 1:服务端

### Task 1.1:配置项

**Files:**
- Modify: `server/app/config.py`(在 `max_vocab_items` 之后新增一块)
- Modify: `server/.env.example`
- Create: `server/tests/test_realtime_settings.py`

**Interfaces:**
- Consumes:既有 `Settings`、`tests/conftest.py` 的 `make_settings`。
- Produces:`Settings` 新字段 —— `stt_max_tokens: int = 512`、`stt_disable_thinking: bool = True`(Task 0.6 决定为 false 时默认值改为 `False`)、`realtime_enabled: bool = False`、`realtime_max_minutes: int = 10`(1–60)、`realtime_idle_timeout_seconds: int = 60`(10–600)、`realtime_max_sessions: int = 5`(1–100)、`realtime_ticket_ttl_seconds: int = 60`(10–300)、`realtime_tts_model: str = "volcengine/seed-tts-2.0"`、`realtime_tts_sample_rate: int = 24000`;属性 `asr_stream_enabled -> bool`(`upstream_asr_mode == "volc_stream"`;`upstream_asr_mode`、`asr_stream_url`、`asr_stream_resource_id`、`volcengine_asr_key` 与属性 `asr_stream_key` 已由 spike 提交加入)、`realtime_available -> bool`(`realtime_enabled` 且 `volcengine_tts_key` 非空、`realtime_tts_model` 在 `tts_model_list` 里、`upstream_llm_base_url` 非空、并且 `asr_stream_enabled` 或 `upstream_whisper_base_url` 非空)。若 Task 0.4 结论要求 App ID + Access Token 鉴权,再加 `asr_stream_app_id: str = ""`、`asr_stream_access_key: str = ""`。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_realtime_settings.py`:

```python
import pytest
from pydantic import ValidationError

from tests.conftest import make_settings

VOLC = {
    "volcengine_tts_key": "volc-secret",
    "tts_models": "openai/tts-1,volcengine/seed-tts-2.0",
}


def test_defaults_are_conservative():
    s = make_settings()
    assert s.realtime_enabled is False
    assert s.asr_stream_enabled is False  # upstream_asr_mode 默认 chat
    assert (s.realtime_max_minutes, s.realtime_idle_timeout_seconds) == (10, 60)
    assert (s.realtime_max_sessions, s.realtime_ticket_ttl_seconds) == (5, 60)
    assert s.stt_max_tokens == 512
    assert s.realtime_tts_sample_rate == 24000


def test_asr_stream_key_falls_back_to_the_tts_key():
    assert make_settings(**VOLC).asr_stream_key == "volc-secret"
    assert make_settings(**VOLC, volcengine_asr_key="own").asr_stream_key == "own"


def test_realtime_available_needs_every_upstream():
    assert make_settings(**VOLC).realtime_available is False  # 未开启
    assert make_settings(**VOLC, realtime_enabled=True).realtime_available is True
    assert make_settings(realtime_enabled=True).realtime_available is False  # 没有火山 TTS
    assert make_settings(**VOLC, realtime_enabled=True, upstream_llm_base_url="").realtime_available is False
    assert make_settings(**VOLC, realtime_enabled=True, upstream_whisper_base_url="").realtime_available is False
    assert make_settings(**VOLC, realtime_enabled=True, upstream_whisper_base_url="", upstream_asr_mode="volc_stream").realtime_available is True


@pytest.mark.parametrize("field,value", [
    ("realtime_max_minutes", 0), ("realtime_max_minutes", 61),
    ("realtime_idle_timeout_seconds", 5), ("realtime_max_sessions", 0), ("realtime_ticket_ttl_seconds", 301),
])
def test_limits_are_bounded(field, value):
    with pytest.raises(ValidationError):
        make_settings(**{field: value})
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_realtime_settings.py -q` → FAIL(`Settings` 没有这些字段)。

- [ ] **Step 3: 实现** —— `config.py`:import 加 `from pydantic import Field`;在 `max_vocab_items: int = 2000` 之后插入:

```python
    # ---- 语音提速与实时通话(设计文档 2026-10-07)----
    stt_max_tokens: int = 512
    stt_disable_thinking: bool = True
    # UPSTREAM_ASR_MODE / ASR_STREAM_URL / ASR_STREAM_RESOURCE_ID / VOLCENGINE_ASR_KEY 已存在(spike 提交)
    realtime_enabled: bool = False
    realtime_max_minutes: int = Field(10, ge=1, le=60)
    realtime_idle_timeout_seconds: int = Field(60, ge=10, le=600)
    realtime_max_sessions: int = Field(5, ge=1, le=100)
    realtime_ticket_ttl_seconds: int = Field(60, ge=10, le=300)
    realtime_tts_model: str = "volcengine/seed-tts-2.0"
    realtime_tts_sample_rate: int = 24000
```

  属性(放在 `grammar_upstream` 之后):

```python
    @property
    def asr_stream_enabled(self) -> bool:
        # 已有的 asr_stream_key 属性 = VOLCENGINE_ASR_KEY 或 VOLCENGINE_TTS_KEY
        return self.upstream_asr_mode == "volc_stream"

    @property
    def realtime_available(self) -> bool:
        return (
            self.realtime_enabled
            and bool(self.volcengine_tts_key)
            and self.realtime_tts_model in self.tts_model_list
            and bool(self.upstream_llm_base_url)
            and (self.asr_stream_enabled or bool(self.upstream_whisper_base_url))
        )
```

  `server/.env.example` 在 `MAX_VOCAB_ITEMS=2000` 之后追加:

```env
# ---- 语音提速与实时通话(计划 2026-10-07)----
# chat 模式识别:限制输出长度;关闭"深度思考"(若方舟模型不接受该参数,改为 false)
STT_MAX_TOKENS=512
STT_DISABLE_THINKING=true
# 火山大模型流式识别的开关与配置已在上方(UPSTREAM_ASR_MODE 等,spike 提交)
# 实时通话(默认关;需要火山 TTS、LLM 与识别都可用)
REALTIME_ENABLED=false
REALTIME_MAX_MINUTES=10
REALTIME_IDLE_TIMEOUT_SECONDS=60
REALTIME_MAX_SESSIONS=5
REALTIME_TICKET_TTL_SECONDS=60
REALTIME_TTS_MODEL=volcengine/seed-tts-2.0
REALTIME_TTS_SAMPLE_RATE=24000
```

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_realtime_settings.py tests/test_config.py tests/test_chat_settings.py -q` → PASS;全量 `uv run pytest -q` → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/config.py server/.env.example server/tests/test_realtime_settings.py
git commit -m "feat(server): add settings for faster transcription, streaming ASR and realtime calls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.2:识别核心抽出、提示词抗噪与提速参数

**Files:**
- Create: `server/app/stt.py`、`server/tests/test_stt_prompt.py`
- Modify: `server/app/routers/ai_audio.py`(`_chat_transcription` 改为调用 `transcribe_chat`;`CHAT_PROMPT` 移到 `stt.py`,`ai_audio.py` 保留 `from app.stt import CHAT_PROMPT` 以兼容)

**Interfaces:**
- Consumes:Task 1.1 的 `stt_max_tokens`、`stt_disable_thinking`;Task 0.1 的 `log_timing`、`Stopwatch`。
- Produces:`NO_SPEECH_TOKEN = "<none>"`;`CHAT_PROMPT`(含 `verbatim`、`nearest, clearest speaker`、`<none>`);`chat_body(settings, audio: bytes, fmt: str, language: str | None) -> dict`;`async transcribe_chat(http, settings, audio: bytes, fmt: str, language: str | None) -> str`(命中 `<none>` 返回 `""`;上游鉴权失败 `HTTPException(502, "Upstream authentication failed")`;其余失败 `HTTPException(502, "Upstream unavailable")`;未配置 `HTTPException(503, "Whisper upstream is not configured")`);`pcm_to_wav(pcm: bytes, rate: int = 16000) -> bytes`;`async transcribe_wav(http, settings, wav: bytes, language: str | None = "en") -> str`(按 `upstream_whisper_mode` 分派:`chat` → `transcribe_chat`;`openai` → multipart 转发到 `/audio/transcriptions` 并取 `text`)。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_stt_prompt.py`:

```python
import io
import json
import wave

import httpx
import pytest

from app.stt import CHAT_PROMPT, NO_SPEECH_TOKEN, pcm_to_wav, transcribe_wav
from tests.conftest import make_settings

ARK = "https://ark.test/api/v3/chat/completions"
WHISPER = "https://whisper.test/v1/audio/transcriptions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "doubao-seed-2-0-lite-260428",
}
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20


def ok(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


async def post(client, headers, **form):
    return await client.post("/api/ai/audio/transcriptions", files={"file": ("a.wav", WAV, "audio/wav")},
                             data=form, headers=headers)


def test_prompt_keeps_verbatim_and_adds_foreground_rules():
    assert "verbatim" in CHAT_PROMPT
    assert "nearest, clearest speaker" in CHAT_PROMPT
    assert NO_SPEECH_TOKEN == "<none>" and NO_SPEECH_TOKEN in CHAT_PROMPT


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
async def test_body_has_speed_parameters(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok("hi"))
    assert (await post(client, auth_headers)).status_code == 200
    body = json.loads(route.calls.last.request.content)
    assert body["max_tokens"] == 512
    assert body["thinking"] == {"type": "disabled"}


@pytest.mark.parametrize("settings_overrides", [{**CHAT, "stt_disable_thinking": False, "stt_max_tokens": 64}], indirect=True)
async def test_speed_parameters_follow_settings(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok("hi"))
    await post(client, auth_headers)
    body = json.loads(route.calls.last.request.content)
    assert body["max_tokens"] == 64 and "thinking" not in body


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
@pytest.mark.parametrize("content", ["<none>", " <NONE>\n", "<None>"])
async def test_no_speech_token_is_an_empty_transcript(client, auth_headers, respx_mock, content):
    respx_mock.post(ARK).mock(return_value=ok(content))
    r = await post(client, auth_headers)
    assert r.status_code == 200
    assert r.json() == {"text": "", "segments": []}


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
async def test_language_hint_still_appended(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok("hi"))
    await post(client, auth_headers, language="en-US")
    text = json.loads(route.calls.last.request.content)["messages"][0]["content"][1]["text"]
    assert text.endswith("The audio language is en.")


def test_pcm_to_wav_is_16k_mono_16bit():
    data = pcm_to_wav(b"\x01\x00" * 1600)
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, 1600)


async def test_transcribe_wav_dispatches_by_mode(respx_mock):
    async with httpx.AsyncClient() as http:
        respx_mock.post(ARK).mock(return_value=ok("chat text"))
        assert await transcribe_wav(http, make_settings(**CHAT), pcm_to_wav(b"\x00\x00" * 160)) == "chat text"
        route = respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json={"text": " whisper text "}))
        assert await transcribe_wav(http, make_settings(), pcm_to_wav(b"\x00\x00" * 160), "en") == "whisper text"
        assert b'name="language"' in route.calls.last.request.content
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_stt_prompt.py -q` → FAIL(`No module named 'app.stt'`)。

- [ ] **Step 3: 实现** —— `server/app/stt.py`:

```python
"""识别核心(上传识别与实时通话兜底共用)。日志只记耗时与字节数。"""
import base64
import io
import wave

import httpx
from fastapi import HTTPException

from app.config import Settings
from app.timing import Stopwatch, log_timing
from app.upstream import check_upstream_auth

NO_SPEECH_TOKEN = "<none>"
CHAT_PROMPT = (
    "Transcribe the audio verbatim in its original language. "
    "Output only the transcript text, without any extra words, quotes or timestamps. "
    "Only transcribe the nearest, clearest speaker and ignore background voices. "
    f"If there is no clear foreground speech, output exactly {NO_SPEECH_TOKEN}."
)
TIMEOUT = httpx.Timeout(300.0, connect=10.0)


def _language_hint(language: str | None) -> str:
    if not isinstance(language, str):
        return ""
    primary = language.strip().replace("_", "-").split("-")[0].lower()
    return f" The audio language is {primary}." if primary.isalpha() and len(primary) <= 8 else ""


def chat_body(settings: Settings, audio: bytes, fmt: str, language: str | None) -> dict:
    body: dict = {
        "model": settings.upstream_whisper_model,
        "temperature": 0,
        "max_tokens": settings.stt_max_tokens,
        "messages": [{"role": "user", "content": [
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": fmt}},
            {"type": "text", "text": CHAT_PROMPT + _language_hint(language)},
        ]}],
    }
    if settings.stt_disable_thinking:
        body["thinking"] = {"type": "disabled"}
    return body


def _extract_text(response: httpx.Response) -> str:
    try:
        text = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "Upstream unavailable")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(502, "Upstream unavailable")
    text = text.strip()
    return "" if text.lower() == NO_SPEECH_TOKEN else text


async def transcribe_chat(http: httpx.AsyncClient, settings: Settings, audio: bytes, fmt: str, language: str | None) -> str:
    if not settings.upstream_whisper_base_url or not settings.upstream_whisper_model:
        raise HTTPException(503, "Whisper upstream is not configured")
    watch = Stopwatch()
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/chat/completions",
            json=chat_body(settings, audio, fmt, language),
            headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        log_timing("stt_chat", ms=watch.ms(), audio_bytes=len(audio), status=0)
        raise HTTPException(502, "Upstream unavailable")
    log_timing("stt_chat", ms=watch.ms(), audio_bytes=len(audio), status=upstream.status_code)
    check_upstream_auth(upstream.status_code)
    if not upstream.is_success:
        raise HTTPException(502, "Upstream unavailable")
    return _extract_text(upstream)


def pcm_to_wav(pcm: bytes, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


async def transcribe_wav(http: httpx.AsyncClient, settings: Settings, wav: bytes, language: str | None = "en") -> str:
    if settings.upstream_whisper_mode == "chat":
        return await transcribe_chat(http, settings, wav, "wav", language)
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")
    data = {"model": "whisper-1", "response_format": "json"}
    if language:
        data["language"] = language
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions",
            files={"file": ("audio.wav", wav, "audio/wav")}, data=data,
            headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"}, timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    check_upstream_auth(upstream.status_code)
    if not upstream.is_success:
        raise HTTPException(502, "Upstream unavailable")
    try:
        text = upstream.json()["text"]
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, "Upstream unavailable")
    return text.strip() if isinstance(text, str) else ""
```

  `ai_audio.py`:删除本地的 `CHAT_PROMPT`、`_extract_text`,改为 `from app.stt import CHAT_PROMPT, transcribe_chat  # noqa: F401(CHAT_PROMPT 供旧的导入方使用)`;`_chat_transcription` 在 `fmt = _audio_format(audio)` 之后整段替换为:

```python
    text = await transcribe_chat(
        request.app.state.http, settings, audio, fmt, language if isinstance(language, str) else None
    )
    return JSONResponse({"text": text, "segments": []})
```

  (Task 0.1 在这里加的 `stt_chat` 打点随之移到 `transcribe_chat` 内,`test_timing.py` 不改仍通过。)

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_stt_prompt.py tests/test_ai_audio_chat_mode.py tests/test_ai_audio.py tests/test_timing.py -q` → PASS(既有 `test_upstream_problems_are_502` 的空串/空白用例仍是 502,因为只有 `<none>` 映射为空转写——R4)。全量 `uv run pytest -q` → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/stt.py server/app/routers/ai_audio.py server/tests/test_stt_prompt.py
git commit -m "perf(server): cap transcription output, skip thinking and ignore background voices" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.3:TTS 分块透传

**Files:**
- Modify: `server/app/volcengine.py`(新增 `StreamParser`、`synthesize_stream`;`parse_stream` 改为基于 `StreamParser`)
- Modify: `server/app/routers/ai_audio.py`(`SpeechIn.stream`、流式分支)
- Create: `server/tests/test_tts_stream.py`

**Interfaces:**
- Consumes:既有 `VolcengineError`、`_error_info`、`synthesize`;Task 0.1 的打点。
- Produces:`class StreamParser(max_buffer: int = 4 * 1024 * 1024)`,`feed(data: bytes) -> list[bytes]`(返回新解出的音频块;JSON 不完整时缓冲;非法 JSON/非对象/错误码/非法 base64 抛 `VolcengineError("upstream")`)、`finish() -> None`(残留未解析内容或从未产出音频 → `VolcengineError("upstream")`)、属性 `audio_bytes: int`;`async def synthesize_stream(http, url, api_key, resource_id, text, speaker, uid, audio_format: Literal["mp3", "pcm"] = "mp3", sample_rate: int = 24000) -> AsyncIterator[bytes]`(非 200 → `VolcengineError("auth" | "upstream")`,在产出第一块之前抛出);HTTP:`SpeechIn.stream: bool = False`,行为见 R6。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_tts_stream.py`:

```python
import base64
import json

import httpx
import pytest

from app.volcengine import StreamParser, VolcengineError, parse_stream, synthesize_stream

URL = "https://volc.test/api/v3/tts/unidirectional"
OVERRIDES = {
    "volcengine_tts_key": "volc-secret",
    "volcengine_tts_url": URL,
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0",
}
OPENAI_TTS = "https://tts.test/v1/audio/speech"
VOICE = "en_female_dacey_uranus_bigtts"


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", OVERRIDES)


def obj(**kw) -> bytes:
    return json.dumps(kw, ensure_ascii=False).encode()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


BODY = b"\n".join([
    obj(code=0, message="", data=b64(b"ID3aaa")),
    obj(code=0, message="中文消息", data=None, sentence={"text": "hi"}),
    obj(code=0, message="", data=b64(b"bbb")),
    obj(code=20000000, message="ok", data=None),
])


@pytest.mark.parametrize("step", [1, 2, 3, 7, 64, len(BODY)])
def test_parser_is_independent_of_chunk_boundaries(step):
    parser = StreamParser()
    chunks = []
    for i in range(0, len(BODY), step):
        chunks += parser.feed(BODY[i:i + step])
    parser.finish()
    assert chunks == [b"ID3aaa", b"bbb"]
    assert parser.audio_bytes == 9


def test_parse_stream_keeps_its_contract():
    assert parse_stream(BODY) == b"ID3aaabbb"
    for bad in (b"{bad", obj(code=0, data=None), b"[1]", "é".encode("latin-1"), obj(code=45000000, message="x")):
        with pytest.raises(VolcengineError):
            parse_stream(bad)


async def test_synthesize_stream_yields_chunks(respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=BODY))
    async with httpx.AsyncClient() as http:
        out = [c async for c in synthesize_stream(http, URL, "k", "seed-tts-2.0", "hello", VOICE, "1", audio_format="pcm")]
    assert out == [b"ID3aaa", b"bbb"]
    sent = json.loads(respx_mock.calls.last.request.content)
    assert sent["req_params"]["audio_params"] == {"format": "pcm", "sample_rate": 24000}


@pytest.mark.parametrize("status,kind", [(403, "auth"), (500, "upstream")])
async def test_synthesize_stream_errors_before_the_first_chunk(respx_mock, status, kind):
    respx_mock.post(URL).mock(return_value=httpx.Response(status, json={"code": 1, "message": "no"}))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VolcengineError) as e:
            [c async for c in synthesize_stream(http, URL, "k", "seed-tts-2.0", "hello", VOICE, "1")]
    assert e.value.kind == kind


async def speak(client, headers, **extra):
    return await client.post("/api/ai/audio/speech",
                             json={"input": "hello", "model": "volcengine/seed-tts-2.0", "voice": VOICE, **extra},
                             headers=headers)


async def test_stream_true_passes_chunks_through(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=BODY))
    r = await speak(client, auth_headers, stream=True)
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-accel-buffering"] == "no"
    assert r.content == b"ID3aaabbb"


async def test_stream_true_error_before_first_chunk_is_json(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(403, json={"code": 1}))
    r = await speak(client, auth_headers, stream=True)
    assert r.status_code == 502
    assert r.json() == {"error": "Upstream authentication failed"}


async def test_stream_true_truncates_after_a_late_error(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=obj(code=0, data=b64(b"ID3aaa")) + b"\n{bad"))
    r = await speak(client, auth_headers, stream=True)
    assert r.status_code == 200
    assert r.content == b"ID3aaa"


async def test_stream_false_is_unchanged(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=BODY))
    r = await speak(client, auth_headers)
    assert r.content == b"ID3aaabbb"
    assert "cache-control" not in r.headers


async def test_stream_is_ignored_for_other_providers(client, auth_headers, respx_mock):
    respx_mock.post(OPENAI_TTS).mock(return_value=httpx.Response(200, content=b"MP3"))
    r = await client.post("/api/ai/audio/speech", json={"input": "hi", "model": "openai/tts-1", "voice": "alloy", "stream": True},
                          headers=auth_headers)
    assert r.status_code == 200 and r.content == b"MP3"
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_tts_stream.py -q` → FAIL(`cannot import name 'StreamParser'`)。

- [ ] **Step 3: 实现 `volcengine.py`** —— 在 `parse_stream` 之前加入 `StreamParser`,并把 `parse_stream` 改写为它的薄包装;在 `synthesize` 之后加入 `synthesize_stream`:

```python
from collections.abc import AsyncIterator


class StreamParser:
    """增量解析火山 TTS 的拼接 JSON 流(每个对象一块 base64 音频)。"""

    def __init__(self, max_buffer: int = 4 * 1024 * 1024):
        self._decoder = json.JSONDecoder()
        self._text = ""
        self._pending = b""
        self._max = max_buffer
        self.audio_bytes = 0

    def _decode(self, data: bytes) -> str:
        raw = self._pending + data
        try:
            self._pending = b""
            return raw.decode("utf-8")
        except UnicodeDecodeError as e:
            if e.reason != "unexpected end of data":
                raise VolcengineError("upstream")
            self._pending = raw[e.start:]  # 多字节字符被块边界切开:留到下一块
            return raw[: e.start].decode("utf-8")

    def _audio(self, item) -> bytes | None:
        if not isinstance(item, dict):
            raise VolcengineError("upstream")
        code = item.get("code")
        if code not in (None, 0, SUCCESS_END_CODE):
            raise VolcengineError("upstream", f"code={_clean(code)} message={_clean(item.get('message', ''))}")
        data = item.get("data")
        if isinstance(data, str) and data:
            try:
                chunk = base64.b64decode(data, validate=True)
            except (binascii.Error, ValueError):
                raise VolcengineError("upstream")
            self.audio_bytes += len(chunk)
            return chunk
        return None

    def feed(self, data: bytes) -> list[bytes]:
        self._text += self._decode(data)
        out: list[bytes] = []
        while True:
            stripped = self._text.lstrip()
            if not stripped:
                self._text = ""
                return out
            try:
                item, end = self._decoder.raw_decode(stripped)
            except ValueError:
                self._text = stripped
                if len(self._text) > self._max:
                    raise VolcengineError("upstream")
                return out
            self._text = stripped[end:]
            chunk = self._audio(item)
            if chunk:
                out.append(chunk)

    def finish(self) -> None:
        if self._pending or self._text.strip() or not self.audio_bytes:
            raise VolcengineError("upstream")


def parse_stream(raw: bytes) -> bytes:
    """Join the base64 audio chunks of a concatenated-JSON response into one MP3."""
    parser = StreamParser()
    chunks = parser.feed(raw)
    parser.finish()
    return b"".join(chunks)
```

  注意:旧 `parse_stream` 遇到非 UTF-8 立即报错;新实现里"末尾被截断的多字节字符"会被缓冲,`finish()` 时因 `_pending` 非空报错,`test_volcengine_tts.py` 与本任务的 `test_parse_stream_keeps_its_contract` 都覆盖。

```python
async def synthesize_stream(
    http: httpx.AsyncClient,
    url: str,
    api_key: str,
    resource_id: str,
    text: str,
    speaker: str,
    uid: str,
    audio_format: Literal["mp3", "pcm"] = "mp3",
    sample_rate: int = 24000,
) -> AsyncIterator[bytes]:
    request = http.build_request(
        "POST", url,
        json={"user": {"uid": uid}, "req_params": {
            "text": text, "speaker": speaker, "audio_params": {"format": audio_format, "sample_rate": sample_rate}}},
        headers={"X-Api-Key": api_key, "X-Api-Resource-Id": resource_id},
        timeout=TIMEOUT,
    )
    try:
        response = await http.send(request, stream=True)
    except httpx.HTTPError as e:
        logger.warning("Volcengine TTS request failed: %s", type(e).__name__)
        raise VolcengineError("upstream")
    try:
        if response.status_code != 200:
            code, message = _error_info(await response.aread())
            logger.warning("Volcengine TTS HTTP %s code=%s message=%s", response.status_code, code, message)
            raise VolcengineError("auth" if response.status_code in AUTH_STATUSES else "upstream")
        parser = StreamParser()
        async for data in response.aiter_bytes():
            for chunk in parser.feed(data):
                yield chunk
        parser.finish()
    except httpx.HTTPError as e:
        logger.warning("Volcengine TTS stream failed: %s", type(e).__name__)
        raise VolcengineError("upstream")
    finally:
        await response.aclose()
```

- [ ] **Step 4: 实现路由** —— `ai_audio.py`:`import logging`、`from fastapi.responses import JSONResponse, Response, StreamingResponse`、`from app.volcengine import VolcengineError, synthesize as volcengine_synthesize, synthesize_stream`、`logger = logging.getLogger(__name__)`;`SpeechIn` 加 `stream: bool = False`;火山分支在 `if not settings.volcengine_tts_key: …` 之后、原 `try:` 之前插入:

```python
        if payload.stream:
            watch = Stopwatch()
            chunks = synthesize_stream(
                request.app.state.http, settings.volcengine_tts_url, settings.volcengine_tts_key,
                model.removeprefix("volcengine/"), payload.input, payload.voice, str(user.id),
            )
            try:
                first = await anext(chunks)
            except VolcengineError as e:
                await chunks.aclose()
                raise HTTPException(502, "Upstream authentication failed" if e.kind == "auth" else "Upstream unavailable")
            log_timing("tts_volcengine_first_chunk", ms=watch.ms(), chars=len(payload.input))

            async def body():
                try:
                    yield first
                    async for chunk in chunks:
                        yield chunk
                except VolcengineError:
                    logger.warning("Volcengine TTS stream truncated")
                finally:
                    await chunks.aclose()
                    log_timing("tts_volcengine", ms=watch.ms(), chars=len(payload.input), stream=True)

            return StreamingResponse(body(), media_type="audio/mpeg",
                                     headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
```

  (`anext` 是 Python 3.10+ 内建。)

- [ ] **Step 5: 运行确认通过** —— `cd server && uv run pytest tests/test_tts_stream.py tests/test_volcengine_tts.py tests/test_ai_audio.py -q` → PASS;全量 → 0 failed。

- [ ] **Step 6: 提交**

```bash
git add server/app/volcengine.py server/app/routers/ai_audio.py server/tests/test_tts_stream.py
git commit -m "perf(server): stream Volcengine TTS chunks through on request" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.4:流式切句(纯函数)与一致性用例

**Files:**
- Create: `server/app/sentence_split.py`、`server/tests/test_sentence_split.py`、`server/tests/fixtures/sentence_cases.json`

**Interfaces:**
- Consumes:无。
- Produces:`MAX_SENTENCE_CHARS = 200`;`ABBREVIATIONS: frozenset[str]`(与 `web/src/features/chat/sentences.ts` 相同);`class SentenceSplitter(max_chars: int = MAX_SENTENCE_CHARS)`,`feed(text: str) -> list[str]`、`flush() -> list[str]`;`split_all(text: str) -> list[str]`(= 一次 `feed` + `flush`);一致性用例文件 `server/tests/fixtures/sentence_cases.json`(`[{"text": str, "sentences": [str]}]`,Task 2.5 的网页端实现读同一文件)。规则见 R7。

- [ ] **Step 1: 写一致性用例** —— `server/tests/fixtures/sentence_cases.json`:

```json
[
  {"text": "Hello there. How are you?", "sentences": ["Hello there.", "How are you?"]},
  {"text": "Mr. Smith arrived at 3 p.m. Then he left.", "sentences": ["Mr. Smith arrived at 3 p.m. Then he left."]},
  {"text": "Pi is 3.14 today. Nice!", "sentences": ["Pi is 3.14 today.", "Nice!"]},
  {"text": "She said \"Stop.\" Then she ran.", "sentences": ["She said \"Stop.\"", "Then she ran."]},
  {"text": "Wait... what? Really?!", "sentences": ["Wait... what?", "Really?!"]},
  {"text": "Well… I think so. OK.", "sentences": ["Well… I think so.", "OK."]},
  {"text": "你好。今天天气很好！你呢？", "sentences": ["你好。", "今天天气很好！", "你呢？"]},
  {"text": "I like it.\nYou too", "sentences": ["I like it.", "You too"]},
  {"text": "Use e.g. this one. And that.", "sentences": ["Use e.g. this one.", "And that."]},
  {"text": "J. K. Rowling wrote it. Yes.", "sentences": ["J. K. Rowling wrote it.", "Yes."]},
  {"text": "It's version 2.0. Upgrade now.", "sentences": ["It's version 2.0.", "Upgrade now."]},
  {"text": "(Really.) Yes.", "sentences": ["(Really.)", "Yes."]},
  {"text": "No terminator at all", "sentences": ["No terminator at all"]},
  {"text": "Stop! 42 people came. ... ok", "sentences": ["Stop!", "42 people came. ... ok"]},
  {"text": "   ", "sentences": []}
]
```

- [ ] **Step 2: 写失败的测试** —— `server/tests/test_sentence_split.py`:

```python
import json
import random
from pathlib import Path

import pytest

from app.sentence_split import MAX_SENTENCE_CHARS, SentenceSplitter, split_all

CASES = json.loads((Path(__file__).parent / "fixtures" / "sentence_cases.json").read_text(encoding="utf-8"))
WORDS = ["hello", "world", "Mr.", "Dr.", "v3.14", "e.g.", "coffee", "please", "\"quoted\"", "really", "you", "tomorrow"]
ENDINGS = [".", "!", "?", "?!", ".\"", "...", "…", "。"]


def normalized(text: str) -> str:
    return " ".join(text.split())


def generated(rng: random.Random) -> str:
    sentences = []
    for _ in range(rng.randint(1, 8)):
        words = [rng.choice(WORDS) for _ in range(rng.randint(1, 12))]
        sentences.append(rng.choice(["Hello", "Okay", "Yes", "Coffee"]) + " " + " ".join(words) + rng.choice(ENDINGS))
    return rng.choice([" ", "  ", "\n"]).join(sentences)


@pytest.mark.parametrize("case", CASES, ids=[c["text"][:20] for c in CASES])
def test_shared_cases(case):
    assert split_all(case["text"]) == case["sentences"]


def test_a_terminator_at_the_end_of_the_buffer_waits_for_more_text():
    s = SentenceSplitter()
    assert s.feed("Hello there.") == []
    assert s.feed(" How") == ["Hello there."]
    assert s.feed(" are you?") == []
    assert s.flush() == ["How are you?"]
    assert s.flush() == []


def test_an_ellipsis_split_across_chunks_does_not_break():
    s = SentenceSplitter()
    assert s.feed("Wait..") == []
    assert s.feed(". what? Yes") == ["Wait... what?"]
    assert s.flush() == ["Yes"]


def test_long_sentences_are_cut_at_a_comma_or_space():
    text = ", ".join(["word number"] * 40) + "."
    pieces = split_all(text)
    assert all(len(p) <= MAX_SENTENCE_CHARS for p in pieces)
    assert pieces[0].endswith(",")
    assert normalized(" ".join(pieces)) == normalized(text)
    assert split_all("x" * 450) == ["x" * 200, "x" * 200, "x" * 50]


@pytest.mark.parametrize("seed", range(200))
def test_properties_hold_for_random_texts_and_random_chunking(seed):
    rng = random.Random(seed)
    text = generated(rng)
    whole = split_all(text)
    # 1) 与分块方式无关
    s = SentenceSplitter()
    pieces: list[str] = []
    i = 0
    while i < len(text):
        step = rng.randint(1, 15)
        pieces += s.feed(text[i:i + step])
        i += step
    pieces += s.flush()
    assert pieces == whole
    # 2) 无空片段、不超长、不丢字
    assert all(p and p == p.strip() and len(p) <= MAX_SENTENCE_CHARS for p in whole)
    assert normalized(" ".join(whole)) == normalized(text)
    # 3) 从不在省略号中间断开:断点之后的片段不会以 "." 开头
    assert not any(p.startswith(".") for p in whole[1:])
```

- [ ] **Step 3: 运行确认失败** —— `cd server && uv run pytest tests/test_sentence_split.py -q` → FAIL(`No module named 'app.sentence_split'`)。

- [ ] **Step 4: 实现** —— `server/app/sentence_split.py`:

```python
"""流式切句(计划 R7)。网页端 web/src/features/chat/sentence-stream.ts 实现同一规则,
两边都以 tests/fixtures/sentence_cases.json 为准。宁可少断,不可错断。"""
import re

MAX_SENTENCE_CHARS = 200
ABBREVIATIONS = frozenset({
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "u.s", "u.k",
    "fig", "approx", "dept", "inc", "ltd", "co", "mt", "jan", "feb", "aug", "sept", "oct", "nov", "dec",
})
TERMINATORS = ".!?"
CJK_TERMINATORS = "。！？"
CLOSERS = "\"'”’)]」』）"
OPENER = re.compile(r"[A-Z0-9\"“'‘(\[]")
_NEXT = re.compile(r"\s+(\S)")
_NEED_MORE = -1


def _is_abbreviation(text: str, dot: int) -> bool:
    start = dot
    while start > 0 and dot - start <= 10 and re.match(r"[A-Za-z.]", text[start - 1]):
        start -= 1
    if dot - start > 10:
        return False
    token = text[start:dot].lower()
    return bool(token) and (token in ABBREVIATIONS or re.fullmatch(r"[a-z]", token) is not None)


def _scan(s: str, final: bool) -> tuple[int | None, int]:
    """返回 (切点, 扫描停下的位置)。切点为 None 表示没有句末;为 _NEED_MORE 表示需要更多文本才能判断。"""
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if ch == "\n":
            return i + 1, i
        if ch == "…" or s.startswith("...", i):
            i += 1 if ch == "…" else 3
            while i < n and s[i] == ".":
                i += 1
            continue
        if ch in CJK_TERMINATORS:
            end = i + 1
            while end < n and (s[end] in CJK_TERMINATORS or s[end] in CLOSERS):
                end += 1
            if end == n and not final:
                return _NEED_MORE, i
            return end, i
        if ch in TERMINATORS:
            end = i + 1
            while end < n and s[end] in TERMINATORS:
                end += 1
            while end < n and s[end] in CLOSERS:
                end += 1
            rest = s[end:]
            if not rest.strip():
                if final:
                    return end, i
                return _NEED_MORE, i
            m = _NEXT.match(rest)
            if m and OPENER.match(m.group(1)) and not (ch == "." and _is_abbreviation(s, i)):
                return end, i
            i = end
            continue
        i += 1
    return None, n


def _forced_cut(s: str, limit: int) -> int:
    head = s[:limit]
    for separators in (",;:", " "):
        k = max(head.rfind(c) for c in separators)
        if k > 0:
            return k + 1
    return limit


def _clean(piece: str) -> list[str]:
    text = piece.strip()
    return [text] if any(c.isalpha() for c in text) else []


class SentenceSplitter:
    def __init__(self, max_chars: int = MAX_SENTENCE_CHARS):
        self._buf = ""
        self._max = max_chars

    def _next_cut(self, final: bool) -> int | None:
        cut, at = _scan(self._buf, final)
        if cut is not None and cut != _NEED_MORE and cut <= self._max:
            return cut
        if len(self._buf) > self._max and (cut != _NEED_MORE or at >= self._max):
            return _forced_cut(self._buf, self._max)
        if cut == _NEED_MORE:
            return None
        return cut

    def _drain(self, final: bool) -> list[str]:
        out: list[str] = []
        while self._buf:
            cut = self._next_cut(final)
            if cut is None:
                break
            piece, self._buf = self._buf[:cut], self._buf[cut:]
            out += _clean(piece)
        return out

    def feed(self, text: str) -> list[str]:
        self._buf += text
        return self._drain(final=False)

    def flush(self) -> list[str]:
        out = self._drain(final=True)
        rest, self._buf = self._buf, ""
        return out + _clean(rest)


def split_all(text: str) -> list[str]:
    splitter = SentenceSplitter()
    return splitter.feed(text) + splitter.flush()
```

- [ ] **Step 5: 运行确认通过** —— `cd server && uv run pytest tests/test_sentence_split.py -q` → PASS(15 个共享用例 + 3 + 200 个随机种子)。若随机用例失败:先把失败种子的 `text` 打印出来加进 `sentence_cases.json`(写清期望),再改实现;**不得**缩小随机范围或删种子。

- [ ] **Step 6: 提交**

```bash
git add server/app/sentence_split.py server/tests/test_sentence_split.py server/tests/fixtures/sentence_cases.json
git commit -m "feat(server): add a streaming sentence splitter with shared conformance cases" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.5:逐句识别抽象与上传识别兜底

**Files:**
- Create: `server/app/asr.py`、`server/tests/test_asr_buffered.py`

**Interfaces:**
- Consumes:Task 1.2 的 `transcribe_wav`、`pcm_to_wav`。
- Produces:`class AsrError(Exception)`(属性 `kind: Literal["auth", "upstream", "config"]`);`class UtteranceRecognizer(Protocol)`:`async send_audio(pcm: bytes) -> None`、`async finish() -> str`(最终转写,空串 = 没听清;失败抛 `AsrError`)、`async abort() -> None`(幂等);`PartialCallback = Callable[[str], Awaitable[None]]`;`RecognizerFactory = Callable[[PartialCallback], Awaitable[UtteranceRecognizer]]`;`MAX_UTTERANCE_BYTES = 60 * 16000 * 2`;`class BufferedRecognizer(transcribe: Callable[[bytes], Awaitable[str]])`(缓冲 PCM,`finish` 时整段识别;超过上限的部分丢弃;从不调用 partial 回调);`make_transcriber(http, settings, language: str | None = "en") -> Callable[[bytes], Awaitable[str]]`(把 `HTTPException` 映射为 `AsrError`:502 + "authentication" → `auth`,503 → `config`,其他 → `upstream`);`buffered_factory(transcribe) -> RecognizerFactory`。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_asr_buffered.py`:

```python
import io
import wave

import httpx
import pytest

from app.asr import MAX_UTTERANCE_BYTES, AsrError, BufferedRecognizer, buffered_factory, make_transcriber
from tests.conftest import make_settings

ARK = "https://ark.test/api/v3/chat/completions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "m",
}


class FakeTranscribe:
    def __init__(self, result="hello", error: Exception | None = None):
        self.calls: list[bytes] = []
        self.result, self.error = result, error

    async def __call__(self, wav: bytes) -> str:
        self.calls.append(wav)
        if self.error:
            raise self.error
        return self.result


def frames(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 16000)
        return w.getnframes()


async def test_buffers_until_finish_and_sends_one_wav():
    t = FakeTranscribe()
    r = BufferedRecognizer(t)
    await r.send_audio(b"\x01\x00" * 800)
    await r.send_audio(b"\x01\x00" * 800)
    assert t.calls == []
    assert await r.finish() == "hello"
    assert frames(t.calls[0]) == 1600


async def test_empty_utterance_is_empty_without_upstream_call():
    t = FakeTranscribe()
    assert await BufferedRecognizer(t).finish() == ""
    assert t.calls == []


async def test_audio_beyond_sixty_seconds_is_dropped():
    t = FakeTranscribe()
    r = BufferedRecognizer(t)
    await r.send_audio(b"\x00" * (MAX_UTTERANCE_BYTES + 3200))
    await r.finish()
    assert frames(t.calls[0]) * 2 == MAX_UTTERANCE_BYTES


async def test_failure_propagates_and_abort_is_idempotent():
    r = BufferedRecognizer(FakeTranscribe(error=AsrError("upstream")))
    await r.send_audio(b"\x01\x00" * 10)
    with pytest.raises(AsrError):
        await r.finish()
    await r.abort()
    await r.abort()


async def test_factory_never_calls_partial():
    partials: list[str] = []

    async def on_partial(text: str) -> None:
        partials.append(text)

    r = await buffered_factory(FakeTranscribe("x"))(on_partial)
    await r.send_audio(b"\x01\x00" * 10)
    assert await r.finish() == "x" and partials == []


@pytest.mark.parametrize("status,kind", [(403, "auth"), (500, "upstream")])
async def test_make_transcriber_maps_errors(respx_mock, status, kind):
    respx_mock.post(ARK).mock(return_value=httpx.Response(status, json={}))
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            await make_transcriber(http, make_settings(**CHAT))(b"RIFF")
    assert e.value.kind == kind


async def test_make_transcriber_unconfigured_is_config():
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            await make_transcriber(http, make_settings(**{**CHAT, "upstream_whisper_model": ""}))(b"RIFF")
    assert e.value.kind == "config"


async def test_make_transcriber_returns_text(respx_mock):
    respx_mock.post(ARK).mock(return_value=httpx.Response(200, json={"choices": [{"message": {"content": "<none>"}}]}))
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**CHAT))(b"RIFF....WAVE") == ""
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_asr_buffered.py -q` → FAIL(`No module named 'app.asr'`)。

- [ ] **Step 3: 实现** —— `server/app/asr.py`:

```python
"""逐句识别抽象(计划 R3)。一句话 = 一个识别器:send_audio* → finish() → 文本。"""
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

import httpx
from fastapi import HTTPException

from app.config import Settings
from app.stt import pcm_to_wav, transcribe_wav

MAX_UTTERANCE_BYTES = 60 * 16000 * 2


class AsrError(Exception):
    def __init__(self, kind: Literal["auth", "upstream", "config"]):
        super().__init__(kind)
        self.kind = kind


class UtteranceRecognizer(Protocol):
    async def send_audio(self, pcm: bytes) -> None: ...

    async def finish(self) -> str: ...

    async def abort(self) -> None: ...


PartialCallback = Callable[[str], Awaitable[None]]
RecognizerFactory = Callable[[PartialCallback], Awaitable[UtteranceRecognizer]]
Transcribe = Callable[[bytes], Awaitable[str]]


class BufferedRecognizer:
    """客户端 VAD 断句 + 整段上传识别(兜底)。"""

    def __init__(self, transcribe: Transcribe):
        self._transcribe = transcribe
        self._pcm = bytearray()

    async def send_audio(self, pcm: bytes) -> None:
        room = MAX_UTTERANCE_BYTES - len(self._pcm)
        if room > 0:
            self._pcm += pcm[:room]

    async def finish(self) -> str:
        pcm, self._pcm = bytes(self._pcm), bytearray()
        if not pcm:
            return ""
        return await self._transcribe(pcm_to_wav(pcm))

    async def abort(self) -> None:
        self._pcm = bytearray()


def make_transcriber(http: httpx.AsyncClient, settings: Settings, language: str | None = "en") -> Transcribe:
    async def transcribe(wav: bytes) -> str:
        try:
            return await transcribe_wav(http, settings, wav, language)
        except HTTPException as e:
            if e.status_code == 503:
                raise AsrError("config") from None
            if "authentication" in str(e.detail).lower():
                raise AsrError("auth") from None
            raise AsrError("upstream") from None

    return transcribe


def buffered_factory(transcribe: Transcribe) -> RecognizerFactory:
    async def factory(_on_partial: PartialCallback) -> UtteranceRecognizer:
        return BufferedRecognizer(transcribe)

    return factory
```

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_asr_buffered.py -q` → PASS(10 项);全量 → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/asr.py server/tests/test_asr_buffered.py
git commit -m "feat(server): add a per-utterance recognizer with an upload fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.6:火山流式识别客户端(条件任务)

**执行条件:** 只有 `2026-10-07-voice-spike-results.md` 第 4 节「ASR 走向」= `stream` 时执行。结论为 `buffered`(含"阻塞:上游")时:在门槛记录里写"Task 1.6 未执行:spike 结论 buffered(日期)",跳过本任务;实时通话照常用 `BufferedRecognizer`(R3)。上游恢复、spike 改判为 `stream` 后再回来执行本任务,它只新增文件、不改别的任务的代码(`make_recognizer_factory` 在 Task 4.4 里已按 `asr_stream_enabled` 预留分支,见该任务)。

**Files:**
- Create: `server/app/asr_stream.py`、`server/tests/test_asr_stream.py`

**Interfaces:**
- Consumes:Task 1.1 的 `asr_stream_url`、`asr_stream_resource_id`、`asr_stream_key`;Task 1.5 的 `AsrError`、`PartialCallback`、`RecognizerFactory`;spike 第 2 节的帧格式与鉴权头(若与下方不同,以 spike 为准修改常量与测试里的期望,并在提交信息里注明)。
- Produces:`encode_full_request(payload: dict, seq: int) -> bytes`;`encode_audio(pcm: bytes, seq: int, last: bool) -> bytes`;`@dataclass ServerFrame(kind: Literal["result", "error"], flags: int, seq: int | None, payload: dict | None, error_code: int | None, message: str)`;`decode_frame(data: bytes) -> ServerFrame`(格式错误抛 `AsrError("upstream")`);`class VolcStreamRecognizer`(实现 `UtteranceRecognizer`);`def volc_stream_factory(settings, uid: str, connect=websockets.asyncio.client.connect) -> RecognizerFactory`(连接失败/握手 401/403 → `AsrError("auth")`,其他 → `AsrError("upstream")`,都在工厂调用时抛出,便于 Task 4.3 的降级)。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_asr_stream.py`(用本机 `websockets` 服务端扮演上游,不访问外网):

```python
import gzip
import json
import struct

import pytest
from websockets.asyncio.server import serve

from app.asr import AsrError
from app.asr_stream import decode_frame, encode_audio, encode_full_request, volc_stream_factory
from tests.conftest import make_settings


def server_frame(payload: dict, seq: int, last: bool = False) -> bytes:
    body = gzip.compress(json.dumps(payload).encode())
    flags = 0b0011 if last else 0b0001
    return bytes([0x11, (0b1001 << 4) | flags, 0x11, 0]) + struct.pack(">iI", -seq if last else seq, len(body)) + body


def error_frame(code: int, message: str) -> bytes:
    msg = message.encode()
    return bytes([0x11, 0b1111 << 4, 0x10, 0]) + struct.pack(">II", code, len(msg)) + msg


def test_codec_round_trip_and_flags():
    full = encode_full_request({"a": 1}, 1)
    assert full[:3] == bytes([0x11, 0x11, 0x11])
    assert struct.unpack(">i", full[4:8])[0] == 1
    last = encode_audio(b"\x00\x01", 5, last=True)
    assert last[1] == (0b0010 << 4) | 0b0011 and struct.unpack(">i", last[4:8])[0] == -5
    frame = decode_frame(server_frame({"result": {"text": "hi"}}, 3, last=True))
    assert (frame.kind, frame.seq, frame.payload["result"]["text"]) == ("result", -3, "hi")
    err = decode_frame(error_frame(45000001, "bad request"))
    assert (err.kind, err.error_code, err.message) == ("error", 45000001, "bad request")
    with pytest.raises(AsrError):
        decode_frame(b"\x11")


@pytest.fixture
async def upstream():
    seen: dict = {}

    async def handler(ws):
        seen["headers"] = {k.lower(): v for k, v in ws.request.headers.raw_items()}
        first = decode_frame_client(await ws.recv())
        seen["request"] = first
        await ws.send(server_frame({"result": {"text": ""}}, 1))
        audio = bytearray()
        async for raw in ws:
            flags = raw[1] & 0x0F
            size = struct.unpack(">I", raw[8:12])[0]
            audio += gzip.decompress(raw[12:12 + size])
            if len(audio) >= 3200 and "partial_sent" not in seen:
                seen["partial_sent"] = True
                await ws.send(server_frame({"result": {"text": "hello"}}, 2))
            if flags == 0b0011:
                seen["audio_bytes"] = len(audio)
                await ws.send(server_frame({"result": {"text": "hello world", "utterances": [{"text": "hello world", "definite": True}]}}, 3, last=True))
                return

    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        yield f"ws://127.0.0.1:{port}/api/v3/sauc/bigmodel_async", seen


def decode_frame_client(raw: bytes) -> dict:
    size = struct.unpack(">I", raw[8:12])[0]
    return json.loads(gzip.decompress(raw[12:12 + size]))


async def test_one_utterance_with_partial_and_final(upstream):
    url, seen = upstream
    settings = make_settings(asr_stream_url=url, volcengine_tts_key="volc-secret")
    partials: list[str] = []

    async def on_partial(text: str) -> None:
        partials.append(text)

    recognizer = await volc_stream_factory(settings, "42")(on_partial)
    for _ in range(4):
        await recognizer.send_audio(b"\x01\x00" * 800)
    assert await recognizer.finish() == "hello world"
    assert partials == ["hello"]
    assert seen["audio_bytes"] == 6400
    assert seen["headers"]["x-api-key"] == "volc-secret"
    assert seen["headers"]["x-api-resource-id"] == "volc.bigasr.sauc.duration"
    assert seen["request"]["audio"] == {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1, "codec": "raw"}


async def test_error_frame_raises_upstream():
    async def handler(ws):
        await ws.recv()
        await ws.send(error_frame(45000001, "bad"))

    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        settings = make_settings(asr_stream_url=f"ws://127.0.0.1:{port}/", volcengine_tts_key="k")

        async def noop(_: str) -> None:
            return None

        with pytest.raises(AsrError) as e:
            recognizer = await volc_stream_factory(settings, "1")(noop)
            await recognizer.finish()
        assert e.value.kind == "upstream"


async def test_handshake_rejection_is_auth():
    async def process_request(connection, request):
        return connection.respond(403, "forbidden\n")

    async def never(ws):
        return None

    async with serve(never, "127.0.0.1", 0, process_request=process_request) as server:
        port = server.sockets[0].getsockname()[1]
        settings = make_settings(asr_stream_url=f"ws://127.0.0.1:{port}/", volcengine_tts_key="k")

        async def noop(_: str) -> None:
            return None

        with pytest.raises(AsrError) as e:
            await volc_stream_factory(settings, "1")(noop)
        assert e.value.kind == "auth"
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_asr_stream.py -q` → FAIL(`No module named 'app.asr_stream'`)。

- [ ] **Step 3: 实现** —— `server/app/asr_stream.py`:

```python
"""火山大模型流式识别(sauc/bigmodel*)客户端。帧格式以 spike 结论为准(计划 Task 0.4)。
每句话一个连接:按住/VAD 开始说话时连接,说完发最后一包,等最终结果后关闭。日志不记文本与密钥。"""
import asyncio
import gzip
import json
import logging
import struct
import uuid
from dataclasses import dataclass
from typing import Literal

import websockets
from websockets.asyncio.client import connect as ws_connect

from app.asr import AsrError, PartialCallback, RecognizerFactory, UtteranceRecognizer
from app.config import Settings

logger = logging.getLogger(__name__)
FULL_CLIENT, AUDIO_ONLY, FULL_SERVER, ERROR = 0b0001, 0b0010, 0b1001, 0b1111
POS_SEQ, LAST_NEG_SEQ = 0b0001, 0b0011
JSON_SER, NO_SER, GZIP = 0b0001, 0b0000, 0b0001
FINAL_TIMEOUT = 10.0


def _header(msg_type: int, flags: int, serialization: int) -> bytes:
    return bytes([0x11, (msg_type << 4) | flags, (serialization << 4) | GZIP, 0])


def encode_full_request(payload: dict, seq: int) -> bytes:
    body = gzip.compress(json.dumps(payload).encode())
    return _header(FULL_CLIENT, POS_SEQ, JSON_SER) + struct.pack(">iI", seq, len(body)) + body


def encode_audio(pcm: bytes, seq: int, last: bool) -> bytes:
    body = gzip.compress(pcm)
    flags = LAST_NEG_SEQ if last else POS_SEQ
    return _header(AUDIO_ONLY, flags, NO_SER) + struct.pack(">iI", -seq if last else seq, len(body)) + body


@dataclass
class ServerFrame:
    kind: Literal["result", "error"]
    flags: int
    seq: int | None
    payload: dict | None
    error_code: int | None
    message: str


def decode_frame(data: bytes) -> ServerFrame:
    try:
        msg_type, flags = data[1] >> 4, data[1] & 0x0F
        compression = data[2] & 0x0F
        pos = 4
        if msg_type == ERROR:
            code, size = struct.unpack(">II", data[pos:pos + 8])
            return ServerFrame("error", flags, None, None, code, data[pos + 8:pos + 8 + size].decode("utf-8", "replace")[:200])
        seq = None
        if flags & 0b0001:
            seq = struct.unpack(">i", data[pos:pos + 4])[0]
            pos += 4
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        body = data[pos + 4:pos + 4 + size]
        if compression == GZIP and body:
            body = gzip.decompress(body)
        return ServerFrame("result", flags, seq, json.loads(body) if body else None, None, "")
    except (IndexError, struct.error, OSError, ValueError):
        raise AsrError("upstream") from None


class VolcStreamRecognizer:
    def __init__(self, ws, on_partial: PartialCallback):
        self._ws = ws
        self._on_partial = on_partial
        self._seq = 2
        self._final: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._reader = asyncio.create_task(self._read())
        self._last_partial = ""

    async def _read(self) -> None:
        try:
            async for raw in self._ws:
                frame = decode_frame(raw)
                if frame.kind == "error":
                    logger.warning("ASR stream error code=%s", frame.error_code)
                    raise AsrError("upstream")
                result = (frame.payload or {}).get("result") or {}
                text = (result.get("text") or "").strip()
                if frame.flags == LAST_NEG_SEQ or frame.flags == 0b0010:
                    if not self._final.done():
                        self._final.set_result(text)
                    return
                if text and text != self._last_partial:
                    self._last_partial = text
                    await self._on_partial(text)
            raise AsrError("upstream")
        except AsrError as e:
            if not self._final.done():
                self._final.set_exception(e)
        except websockets.WebSocketException:
            if not self._final.done():
                self._final.set_exception(AsrError("upstream"))

    async def send_audio(self, pcm: bytes) -> None:
        if self._final.done():
            return
        try:
            await self._ws.send(encode_audio(pcm, self._seq, last=False))
        except websockets.WebSocketException:
            raise AsrError("upstream") from None
        self._seq += 1

    async def finish(self) -> str:
        try:
            if not self._final.done():
                await self._ws.send(encode_audio(b"", self._seq, last=True))
            return await asyncio.wait_for(asyncio.shield(self._final), FINAL_TIMEOUT)
        except (TimeoutError, websockets.WebSocketException):
            raise AsrError("upstream") from None
        finally:
            await self.abort()

    async def abort(self) -> None:
        self._reader.cancel()
        await self._ws.close()


def volc_stream_factory(settings: Settings, uid: str, connect=ws_connect) -> RecognizerFactory:
    async def factory(on_partial: PartialCallback) -> UtteranceRecognizer:
        headers = {
            "X-Api-Key": settings.asr_stream_key,
            "X-Api-Resource-Id": settings.asr_stream_resource_id,
            "X-Api-Connect-Id": str(uuid.uuid4()),
        }
        try:
            ws = await connect(settings.asr_stream_url, additional_headers=headers, max_size=4 * 1024 * 1024, open_timeout=5)
        except websockets.InvalidStatus as e:
            status = e.response.status_code
            logger.warning("ASR stream handshake HTTP %s", status)
            raise AsrError("auth" if status in (401, 403) else "upstream") from None
        except (OSError, TimeoutError, websockets.WebSocketException) as e:
            logger.warning("ASR stream connect failed: %s", type(e).__name__)
            raise AsrError("upstream") from None
        try:
            await ws.send(encode_full_request({
                "user": {"uid": uid},
                "audio": {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1, "codec": "raw"},
                "request": {"model_name": "bigmodel", "enable_punc": True, "enable_itn": True, "show_utterances": True},
            }, 1))
            ack = decode_frame(await asyncio.wait_for(ws.recv(), 5))
        except (TimeoutError, websockets.WebSocketException):
            await ws.close()
            raise AsrError("upstream") from None
        if ack.kind == "error":
            await ws.close()
            raise AsrError("auth" if ack.error_code in (45000010, 45000011) else "upstream")
        return VolcStreamRecognizer(ws, on_partial)

    return factory
```

  说明:握手后的错误码哪些代表鉴权失败(上面的 `45000010/45000011` 是占位假设)**以 spike 第 2 节记录的真实错误码为准**,替换常量并在测试里补一条对应用例;若 spike 没观察到鉴权类错误码,删除这个分支(一律 `upstream`)。

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_asr_stream.py -q` → PASS;全量 → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/asr_stream.py server/tests/test_asr_stream.py
git commit -m "feat(server): add a Volcengine streaming ASR client per utterance" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 验收门槛 1

- [ ] `cd server && uv run pytest -q` → 0 failed,通过数 = 门槛 0 的数字 + 本阶段新增(写进门槛记录)。
- [ ] 既有测试未改:`git diff voice-latency-baseline -- server/tests | grep '^-[^-]'` 无输出(本阶段只新增测试文件)。
- [ ] Postgres 全量测试(独立容器;**连接串用 127.0.0.1**):

```bash
cd /e/workspace/everyone-can-use-english
docker run -d --rm --name enjoy-pgtest -e POSTGRES_USER=enjoy -e POSTGRES_PASSWORD=pgtest -e POSTGRES_DB=enjoy \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
for i in $(seq 1 120); do docker exec enjoy-pgtest pg_isready -U enjoy -d enjoy -h 127.0.0.1 >/dev/null 2>&1 && break; done
docker exec enjoy-pgtest pg_isready -U enjoy -d enjoy -h 127.0.0.1
docker exec enjoy-pgtest psql -U enjoy -d enjoy -c 'CREATE DATABASE enjoy_test;'
cd server
TEST_DATABASE_URL=postgresql+asyncpg://enjoy:pgtest@127.0.0.1:55432/enjoy_test uv run pytest -q
docker stop enjoy-pgtest
```

  预期 0 failed(跳过数与基线相同)。
- [ ] 本机服务冒烟(临时 SQLite、开放注册、`run_in_background` 启动 uvicorn 于 8000):`POST /api/ai/audio/speech` 带 `"stream": true` 而火山未配置 → `503 {"error": "Volcengine TTS is not configured"}`;不带 `stream` 的 openai 模型请求行为不变(上游未配置时 503)。结束后停服务、删临时库。
- [ ] `git grep -nE "XFYUN_API_(KEY|SECRET)=.+|UPSTREAM_[A-Z]+_KEY=.+|VOLCENGINE_TTS_KEY=.+|ASR_STREAM_KEY=.+" -- . ':!server/.env' ':!server/.env.bak-*'` → 无输出;`git status --short server/` 不含 `.env*`。

---
## 阶段 2:网页——采集、裁剪、VAD、按句流水线朗读

> 依赖:门槛 0(Task 0.6 的决定)。本阶段不调用任何新服务端接口,不依赖阶段 1(可与阶段 1 并行,见文末)。

### Task 2.1:PCM 纯函数与 16 kHz 采集

**Files:**
- Create: `web/src/audio/pcm.ts`、`web/src/audio/pcm.test.ts`
- Create: `web/src/audio/capture.ts`、`web/src/audio/capture.test.ts`、`web/src/audio/pcm-capture.worklet.js`
- Create: `web/src/test/fake-audio.ts`(测试用的假 `AudioContext`/节点/流)
- Modify: `web/src/audio/recorder.ts`(导出既有的 `mapGetUserMediaError`,不改实现)

**Interfaces:**
- Consumes:`recorder.ts` 的 `RecorderError`、`mapGetUserMediaError`(本任务改为 `export`)。
- Produces(`pcm.ts`):`TARGET_RATE = 16000`;`class Downsampler(inRate: number, outRate = TARGET_RATE)`,`process(input: Float32Array): Float32Array`(区间平均,跨调用连续;`inRate < outRate` 抛 `RangeError`;`inRate === outRate` 原样返回副本);`floatToPcm16(f: Float32Array): Int16Array`;`pcm16ToFloat(i: Int16Array): Float32Array`;`frameRms(f: Float32Array): number`;`dbfs(rms: number): number`(下限 −180);`concatFloat(parts: Float32Array[]): Float32Array`。
- Produces(`capture.ts`):`interface CaptureEnv { isSecureContext: boolean; getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>; supportedConstraints(): Record<string, boolean | undefined>; createAudioContext?: () => AudioContext; createWorkletNode?: (ctx: AudioContext) => AudioWorkletNode; workletUrl: string }`;`browserCaptureEnv(): CaptureEnv`;`captureConstraints(supported): MediaStreamConstraints`;`pcmCaptureSupported(env?: CaptureEnv): boolean`;`unlockAudioContext(ctx: AudioContext): void`(同步 `resume()` + 播放 1 个采样的静音,iOS 解锁;必须在点击的同步阶段调用);`interface PcmCapture { readonly stream: MediaStream; readonly context: AudioContext; readonly via: "worklet" | "script-processor"; onFrame(cb: (frame16k: Float32Array, dbfs: number) => void): () => void; onTrackEnded(cb: () => void): () => void; collected(): Float32Array; release(): void }`;`startPcmCapture(opts?: { env?: CaptureEnv; context?: AudioContext; collect?: boolean }): Promise<PcmCapture>`。`release()` 幂等:断开节点、停止全部轨道、关闭**自己创建的** `AudioContext`(传入的 `context` 不关)。`AudioContext` 在 `await getUserMedia` **之前**同步创建并 `resume()`(iOS 手势)。

- [ ] **Step 1: 测试辅助** —— `web/src/test/fake-audio.ts`:

```ts
import { vi } from "vitest";

export class FakeTrack extends EventTarget {
  stop = vi.fn();
  kind = "audio";
}

export function fakeStream(): MediaStream & { track: FakeTrack } {
  const track = new FakeTrack();
  return { track, getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream & { track: FakeTrack };
}

export class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

export class FakeWorkletNode extends FakeNode {
  port = { onmessage: null as null | ((e: MessageEvent) => void), postMessage: vi.fn() };
  emit(samples: Float32Array) {
    this.port.onmessage?.({ data: samples } as MessageEvent);
  }
}

export class FakeScriptProcessor extends FakeNode {
  onaudioprocess: null | ((e: AudioProcessingEvent) => void) = null;
  emit(samples: Float32Array) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } } as unknown as AudioProcessingEvent);
  }
}

export class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = new FakeNode();
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  worklet = { addModule: vi.fn(async (_url: string) => undefined) };
  audioWorklet: { addModule: (url: string) => Promise<void> } | undefined = this.worklet;
  source = new FakeNode();
  processor = new FakeScriptProcessor();
  gain = Object.assign(new FakeNode(), { gain: { value: 1 } });
  started: Array<{ when: number; duration: number; buffer: { samples: Float32Array } }> = [];
  constructor(public sampleRate = 48000) {}
  createMediaStreamSource = vi.fn(() => this.source);
  createScriptProcessor = vi.fn(() => this.processor);
  createGain = vi.fn(() => this.gain);
  createBuffer = vi.fn((_channels: number, length: number, rate: number) => {
    const samples = new Float32Array(length);
    return { duration: length / rate, length, sampleRate: rate, samples, getChannelData: () => samples, copyToChannel: (src: Float32Array) => samples.set(src) };
  });
  createBufferSource = vi.fn(() => {
    const node = Object.assign(new FakeNode(), {
      buffer: null as null | { duration: number; samples: Float32Array },
      onended: null as null | (() => void),
      start: vi.fn((when: number) => this.started.push({ when, duration: node.buffer!.duration, buffer: node.buffer! })),
      stop: vi.fn(),
    });
    return node;
  });
}

export const asContext = (ctx: FakeAudioContext) => ctx as unknown as AudioContext;
```

- [ ] **Step 2: 写失败的测试** —— `web/src/audio/pcm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Downsampler, concatFloat, dbfs, floatToPcm16, frameRms, pcm16ToFloat } from "./pcm";

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe("Downsampler", () => {
  it.each([48000, 44100, 16000])("keeps a constant signal constant from %i Hz", (rate) => {
    const out = new Downsampler(rate).process(new Float32Array(rate).fill(0.25));
    expect(out.length).toBeGreaterThanOrEqual(15990);
    expect(out.length).toBeLessThanOrEqual(16000);
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });

  it("gives the same result regardless of how the input is chunked", () => {
    const input = sine(440, 48000, 0.5);
    const whole = new Downsampler(48000).process(input);
    const d = new Downsampler(48000);
    const parts: Float32Array[] = [];
    for (let i = 0; i < input.length; i += 997) parts.push(d.process(input.subarray(i, i + 997)));
    expect(Array.from(concatFloat(parts))).toEqual(Array.from(whole));
  });

  it("keeps a 1 kHz tone (passband) and its level", () => {
    const out = new Downsampler(44100).process(sine(1000, 44100, 1));
    expect(frameRms(out)).toBeGreaterThan(0.3);
  });

  it("rejects upsampling", () => {
    expect(() => new Downsampler(8000)).toThrow(RangeError);
  });
});

describe("conversions", () => {
  it("clamps floats into int16", () => {
    expect(Array.from(floatToPcm16(Float32Array.from([1, -1, 2, -2, 0])))).toEqual([32767, -32768, 32767, -32768, 0]);
  });
  it("round-trips approximately", () => {
    const back = pcm16ToFloat(floatToPcm16(Float32Array.from([0.5, -0.25])));
    expect(back[0]).toBeCloseTo(0.5, 3);
    expect(back[1]).toBeCloseTo(-0.25, 3);
  });
  it("measures rms and dBFS", () => {
    expect(frameRms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5);
    expect(dbfs(1)).toBe(0);
    expect(dbfs(0)).toBe(-180);
    expect(dbfs(0.1)).toBeCloseTo(-20);
  });
});
```

  `web/src/audio/capture.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { RecorderError } from "./recorder";
import { captureConstraints, startPcmCapture, unlockAudioContext, type CaptureEnv } from "./capture";
import { FakeAudioContext, FakeWorkletNode, asContext, fakeStream } from "~/test/fake-audio";

function env(over: Partial<CaptureEnv> = {}, ctx = new FakeAudioContext()) {
  const stream = fakeStream();
  const node = new FakeWorkletNode();
  const e: CaptureEnv = {
    isSecureContext: true,
    getUserMedia: vi.fn(async () => stream),
    supportedConstraints: () => ({ echoCancellation: true }),
    createAudioContext: () => asContext(ctx),
    createWorkletNode: vi.fn(() => node as unknown as AudioWorkletNode),
    workletUrl: "/assets/pcm-capture.worklet.js",
    ...over,
  };
  return { e, ctx, stream, node };
}

describe("captureConstraints", () => {
  it("adds voiceIsolation only when supported", () => {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    expect(captureConstraints({})).toEqual({ audio: base });
    expect(captureConstraints({ voiceIsolation: true })).toEqual({ audio: { ...base, voiceIsolation: true } });
  });
});

describe("startPcmCapture", () => {
  it("creates and resumes the context before asking for the microphone", async () => {
    const order: string[] = [];
    const ctx = new FakeAudioContext();
    ctx.resume.mockImplementation(async () => { order.push("resume"); });
    const { e } = env({ getUserMedia: vi.fn(async () => { order.push("gum"); return fakeStream(); }) }, ctx);
    const capture = await startPcmCapture({ env: e });
    expect(order).toEqual(["resume", "gum"]);
    capture.release();
  });

  it("downsamples worklet frames to 16 kHz, collects them and releases everything once", async () => {
    const { e, ctx, stream, node } = env();
    const capture = await startPcmCapture({ env: e, collect: true });
    expect(capture.via).toBe("worklet");
    expect(ctx.worklet.addModule).toHaveBeenCalledWith("/assets/pcm-capture.worklet.js");
    const frames: number[] = [];
    capture.onFrame((f) => frames.push(f.length));
    node.emit(new Float32Array(4800).fill(0.1)); // 100 ms @ 48 kHz
    expect(frames).toEqual([1600]);
    expect(capture.collected().length).toBe(1600);
    capture.release();
    capture.release();
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(node.disconnect).toHaveBeenCalled();
    node.emit(new Float32Array(4800)); // 释放后的帧被忽略
    expect(frames).toEqual([1600]);
  });

  it("falls back to a ScriptProcessor when the worklet module fails", async () => {
    const ctx = new FakeAudioContext();
    ctx.worklet.addModule.mockRejectedValueOnce(new Error("blocked"));
    const { e } = env({}, ctx);
    const capture = await startPcmCapture({ env: e, collect: true });
    expect(capture.via).toBe("script-processor");
    ctx.processor.emit(new Float32Array(4800).fill(0.2));
    expect(capture.collected().length).toBe(1600);
    capture.release();
  });

  it("falls back when audioWorklet does not exist", async () => {
    const ctx = new FakeAudioContext();
    ctx.audioWorklet = undefined;
    const capture = await startPcmCapture({ env: env({}, ctx).e });
    expect(capture.via).toBe("script-processor");
    capture.release();
  });

  it("maps permission errors and closes the context it created", async () => {
    const ctx = new FakeAudioContext();
    const { e } = env({ getUserMedia: vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); }) }, ctx);
    await expect(startPcmCapture({ env: e })).rejects.toMatchObject({ code: "permission_denied" });
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("refuses an insecure context without creating anything", async () => {
    const create = vi.fn();
    await expect(startPcmCapture({ env: { ...env().e, isSecureContext: false, createAudioContext: create } })).rejects.toBeInstanceOf(RecorderError);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not close a context it did not create and reports track end", async () => {
    const shared = new FakeAudioContext();
    const { e, stream } = env();
    const capture = await startPcmCapture({ env: e, context: asContext(shared) });
    const ended = vi.fn();
    capture.onTrackEnded(ended);
    stream.track.dispatchEvent(new Event("ended"));
    expect(ended).toHaveBeenCalledTimes(1);
    capture.release();
    expect(shared.close).not.toHaveBeenCalled();
  });
});

describe("unlockAudioContext", () => {
  it("resumes synchronously and plays one silent sample", () => {
    const ctx = new FakeAudioContext();
    unlockAudioContext(asContext(ctx));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.started).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 运行确认失败** —— `yarn workspace web test src/audio/pcm.test.ts src/audio/capture.test.ts` → FAIL(模块不存在)。

- [ ] **Step 4: 实现 `pcm.ts`**:

```ts
export const TARGET_RATE = 16000;

/** 区间平均降采样(盒式低通 + 抽取);跨调用保持连续,结果与分块方式无关。 */
export class Downsampler {
  private pending = new Float32Array(0);
  private consumed = 0; // pending[0] 在整个输入流里的下标
  private next = 0; // 下一个输出采样在输入流里的起点(小数)
  private readonly ratio: number;

  constructor(readonly inRate: number, readonly outRate = TARGET_RATE) {
    if (inRate < outRate) throw new RangeError("input rate is below the output rate");
    this.ratio = inRate / outRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    const buf = new Float32Array(this.pending.length + input.length);
    buf.set(this.pending);
    buf.set(input, this.pending.length);
    const out: number[] = [];
    for (;;) {
      const start = this.next - this.consumed;
      const end = start + this.ratio;
      const hi = Math.ceil(end);
      if (hi > buf.length) break;
      let sum = 0;
      const lo = Math.floor(start);
      for (let i = lo; i < hi; i++) sum += buf[i];
      out.push(sum / (hi - lo));
      this.next += this.ratio;
    }
    const keep = Math.floor(this.next - this.consumed);
    this.pending = buf.slice(keep);
    this.consumed += keep;
    return Float32Array.from(out);
  }
}

export function floatToPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function pcm16ToFloat(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 0x8000;
  return out;
}

export function frameRms(f: Float32Array): number {
  if (!f.length) return 0;
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  return Math.sqrt(sum / f.length);
}

export function dbfs(rms: number): number {
  return rms <= 0 ? -180 : Math.max(-180, 20 * Math.log10(rms));
}

export function concatFloat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
```

- [ ] **Step 5: 实现 worklet 与 `capture.ts`** —— `web/src/audio/pcm-capture.worklet.js`:

```js
/* AudioWorklet:把麦克风输入按 2048 个采样一包发回主线程(原生采样率,降采样在主线程做)。 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.length = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
```

  `web/src/audio/capture.ts`:

```ts
import workletUrl from "./pcm-capture.worklet.js?url";
import { Downsampler, TARGET_RATE, concatFloat, dbfs, frameRms } from "./pcm";
import { RecorderError, mapGetUserMediaError } from "./recorder";

export interface CaptureEnv {
  isSecureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  supportedConstraints(): Record<string, boolean | undefined>;
  createAudioContext?: () => AudioContext;
  createWorkletNode?: (ctx: AudioContext) => AudioWorkletNode;
  workletUrl: string;
}

export interface PcmCapture {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly via: "worklet" | "script-processor";
  onFrame(cb: (frame16k: Float32Array, dbfs: number) => void): () => void;
  onTrackEnded(cb: () => void): () => void;
  collected(): Float32Array;
  release(): void;
}

type Ctor = typeof AudioContext;
const audioContextCtor = (): Ctor | undefined =>
  (globalThis as { AudioContext?: Ctor }).AudioContext ?? (globalThis as { webkitAudioContext?: Ctor }).webkitAudioContext;

export function browserCaptureEnv(): CaptureEnv {
  const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  const Ctx = audioContextCtor();
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    getUserMedia: devices?.getUserMedia ? (c) => devices.getUserMedia(c) : undefined,
    supportedConstraints: () => (devices?.getSupportedConstraints?.() ?? {}) as Record<string, boolean | undefined>,
    createAudioContext: Ctx ? () => new Ctx() : undefined,
    createWorkletNode: typeof AudioWorkletNode === "undefined" ? undefined : (ctx) => new AudioWorkletNode(ctx, "pcm-capture", { numberOfOutputs: 0 }),
    workletUrl,
  };
}

export function captureConstraints(supported: Record<string, boolean | undefined>): MediaStreamConstraints {
  const audio: MediaTrackConstraints & { voiceIsolation?: boolean } = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
  };
  if (supported.voiceIsolation) audio.voiceIsolation = true;
  return { audio };
}

export function pcmCaptureSupported(env: CaptureEnv = browserCaptureEnv()): boolean {
  return env.isSecureContext && !!env.getUserMedia && !!env.createAudioContext;
}

/** iOS:必须在点击的同步阶段调用;不 await。 */
export function unlockAudioContext(ctx: AudioContext): void {
  try {
    void ctx.resume?.()?.catch?.(() => undefined);
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* 测试环境或已关闭的上下文 */
  }
}

export async function startPcmCapture(opts: { env?: CaptureEnv; context?: AudioContext; collect?: boolean } = {}): Promise<PcmCapture> {
  const env = opts.env ?? browserCaptureEnv();
  if (!env.isSecureContext) throw new RecorderError("insecure_context");
  if (!env.getUserMedia || (!opts.context && !env.createAudioContext)) throw new RecorderError("unsupported");
  const owned = !opts.context;
  const ctx = opts.context ?? env.createAudioContext!(); // 在 await 之前同步创建(iOS 手势)
  void ctx.resume?.()?.catch?.(() => undefined);
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia(captureConstraints(env.supportedConstraints()));
  } catch (err) {
    if (owned) void ctx.close?.()?.catch?.(() => undefined);
    throw mapGetUserMediaError(err);
  }
  const tracks = stream.getTracks();
  const source = ctx.createMediaStreamSource(stream);
  const downsampler = new Downsampler(ctx.sampleRate, TARGET_RATE);
  const frameListeners = new Set<(f: Float32Array, level: number) => void>();
  const endListeners = new Set<() => void>();
  const parts: Float32Array[] = [];
  let released = false;

  const handle = (samples: Float32Array) => {
    if (released) return;
    const frame = downsampler.process(samples);
    if (!frame.length) return;
    if (opts.collect) parts.push(frame);
    const level = dbfs(frameRms(frame));
    frameListeners.forEach((cb) => cb(frame, level));
  };

  let via: PcmCapture["via"] = "script-processor";
  let node: AudioNode | null = null;
  let sink: AudioNode | null = null;
  if (ctx.audioWorklet && env.createWorkletNode) {
    try {
      await ctx.audioWorklet.addModule(env.workletUrl);
      const worklet = env.createWorkletNode(ctx);
      worklet.port.onmessage = (event: MessageEvent) => handle(event.data as Float32Array);
      source.connect(worklet);
      node = worklet;
      via = "worklet";
    } catch {
      node = null;
    }
  }
  if (!node) {
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => handle(event.inputBuffer.getChannelData(0).slice());
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination); // ScriptProcessor 需要连到输出才会工作
    node = processor;
    sink = mute;
  }
  const onEnded = () => endListeners.forEach((cb) => cb());
  tracks.forEach((t) => t.addEventListener?.("ended", onEnded));

  return {
    stream,
    context: ctx,
    via,
    onFrame(cb) {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
    onTrackEnded(cb) {
      endListeners.add(cb);
      return () => endListeners.delete(cb);
    },
    collected: () => concatFloat(parts),
    release() {
      if (released) return;
      released = true;
      frameListeners.clear();
      endListeners.clear();
      try {
        source.disconnect();
        node?.disconnect();
        sink?.disconnect();
      } catch {
        /* 已断开 */
      }
      tracks.forEach((t) => {
        t.removeEventListener?.("ended", onEnded);
        t.stop();
      });
      if (owned) void ctx.close?.()?.catch?.(() => undefined);
    },
  };
}
```

  `recorder.ts`:把 `function mapGetUserMediaError` 改为 `export function mapGetUserMediaError`(只加 `export`)。`?url` 导入在 Vite 下得到带哈希的 `/assets/...` 地址(由既有 SW 缓存);vitest 下同样可解析。若 typecheck 报 `Cannot find module './pcm-capture.worklet.js?url'`,确认 `vite/client` 类型已在 `tsconfig.json` 的 `types` 里(已在)。

- [ ] **Step 6: 运行确认通过** —— `yarn workspace web test src/audio` → PASS;`yarn workspace web typecheck` → 0 错误。

- [ ] **Step 7: 提交**

```bash
git add web/src/audio/pcm.ts web/src/audio/pcm.test.ts web/src/audio/capture.ts web/src/audio/capture.test.ts web/src/audio/pcm-capture.worklet.js web/src/test/fake-audio.ts web/src/audio/recorder.ts
git commit -m "feat(web): capture 16 kHz PCM with an AudioWorklet and a ScriptProcessor fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.2:近讲能量门限与静音裁剪(含合成噪声测试)

**Files:**
- Create: `web/src/audio/energy-gate.ts`、`web/src/audio/energy-gate.test.ts`

**Interfaces:**
- Consumes:Task 2.1 的 `frameRms`、`dbfs`。
- Produces:`FRAME_MS = 20`、`NEAR_FIELD_DBFS = -38`、`PAD_MS = 200`、`MIN_SPEECH_MS = 250`;`interface GateOptions { sampleRate: number; thresholdDbfs?: number; padMs?: number; minSpeechMs?: number }`;`frameLevels(samples: Float32Array, sampleRate: number): number[]`(每 20 ms 一个 dBFS);`speechRuns(levels: number[], thresholdDbfs: number, minFrames: number): Array<[number, number]>`(帧下标半开区间);`hasForegroundSpeech(samples, opts): boolean`;`trimSilence(samples, opts): Float32Array`(没有语音段 → 空数组)。

- [ ] **Step 1: 写失败的测试** —— `web/src/audio/energy-gate.test.ts`(信号全部由固定种子的伪随机数生成,可复现;dBFS 指 RMS):

```ts
import { describe, expect, it } from "vitest";
import { MIN_SPEECH_MS, PAD_MS, frameLevels, hasForegroundSpeech, speechRuns, trimSilence } from "./energy-gate";
import { dbfs, frameRms } from "./pcm";

const RATE = 16000;
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** "人声"替身:基频 + 两个谐波,按 4 Hz 音节包络轻微起伏(±1.5 dB),整体缩放到给定的 RMS dBFS */
function voice(seconds: number, db: number, seed: number): Float32Array {
  const r = rng(seed);
  const f0 = 120 + 80 * r();
  const raw = Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const t = i / RATE;
    const env = 0.85 + 0.15 * Math.sin(2 * Math.PI * 4 * t);
    return env * (0.7 * Math.sin(2 * Math.PI * f0 * t) + 0.2 * Math.sin(4 * Math.PI * f0 * t) + 0.1 * Math.sin(6 * Math.PI * f0 * t));
  });
  const scale = 10 ** (db / 20) / frameRms(raw);
  return raw.map((v) => v * scale);
}
function noise(seconds: number, db: number, seed: number): Float32Array {
  const r = rng(seed);
  const a = 10 ** (db / 20) * Math.sqrt(3); // 均匀分布 RMS = a/√3
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => a * (2 * r() - 1));
}
const mix = (...xs: Float32Array[]) => Float32Array.from({ length: Math.max(...xs.map((x) => x.length)) }, (_, i) => xs.reduce((s, x) => s + (x[i] ?? 0), 0));
const concat = (...xs: Float32Array[]) => Float32Array.from(xs.flatMap((x) => Array.from(x)));
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const opts = { sampleRate: RATE };

describe("synthetic noise conditions (design §7.2)", () => {
  it("background voices alone (-45 dBFS babble over -55 dBFS noise) are not speech", () => {
    const babble = mix(voice(3, -48, 1), voice(3, -49, 2), voice(3, -50, 3), noise(3, -55, 4));
    expect(dbfs(frameRms(babble))).toBeLessThan(-40);
    expect(hasForegroundSpeech(babble, opts)).toBe(false);
    expect(trimSilence(babble, opts).length).toBe(0);
  });

  it.each([[-15, "loud near speaker"], [-25, "normal near speaker"], [-32, "quiet near speaker"]])(
    "foreground at %i dBFS over background babble is kept (%s)", (db) => {
      const background = mix(voice(3, -48, 5), noise(3, -55, 6));
      const signal = mix(background, concat(silence(1), voice(1, db, 7), silence(1)));
      expect(hasForegroundSpeech(signal, opts)).toBe(true);
      const trimmed = trimSilence(signal, opts);
      // 1 s 语音 + 两侧各 200 ms(按 20 ms 帧取整,允许 ±2 帧)
      expect(trimmed.length / RATE).toBeGreaterThan(1.4 - 0.04 - 0.1);
      expect(trimmed.length / RATE).toBeLessThan(1.4 + 0.04 + 0.1);
    });

  it("a far speaker below the near-field threshold is rejected (documented limitation)", () => {
    expect(hasForegroundSpeech(mix(voice(2, -42, 8), noise(2, -55, 9)), opts)).toBe(false);
  });

  it("a short loud click is not speech", () => {
    expect(hasForegroundSpeech(concat(silence(0.5), voice(0.1, -10, 10), silence(0.5)), opts)).toBe(false);
  });

  it("speech just over the minimum duration counts", () => {
    expect(hasForegroundSpeech(concat(silence(0.5), voice(MIN_SPEECH_MS / 1000 + 0.06, -20, 11), silence(0.5)), opts)).toBe(true);
  });
});

describe("building blocks", () => {
  it("frames every 20 ms", () => {
    expect(frameLevels(silence(1), RATE)).toHaveLength(50);
  });
  it("finds runs of at least minFrames above the threshold", () => {
    const L = [-60, -20, -20, -60, -20, -20, -20, -20, -60];
    expect(speechRuns(L, -38, 3)).toEqual([[4, 8]]);
    expect(speechRuns(L, -38, 2)).toEqual([[1, 3], [4, 8]]);
  });
  it("pads trimmed speech and clamps at the edges", () => {
    const s = concat(voice(0.5, -20, 12), silence(1));
    const trimmed = trimSilence(s, { sampleRate: RATE, padMs: PAD_MS });
    expect(trimmed.length / RATE).toBeCloseTo(0.7, 1);
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/audio/energy-gate.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** —— `web/src/audio/energy-gate.ts`:

```ts
import { dbfs, frameRms } from "./pcm";

/** 近讲能量门限(计划 R10)。只能降低旁人声音的影响,不能消除。 */
export const FRAME_MS = 20;
export const NEAR_FIELD_DBFS = -38;
export const PAD_MS = 200;
export const MIN_SPEECH_MS = 250;

export interface GateOptions {
  sampleRate: number;
  thresholdDbfs?: number;
  padMs?: number;
  minSpeechMs?: number;
}

export function frameLevels(samples: Float32Array, sampleRate: number): number[] {
  const size = Math.round((sampleRate * FRAME_MS) / 1000);
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += size) levels.push(dbfs(frameRms(samples.subarray(i, i + size))));
  return levels;
}

export function speechRuns(levels: number[], thresholdDbfs: number, minFrames: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= levels.length; i++) {
    const loud = i < levels.length && levels[i] >= thresholdDbfs;
    if (loud && start < 0) start = i;
    if (!loud && start >= 0) {
      if (i - start >= minFrames) runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

function runsOf(samples: Float32Array, o: GateOptions) {
  const minFrames = Math.ceil((o.minSpeechMs ?? MIN_SPEECH_MS) / FRAME_MS);
  return speechRuns(frameLevels(samples, o.sampleRate), o.thresholdDbfs ?? NEAR_FIELD_DBFS, minFrames);
}

export function hasForegroundSpeech(samples: Float32Array, o: GateOptions): boolean {
  return runsOf(samples, o).length > 0;
}

export function trimSilence(samples: Float32Array, o: GateOptions): Float32Array {
  const runs = runsOf(samples, o);
  if (!runs.length) return new Float32Array(0);
  const frame = Math.round((o.sampleRate * FRAME_MS) / 1000);
  const pad = Math.round((o.sampleRate * (o.padMs ?? PAD_MS)) / 1000);
  const from = Math.max(0, runs[0][0] * frame - pad);
  const to = Math.min(samples.length, runs[runs.length - 1][1] * frame + pad);
  return samples.slice(from, to);
}
```

  注意:合成"人声"的帧能量只在 ±1.5 dB 内起伏,所以 −32 dBFS 用例的每一帧都高于 −38 dBFS 门限。若某个用例失败,先打印 `frameLevels` 检查合成信号;**不得**为让测试通过而改 `NEAR_FIELD_DBFS`/`MIN_SPEECH_MS`(它们是 R10 的数值)。真实语音的音节间能量起伏更大,这正是真机清单里"嘈杂环境/小声说话"一项标"未验证"的原因。

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/audio/energy-gate.test.ts` → PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/audio/energy-gate.ts web/src/audio/energy-gate.test.ts
git commit -m "feat(web): add a near-field energy gate and silence trimming with synthetic noise tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.3:Silero VAD(依赖、自托管资源、判定逻辑与封装)

**Files:**
- Modify: `web/package.json`(两个新依赖,精确版本;`dev`/`build` 脚本前置复制资源)、`yarn.lock`
- Create: `web/scripts/copy-vad-assets.mjs`
- Modify: `.gitignore`(追加 `web/public/vad/`)
- Modify: `web/public/sw.js`(`/vad/` 纳入缓存)、`web/src/pwa/sw.test.ts`(**只追加**两条用例)
- Modify: `web/vite.config.ts`(`define: { __VAD_ASSET_BASE__ }`)
- Create: `web/src/audio/vad-globals.d.ts`、`web/src/audio/speech-gate.ts`、`web/src/audio/speech-gate.test.ts`、`web/src/audio/vad.ts`、`web/src/audio/vad.test.ts`
- Modify: `docs/superpowers/plans/2026-10-07-voice-spike-results.md`(第 5 节「VAD 库 API 核对」)

**Interfaces:**
- Consumes:Task 2.1 的 `frameRms`、`dbfs`。
- Produces(`speech-gate.ts`,纯):`type VadSensitivity = "normal" | "bot-speaking"`;`interface GatePreset { startProb: number; endProb: number; minSpeechMs: number; redemptionMs: number; minDbfs: number }`;`VAD_PRESETS: Record<VadSensitivity, GatePreset>`(normal `{0.5, 0.35, 250, 600, -38}`,bot-speaking `{0.8, 0.35, 400, 600, -30}`);`type GateEvent = { type: "speech-start" } | { type: "speech-end"; durationMs: number }`;`class SpeechGate(frameMs: number, preset: GatePreset)`,`push(prob: number, level: number): GateEvent[]`、`setPreset(p: GatePreset): void`、`reset(): void`、只读 `speaking: boolean`。
- Produces(`vad.ts`):`VAD_FRAME_MS = 32`;`interface ProbabilitySource { start(): void; pause(): void; destroy(): Promise<void> }`;`type ProbabilityLoader = (opts: { stream: MediaStream; onFrame(prob: number, frame: Float32Array): void }) => Promise<ProbabilitySource>`;`interface VadCallbacks { onSpeechStart(): void; onSpeechEnd(durationMs: number): void }`;`interface VadHandle { start(): void; pause(): void; setSensitivity(s: VadSensitivity): void; destroy(): Promise<void> }`;`createVad(stream: MediaStream, callbacks: VadCallbacks, loader?: ProbabilityLoader): Promise<VadHandle>`;`loadSileroSource: ProbabilityLoader`(动态 `import("@ricky0123/vad-web")`,资源路径 `__VAD_ASSET_BASE__` = `/vad/<版本>/`)。

- [ ] **Step 1: 安装与核对 API**

```bash
cd /e/workspace/everyone-can-use-english
yarn npm info @ricky0123/vad-web --fields version,peerDependencies,dependencies
yarn workspace web add -E @ricky0123/vad-web@<上一步的最新版本> onnxruntime-web@<vad-web 声明的兼容版本>
```

  (`yarn add` 会打印无关的 sqlite3 node-gyp 错误,忽略。)然后读类型声明核对:`find node_modules/@ricky0123/vad-web/dist -name "*.d.ts" | head`,在其中查找 `MicVAD`、`getStream`(或 `stream`)、`onFrameProcessed`、`baseAssetPath`、`onnxWASMBasePath`、`model`、`pause`、`start`、`destroy` 的签名,以及 `dist/` 下的资源文件名(`*.onnx`、`vad.worklet*.js`)和 `node_modules/onnxruntime-web/dist/` 下的 `ort-wasm*.wasm`/`*.mjs`。把核对结果写进 spike 结论第 5 节(每项"有/没有 + 实际签名");`loadSileroSource` 按核对到的真实签名写(下方代码以 `getStream` + `onFrameProcessed(probs, frame)` 为准;若该版本用 `stream` 选项或回调签名不同,只改 `loadSileroSource` 内部,接口不变)。**若 `onFrameProcessed` 不存在**:`loadSileroSource` 改为在 `onSpeechStart/onSpeechEnd` 回调上合成概率(开始 → 连续推 1.0,结束 → 推 0),并在第 5 节记录"阈值由库自身决定,bot-speaking 预设只有能量条件生效"。

- [ ] **Step 2: 资源复制脚本** —— `web/scripts/copy-vad-assets.mjs`:

```js
// 把 Silero VAD 模型、worklet 与 onnxruntime wasm 复制到 public/vad/<版本>/(计划 R18,不走 CDN)。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8"));
const version = pkg.dependencies["@ricky0123/vad-web"];
const require = createRequire(path.join(webRoot, "package.json"));

function packageDir(name) {
  let dir = path.dirname(require.resolve(name));
  while (!existsSync(path.join(dir, "package.json")) || JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name !== name) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`cannot locate ${name}`);
    dir = parent;
  }
  return dir;
}

const out = path.join(webRoot, "public", "vad", version);
mkdirSync(out, { recursive: true });
const sources = [
  [path.join(packageDir("@ricky0123/vad-web"), "dist"), /^(silero_vad.*\.onnx|vad\.worklet.*\.js)$/],
  [path.join(packageDir("onnxruntime-web"), "dist"), /^ort-wasm.*\.(wasm|mjs)$/],
];
let copied = 0;
for (const [dir, pattern] of sources) {
  for (const file of readdirSync(dir)) {
    if (pattern.test(file)) {
      copyFileSync(path.join(dir, file), path.join(out, file));
      copied++;
    }
  }
}
if (copied < 3) throw new Error(`expected VAD assets, copied ${copied}`);
console.log(`copied ${copied} VAD assets to public/vad/${version}/`);
```

  `web/package.json` 的 scripts:`"dev": "node scripts/copy-vad-assets.mjs && vite"`、`"build": "node scripts/copy-vad-assets.mjs && vite build"`。`.gitignore` 追加一行 `web/public/vad/`。运行 `node web/scripts/copy-vad-assets.mjs` → 打印复制数量 ≥ 3。`server/Dockerfile` 的 web 阶段整个 `COPY web ./web` 并运行 `yarn workspace web build`,脚本随之执行,无需改 Dockerfile(在门槛 2 的 `docker compose build` 里验证)。

- [ ] **Step 3: Vite define 与 SW** —— `vite.config.ts` 的返回对象加 `define: { __VAD_ASSET_BASE__: JSON.stringify(`/vad/${pkg.dependencies?.["@ricky0123/vad-web"] ?? "0"}/`) },`(`pkg` 已在文件顶部读取);新建 `web/src/audio/vad-globals.d.ts`:`declare const __VAD_ASSET_BASE__: string;`。`web/public/sw.js` 的 fetch 处理里把 `!url.pathname.startsWith("/assets/")` 改为 `!(url.pathname.startsWith("/assets/") || url.pathname.startsWith("/vad/"))`,文件头注释改为"只缓存带哈希的静态资源(/assets/*)与带版本目录的 VAD 资源(/vad/<版本>/*)"。`web/src/pwa/sw.test.ts` **末尾追加**:

```ts
describe("VAD assets (plan 2026-10-07 R18)", () => {
  it("caches versioned VAD assets like hashed assets", async () => {
    const { listeners, fetchMock } = load();
    const first = fetchEvent("https://app.test/vad/0.0.29/silero_vad_v5.onnx");
    listeners.fetch(first);
    expect(await (await first.respondWith.mock.calls[0][0]).text()).toBe("asset");
    const second = fetchEvent("https://app.test/vad/0.0.29/silero_vad_v5.onnx");
    listeners.fetch(second);
    await second.respondWith.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("still ignores other same-origin paths", () => {
    const { listeners } = load();
    const event = fetchEvent("https://app.test/vadx/a.js");
    listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });
});
```

  (写法与既有用例 "serves hashed assets cache-first" 相同:`load()`、`fetchEvent()`、`respondWith.mock.calls[0][0]` 都是该文件已有的辅助。)

- [ ] **Step 4: 写判定逻辑的失败测试** —— `web/src/audio/speech-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SpeechGate, VAD_PRESETS, type GateEvent } from "./speech-gate";

const F = 32; // ms/帧
function run(gate: SpeechGate, frames: Array<[number, number]>): GateEvent[] {
  return frames.flatMap(([p, db]) => gate.push(p, db));
}
const repeat = (n: number, frame: [number, number]) => Array.from({ length: n }, () => frame);

describe("SpeechGate (normal)", () => {
  it("starts after the minimum speech time and ends after the redemption time", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(8, [0.9, -20]), ...repeat(19, [0.1, -60]), ...repeat(1, [0.1, -60])]);
    expect(events).toEqual([{ type: "speech-start" }, { type: "speech-end", durationMs: 8 * F }]);
  });

  it("ignores a burst shorter than the minimum", () => {
    expect(run(new SpeechGate(F, VAD_PRESETS.normal), [...repeat(7, [0.9, -20]), ...repeat(30, [0.1, -60])])).toEqual([]);
  });

  it("does not start on quiet speech below the energy floor (distant voices)", () => {
    expect(run(new SpeechGate(F, VAD_PRESETS.normal), repeat(40, [0.95, -45]))).toEqual([]);
  });

  it("a short pause inside speech does not end it", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(10, [0.9, -20]), ...repeat(10, [0.1, -60]), ...repeat(10, [0.9, -20])]);
    expect(events).toEqual([{ type: "speech-start" }]);
    expect(g.speaking).toBe(true);
  });

  it("probabilities between the end and start thresholds keep a candidate waiting", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    expect(run(g, [...repeat(4, [0.9, -20]), ...repeat(3, [0.4, -20]), ...repeat(4, [0.9, -20])])).toEqual([{ type: "speech-start" }]);
  });
});

describe("SpeechGate (bot speaking: echo protection)", () => {
  it("needs a higher probability, more energy and longer speech", () => {
    const g = new SpeechGate(F, VAD_PRESETS["bot-speaking"]);
    expect(run(g, repeat(20, [0.7, -20]))).toEqual([]); // 概率不够
    g.reset();
    expect(run(g, repeat(20, [0.9, -34]))).toEqual([]); // 能量不够(回声通常较弱)
    g.reset();
    expect(run(g, repeat(12, [0.9, -20]))).toEqual([]); // 384 ms < 400 ms
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([{ type: "speech-start" }]);
  });

  it("switching presets mid-stream applies from the next frame", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    run(g, repeat(4, [0.9, -20]));
    g.setPreset(VAD_PRESETS["bot-speaking"]);
    expect(run(g, repeat(4, [0.9, -20]))).toEqual([]); // 8 帧 = 256 ms < 400 ms
  });
});
```

  `web/src/audio/vad.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createVad, type ProbabilityLoader } from "./vad";
import { fakeStream } from "~/test/fake-audio";

function fakeLoader() {
  let push: (prob: number, frame: Float32Array) => void = () => undefined;
  const source = { start: vi.fn(), pause: vi.fn(), destroy: vi.fn(async () => undefined) };
  const loader: ProbabilityLoader = vi.fn(async ({ onFrame }) => {
    push = onFrame;
    return source;
  });
  const loud = new Float32Array(512).fill(0.2); // ≈ -14 dBFS
  return { loader, source, frame: (prob: number, f = loud) => push(prob, f) };
}

describe("createVad", () => {
  it("turns probabilities and frame energy into speech start/end", async () => {
    const f = fakeLoader();
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    const vad = await createVad(fakeStream(), { onSpeechStart, onSpeechEnd }, f.loader);
    vad.start();
    expect(f.source.start).toHaveBeenCalled();
    for (let i = 0; i < 8; i++) f.frame(0.9);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 19; i++) f.frame(0.05);
    expect(onSpeechEnd).toHaveBeenCalledWith(256);
  });

  it("raises thresholds while the bot speaks", async () => {
    const f = fakeLoader();
    const onSpeechStart = vi.fn();
    const vad = await createVad(fakeStream(), { onSpeechStart, onSpeechEnd: vi.fn() }, f.loader);
    vad.setSensitivity("bot-speaking");
    for (let i = 0; i < 10; i++) f.frame(0.9);
    expect(onSpeechStart).not.toHaveBeenCalled();
    vad.setSensitivity("normal");
    for (let i = 0; i < 8; i++) f.frame(0.9);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("destroy releases the source once and ignores later frames", async () => {
    const f = fakeLoader();
    const onSpeechStart = vi.fn();
    const vad = await createVad(fakeStream(), { onSpeechStart, onSpeechEnd: vi.fn() }, f.loader);
    await vad.destroy();
    await vad.destroy();
    expect(f.source.destroy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) f.frame(0.9);
    expect(onSpeechStart).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: 运行确认失败** —— `yarn workspace web test src/audio/speech-gate.test.ts src/audio/vad.test.ts src/pwa/sw.test.ts` → speech-gate/vad FAIL(模块不存在),sw 新用例 PASS(Step 3 已改)。

- [ ] **Step 6: 实现** —— `web/src/audio/speech-gate.ts`:

```ts
/** VAD 判定(计划 R10):Silero 概率 + 帧能量双条件;机器人说话时用更严的预设防回声误触发。 */
export type VadSensitivity = "normal" | "bot-speaking";

export interface GatePreset {
  startProb: number;
  endProb: number;
  minSpeechMs: number;
  redemptionMs: number;
  minDbfs: number;
}

export const VAD_PRESETS: Record<VadSensitivity, GatePreset> = {
  normal: { startProb: 0.5, endProb: 0.35, minSpeechMs: 250, redemptionMs: 600, minDbfs: -38 },
  "bot-speaking": { startProb: 0.8, endProb: 0.35, minSpeechMs: 400, redemptionMs: 600, minDbfs: -30 },
};

export type GateEvent = { type: "speech-start" } | { type: "speech-end"; durationMs: number };

export class SpeechGate {
  private state: "idle" | "candidate" | "speaking" = "idle";
  private candidateMs = 0;
  private speechMs = 0;
  private silenceMs = 0;

  constructor(private readonly frameMs: number, private preset: GatePreset) {}

  get speaking(): boolean {
    return this.state === "speaking";
  }

  setPreset(preset: GatePreset): void {
    this.preset = preset;
  }

  reset(): void {
    this.state = "idle";
    this.candidateMs = this.speechMs = this.silenceMs = 0;
  }

  push(prob: number, level: number): GateEvent[] {
    const p = this.preset;
    const qualifies = prob >= p.startProb && level >= p.minDbfs;
    if (this.state === "idle") {
      if (qualifies) {
        this.state = "candidate";
        this.candidateMs = this.frameMs;
      }
    } else if (this.state === "candidate") {
      if (qualifies) this.candidateMs += this.frameMs;
      else if (prob < p.endProb) this.reset();
    } else if (prob < p.endProb) {
      this.silenceMs += this.frameMs;
      if (this.silenceMs >= p.redemptionMs) {
        const durationMs = this.speechMs;
        this.reset();
        return [{ type: "speech-end", durationMs }];
      }
      return [];
    } else {
      this.speechMs += this.silenceMs + this.frameMs;
      this.silenceMs = 0;
      return [];
    }
    if (this.state === "candidate" && this.candidateMs >= p.minSpeechMs) {
      this.state = "speaking";
      this.speechMs = this.candidateMs;
      this.silenceMs = 0;
      return [{ type: "speech-start" }];
    }
    return [];
  }
}
```

  `web/src/audio/vad.ts`:

```ts
import { dbfs, frameRms } from "./pcm";
import { SpeechGate, VAD_PRESETS, type VadSensitivity } from "./speech-gate";

export const VAD_FRAME_MS = 32; // Silero v5:16 kHz 下 512 个采样一帧

export interface ProbabilitySource {
  start(): void;
  pause(): void;
  destroy(): Promise<void>;
}

export type ProbabilityLoader = (opts: { stream: MediaStream; onFrame(prob: number, frame: Float32Array): void }) => Promise<ProbabilitySource>;

export interface VadCallbacks {
  onSpeechStart(): void;
  onSpeechEnd(durationMs: number): void;
}

export interface VadHandle {
  start(): void;
  pause(): void;
  setSensitivity(s: VadSensitivity): void;
  destroy(): Promise<void>;
}

/** 懒加载 @ricky0123/vad-web(只在开始通话时下载模型与 wasm;资源同源自托管,R18)。 */
export const loadSileroSource: ProbabilityLoader = async ({ stream, onFrame }) => {
  const { MicVAD } = await import("@ricky0123/vad-web");
  const vad = await MicVAD.new({
    model: "v5",
    baseAssetPath: __VAD_ASSET_BASE__,
    onnxWASMBasePath: __VAD_ASSET_BASE__,
    getStream: async () => stream,
    // 库自身的阈值放到最宽:是否算"说话"由 SpeechGate 决定
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.25,
    onFrameProcessed: (probs: { isSpeech: number }, frame: Float32Array) => onFrame(probs.isSpeech, frame),
    onSpeechStart: () => undefined,
    onSpeechEnd: () => undefined,
  });
  return { start: () => vad.start(), pause: () => vad.pause(), destroy: async () => vad.destroy() };
};

export async function createVad(stream: MediaStream, callbacks: VadCallbacks, loader: ProbabilityLoader = loadSileroSource): Promise<VadHandle> {
  const gate = new SpeechGate(VAD_FRAME_MS, VAD_PRESETS.normal);
  let destroyed = false;
  const source = await loader({
    stream,
    onFrame(prob, frame) {
      if (destroyed) return;
      for (const event of gate.push(prob, dbfs(frameRms(frame)))) {
        if (event.type === "speech-start") callbacks.onSpeechStart();
        else callbacks.onSpeechEnd(event.durationMs);
      }
    },
  });
  let destroying: Promise<void> | null = null;
  return {
    start: () => source.start(),
    pause: () => source.pause(),
    setSensitivity: (s) => gate.setPreset(VAD_PRESETS[s]),
    destroy() {
      destroyed = true;
      destroying ??= source.destroy();
      return destroying;
    },
  };
}
```

  若 `MicVAD.new` 的选项类型与上面不一致导致 typecheck 失败,按 Step 1 核对到的真实签名修改 `loadSileroSource`(只改这个函数)。

- [ ] **Step 7: 运行确认通过** —— `yarn workspace web test src/audio src/pwa` → PASS;`yarn workspace web typecheck` → 0 错误;`yarn workspace web build` → 成功,且 `ls web/dist/vad/*/` 列出模型与 wasm(Vite 会把 `public/` 原样复制到 `dist/`),`ls web/dist/assets | grep -i vad` 有懒加载分块。

- [ ] **Step 8: 提交**

```bash
git add web/package.json yarn.lock web/scripts/copy-vad-assets.mjs .gitignore web/public/sw.js web/src/pwa/sw.test.ts web/vite.config.ts web/src/audio/vad-globals.d.ts web/src/audio/speech-gate.ts web/src/audio/speech-gate.test.ts web/src/audio/vad.ts web/src/audio/vad.test.ts docs/superpowers/plans/2026-10-07-voice-spike-results.md
git commit -m "feat(web): add a self-hosted Silero VAD with an echo-aware speech gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.4:语音消息改用 PCM 采集(无 2 s 兜底、不解码、无前景语音不上传)

**Files:**
- Create: `web/src/audio/pcm-recording.ts`、`web/src/audio/pcm-recording.test.ts`
- Modify: `web/src/audio/recorder.ts`(`RecordingResult` 加可选 `noSpeech?: boolean`)
- Modify: `web/src/audio/use-recorder.ts`(可注入的启动器)、`web/src/audio/use-recorder.test.tsx`(**只追加**)
- Modify: `web/src/audio/convert.ts`(16 kHz 单声道 16 位 WAV 快速路径)、`web/src/audio/convert.test.ts`(**只追加**)
- Modify: `web/src/features/chat/use-voice-turn.ts`(`noSpeech` → 不上传,直接 `failed`)、`web/src/features/chat/use-voice-turn.test.tsx`(**只追加**)

**Interfaces:**
- Consumes:Task 2.1 的 `startPcmCapture`、`CaptureEnv`、`floatToPcm16`;Task 2.2 的 `trimSilence`、`hasForegroundSpeech`;`wav.ts` 的 `encodeWavPcm16`、`ASSESSMENT_SAMPLE_RATE`。
- Produces:`type PcmRecordingEnv = CaptureEnv & Pick<RecorderEnv, "now" | "document" | "setTimeout" | "clearTimeout">`;`browserPcmRecordingEnv(): PcmRecordingEnv`;`startPcmRecording(options?: { maxDurationMs?: number; env?: PcmRecordingEnv }): Promise<RecordingSession>`(结果:`mimeType: "audio/wav"`、`blob` 为裁剪后的 16 kHz WAV、`durationMs` 为裁剪后时长、`noSpeech` 为 `!hasForegroundSpeech(原始样本)`;没有语音时 `blob` 是**未裁剪**的原始录音,便于用户"仍然发送");`type RecordingStarter = (opts: { maxDurationMs?: number }) => Promise<RecordingSession>`;`useRecorder({ ..., starter?: RecordingStarter })`(未传 `env` 与 `starter` 时:`pcmCaptureSupported()` 为真用 `startPcmRecording`,否则旧的 `startRecording`;传了 `env` 一律旧路径——既有测试不受影响);`parseAssessmentWav(data: ArrayBuffer): Float32Array | null`(`convert.ts`,`toAssessmentWav` 命中时跳过解码与重采样);`use-voice-turn`:`recording.noSpeech === true` 且是首次处理 → `onDraft({kind: "failed", key, error: t("web.chat.noSpeech")})`、**不上传**;对该草稿点"重试"会照常上传(用户坚持发送)。

- [ ] **Step 1: 写失败的测试** —— `web/src/audio/pcm-recording.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { startPcmRecording, type PcmRecordingEnv } from "./pcm-recording";
import { FakeAudioContext, FakeWorkletNode, asContext, fakeStream } from "~/test/fake-audio";

function setup() {
  const ctx = new FakeAudioContext(16000);
  const node = new FakeWorkletNode();
  const stream = fakeStream();
  let now = 0;
  const timers: Array<() => void> = [];
  const listeners: Record<string, () => void> = {};
  const env: PcmRecordingEnv = {
    isSecureContext: true,
    getUserMedia: vi.fn(async () => stream),
    supportedConstraints: () => ({}),
    createAudioContext: () => asContext(ctx),
    createWorkletNode: () => node as unknown as AudioWorkletNode,
    workletUrl: "/w.js",
    now: () => now,
    document: { visibilityState: "visible", addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: vi.fn() } as never,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: vi.fn(),
  };
  const tone = (seconds: number, amp: number) =>
    Float32Array.from({ length: seconds * 16000 }, (_, i) => amp * Math.sin((2 * Math.PI * 200 * i) / 16000));
  return { env, ctx, node, stream, tone, advance: (ms: number) => (now += ms), timers, listeners };
}

describe("startPcmRecording", () => {
  it("stops immediately with a trimmed 16 kHz WAV and releases the microphone", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env });
    s.node.emit(new Float32Array(16000)); // 1 s 静音
    s.node.emit(s.tone(1, 0.3)); // 1 s "语音"
    s.node.emit(new Float32Array(16000));
    s.advance(3000);
    const result = await session.stop();
    expect(result.mimeType).toBe("audio/wav");
    expect(result.noSpeech).toBe(false);
    expect(result.durationMs).toBeGreaterThan(1300);
    expect(result.durationMs).toBeLessThan(1500);
    expect(result.stoppedBy).toBe("user");
    expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
  });

  it("flags recordings without foreground speech and keeps them untrimmed", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env });
    s.node.emit(s.tone(2, 0.003)); // ≈ -53 dBFS
    const result = await session.stop();
    expect(result.noSpeech).toBe(true);
    expect(result.durationMs).toBe(2000);
  });

  it("auto-stops at the maximum duration", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env, maxDurationMs: 60_000 });
    s.node.emit(s.tone(1, 0.3));
    s.timers[0]();
    expect((await session.result).stoppedBy).toBe("max_duration");
  });

  it("stops as background when the page is hidden, and cancel releases without a result", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env });
    (s.env.document as { visibilityState: string }).visibilityState = "hidden";
    s.listeners.visibilitychange();
    expect((await session.result).stoppedBy).toBe("background");
    const s2 = setup();
    const other = await startPcmRecording({ env: s2.env });
    other.cancel();
    expect(s2.stream.track.stop).toHaveBeenCalledTimes(1);
  });
});
```

  `use-recorder.test.tsx` 末尾追加:

```tsx
describe("injectable starter (plan 2026-10-07 Task 2.4)", () => {
  it("uses the given starter instead of MediaRecorder", async () => {
    const result = { blob: new Blob(["x"], { type: "audio/wav" }), mimeType: "audio/wav", durationMs: 500, stoppedBy: "user" as const };
    const session = { startedAt: 0, result: Promise.resolve(result), stop: vi.fn(async () => result), cancel: vi.fn() };
    const starter = vi.fn(async () => session);
    const { result: hook } = renderHook(() => useRecorder({ starter }));
    await act(async () => { await hook.current.start(); });
    expect(starter).toHaveBeenCalledWith({ maxDurationMs: expect.any(Number) });
    await act(async () => { expect(await hook.current.stop()).toBe(result); });
  });
});
```

  (若该文件顶部没有导入 `act`/`renderHook`/`vi`,按既有导入补齐——只增加导入,不改既有用例。)

  `convert.test.ts` 末尾追加:

```ts
import { encodeWavPcm16 } from "./wav";
import { parseAssessmentWav } from "./convert";

describe("16 kHz WAV fast path (plan 2026-10-07 Task 2.4)", () => {
  it("returns samples for 16 kHz mono 16-bit WAV and null otherwise", async () => {
    const wav = encodeWavPcm16(new Float32Array(1600).fill(0.5), 16000);
    const samples = parseAssessmentWav(await new Blob([wav]).arrayBuffer());
    expect(samples?.length).toBe(1600);
    expect(parseAssessmentWav(await new Blob([encodeWavPcm16(new Float32Array(10), 44100)]).arrayBuffer())).toBeNull();
    expect(parseAssessmentWav(new ArrayBuffer(4))).toBeNull();
  });

  it("toAssessmentWav skips decoding for such WAVs", async () => {
    const decode = vi.fn();
    const wav = new Blob([encodeWavPcm16(new Float32Array(16000), 16000)], { type: "audio/wav" });
    const out = await toAssessmentWav(wav, { decode, render: vi.fn() });
    expect(decode).not.toHaveBeenCalled();
    expect(out.durationMs).toBe(1000);
  });
});
```

  (`import` 语句放到文件顶部的导入区;`toAssessmentWav`、`vi` 若已导入则复用。)

  `use-voice-turn.test.tsx` 末尾追加(需要的导入——`encodeWavPcm16`(`~/audio/wav`)、`ApiClient`、`createFetchMock`/`json`、`act`/`renderHook`、`vi`——若文件顶部没有就补上,只增不改;若既有辅助只支持 `RecorderEnv`,用 `useRecorder` 的新 `starter` 无法从 `useVoiceTurn` 注入——因此本任务同时给 `UseVoiceTurnOptions` 加可选 `starter?: RecordingStarter` 并透传给 `useRecorder`):

```tsx
describe("no foreground speech (plan 2026-10-07 R10)", () => {
  it("does not upload a recording without foreground speech; retry uploads it", async () => {
    // 合法的 16 kHz WAV:重试时走 Task 2.4 的快速路径,不需要解码(jsdom 没有 OfflineAudioContext)
    const result = { blob: new Blob([encodeWavPcm16(new Float32Array(1600), 16000)], { type: "audio/wav" }), mimeType: "audio/wav", durationMs: 100, stoppedBy: "user" as const, noSpeech: true };
    const session = { startedAt: 0, result: Promise.resolve(result), stop: vi.fn(async () => result), cancel: vi.fn() };
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: "hello" }) });
    const onDraft = vi.fn();
    const onTranscribed = vi.fn();
    const { result: hook } = renderHook(() => useVoiceTurn({
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), newKey: () => "k1", onDraft, onTranscribed,
      starter: async () => session, urls: { create: () => "blob:1", revoke: () => undefined },
    }));
    await act(async () => { await hook.current.start(); });
    await act(async () => { await hook.current.stop(); });
    expect(onDraft).toHaveBeenLastCalledWith({ kind: "failed", key: "k1", error: expect.any(String) });
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/transcriptions")).toHaveLength(0);
    await act(async () => { hook.current.retry("k1"); });
    await vi.waitFor(() => expect(onTranscribed).toHaveBeenCalledWith(expect.objectContaining({ key: "k1" }), "hello"));
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/audio src/features/chat/use-voice-turn.test.tsx` → 新用例 FAIL。

- [ ] **Step 3: 实现**
  - `recorder.ts`:`RecordingResult` 加 `noSpeech?: boolean;`。
  - `web/src/audio/pcm-recording.ts`:

```ts
import { browserCaptureEnv, startPcmCapture, type CaptureEnv } from "./capture";
import { hasForegroundSpeech, trimSilence } from "./energy-gate";
import { TARGET_RATE } from "./pcm";
import type { RecorderEnv, RecordingResult, RecordingSession, StopReason } from "./recorder";
import { encodeWavPcm16 } from "./wav";

export type PcmRecordingEnv = CaptureEnv & Pick<RecorderEnv, "now" | "document" | "setTimeout" | "clearTimeout">;

export function browserPcmRecordingEnv(): PcmRecordingEnv {
  return {
    ...browserCaptureEnv(),
    now: () => Date.now(),
    document,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

/** 与 MediaRecorder 版 startRecording 相同的契约;停止即出结果(无 2 s 兜底),结果已是 16 kHz WAV(R9)。 */
export async function startPcmRecording(options: { maxDurationMs?: number; env?: PcmRecordingEnv } = {}): Promise<RecordingSession> {
  const env = options.env ?? browserPcmRecordingEnv();
  const capture = await startPcmCapture({ env, collect: true });
  const startedAt = env.now();
  let settled = false;
  let timer: unknown;
  let resolve!: (r: RecordingResult) => void;
  const result = new Promise<RecordingResult>((r) => (resolve = r));

  const cleanup = () => {
    if (timer !== undefined) env.clearTimeout(timer);
    env.document.removeEventListener("visibilitychange", onVisibility);
    capture.release();
  };
  const finish = (why: StopReason) => {
    if (settled) return;
    settled = true;
    const samples = capture.collected();
    cleanup();
    const opts = { sampleRate: TARGET_RATE };
    const noSpeech = !hasForegroundSpeech(samples, opts);
    const kept = noSpeech ? samples : trimSilence(samples, opts);
    resolve({
      blob: new Blob([encodeWavPcm16(kept, TARGET_RATE)], { type: "audio/wav" }),
      mimeType: "audio/wav",
      durationMs: Math.round((kept.length / TARGET_RATE) * 1000),
      stoppedBy: why,
      noSpeech,
    });
  };
  function onVisibility() {
    if (env.document.visibilityState === "hidden") finish("background");
  }
  env.document.addEventListener("visibilitychange", onVisibility);
  capture.onTrackEnded(() => finish("track_ended"));
  if (options.maxDurationMs) timer = env.setTimeout(() => finish("max_duration"), options.maxDurationMs);
  return {
    startedAt,
    result,
    stop: () => {
      finish("user");
      return result;
    },
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}
```

  - `use-recorder.ts`:新增导出 `export type RecordingStarter = (opts: { maxDurationMs?: number }) => Promise<RecordingSession>;`;`UseRecorderOptions` 加 `starter?: RecordingStarter`;在 hook 内用 `const starterRef = useRef(starter); starterRef.current = starter;`,`start` 里把 `await startRecording({ maxDurationMs, env })` 换成 `await (starterRef.current ?? defaultStarter(env))({ maxDurationMs })`,其中

```ts
function defaultStarter(env?: RecorderEnv): RecordingStarter {
  if (env) return (o) => startRecording({ ...o, env }); // 测试注入的 MediaRecorder 环境:旧路径
  return pcmCaptureSupported() ? (o) => startPcmRecording(o) : (o) => startRecording(o);
}
```

  - `convert.ts`:新增

```ts
/** 已是 16 kHz 单声道 16 位 PCM 的 WAV(PCM 采集的产物):直接取样本,不解码(R9)。 */
export function parseAssessmentWav(data: ArrayBuffer): Float32Array | null {
  if (data.byteLength < 44) return null;
  const v = new DataView(data);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt ") return null;
  if (v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== ASSESSMENT_SAMPLE_RATE || v.getUint16(34, true) !== 16) return null;
  if (tag(36) !== "data") return null;
  const bytes = Math.min(v.getUint32(40, true), data.byteLength - 44);
  const out = new Float32Array(Math.floor(bytes / 2));
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(44 + i * 2, true) / 0x8000;
  return out;
}
```

    `toAssessmentWav` 在 `const data = await blobToArrayBuffer(blob);` 之后加:`const direct = parseAssessmentWav(data); if (direct) { if (!direct.length) throw new AudioConvertError("empty"); const max = (MAX_RECORDING_MS / 1000) * ASSESSMENT_SAMPLE_RATE; const s = direct.length > max ? direct.subarray(0, max) : direct; return { wav: s === direct ? blob : new Blob([encodeWavPcm16(s, ASSESSMENT_SAMPLE_RATE)], { type: "audio/wav" }), durationMs: Math.round((s.length / ASSESSMENT_SAMPLE_RATE) * 1000) }; }`(`encodeWavPcm16` 写出的头是 44 字节标准头——以 `wav.ts` 实际实现为准核对偏移;若不同,按 `wav.ts` 修正偏移并在测试里用 `encodeWavPcm16` 生成的数据验证)。
  - `use-voice-turn.ts`:`UseVoiceTurnOptions` 加 `starter?: RecordingStarter` 并传给 `useRecorder({ env, starter, ... })`;`Draft` 加 `noSpeechChecked?: boolean`;`transcribeDraft` 在 `if (!draft.handoff) {` 之后第一行加:

```ts
        if (draft.recording.noSpeech && !draft.noSpeechChecked) {
          draft.noSpeechChecked = true; // 只拦第一次:用户点"重试"即视为坚持发送
          opts.current.onDraft({ kind: "failed", key, error: tRef.current("web.chat.noSpeech") });
          return;
        }
```

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/audio src/features/chat` → PASS(含 `conversation-page.test.tsx` 全部原样通过:它注入 `recorderEnv`,走旧路径);`yarn workspace web typecheck` → 0 错误。

- [ ] **Step 5: 提交**

```bash
git add web/src/audio/pcm-recording.ts web/src/audio/pcm-recording.test.ts web/src/audio/recorder.ts web/src/audio/use-recorder.ts web/src/audio/use-recorder.test.tsx web/src/audio/convert.ts web/src/audio/convert.test.ts web/src/features/chat/use-voice-turn.ts web/src/features/chat/use-voice-turn.test.tsx
git commit -m "perf(web): record voice messages as trimmed 16 kHz PCM and skip uploads without speech" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.5:"可能混入他人声音"提示与近讲说明

**Files:**
- Create: `web/src/features/chat/mixed-voices.ts`、`web/src/features/chat/mixed-voices.test.ts`
- Modify: `web/src/features/chat/result-badges.tsx`(`PronunciationBadge` 加可选 prop `transcript?: string`,在徽标旁显示提示)、`web/src/features/chat/voice-ui.test.tsx`(**只追加**)
- Modify: `web/src/features/chat/conversation-page.tsx`(第 761 行附近的 `<PronunciationBadge … />` 加 `transcript={m.content}`;**这是改对话页的任务之一,遵守串行顺序**)
- Modify: `web/src/features/chat/conversation-settings-sheet.tsx`(语音一节下方加一行说明)
- Modify: `web/src/features/chat/i18n/en.json`、`zh-CN.json`(`web.chat.voice.mixedVoices`、`web.chat.voice.nearFieldTip`)

**Interfaces:**
- Consumes:评测结果里的 `pronunciationScore` 与 `words[].word`(既有 `PronunciationAssessmentResult` 形状,`result-badges.tsx` 已在用)。
- Produces:`MIXED_SCORE_MAX = 40`、`MIXED_OVERLAP_MAX = 0.5`;`wordOverlap(transcript: string, assessedWords: string[]): number`(转写词集合中出现在评测词里的比例,小写、去标点;转写为空返回 1);`mayHaveMixedVoices(score: number | null | undefined, transcript: string, assessedWords: string[]): boolean`(`score < 40` 且 `overlap < 0.5`);徽标旁 `data-testid="voice-mixed-hint"`(`role="note"`,文本 `web.chat.voice.mixedVoices`)。

- [ ] **Step 1: 写失败的测试** —— `web/src/features/chat/mixed-voices.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mayHaveMixedVoices, wordOverlap } from "./mixed-voices";

describe("mixed voices hint (plan R10)", () => {
  it("measures how much of the transcript the assessment heard", () => {
    expect(wordOverlap("I want a coffee, please.", ["i", "want", "a", "coffee", "please"])).toBe(1);
    expect(wordOverlap("I want a coffee please", ["the", "bus", "is", "late", "coffee"])).toBe(0.2);
    expect(wordOverlap("", ["x"])).toBe(1);
  });
  it("hints only for a low score with a low overlap", () => {
    const heard = ["the", "bus", "is", "late"];
    expect(mayHaveMixedVoices(35, "I want a coffee please", heard)).toBe(true);
    expect(mayHaveMixedVoices(55, "I want a coffee please", heard)).toBe(false);
    expect(mayHaveMixedVoices(35, "the bus is late", heard)).toBe(false);
    expect(mayHaveMixedVoices(null, "I want a coffee please", heard)).toBe(false);
  });
});
```

  `voice-ui.test.tsx` 末尾追加(`SCORES`、`renderWithProviders`、`screen` 是该文件已有的导入/常量):

```tsx
describe("mixed voices hint (plan 2026-10-07 R10)", () => {
  const words = ["the", "bus", "is", "late"].map((word) => ({ word }) as never);
  it("shows a note for a low score that heard different words", () => {
    renderWithProviders(<PronunciationBadge view={{ status: "done", scores: { ...SCORES, pronunciationScore: 30 }, words }} transcript="I want a coffee please" onOpen={vi.fn()} />);
    expect(screen.getByTestId("voice-mixed-hint")).toHaveAttribute("role", "note");
  });
  it("stays quiet for a good score", () => {
    renderWithProviders(<PronunciationBadge view={{ status: "done", scores: { ...SCORES, pronunciationScore: 80 }, words }} transcript="I want a coffee please" onOpen={vi.fn()} />);
    expect(screen.queryByTestId("voice-mixed-hint")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/mixed-voices.test.ts src/features/chat/voice-ui.test.tsx` → FAIL。

- [ ] **Step 3: 实现** —— `web/src/features/chat/mixed-voices.ts`:

```ts
/** 评测分数很低且评测听到的词与转写差别很大:可能混入了他人声音(R10,只提示,不阻断)。 */
export const MIXED_SCORE_MAX = 40;
export const MIXED_OVERLAP_MAX = 0.5;

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);

export function wordOverlap(transcript: string, assessedWords: string[]): number {
  const said = words(transcript);
  if (!said.length) return 1;
  const heard = new Set(assessedWords.flatMap(words));
  return said.filter((w) => heard.has(w)).length / said.length;
}

export function mayHaveMixedVoices(score: number | null | undefined, transcript: string, assessedWords: string[]): boolean {
  return typeof score === "number" && Number.isFinite(score) && score < MIXED_SCORE_MAX && wordOverlap(transcript, assessedWords) < MIXED_OVERLAP_MAX;
}
```

  `result-badges.tsx`:`PronunciationBadge` 的 props 改为 `{ view?: AssessmentView; transcript?: string; onOpen(): void }`,把原来返回的 `<button>` 包进 `<span className="inline-flex items-center">…</span>`,在按钮之后、`mayHaveMixedVoices(view.scores?.pronunciationScore, transcript ?? "", (view.words ?? []).map((w) => w.word))` 为真时渲染 `<span data-testid="voice-mixed-hint" role="note" className="text-xs text-amber-700">{t("web.chat.voice.mixedVoices")}</span>`。设置面板在语音相关开关下方加 `<p data-testid="settings-near-field-tip" className="text-sm text-muted-foreground">{t("web.chat.voice.nearFieldTip")}</p>`。i18n:

  - en:`"mixedVoices": "Other voices may have been picked up"`、`"nearFieldTip": "Speak close to the microphone; in noisy places use a headset. Other people's voices cannot be fully excluded."`
  - zh-CN:`"mixedVoices": "可能混入了他人声音"`、`"nearFieldTip": "近讲模式:靠近麦克风说话,嘈杂环境建议戴耳机;无法完全排除旁人的声音。"`

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/features/chat src/i18n` → PASS(含 `conversation-page.test.tsx` 全量,它守护对话页既有规则)。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/mixed-voices.ts web/src/features/chat/mixed-voices.test.ts web/src/features/chat/result-badges.tsx web/src/features/chat/conversation-page.tsx web/src/features/chat/voice-ui.test.tsx web/src/features/chat/conversation-settings-sheet.tsx web/src/features/chat/i18n/en.json web/src/features/chat/i18n/zh-CN.json
git commit -m "feat(web): hint at mixed voices and explain near-field speaking" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.6:网页端流式切句

**Files:**
- Create: `web/src/features/chat/sentence-stream.ts`、`web/src/features/chat/sentence-stream.test.ts`

**Interfaces:**
- Consumes:`server/tests/fixtures/sentence_cases.json`(Task 1.4;若阶段 1 尚未合并,本任务先把该文件按 Task 1.4 Step 1 的内容**原样**创建并在提交信息里注明,合并时以 Task 1.4 的为准、内容必须一致)。
- Produces:`MAX_SENTENCE_CHARS = 200`;`interface SentenceStream { push(full: string): string[]; flush(): string[] }`(`push` 接收**累计全文**——`streamChatCompletion` 的 `onDelta(full)`;全文不是上次的延续时从头重来);`createSentenceStream(): SentenceStream`;`splitForSpeech(text: string): string[]`(= 一次 `push` + `flush`)。规则与 Task 1.4 完全相同(R7)。

- [ ] **Step 1: 写失败的测试** —— `web/src/features/chat/sentence-stream.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_SENTENCE_CHARS, createSentenceStream, splitForSpeech } from "./sentence-stream";

const CASES = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../server/tests/fixtures/sentence_cases.json", import.meta.url)), "utf8")) as Array<{ text: string; sentences: string[] }>;
const WORDS = ["hello", "world", "Mr.", "Dr.", "v3.14", "e.g.", "coffee", "please", "\"quoted\"", "really", "you", "tomorrow"];
const ENDINGS = [".", "!", "?", "?!", ".\"", "...", "…", "。"];
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const normalized = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

describe("shared conformance cases (plan R7)", () => {
  it.each(CASES.map((c) => [c.text, c.sentences] as const))("%j", (text, sentences) => {
    expect(splitForSpeech(text)).toEqual(sentences);
  });
});

describe("createSentenceStream", () => {
  it("takes the cumulative text and only emits complete sentences", () => {
    const s = createSentenceStream();
    expect(s.push("Hello there.")).toEqual([]);
    expect(s.push("Hello there. How")).toEqual(["Hello there."]);
    expect(s.push("Hello there. How are you?")).toEqual([]);
    expect(s.flush()).toEqual(["How are you?"]);
  });

  it("restarts when the text is not a continuation", () => {
    const s = createSentenceStream();
    s.push("Old text. More");
    expect(s.push("New start. Next")).toEqual(["New start."]);
  });

  it("cuts long sentences", () => {
    expect(splitForSpeech("x".repeat(450))).toEqual(["x".repeat(200), "x".repeat(200), "x".repeat(50)]);
  });

  it.each(Array.from({ length: 100 }, (_, i) => i))("random text %i: chunking does not matter and nothing is lost", (seed) => {
    const r = rng(seed + 1);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const sentences = Array.from({ length: 1 + Math.floor(r() * 8) }, () =>
      `${pick(["Hello", "Okay", "Yes", "Coffee"])} ${Array.from({ length: 1 + Math.floor(r() * 12) }, () => pick(WORDS)).join(" ")}${pick(ENDINGS)}`);
    const text = sentences.join(pick([" ", "  ", "\n"]));
    const whole = splitForSpeech(text);
    const s = createSentenceStream();
    const out: string[] = [];
    for (let i = 1; i <= text.length; i += 1 + Math.floor(r() * 15)) out.push(...s.push(text.slice(0, i)));
    out.push(...s.push(text), ...s.flush());
    expect(out).toEqual(whole);
    expect(whole.every((p) => p.length > 0 && p === p.trim() && p.length <= MAX_SENTENCE_CHARS)).toBe(true);
    expect(normalized(whole.join(" "))).toBe(normalized(text));
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/sentence-stream.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** —— `web/src/features/chat/sentence-stream.ts`(逐行对应 `server/app/sentence_split.py`;修改其中一边时必须同时修改另一边并补共享用例):

```ts
/** 流式切句(计划 R7);与 server/app/sentence_split.py 同一规则,共享 server/tests/fixtures/sentence_cases.json。 */
export const MAX_SENTENCE_CHARS = 200;
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "u.s", "u.k",
  "fig", "approx", "dept", "inc", "ltd", "co", "mt", "jan", "feb", "aug", "sept", "oct", "nov", "dec",
]);
const TERMINATORS = ".!?";
const CJK_TERMINATORS = "。！？";
const CLOSERS = "\"'”’)]」』）";
const OPENER = /^[A-Z0-9"“'‘([]/;
const NEXT = /^\s+(\S)/;
const NEED_MORE = -1;

function isAbbreviation(text: string, dot: number): boolean {
  let start = dot;
  while (start > 0 && dot - start <= 10 && /[A-Za-z.]/.test(text[start - 1])) start--;
  if (dot - start > 10) return false;
  const token = text.slice(start, dot).toLowerCase();
  return !!token && (ABBREVIATIONS.has(token) || /^[a-z]$/.test(token));
}

/** [切点, 停下的位置];切点 null = 没有句末,NEED_MORE = 需要更多文本 */
function scan(s: string, final: boolean): [number | null, number] {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "\n") return [i + 1, i];
    if (ch === "…" || s.startsWith("...", i)) {
      i += ch === "…" ? 1 : 3;
      while (i < n && s[i] === ".") i++;
      continue;
    }
    if (CJK_TERMINATORS.includes(ch)) {
      let end = i + 1;
      while (end < n && (CJK_TERMINATORS.includes(s[end]) || CLOSERS.includes(s[end]))) end++;
      if (end === n && !final) return [NEED_MORE, i];
      return [end, i];
    }
    if (TERMINATORS.includes(ch)) {
      let end = i + 1;
      while (end < n && TERMINATORS.includes(s[end])) end++;
      while (end < n && CLOSERS.includes(s[end])) end++;
      const rest = s.slice(end);
      if (!rest.trim()) return final ? [end, i] : [NEED_MORE, i];
      const m = NEXT.exec(rest);
      if (m && OPENER.test(m[1]) && !(ch === "." && isAbbreviation(s, i))) return [end, i];
      i = end;
      continue;
    }
    i++;
  }
  return [null, n];
}

function forcedCut(s: string, limit: number): number {
  const head = s.slice(0, limit);
  for (const separators of [",;:", " "]) {
    const k = Math.max(...Array.from(separators, (c) => head.lastIndexOf(c)));
    if (k > 0) return k + 1;
  }
  return limit;
}

function clean(piece: string): string[] {
  const text = piece.trim();
  return /\p{L}/u.test(text) ? [text] : [];
}

export interface SentenceStream {
  push(full: string): string[];
  flush(): string[];
}

export function createSentenceStream(max = MAX_SENTENCE_CHARS): SentenceStream {
  let seen = "";
  let buf = "";
  const nextCut = (final: boolean): number | null => {
    const [cut, at] = scan(buf, final);
    if (cut !== null && cut !== NEED_MORE && cut <= max) return cut;
    if (buf.length > max && (cut !== NEED_MORE || at >= max)) return forcedCut(buf, max);
    if (cut === NEED_MORE) return null;
    return cut;
  };
  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    while (buf) {
      const cut = nextCut(final);
      if (cut === null) break;
      out.push(...clean(buf.slice(0, cut)));
      buf = buf.slice(cut);
    }
    return out;
  };
  return {
    push(full) {
      if (!full.startsWith(seen)) {
        seen = "";
        buf = "";
      }
      buf += full.slice(seen.length);
      seen = full;
      return drain(false);
    },
    flush() {
      const out = drain(true);
      const rest = buf;
      buf = "";
      return [...out, ...clean(rest)];
    },
  };
}

export function splitForSpeech(text: string): string[] {
  const s = createSentenceStream();
  return [...s.push(text), ...s.flush()];
}
```

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/features/chat/sentence-stream.test.ts` → PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/sentence-stream.ts web/src/features/chat/sentence-stream.test.ts
git commit -m "feat(web): add a streaming sentence splitter shared with the server rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.7:按句排队播放与流水线自动朗读(钩子层)

**Files:**
- Modify: `web/src/features/chat/use-tts-player.ts`(`playQueue`)
- Create: `web/src/features/chat/use-tts-player-queue.test.tsx`
- Modify: `web/src/features/chat/use-auto-speak.ts`(`progress`、`speakQueue` 选项、`complete` 接管队列)
- Create: `web/src/features/chat/use-auto-speak-pipeline.test.tsx`

**Interfaces:**
- Consumes:Task 2.6 的 `createSentenceStream`、`SentenceStream`;Task 0.1 的 `markLatency`;既有 `TtsPlayOptions`、`TtsPlaybackError`、`speakableText`、`ttsKey`、`sharedTtsCache`。
- Produces:`interface TtsQueue { push(sentence: string): void; end(): void }`;`useTtsPlayer(...).playQueue(messageKey: string, model: string, voice: string, opts?: TtsPlayOptions): TtsQueue`(停止当前播放、`claimAudio`、状态 `loading` → 第一句开始播放时 `playing` → `end()` 之后最后一句播完 `idle`;串行播放同一元素;最多预取 `QUEUE_PREFETCH = 2` 句;每句按 `ttsKey(model, voice, speakableText(sentence))` 走缓存;任一句合成或播放失败 → 状态 `error`、调用 `opts.onError ?? options.onError`、停止剩余;`stop()`/新的 `play()`/`playQueue()`/卸载会清空队列且不报错;第一句真正出声时 `markLatency("first_audio")`);`UseAutoSpeakOptions.speakQueue?: (key: string, onError: (err: unknown) => void) => TtsQueue`;`useAutoSpeak(...).progress(botKey: string, full: string): void`(R8:只对当前 `begin` 的 botKey 生效;`full` 含 "```" → 本条不走流水线;第一句完成时按 `autoSpeakDecision`(`status` 视为 `done`、`final` 不消耗)判断,"读"才开队列并把 key 记为已读;判断不读则本条不走流水线、留给 `complete` 按原规则判断);`complete` 在本条已开队列时:`done` → 推入 `flush()` 的剩余句子并 `end()`,其他状态 → `stop()`;并把"点此朗读"条的文本更新为完整回复;未开队列时行为与原来完全相同。没有提供 `speakQueue` 时 `progress` 是空操作。

- [ ] **Step 1: 写失败的测试** —— `web/src/features/chat/use-tts-player-queue.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TtsCache } from "./tts";
import { useTtsPlayer } from "./use-tts-player";

function fakeAudio() {
  return { src: "", play: vi.fn(() => Promise.resolve()), pause: vi.fn(), onended: null as null | (() => void), onerror: null } as unknown as HTMLAudioElement & { onended: () => void };
}
let n = 0;
const mkCache = () => new TtsCache(20, { create: () => `blob:${++n}`, revoke: () => undefined });
const inputs = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/speech").map((c) => JSON.parse(String(c.body)).input as string);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:silent"), revokeObjectURL: vi.fn() });
});

describe("useTtsPlayer.playQueue (plan R8)", () => {
  it("plays sentences in order, prefetching at most two", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache: mkCache(), createAudio: () => audio }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); });
    expect(result.current.states.a1).toBe("loading");
    act(() => { q.push("One."); q.push("Two."); q.push("Three."); q.push("Four."); });
    await flush();
    expect(result.current.states.a1).toBe("playing");
    expect(inputs(mock)).toEqual(["One.", "Two.", "Three."]); // 正在播放 1 句 + 预取 2 句
    act(() => audio.onended());
    await flush();
    expect(inputs(mock)).toEqual(["One.", "Two.", "Three.", "Four."]);
    act(() => q.end());
    for (let i = 0; i < 3; i++) {
      act(() => audio.onended());
      await flush();
    }
    expect(result.current.states.a1).toBe("idle");
    expect(audio.play).toHaveBeenCalledTimes(4);
  });

  it("stop() clears the queue without reporting an error", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const onError = vi.fn();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache: mkCache(), createAudio: () => audio, onError }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); });
    await flush();
    act(() => result.current.stop());
    act(() => q.push("Three."));
    act(() => audio.onended?.());
    await flush();
    expect(result.current.states.a1).toBe("idle");
    expect(inputs(mock)).not.toContain("Three.");
    expect(onError).not.toHaveBeenCalled();
  });

  it("a failing sentence reports once and stops the rest", async () => {
    let call = 0;
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => (++call === 2 ? json({ error: "Upstream unavailable" }, 502) : new Response(new Uint8Array([1]))) });
    const onError = vi.fn();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache: mkCache(), createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v", { onError }); q.push("One."); q.push("Two."); q.end(); });
    await flush();
    act(() => audio.onended());
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.states.a1).toBe("error");
  });

  it("uses the sentence cache", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const cache = mkCache();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache, createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v"); q.push("Same."); q.end(); });
    await flush();
    act(() => audio.onended());
    await flush();
    act(() => { const q = result.current.playQueue("a2", "m", "v"); q.push("Same."); q.end(); });
    await flush();
    expect(inputs(mock)).toEqual(["Same."]);
  });
});
```

  `web/src/features/chat/use-auto-speak-pipeline.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoSpeak, type UseAutoSpeakOptions } from "./use-auto-speak";

function setup(over: Partial<UseAutoSpeakOptions> = {}) {
  const state = { enabled: true, idle: true };
  const queue = { push: vi.fn(), end: vi.fn() };
  const options = {
    isEnabled: () => state.enabled,
    voiceIdle: () => state.idle,
    hasVoice: () => true,
    prime: vi.fn(),
    stop: vi.fn(),
    speak: vi.fn(async () => undefined),
    onError: vi.fn(),
    speakQueue: vi.fn(() => queue),
    ...over,
  };
  const hook = renderHook(() => useAutoSpeak(options as UseAutoSpeakOptions));
  return { ...hook, options, queue, state };
}

describe("pipelined auto-read (plan R8)", () => {
  it("starts on the first complete sentence and ends with the rest", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Hello"));
    expect(options.speakQueue).not.toHaveBeenCalled();
    act(() => result.current.progress("a1", "Hello there. How"));
    expect(options.speakQueue).toHaveBeenCalledTimes(1);
    expect(queue.push).toHaveBeenLastCalledWith("Hello there.");
    act(() => result.current.progress("a1", "Hello there. How are you? Fine"));
    expect(queue.push).toHaveBeenLastCalledWith("How are you?");
    act(() => { result.current.complete("a1", "Hello there. How are you? Fine", "done"); });
    expect(queue.push).toHaveBeenLastCalledWith("Fine");
    expect(queue.end).toHaveBeenCalledTimes(1);
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("a reply too short for a sentence boundary falls back to the whole-reply path", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Sure"));
    act(() => { result.current.complete("a1", "Sure", "done"); });
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).toHaveBeenCalledWith("a1", "Sure", expect.any(Function));
  });

  it("busy during streaming defers to the decision at completion", () => {
    const { result, options, state } = setup();
    act(() => result.current.begin("a1"));
    state.idle = false;
    act(() => result.current.progress("a1", "One. Two"));
    expect(options.speakQueue).not.toHaveBeenCalled();
    state.idle = true;
    act(() => { result.current.complete("a1", "One. Two", "done"); });
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("an error mid-stream stops the queue", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => { result.current.complete("a1", "", "error"); });
    expect(options.stop).toHaveBeenCalled();
    expect(queue.end).not.toHaveBeenCalled();
  });

  it("code fences disable pipelining for that reply", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Look. ```js\nx()\n``` Done. More"));
    act(() => { result.current.complete("a1", "Look. ```js\nx()\n``` Done. More", "done"); });
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("ignores progress for a stale reply and without speakQueue", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a2"));
    act(() => result.current.progress("a1", "One. Two"));
    expect(options.speakQueue).not.toHaveBeenCalled();
    const plain = setup({ speakQueue: undefined });
    act(() => plain.result.current.begin("a1"));
    expect(() => act(() => plain.result.current.progress("a1", "One. Two"))).not.toThrow();
  });

  it("a disabled switch never opens a queue", () => {
    const { result, options, state } = setup();
    state.enabled = false;
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => { result.current.complete("a1", "One. Two", "done"); });
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/use-tts-player-queue.test.tsx src/features/chat/use-auto-speak-pipeline.test.tsx` → FAIL(`playQueue`/`progress` 不存在)。

- [ ] **Step 3: 实现 `playQueue`** —— `use-tts-player.ts`:顶部加 `export interface TtsQueue { push(sentence: string): void; end(): void }` 与 `export const QUEUE_PREFETCH = 2;`;在 `play` 之后加:

```ts
  const playQueue = useCallback((messageKey: string, model: string, voice: string, opts: TtsPlayOptions = {}): TtsQueue => {
    stop();
    claimAudio(stop);
    const controller = new AbortController();
    controllerRef.current = controller;
    currentRef.current = messageKey;
    setState(messageKey, "loading");
    const audio = element(); // 不在这里 prime:调用方已在点击里解锁共享元素(R5)
    const waiting: string[] = [];
    const fetched: Array<Promise<string>> = [];
    let next = 0;
    let ended = false;
    let busy = false;
    let first = true;
    const stale = () => controller.signal.aborted || currentRef.current !== messageKey;
    const prefetch = () => {
      while (fetched.length - next < QUEUE_PREFETCH + (busy ? 0 : 1) && waiting.length) {
        const input = waiting.shift()!;
        const key = ttsKey(model, voice, input);
        const hit = cache.get(key);
        const url = hit ? Promise.resolve(hit) : synthesizeSpeech(api, { input, model, voice }, controller.signal).then((blob) => cache.set(key, blob));
        url.catch(() => undefined); // 失败在轮到它时处理
        fetched.push(url);
      }
    };
    const fail = (err: unknown) => {
      currentRef.current = null;
      controllerRef.current = null;
      audio.onerror = null;
      audio.onended = null;
      releaseAudio(stop);
      setState(messageKey, "error");
      (opts.onError ?? onErrorRef.current)?.(err);
    };
    const pump = async (): Promise<void> => {
      if (busy || stale()) return;
      prefetch();
      if (next >= fetched.length) {
        if (ended) {
          currentRef.current = null;
          controllerRef.current = null;
          releaseAudio(stop);
          setState(messageKey, "idle");
        }
        return;
      }
      busy = true;
      try {
        const url = await fetched[next++];
        prefetch();
        if (stale()) return;
        audio.src = url;
        applyPlaybackRate(audio);
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new TtsPlaybackError());
          setState(messageKey, "playing");
          audio.play().then(() => {
            if (first) {
              first = false;
              markLatency("first_audio");
            }
          }, (err: unknown) => reject(new TtsPlaybackError(err)));
        });
        busy = false;
        void pump();
      } catch (err) {
        busy = false;
        if (stale()) return;
        fail(err);
      }
    };
    return {
      push(sentence) {
        if (ended || stale()) return;
        const input = speakableText(sentence);
        if (!input) return;
        waiting.push(input);
        void pump();
      },
      end() {
        ended = true;
        void pump();
      },
    };
  }, [api, cache, stop, element]);
```

  返回值改为 `return { states, play, playQueue, stop, prime };`。`prefetch` 的上限:不在播放时允许 3 个在途(1 个即将播放 + 2 个预取),播放中允许 2 个——与测试"正在播放 1 句 + 预取 2 句"一致。

- [ ] **Step 4: 实现 `progress`** —— `use-auto-speak.ts`:`import { createSentenceStream, type SentenceStream } from "./sentence-stream"; import type { TtsQueue } from "./use-tts-player";`;`UseAutoSpeakOptions` 加 `speakQueue?: (key: string, onError: (err: unknown) => void) => TtsQueue;`;hook 内加:

```ts
  const pipeRef = useRef<{ key: string; stream: SentenceStream; queue: TtsQueue | null; off: boolean } | null>(null);

  /** R8:回复流式进行中逐句朗读 */
  const progress = useCallback((botKey: string, full: string) => {
    const o = opts.current;
    if (!o.speakQueue || latestRef.current !== botKey || !mountedRef.current) return;
    let pipe = pipeRef.current;
    if (!pipe || pipe.key !== botKey) pipe = pipeRef.current = { key: botKey, stream: createSentenceStream(), queue: null, off: false };
    if (pipe.off) return;
    if (!pipe.queue && full.includes("```")) {
      pipe.off = true;
      return;
    }
    const sentences = pipe.stream.push(full);
    if (!sentences.length) return;
    if (!pipe.queue) {
      const decision = autoSpeakDecision({
        enabled: o.isEnabled(), status: "done", stale: false, alreadyRead: readRef.current.has(botKey), voiceIdle: o.voiceIdle(),
        hidden: typeof document !== "undefined" && document.hidden, hasVoice: o.hasVoice(), text: full,
      });
      if (decision !== "speak") {
        pipe.off = true; // 留给 complete 按原规则判断
        return;
      }
      readRef.current.add(botKey);
      pipe.queue = o.speakQueue(botKey, failureHandler(botKey, full));
    }
    sentences.forEach((s) => pipe!.queue!.push(s));
  }, [failureHandler]);
```

  `complete` 改为:

```ts
  const complete = useCallback((botKey: string, text: string, status: UiMessage["status"]) => {
    if (status === "done") markLatency("reply_done");
    const pipe = pipeRef.current?.key === botKey ? pipeRef.current : null;
    pipeRef.current = null;
    if (pipe?.queue) {
      if (status === "done") {
        pipe.stream.push(text).forEach((s) => pipe.queue!.push(s));
        pipe.stream.flush().forEach((s) => pipe.queue!.push(s));
        pipe.queue.end();
        if (blockedRef.current?.key === botKey && mountedRef.current) setBlocked({ key: botKey, text });
      } else {
        opts.current.stop();
      }
      return "speak" as const;
    }
    return run(botKey, text, status, latestRef.current !== botKey, status !== "streaming");
  }, [run]);
```

  `reset` 里加 `pipeRef.current = null;`;返回值加 `progress`。(`markLatency` 已在 Task 0.1 加到 `complete`,这里是同一行,不要重复。)

- [ ] **Step 5: 运行确认通过** —— `yarn workspace web test src/features/chat` → PASS(既有 `use-auto-speak.test.tsx`、`use-tts-player.test.tsx` 原样通过——它们不传 `speakQueue`、不调 `playQueue`)。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/chat/use-tts-player.ts web/src/features/chat/use-tts-player-queue.test.tsx web/src/features/chat/use-auto-speak.ts web/src/features/chat/use-auto-speak-pipeline.test.tsx
git commit -m "perf(web): read replies aloud sentence by sentence while they stream" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.8:对话页接入流水线朗读

**Files:**
- Modify: `web/src/features/chat/conversation-page.tsx`(`useAutoSpeak` 传 `speakQueue`;`send()` 的 `onDelta` 调 `progress`)
- Modify: `web/src/features/chat/conversation-page.test.tsx`(只做 R17 允许的改动 + 追加 `describe("pipelined auto-read")`)

**Interfaces:**
- Consumes:Task 2.7 的 `tts.playQueue`、`autoSpeak.progress`。
- Produces:对话页行为——流式回复中第一句完成即开始朗读(自动朗读开启且满足 R4 条件时);契约不变:`playQueue` 与 `play`/`prime`/`stop` 来自同一个 `tts` 实例(共享自动播放元素的单驱动者)。

- [ ] **Step 1: 写失败的测试** —— 在 `conversation-page.test.tsx` 末尾追加(使用该文件既有的 `setup()`、`routes()`、SSE 模拟辅助——先读文件里 "auto-read" 一节的写法,照抄其构造方式;以下以 `sse(...)` 表示该文件里构造流式响应的既有辅助):

```tsx
describe("pipelined auto-read (plan 2026-10-07 R8)", () => {
  it("requests speech per sentence and the sentences join to the reply", async () => {
    const reply = "Great choice. What size would you like? We have small and large.";
    const { calls, user } = await setup({ reply });
    await user.type(screen.getByTestId("chat-input"), "A latte please");
    await user.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(speechInputs(calls)).toEqual(["Great choice.", "What size would you like?", "We have small and large."]));
    expect(speechInputs(calls).join(" ")).toBe(reply);
  });
});
```

  `speechInputs(calls)` 在该 describe 内定义:`const speechInputs = (calls: RecordedCall[]) => calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/ai/audio/speech").map((c) => JSON.parse(String(c.body)).input as string);`。`setup({ reply })` 的参数名以既有辅助为准(若它不接受回复文本,就在该 describe 内用既有的 `route` 参数覆盖 `"POST /api/ai/chat/completions"` 返回分 3 段的 SSE)。

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/conversation-page.test.tsx -t "pipelined"` → FAIL(只有一次整条请求)。

- [ ] **Step 3: 实现** —— `conversation-page.tsx`:

```tsx
  const autoSpeak = useAutoSpeak({
    // …既有选项原样保留…
    speakQueue: (key, onError) => tts.playQueue(key, configRef.current?.ttsModel ?? "", configRef.current?.ttsVoice ?? "", { onError }),
  });
  const { begin: autoSpeakBegin, complete: autoSpeakComplete, progress: autoSpeakProgress } = autoSpeak;
```

  `send()` 里 `(full) => patch(botKey, { content: full })` 改为 `(full) => { patch(botKey, { content: full }); if (live()) autoSpeakProgress(botKey, full); }`,并把 `autoSpeakProgress` 加进 `send` 的依赖数组。

- [ ] **Step 4: 全量回归** —— `yarn workspace web test src/features/chat/conversation-page.test.tsx` 全量运行。对失败的既有用例逐个判断:若失败原因是"多句回复现在按句请求 TTS"(断言了请求次数或 `input` 等于整条回复),按 R17 改为断言按句请求且拼接等于原文,并把用例名写进门槛记录;**其他任何失败都是回归,修实现**。然后 `yarn workspace web test` 全量 → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/conversation-page.tsx web/src/features/chat/conversation-page.test.tsx
git commit -m "perf(web): start reading the first sentence while the reply streams" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 验收门槛 2

- [ ] `yarn workspace web typecheck` → 0 错误;`yarn workspace web build` → 成功,`web/dist/vad/<版本>/` 含模型与 wasm。
- [ ] `for i in 1 2 3; do yarn workspace web test 2>&1 | tail -3; done` → 三次都 0 failed,通过数 = 门槛 0 的数字 + 本阶段新增(写进门槛记录)。
- [ ] i18n 键集一致(`src/i18n/i18n.test.ts` 通过)。
- [ ] 既有测试只做了 R17 允许的改动:`git diff voice-latency-baseline -- web/src | grep '^-' | grep -v '^---' | grep -E '\.test\.tsx?'` 的每一行都能对应到门槛记录里列出的 R17 用例名(`use-auto-speak.test.tsx`、`use-tts-player.test.tsx` 必须没有 `-` 行)。
- [ ] `docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml build server` 成功(证明 Dockerfile 的 web 构建会复制 VAD 资源),构建后 `docker run --rm --entrypoint ls enjoy-e2e-server /web/dist/vad`(镜像名以 `docker compose images` 为准)列出版本目录。
- [ ] 手动走查(`yarn workspace web dev` + 本机 uvicorn,Chromium 手机模拟;上游不可用时只走查不依赖上游的部分):录一段语音消息,`localStorage.setItem("enjoy-web.debug.latency","1")` 后控制台出现 `[latency]` 记录;对着麦克风不说话录 2 s → 直接提示"没听清"、网络面板没有转写请求。

---
## 阶段 3:网页——按住说话 + 上滑取消 / 转文字

> 依赖:只需要现有识别接口(设计文档 §8);可与阶段 1 并行。对话页改动(Task 3.4)必须排在 Task 2.8 之后(串行文件)。

### Task 3.1:手势状态机(纯 reducer,穷举测试)

**Files:**
- Create: `web/src/features/chat/hold-to-talk.ts`、`web/src/features/chat/hold-to-talk.test.ts`

**Interfaces:**
- Consumes:`VOICE_MAX_MS`(`use-voice-turn.ts`)。
- Produces:`SHORT_PRESS_MS = 300`、`SLIDE_ARM_PX = 80`、`SLIDE_DISARM_PX = 40`、`MAX_HOLD_MS = VOICE_MAX_MS - 250`(在录音器自己的 60 s 自动发送之前先按落点处理,R11);`type HoldState = "idle" | "pressing" | "recording" | "armed-cancel" | "armed-text" | "keyboard"`;`interface HoldModel { state: HoldState; startY: number; downAt: number; width: number; micReady: boolean }`;`IDLE: HoldModel`;`type HoldEvent = { type: "down"; x: number; y: number; t: number; width: number } | { type: "mic-ready" } | { type: "mic-failed" } | { type: "move"; x: number; y: number } | { type: "up"; t: number } | { type: "cancel" } | { type: "max" } | { type: "key" } | { type: "escape" } | { type: "reset" }`;`type DiscardReason = "short" | "not-ready" | "slide" | "cancel"`;`type HoldEffect = { type: "start" } | { type: "finish"; deliver: "send" | "fill" } | { type: "discard"; reason: DiscardReason }`;`holdReducer(model: HoldModel, event: HoldEvent): { model: HoldModel; effects: HoldEffect[] }`(纯函数,不读时钟)。`reset` 用于录音被外部结束(切后台保留草稿、轨道中断)时把手势归位,不产生副作用。

- [ ] **Step 1: 写失败的测试** —— `web/src/features/chat/hold-to-talk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IDLE, SHORT_PRESS_MS, holdReducer, type HoldEffect, type HoldEvent, type HoldModel, type HoldState } from "./hold-to-talk";

const W = 400;
const model = (state: HoldState, micReady = state !== "pressing"): HoldModel =>
  state === "idle" ? IDLE : { state, startY: 500, downAt: 0, width: W, micReady };
const EVENTS: Record<string, HoldEvent> = {
  down: { type: "down", x: 100, y: 500, t: 0, width: W },
  "mic-ready": { type: "mic-ready" },
  "mic-failed": { type: "mic-failed" },
  move: { type: "move", x: 100, y: 500 }, // 原地不动
  up: { type: "up", t: 1000 },
  cancel: { type: "cancel" },
  max: { type: "max" },
  key: { type: "key" },
  escape: { type: "escape" },
  reset: { type: "reset" },
};
const start: HoldEffect = { type: "start" };
const send: HoldEffect = { type: "finish", deliver: "send" };
const fill: HoldEffect = { type: "finish", deliver: "fill" };
const discard = (reason: "short" | "not-ready" | "slide" | "cancel"): HoldEffect => ({ type: "discard", reason });

type Row = [HoldState, HoldEffect[]];
const same = (s: HoldState): Row => [s, []];
const toIdle = (...effects: HoldEffect[]): Row => ["idle", effects];
/** 6 个状态 × 10 个事件,逐格写明期望(R11) */
const TABLE: Record<HoldState, Record<string, Row>> = {
  idle: {
    down: ["pressing", [start]], "mic-ready": same("idle"), "mic-failed": same("idle"), move: same("idle"), up: same("idle"),
    cancel: same("idle"), max: same("idle"), key: ["keyboard", [start]], escape: same("idle"), reset: same("idle"),
  },
  pressing: {
    down: same("pressing"), "mic-ready": same("recording"), "mic-failed": toIdle(), move: same("pressing"), up: toIdle(discard("not-ready")),
    cancel: toIdle(discard("cancel")), max: same("pressing"), key: same("pressing"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  recording: {
    down: same("recording"), "mic-ready": same("recording"), "mic-failed": toIdle(), move: same("recording"), up: toIdle(send),
    cancel: toIdle(discard("cancel")), max: toIdle(send), key: same("recording"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  "armed-cancel": {
    down: same("armed-cancel"), "mic-ready": same("armed-cancel"), "mic-failed": toIdle(), move: same("recording"), up: toIdle(discard("slide")),
    cancel: toIdle(discard("cancel")), max: toIdle(discard("slide")), key: same("armed-cancel"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  "armed-text": {
    down: same("armed-text"), "mic-ready": same("armed-text"), "mic-failed": toIdle(), move: same("recording"), up: toIdle(fill),
    cancel: toIdle(discard("cancel")), max: toIdle(fill), key: same("armed-text"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  keyboard: {
    down: same("keyboard"), "mic-ready": same("keyboard"), "mic-failed": toIdle(), move: same("keyboard"), up: same("keyboard"),
    cancel: toIdle(discard("cancel")), max: toIdle(send), key: toIdle(send), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
};

describe("holdReducer: every state × every event", () => {
  const cases = Object.entries(TABLE).flatMap(([state, row]) =>
    Object.entries(row).map(([event, expected]) => [state as HoldState, event, expected] as const));
  it("the table covers all 60 transitions", () => expect(cases).toHaveLength(60));
  it.each(cases)("%s + %s", (state, event, [next, effects]) => {
    const out = holdReducer(model(state), EVENTS[event]);
    expect(out.model.state).toBe(next);
    expect(out.effects).toEqual(effects);
  });
});

describe("holdReducer: timing and geometry", () => {
  const recording = holdReducer(holdReducer(IDLE, EVENTS.down).model, EVENTS["mic-ready"]).model;

  it("a release shorter than 300 ms is a mis-tap, both before and after the microphone is ready", () => {
    expect(holdReducer(recording, { type: "up", t: SHORT_PRESS_MS - 1 }).effects).toEqual([discard("short")]);
    expect(holdReducer(recording, { type: "up", t: SHORT_PRESS_MS }).effects).toEqual([send]);
    const pressing = holdReducer(IDLE, EVENTS.down).model;
    expect(holdReducer(pressing, { type: "up", t: 120 }).effects).toEqual([discard("short")]);
  });

  it("sliding up 80 px arms the zone under the finger: left half cancels, right half fills", () => {
    expect(holdReducer(recording, { type: "move", x: 100, y: 500 - 79 }).model.state).toBe("recording");
    expect(holdReducer(recording, { type: "move", x: 100, y: 500 - 80 }).model.state).toBe("armed-cancel");
    expect(holdReducer(recording, { type: "move", x: 300, y: 500 - 120 }).model.state).toBe("armed-text");
  });

  it("moving sideways while armed switches zones; coming back below 40 px disarms (hysteresis)", () => {
    const armed = holdReducer(recording, { type: "move", x: 100, y: 400 }).model;
    expect(holdReducer(armed, { type: "move", x: 250, y: 400 }).model.state).toBe("armed-text");
    expect(holdReducer(armed, { type: "move", x: 100, y: 500 - 41 }).model.state).toBe("armed-cancel");
    expect(holdReducer(armed, { type: "move", x: 100, y: 500 - 39 }).model.state).toBe("recording");
  });

  it("does not arm before the microphone is ready", () => {
    const pressing = holdReducer(IDLE, EVENTS.down).model;
    expect(holdReducer(pressing, { type: "move", x: 100, y: 300 }).model.state).toBe("pressing");
  });

  it("keyboard: a second key before the microphone is ready discards", () => {
    const kb = holdReducer(IDLE, EVENTS.key).model;
    expect(kb.micReady).toBe(false);
    expect(holdReducer(kb, EVENTS.key)).toEqual({ model: IDLE, effects: [discard("not-ready")] });
    const ready = holdReducer(kb, EVENTS["mic-ready"]).model;
    expect(ready.micReady).toBe(true);
    expect(holdReducer(ready, EVENTS.key).effects).toEqual([send]);
  });

  it("is pure: the input model is not mutated", () => {
    const before = { ...recording };
    holdReducer(recording, { type: "move", x: 300, y: 300 });
    expect(recording).toEqual(before);
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/hold-to-talk.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** —— `web/src/features/chat/hold-to-talk.ts`:

```ts
import { VOICE_MAX_MS } from "./use-voice-turn";

/** 按住说话的手势状态机(计划 R11)。纯函数:时间与坐标都由事件带入。 */
export const SHORT_PRESS_MS = 300;
export const SLIDE_ARM_PX = 80;
export const SLIDE_DISARM_PX = 40;
export const MAX_HOLD_MS = VOICE_MAX_MS - 250;

export type HoldState = "idle" | "pressing" | "recording" | "armed-cancel" | "armed-text" | "keyboard";
export interface HoldModel {
  state: HoldState;
  startY: number;
  downAt: number;
  width: number;
  micReady: boolean;
}
export type HoldEvent =
  | { type: "down"; x: number; y: number; t: number; width: number }
  | { type: "mic-ready" }
  | { type: "mic-failed" }
  | { type: "move"; x: number; y: number }
  | { type: "up"; t: number }
  | { type: "cancel" }
  | { type: "max" }
  | { type: "key" }
  | { type: "escape" }
  | { type: "reset" };
export type DiscardReason = "short" | "not-ready" | "slide" | "cancel";
export type HoldEffect = { type: "start" } | { type: "finish"; deliver: "send" | "fill" } | { type: "discard"; reason: DiscardReason };

export const IDLE: HoldModel = { state: "idle", startY: 0, downAt: 0, width: 0, micReady: false };
const out = (model: HoldModel, ...effects: HoldEffect[]) => ({ model, effects });
const idle = (...effects: HoldEffect[]) => out(IDLE, ...effects);

function zone(model: HoldModel, x: number, y: number): HoldState {
  const dy = y - model.startY;
  const armed = model.state === "armed-cancel" || model.state === "armed-text";
  if (armed ? dy > -SLIDE_DISARM_PX : dy > -SLIDE_ARM_PX) return "recording";
  return x < model.width / 2 ? "armed-cancel" : "armed-text";
}

export function holdReducer(model: HoldModel, event: HoldEvent): { model: HoldModel; effects: HoldEffect[] } {
  const s = model.state;
  if (event.type === "reset") return s === "idle" ? out(model) : idle();
  if (s === "idle") {
    if (event.type === "down") return out({ state: "pressing", startY: event.y, downAt: event.t, width: event.width, micReady: false }, { type: "start" });
    if (event.type === "key") return out({ ...IDLE, state: "keyboard" }, { type: "start" });
    return out(model);
  }
  if (event.type === "mic-failed") return idle();
  if (event.type === "cancel" || event.type === "escape") return idle({ type: "discard", reason: "cancel" });
  if (s === "keyboard") {
    if (event.type === "mic-ready") return out({ ...model, micReady: true });
    if (event.type === "key") return model.micReady ? idle({ type: "finish", deliver: "send" }) : idle({ type: "discard", reason: "not-ready" });
    if (event.type === "max") return idle({ type: "finish", deliver: "send" });
    return out(model);
  }
  if (s === "pressing") {
    if (event.type === "mic-ready") return out({ ...model, state: "recording", micReady: true });
    if (event.type === "up") return idle({ type: "discard", reason: event.t - model.downAt < SHORT_PRESS_MS ? "short" : "not-ready" });
    return out(model);
  }
  // recording / armed-cancel / armed-text
  if (event.type === "move") {
    const next = zone(model, event.x, event.y);
    return next === s ? out(model) : out({ ...model, state: next });
  }
  if (event.type === "up" || event.type === "max") {
    if (s === "armed-cancel") return idle({ type: "discard", reason: "slide" });
    if (s === "armed-text") return idle({ type: "finish", deliver: "fill" });
    if (event.type === "up" && event.t - model.downAt < SHORT_PRESS_MS) return idle({ type: "discard", reason: "short" });
    return idle({ type: "finish", deliver: "send" });
  }
  return out(model);
}
```

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/features/chat/hold-to-talk.test.ts` → PASS(60 + 7 项)。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/hold-to-talk.ts web/src/features/chat/hold-to-talk.test.ts
git commit -m "feat(web): add the hold-to-talk gesture state machine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.2:`useHoldToTalk` 与按住说话按钮组件

**Files:**
- Create: `web/src/features/chat/use-hold-to-talk.ts`、`web/src/features/chat/hold-to-talk-button.tsx`、`web/src/features/chat/hold-to-talk-button.test.tsx`
- Create: `web/src/test/hold.ts`(测试辅助:`holdMic`、PointerEvent 补丁)
- Modify: `web/src/features/chat/i18n/en.json`、`zh-CN.json`(`web.chat.hold.*`)

**Interfaces:**
- Consumes:Task 3.1 的 `holdReducer`、`IDLE`、`MAX_HOLD_MS`、类型;既有 `VoiceTurnState`。
- Produces:`useHoldToTalk(opts: { start(): Promise<boolean>; finish(deliver: "send" | "fill"): void; discard(reason: DiscardReason): void; now?: () => number }): { model: HoldModel; dispatch(event: HoldEvent): void }`(`start` 结果按"代"过滤:旧按压的 `mic-ready` 不会作用到新按压;进入 `recording`/`armed-*`/已就绪的 `keyboard` 时启动 `MAX_HOLD_MS` 定时器,回到 `idle` 清除;页面变为 `hidden` → `cancel`;卸载时若不在 `idle` → 调 `discard("cancel")`);`HoldToTalkButton` props `{ voiceState: VoiceTurnState; disabled: boolean; onStart(): Promise<boolean>; onFinish(deliver: "send" | "fill"): void; onDiscard(reason: DiscardReason): void; onRelease(): void }`(`onRelease` 在 `pointerup`/第二次按键的**同步阶段**、派发事件之前调用,用于 `autoSpeak.prime()`);DOM:`button[data-testid=chat-mic][data-hold-to-talk][data-state=<voiceState>][data-hold=<HoldState>]`,`style.touchAction = "none"`,`select-none`,`onContextMenu` 阻止默认;录音中显示 `hold-overlay`(`role="status"`,文案"上滑取消 / 转文字")与两个落点 `hold-zone-cancel`、`hold-zone-text`(各占视口一半宽、高 ≥ 88 px,`data-active` 表示当前落点);无 `onClick`(避免指针事件之外的点击误触)。`web/src/test/hold.ts`:`holdMic(el: HTMLElement, opts?: { ms?: number; dy?: number; x?: number }): Promise<void>`、`pressKey(el: HTMLElement, key?: " " | "Enter" | "Escape"): void`。

- [ ] **Step 1: 测试辅助** —— `web/src/test/hold.ts`:

```ts
import { fireEvent, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

// jsdom 若没有 PointerEvent,用 MouseEvent 补一个(只用于测试)
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
}

/** 按住麦克风 ms 毫秒(默认 1000),可先上滑 dy(负数)到 x 处再松手。时钟用 performance.now 的模拟值,不真等。 */
export async function holdMic(el: HTMLElement, opts: { ms?: number; dy?: number; x?: number } = {}): Promise<void> {
  let t = 10_000;
  const now = vi.spyOn(performance, "now").mockImplementation(() => t);
  try {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
    await waitFor(() => expect(el).toHaveAttribute("data-hold", "recording"));
    t += opts.ms ?? 1000;
    const x = opts.x ?? 200;
    const y = 700 + (opts.dy ?? 0);
    if (opts.dy) fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });
  } finally {
    now.mockRestore();
  }
}

export function pressKey(el: HTMLElement, key: " " | "Enter" | "Escape" = " "): void {
  fireEvent.keyDown(el, { key });
  fireEvent.keyUp(el, { key });
}
```

- [ ] **Step 2: 写失败的测试** —— `web/src/features/chat/hold-to-talk-button.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "~/test/render";
import { holdMic, pressKey } from "~/test/hold";
import { HoldToTalkButton } from "./hold-to-talk-button";
import type { VoiceTurnState } from "./use-voice-turn";

function Harness(props: { start?: () => Promise<boolean> }) {
  const [state, setState] = useState<VoiceTurnState>("idle");
  const calls = (window as unknown as { calls: string[] }).calls;
  return (
    <HoldToTalkButton voiceState={state} disabled={false}
      onStart={async () => { calls.push("start"); const ok = await (props.start?.() ?? Promise.resolve(true)); if (ok) setState("recording"); return ok; }}
      onFinish={(d) => { calls.push(`finish:${d}`); setState("idle"); }}
      onDiscard={(r) => { calls.push(`discard:${r}`); setState("idle"); }}
      onRelease={() => calls.push("release")} />
  );
}
function setup(start?: () => Promise<boolean>) {
  const calls: string[] = [];
  (window as unknown as { calls: string[] }).calls = calls;
  renderWithProviders(<Harness start={start} />);
  return { calls, mic: screen.getByTestId("chat-mic") };
}

describe("HoldToTalkButton", () => {
  it("is a 44 px button that suppresses touch scrolling and the context menu", () => {
    const { mic } = setup();
    expect(mic).toHaveAttribute("data-hold-to-talk");
    expect(mic.className).toMatch(/h-11/);
    expect(mic.style.touchAction).toBe("none");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    mic.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mic).toHaveAccessibleName(/hold|按住/i);
  });

  it("hold and release sends, priming on release", async () => {
    const { calls, mic } = setup();
    await holdMic(mic, { ms: 1200 });
    expect(calls).toEqual(["start", "release", "finish:send"]);
  });

  it("slide up to the left cancels, to the right fills the composer", async () => {
    const a = setup();
    window.innerWidth = 400;
    await holdMic(a.mic, { dy: -120, x: 50 });
    expect(a.calls.at(-1)).toBe("discard:slide");
  });

  it("slide up to the right fills", async () => {
    const { calls, mic } = setup();
    window.innerWidth = 400;
    await holdMic(mic, { dy: -120, x: 350 });
    expect(calls.at(-1)).toBe("finish:fill");
  });

  it("shows the two drop zones while recording", async () => {
    const { mic } = setup();
    window.innerWidth = 400;
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    await waitFor(() => expect(screen.getByTestId("hold-overlay")).toBeInTheDocument());
    fireEvent.pointerMove(mic, { pointerId: 1, clientX: 50, clientY: 560 });
    expect(screen.getByTestId("hold-zone-cancel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("hold-zone-text")).toHaveAttribute("data-active", "false");
    fireEvent.pointerCancel(mic, { pointerId: 1 });
    await waitFor(() => expect(screen.queryByTestId("hold-overlay")).toBeNull());
  });

  it("a pointer cancel (system gesture, incoming call) discards", async () => {
    const { calls, mic } = setup();
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    await waitFor(() => expect(mic).toHaveAttribute("data-hold", "recording"));
    fireEvent.pointerCancel(mic, { pointerId: 1 });
    expect(calls.at(-1)).toBe("discard:cancel");
  });

  it("releasing during the permission prompt discards and a late mic-ready is ignored", async () => {
    let resolve!: (ok: boolean) => void;
    const { calls, mic } = setup(() => new Promise((r) => (resolve = r)));
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    fireEvent.pointerUp(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    expect(calls.at(-1)).toMatch(/^discard:(short|not-ready)$/);
    await act(async () => resolve(true));
    expect(mic).toHaveAttribute("data-hold", "idle");
  });

  it("keyboard: Space starts, Space again sends; Escape cancels", async () => {
    const { calls, mic } = setup();
    pressKey(mic, " ");
    await waitFor(() => expect(mic).toHaveAttribute("data-hold", "keyboard"));
    await waitFor(() => expect(mic).toHaveAttribute("data-state", "recording"));
    pressKey(mic, "Enter");
    expect(calls).toEqual(["start", "release", "finish:send"]);
    pressKey(mic, " ");
    await waitFor(() => expect(mic).toHaveAttribute("data-state", "recording"));
    pressKey(mic, "Escape");
    expect(calls.at(-1)).toBe("discard:cancel");
  });

  it("hiding the page cancels a hold", async () => {
    const { calls, mic } = setup();
    fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
    await waitFor(() => expect(mic).toHaveAttribute("data-hold", "recording"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(calls.at(-1)).toBe("discard:cancel");
  });

  it("the 60 s limit sends unless a zone is armed", async () => {
    vi.useFakeTimers();
    try {
      const { calls, mic } = setup();
      fireEvent.pointerDown(mic, { pointerId: 1, clientX: 200, clientY: 700 });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(mic).toHaveAttribute("data-hold", "recording");
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(calls.at(-1)).toBe("finish:send");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 3: 运行确认失败** —— `yarn workspace web test src/features/chat/hold-to-talk-button.test.tsx` → FAIL(模块不存在)。

- [ ] **Step 4: 实现 hook** —— `web/src/features/chat/use-hold-to-talk.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE, MAX_HOLD_MS, holdReducer, type DiscardReason, type HoldEvent, type HoldModel } from "./hold-to-talk";

export interface UseHoldToTalkOptions {
  start(): Promise<boolean>;
  finish(deliver: "send" | "fill"): void;
  discard(reason: DiscardReason): void;
}

const active = (m: HoldModel) => m.state === "recording" || m.state === "armed-cancel" || m.state === "armed-text" || (m.state === "keyboard" && m.micReady);

export function useHoldToTalk(options: UseHoldToTalkOptions) {
  const opts = useRef(options);
  opts.current = options;
  const modelRef = useRef<HoldModel>(IDLE);
  const [model, setModel] = useState<HoldModel>(IDLE);
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  const dispatch = useCallback((event: HoldEvent) => {
    const before = modelRef.current;
    const { model: next, effects } = holdReducer(before, event);
    modelRef.current = next;
    if (mounted.current) setModel(next);
    if (next.state === "idle" && before.state !== "idle") generation.current += 1;
    if (active(next) && !active(before)) timer.current = window.setTimeout(() => dispatch({ type: "max" }), MAX_HOLD_MS);
    if (!active(next) && timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    for (const effect of effects) {
      if (effect.type === "start") {
        const gen = generation.current;
        opts.current.start().then(
          (ok) => { if (gen === generation.current) dispatch(ok ? { type: "mic-ready" } : { type: "mic-failed" }); },
          () => { if (gen === generation.current) dispatch({ type: "mic-failed" }); },
        );
      } else if (effect.type === "finish") {
        opts.current.finish(effect.deliver);
      } else {
        opts.current.discard(effect.reason);
      }
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && modelRef.current.state !== "idle") dispatch({ type: "cancel" });
    };
    document.addEventListener("visibilitychange", onVisibility);
    mounted.current = true;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      mounted.current = false;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (modelRef.current.state !== "idle") {
        modelRef.current = IDLE;
        generation.current += 1;
        opts.current.discard("cancel");
      }
    };
  }, [dispatch]);

  return { model, dispatch };
}
```

  注意时钟:按下与松手的时间戳由组件用 `performance.now()` 读取后放进事件(reducer 不读时钟),`holdMic` 辅助据此模拟。

- [ ] **Step 5: 实现组件** —— `web/src/features/chat/hold-to-talk-button.tsx`:

```tsx
import { LoaderIcon, MicIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import type { DiscardReason } from "./hold-to-talk";
import { useHoldToTalk } from "./use-hold-to-talk";
import type { VoiceTurnState } from "./use-voice-turn";

export interface HoldToTalkButtonProps {
  voiceState: VoiceTurnState;
  disabled: boolean;
  onStart(): Promise<boolean>;
  onFinish(deliver: "send" | "fill"): void;
  onDiscard(reason: DiscardReason): void;
  /** 松手/第二次按键的同步阶段调用(iOS:autoSpeak.prime()) */
  onRelease(): void;
}

export function HoldToTalkButton({ voiceState, disabled, onStart, onFinish, onDiscard, onRelease }: HoldToTalkButtonProps) {
  const { t } = useTranslation();
  const { model, dispatch } = useHoldToTalk({ start: onStart, finish: onFinish, discard: onDiscard });
  const holding = model.state === "recording" || model.state === "armed-cancel" || model.state === "armed-text";

  // 录音被外部结束(切后台保留草稿、轨道中断、60 s 自动停止):手势归位
  useEffect(() => {
    if (voiceState !== "recording" && voiceState !== "starting" && model.micReady && model.state !== "idle") dispatch({ type: "reset" });
  }, [voiceState, model.micReady, model.state, dispatch]);

  const now = () => performance.now();
  return (
    <>
      <Button type="button" data-testid="chat-mic" data-hold-to-talk="" data-state={voiceState} data-hold={model.state}
        size="icon" variant={holding || model.state === "keyboard" ? "destructive" : "ghost"}
        className="h-11 w-11 shrink-0 select-none" style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        disabled={disabled && model.state === "idle"}
        aria-label={model.state === "keyboard" ? t("web.chat.hold.keyboardStop") : voiceState === "processing" ? t("web.chat.transcribing") : t("web.chat.hold.label")}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (disabled || e.button > 0) return;
          e.preventDefault();
          try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 部分环境不支持 */ }
          dispatch({ type: "down", x: e.clientX ?? 0, y: e.clientY ?? 0, t: now(), width: window.innerWidth });
        }}
        onPointerMove={(e) => dispatch({ type: "move", x: e.clientX ?? 0, y: e.clientY ?? 0 })}
        onPointerUp={() => {
          if (model.state === "idle") return;
          onRelease();
          dispatch({ type: "up", t: now() });
        }}
        onPointerCancel={() => dispatch({ type: "cancel" })}
        onLostPointerCapture={() => { if (model.state !== "idle" && model.state !== "keyboard") dispatch({ type: "cancel" }); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { dispatch({ type: "escape" }); return; }
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            if (disabled && model.state === "idle") return;
            if (model.state === "keyboard") onRelease();
            dispatch({ type: "key" });
          }
        }}>
        {voiceState === "processing" ? <LoaderIcon className="h-5 w-5 animate-spin" /> : <MicIcon className="h-5 w-5" />}
      </Button>
      {holding && (
        <div data-testid="hold-overlay" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-2 px-4">
          <span className="rounded-full bg-black/70 px-3 py-1 text-sm text-white">{t("web.chat.hold.slideHint")}</span>
          <div className="flex w-full gap-2">
            <div data-testid="hold-zone-cancel" data-active={String(model.state === "armed-cancel")}
              className={cn("flex min-h-[88px] flex-1 items-center justify-center rounded-lg border-2 text-base",
                model.state === "armed-cancel" ? "border-red-600 bg-red-600 text-white" : "border-muted bg-background/90")}>
              {t("web.chat.hold.cancel")}
            </div>
            <div data-testid="hold-zone-text" data-active={String(model.state === "armed-text")}
              className={cn("flex min-h-[88px] flex-1 items-center justify-center rounded-lg border-2 text-base",
                model.state === "armed-text" ? "border-primary bg-primary text-primary-foreground" : "border-muted bg-background/90")}>
              {t("web.chat.hold.toText")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

  (`Button` 的导入路径以 `conversation-page.tsx` 现有导入为准。)i18n(`web.chat.hold.*`,en / zh-CN 键集一致):

  | 键 | en | zh-CN |
  |---|---|---|
  | `label` | Hold to talk (or press Space to start and again to send) | 按住说话(也可按空格开始、再按一次发送) |
  | `keyboardStop` | Recording – press Space to send, Escape to cancel | 录音中——按空格发送,按 Esc 取消 |
  | `slideHint` | Slide up to cancel or convert to text | 上滑取消 / 转文字 |
  | `cancel` | Cancel | 取消 |
  | `toText` | To text | 转文字 |
  | `tooShort` | Hold to talk | 按住说话 |
  | `notReady` | Microphone is ready – hold to talk | 麦克风已准备好,请按住说话 |

- [ ] **Step 6: 运行确认通过** —— `yarn workspace web test src/features/chat/hold-to-talk-button.test.tsx src/i18n` → PASS。若 "the 60 s limit" 用例因假定时器与 `waitFor` 冲突而不稳定,改为在该用例里只用 `act` + `advanceTimersByTime`(已如此),**不得**删用例。

- [ ] **Step 7: 提交**

```bash
git add web/src/features/chat/use-hold-to-talk.ts web/src/features/chat/hold-to-talk-button.tsx web/src/features/chat/hold-to-talk-button.test.tsx web/src/test/hold.ts web/src/features/chat/i18n/en.json web/src/features/chat/i18n/zh-CN.json
git commit -m "feat(web): add a hold-to-talk button with slide-up cancel and to-text zones" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.3:语音轮次支持"转文字不发送"

**Files:**
- Modify: `web/src/features/chat/use-voice-turn.ts`
- Modify: `web/src/features/chat/use-voice-turn.test.tsx`(**只追加**)

**Interfaces:**
- Consumes:Task 2.4 的 `starter` 选项。
- Produces:`stop(deliver: "send" | "fill" = "send"): Promise<void>`;`UseVoiceTurnOptions.onTranscribedText?: (text: string) => void`;`deliver === "fill"` 的草稿转写成功后:删除草稿、`onDraft({kind: "discarded", key})`、调用 `onTranscribedText(text)`,**不**调用 `onTranscribed`(不发送、不评测);转写失败照常 `failed`,重试仍按 `fill` 交付;60 s 自动停止与切后台的草稿一律按 `send`(R11 的 60 s 落点规则由手势层在 `MAX_HOLD_MS` 处先处理)。

- [ ] **Step 1: 写失败的测试** —— 追加到 `use-voice-turn.test.tsx`:

```tsx
describe("stop('fill') (plan 2026-10-07 R11)", () => {
  it("fills the composer instead of sending", async () => {
    const result = { blob: new Blob([encodeWavPcm16(new Float32Array(16000).fill(0.2), 16000)], { type: "audio/wav" }), mimeType: "audio/wav", durationMs: 1000, stoppedBy: "user" as const, noSpeech: false };
    const session = { startedAt: 0, result: Promise.resolve(result), stop: vi.fn(async () => result), cancel: vi.fn() };
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: " I need a taxi. " }) });
    const onDraft = vi.fn();
    const onTranscribed = vi.fn();
    const onTranscribedText = vi.fn();
    const { result: hook } = renderHook(() => useVoiceTurn({
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), newKey: () => "k1", onDraft, onTranscribed, onTranscribedText,
      starter: async () => session, urls: { create: () => "blob:1", revoke: () => undefined },
    }));
    await act(async () => { await hook.current.start(); });
    await act(async () => { await hook.current.stop("fill"); });
    await vi.waitFor(() => expect(onTranscribedText).toHaveBeenCalledWith("I need a taxi."));
    expect(onTranscribed).not.toHaveBeenCalled();
    expect(onDraft).toHaveBeenLastCalledWith({ kind: "discarded", key: "k1" });
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/use-voice-turn.test.tsx -t "fill"` → FAIL。

- [ ] **Step 3: 实现** —— `use-voice-turn.ts`:`Draft` 加 `deliver: "send" | "fill"`;`accept(recording, deliver = "send")` 写入草稿时带上 `deliver`;`stop(deliver: "send" | "fill" = "send")` 调用 `accept(result, deliver)`(`useRecorder` 的 `onAutoStop: accept` 不变,默认 `send`);`transcribeDraft` 里在 `const audioUrl = …` 之前插入:

```ts
        if (draft.deliver === "fill") {
          drafts.current.delete(key);
          opts.current.onDraft({ kind: "discarded", key });
          opts.current.onTranscribedText?.(clean);
          return;
        }
```

  `UseVoiceTurnOptions` 加 `onTranscribedText?: (text: string) => void;`。

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/features/chat` → PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/use-voice-turn.ts web/src/features/chat/use-voice-turn.test.tsx
git commit -m "feat(web): let a voice turn fill the composer instead of sending" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.4:对话页换成按住说话

**Files:**
- Modify: `web/src/features/chat/conversation-page.tsx`(输入栏麦克风按钮 → `HoldToTalkButton`;提示条 `hold-hint`;`onTranscribedText` 填入输入框)
- Modify: `web/src/features/chat/conversation-page.test.tsx`(R17:点两下的录音用例改为 `holdMic`/`pressKey`,并追加 `describe("hold to talk")`)

**Interfaces:**
- Consumes:Task 3.2 的 `HoldToTalkButton`、`holdMic`、`pressKey`;Task 3.3 的 `stop(deliver)`、`onTranscribedText`。
- Produces:输入栏行为见 R11;`data-testid` 不变(`chat-mic`、`chat-mic-cancel`、`voice-recording`、`voice-timer`、`chat-input`);新增 `hold-hint`(`role="status"`,2 s 后消失)。

- [ ] **Step 1: 写失败的测试** —— 追加到 `conversation-page.test.tsx`(`setup()`、`routes()`、假 `recorderEnv` 都是该文件已有的;`holdMic`/`pressKey` 从 `~/test/hold` 导入):

```tsx
describe("hold to talk (plan 2026-10-07 R11)", () => {
  it("hold and release sends a voice message", async () => {
    const { calls } = await setup();
    await holdMic(screen.getByTestId("chat-mic"), { ms: 1500 });
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/ai/audio/transcriptions")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/ai/chat/completions")).toBe(true));
  });

  it("slide up and release on 'to text' fills the composer without sending", async () => {
    window.innerWidth = 400;
    const { calls } = await setup();
    await holdMic(screen.getByTestId("chat-mic"), { dy: -150, x: 350 });
    await waitFor(() => expect((screen.getByTestId("chat-input") as HTMLTextAreaElement).value).not.toBe(""));
    expect(calls.some((c) => c.url.pathname === "/api/ai/chat/completions")).toBe(false);
  });

  it("slide up and release on 'cancel' discards without uploading", async () => {
    window.innerWidth = 400;
    const { calls } = await setup();
    await holdMic(screen.getByTestId("chat-mic"), { dy: -150, x: 40 });
    await waitFor(() => expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle"));
    expect(calls.some((c) => c.url.pathname === "/api/ai/audio/transcriptions")).toBe(false);
  });

  it("a short tap shows the hint and records nothing", async () => {
    const { calls } = await setup();
    await holdMic(screen.getByTestId("chat-mic"), { ms: 100 });
    expect(await screen.findByTestId("hold-hint")).toHaveTextContent(/hold to talk|按住说话/i);
    expect(calls.some((c) => c.url.pathname === "/api/ai/audio/transcriptions")).toBe(false);
  });

  it("keyboard fallback: Space starts and sends", async () => {
    const { calls } = await setup();
    const mic = screen.getByTestId("chat-mic");
    pressKey(mic, " ");
    await waitFor(() => expect(mic).toHaveAttribute("data-state", "recording"));
    pressKey(mic, " ");
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/ai/audio/transcriptions")).toBe(true));
  });
});
```

  (转写路由返回的文本以该文件 `routes()` 的既有默认值为准。)

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/conversation-page.test.tsx -t "hold to talk"` → FAIL。

- [ ] **Step 3: 实现** —— `conversation-page.tsx`:导入 `HoldToTalkButton`;`useVoiceTurn({... onTranscribedText: (text) => { setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text)); } })`;新增 `const [holdHint, setHoldHint] = useState<string | null>(null);` 与 2 s 自动清除的 effect(`useEffect(() => { if (!holdHint) return; const id = window.setTimeout(() => setHoldHint(null), 2000); return () => window.clearTimeout(id); }, [holdHint]);`);把原来的 `<Button type="button" data-testid="chat-mic" …>…</Button>` 整段替换为:

```tsx
        <HoldToTalkButton voiceState={voice.state}
          disabled={voice.state === "processing" || (voice.state === "idle" && (sending || !conversation))}
          onStart={() => {
            stopTts(); // 开始录音:正在进行的朗读(含自动朗读)停下
            claimAudio(micFocus);
            return voice.start();
          }}
          onRelease={() => autoSpeak.prime()} // R5:松手这一下解锁,转写 + 回复完成后接着播
          onFinish={(deliver) => { void voice.stop(deliver); }}
          onDiscard={(reason) => {
            voice.cancel();
            if (reason === "short") setHoldHint(t("web.chat.hold.tooShort"));
            if (reason === "not-ready") setHoldHint(t("web.chat.hold.notReady"));
          }} />
```

  并在 `autospeak-blocked` 条之前加 `{holdHint && <div data-testid="hold-hint" role="status" className="border-t bg-muted px-3 py-1 text-sm">{holdHint}</div>}`。

- [ ] **Step 4: 按 R17 改既有用例** —— 全量运行 `yarn workspace web test src/features/chat/conversation-page.test.tsx`。凡是"点 `chat-mic` 开始、再点 `chat-mic` 停止"的既有用例:把"开始 + 停止"两次点击替换为 `await holdMic(mic, { ms: 1000 })`(断言"录音中"状态的用例改为:`fireEvent.pointerDown` 后断言,再 `fireEvent.pointerUp`;或用 `pressKey` 两次)。**每个被改的用例名写进门槛记录**;用例的其他断言一律不改。改完后全量 → 0 failed;再 `yarn workspace web test` 全量 → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/conversation-page.tsx web/src/features/chat/conversation-page.test.tsx
git commit -m "feat(web): switch the composer microphone to hold-to-talk" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.5:Playwright 触摸手势用例(路由模拟,不需要上游)

**Files:**
- Create: `web/e2e/support/touch.ts`、`web/e2e/hold-to-talk.spec.ts`
- Modify: `web/e2e/chat.spec.ts`(R17:"voice message" 用例里的两次 `click` 改为 `recordFor`)

**Interfaces:**
- Consumes:Task 0.2 的 `recordFor`(`web/e2e/support/mic.ts`);E2E 栈(`docker-compose.e2e.yml`)。
- Produces:`touchHold(page, locator, opts: { ms: number; dy?: number; x?: number }): Promise<void>`(Chromium CDP `Input.dispatchTouchEvent`,真实触摸 → 指针事件);4 个用例:按住发送、上滑取消、上滑转文字、短按提示。

- [ ] **Step 1: 触摸辅助** —— `web/e2e/support/touch.ts`:

```ts
import type { Locator, Page } from "@playwright/test";

/** 用 CDP 发真实触摸事件(Chromium 才有);按住 ms 毫秒,可先上滑 dy 到 x 再抬起。 */
export async function touchHold(page: Page, target: Locator, opts: { ms: number; dy?: number; x?: number }): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("target is not visible");
  const cdp = await page.context().newCDPSession(page);
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  await page.waitForTimeout(opts.ms); // 模拟按住时长:必须真实等待
  if (opts.dy) {
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x0 + ((opts.x ?? x0) - x0) * (i / steps), y: y0 + opts.dy * (i / steps) }],
      });
    }
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
```

- [ ] **Step 2: 用例** —— `web/e2e/hold-to-talk.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { touchHold } from "./support/touch";

const TRANSCRIPT = "I would like a coffee please.";

async function mockUpstreams(page: Page) {
  const seen = { transcriptions: 0, chat: 0 };
  await page.route("**/api/ai/audio/transcriptions", async (route) => {
    seen.transcriptions++;
    await route.fulfill({ json: { text: TRANSCRIPT, segments: [] } });
  });
  await page.route("**/api/ai/chat/completions", async (route) => {
    seen.chat++;
    const body = ['data: {"choices":[{"delta":{"content":"Sure, "}}]}', 'data: {"choices":[{"delta":{"content":"what size?"}}]}', "data: [DONE]", ""].join("\n\n");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
  });
  await page.route("**/api/assessments", (route) => route.fulfill({ status: 503, json: { error: "Pronunciation assessment is not configured" } }));
  await page.route("**/api/ai/grammar", (route) => route.fulfill({ json: { errors: [], corrected: TRANSCRIPT } }));
  return seen;
}

test.describe("hold to talk (touch)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP touch events are Chromium-only");

  test.beforeEach(async ({ page, request }) => {
    await signIn(page, request);
    await page.goto("/chat");
    await page.getByTestId("conversation-new").click();
    await page.getByTestId("scenario-free").click();
    await page.getByTestId("conversation-autospeak").click(); // 本用例不验证朗读
    await expect(page.getByTestId("chat-mic")).toBeEnabled();
  });

  test("hold and release sends", async ({ page }) => {
    const seen = await mockUpstreams(page);
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 1500 });
    await expect(page.getByText(TRANSCRIPT)).toBeVisible();
    await expect(page.getByText("Sure, what size?")).toBeVisible();
    expect(seen.transcriptions).toBe(1);
  });

  test("slide up to cancel uploads nothing", async ({ page }) => {
    const seen = await mockUpstreams(page);
    const width = page.viewportSize()!.width;
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 1200, dy: -160, x: width * 0.2 });
    await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
    expect(seen.transcriptions).toBe(0);
  });

  test("slide up to 'to text' fills the composer", async ({ page }) => {
    const seen = await mockUpstreams(page);
    const width = page.viewportSize()!.width;
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 1200, dy: -160, x: width * 0.8 });
    await expect(page.getByTestId("chat-input")).toHaveValue(TRANSCRIPT);
    expect(seen.chat).toBe(0);
  });

  test("a short tap shows the hint", async ({ page }) => {
    const seen = await mockUpstreams(page);
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 100 });
    await expect(page.getByTestId("hold-hint")).toBeVisible();
    expect(seen.transcriptions).toBe(0);
  });
});
```

  (语法接口的路径与返回形状以 `grammar-api.ts` 实际为准——它是 `POST /api/ai/grammar`;若返回形状不同,按 `checkGrammar` 的解析改这一行 mock。)

- [ ] **Step 3: 既有语音用例** —— `web/e2e/chat.spec.ts` 的 "voice message: …" 用例里,`await page.getByTestId("chat-mic").click();`(开始)… `await page.getByTestId("chat-mic").click();`(停止)两处合并为 `await recordFor(page, <原来两次点击之间等待的毫秒数>)`(从 `./support/mic` 导入);门槛记录写明。

- [ ] **Step 4: 运行** —— 按 `web/README.md` 起 E2E 栈,然后 `cd web && yarn playwright test e2e/hold-to-talk.spec.ts --project=chromium-mobile` → 4 passed;`--project=webkit-mobile` → 4 skipped。结果写进门槛记录。

- [ ] **Step 5: 提交**

```bash
git add web/e2e/support/touch.ts web/e2e/hold-to-talk.spec.ts web/e2e/chat.spec.ts
git commit -m "test(web): cover hold-to-talk gestures with real touch events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 验收门槛 3

- [ ] `yarn workspace web typecheck` 0 错误;`yarn workspace web build` 成功;`for i in 1 2 3; do yarn workspace web test 2>&1 | tail -3; done` 三次 0 failed(通过数写进门槛记录)。
- [ ] 手势状态机覆盖设计文档 §7.3 列出的全部情形:短按、正常发送、上滑取消、上滑转文字、回到原位发送(`hold-to-talk.test.ts` 的滞回用例)、指针取消、权限弹窗期间松手、60 s 上限、键盘后备——在门槛记录里逐条写出对应用例名。
- [ ] `hold-to-talk.spec.ts` chromium 4 passed。
- [ ] R17 改动清单已写进门槛记录;`git diff voice-latency-baseline -- web/src/features/chat/use-auto-speak.test.tsx web/src/features/chat/use-tts-player.test.tsx` 无输出。
- [ ] i18n 键集一致;新按钮与落点的触控区 ≥ 44 px(按钮 `h-11 w-11`,落点 `min-h-[88px]`)。

---
## 阶段 4:实时通话(服务端 + 网页)

> 依赖:门槛 1(切句、TTS 生成器、识别抽象)与门槛 2(采集、VAD、播放约定)。服务端 4.1–4.6 与网页 4.7–4.10 可两路并行(契约在 Task 4.2 的 Interfaces);4.11 等两路都合并。本阶段全部测试用假上游;真实上游的端到端在 Task 5.2。

### Task 4.1:一次性票据、并发登记与配置/票据接口

**Files:**
- Create: `server/app/realtime_tickets.py`、`server/app/routers/realtime.py`(本任务只含两个 HTTP 接口)、`server/tests/test_realtime_tickets.py`
- Modify: `server/app/main.py`(`app.state.realtime_tickets`、`app.state.realtime_registry`;注册 `realtime` 于 `ai_audio` 与 `stubs` 之间)

**Interfaces:**
- Consumes:Task 1.1 的 `realtime_available`、`realtime_ticket_ttl_seconds`、`realtime_max_sessions`、`realtime_max_minutes`、`realtime_idle_timeout_seconds`、`realtime_tts_sample_rate`、`asr_stream_enabled`;既有 `owned_conversation`(`app.routers.conversations`)、`limited_user`、`current_user`、`get_session`。
- Produces:`@dataclass(frozen=True) TicketGrant(user_id: int, conversation_id: str)`;`class TicketStore(ttl_seconds: float, clock=time.monotonic, max_tickets: int = 1000)`,`issue(user_id: int, conversation_id: str) -> str`(`secrets.token_urlsafe(32)`;超过 `max_tickets` 时先清过期、再丢最旧)、`redeem(ticket: str) -> TicketGrant | None`(一次性;过期/未知 → `None`);`class RealtimeRegistry(max_sessions: int)`,`acquire(user_id: int) -> bool`(该用户已有通话或总数已满 → `False`)、`release(user_id: int) -> None`、`active_count: int`;HTTP:`GET /api/realtime/config`(登录)→ `{"enabled": bool, "max_minutes": int, "idle_timeout_seconds": int, "asr_mode": "stream" | "buffered", "sample_rate_in": 16000, "sample_rate_out": int}`;`POST /api/realtime/ticket`(`limited_user`)`{"conversation_id": str}` → `{"ticket": str, "expires_in": int}`;未开启 → `503 {"error": "Realtime is not enabled"}`;会话不存在或不属于该用户 → `404`(沿用 `owned_conversation` 的文案)。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_realtime_tickets.py`:

```python
import pytest

from app.realtime_tickets import RealtimeRegistry, TicketGrant, TicketStore

ENABLED = {
    "realtime_enabled": True,
    "volcengine_tts_key": "volc-secret",
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0",
}


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def test_tickets_are_one_time_and_expire():
    clock = Clock()
    store = TicketStore(60, clock=clock)
    t = store.issue(7, "c1")
    assert len(t) >= 40
    assert store.redeem(t) == TicketGrant(7, "c1")
    assert store.redeem(t) is None
    t2 = store.issue(7, "c1")
    clock.now += 60.01
    assert store.redeem(t2) is None
    assert store.redeem("nope") is None


def test_ticket_store_is_bounded():
    clock = Clock()
    store = TicketStore(60, clock=clock, max_tickets=3)
    first = store.issue(1, "a")
    for i in range(3):
        store.issue(1, str(i))
    assert store.redeem(first) is None  # 最旧的被挤掉


def test_registry_one_call_per_user_and_a_global_cap():
    reg = RealtimeRegistry(max_sessions=2)
    assert reg.acquire(1) is True
    assert reg.acquire(1) is False
    assert reg.acquire(2) is True
    assert reg.acquire(3) is False
    reg.release(1)
    assert reg.acquire(3) is True and reg.active_count == 2
    reg.release(99)  # 未登记的释放是空操作


async def test_config_requires_login_and_reports_disabled(client, auth_headers):
    assert (await client.get("/api/realtime/config")).status_code == 401
    r = await client.get("/api/realtime/config", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {"enabled": False, "max_minutes": 10, "idle_timeout_seconds": 60, "asr_mode": "buffered",
                        "sample_rate_in": 16000, "sample_rate_out": 24000}


async def test_ticket_disabled_is_503(client, auth_headers):
    r = await client.post("/api/realtime/ticket", json={"conversation_id": "x"}, headers=auth_headers)
    assert r.status_code == 503
    assert r.json() == {"error": "Realtime is not enabled"}


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_ticket_for_own_conversation_only(client, auth_headers):
    conv = (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=auth_headers)).json()
    r = await client.post("/api/realtime/ticket", json={"conversation_id": conv["id"]}, headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"ticket", "expires_in"} and body["expires_in"] == 60
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    r = await client.post("/api/realtime/ticket", json={"conversation_id": conv["id"]}, headers=bob)
    assert r.status_code == 404


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_config_enabled(client, auth_headers):
    assert (await client.get("/api/realtime/config", headers=auth_headers)).json()["enabled"] is True
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_realtime_tickets.py -q` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** —— `server/app/realtime_tickets.py`:

```python
"""实时通话的一次性票据与并发登记(计划 R15)。进程内状态,仅适用于单 worker。"""
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class TicketGrant:
    user_id: int
    conversation_id: str


class TicketStore:
    def __init__(self, ttl_seconds: float, clock: Callable[[], float] = time.monotonic, max_tickets: int = 1000):
        self._ttl = ttl_seconds
        self._clock = clock
        self._max = max_tickets
        self._items: OrderedDict[str, tuple[float, TicketGrant]] = OrderedDict()

    def _sweep(self, now: float) -> None:
        for key in [k for k, (expires, _) in self._items.items() if expires <= now]:
            del self._items[key]

    def issue(self, user_id: int, conversation_id: str) -> str:
        now = self._clock()
        if len(self._items) >= self._max:
            self._sweep(now)
        while len(self._items) >= self._max:
            self._items.popitem(last=False)
        ticket = secrets.token_urlsafe(32)
        self._items[ticket] = (now + self._ttl, TicketGrant(user_id, conversation_id))
        return ticket

    def redeem(self, ticket: str) -> TicketGrant | None:
        item = self._items.pop(ticket, None)
        if item is None or item[0] <= self._clock():
            return None
        return item[1]


class RealtimeRegistry:
    def __init__(self, max_sessions: int):
        self._max = max_sessions
        self._users: set[int] = set()

    @property
    def active_count(self) -> int:
        return len(self._users)

    def acquire(self, user_id: int) -> bool:
        if user_id in self._users or len(self._users) >= self._max:
            return False
        self._users.add(user_id)
        return True

    def release(self, user_id: int) -> None:
        self._users.discard(user_id)
```

  `server/app/routers/realtime.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import current_user, get_session, get_settings, limited_user
from app.models import User
from app.routers.conversations import owned_conversation

router = APIRouter(prefix="/api")


class TicketIn(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=64)


def asr_mode(settings: Settings) -> str:
    return "stream" if settings.asr_stream_enabled else "buffered"


@router.get("/realtime/config")
async def realtime_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return {
        "enabled": settings.realtime_available,
        "max_minutes": settings.realtime_max_minutes,
        "idle_timeout_seconds": settings.realtime_idle_timeout_seconds,
        "asr_mode": asr_mode(settings),
        "sample_rate_in": 16000,
        "sample_rate_out": settings.realtime_tts_sample_rate,
    }


@router.post("/realtime/ticket")
async def realtime_ticket(
    payload: TicketIn,
    request: Request,
    user: User = Depends(limited_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if not settings.realtime_available:
        raise HTTPException(503, "Realtime is not enabled")
    conversation = await owned_conversation(session, user, payload.conversation_id)
    ticket = request.app.state.realtime_tickets.issue(user.id, conversation.id)
    return {"ticket": ticket, "expires_in": settings.realtime_ticket_ttl_seconds}
```

  `main.py`:import 增加 `realtime`;`from app.realtime_tickets import RealtimeRegistry, TicketStore`;`app.state.user_limiter = …` 之后加 `app.state.realtime_tickets = TicketStore(settings.realtime_ticket_ttl_seconds)`、`app.state.realtime_registry = RealtimeRegistry(settings.realtime_max_sessions)`;注册元组改为 `…, grammar, ai_audio, realtime, stubs, web,`。

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_realtime_tickets.py tests/test_stubs.py tests/test_web_static.py -q` → PASS;全量 → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/realtime_tickets.py server/app/routers/realtime.py server/app/main.py server/tests/test_realtime_tickets.py
git commit -m "feat(server): add one-time realtime tickets, a call registry and the config endpoint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.2:实时协议(消息、关闭码、音频帧)

**Files:**
- Create: `server/app/realtime_protocol.py`、`server/tests/test_realtime_protocol.py`

**Interfaces:**
- Consumes:无。
- Produces(**这是服务端与网页端的契约**,网页 Task 4.8 逐字对应):关闭码常量 `CLOSE_NORMAL = 1000`、`CLOSE_UNAUTHORIZED = 4001`、`CLOSE_DISABLED = 4003`、`CLOSE_NOT_FOUND = 4004`、`CLOSE_IDLE = 4008`、`CLOSE_MAX_DURATION = 4009`、`CLOSE_MESSAGE_LIMIT = 4013`、`CLOSE_BUSY = 4029`、`CLOSE_PROTOCOL = 4400`、`CLOSE_UPSTREAM = 4502`;`CLOSE_REASONS: dict[int, str]`(`unauthorized, disabled, not_found, idle_timeout, max_duration, message_limit, busy, protocol, upstream`,1000 → `normal`);`MAX_UPLINK_FRAME = 32000`、`MAX_SYSTEM_PROMPT = 8000`、`MAX_CLIENT_TEXT = 16384`;`class ProtocolError(Exception)`;上行模型(`extra="forbid"`)`StartMsg(type="start", system_prompt: str ≤ 8000 = "", model: str ≤ 200 = "", temperature: float ∈ [0, 2] = 0.7, voice: str 匹配 ^[A-Za-z0-9_-]{3,100}$, language: str 匹配 ^[a-z]{2}(-[A-Za-z]{2})?$ = "en", save_recordings: bool = False)`、`UtteranceEndMsg(type="utterance_end")`、`InterruptMsg(type="interrupt")`、`HangupMsg(type="hangup")`;`parse_client_message(text: str) -> StartMsg | UtteranceEndMsg | InterruptMsg | HangupMsg`(非法 → `ProtocolError`);`check_uplink(data: bytes) -> None`(空、超过 32000 字节、奇数长度 → `ProtocolError`);`audio_frame(turn_id: int, pcm: bytes) -> bytes`(4 字节大端 `turn_id` + PCM16LE)。下行 JSON 事件(由 Task 4.3 发送,字段 snake_case):`{"type": "ready", "asr": "stream"|"buffered"}`、`{"type": "state", "state": "listening"|"thinking"|"speaking"}`、`{"type": "transcript_partial", "text"}`、`{"type": "transcript_final", "text", "message_id": str|null}`、`{"type": "reply_delta", "turn_id", "text"}`、`{"type": "reply_done", "turn_id", "message_id": str|null, "interrupted": bool}`、`{"type": "assessment", "message_id", "status": "done"|"failed"|"quota", "result"?: object, "assessment_id"?: str|null}`、`{"type": "degraded", "reason": "asr"}`、`{"type": "error", "code": "asr_failed"|"llm_failed"|"tts_failed"|"rate_limited"|"message_limit"}`。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_realtime_protocol.py`:

```python
import json
import struct

import pytest

from app.realtime_protocol import (
    CLOSE_REASONS, MAX_UPLINK_FRAME, HangupMsg, InterruptMsg, ProtocolError, StartMsg, UtteranceEndMsg,
    audio_frame, check_uplink, parse_client_message,
)

START = {"type": "start", "voice": "en_female_dacey_uranus_bigtts"}


def test_close_codes_match_the_contract():
    assert CLOSE_REASONS == {
        1000: "normal", 4001: "unauthorized", 4003: "disabled", 4004: "not_found", 4008: "idle_timeout",
        4009: "max_duration", 4013: "message_limit", 4029: "busy", 4400: "protocol", 4502: "upstream",
    }


def test_parse_each_message():
    start = parse_client_message(json.dumps({**START, "system_prompt": "Be kind.", "save_recordings": True}))
    assert isinstance(start, StartMsg) and start.temperature == 0.7 and start.save_recordings is True
    assert isinstance(parse_client_message('{"type":"utterance_end"}'), UtteranceEndMsg)
    assert isinstance(parse_client_message('{"type":"interrupt"}'), InterruptMsg)
    assert isinstance(parse_client_message('{"type":"hangup"}'), HangupMsg)


@pytest.mark.parametrize("raw", [
    "not json",
    '{"type":"dance"}',
    '{"type":"hangup","extra":1}',
    json.dumps({**START, "voice": "bad voice!"}),
    json.dumps({**START, "system_prompt": "x" * 8001}),
    json.dumps({**START, "temperature": 3}),
    json.dumps({**START, "language": "english"}),
    "x" * 20000,
])
def test_invalid_messages_raise(raw):
    with pytest.raises(ProtocolError):
        parse_client_message(raw)


def test_uplink_frames_are_bounded_pcm16():
    check_uplink(b"\x00\x00" * 160)
    for bad in (b"", b"\x00" * 3, b"\x00" * (MAX_UPLINK_FRAME + 2)):
        with pytest.raises(ProtocolError):
            check_uplink(bad)


def test_audio_frame_prefixes_the_turn_id():
    frame = audio_frame(258, b"\x01\x02")
    assert struct.unpack(">I", frame[:4])[0] == 258 and frame[4:] == b"\x01\x02"
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_realtime_protocol.py -q` → FAIL。

- [ ] **Step 3: 实现** —— `server/app/realtime_protocol.py`:

```python
"""实时通话协议(计划 R12)。网页端 web/src/features/realtime/protocol.ts 与此逐字对应。"""
import struct
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

CLOSE_NORMAL = 1000
CLOSE_UNAUTHORIZED = 4001
CLOSE_DISABLED = 4003
CLOSE_NOT_FOUND = 4004
CLOSE_IDLE = 4008
CLOSE_MAX_DURATION = 4009
CLOSE_MESSAGE_LIMIT = 4013
CLOSE_BUSY = 4029
CLOSE_PROTOCOL = 4400
CLOSE_UPSTREAM = 4502
CLOSE_REASONS = {
    CLOSE_NORMAL: "normal", CLOSE_UNAUTHORIZED: "unauthorized", CLOSE_DISABLED: "disabled",
    CLOSE_NOT_FOUND: "not_found", CLOSE_IDLE: "idle_timeout", CLOSE_MAX_DURATION: "max_duration",
    CLOSE_MESSAGE_LIMIT: "message_limit", CLOSE_BUSY: "busy", CLOSE_PROTOCOL: "protocol", CLOSE_UPSTREAM: "upstream",
}
MAX_UPLINK_FRAME = 32_000
MAX_SYSTEM_PROMPT = 8000
MAX_CLIENT_TEXT = 16_384


class ProtocolError(Exception):
    pass


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartMsg(_Msg):
    type: Literal["start"]
    system_prompt: str = Field("", max_length=MAX_SYSTEM_PROMPT)
    model: str = Field("", max_length=200)
    temperature: float = Field(0.7, ge=0, le=2)
    voice: str = Field(pattern=r"^[A-Za-z0-9_-]{3,100}$")
    language: str = Field("en", pattern=r"^[a-z]{2}(-[A-Za-z]{2})?$")
    save_recordings: bool = False


class UtteranceEndMsg(_Msg):
    type: Literal["utterance_end"]


class InterruptMsg(_Msg):
    type: Literal["interrupt"]


class HangupMsg(_Msg):
    type: Literal["hangup"]


ClientMessage = Annotated[Union[StartMsg, UtteranceEndMsg, InterruptMsg, HangupMsg], Field(discriminator="type")]
_ADAPTER: TypeAdapter = TypeAdapter(ClientMessage)


def parse_client_message(text: str) -> StartMsg | UtteranceEndMsg | InterruptMsg | HangupMsg:
    if len(text) > MAX_CLIENT_TEXT:
        raise ProtocolError("message too large")
    try:
        return _ADAPTER.validate_json(text)
    except ValidationError:
        raise ProtocolError("invalid message") from None


def check_uplink(data: bytes) -> None:
    if not data or len(data) > MAX_UPLINK_FRAME or len(data) % 2:
        raise ProtocolError("invalid audio frame")


def audio_frame(turn_id: int, pcm: bytes) -> bytes:
    return struct.pack(">I", turn_id) + pcm
```

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_realtime_protocol.py -q` → PASS。

- [ ] **Step 5: 提交**

```bash
git add server/app/realtime_protocol.py server/tests/test_realtime_protocol.py
git commit -m "feat(server): define the realtime call protocol and close codes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.3:通话状态机(假上游下的完整测试)

**Files:**
- Create: `server/app/realtime_session.py`、`server/tests/test_realtime_session.py`

**Interfaces:**
- Consumes:Task 1.4 的 `SentenceSplitter`;Task 1.5 的 `AsrError`、`MAX_UTTERANCE_BYTES`、`RecognizerFactory`、`UtteranceRecognizer`;Task 4.2 的全部。
- Produces:异常 `MessageLimitError`、`ConversationGoneError`、`LlmError`、`TtsError`;协议 `MessageStore`(`async history(limit: int) -> list[dict]`,按时间正序的 `{"role", "content"}`;`async add_user(text) -> str`;`async add_assistant(text) -> str`)、`Assessor`(`async assess(message_id: str, pcm: bytes, text: str) -> dict`,返回 `{"status": ..., "result"?: ..., "assessment_id"?: ...}`);`LlmStream = Callable[[list[dict]], AsyncIterator[str]]`;`TtsStream = Callable[[str], AsyncIterator[bytes]]`(产出偶数长度的 24 kHz PCM16LE);`@dataclass RealtimeLimits(max_seconds: float, idle_seconds: float, history: int = 20)`;`@dataclass Upstreams(recognizers: RecognizerFactory, fallback: RecognizerFactory | None, asr_mode: str, llm: LlmStream, tts: TtsStream, assessor: Assessor | None)`;`@dataclass CallStats(turns: int = 0, interrupts: int = 0)`;`class RealtimeSession(*, upstreams, store, system_prompt: str, allow_turn: Callable[[], bool], send_json: Callable[[dict], Awaitable[None]], send_bytes: Callable[[bytes], Awaitable[None]], limits: RealtimeLimits)`,`async run(receive: Callable[[], Awaitable[str | bytes | None]]) -> int`(返回关闭码;`receive` 返回 `None` 表示客户端已断开)、`async drain(timeout: float = 10.0) -> None`(等待进行中的评测)、`stats: CallStats`。行为规则:R12–R15 与下面的测试。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_realtime_session.py`:

```python
import asyncio
import json
import struct

import pytest

from app.asr import AsrError
from app.realtime_session import (
    LlmError, MessageLimitError, RealtimeLimits, RealtimeSession, TtsError, Upstreams,
)

PCM = b"\x01\x00" * 1600  # 100 ms


class FakeRecognizer:
    def __init__(self, text="hello there", error=None, gate=None):
        self.text, self.error, self.gate = text, error, gate
        self.audio = bytearray()
        self.aborted = False

    async def send_audio(self, pcm):
        self.audio += pcm

    async def finish(self):
        if self.gate:
            await self.gate.wait()
        if self.error:
            raise self.error
        return self.text

    async def abort(self):
        self.aborted = True


class Factory:
    def __init__(self, *recognizers, open_error=None):
        self.recognizers = list(recognizers)
        self.open_error = open_error
        self.opened = 0

    async def __call__(self, on_partial):
        self.opened += 1
        if self.open_error:
            raise self.open_error
        await on_partial("hel")
        return self.recognizers.pop(0) if self.recognizers else FakeRecognizer()


class FakeStore:
    def __init__(self, limit_error=False):
        self.messages: list[dict] = []
        self.limit_error = limit_error

    async def history(self, limit):
        return [{"role": m["role"], "content": m["content"]} for m in self.messages][-limit:]

    async def add_user(self, text):
        if self.limit_error:
            raise MessageLimitError()
        self.messages.append({"role": "user", "content": text})
        return f"m{len(self.messages)}"

    async def add_assistant(self, text):
        self.messages.append({"role": "assistant", "content": text})
        return f"m{len(self.messages)}"


def llm_of(*deltas, error=None, seen=None):
    async def stream(messages):
        if seen is not None:
            seen.append(messages)
        for d in deltas:
            await asyncio.sleep(0)
            yield d
        if error:
            raise error
    return stream


def tts_of(gate_after=None, error_on=None, log=None):
    async def stream(text):
        if log is not None:
            log.append(text)
        if error_on and error_on in text:
            raise TtsError()
        if gate_after and gate_after in text:
            await asyncio.Event().wait()  # 永远等待:只能被取消
        yield b"\x02\x00" * 240
    return stream


class Harness:
    def __init__(self, *, factory=None, fallback=None, llm=None, tts=None, store=None, assessor=None,
                 allow=True, limits=RealtimeLimits(max_seconds=5, idle_seconds=2)):
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.events: list[dict] = []
        self.audio: list[bytes] = []
        self.store = store or FakeStore()
        self.factory = factory or Factory()
        self.session = RealtimeSession(
            upstreams=Upstreams(self.factory, fallback, "buffered", llm or llm_of("Sure. ", "What size?"), tts or tts_of(), assessor),
            store=self.store, system_prompt="Be a barista.", allow_turn=lambda: allow,
            send_json=self._json, send_bytes=self._bytes, limits=limits,
        )

    async def _json(self, e):
        self.events.append(e)

    async def _bytes(self, b):
        self.audio.append(b)

    def send(self, item):
        self.inbox.put_nowait(json.dumps(item) if isinstance(item, dict) else item)

    async def run(self):
        return await self.session.run(self.inbox.get)

    def types(self):
        return [e["type"] for e in self.events]

    async def until(self, predicate, timeout=2.0):
        async with asyncio.timeout(timeout):
            while not predicate():
                await asyncio.sleep(0.005)


async def speak_once(h: Harness):
    h.send(PCM)
    h.send({"type": "utterance_end"})


async def test_one_full_turn_saves_both_messages_and_streams_audio():
    h = Harness()
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.events[0] == {"type": "ready", "asr": "buffered"}
    final = next(e for e in h.events if e["type"] == "transcript_final")
    assert final == {"type": "transcript_final", "text": "hello there", "message_id": "m1"}
    assert {"type": "transcript_partial", "text": "hel"} in h.events
    done = next(e for e in h.events if e["type"] == "reply_done")
    assert done == {"type": "reply_done", "turn_id": 1, "message_id": "m2", "interrupted": False}
    assert [m["content"] for m in h.store.messages] == ["hello there", "Sure. What size?"]
    assert h.audio and all(struct.unpack(">I", a[:4])[0] == 1 for a in h.audio)
    states = [e["state"] for e in h.events if e["type"] == "state"]
    assert states == ["listening", "thinking", "speaking", "listening"]
    assert h.session.stats.turns == 1


async def test_llm_gets_the_system_prompt_and_history():
    seen = []
    h = Harness(llm=llm_of("Hi.", seen=seen))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert seen[0] == [{"role": "system", "content": "Be a barista."}, {"role": "user", "content": "hello there"}]


async def test_empty_transcript_is_not_saved_or_answered():
    h = Harness(factory=Factory(FakeRecognizer(text="  ")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "transcript_final" in h.types())
    h.send({"type": "hangup"})
    await task
    assert next(e for e in h.events if e["type"] == "transcript_final")["message_id"] is None
    assert h.store.messages == [] and "reply_delta" not in h.types()


@pytest.mark.parametrize("how", ["interrupt", "audio"])
async def test_interrupt_cancels_and_saves_only_the_spoken_part(how):
    log = []
    h = Harness(llm=llm_of("One. ", "Two. ", "Three."), tts=tts_of(gate_after="Two", log=log))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "Two." in log)
    h.send({"type": "interrupt"} if how == "interrupt" else PCM)
    await h.until(lambda: "reply_done" in h.types())
    done = next(e for e in h.events if e["type"] == "reply_done")
    assert done["interrupted"] is True and done["message_id"] == "m2"
    assert h.store.messages[1] == {"role": "assistant", "content": "One. …"}
    assert "Three." not in log
    assert h.session.stats.interrupts == 1
    h.send({"type": "hangup"})
    assert await task == 1000


async def test_interrupt_while_recognising_keeps_the_first_utterance_without_a_reply():
    gate = asyncio.Event()
    seen = []
    h = Harness(factory=Factory(FakeRecognizer("first part", gate=gate), FakeRecognizer("second part")), llm=llm_of("OK.", seen=seen))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: h.factory.opened == 1 and "state" in h.types() and h.events[-1].get("state") == "thinking")
    await speak_once(h)  # 新的语音到达:第一句不回复
    gate.set()
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert [m["content"] for m in h.store.messages] == ["first part", "second part", "OK."]
    assert len(seen) == 1 and [m["content"] for m in seen[0][1:]] == ["first part", "second part"]


async def test_idle_timeout_closes_4008():
    h = Harness(limits=RealtimeLimits(max_seconds=5, idle_seconds=0.15))
    assert await asyncio.wait_for(h.run(), 2) == 4008


async def test_idle_is_not_counted_while_the_bot_speaks():
    async def slow_tts(text):
        await asyncio.sleep(0.3)
        yield b"\x00\x00"
    h = Harness(tts=slow_tts, limits=RealtimeLimits(max_seconds=5, idle_seconds=0.2))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 3) == 4008
    assert "reply_done" in h.types()  # 说完之后才因静音挂断


async def test_max_duration_closes_4009():
    h = Harness(limits=RealtimeLimits(max_seconds=0.2, idle_seconds=10))
    task = asyncio.create_task(h.run())
    for _ in range(10):
        h.send(PCM)
        await asyncio.sleep(0.03)
    assert await asyncio.wait_for(task, 2) == 4009


async def test_rate_limited_turn_is_reported_and_skipped():
    h = Harness(allow=False)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "error" in h.types())
    h.send({"type": "hangup"})
    await task
    assert {"type": "error", "code": "rate_limited"} in h.events and h.store.messages == []


async def test_message_limit_closes_4013():
    h = Harness(store=FakeStore(limit_error=True))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 2) == 4013
    assert {"type": "error", "code": "message_limit"} in h.events


async def test_stream_asr_failure_degrades_to_the_fallback():
    fallback = Factory(FakeRecognizer("from fallback"))
    h = Harness(factory=Factory(open_error=AsrError("upstream")), fallback=fallback)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert {"type": "degraded", "reason": "asr"} in h.events
    assert h.store.messages[0]["content"] == "from fallback"


async def test_asr_unavailable_without_fallback_closes_4502():
    h = Harness(factory=Factory(open_error=AsrError("auth")))
    task = asyncio.create_task(h.run())
    h.send(PCM)
    assert await asyncio.wait_for(task, 2) == 4502


async def test_recognition_failure_reports_and_keeps_listening():
    h = Harness(factory=Factory(FakeRecognizer(error=AsrError("upstream"))))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "error" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert {"type": "error", "code": "asr_failed"} in h.events


async def test_llm_failure_reports_and_saves_nothing_for_the_reply():
    h = Harness(llm=llm_of(error=LlmError()))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: {"type": "error", "code": "llm_failed"} in h.events)
    h.send({"type": "hangup"})
    await task
    assert [m["role"] for m in h.store.messages] == ["user"]
    assert {"type": "reply_done", "turn_id": 1, "message_id": None, "interrupted": True} in h.events
    assert h.events[-1] == {"type": "state", "state": "listening"}


async def test_tts_failure_keeps_the_text_reply():
    h = Harness(tts=tts_of(error_on="Sure"))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert {"type": "error", "code": "tts_failed"} in h.events
    assert h.store.messages[-1]["content"] == "Sure. What size?"


async def test_assessment_events_and_failures():
    class Assessor:
        def __init__(self):
            self.calls = []

        async def assess(self, message_id, pcm, text):
            self.calls.append((message_id, len(pcm), text))
            if len(self.calls) > 1:
                raise RuntimeError("boom")
            return {"status": "done", "result": {"pronunciation_score": 80}, "assessment_id": None}

    a = Assessor()
    h = Harness(assessor=a, factory=Factory(FakeRecognizer("one"), FakeRecognizer("two")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "assessment" in h.types())
    await h.until(lambda: "reply_done" in h.types())
    await speak_once(h)
    await h.until(lambda: len([e for e in h.events if e["type"] == "assessment"]) == 2)
    h.send({"type": "hangup"})
    await task
    await h.session.drain()
    first, second = [e for e in h.events if e["type"] == "assessment"]
    assert first["message_id"] == "m1" and first["status"] == "done"
    assert second == {"type": "assessment", "message_id": "m3", "status": "failed"}
    assert a.calls[0] == ("m1", len(PCM), "one")


@pytest.mark.parametrize("bad", ["not json", {"type": "start", "voice": "abc"}, b"\x00" * 3, b"\x00" * 40000])
async def test_protocol_errors_close_4400(bad):
    h = Harness()
    task = asyncio.create_task(h.run())
    h.send(bad)
    assert await asyncio.wait_for(task, 2) == 4400


async def test_disconnect_cancels_the_reply_and_saves_the_spoken_part():
    log = []
    h = Harness(llm=llm_of("One. ", "Two."), tts=tts_of(gate_after="Two", log=log))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "Two." in log)
    h.inbox.put_nowait(None)
    assert await asyncio.wait_for(task, 2) == 1000
    assert h.store.messages[-1] == {"role": "assistant", "content": "One. …"}
```

  说明:`Harness.send` 把 dict 编成 JSON 文本、bytes 原样放入;`receive` 就是 `inbox.get`(`None` 表示断开)。全部用例用真实的 asyncio 时间,但时限都在 0.15–0.3 s 级别。

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_realtime_session.py -q` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** —— `server/app/realtime_session.py`:

```python
"""实时通话状态机(计划 R12–R15)。只依赖注入的上游;日志只记数字。"""
import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Protocol

from app.asr import MAX_UTTERANCE_BYTES, AsrError, RecognizerFactory, UtteranceRecognizer
from app.realtime_protocol import (
    CLOSE_IDLE, CLOSE_MAX_DURATION, CLOSE_MESSAGE_LIMIT, CLOSE_NORMAL, CLOSE_NOT_FOUND, CLOSE_PROTOCOL, CLOSE_UPSTREAM,
    HangupMsg, InterruptMsg, ProtocolError, UtteranceEndMsg, audio_frame, check_uplink, parse_client_message,
)
from app.sentence_split import SentenceSplitter


class MessageLimitError(Exception):
    pass


class ConversationGoneError(Exception):
    pass


class LlmError(Exception):
    pass


class TtsError(Exception):
    pass


class MessageStore(Protocol):
    async def history(self, limit: int) -> list[dict]: ...

    async def add_user(self, text: str) -> str: ...

    async def add_assistant(self, text: str) -> str: ...


class Assessor(Protocol):
    async def assess(self, message_id: str, pcm: bytes, text: str) -> dict: ...


LlmStream = Callable[[list[dict]], AsyncIterator[str]]
TtsStream = Callable[[str], AsyncIterator[bytes]]


@dataclass
class RealtimeLimits:
    max_seconds: float
    idle_seconds: float
    history: int = 20


@dataclass
class Upstreams:
    recognizers: RecognizerFactory
    fallback: RecognizerFactory | None
    asr_mode: str
    llm: LlmStream
    tts: TtsStream
    assessor: Assessor | None


@dataclass
class CallStats:
    turns: int = 0
    interrupts: int = 0


@dataclass
class _Turn:
    after: asyncio.Event | None
    saved: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    replying: bool = False
    skip_reply: bool = False


_WAKE = object()
_CLOSED = object()
INTERRUPTED_SUFFIX = " …"


class RealtimeSession:
    def __init__(self, *, upstreams: Upstreams, store: MessageStore, system_prompt: str, allow_turn: Callable[[], bool],
                 send_json: Callable[[dict], Awaitable[None]], send_bytes: Callable[[bytes], Awaitable[None]],
                 limits: RealtimeLimits):
        self._up = upstreams
        self._store = store
        self._system = system_prompt
        self._allow_turn = allow_turn
        self._send_json = send_json
        self._send_bytes = send_bytes
        self._limits = limits
        self.stats = CallStats()
        self._queue: asyncio.Queue = asyncio.Queue()
        self._send_lock = asyncio.Lock()
        self._closed = False
        self._fatal: int | None = None
        self._state = "listening"
        self._recognizer: UtteranceRecognizer | None = None
        self._utterance = bytearray()
        self._turn: _Turn | None = None
        self._turn_id = 0
        self._assessments: set[asyncio.Task] = set()
        self._last_activity = 0.0

    # ---- 发送 ----
    async def _send(self, event: dict) -> None:
        if self._closed:
            return
        async with self._send_lock:
            try:
                await self._send_json(event)
            except Exception:
                self._closed = True

    async def _send_audio(self, data: bytes) -> None:
        if self._closed:
            return
        async with self._send_lock:
            try:
                await self._send_bytes(data)
            except Exception:
                self._closed = True

    async def _set_state(self, state: str) -> None:
        if state != self._state:
            self._state = state
            await self._send({"type": "state", "state": state})

    def _fail(self, code: int) -> None:
        if self._fatal is None:
            self._fatal = code
            self._queue.put_nowait(_WAKE)

    def _now(self) -> float:
        return asyncio.get_running_loop().time()

    def _busy(self) -> bool:
        return self._turn is not None and self._turn.task is not None and not self._turn.task.done()

    # ---- 主循环 ----
    async def _pump(self, receive: Callable[[], Awaitable[str | bytes | None]]) -> None:
        try:
            while True:
                item = await receive()
                if item is None:
                    break
                await self._queue.put(item)
        except Exception:
            pass
        finally:
            self._queue.put_nowait(_CLOSED)

    async def run(self, receive: Callable[[], Awaitable[str | bytes | None]]) -> int:
        reader = asyncio.create_task(self._pump(receive))
        deadline = self._now() + self._limits.max_seconds
        self._last_activity = self._now()
        await self._send({"type": "ready", "asr": self._up.asr_mode})
        await self._send({"type": "state", "state": "listening"})
        try:
            while True:
                if self._fatal is not None:
                    return self._fatal
                now = self._now()
                if now >= deadline:
                    return CLOSE_MAX_DURATION
                timeout = deadline - now
                if not self._busy() and self._recognizer is None:
                    idle_left = self._last_activity + self._limits.idle_seconds - now
                    if idle_left <= 0:
                        return CLOSE_IDLE
                    timeout = min(timeout, idle_left)
                try:
                    item = await asyncio.wait_for(self._queue.get(), timeout)
                except TimeoutError:
                    continue
                if item is _WAKE:
                    continue
                if item is _CLOSED:
                    return CLOSE_NORMAL
                if isinstance(item, bytes):
                    await self._on_audio(item)
                    continue
                msg = parse_client_message(item)
                if isinstance(msg, HangupMsg):
                    return CLOSE_NORMAL
                if isinstance(msg, InterruptMsg):
                    await self._interrupt()
                elif isinstance(msg, UtteranceEndMsg):
                    await self._on_utterance_end()
                else:
                    raise ProtocolError("start was already received")
        except ProtocolError:
            return CLOSE_PROTOCOL
        finally:
            reader.cancel()
            await self._shutdown()

    # ---- 上行音频与断句 ----
    async def _open_recognizer(self) -> UtteranceRecognizer | None:
        async def on_partial(text: str) -> None:
            await self._send({"type": "transcript_partial", "text": text})

        try:
            return await self._up.recognizers(on_partial)
        except AsrError:
            if self._up.fallback is None:
                self._fail(CLOSE_UPSTREAM)
                return None
        self._up = replace(self._up, recognizers=self._up.fallback, fallback=None, asr_mode="buffered")
        await self._send({"type": "degraded", "reason": "asr"})
        try:
            return await self._up.recognizers(on_partial)
        except AsrError:
            self._fail(CLOSE_UPSTREAM)
            return None

    async def _on_audio(self, data: bytes) -> None:
        check_uplink(data)
        self._last_activity = self._now()
        if self._busy() and self._recognizer is None:
            await self._interrupt()  # 用户开口:打断(R12)
        if self._recognizer is None:
            self._recognizer = await self._open_recognizer()
            if self._recognizer is None:
                return
        room = MAX_UTTERANCE_BYTES - len(self._utterance)
        if room > 0:
            self._utterance += data[:room]
        try:
            await self._recognizer.send_audio(data)
        except AsrError:
            await self._recognizer.abort()
            self._recognizer = None
            self._utterance = bytearray()
            await self._send({"type": "error", "code": "asr_failed"})

    async def _on_utterance_end(self) -> None:
        recognizer, pcm = self._recognizer, bytes(self._utterance)
        self._recognizer, self._utterance = None, bytearray()
        if recognizer is None:
            return
        previous = self._turn
        turn = _Turn(after=previous.saved if previous else None)
        self._turn = turn
        await self._set_state("thinking")
        turn.task = asyncio.create_task(self._run_turn(turn, recognizer, pcm))

    async def _interrupt(self) -> None:
        turn = self._turn
        if turn is None or turn.task is None or turn.task.done():
            return
        self.stats.interrupts += 1
        if turn.replying:
            turn.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await turn.task
            await self._set_state("listening")
        else:
            turn.skip_reply = True

    # ---- 一轮:识别 → 保存 → 回复 ----
    async def _run_turn(self, turn: _Turn, recognizer: UtteranceRecognizer, pcm: bytes) -> None:
        try:
            try:
                text = (await recognizer.finish()).strip()
            except AsrError:
                await self._send({"type": "error", "code": "asr_failed"})
                return
            if turn.after is not None:
                await turn.after.wait()  # 保存顺序与说话顺序一致
            if not text:
                await self._send({"type": "transcript_final", "text": "", "message_id": None})
                return
            if not self._allow_turn():
                await self._send({"type": "error", "code": "rate_limited"})
                return
            try:
                message_id = await self._store.add_user(text)
            except MessageLimitError:
                await self._send({"type": "error", "code": "message_limit"})
                self._fail(CLOSE_MESSAGE_LIMIT)
                return
            except ConversationGoneError:
                self._fail(CLOSE_NOT_FOUND)
                return
            finally:
                turn.saved.set()
            self.stats.turns += 1
            await self._send({"type": "transcript_final", "text": text, "message_id": message_id})
            if self._up.assessor is not None and pcm:
                self._spawn_assessment(message_id, pcm, text)
            if turn.skip_reply:
                return
            history = await self._store.history(self._limits.history)
            messages = ([{"role": "system", "content": self._system}] if self._system.strip() else []) + history
            turn.replying = True
            await self._reply(messages)
        finally:
            turn.saved.set()
            if self._turn is turn and not self._closed:
                await self._set_state("listening")
                self._last_activity = self._now()
            self._queue.put_nowait(_WAKE)  # 让主循环重新计算静音超时

    async def _reply(self, messages: list[dict]) -> None:
        self._turn_id += 1
        turn_id = self._turn_id
        splitter = SentenceSplitter()
        sentences: asyncio.Queue[str | None] = asyncio.Queue()
        full: list[str] = []
        spoken: list[str] = []

        async def produce() -> None:
            try:
                async for delta in self._up.llm(messages):
                    full.append(delta)
                    await self._send({"type": "reply_delta", "turn_id": turn_id, "text": delta})
                    for sentence in splitter.feed(delta):
                        sentences.put_nowait(sentence)
                for sentence in splitter.flush():
                    sentences.put_nowait(sentence)
            finally:
                sentences.put_nowait(None)

        async def speak() -> None:
            audio_ok = True
            while (sentence := await sentences.get()) is not None:
                if not audio_ok:
                    continue
                await self._set_state("speaking")
                try:
                    async for chunk in self._up.tts(sentence):
                        await self._send_audio(audio_frame(turn_id, chunk))
                    spoken.append(sentence)
                except TtsError:
                    audio_ok = False
                    await self._send({"type": "error", "code": "tts_failed"})

        async def save(text: str) -> str | None:
            try:
                return await self._store.add_assistant(text)
            except MessageLimitError:
                self._fail(CLOSE_MESSAGE_LIMIT)
            except ConversationGoneError:
                self._fail(CLOSE_NOT_FOUND)
            return None

        failed = cancelled = False
        try:
            try:
                async with asyncio.TaskGroup() as group:
                    group.create_task(produce())
                    group.create_task(speak())
            except* LlmError:  # except* 不能与普通 except 写在同一个 try 里,所以分两层
                failed = True
        except asyncio.CancelledError:
            cancelled = True  # 打断/挂断:TaskGroup 已取消 LLM 与 TTS 子任务
        if failed or cancelled:
            if failed:
                await self._send({"type": "error", "code": "llm_failed"})
            message_id = await save(" ".join(spoken) + INTERRUPTED_SUFFIX) if spoken else None
            await self._send({"type": "reply_done", "turn_id": turn_id, "message_id": message_id, "interrupted": True})
            if cancelled:
                raise asyncio.CancelledError()
            return
        content = "".join(full).strip()
        message_id = await save(content) if content else None
        await self._send({"type": "reply_done", "turn_id": turn_id, "message_id": message_id, "interrupted": False})

    # ---- 评测与收尾 ----
    def _spawn_assessment(self, message_id: str, pcm: bytes, text: str) -> None:
        assessor = self._up.assessor

        async def job() -> None:
            try:
                payload = await assessor.assess(message_id, pcm, text)
            except Exception:
                payload = {"status": "failed"}
            await self._send({"type": "assessment", "message_id": message_id, **payload})

        task = asyncio.create_task(job())
        self._assessments.add(task)
        task.add_done_callback(self._assessments.discard)

    async def _shutdown(self) -> None:
        turn = self._turn
        if turn is not None and turn.task is not None and not turn.task.done():
            turn.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await turn.task
        if self._recognizer is not None:
            with contextlib.suppress(Exception):
                await self._recognizer.abort()
            self._recognizer = None

    async def drain(self, timeout: float = 10.0) -> None:
        self._closed = True
        pending = set(self._assessments)
        if pending:
            _, late = await asyncio.wait(pending, timeout=timeout)
            for task in late:
                task.cancel()
```

  说明与易错点:
  - `test_llm_failure_reports_and_saves_nothing_for_the_reply`:LLM 在第一个句子之前就失败 → `spoken` 为空 → 不保存助手消息;`reply_done` 照发(`interrupted: true`、`message_id: null`),界面据此结束这一轮。
  - 被取消的任务在 `except asyncio.CancelledError` 里仍可以 `await`(保存已说出的部分、发 `reply_done`),最后必须重新抛出 `CancelledError`,`_interrupt` 才能确认它已结束。
  - 一轮结束时 `_run_turn` 往队列里放 `_WAKE`:主循环在"忙"时等待的超时是整通电话的剩余时长,不叫醒它就要等到下一条消息才会重新计算静音超时(`test_idle_is_not_counted_while_the_bot_speaks` 守护)。
  - `_run_turn` 里 `finally: turn.saved.set()` 出现两次是有意的(保存后立刻放行下一轮的保存;任何提前返回也要放行)。

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_realtime_session.py -q` → PASS;再连跑 3 次 `for i in 1 2 3; do uv run pytest tests/test_realtime_session.py -q 2>&1 | tail -1; done` 都通过(时间相关用例不得偶发失败;失败就加大用例里的超时余量,不得降低断言)。

- [ ] **Step 5: 提交**

```bash
git add server/app/realtime_session.py server/tests/test_realtime_session.py
git commit -m "feat(server): add the realtime call state machine with interruption and limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.4:真实上游适配(LLM 流、TTS 流、识别选择、消息存储)

**Files:**
- Create: `server/app/realtime_providers.py`、`server/tests/test_realtime_providers.py`

**Interfaces:**
- Consumes:Task 1.3 的 `synthesize_stream`;Task 1.5 的 `buffered_factory`、`make_transcriber`;Task 1.6 的 `volc_stream_factory`(**可选**:模块不存在时按 buffered 处理并记一条 warning);Task 4.3 的异常与类型;既有模型 `Conversation`、`Message`、`utcnow`。
- Produces:`REALTIME_MAX_TOKENS = 600`;`openai_llm_stream(http, settings, model: str, temperature: float) -> LlmStream`(模型不在 `LLM_MODELS` 里 → 默认模型;`max_tokens = min(LLM_MAX_TOKENS, 600)`;非 200 / 网络错误 → `LlmError`);`volc_tts_stream(http, settings, voice: str, uid: str) -> TtsStream`(`format=pcm`、`sample_rate=REALTIME_TTS_SAMPLE_RATE`;保证每块偶数字节;`VolcengineError` → `TtsError`);`make_recognizers(http, settings, uid: str) -> tuple[RecognizerFactory, RecognizerFactory | None, str]`;`class DbMessageStore(sessionmaker, user_id: int, conversation_id: str, max_messages: int)`(实现 `MessageStore`;会话被删或不属于该用户 → `ConversationGoneError`;超过 `MAX_MESSAGES_PER_CONVERSATION` → `MessageLimitError`;`created_at` 严格递增,与 `POST /messages` 相同的规则;内容截到 20000 字符)。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_realtime_providers.py`:

```python
import json

import httpx
import pytest

from app import realtime_providers as providers
from app.realtime_providers import DbMessageStore, make_recognizers, openai_llm_stream, volc_tts_stream
from app.realtime_session import ConversationGoneError, LlmError, MessageLimitError, TtsError
from app.volcengine import VolcengineError
from tests.conftest import make_settings

LLM = "https://llm.test/v1/chat/completions"


def sse(*events: str) -> bytes:
    return "".join(f"data: {e}\n\n" for e in events).encode()


async def collect(gen):
    return [x async for x in gen]


async def test_llm_stream_parses_deltas_and_clamps(respx_mock):
    route = respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=sse(
        json.dumps({"choices": [{"delta": {"role": "assistant"}}]}),
        json.dumps({"choices": [{"delta": {"content": "Hi"}}]}),
        ": keep-alive",
        json.dumps({"choices": [{"delta": {"content": " there."}}]}),
        "[DONE]",
    )))
    async with httpx.AsyncClient() as http:
        stream = openai_llm_stream(http, make_settings(llm_max_tokens=4096), "not-a-model", 0.5)
        assert await collect(stream([{"role": "user", "content": "x"}])) == ["Hi", " there."]
    body = json.loads(route.calls.last.request.content)
    assert body["model"] == "gpt-4o" and body["stream"] is True and body["max_tokens"] == 600 and body["temperature"] == 0.5
    assert route.calls.last.request.headers["authorization"] == "Bearer llm-secret"


@pytest.mark.parametrize("response", [httpx.Response(500), httpx.ConnectError("x")])
async def test_llm_stream_errors(respx_mock, response):
    mock = respx_mock.post(LLM)
    mock.mock(side_effect=response) if isinstance(response, Exception) else mock.mock(return_value=response)
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmError):
            await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([]))


async def test_tts_stream_keeps_pcm_samples_whole(monkeypatch):
    calls = {}

    async def fake(http, url, key, resource, text, speaker, uid, audio_format="mp3", sample_rate=24000):
        calls.update(resource=resource, audio_format=audio_format, sample_rate=sample_rate, speaker=speaker)
        for chunk in (b"\x01\x02\x03", b"\x04", b"\x05\x06\x07"):
            yield chunk

    monkeypatch.setattr(providers, "synthesize_stream", fake)
    settings = make_settings(volcengine_tts_key="k", realtime_tts_sample_rate=24000)
    out = await collect(volc_tts_stream(None, settings, "voice_x", "1")("Hello."))
    assert out == [b"\x01\x02", b"\x03\x04", b"\x05\x06"]
    assert calls == {"resource": "seed-tts-2.0", "audio_format": "pcm", "sample_rate": 24000, "speaker": "voice_x"}


async def test_tts_stream_maps_errors(monkeypatch):
    async def broken(*args, **kwargs):
        raise VolcengineError("upstream")
        yield b""

    monkeypatch.setattr(providers, "synthesize_stream", broken)
    with pytest.raises(TtsError):
        await collect(volc_tts_stream(None, make_settings(volcengine_tts_key="k"), "v", "1")("x"))


def test_recognizer_selection():
    _, fallback, mode = make_recognizers(None, make_settings(), "1")
    assert (fallback, mode) == (None, "buffered")
    primary, fallback, mode = make_recognizers(None, make_settings(upstream_asr_mode="volc_stream", volcengine_tts_key="k"), "1")
    assert mode in ("stream", "buffered")  # Task 1.6 未执行时为 buffered
    if mode == "stream":
        assert fallback is not None


async def new_conversation(client, headers) -> str:
    return (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=headers)).json()["id"]


async def user_id(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])  # UserOut.id 是字符串


async def test_db_store_saves_in_order_and_reads_history(app, client, auth_headers):
    cid = await new_conversation(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, await user_id(client, auth_headers), cid, max_messages=10)
    first = await store.add_user("hello")
    await store.add_assistant("hi there")
    assert first
    assert await store.history(20) == [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi there"}]
    assert await store.history(1) == [{"role": "assistant", "content": "hi there"}]
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert [m["content"] for m in listed] == ["hello", "hi there"]


async def test_db_store_limits_and_ownership(app, client, auth_headers):
    cid = await new_conversation(client, auth_headers)
    uid = await user_id(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, uid, cid, max_messages=1)
    await store.add_user("one")
    with pytest.raises(MessageLimitError):
        await store.add_assistant("two")
    with pytest.raises(ConversationGoneError):
        await DbMessageStore(app.state.sessionmaker, uid + 1, cid, max_messages=10).add_user("x")
    await client.delete(f"/api/conversations/{cid}", headers=auth_headers)
    with pytest.raises(ConversationGoneError):
        await store.history(5)
```

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_realtime_providers.py -q` → FAIL。

- [ ] **Step 3: 实现** —— `server/app/realtime_providers.py`:

```python
"""实时通话的真实上游适配(计划 Task 4.4)。日志不记文本与密钥。"""
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select

from app.asr import RecognizerFactory, buffered_factory, make_transcriber
from app.config import Settings
from app.models import Conversation, Message, utcnow
from app.realtime_session import ConversationGoneError, LlmError, LlmStream, MessageLimitError, TtsError, TtsStream
from app.volcengine import VolcengineError, synthesize_stream

logger = logging.getLogger(__name__)
REALTIME_MAX_TOKENS = 600
MAX_CONTENT = 20000


def openai_llm_stream(http: httpx.AsyncClient, settings: Settings, model: str, temperature: float) -> LlmStream:
    chosen = model if model in settings.llm_model_list else settings.default_llm_model
    url = settings.upstream_llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.upstream_llm_key}", "Content-Type": "application/json"}

    async def stream(messages: list[dict]):
        body = {"model": chosen, "messages": messages, "temperature": temperature, "stream": True,
                "max_tokens": min(settings.llm_max_tokens, REALTIME_MAX_TOKENS)}
        try:
            response = await http.send(http.build_request("POST", url, json=body, headers=headers,
                                                          timeout=httpx.Timeout(60.0, connect=10.0)), stream=True)
        except httpx.HTTPError as e:
            logger.warning("Realtime LLM request failed: %s", type(e).__name__)
            raise LlmError() from None
        try:
            if response.status_code != 200:
                logger.warning("Realtime LLM HTTP %s", response.status_code)
                raise LlmError()
            buffer = ""
            async for text in response.aiter_text():
                buffer += text
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        delta = json.loads(data)["choices"][0]["delta"].get("content")
                    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                        continue
                    if isinstance(delta, str) and delta:
                        yield delta
        except httpx.HTTPError:
            raise LlmError() from None
        finally:
            await response.aclose()

    return stream


def volc_tts_stream(http: httpx.AsyncClient, settings: Settings, voice: str, uid: str) -> TtsStream:
    resource = settings.realtime_tts_model.removeprefix("volcengine/")

    async def stream(text: str):
        carry = b""
        try:
            async for chunk in synthesize_stream(http, settings.volcengine_tts_url, settings.volcengine_tts_key, resource,
                                                 text, voice, uid, audio_format="pcm",
                                                 sample_rate=settings.realtime_tts_sample_rate):
                data = carry + chunk
                cut = len(data) - len(data) % 2
                carry = data[cut:]
                if cut:
                    yield data[:cut]
        except VolcengineError:
            raise TtsError() from None

    return stream


def make_recognizers(http: httpx.AsyncClient, settings: Settings, uid: str) -> tuple[RecognizerFactory, RecognizerFactory | None, str]:
    buffered = buffered_factory(make_transcriber(http, settings, "en"))
    if not settings.asr_stream_enabled:
        return buffered, None, "buffered"
    try:
        from app.asr_stream import volc_stream_factory
    except ImportError:
        logger.warning("UPSTREAM_ASR_MODE=volc_stream but app.asr_stream has no realtime factory; using the buffered recognizer")
        return buffered, None, "buffered"
    return volc_stream_factory(settings, uid), buffered, "stream"


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class DbMessageStore:
    def __init__(self, sessionmaker, user_id: int, conversation_id: str, max_messages: int):
        self._sm = sessionmaker
        self._user_id = user_id
        self._conversation_id = conversation_id
        self._max = max_messages

    async def _conversation(self, session) -> Conversation:
        conversation = await session.scalar(select(Conversation).where(
            Conversation.id == self._conversation_id, Conversation.user_id == self._user_id))
        if conversation is None:
            raise ConversationGoneError()
        return conversation

    async def _add(self, role: str, text: str) -> str:
        async with self._sm() as session:
            conversation = await self._conversation(session)
            count = await session.scalar(select(func.count()).select_from(Message).where(Message.conversation_id == conversation.id))
            if count + 1 > self._max:
                raise MessageLimitError()
            last = await session.scalar(select(func.max(Message.created_at)).where(Message.conversation_id == conversation.id))
            created = utcnow()
            if last is not None and _as_utc(last) >= created:
                created = _as_utc(last) + timedelta(microseconds=1)
            row = Message(id=str(uuid.uuid4()), conversation_id=conversation.id, role=role, content=text[:MAX_CONTENT], created_at=created)
            session.add(row)
            conversation.updated_at = created
            await session.commit()
            return row.id

    async def add_user(self, text: str) -> str:
        return await self._add("user", text)

    async def add_assistant(self, text: str) -> str:
        return await self._add("assistant", text)

    async def history(self, limit: int) -> list[dict]:
        async with self._sm() as session:
            conversation = await self._conversation(session)
            rows = (await session.execute(
                select(Message.role, Message.content).where(
                    Message.conversation_id == conversation.id, Message.role.in_(("user", "assistant")))
                .order_by(Message.created_at.desc()).limit(limit))).all()
        return [{"role": role, "content": content} for role, content in reversed(rows)]
```

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_realtime_providers.py -q` → PASS;全量 → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/realtime_providers.py server/tests/test_realtime_providers.py
git commit -m "feat(server): connect realtime calls to the LLM, TTS, recognizers and message storage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.5:WebSocket 路由与集成测试

**Files:**
- Modify: `server/app/routers/realtime.py`(加 `WS /api/realtime` 与 `build_upstreams`)
- Create: `server/tests/test_realtime_ws.py`

**Interfaces:**
- Consumes:Task 4.1–4.4 的全部;`app.state.user_limiter`。
- Produces:`build_upstreams(app, settings, user_id: int, start: StartMsg) -> Upstreams`(模块级函数,测试用 `monkeypatch` 替换);`WS /api/realtime?ticket=<票据>`:先 `accept`,再依次检查(未开启 → 4003;票据无效/过期 → 4001;该用户已有通话或全局已满 → 4029;10 s 内没有收到合法的 `start` → 4400;会话已不存在 → 4004),然后运行 `RealtimeSession`,按其返回码关闭,关闭后 `drain()`;每轮用 `user_limiter.allow(str(user_id))` 计额度;结束记 `log_timing("realtime_call", seconds=…, turns=…, interrupts=…, close=…)`;无论哪条路径都 `registry.release(user_id)`。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_realtime_ws.py`(Starlette `TestClient` 同步驱动 WebSocket;数据库用临时文件 SQLite,因为 `TestClient` 在自己的事件循环里运行应用):

```python
import json

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.db import Base
from app.main import create_app
from app.routers import realtime as realtime_router
from app.realtime_session import Upstreams
from tests.conftest import make_settings
from tests.test_realtime_session import Factory, FakeRecognizer, llm_of, tts_of

ENABLED = {
    "realtime_enabled": True,
    "volcengine_tts_key": "volc-secret",
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0",
}
START = {"type": "start", "voice": "en_female_dacey_uranus_bigtts", "system_prompt": "Be brief."}
PCM = b"\x01\x00" * 1600


@pytest.fixture
def ws_app(tmp_path, monkeypatch):
    app = create_app(make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'rt.db'}", **ENABLED))
    monkeypatch.setattr(realtime_router, "build_upstreams",
                        lambda app, settings, user_id, start: Upstreams(Factory(FakeRecognizer("hello there")), None, "buffered",
                                                                        llm_of("Sure. ", "Bye."), tts_of(), None))
    with TestClient(app) as client:
        async def create_all():
            async with app.state.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        client.portal.call(create_all)
        yield app, client


def login(client, name="alice"):
    token = client.post("/api/users", json={"username": name, "password": "password123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def ticket_for(client, headers):
    cid = client.post("/api/conversations", json={"name": "c", "config": {}}, headers=headers).json()["id"]
    return cid, client.post("/api/realtime/ticket", json={"conversation_id": cid}, headers=headers).json()["ticket"]


def receive_until(ws, kind):
    events = []
    while True:
        message = ws.receive()
        if message.get("text"):
            events.append(json.loads(message["text"]))
            if events[-1]["type"] == kind:
                return events
        elif message.get("bytes"):
            events.append({"type": "_audio", "size": len(message["bytes"])})


def test_full_call_saves_messages(ws_app):
    app, client = ws_app
    headers = login(client)
    cid, ticket = ticket_for(client, headers)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        assert receive_until(ws, "ready")[-1] == {"type": "ready", "asr": "buffered"}
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        events = receive_until(ws, "reply_done")
        assert any(e["type"] == "_audio" for e in events)
        ws.send_text(json.dumps({"type": "hangup"}))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1000
    messages = client.get(f"/api/conversations/{cid}/messages", headers=headers).json()["messages"]
    assert [m["content"] for m in messages] == ["hello there", "Sure. Bye."]
    assert app.state.realtime_registry.active_count == 0


@pytest.mark.parametrize("query", ["", "?ticket=", "?ticket=forged"])
def test_bad_ticket_closes_4001(ws_app, query):
    _, client = ws_app
    with client.websocket_connect(f"/api/realtime{query}") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
    assert closed.value.code == 4001


def test_ticket_is_single_use(ws_app):
    _, client = ws_app
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps({"type": "hangup"}))  # 不是 start:协议错误
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 4400
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 4001


def test_second_concurrent_call_is_busy(ws_app):
    _, client = ws_app
    headers = login(client)
    _, first = ticket_for(client, headers)
    _, second = ticket_for(client, headers)
    with client.websocket_connect(f"/api/realtime?ticket={first}") as ws1:
        ws1.send_text(json.dumps(START))
        receive_until(ws1, "ready")
        with client.websocket_connect(f"/api/realtime?ticket={second}") as ws2:
            with pytest.raises(WebSocketDisconnect) as closed:
                ws2.receive_text()
            assert closed.value.code == 4029
        ws1.send_text(json.dumps({"type": "hangup"}))  # 第一路不受影响
        with pytest.raises(WebSocketDisconnect) as closed:
            ws1.receive_text()
        assert closed.value.code == 1000


def test_deleted_conversation_closes_4004(ws_app):
    _, client = ws_app
    headers = login(client)
    cid, ticket = ticket_for(client, headers)
    client.delete(f"/api/conversations/{cid}", headers=headers)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
    assert closed.value.code == 4004


def test_disabled_closes_4003(tmp_path):
    app = create_app(make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'x.db'}"))
    with TestClient(app) as client:
        with client.websocket_connect("/api/realtime?ticket=x") as ws:
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_text()
    assert closed.value.code == 4003
```

  (`tests.test_realtime_session` 里的假上游被复用——它们是模块级定义,可以直接导入。)

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_realtime_ws.py -q` → FAIL(没有 WebSocket 路由,`websocket_connect` 失败)。

- [ ] **Step 3: 实现** —— `routers/realtime.py` 追加:

```python
import asyncio
import contextlib
import time

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.realtime_protocol import (
    CLOSE_BUSY, CLOSE_DISABLED, CLOSE_NOT_FOUND, CLOSE_PROTOCOL, CLOSE_UNAUTHORIZED, ProtocolError, StartMsg, parse_client_message,
)
from app.realtime_providers import DbMessageStore, make_recognizers, openai_llm_stream, volc_tts_stream
from app.realtime_session import ConversationGoneError, RealtimeLimits, RealtimeSession, Upstreams
from app.timing import log_timing

START_TIMEOUT = 10.0


def build_upstreams(app, settings: Settings, user_id: int, start: StartMsg) -> Upstreams:
    http = app.state.http
    recognizers, fallback, mode = make_recognizers(http, settings, str(user_id))
    return Upstreams(
        recognizers=recognizers, fallback=fallback, asr_mode=mode,
        llm=openai_llm_stream(http, settings, start.model, start.temperature),
        tts=volc_tts_stream(http, settings, start.voice, str(user_id)),
        assessor=make_assessor(app, settings, user_id, start.save_recordings),
    )


async def _close(ws: WebSocket, code: int) -> None:
    if ws.application_state != WebSocketState.DISCONNECTED:
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await ws.close(code)


@router.websocket("/realtime")
async def realtime_ws(websocket: WebSocket, ticket: str = ""):
    await websocket.accept()
    app = websocket.app
    settings: Settings = app.state.settings
    if not settings.realtime_available:
        return await _close(websocket, CLOSE_DISABLED)
    grant = app.state.realtime_tickets.redeem(ticket) if ticket else None
    if grant is None:
        return await _close(websocket, CLOSE_UNAUTHORIZED)
    registry = app.state.realtime_registry
    if not registry.acquire(grant.user_id):
        return await _close(websocket, CLOSE_BUSY)
    started = time.monotonic()
    code = CLOSE_PROTOCOL
    session: RealtimeSession | None = None
    try:
        try:
            first = await asyncio.wait_for(websocket.receive_text(), START_TIMEOUT)
            start = parse_client_message(first)
            if not isinstance(start, StartMsg):
                raise ProtocolError("expected start")
        except (TimeoutError, ProtocolError, WebSocketDisconnect, KeyError):
            return await _close(websocket, CLOSE_PROTOCOL)
        store = DbMessageStore(app.state.sessionmaker, grant.user_id, grant.conversation_id,
                               settings.max_messages_per_conversation)
        try:
            await store.history(1)
        except ConversationGoneError:
            code = CLOSE_NOT_FOUND
            return await _close(websocket, CLOSE_NOT_FOUND)

        async def receive():
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return None
            return message.get("bytes") if message.get("bytes") is not None else message.get("text")

        session = RealtimeSession(
            upstreams=build_upstreams(app, settings, grant.user_id, start), store=store, system_prompt=start.system_prompt,
            allow_turn=lambda: app.state.user_limiter.allow(str(grant.user_id)),
            send_json=websocket.send_json, send_bytes=websocket.send_bytes,
            limits=RealtimeLimits(max_seconds=settings.realtime_max_minutes * 60, idle_seconds=settings.realtime_idle_timeout_seconds),
        )
        code = await session.run(receive)
        await _close(websocket, code)
        await session.drain()
    finally:
        registry.release(grant.user_id)
        stats = session.stats if session else None
        log_timing("realtime_call", seconds=time.monotonic() - started, turns=stats.turns if stats else 0,
                   interrupts=stats.interrupts if stats else 0, close=code)
```

  本任务在 `realtime_providers.py` 末尾先加最小实现 `def make_assessor(app, settings, user_id, save): return None`(通话照常、不评测),Task 4.6 用真实实现替换它;`build_upstreams` 里的局部导入改为文件顶部 `from app.realtime_providers import DbMessageStore, make_assessor, make_recognizers, openai_llm_stream, volc_tts_stream`。

- [ ] **Step 4: 运行确认通过** —— `cd server && uv run pytest tests/test_realtime_ws.py tests/test_realtime_session.py -q` → PASS;全量 → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/routers/realtime.py server/app/realtime_providers.py server/tests/test_realtime_ws.py
git commit -m "feat(server): relay realtime calls over a ticket-authenticated WebSocket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.6:通话中的异步发音评测(抽出保存逻辑)

**Files:**
- Create: `server/app/assessment_store.py`
- Modify: `server/app/routers/speech.py`(配额检查与保存改为调用 `assessment_store`,行为不变)
- Modify: `server/app/realtime_providers.py`(`XfyunAssessor`、`make_assessor`)
- Create: `server/tests/test_realtime_assessor.py`

**Interfaces:**
- Consumes:既有 `recordings`、`Assessment`、`Message`、`XfyunIse`、`get_xfyun` 的构造规则、`to_assessment`、`speech.py` 的 `_ise_entry`、`MAX_REFERENCE_CHARS`、`TIMEOUT_BASE_SECONDS`、`TIMEOUT_CAP_SECONDS`、`SCORE_KEYS`、`cleanup_orphan_chat_recordings`;Task 1.2 的 `pcm_to_wav`。
- Produces:`class QuotaExceeded(Exception)`;`async check_quota(session, settings, user_id: int, nbytes: int) -> None`(超额抛 `QuotaExceeded`);`async save_assessment(session, settings, user_id: int, *, wav_bytes: bytes, duration: float, reference: str, language: str, source: str, result: dict) -> str`(写文件 + 插入行 + 提交,失败删文件;返回 `assessment_id`);`class XfyunAssessor(xfyun, sessionmaker, settings, user_id: int, save: bool)`,`async assess(message_id, pcm, text) -> dict`(讯飞失败 → `{"status": "failed"}`;不保存 → `{"status": "done", "result": …, "assessment_id": None}`;保存 → 关联到该用户消息(仅当该消息还没有 `assessment_id`),返回 `assessment_id`;超额 → `{"status": "quota", "result": …, "assessment_id": None}`);`make_assessor(app, settings, user_id, save) -> XfyunAssessor | None`(讯飞未配置 → `None`)。音频只取前 60 s(R14,`MAX_UTTERANCE_BYTES` 已在会话层截断)。

- [ ] **Step 1: 写失败的测试** —— `server/tests/test_realtime_assessor.py`:

```python
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import Assessment, Message
from app.realtime_providers import DbMessageStore, XfyunAssessor, make_assessor
from app.xfyun import XfyunError
from tests.conftest import make_settings

GOOD_XML = (Path(__file__).parent / "fixtures" / "ise_good.xml").read_text(encoding="utf-8")
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
PCM = b"\x00\x00" * 16000


class FakeXfyun:
    configured = True

    def __init__(self, error=None):
        self.error = error
        self.calls = []

    async def evaluate(self, pcm, text, ent, timeout=60.0):
        self.calls.append((len(pcm), text, ent))
        if self.error:
            raise self.error
        return GOOD_XML


async def setup_message(app, client, headers):
    cid = (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=headers)).json()["id"]
    uid = int((await client.get("/api/me", headers=headers)).json()["id"])
    message_id = await DbMessageStore(app.state.sessionmaker, uid, cid, 100).add_user(REFERENCE)
    return uid, message_id


async def test_assess_without_saving(app, client, auth_headers):
    uid, mid = await setup_message(app, client, auth_headers)
    out = await XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=False).assess(mid, PCM, REFERENCE)
    assert out["status"] == "done" and out["assessment_id"] is None and "pronunciation_score" in out["result"]


async def test_assess_and_save_links_the_message(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    uid, mid = await setup_message(app, client, auth_headers)
    out = await XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=True).assess(mid, PCM, REFERENCE)
    assert out["status"] == "done" and out["assessment_id"]
    async with app.state.sessionmaker() as session:
        message = await session.get(Message, mid)
        row = await session.get(Assessment, out["assessment_id"])
    assert message.assessment_id == out["assessment_id"]
    assert row.source == "chat" and row.reference_text == REFERENCE
    assert (tmp_path / row.audio_path).exists()


async def test_quota_and_failures(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    app.state.settings.recording_quota_mb = 0
    uid, mid = await setup_message(app, client, auth_headers)
    out = await XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=True).assess(mid, PCM, REFERENCE)
    assert out["status"] == "quota" and out["assessment_id"] is None
    failed = await XfyunAssessor(FakeXfyun(XfyunError("x")), app.state.sessionmaker, app.state.settings, uid, save=False).assess(mid, PCM, REFERENCE)
    assert failed == {"status": "failed"}


def test_make_assessor_needs_xfyun(app):
    assert make_assessor(app, make_settings(), 1, False) is None
```

  (`Settings` 是可赋值的 pydantic 模型;`resolved_data_dir` 读 `data_dir`,所以改它即可把录音写进 `tmp_path`。)

- [ ] **Step 2: 运行确认失败** —— `cd server && uv run pytest tests/test_realtime_assessor.py -q` → FAIL。

- [ ] **Step 3: 抽出保存逻辑** —— `server/app/assessment_store.py`:

```python
"""保存录音与评测(从 routers/speech.py 抽出,供上传评测与实时通话共用)。"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app import recordings
from app.config import Settings
from app.models import Assessment

SCORE_KEYS = ("pronunciation_score", "accuracy_score", "fluency_score", "completeness_score")


class QuotaExceeded(Exception):
    pass


async def check_quota(session: AsyncSession, settings: Settings, user_id: int, nbytes: int) -> None:
    quota = settings.recording_quota_mb * 1024 * 1024
    if await recordings.used_bytes(session, user_id) + nbytes > quota:
        raise QuotaExceeded()


async def save_assessment(session: AsyncSession, settings: Settings, user_id: int, *, wav_bytes: bytes, duration: float,
                          reference: str, language: str, source: str, result: dict) -> str:
    assessment_id = str(uuid.uuid4())
    relpath = recordings.recording_relpath(user_id, assessment_id)
    data_dir = settings.resolved_data_dir
    recordings.write_recording(data_dir, relpath, wav_bytes)  # OSError 由调用方处理
    session.add(Assessment(
        id=assessment_id, user_id=user_id, reference_text=reference, language=language.strip()[:16],
        duration_ms=round(duration * 1000), audio_bytes=len(wav_bytes),
        scores={key: result.get(key) for key in SCORE_KEYS}, result=result, audio_path=relpath, source=source,
    ))
    try:
        await session.commit()
    except Exception:
        recordings.delete_recording(data_dir, relpath)
        raise
    return assessment_id
```

  `speech.py`:配额判断改为 `try: await check_quota(session, settings, user.id, len(wav_bytes)) except QuotaExceeded: raise HTTPException(413, "Recording storage quota exceeded")`;保存段改为 `try: assessment_id = await save_assessment(session, settings, user.id, wav_bytes=wav_bytes, duration=duration, reference=reference, language=language, source=source_value, result=result) except OSError: raise HTTPException(500, "Could not save the recording")`,其余不变(`SCORE_KEYS` 改为从 `assessment_store` 导入,保持模块里仍可引用)。`recordings.used_bytes` 的参数若是 `user.id` 以外的形式,以现有调用为准。

- [ ] **Step 4: 实现评测器** —— `realtime_providers.py`(替换 Task 4.5 的占位 `make_assessor`):

```python
from app.assessment_store import QuotaExceeded, check_quota, save_assessment
from app.models import User
from app.routers.speech import MAX_REFERENCE_CHARS, TIMEOUT_BASE_SECONDS, TIMEOUT_CAP_SECONDS, _ise_entry, cleanup_orphan_chat_recordings
from app.stt import pcm_to_wav
from app.xfyun import XfyunError, XfyunIse, XfyunNotConfigured
from app.xfyun_result import to_assessment


class XfyunAssessor:
    def __init__(self, xfyun, sessionmaker, settings: Settings, user_id: int, save: bool):
        self._xfyun = xfyun
        self._sm = sessionmaker
        self._settings = settings
        self._user_id = user_id
        self._save = save

    async def assess(self, message_id: str, pcm: bytes, text: str) -> dict:
        reference = text.strip()[:MAX_REFERENCE_CHARS]
        duration = len(pcm) / 32000
        try:
            xml = await self._xfyun.evaluate(pcm, reference, _ise_entry("en"),
                                             timeout=min(TIMEOUT_BASE_SECONDS + duration, TIMEOUT_CAP_SECONDS))
            result = to_assessment(xml, reference)
        except (XfyunError, XfyunNotConfigured, ValueError):
            return {"status": "failed"}
        if not self._save:
            return {"status": "done", "result": result, "assessment_id": None}
        wav = pcm_to_wav(pcm)
        async with self._sm() as session:
            user = await session.get(User, self._user_id)
            await cleanup_orphan_chat_recordings(session, self._settings, user)
            try:
                await check_quota(session, self._settings, self._user_id, len(wav))
            except QuotaExceeded:
                return {"status": "quota", "result": result, "assessment_id": None}
            try:
                assessment_id = await save_assessment(session, self._settings, self._user_id, wav_bytes=wav, duration=duration,
                                                      reference=reference, language="en", source="chat", result=result)
            except OSError:
                return {"status": "done", "result": result, "assessment_id": None}
            message = await session.get(Message, message_id)
            if message is not None and message.assessment_id is None:
                message.assessment_id = assessment_id
                await session.commit()
        return {"status": "done", "result": result, "assessment_id": assessment_id}


def make_assessor(app, settings: Settings, user_id: int, save: bool) -> XfyunAssessor | None:
    xfyun = getattr(app.state, "xfyun", None) or XfyunIse(settings.xfyun_app_id, settings.xfyun_api_key,
                                                         settings.xfyun_api_secret, settings.xfyun_ws_url)
    if not xfyun.configured:
        return None
    return XfyunAssessor(xfyun, app.state.sessionmaker, settings, user_id, save)
```

- [ ] **Step 5: 运行确认通过** —— `cd server && uv run pytest tests/test_realtime_assessor.py tests/test_speech_assessments.py tests/test_assessment_save.py tests/test_assessment_source.py tests/test_chat_orphan_cleanup.py -q` → PASS(既有评测测试不改仍通过,证明抽出无行为变化);全量 → 0 failed。

- [ ] **Step 6: 提交**

```bash
git add server/app/assessment_store.py server/app/routers/speech.py server/app/realtime_providers.py server/tests/test_realtime_assessor.py
git commit -m "feat(server): assess realtime utterances asynchronously and link saved recordings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.7:WebAudio PCM 播放队列

**Files:**
- Create: `web/src/audio/pcm-player.ts`、`web/src/audio/pcm-player.test.ts`

**Interfaces:**
- Consumes:Task 2.1 的 `pcm16ToFloat`、`frameRms`;`web/src/test/fake-audio.ts`。
- Produces:`interface PcmPlayer { play(turnId: number, pcm: Int16Array): void; stop(): void; readonly playing: boolean; onDrained(cb: () => void): () => void; level(): number; close(): void }`;`createPcmPlayer(ctx: AudioContext, opts?: { sampleRate?: number; leadMs?: number }): PcmPlayer`(默认 24000 Hz、`leadMs` 120:空闲后的第一块延后 120 ms 起播作为抖动缓冲,之后首尾相接;`turnId` 小于当前轮的块直接丢弃,大于当前轮时先 `stop()` 旧轮;`stop()` 停止并清空全部已排程的块;最后一块播完触发 `onDrained`;`close()` 之后 `play` 为空操作)。

- [ ] **Step 1: 写失败的测试** —— `web/src/audio/pcm-player.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPcmPlayer } from "./pcm-player";
import { FakeAudioContext, asContext } from "~/test/fake-audio";

const chunk = (n = 2400, v = 8000) => new Int16Array(n).fill(v); // 2400 个采样 @ 24 kHz = 100 ms

describe("createPcmPlayer", () => {
  it("schedules chunks back to back after a jitter lead", () => {
    const ctx = new FakeAudioContext(48000);
    ctx.currentTime = 1;
    const player = createPcmPlayer(asContext(ctx));
    player.play(1, chunk());
    player.play(1, chunk());
    expect(ctx.started.map((s) => Number(s.when.toFixed(3)))).toEqual([1.12, 1.22]);
    expect(player.playing).toBe(true);
    expect(player.level()).toBeGreaterThan(0.2);
  });

  it("drops chunks of an older turn and stops the old turn when a newer one starts", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    player.play(2, chunk());
    const first = ctx.createBufferSource.mock.results[0].value;
    player.play(1, chunk());
    expect(ctx.started).toHaveLength(1);
    player.play(3, chunk());
    expect(first.stop).toHaveBeenCalled();
    expect(ctx.started).toHaveLength(2);
  });

  it("stop clears everything and the next chunk gets a fresh lead", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    player.play(1, chunk());
    player.play(1, chunk());
    player.stop();
    expect(player.playing).toBe(false);
    ctx.currentTime = 5;
    player.play(1, chunk());
    expect(ctx.started.at(-1)!.when).toBeCloseTo(5.12);
  });

  it("reports drained after the last chunk ends, and close makes play a no-op", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    const drained = vi.fn();
    player.onDrained(drained);
    player.play(1, chunk());
    player.play(1, chunk());
    const sources = ctx.createBufferSource.mock.results.map((r) => r.value);
    sources[0].onended();
    expect(drained).not.toHaveBeenCalled();
    sources[1].onended();
    expect(drained).toHaveBeenCalledTimes(1);
    player.close();
    player.play(2, chunk());
    expect(ctx.started).toHaveLength(2);
    expect(ctx.gain.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/audio/pcm-player.test.ts` → FAIL。

- [ ] **Step 3: 实现** —— `web/src/audio/pcm-player.ts`:

```ts
import { frameRms, pcm16ToFloat } from "./pcm";

export interface PcmPlayer {
  play(turnId: number, pcm: Int16Array): void;
  stop(): void;
  readonly playing: boolean;
  onDrained(cb: () => void): () => void;
  level(): number;
  close(): void;
}

/** 实时通话下行音频:按轮次排队,WebAudio 精确排程(设计文档 §5)。 */
export function createPcmPlayer(ctx: AudioContext, opts: { sampleRate?: number; leadMs?: number } = {}): PcmPlayer {
  const rate = opts.sampleRate ?? 24000;
  const lead = (opts.leadMs ?? 120) / 1000;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const sources = new Set<AudioBufferSourceNode>();
  const drained = new Set<() => void>();
  let turn = 0;
  let next = 0;
  let last = 0;
  let closed = false;

  function stop(): void {
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* 尚未开始或已结束 */
      }
    }
    sources.clear();
    next = 0;
  }

  return {
    play(turnId, pcm) {
      if (closed || turnId < turn || !pcm.length) return;
      if (turnId > turn) {
        stop();
        turn = turnId;
      }
      const samples = pcm16ToFloat(pcm);
      const buffer = ctx.createBuffer(1, samples.length, rate);
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      const when = sources.size ? Math.max(next, ctx.currentTime) : ctx.currentTime + lead;
      source.onended = () => {
        sources.delete(source);
        if (!sources.size) drained.forEach((cb) => cb());
      };
      source.start(when);
      next = when + buffer.duration;
      sources.add(source);
      last = frameRms(samples);
    },
    stop,
    get playing() {
      return sources.size > 0;
    },
    onDrained(cb) {
      drained.add(cb);
      return () => drained.delete(cb);
    },
    level: () => (sources.size ? last : 0),
    close() {
      if (closed) return;
      closed = true;
      stop();
      drained.clear();
      try {
        gain.disconnect();
      } catch {
        /* 已断开 */
      }
    },
  };
}
```

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/audio/pcm-player.test.ts` → PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/audio/pcm-player.ts web/src/audio/pcm-player.test.ts
git commit -m "feat(web): add a WebAudio PCM playback queue for realtime calls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.8:网页端协议、接口与文案

**Files:**
- Create: `web/src/features/realtime/protocol.ts`、`web/src/features/realtime/protocol.test.ts`
- Create: `web/src/features/realtime/realtime-api.ts`、`web/src/features/realtime/realtime-api.test.ts`
- Create: `web/src/features/realtime/i18n/en.json`、`web/src/features/realtime/i18n/zh-CN.json`

**Interfaces:**
- Consumes:Task 4.2 的契约(关闭码、事件、音频帧);既有 `ApiClient`、`camelcase-keys`。
- Produces:`CLOSE: { NORMAL: 1000; UNAUTHORIZED: 4001; DISABLED: 4003; NOT_FOUND: 4004; IDLE: 4008; MAX_DURATION: 4009; MESSAGE_LIMIT: 4013; BUSY: 4029; PROTOCOL: 4400; UPSTREAM: 4502 }`;`CLOSE_REASONS: Record<number, string>`(与服务端相同);`closeErrorKey(code: number): string | null`(1000 → `null`;已知码 → `web.realtime.errors.<reason>`;其他(如 1006)→ `web.realtime.errors.generic`);`type RealtimeErrorCode = "asr_failed" | "llm_failed" | "tts_failed" | "rate_limited" | "message_limit"`;`type ServerEvent`(字段 camelCase:`messageId`、`turnId`、`assessmentId`;`assessment.result` 也是深度 camelCase,与 API 客户端一致);`parseServerEvent(text: string): ServerEvent | null`(未知 `type`/非法 JSON → `null`);`splitAudioFrame(data: ArrayBuffer): { turnId: number; pcm: Int16Array } | null`;`interface StartPayload { systemPrompt: string; model: string; temperature: number; voice: string; saveRecordings: boolean }`;`encodeStart(p: StartPayload): string`(snake_case,`language: "en"`);`encodeControl(type: "utterance_end" | "interrupt" | "hangup"): string`;`interface RealtimeConfig { enabled: boolean; maxMinutes: number; idleTimeoutSeconds: number; asrMode: "stream" | "buffered"; sampleRateIn: number; sampleRateOut: number }`;`fetchRealtimeConfig(api, signal?)`;`createRealtimeTicket(api, conversationId: string): Promise<{ ticket: string; expiresIn: number }>`;`realtimeUrl(ticket: string, loc: { protocol: string; host: string }): string`;`REALTIME_SERVER_ERRORS = { "Realtime is not enabled": "web.realtime.errors.disabled" }`。

- [ ] **Step 1: 写失败的测试** —— `web/src/features/realtime/protocol.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOSE, CLOSE_REASONS, closeErrorKey, encodeControl, encodeStart, parseServerEvent, splitAudioFrame } from "./protocol";

describe("contract with server/app/realtime_protocol.py", () => {
  it("has exactly the server's close codes", () => {
    const py = readFileSync(fileURLToPath(new URL("../../../../server/app/realtime_protocol.py", import.meta.url)), "utf8");
    const server = Object.fromEntries([...py.matchAll(/^CLOSE_([A-Z_]+) = (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
    expect(CLOSE).toEqual(server);
    expect(CLOSE_REASONS).toEqual({
      1000: "normal", 4001: "unauthorized", 4003: "disabled", 4004: "not_found", 4008: "idle_timeout",
      4009: "max_duration", 4013: "message_limit", 4029: "busy", 4400: "protocol", 4502: "upstream",
    });
  });

  it("maps close codes to translatable keys", () => {
    expect(closeErrorKey(1000)).toBeNull();
    expect(closeErrorKey(4008)).toBe("web.realtime.errors.idle_timeout");
    expect(closeErrorKey(1006)).toBe("web.realtime.errors.generic");
  });
});

describe("messages", () => {
  it("encodes start in snake_case and control messages", () => {
    expect(JSON.parse(encodeStart({ systemPrompt: "Hi", model: "m", temperature: 0.5, voice: "v_1x", saveRecordings: true }))).toEqual({
      type: "start", system_prompt: "Hi", model: "m", temperature: 0.5, voice: "v_1x", language: "en", save_recordings: true,
    });
    expect(encodeControl("interrupt")).toBe('{"type":"interrupt"}');
  });

  it("parses server events into camelCase and rejects unknown ones", () => {
    expect(parseServerEvent('{"type":"transcript_final","text":"hi","message_id":"m1"}')).toEqual({ type: "transcript_final", text: "hi", messageId: "m1" });
    expect(parseServerEvent('{"type":"reply_done","turn_id":2,"message_id":null,"interrupted":true}')).toEqual({ type: "reply_done", turnId: 2, messageId: null, interrupted: true });
    expect(parseServerEvent('{"type":"assessment","message_id":"m1","status":"done","result":{"pronunciation_score":81}}'))
      .toMatchObject({ result: { pronunciationScore: 81 } });
    expect(parseServerEvent('{"type":"party"}')).toBeNull();
    expect(parseServerEvent("nope")).toBeNull();
  });

  it("splits binary audio frames", () => {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, 7);
    view.setInt16(4, 1000, true);
    view.setInt16(6, -1000, true);
    const frame = splitAudioFrame(buf)!;
    expect(frame.turnId).toBe(7);
    expect(Array.from(frame.pcm)).toEqual([1000, -1000]);
    expect(splitAudioFrame(new ArrayBuffer(3))).toBeNull();
    expect(splitAudioFrame(new ArrayBuffer(7))).toBeNull();
  });
});
```

  `web/src/features/realtime/realtime-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { createRealtimeTicket, fetchRealtimeConfig, realtimeUrl } from "./realtime-api";

describe("realtime api", () => {
  it("reads the config and requests a ticket in snake_case", async () => {
    const mock = createFetchMock({
      "GET /api/realtime/config": () => json({ enabled: true, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
      "POST /api/realtime/ticket": () => json({ ticket: "abc", expires_in: 60 }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await fetchRealtimeConfig(api)).toEqual({ enabled: true, maxMinutes: 10, idleTimeoutSeconds: 60, asrMode: "buffered", sampleRateIn: 16000, sampleRateOut: 24000 });
    expect(await createRealtimeTicket(api, "c1")).toEqual({ ticket: "abc", expiresIn: 60 });
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ conversation_id: "c1" });
  });

  it("builds ws and wss urls without leaking the login token", () => {
    expect(realtimeUrl("a+b", { protocol: "https:", host: "x.test" })).toBe("wss://x.test/api/realtime?ticket=a%2Bb");
    expect(realtimeUrl("t", { protocol: "http:", host: "127.0.0.1:5173" })).toBe("ws://127.0.0.1:5173/api/realtime?ticket=t");
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/realtime` → FAIL。

- [ ] **Step 3: 实现** —— `web/src/features/realtime/protocol.ts`:

```ts
import camelcaseKeys from "camelcase-keys";

/** 与 server/app/realtime_protocol.py 逐字对应(protocol.test.ts 直接读取服务端文件核对)。 */
export const CLOSE = {
  NORMAL: 1000, UNAUTHORIZED: 4001, DISABLED: 4003, NOT_FOUND: 4004, IDLE: 4008,
  MAX_DURATION: 4009, MESSAGE_LIMIT: 4013, BUSY: 4029, PROTOCOL: 4400, UPSTREAM: 4502,
} as const;

export const CLOSE_REASONS: Record<number, string> = {
  1000: "normal", 4001: "unauthorized", 4003: "disabled", 4004: "not_found", 4008: "idle_timeout",
  4009: "max_duration", 4013: "message_limit", 4029: "busy", 4400: "protocol", 4502: "upstream",
};

export function closeErrorKey(code: number): string | null {
  if (code === CLOSE.NORMAL) return null;
  return `web.realtime.errors.${CLOSE_REASONS[code] ?? "generic"}`;
}

export type RealtimeErrorCode = "asr_failed" | "llm_failed" | "tts_failed" | "rate_limited" | "message_limit";
export type ServerEvent =
  | { type: "ready"; asr: "stream" | "buffered" }
  | { type: "state"; state: "listening" | "thinking" | "speaking" }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string; messageId: string | null }
  | { type: "reply_delta"; turnId: number; text: string }
  | { type: "reply_done"; turnId: number; messageId: string | null; interrupted: boolean }
  | { type: "assessment"; messageId: string; status: "done" | "failed" | "quota"; result?: Record<string, unknown>; assessmentId?: string | null }
  | { type: "degraded"; reason: "asr" }
  | { type: "error"; code: RealtimeErrorCode };

const TYPES = new Set(["ready", "state", "transcript_partial", "transcript_final", "reply_delta", "reply_done", "assessment", "degraded", "error"]);

export function parseServerEvent(text: string): ServerEvent | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || !TYPES.has((raw as { type?: string }).type ?? "")) return null;
    return camelcaseKeys(raw as Record<string, unknown>, { deep: true }) as unknown as ServerEvent;
  } catch {
    return null;
  }
}

export function splitAudioFrame(data: ArrayBuffer): { turnId: number; pcm: Int16Array } | null {
  if (data.byteLength < 4 || (data.byteLength - 4) % 2) return null;
  return { turnId: new DataView(data).getUint32(0), pcm: new Int16Array(data.slice(4)) };
}

export interface StartPayload {
  systemPrompt: string;
  model: string;
  temperature: number;
  voice: string;
  saveRecordings: boolean;
}

export function encodeStart(p: StartPayload): string {
  return JSON.stringify({
    type: "start", system_prompt: p.systemPrompt, model: p.model, temperature: p.temperature, voice: p.voice,
    language: "en", save_recordings: p.saveRecordings,
  });
}

export const encodeControl = (type: "utterance_end" | "interrupt" | "hangup") => JSON.stringify({ type });
```

  `web/src/features/realtime/realtime-api.ts`:

```ts
import type { ApiClient } from "~/api/client";

export interface RealtimeConfig {
  enabled: boolean;
  maxMinutes: number;
  idleTimeoutSeconds: number;
  asrMode: "stream" | "buffered";
  sampleRateIn: number;
  sampleRateOut: number;
}

export const REALTIME_SERVER_ERRORS: Record<string, string> = {
  "Realtime is not enabled": "web.realtime.errors.disabled",
};

export function fetchRealtimeConfig(api: ApiClient, signal?: AbortSignal): Promise<RealtimeConfig> {
  return api.request("GET", "/api/realtime/config", { signal });
}

export function createRealtimeTicket(api: ApiClient, conversationId: string): Promise<{ ticket: string; expiresIn: number }> {
  return api.request("POST", "/api/realtime/ticket", { json: { conversationId } });
}

/** 一次性票据放在查询串里(60 s、只能用一次);登录令牌从不进 URL(设计文档 §3.5)。 */
export function realtimeUrl(ticket: string, loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/realtime?ticket=${encodeURIComponent(ticket)}`;
}
```

  i18n(`web.realtime.*`,两种语言键集一致):

  | 键 | en | zh-CN |
  |---|---|---|
  | `start` | Start a voice call | 开始实时通话 |
  | `title` | Voice call | 实时通话 |
  | `status.connecting` | Connecting… | 正在连接… |
  | `status.listening` | Listening | 聆听中 |
  | `status.thinking` | Thinking | 思考中 |
  | `status.speaking` | Speaking | 说话中 |
  | `status.ended` | Call ended | 通话已结束 |
  | `hangup` | Hang up | 挂断 |
  | `mute` | Mute microphone | 静音 |
  | `unmute` | Unmute microphone | 取消静音 |
  | `pushToTalk` | Push-to-talk mode (for noisy places) | 按住说话模式(适合嘈杂环境) |
  | `holdToSpeak` | Hold to speak | 按住说话 |
  | `micInUse` | Microphone in use | 麦克风使用中 |
  | `degraded` | The network or service is slow | 网络/服务较慢 |
  | `vadUnavailable` | Voice detection is unavailable; switched to push-to-talk | 语音检测不可用,已切换为按住说话 |
  | `noSpeech` | Didn't catch that | 没听清 |
  | `endedInBackground` | The call ended because the app went to the background | 通话因切到后台已结束 |
  | `interrupted` | (interrupted) | (已打断) |
  | `close` | Close | 关闭 |
  | `errors.unauthorized` | The call link expired. Please try again. | 通话凭证已失效,请重试 |
  | `errors.disabled` | Voice calls are not enabled on this server | 服务器未开启实时通话 |
  | `errors.not_found` | This conversation no longer exists | 这个会话已不存在 |
  | `errors.idle_timeout` | Hung up after a long silence | 长时间没有说话,已自动挂断 |
  | `errors.max_duration` | The call reached its time limit | 已达到单次通话时长上限 |
  | `errors.message_limit` | This conversation is full | 这个会话的消息已满 |
  | `errors.busy` | Another call is already in progress | 已有一路通话在进行 |
  | `errors.protocol` | The call was interrupted by an error | 通话出错中断 |
  | `errors.upstream` | Speech recognition is unavailable | 语音识别服务不可用 |
  | `errors.generic` | The call was disconnected | 通话已断开 |
  | `errors.asr_failed` | Didn't catch that – please say it again | 没听清,请再说一遍 |
  | `errors.llm_failed` | The reply failed – please try again | 回复失败,请再说一次 |
  | `errors.tts_failed` | The voice reply failed; showing text only | 语音合成失败,只显示文字 |
  | `errors.rate_limited` | Too many requests – wait a moment | 请求过于频繁,请稍候 |
  | `errors.micLost` | The microphone stopped | 麦克风已中断 |
  | `errors.unsupported` | This browser cannot make voice calls | 当前浏览器不支持实时通话 |

  (`i18n/index.ts` 的 `import.meta.glob("../**/i18n/*.json")` 会自动收进新目录。)

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/features/realtime src/i18n` → PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/realtime/protocol.ts web/src/features/realtime/protocol.test.ts web/src/features/realtime/realtime-api.ts web/src/features/realtime/realtime-api.test.ts web/src/features/realtime/i18n/en.json web/src/features/realtime/i18n/zh-CN.json
git commit -m "feat(web): add the realtime protocol, ticket API and texts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.9:通话状态 reducer、`RealtimeCall` 运行时与 `useRealtimeCall`

**Files:**
- Create: `web/src/features/realtime/call-machine.ts`、`web/src/features/realtime/call-machine.test.ts`
- Create: `web/src/features/realtime/realtime-call.ts`、`web/src/features/realtime/realtime-call.test.ts`
- Create: `web/src/features/realtime/use-realtime-call.ts`、`web/src/features/realtime/use-realtime-call.test.tsx`

**Interfaces:**
- Consumes:Task 2.1 的 `startPcmCapture`、`floatToPcm16`、`CaptureEnv`;Task 2.3 的 `createVad`、`VadHandle`;Task 4.7 的 `createPcmPlayer`;Task 4.8 的全部。
- Produces(`call-machine.ts`,纯):`type CallPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended"`;`interface Caption { key: string; role: "user" | "assistant"; text: string; messageId?: string | null; turnId?: number; interrupted?: boolean; score?: number | null }`;`interface CallModel { phase: CallPhase; captions: Caption[]; partial: string; muted: boolean; pushToTalk: boolean; degraded: boolean; notice: string | null; error: string | null }`;`INITIAL_CALL`;`MAX_CAPTIONS = 50`;`type CallAction = { type: "connect" } | { type: "event"; event: ServerEvent } | { type: "closed"; code: number } | { type: "fail"; errorKey: string } | { type: "mute"; muted: boolean } | { type: "ptt"; on: boolean } | { type: "notice"; key: string | null } | { type: "local-interrupt" }`;`callReducer(m: CallModel, a: CallAction): CallModel`。
- Produces(`realtime-call.ts`):`PRE_ROLL_MS = 300`;`interface RealtimeEnv { WebSocket: new (url: string) => WebSocket; capture: CaptureEnv; createVad: typeof createVad; location: { protocol: string; host: string } }`;`browserRealtimeEnv(): RealtimeEnv`;`interface RealtimeCallOptions { api: ApiClient; conversationId: string; context: AudioContext; start: StartPayload; sampleRateOut: number; env?: RealtimeEnv; onChange(model: CallModel): void; onUserMessage?(messageId: string, text: string): void }`;`class RealtimeCall`:`model`、`start(): Promise<void>`、`hangup(): void`、`end(errorKey: string): void`、`setMuted(m: boolean): void`、`setPushToTalk(on: boolean): void`、`pttDown(): void`、`pttUp(): void`、`level(): number`。**释放契约**:`hangup`/服务端关闭/连接错误/票据失败/麦克风失败/轨道中断/`end()`(切后台)/卸载——每一条路径都恰好一次地:关闭 WebSocket(仍打开时以 1000 关闭)、`capture.release()`、`vad.destroy()`、`player.close()`、`context.close()`(上下文由页面在点击里创建、所有权交给本对象)。
- Produces(`use-realtime-call.ts`):`useRealtimeCall(o: Omit<RealtimeCallOptions, "onChange">): { model: CallModel; call: RealtimeCall | null }`(挂载后用 `setTimeout(0)` 启动,StrictMode 的第一次挂载/卸载不会启动、也不会关闭上下文;卸载时 `hangup()`;页面变为 `hidden` → `end("web.realtime.endedInBackground")`)。

- [ ] **Step 1: 写 reducer 的失败测试** —— `web/src/features/realtime/call-machine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INITIAL_CALL, MAX_CAPTIONS, callReducer, type CallAction, type CallModel } from "./call-machine";
import type { ServerEvent } from "./protocol";

const run = (actions: CallAction[], from: CallModel = INITIAL_CALL) => actions.reduce(callReducer, from);
const ev = (event: ServerEvent): CallAction => ({ type: "event", event });

describe("callReducer", () => {
  it("follows the server's phases", () => {
    const m = run([{ type: "connect" }, ev({ type: "ready", asr: "buffered" }), ev({ type: "state", state: "thinking" })]);
    expect(m.phase).toBe("thinking");
  });

  it("builds captions from transcripts and streamed replies", () => {
    const m = run([
      ev({ type: "transcript_partial", text: "hel" }),
      ev({ type: "transcript_final", text: "hello", messageId: "m1" }),
      ev({ type: "reply_delta", turnId: 1, text: "Hi " }),
      ev({ type: "reply_delta", turnId: 1, text: "there." }),
      ev({ type: "reply_done", turnId: 1, messageId: "m2", interrupted: false }),
      ev({ type: "assessment", messageId: "m1", status: "done", result: { pronunciationScore: 81.6 } }),
    ]);
    expect(m.partial).toBe("");
    expect(m.captions).toEqual([
      { key: "u-m1", role: "user", text: "hello", messageId: "m1", score: 82 },
      { key: "a-1", role: "assistant", text: "Hi there.", turnId: 1, messageId: "m2", interrupted: false },
    ]);
  });

  it("marks interruptions locally and from the server", () => {
    const local = run([ev({ type: "reply_delta", turnId: 1, text: "One." }), ev({ type: "state", state: "speaking" }), { type: "local-interrupt" }]);
    expect(local.captions[0].interrupted).toBe(true);
    expect(local.phase).toBe("listening");
  });

  it("empty transcripts and errors become notices; degraded is sticky", () => {
    let m = run([ev({ type: "transcript_final", text: "", messageId: null })]);
    expect(m.notice).toBe("web.realtime.noSpeech");
    m = run([ev({ type: "error", code: "tts_failed" }), ev({ type: "degraded", reason: "asr" })]);
    expect(m.notice).toBe("web.realtime.errors.tts_failed");
    expect(m.degraded).toBe(true);
  });

  it("ends with a translated close reason and ignores events afterwards", () => {
    const m = run([{ type: "closed", code: 4008 }, ev({ type: "state", state: "speaking" })]);
    expect(m.phase).toBe("ended");
    expect(m.error).toBe("web.realtime.errors.idle_timeout");
    expect(run([{ type: "closed", code: 1000 }]).error).toBeNull();
    expect(run([{ type: "fail", errorKey: "web.realtime.errors.micLost" }]).error).toBe("web.realtime.errors.micLost");
  });

  it("keeps at most 50 captions", () => {
    const actions = Array.from({ length: 60 }, (_, i) => ev({ type: "transcript_final", text: `t${i}`, messageId: `m${i}` }));
    const m = run(actions);
    expect(m.captions).toHaveLength(MAX_CAPTIONS);
    expect(m.captions[0].text).toBe("t10");
  });
});
```

- [ ] **Step 2: 写运行时的失败测试** —— `web/src/features/realtime/realtime-call.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { FakeAudioContext, FakeWorkletNode, asContext, fakeStream } from "~/test/fake-audio";
import type { VadCallbacks, VadHandle } from "~/audio/vad";
import { RealtimeCall, type RealtimeEnv } from "./realtime-call";
import type { CallModel } from "./call-machine";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  onopen: null | (() => void) = null;
  onmessage: null | ((e: { data: string | ArrayBuffer }) => void) = null;
  onclose: null | ((e: { code: number }) => void) = null;
  onerror: null | (() => void) = null;
  close = vi.fn((code?: number) => { this.readyState = 3; void code; });
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  open() { this.readyState = 1; this.onopen?.(); }
  server(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
  serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
  texts() { return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s)); }
  binaries() { return this.sent.filter((s) => typeof s !== "string"); }
}

function setup(over: { ticket?: () => Response; gum?: () => Promise<MediaStream>; vadFails?: boolean } = {}) {
  FakeWebSocket.instances = [];
  const ctx = new FakeAudioContext(16000);
  const node = new FakeWorkletNode();
  const stream = fakeStream();
  let vadCallbacks!: VadCallbacks;
  const vad: VadHandle & { destroy: ReturnType<typeof vi.fn>; setSensitivity: ReturnType<typeof vi.fn> } = {
    start: vi.fn(), pause: vi.fn(), setSensitivity: vi.fn(), destroy: vi.fn(async () => undefined),
  };
  const env: RealtimeEnv = {
    WebSocket: FakeWebSocket as unknown as RealtimeEnv["WebSocket"],
    capture: {
      isSecureContext: true, getUserMedia: over.gum ?? (async () => stream), supportedConstraints: () => ({}),
      createAudioContext: () => asContext(ctx), createWorkletNode: () => node as unknown as AudioWorkletNode, workletUrl: "/w.js",
    },
    createVad: vi.fn(async (_s: MediaStream, cb: VadCallbacks) => {
      if (over.vadFails) throw new Error("no wasm");
      vadCallbacks = cb;
      return vad;
    }),
    location: { protocol: "https:", host: "app.test" },
  };
  const mock = createFetchMock({ "POST /api/realtime/ticket": over.ticket ?? (() => json({ ticket: "tk", expires_in: 60 })) });
  const changes: CallModel[] = [];
  const onUserMessage = vi.fn();
  const call = new RealtimeCall({
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), conversationId: "c1", context: asContext(ctx),
    start: { systemPrompt: "Be kind.", model: "m", temperature: 0.7, voice: "voice_1", saveRecordings: true },
    sampleRateOut: 24000, env, onChange: (m) => changes.push(m), onUserMessage,
  });
  const ws = () => FakeWebSocket.instances[0];
  const speech = (n = 1) => { for (let i = 0; i < n; i++) node.emit(new Float32Array(1600).fill(0.2)); };
  return { call, ctx, node, stream, vad, env, ws, speech, changes, onUserMessage, vadCb: () => vadCallbacks };
}

const expectReleasedOnce = (s: ReturnType<typeof setup>) => {
  expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
  expect(s.ctx.close).toHaveBeenCalledTimes(1);
  expect(s.vad.destroy).toHaveBeenCalledTimes(1);
};

beforeEach(() => vi.restoreAllMocks());

describe("RealtimeCall", () => {
  it("connects with a ticket and sends start on open", async () => {
    const s = setup();
    await s.call.start();
    expect(s.ws().url).toBe("wss://app.test/api/realtime?ticket=tk");
    expect(s.ws().binaryType).toBe("arraybuffer");
    s.ws().open();
    expect(s.ws().texts()[0]).toMatchObject({ type: "start", system_prompt: "Be kind.", voice: "voice_1", save_recordings: true });
  });

  it("streams speech with a pre-roll and ends the utterance", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "ready", asr: "buffered" });
    s.speech(3); // 说话前的 300 ms(3 帧 × 100 ms)作为预录
    expect(s.ws().binaries()).toHaveLength(0);
    s.vadCb().onSpeechStart();
    expect(s.ws().binaries()).toHaveLength(3);
    s.speech(2);
    expect(s.ws().binaries()).toHaveLength(5);
    s.vadCb().onSpeechEnd(500);
    expect(s.ws().texts().at(-1)).toEqual({ type: "utterance_end" });
    s.speech(1);
    expect(s.ws().binaries()).toHaveLength(5); // 不说话时不上传
  });

  it("plays downlink audio, raises VAD thresholds while the bot speaks and reports user messages", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "transcript_final", text: "hello", message_id: "m1" });
    expect(s.onUserMessage).toHaveBeenCalledWith("m1", "hello");
    s.ws().server({ type: "state", state: "speaking" });
    expect(s.vad.setSensitivity).toHaveBeenLastCalledWith("bot-speaking");
    const frame = new ArrayBuffer(4 + 4800);
    new DataView(frame).setUint32(0, 1);
    s.ws().onmessage?.({ data: frame });
    expect(s.ctx.started).toHaveLength(1);
    s.ws().server({ type: "state", state: "listening" });
    expect(s.vad.setSensitivity).toHaveBeenLastCalledWith("normal");
  });

  it("barge-in: speaking over the bot stops playback and sends interrupt", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "state", state: "speaking" });
    const frame = new ArrayBuffer(4 + 4800);
    new DataView(frame).setUint32(0, 1);
    s.ws().onmessage?.({ data: frame });
    const source = s.ctx.createBufferSource.mock.results[0].value;
    s.vadCb().onSpeechStart();
    expect(source.stop).toHaveBeenCalled();
    expect(s.ws().texts()).toContainEqual({ type: "interrupt" });
    expect(s.changes.at(-1)!.phase).toBe("listening");
  });

  it("muted: nothing is uploaded", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.call.setMuted(true);
    s.vadCb().onSpeechStart();
    s.speech(2);
    expect(s.ws().binaries()).toHaveLength(0);
  });

  it("falls back to push-to-talk when the VAD cannot load", async () => {
    const s = setup({ vadFails: true });
    await s.call.start();
    s.ws().open();
    expect(s.changes.at(-1)!.pushToTalk).toBe(true);
    expect(s.changes.at(-1)!.notice).toBe("web.realtime.vadUnavailable");
    s.call.pttDown();
    s.speech(1);
    s.call.pttUp();
    expect(s.ws().binaries()).toHaveLength(1);
    expect(s.ws().texts().at(-1)).toEqual({ type: "utterance_end" });
  });

  describe("every exit path releases the microphone, VAD and audio context exactly once", () => {
    it("hang up", async () => {
      const s = setup();
      await s.call.start();
      s.ws().open();
      s.call.hangup();
      expect(s.ws().texts().at(-1)).toEqual({ type: "hangup" });
      expect(s.ws().close).toHaveBeenCalledWith(1000);
      s.ws().serverClose(1000); // 关闭事件随后到达:不得重复释放
      s.call.hangup();
      expectReleasedOnce(s);
      expect(s.changes.at(-1)!.phase).toBe("ended");
    });

    it("server closes with a reason", async () => {
      const s = setup();
      await s.call.start();
      s.ws().open();
      s.ws().serverClose(4008);
      expectReleasedOnce(s);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.idle_timeout");
    });

    it("abnormal disconnect", async () => {
      const s = setup();
      await s.call.start();
      s.ws().onerror?.();
      s.ws().serverClose(1006);
      expectReleasedOnce(s);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.generic");
    });

    it("ticket refused: no microphone, no socket, context closed", async () => {
      const s = setup({ ticket: () => json({ error: "Realtime is not enabled" }, 503) });
      await s.call.start();
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.stream.track.stop).not.toHaveBeenCalled();
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.disabled");
    });

    it("microphone denied", async () => {
      const s = setup({ gum: async () => { throw new DOMException("no", "NotAllowedError"); } });
      await s.call.start();
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.changes.at(-1)!.phase).toBe("ended");
    });

    it("microphone track ends", async () => {
      const s = setup();
      await s.call.start();
      s.ws().open();
      s.stream.track.dispatchEvent(new Event("ended"));
      expectReleasedOnce(s);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.micLost");
    });

    it("ended by the page (background) before the socket opened", async () => {
      const s = setup();
      const starting = s.call.start();
      s.call.end("web.realtime.endedInBackground");
      await starting;
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.stream.track.stop.mock.calls.length).toBeLessThanOrEqual(1);
      expect(FakeWebSocket.instances.every((w) => w.close.mock.calls.length <= 1)).toBe(true);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.endedInBackground");
    });
  });
});
```

  `web/src/features/realtime/use-realtime-call.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { FakeAudioContext, asContext } from "~/test/fake-audio";
import { useRealtimeCall } from "./use-realtime-call";
import type { RealtimeEnv } from "./realtime-call";

describe("useRealtimeCall", () => {
  it("StrictMode starts exactly one call and unmount releases the context", async () => {
    vi.useFakeTimers();
    try {
      const mock = createFetchMock({ "POST /api/realtime/ticket": () => json({ error: "Realtime is not enabled" }, 503) });
      const ctx = new FakeAudioContext();
      const env = { WebSocket: vi.fn(), capture: {} as RealtimeEnv["capture"], createVad: vi.fn(), location: { protocol: "http:", host: "x" } } as unknown as RealtimeEnv;
      const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
      const { unmount } = renderHook(() => useRealtimeCall({
        api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), conversationId: "c1", context: asContext(ctx),
        start: { systemPrompt: "", model: "", temperature: 0.7, voice: "v_1x", saveRecordings: true }, sampleRateOut: 24000, env,
      }), { wrapper });
      await act(async () => { vi.runAllTimers(); });
      expect(mock.calls.filter((c) => c.url.pathname === "/api/realtime/ticket")).toHaveLength(1);
      unmount();
      expect(ctx.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 3: 运行确认失败** —— `yarn workspace web test src/features/realtime` → 新文件 FAIL(模块不存在)。

- [ ] **Step 4: 实现 reducer** —— `web/src/features/realtime/call-machine.ts`:

```ts
import { closeErrorKey, type ServerEvent } from "./protocol";

export type CallPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";
export interface Caption {
  key: string;
  role: "user" | "assistant";
  text: string;
  messageId?: string | null;
  turnId?: number;
  interrupted?: boolean;
  score?: number | null;
}
export interface CallModel {
  phase: CallPhase;
  captions: Caption[];
  partial: string;
  muted: boolean;
  pushToTalk: boolean;
  degraded: boolean;
  notice: string | null;
  error: string | null;
}
export type CallAction =
  | { type: "connect" }
  | { type: "event"; event: ServerEvent }
  | { type: "closed"; code: number }
  | { type: "fail"; errorKey: string }
  | { type: "mute"; muted: boolean }
  | { type: "ptt"; on: boolean }
  | { type: "notice"; key: string | null }
  | { type: "local-interrupt" };

export const MAX_CAPTIONS = 50;
export const INITIAL_CALL: CallModel = {
  phase: "idle", captions: [], partial: "", muted: false, pushToTalk: false, degraded: false, notice: null, error: null,
};

const cap = (captions: Caption[]) => captions.slice(-MAX_CAPTIONS);

function onEvent(m: CallModel, e: ServerEvent): CallModel {
  switch (e.type) {
    case "ready":
      return { ...m, phase: "listening" };
    case "state":
      return { ...m, phase: e.state };
    case "transcript_partial":
      return { ...m, partial: e.text };
    case "transcript_final":
      if (!e.text) return { ...m, partial: "", notice: "web.realtime.noSpeech" };
      return { ...m, partial: "", notice: null, captions: cap([...m.captions, { key: `u-${e.messageId ?? m.captions.length}`, role: "user", text: e.text, messageId: e.messageId }]) };
    case "reply_delta": {
      const i = m.captions.findIndex((c) => c.role === "assistant" && c.turnId === e.turnId);
      if (i < 0) return { ...m, captions: cap([...m.captions, { key: `a-${e.turnId}`, role: "assistant", text: e.text, turnId: e.turnId }]) };
      const captions = m.captions.slice();
      captions[i] = { ...captions[i], text: captions[i].text + e.text };
      return { ...m, captions };
    }
    case "reply_done":
      return { ...m, captions: m.captions.map((c) => (c.role === "assistant" && c.turnId === e.turnId ? { ...c, messageId: e.messageId, interrupted: e.interrupted } : c)) };
    case "assessment": {
      const raw = e.status === "done" ? Number((e.result as { pronunciationScore?: unknown } | undefined)?.pronunciationScore) : NaN;
      const score = Number.isFinite(raw) ? Math.round(raw) : null;
      return { ...m, captions: m.captions.map((c) => (c.role === "user" && c.messageId === e.messageId ? { ...c, score } : c)) };
    }
    case "degraded":
      return { ...m, degraded: true };
    case "error":
      return { ...m, notice: `web.realtime.errors.${e.code}` };
  }
}

export function callReducer(m: CallModel, a: CallAction): CallModel {
  if (m.phase === "ended" && a.type !== "notice") return m;
  switch (a.type) {
    case "connect":
      return { ...m, phase: "connecting", error: null };
    case "event":
      return onEvent(m, a.event);
    case "closed":
      return { ...m, phase: "ended", error: closeErrorKey(a.code) };
    case "fail":
      return { ...m, phase: "ended", error: a.errorKey };
    case "mute":
      return { ...m, muted: a.muted };
    case "ptt":
      return { ...m, pushToTalk: a.on };
    case "notice":
      return { ...m, notice: a.key };
    case "local-interrupt": {
      let last = -1;
      m.captions.forEach((c, i) => { if (c.role === "assistant") last = i; });
      const captions = last < 0 ? m.captions : m.captions.map((c, i) => (i === last ? { ...c, interrupted: true } : c));
      return { ...m, captions, phase: "listening" };
    }
  }
}
```

  (`reply_done` 用例里期望的 `interrupted: false` 字段来自这条事件;`{ key: "a-1", …, turnId: 1, messageId: "m2", interrupted: false }` 与实现一致。)

- [ ] **Step 5: 实现运行时** —— `web/src/features/realtime/realtime-call.ts`:

```ts
import type { ApiClient } from "~/api/client";
import { translateServerKey } from "./errors";
import { browserCaptureEnv, startPcmCapture, type CaptureEnv, type PcmCapture } from "~/audio/capture";
import { floatToPcm16 } from "~/audio/pcm";
import { createPcmPlayer, type PcmPlayer } from "~/audio/pcm-player";
import { RecorderError } from "~/audio/recorder";
import { createVad, type VadHandle } from "~/audio/vad";
import { INITIAL_CALL, callReducer, type CallAction, type CallModel } from "./call-machine";
import { encodeControl, encodeStart, parseServerEvent, splitAudioFrame, type StartPayload } from "./protocol";
import { createRealtimeTicket, realtimeUrl } from "./realtime-api";

export const PRE_ROLL_MS = 300;

export interface RealtimeEnv {
  WebSocket: new (url: string) => WebSocket;
  capture: CaptureEnv;
  createVad: typeof createVad;
  location: { protocol: string; host: string };
}

export const browserRealtimeEnv = (): RealtimeEnv => ({
  WebSocket, capture: browserCaptureEnv(), createVad, location: window.location,
});

export interface RealtimeCallOptions {
  api: ApiClient;
  conversationId: string;
  context: AudioContext;
  start: StartPayload;
  sampleRateOut: number;
  env?: RealtimeEnv;
  onChange(model: CallModel): void;
  onUserMessage?(messageId: string, text: string): void;
}

export class RealtimeCall {
  model: CallModel = INITIAL_CALL;
  private readonly env: RealtimeEnv;
  private ws: WebSocket | null = null;
  private capture: PcmCapture | null = null;
  private vad: VadHandle | null = null;
  private player: PcmPlayer | null = null;
  private torn = false;
  private speaking = false;
  private pttHeld = false;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;

  constructor(private readonly o: RealtimeCallOptions) {
    this.env = o.env ?? browserRealtimeEnv();
  }

  private dispatch(action: CallAction): void {
    this.model = callReducer(this.model, action);
    this.o.onChange(this.model);
  }

  private open(): boolean {
    return !!this.ws && this.ws.readyState === 1;
  }

  private sendText(text: string): void {
    if (this.open()) this.ws!.send(text);
  }

  private sendFrame(frame: Float32Array): void {
    if (this.open()) this.ws!.send(floatToPcm16(frame).buffer as ArrayBuffer);
  }

  async start(): Promise<void> {
    if (this.torn) return;
    this.dispatch({ type: "connect" });
    try {
      const { ticket } = await createRealtimeTicket(this.o.api, this.o.conversationId);
      if (this.torn) return;
      this.player = createPcmPlayer(this.o.context, { sampleRate: this.o.sampleRateOut });
      const capture = await startPcmCapture({ env: this.env.capture, context: this.o.context });
      if (this.torn) return capture.release();
      this.capture = capture;
      capture.onFrame((frame) => this.onFrame(frame));
      capture.onTrackEnded(() => this.end("web.realtime.errors.micLost"));
      try {
        this.vad = await this.env.createVad(capture.stream, {
          onSpeechStart: () => { if (!this.model.pushToTalk) this.beginUtterance(); },
          onSpeechEnd: () => { if (!this.model.pushToTalk) this.endUtterance(); },
        });
        if (this.torn) return void this.vad.destroy();
        this.vad.start();
      } catch {
        this.dispatch({ type: "ptt", on: true });
        this.dispatch({ type: "notice", key: "web.realtime.vadUnavailable" });
      }
      if (this.torn) return;
      const ws = new this.env.WebSocket(realtimeUrl(ticket, this.env.location));
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => ws.send(encodeStart(this.o.start));
      ws.onmessage = (event: MessageEvent | { data: string | ArrayBuffer }) => {
        if (typeof event.data === "string") this.onEvent(event.data);
        else this.onAudio(event.data as ArrayBuffer);
      };
      ws.onerror = () => undefined; // 随后一定有 close 事件
      ws.onclose = (event: CloseEvent | { code: number }) => this.finish({ type: "closed", code: event.code });
    } catch (err) {
      this.finish({ type: "fail", errorKey: errorKeyFor(err) });
    }
  }

  private onEvent(text: string): void {
    const event = parseServerEvent(text);
    if (!event) return;
    this.dispatch({ type: "event", event });
    if (event.type === "state") this.vad?.setSensitivity(event.state === "speaking" ? "bot-speaking" : "normal");
    if (event.type === "transcript_final" && event.text && event.messageId) this.o.onUserMessage?.(event.messageId, event.text);
  }

  private onAudio(data: ArrayBuffer): void {
    const frame = splitAudioFrame(data);
    if (frame) this.player?.play(frame.turnId, frame.pcm);
  }

  private onFrame(frame: Float32Array): void {
    if (this.model.muted) return;
    if (this.speaking || this.pttHeld) {
      this.sendFrame(frame);
      return;
    }
    this.preRoll.push(frame);
    this.preRollSamples += frame.length;
    while (this.preRoll.length > 1 && this.preRollSamples - this.preRoll[0].length >= (16000 * PRE_ROLL_MS) / 1000) {
      this.preRollSamples -= this.preRoll.shift()!.length;
    }
  }

  private beginUtterance(): void {
    if (this.model.muted || this.speaking) return;
    if (this.player?.playing || this.model.phase === "speaking" || this.model.phase === "thinking") {
      this.player?.stop();
      this.sendText(encodeControl("interrupt"));
      this.dispatch({ type: "local-interrupt" });
    }
    this.speaking = true;
    for (const frame of this.preRoll) this.sendFrame(frame);
    this.preRoll = [];
    this.preRollSamples = 0;
  }

  private endUtterance(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.sendText(encodeControl("utterance_end"));
  }

  setMuted(muted: boolean): void {
    if (muted) {
      this.endUtterance();
      this.pttHeld = false;
    }
    this.dispatch({ type: "mute", muted });
  }

  setPushToTalk(on: boolean): void {
    this.endUtterance();
    this.dispatch({ type: "ptt", on });
    if (on) this.vad?.pause();
    else this.vad?.start();
  }

  pttDown(): void {
    if (!this.model.pushToTalk || this.pttHeld) return;
    this.beginUtterance();
    this.pttHeld = true;
  }

  pttUp(): void {
    if (!this.pttHeld) return;
    this.pttHeld = false;
    this.endUtterance();
  }

  level(): number {
    return Math.max(this.player?.level() ?? 0, 0);
  }

  hangup(): void {
    this.sendText(encodeControl("hangup"));
    this.finish({ type: "closed", code: 1000 });
  }

  end(errorKey: string): void {
    this.sendText(encodeControl("hangup"));
    this.finish({ type: "fail", errorKey });
  }

  private finish(action: CallAction): void {
    if (this.torn) return;
    this.dispatch(action);
    this.teardown();
  }

  private teardown(): void {
    if (this.torn) return;
    this.torn = true;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      if (ws.readyState === 0 || ws.readyState === 1) ws.close(1000);
    }
    this.capture?.release();
    this.capture = null;
    void this.vad?.destroy();
    this.vad = null;
    this.player?.close();
    this.player = null;
    void this.o.context.close?.()?.catch?.(() => undefined);
  }
}

function errorKeyFor(err: unknown): string {
  if (err instanceof RecorderError) return err.code === "permission_denied" ? "web.recorder.permissionDenied" : "web.realtime.errors.micLost";
  return translateServerKey(err);
}
```

  同目录新建 `web/src/features/realtime/errors.ts`:

```ts
import { ApiError } from "~/api/client";
import { REALTIME_SERVER_ERRORS } from "./realtime-api";

/** 票据等 HTTP 错误 → i18n 键;未知错误用通用的断开文案。 */
export function translateServerKey(err: unknown): string {
  if (err instanceof ApiError) return REALTIME_SERVER_ERRORS[err.message] ?? "web.realtime.errors.generic";
  return "web.realtime.errors.generic";
}
```

  (`web.recorder.permissionDenied` 以 `src/audio/i18n` 里麦克风被拒的既有键名为准,先 `grep -n "permission" web/src/audio/i18n/en.json` 核对。`ApiError` 的 `message` 是服务端 `{"error"}` 的原文,`client.ts` 的 `errorMessage` 已如此处理。)

  "ended by the page" 用例:`end()` 在票据请求进行中调用 → `finish` 立即 `teardown`(关闭上下文);`start()` 随后在每个 `await` 之后检查 `torn` 并释放刚拿到的资源,所以麦克风即使被打开也会被释放、WebSocket 不会被创建。

- [ ] **Step 6: 实现 hook** —— `web/src/features/realtime/use-realtime-call.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { INITIAL_CALL, type CallModel } from "./call-machine";
import { RealtimeCall, type RealtimeCallOptions } from "./realtime-call";

export function useRealtimeCall(options: Omit<RealtimeCallOptions, "onChange">) {
  const [model, setModel] = useState<CallModel>(INITIAL_CALL);
  const [call, setCall] = useState<RealtimeCall | null>(null);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    let instance: RealtimeCall | null = null;
    // 推迟一拍:StrictMode 的"挂载-卸载-再挂载"只会真正启动第二次;上下文已在点击里解锁
    const timer = window.setTimeout(() => {
      instance = new RealtimeCall({ ...opts.current, onChange: setModel, onUserMessage: (id, text) => opts.current.onUserMessage?.(id, text) });
      setCall(instance);
      void instance.start();
    }, 0);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") instance?.end("web.realtime.endedInBackground");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (instance) instance.hangup();
    };
  }, []);

  return { model, call };
}
```

  StrictMode 用例:第一次挂载的定时器被清除,`instance` 为 null,不关闭上下文;第二次挂载启动一次(票据请求 1 次,503 → `finish` 关闭上下文 1 次);`unmount` 时 `hangup()` 是空操作(已 `torn`),上下文仍只关闭 1 次。

- [ ] **Step 7: 运行确认通过** —— `yarn workspace web test src/features/realtime src/audio` → PASS;`yarn workspace web typecheck` → 0 错误。

- [ ] **Step 8: 提交**

```bash
git add web/src/features/realtime/call-machine.ts web/src/features/realtime/call-machine.test.ts web/src/features/realtime/realtime-call.ts web/src/features/realtime/realtime-call.test.ts web/src/features/realtime/errors.ts web/src/features/realtime/use-realtime-call.ts web/src/features/realtime/use-realtime-call.test.tsx
git commit -m "feat(web): add the realtime call runtime with interruption and guaranteed cleanup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.10:通话界面

**Files:**
- Create: `web/src/features/realtime/realtime-call-screen.tsx`、`web/src/features/realtime/realtime-call-screen.test.tsx`

**Interfaces:**
- Consumes:Task 4.9 的 `CallModel`、`RealtimeCall`、`useRealtimeCall`;Task 4.8 的 i18n。
- Produces:`RealtimeCallScreen`(纯展示)props `{ model: CallModel; level(): number; onHangup(): void; onMute(muted: boolean): void; onPushToTalk(on: boolean): void; onPttDown(): void; onPttUp(): void; onClose(): void }`;`RealtimeCallDialog`(容器)props `Omit<RealtimeCallOptions, "onChange"> & { onClose(): void }`,内部 `useRealtimeCall`,用户挂断后直接 `onClose()`,其他原因结束时显示原因与 `call-close` 按钮。DOM(全部 `data-testid`):`call-screen`(`role="dialog"`、`aria-modal="true"`、`aria-label`)、`call-status`(`role="status"`、`data-phase`)、`call-mic-indicator`(通话进行中始终可见,红点 + "麦克风使用中")、`call-level`(`aria-hidden`)、`call-captions`(带 `data-lookup-context`)、`call-partial`、`call-notice`、`call-degraded`、`call-hangup`、`call-mute`(`aria-pressed`)、`call-ptt-toggle`(`aria-pressed`)、`call-ptt`(仅按住说话模式;指针按下/抬起 + `Space` 键按下/抬起)、`call-error`、`call-close`;所有按钮 `min-h-11 min-w-11`。

- [ ] **Step 1: 写失败的测试** —— `web/src/features/realtime/realtime-call-screen.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "~/test/render";
import { INITIAL_CALL, type CallModel } from "./call-machine";
import { RealtimeCallScreen } from "./realtime-call-screen";

function render(model: Partial<CallModel> = {}) {
  const handlers = { onHangup: vi.fn(), onMute: vi.fn(), onPushToTalk: vi.fn(), onPttDown: vi.fn(), onPttUp: vi.fn(), onClose: vi.fn() };
  renderWithProviders(<RealtimeCallScreen model={{ ...INITIAL_CALL, phase: "listening", ...model }} level={() => 0.3} {...handlers} />);
  return handlers;
}

describe("RealtimeCallScreen", () => {
  it("is an accessible full-screen dialog with a visible microphone indicator", () => {
    render();
    expect(screen.getByTestId("call-screen")).toHaveAttribute("role", "dialog");
    expect(screen.getByTestId("call-status")).toHaveAttribute("data-phase", "listening");
    expect(screen.getByTestId("call-mic-indicator")).toBeVisible();
    for (const id of ["call-hangup", "call-mute", "call-ptt-toggle"]) {
      expect(screen.getByTestId(id)).toHaveAccessibleName();
      expect(screen.getByTestId(id).className).toMatch(/min-h-11/);
    }
  });

  it("shows captions, the partial transcript, scores and an interrupted marker", () => {
    render({
      partial: "and a cro",
      captions: [
        { key: "u-m1", role: "user", text: "A latte please", messageId: "m1", score: 82 },
        { key: "a-1", role: "assistant", text: "Sure. What size", turnId: 1, interrupted: true },
      ],
    });
    expect(screen.getByTestId("call-captions")).toHaveTextContent("A latte please");
    expect(screen.getByTestId("call-captions")).toHaveTextContent("82");
    expect(screen.getByTestId("call-captions")).toHaveTextContent(/interrupted|已打断/);
    expect(screen.getByTestId("call-partial")).toHaveTextContent("and a cro");
  });

  it("buttons call their handlers and reflect pressed state", () => {
    const h = render({ muted: true });
    expect(screen.getByTestId("call-mute")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("call-mute"));
    expect(h.onMute).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId("call-ptt-toggle"));
    expect(h.onPushToTalk).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("call-hangup"));
    expect(h.onHangup).toHaveBeenCalled();
  });

  it("push-to-talk mode shows a hold button usable by pointer and keyboard", () => {
    const h = render({ pushToTalk: true });
    const ptt = screen.getByTestId("call-ptt");
    fireEvent.pointerDown(ptt);
    fireEvent.pointerUp(ptt);
    fireEvent.keyDown(ptt, { key: " " });
    fireEvent.keyUp(ptt, { key: " " });
    expect(h.onPttDown).toHaveBeenCalledTimes(2);
    expect(h.onPttUp).toHaveBeenCalledTimes(2);
  });

  it("notices, degraded mode and the end screen", () => {
    const h = render({ phase: "ended", error: "web.realtime.errors.idle_timeout", degraded: true, notice: "web.realtime.noSpeech" });
    expect(screen.getByTestId("call-error")).toHaveTextContent(/silence|没有说话/);
    expect(screen.queryByTestId("call-mic-indicator")).toBeNull();
    fireEvent.click(screen.getByTestId("call-close"));
    expect(h.onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/realtime/realtime-call-screen.test.tsx` → FAIL。

- [ ] **Step 3: 实现** —— `web/src/features/realtime/realtime-call-screen.tsx`:

```tsx
import { MicIcon, MicOffIcon, PhoneOffIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import type { CallModel } from "./call-machine";
import type { RealtimeCallOptions } from "./realtime-call";
import { useRealtimeCall } from "./use-realtime-call";

export interface RealtimeCallScreenProps {
  model: CallModel;
  level(): number;
  onHangup(): void;
  onMute(muted: boolean): void;
  onPushToTalk(on: boolean): void;
  onPttDown(): void;
  onPttUp(): void;
  onClose(): void;
}

const raf = (cb: () => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : window.setTimeout(cb, 50);
const caf = (id: number): void =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : window.clearTimeout(id);

function LevelBar({ level }: { level(): number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setValue(Math.min(1, level() * 3));
      frame = raf(tick);
    };
    frame = raf(tick);
    return () => caf(frame);
  }, [level]);
  return (
    <div data-testid="call-level" aria-hidden="true" className="h-2 w-40 overflow-hidden rounded-full bg-muted">
      <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function RealtimeCallScreen({ model, level, onHangup, onMute, onPushToTalk, onPttDown, onPttUp, onClose }: RealtimeCallScreenProps) {
  const { t } = useTranslation();
  const ended = model.phase === "ended";
  const captionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    captionsRef.current?.scrollTo?.({ top: captionsRef.current.scrollHeight });
  }, [model.captions]);
  const phaseKey = model.phase === "idle" ? "connecting" : model.phase;
  return (
    <div data-testid="call-screen" role="dialog" aria-modal="true" aria-label={t("web.realtime.title")}
      className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between gap-2 border-b p-3">
        <span data-testid="call-status" data-phase={model.phase} role="status" className="text-base font-medium">
          {t(`web.realtime.status.${phaseKey}`)}
        </span>
        {!ended && (
          <span data-testid="call-mic-indicator" className="flex items-center gap-1 text-sm text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            {t("web.realtime.micInUse")}
          </span>
        )}
      </header>
      <div className="flex flex-col items-center gap-2 p-3">
        <LevelBar level={level} />
        {model.degraded && <p data-testid="call-degraded" className="text-sm text-amber-700">{t("web.realtime.degraded")}</p>}
        {model.notice && <p data-testid="call-notice" role="status" className="text-sm text-muted-foreground">{t(model.notice)}</p>}
      </div>
      <div ref={captionsRef} data-testid="call-captions" data-lookup-context className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {model.captions.map((c) => (
          <p key={c.key} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-base", c.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>
            {c.text}
            {c.role === "user" && typeof c.score === "number" && <span className="ml-2 rounded-full bg-background/30 px-2 text-xs">{c.score}</span>}
            {c.interrupted && <span className="ml-1 text-xs opacity-70">{t("web.realtime.interrupted")}</span>}
          </p>
        ))}
        {model.partial && <p data-testid="call-partial" className="ml-auto max-w-[85%] text-base italic text-muted-foreground">{model.partial}</p>}
      </div>
      {ended ? (
        <footer className="flex flex-col items-center gap-3 border-t p-4">
          {model.error && <p data-testid="call-error" role="alert" className="text-base">{t(model.error)}</p>}
          <Button data-testid="call-close" className="min-h-11 min-w-11" onClick={onClose}>
            <XIcon className="mr-1 h-4 w-4" />{t("web.realtime.close")}
          </Button>
        </footer>
      ) : (
        <footer className="flex flex-col items-center gap-3 border-t p-4">
          {model.pushToTalk && (
            <Button data-testid="call-ptt" className="min-h-14 w-full select-none text-base" style={{ touchAction: "none" }}
              onPointerDown={(e) => { e.preventDefault(); onPttDown(); }} onPointerUp={onPttUp} onPointerCancel={onPttUp}
              onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); onPttDown(); } }}
              onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") onPttUp(); }}
              onContextMenu={(e) => e.preventDefault()}>
              {t("web.realtime.holdToSpeak")}
            </Button>
          )}
          <div className="flex items-center gap-4">
            <Button data-testid="call-mute" variant="outline" size="icon" className="min-h-11 min-w-11" aria-pressed={model.muted}
              aria-label={model.muted ? t("web.realtime.unmute") : t("web.realtime.mute")} onClick={() => onMute(!model.muted)}>
              {model.muted ? <MicOffIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
            </Button>
            <Button data-testid="call-hangup" variant="destructive" size="icon" className="min-h-11 min-w-11 rounded-full"
              aria-label={t("web.realtime.hangup")} onClick={onHangup}>
              <PhoneOffIcon className="h-5 w-5" />
            </Button>
            <Button data-testid="call-ptt-toggle" variant="outline" className="min-h-11 min-w-11 text-sm" aria-pressed={model.pushToTalk}
              aria-label={t("web.realtime.pushToTalk")} onClick={() => onPushToTalk(!model.pushToTalk)}>
              PTT
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}

export function RealtimeCallDialog({ onClose, ...options }: Omit<RealtimeCallOptions, "onChange"> & { onClose(): void }) {
  const { model, call } = useRealtimeCall(options);
  return (
    <RealtimeCallScreen model={model} level={() => call?.level() ?? 0}
      onHangup={() => { call?.hangup(); onClose(); }}
      onMute={(m) => call?.setMuted(m)} onPushToTalk={(on) => call?.setPushToTalk(on)}
      onPttDown={() => call?.pttDown()} onPttUp={() => call?.pttUp()} onClose={onClose} />
  );
}
```

  (`raf`/`caf` 在没有 `requestAnimationFrame` 的环境里退到 50 ms 定时器,测试环境不需要任何改动。)

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/features/realtime src/i18n` → PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/realtime/realtime-call-screen.tsx web/src/features/realtime/realtime-call-screen.test.tsx
git commit -m "feat(web): add the full-screen realtime call interface" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.11:对话页入口、语法检查与收尾

**Files:**
- Modify: `web/src/features/chat/conversation-header-actions.tsx`(`conversation-call` 按钮)
- Modify: `web/src/features/chat/conversation-page.tsx`(读取通话配置、点击里创建并解锁 `AudioContext`、渲染 `RealtimeCallDialog`、通话中逐条语法检查、结束后重新加载消息)
- Modify: `web/src/features/chat/conversation-page.test.tsx`(只追加 `describe("realtime call")`;R17 允许的 `routes()` 默认路由增加 `"GET /api/realtime/config"` 返回 `enabled: false`——否则每个用例都会多一个 404 请求)
- Modify: `web/vite.config.ts`(开发代理 `ws: true`)

**Interfaces:**
- Consumes:Task 4.8 的 `fetchRealtimeConfig`、`RealtimeConfig`;Task 4.10 的 `RealtimeCallDialog`;Task 2.1 的 `unlockAudioContext`;既有 `effectiveSystemPrompt`、`chatOptions`、`checkGrammar`、`patchMessage`、`claimAudio`/`releaseAudio`。
- Produces:顶栏 `conversation-call`(`PhoneIcon`,`aria-label` = `web.realtime.start`;`realtimeConfig?.enabled` 为真才渲染;发送中/录音中/会话未加载时禁用);点击的同步阶段:停止朗读、`voice.cancel()`、`new AudioContext()` + `unlockAudioContext`(创建失败 → toast `web.realtime.errors.unsupported`);开始 payload:`systemPrompt = effectiveSystemPrompt(config)`、`model = config.model`、`temperature = config.temperature`、`voice = config.ttsVoice`、`saveRecordings = true`(与语音消息一致,R14);`onUserMessage` → 设置开着语法检查时 `checkGrammar` + `patchMessage`(失败静默);关闭对话框后等待这些语法请求结束(`Promise.allSettled`)再让会话数据重新加载(`reloadKey` 加入加载会话的 effect 依赖)。

- [ ] **Step 1: 写失败的测试** —— 追加到 `conversation-page.test.tsx`(`setup({ route })` 的覆盖方式沿用该文件既有写法):

```tsx
describe("realtime call (plan 2026-10-07)", () => {
  it("shows the call button only when the server enables it", async () => {
    await setup();
    expect(screen.queryByTestId("conversation-call")).toBeNull();
  });

  it("opens the call screen from the header and unlocks audio in the click", async () => {
    const created: unknown[] = [];
    class FakeCtx {
      state = "suspended";
      sampleRate = 48000;
      destination = {};
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
      createBuffer = vi.fn(() => ({}));
      createBufferSource = vi.fn(() => ({ connect: vi.fn(), start: vi.fn() }));
      constructor() { created.push(this); }
    }
    vi.stubGlobal("AudioContext", FakeCtx);
    await setup({
      route: {
        "GET /api/realtime/config": () => json({ enabled: true, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
        "POST /api/realtime/ticket": () => json({ error: "Realtime is not enabled" }, 503),
      },
    });
    await userEvent.click(await screen.findByTestId("conversation-call"));
    expect(created).toHaveLength(1);
    expect((created[0] as FakeCtx).resume).toHaveBeenCalled();
    expect(await screen.findByTestId("call-screen")).toBeInTheDocument();
    expect(await screen.findByTestId("call-error")).toBeInTheDocument(); // 票据被拒 → 结束页
    await userEvent.click(screen.getByTestId("call-close"));
    expect(screen.queryByTestId("call-screen")).toBeNull();
    expect((created[0] as FakeCtx).close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败** —— `yarn workspace web test src/features/chat/conversation-page.test.tsx -t "realtime call"` → FAIL。

- [ ] **Step 3: 实现**
  - `conversation-header-actions.tsx`:props 加 `canCall: boolean; callDisabled: boolean; onCall(): void;`,在 `conversation-recap` 之前渲染 `{canCall && <Button data-testid="conversation-call" variant="ghost" size="icon" className="h-11 w-11" disabled={callDisabled} aria-label={t("web.realtime.start")} onClick={onCall}><PhoneIcon className="h-5 w-5" /></Button>}`。
  - `conversation-page.tsx`:

```tsx
  const [realtimeConfig, setRealtimeConfig] = useState<RealtimeConfig | null>(null);
  const [call, setCall] = useState<{ context: AudioContext } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const callGrammarRef = useRef<Promise<unknown>[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchRealtimeConfig(api, controller.signal).then(setRealtimeConfig, () => setRealtimeConfig(null));
    return () => controller.abort();
  }, [api]);

  const startCall = () => {
    if (!conversation || busyRef.current || voice.state !== "idle" || call) return;
    stopTts();
    voice.cancel();
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      toast.error(t("web.realtime.errors.unsupported"));
      return;
    }
    const context = new Ctor(); // 必须在点击的同步阶段创建并解锁(iOS)
    unlockAudioContext(context);
    setCall({ context });
  };

  const onCallUserMessage = (messageId: string, text: string) => {
    if (!optionsRef.current.grammarCheck) return;
    callGrammarRef.current.push(checkGrammar(api, { text })
      .then((grammar) => patchMessage(api, messageId, { grammar }))
      .catch(() => undefined));
  };

  const closeCall = () => {
    setCall(null);
    const pending = callGrammarRef.current;
    callGrammarRef.current = [];
    void Promise.allSettled(pending).then(() => { if (mountedRef.current) setReloadKey((k) => k + 1); });
  };
```

    把 `reloadKey` 加进加载会话与消息的那个 effect(`Promise.all([getConversation(api, id), listMessages(api, id)])` 所在 effect)的依赖数组;`ConversationHeaderActions` 传 `canCall={!!realtimeConfig?.enabled} callDisabled={!conversation || sending || voice.state !== "idle"} onCall={startCall}`;在根元素末尾渲染:

```tsx
      {call && conversation && realtimeConfig && (
        <RealtimeCallDialog api={api} conversationId={conversation.id} context={call.context}
          sampleRateOut={realtimeConfig.sampleRateOut}
          start={{ systemPrompt: effectiveSystemPrompt(config), model: config.model, temperature: config.temperature, voice: config.ttsVoice, saveRecordings: true }}
          onUserMessage={onCallUserMessage} onClose={closeCall} />
      )}
```

    (`config` 是页面里已经 `withConfigDefaults` 过的运行时配置,沿用 `send()` 所用的同一个变量。)
  - `vite.config.ts`:`proxy: { "/api": { target: env.WEB_DEV_API_TARGET || "http://127.0.0.1:8000", ws: true } }`。

- [ ] **Step 4: 运行确认通过** —— `yarn workspace web test src/features/chat/conversation-page.test.tsx` 全量 → 0 failed(R17:只在 `routes()` 增加一条默认路由);`yarn workspace web test` 全量 → 0 failed;`yarn workspace web typecheck` → 0。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/conversation-header-actions.tsx web/src/features/chat/conversation-page.tsx web/src/features/chat/conversation-page.test.tsx web/vite.config.ts
git commit -m "feat(web): start realtime calls from the conversation header" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 验收门槛 4

- [ ] 服务端:`cd server && uv run pytest -q` 0 failed;`tests/test_realtime_session.py` 连跑 3 次都通过;Postgres 全量(门槛 1 的命令,连接串 `127.0.0.1:55432`)0 failed(`test_realtime_ws.py` 用临时文件 SQLite,在两种库下都运行同样的用例)。
- [ ] 网页:typecheck、build、test×3 全部通过;i18n 键集一致。
- [ ] 契约一致:`web/src/features/realtime/protocol.test.ts` 的"has exactly the server's close codes"通过(它读取服务端源码)。
- [ ] 泄漏:`realtime-call.test.ts` 的 "every exit path releases …" 一组 7 个用例全部通过,门槛记录里逐条写出路径名。
- [ ] 本机冒烟(不需要上游,`REALTIME_ENABLED=true`、`VOLCENGINE_TTS_KEY=dummy`、`TTS_MODELS=...,volcengine/seed-tts-2.0` 写在**临时环境变量**里,不写进任何文件):起 uvicorn 后 `curl` 取票据(200),用 `uv run python -c` 写一个 10 行的 `websockets` 客户端连 `ws://127.0.0.1:8000/api/realtime?ticket=<票据>`、发 `start` → 收到 `ready` → 发 `hangup` → 关闭码 1000;同一票据再连 → 4001。
- [ ] 默认关闭:不设 `REALTIME_ENABLED` 时 `GET /api/realtime/config` 返回 `enabled: false`,对话页没有"通话"按钮。

---
## 阶段 5:端到端、延迟对比、抗噪汇总、文档、真机清单、最终回归

### Task 5.1:〔需上游〕延迟对比

**Files:**
- Modify: `docs/superpowers/plans/2026-10-07-voice-latency.md`(填"之后"列、比值、结论)

**Interfaces:**
- Consumes:Task 0.2 的脚本与用例(用例的 `recordFor` 会自动走按住说话路径)、Task 0.5 的基线。
- Produces:设计文档 §7.1 的证据(或"阻塞:上游")。

- [ ] **Step 1: 前提** —— 上游已恢复且用户同意费用(约 30 次 TTS、14 次识别、10 次 LLM);否则在延迟表写"之后:阻塞:上游(日期、返回码)",继续 Task 5.2(它同样需要上游,照此记录)。若基线也处于阻塞,先按 R2 在 `voice-latency-baseline` 工作树上补测基线,**同一天**再测"之后"。
- [ ] **Step 2: 服务端层** —— 在当前 HEAD 起本机 uvicorn(同 Task 0.5 Step 4 的方式),`uv run python scripts/measure_latency.py --base-url http://127.0.0.1:8765 --label after --samples ../.superpowers/latency --runs 7 --out ../.superpowers/latency/after.json`。
- [ ] **Step 3: 浏览器层** —— 起 E2E 栈(当前 HEAD),s5/s15 各跑一次 `latency.spec.ts`(命令同 Task 0.5 Step 4,目录换成本仓库的 `web/`)。
- [ ] **Step 4: 填表** —— 用 `markdown_row` 生成每一行(`uv run python -c "from scripts.measure_latency import markdown_row; print(markdown_row(...))"`),把"之后"中位数、比值、达标/未达标写进表;附原始最小/最大值。**未达标时如实写"未达标",不得修改目标**(目标只能在 Task 0.6 依据基线修订);在 OPEN ACCEPTANCE ITEMS 第 7 条写明差距与可能原因(例如流式识别未开启)。
- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/plans/2026-10-07-voice-latency.md
git commit -m "docs: record voice latency after the speed-ups" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.2:〔需上游〕实时通话端到端

**Files:**
- Create: `web/e2e/realtime.spec.ts`、`web/e2e/support/leaks.ts`
- Modify: `docker-compose.e2e.yml`(`REALTIME_ENABLED: ${E2E_REALTIME:-false}`)——**注意**:工作区里 `docker-compose.yml` 有用户未提交的改动,本任务不碰它

**Interfaces:**
- Consumes:阶段 4 的全部;`E2E_REALTIME=1` 时 E2E 栈开启实时通话;真实上游(火山 TTS、识别、LLM;讯飞可选)。
- Produces:设计文档 §7.4 的端到端证据:一轮对话 + 一次打断 + 挂断后无泄漏 + 消息正确保存 + 复盘可用;额外记录"松手 → 第一块下行音频"的时间(不设目标,写进延迟表"实时通话首声"一行)。

- [ ] **Step 1: 泄漏探针** —— `web/e2e/support/leaks.ts`:

```ts
import type { Page } from "@playwright/test";

/** 在页面脚本之前包裹 getUserMedia 与 AudioContext,记录创建的轨道与上下文,供挂断后检查是否全部释放。 */
export async function trackAudioResources(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eTracks: MediaStreamTrack[]; __e2eContexts: AudioContext[] };
    w.__e2eTracks = [];
    w.__e2eContexts = [];
    const devices = navigator.mediaDevices;
    if (devices?.getUserMedia) {
      const original = devices.getUserMedia.bind(devices);
      devices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        w.__e2eTracks.push(...stream.getTracks());
        return stream;
      };
    }
    const Original = window.AudioContext;
    if (Original) {
      window.AudioContext = class extends Original {
        constructor(options?: AudioContextOptions) {
          super(options);
          w.__e2eContexts.push(this);
        }
      } as typeof AudioContext;
    }
  });
}

export async function openAudioResources(page: Page): Promise<{ liveTracks: number; openContexts: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __e2eTracks: MediaStreamTrack[]; __e2eContexts: AudioContext[] };
    return {
      liveTracks: w.__e2eTracks.filter((t) => t.readyState === "live").length,
      openContexts: w.__e2eContexts.filter((c) => c.state !== "closed").length,
    };
  });
}
```

- [ ] **Step 2: 用例** —— `web/e2e/realtime.spec.ts`(用"按住说话"模式让断句确定:假麦克风文件是循环播放的,不适合靠 VAD 断句):

```ts
import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { openAudioResources, trackAudioResources } from "./support/leaks";

test("realtime call: one turn, an interruption, hang up without leaks, messages and recap", async ({ page, request, browserName }) => {
  test.skip(process.env.E2E_REALTIME !== "1", "set E2E_REALTIME=1 (real upstream and REALTIME_ENABLED required)");
  test.skip(browserName !== "chromium", "the fake microphone file is a Chromium flag");
  test.setTimeout(240_000);
  await trackAudioResources(page);
  await signIn(page, request);
  await page.goto("/chat");
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("scenario-free").click();
  await page.getByTestId("conversation-call").click();
  await expect(page.getByTestId("call-status")).toHaveAttribute("data-phase", "listening", { timeout: 30_000 });
  await page.getByTestId("call-ptt-toggle").click();
  const ptt = page.getByTestId("call-ptt");

  // 第一轮:按住 4 s 说话
  await ptt.hover();
  await page.mouse.down();
  await page.waitForTimeout(4000); // 说话时长:必须真实等待
  const released = Date.now();
  await page.mouse.up();
  await expect(page.getByTestId("call-captions")).toContainText(/fellow Americans|ask not/i, { timeout: 60_000 });
  await expect(page.getByTestId("call-status")).toHaveAttribute("data-phase", "speaking", { timeout: 60_000 });
  console.log(`REALTIME_FIRST_AUDIO_MS ${Date.now() - released}`);

  // 打断:机器人说话时再按住说话
  await page.mouse.down();
  await expect(page.getByTestId("call-captions")).toContainText(/interrupted|已打断/);
  await page.waitForTimeout(3000);
  await page.mouse.up();
  await expect(page.getByTestId("call-status")).toHaveAttribute("data-phase", "speaking", { timeout: 60_000 });

  // 挂断
  await page.getByTestId("call-hangup").click();
  await expect(page.getByTestId("call-screen")).toHaveCount(0);
  // 麦克风轨道全部停止;通话与 VAD 创建的 AudioContext 全部关闭(对话页的共享播放器用 <audio>,不创建 AudioContext)
  await expect.poll(() => openAudioResources(page), { timeout: 10_000 }).toEqual({ liveTracks: 0, openContexts: 0 });

  // 消息已保存:重新加载后可见两条用户消息、至少一条助手消息
  await page.reload();
  await expect(page.getByText(/fellow Americans|ask not/i).first()).toBeVisible();
  const messages = page.locator("[data-testid^='message-']");
  expect(await messages.count()).toBeGreaterThanOrEqual(3);

  // 复盘可用
  await page.getByTestId("conversation-recap").click();
  await page.getByTestId("recap-generate").click();
  await expect(page.getByTestId("recap-summary")).toBeVisible({ timeout: 60_000 });
});
```

  (`message-` 前缀、`recap-generate`、`recap-summary` 以对话页与复盘面板现有的 `data-testid` 为准——先 `grep -n "data-testid=\"recap" web/src/features/chat/recap-sheet.tsx` 与气泡的测试 id 核对;只改选择器,不改断言含义。)

- [ ] **Step 3: 运行** —— `docker-compose.e2e.yml` 的 `environment` 加 `REALTIME_ENABLED: ${E2E_REALTIME:-false}`;`E2E_REALTIME=1 docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait`,然后 `cd web && E2E_REALTIME=1 E2E_FAKE_AUDIO=/e/workspace/everyone-can-use-english/.superpowers/latency/s5.wav yarn playwright test e2e/realtime.spec.ts --project=chromium-mobile`。结果(通过/失败现象/阻塞)与 `REALTIME_FIRST_AUDIO_MS` 写进 `e2e-results.md` 新的一节「语音提速与实时通话 Playwright 端到端」与延迟表。
- [ ] **Step 4: 提交**

```bash
git add web/e2e/realtime.spec.ts web/e2e/support/leaks.ts docker-compose.e2e.yml docs/superpowers/plans/e2e-results.md docs/superpowers/plans/2026-10-07-voice-latency.md
git commit -m "test(web): cover a realtime call end to end with a leak check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.3:文档与真机清单

**Files:**
- Modify: `web/README.md`、`server/README.md`、`docs/superpowers/plans/e2e-results.md`

**Interfaces:**
- Consumes:前面全部任务的结果。
- Produces:设计文档 §7.2(局限写入文档)、§7.5(真机清单)的证据。

- [ ] **Step 1: 网页文档** —— `web/README.md` 在「E2E(Playwright,真实上游)」一节之前加:

```markdown
## 语音提速、按住说话与实时通话

- **延迟打点**:`src/lib/latency.ts` 记录松手 → 转写 → 回复 → 出声各段时间(只记时间),`localStorage.setItem("enjoy-web.debug.latency", "1")` 后在控制台打印;`window.__enjoyLatency` 保存最近 50 条。测量方法与结果:`docs/superpowers/plans/2026-10-07-voice-latency.md`。
- **录音**:优先 AudioWorklet 直采 16 kHz PCM(退到 ScriptProcessor,再退到 MediaRecorder),停止即出结果、裁掉首尾静音;近讲能量门限(−38 dBFS、≥ 250 ms)判定没有前景语音时不上传,直接提示"没听清"。**只能降低旁人声音的影响,不能完全排除**(嘈杂环境效果未验证)。
- **按住说话**:按住录音、松手发送;上滑 80 px 出现"取消 / 转文字"两个落点;< 300 ms 视为误触;键盘 `Space`/`Enter` 两次激活、`Esc` 取消。手势逻辑是纯 reducer `src/features/chat/hold-to-talk.ts`。
- **按句朗读**:回复流到第一句结束就开始合成并播放,后面的句子排队(最多预取 2 句);每句一次 TTS 调用。切句规则与服务端共用 `server/tests/fixtures/sentence_cases.json`。
- **实时通话**(服务端 `REALTIME_ENABLED=true` 时顶栏出现"通话"):浏览器 VAD(Silero,资源自托管在 `/vad/<版本>/`,构建前由 `scripts/copy-vad-assets.mjs` 复制)→ WebSocket `/api/realtime`(一次性票据)→ 服务端识别 + LLM + 逐句 TTS → WebAudio 排队播放;机器人说话时提高 VAD 门限防回声误打断;"按住说话"模式适合嘈杂环境。每一条结束路径都会释放麦克风与 AudioContext(`src/features/realtime/realtime-call.test.ts`)。开发服务器的 `/api` 代理已开启 `ws: true`。
```

- [ ] **Step 2: 服务端文档** —— `server/README.md`:
  - 「配置」加一段说明 Task 1.1 的全部新配置项(复制 `.env.example` 的注释),并写明"`REALTIME_ENABLED` 默认关;开启前确认火山 TTS、LLM、识别都可用"。
  - 「成本保护」末尾加:`- 实时通话:每一轮 = 识别 ×1 + LLM ×1(流式,max_tokens ≤ 600)+ 每句 TTS ×1 + 讯飞评测 ×1(异步,录音计入配额);每用户并发 1 路、全局 REALTIME_MAX_SESSIONS 路、单次最长 REALTIME_MAX_MINUTES 分钟、静音 REALTIME_IDLE_TIMEOUT_SECONDS 秒自动挂断;每一轮计入 AI_RATE_LIMIT_PER_MINUTE。按句朗读让自动朗读的 TTS 调用数从"每条回复一次"变为"每句一次"。`
  - 「部署」加:`- 反向代理必须转发 WebSocket:/api/realtime 需要 Upgrade/Connection 头,读超时 ≥ REALTIME_MAX_MINUTES(1Panel/OpenResty:站点反向代理里开启 WebSocket 支持,proxy_read_timeout 至少 660s)。未验证:生产环境的代理配置需要用户确认。`
  - 「已知限制」加:票据、并发登记、限流都在进程内(单 worker);旁人声音只能降低不能消除;流式识别默认关(spike 结论见 `docs/superpowers/plans/2026-10-07-voice-spike-results.md`)。
  - 「接口一览」加 `GET /api/realtime/config`、`POST /api/realtime/ticket`、`WS /api/realtime`(关闭码表复制 R12)。
- [ ] **Step 3: 真机清单与未决项** —— `e2e-results.md`:
  - OPEN ACCEPTANCE ITEMS 第 7 条按 Task 5.1、5.2 的实际结果更新(只写发生过的事)。
  - 「清单与结果」两张表各追加第 23–32 项(结果格一律 `未验证(需要用户提供设备与 HTTPS 地址)`):

```markdown
| 23 | 对话页按住麦克风说一句,松手 | 松手即发送;转写出现明显快于以前(用秒表粗测并记录) |
| 24 | 按住后上滑到左边"取消"松手;再试一次上滑到右边"转文字"松手 | 取消:不发送、无上传;转文字:文字出现在输入框,未发送 |
| 25 | 轻点麦克风(不按住);首次使用时在权限弹窗出现期间松手 | 出现"按住说话"提示;权限弹窗期间松手不发送、不残留录音 |
| 26 | 按住说话时来电或下拉通知中心/上滑回桌面 | 本次录音被丢弃,不发送;麦克风指示消失 |
| 27 | iPhone:按住说话发送后 | 回复第一句一结束就开始朗读(无需再点) |
| 28 | 顶栏点"通话",说一句话 | 首次出声延迟(秒表):____ s;字幕滚动正常 |
| 29 | 机器人说话时开口打断 | 机器人立即停下,开始听你说;字幕标"已打断" |
| 30 | 外放(不戴耳机)通话 1 分钟 | 机器人不会被自己的声音打断(回声保护) |
| 31 | 旁边有人说话的环境下通话/按住说话 | 记录误触发次数与识别混入情况(只记录,不承诺) |
| 32 | 通话中切到后台或锁屏,再回来 | 通话已结束并提示"因切到后台已结束";麦克风指示消失 |
```

- [ ] **Step 4: 提交**

```bash
git add web/README.md server/README.md docs/superpowers/plans/e2e-results.md
git commit -m "docs: document faster voice input, hold-to-talk and realtime calls, and extend the device checklist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.4:最终回归

**Files:**
- Modify: `docs/superpowers/plans/2026-10-07-voice-gate-log.md`

**Interfaces:**
- Consumes:全部。
- Produces:门槛 5 的记录。

- [ ] **Step 1** —— 依次运行并把输出的最后一行写进门槛记录:`cd server && uv run pytest -q`;Postgres 全量(门槛 1 的命令);`yarn workspace web typecheck`;`for i in 1 2 3; do yarn workspace web test 2>&1 | tail -3; done`;`yarn workspace web build`;E2E 栈下 `cd web && yarn playwright test --project=chromium-mobile` 与 `--project=webkit-mobile`(不设 `E2E_REAL_STT`/`E2E_LATENCY`/`E2E_REALTIME` 的用例照常跳过),结果与上一计划的结果表对比,不得出现新的失败。
- [ ] **Step 2** —— 桌面端与密钥检查:`git diff --stat voice-latency-baseline -- enjoy/ 1000-hours/ 1000h-portal/ book/` 无输出;`git grep -nE "XFYUN_API_(KEY|SECRET)=.+|UPSTREAM_[A-Z]+_KEY=.+|VOLCENGINE_TTS_KEY=.+|ASR_STREAM_KEY=.+" -- . ':!server/.env' ':!server/.env.bak-*'` 无输出;`git ls-files web/dist web/public/vad server/.env 'server/.env.bak-*' .superpowers` 无输出。
- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/plans/2026-10-07-voice-gate-log.md
git commit -m "docs: record the final regression for voice speed, hold-to-talk and realtime calls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.5(可选,时间盒 2 小时):〔需上游〕火山端到端实时对话 spike

**执行条件:** 门槛 5 已通过,且用户明确要求评估端到端实时模型(设计文档 §3.1:只作后备实验,不进主线)。**只读脚本,不改产品代码。**

**Files:**
- Create: `server/scripts/spikes/dialogue_spike.py`
- Modify: `docs/superpowers/plans/2026-10-07-voice-spike-results.md`(第 6 节)

**Interfaces:**
- Consumes:`Settings.volcengine_tts_key`(进程内)、`.superpowers/latency/s5.wav`。
- Produces:第 6 节:鉴权是否可用(`X-Api-Key` UUID 是否被 `volc.speech.dialog` 接受、是否需要单独开通)、一轮英语对话的首声延迟、回复的英语质量(人工评判 3 句)、是否能设置人设/系统提示、计费说明(只摘录控制台/文档可见信息)、结论(是否值得另立设计)。

- [ ] **Step 1: 征得用户同意**(1–3 次短会话,按时长计费)。
- [ ] **Step 2: 脚本要点**(以当时的官方文档为准实现,下列事件号是调研结果、**未验证**):`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`,头 `X-Api-Key`、`X-Api-Resource-Id: volc.speech.dialog`、`X-Api-Connect-Id`,以及文档要求的其他固定头;二进制帧格式同流式识别(4 字节头 + 可选序号/事件号 + 会话 ID + 负载);上行 PCM 16 kHz,下行 PCM 24 kHz;观察事件 451(识别结果)、459(说话结束)、550(LLM 文本)、352(TTS 音频)、359(结束)。脚本只打印事件号、耗时、文本(样本是公开演讲),把下行音频写到 `.superpowers/spike/dialogue.pcm` 供人工试听;不打印任何头的值。
- [ ] **Step 3: 写第 6 节**(格式:日期、鉴权结果、首声 ms、英语质量评语、可配置性、费用、结论),时间盒到点就停,写"未完成项"。
- [ ] **Step 4: 提交**

```bash
git add server/scripts/spikes/dialogue_spike.py docs/superpowers/plans/2026-10-07-voice-spike-results.md
git commit -m "docs: record the optional end-to-end realtime dialogue spike" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### 验收门槛 5(项目完成标准,对应设计文档 §7)

- [ ] **§7.1 提速可量化**:延迟表"之后"列与比值已填(或明确"阻塞:上游"并保留在 OPEN 项);达标/未达标如实标注。
- [ ] **§7.2 抗噪**:`energy-gate.test.ts`(背景人声单独、三档前景信噪比、远处说话人、短促噪声、最短时长)与 `speech-gate.test.ts`(机器人说话时的回声保护)通过;设置面板说明与"可能混入他人声音"提示就位;局限已写进 `web/README.md`。
- [ ] **§7.3 按住说话**:手势状态机穷举测试 + 组件测试 + 对话页用例 + `hold-to-talk.spec.ts`(chromium 4 passed)。
- [ ] **§7.4 实时通话**:服务端状态机/切句/取消的单元与集成测试(假上游)全部通过;`realtime.spec.ts` 已运行并通过,或明确"阻塞:上游";消息保存与复盘在该用例中验证。
- [ ] **§7.5 真机清单**:第 23–32 项已追加,全部"未验证"(除非用户实测并提供结果)。
- [ ] **§7.6**:桌面端目录零改动;无密钥;原有测试不退化(Task 5.4 的记录)。

---

## 可并行开发

> 并行不改变"每个阶段过自己的门槛"的规则;各线使用 superpowers:using-git-worktrees 的独立工作树与分支,合并回 `feat/self-hosted-backend` 后再统一过门槛。**阶段 0 必须最先、串行完成**(基线标签必须早于任何优化)。

| 并行线 | 任务顺序 | 主要文件 |
|---|---|---|
| S(服务端) | 1.1 → 1.2 → 1.3 → 1.4 → 1.5 →(1.6)→ 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 | `server/**` |
| A(网页音频) | 2.1 → 2.2 → 2.3 → 2.4;2.6 → 2.7;4.7、4.8 → 4.9 → 4.10 | `web/src/audio/**`、`web/src/features/realtime/**`、`use-tts-player.ts`、`use-auto-speak.ts` |
| U(网页交互) | 3.1 → 3.2 → 3.3;2.5 | `hold-to-talk*`、`use-hold-to-talk.ts`、`use-voice-turn.ts`、`result-badges.tsx` |

- 设计文档 §8:阶段 1 与阶段 3 互不依赖(3 只用现有识别接口);阶段 2 依赖阶段 0 的结论;阶段 4 依赖阶段 1、2。
- 2.6 读取 1.4 的一致性用例文件;若 S 线尚未合并,按 Task 2.6 的说明先原样创建该文件,合并时必须与 1.4 的内容一致(`git diff` 无差异)。
- 4.2 的 Interfaces 是服务端与网页的契约,4.8 可在 4.2 合并前按契约开发,4.8 的 `protocol.test.ts` 会在合并后核对服务端源码。

**必须严格串行的文件(按此顺序,一个合并后再开始下一个):**

| 文件 | 顺序 |
|---|---|
| `web/src/features/chat/conversation-page.tsx` 与 `conversation-page.test.tsx` | 2.5 → 2.8 → 3.4 → 4.11 |
| `web/src/features/chat/use-voice-turn.ts`(及其测试) | 0.1 → 2.4 → 3.3 |
| `web/src/features/chat/use-auto-speak.ts`、`use-tts-player.ts` | 0.1 → 2.7 |
| `server/app/routers/ai_audio.py` | 0.1 → 1.2 → 1.3 |
| `server/app/config.py`、`server/.env.example` | 1.1(若 1.6 需要 App ID 鉴权,1.6 在 1.1 之后追加) |
| `server/app/routers/realtime.py`、`realtime_providers.py` | 4.1 → 4.4 → 4.5 → 4.6 |
| `web/vite.config.ts` | 2.3 → 4.11 |
| `.gitignore` | 0.2 → 2.3 |
| `web/src/features/chat/i18n/*.json` | 2.5 → 3.2(只追加键,冲突按 JSON 合并) |
| `docs/superpowers/plans/2026-10-07-voice-spike-results.md` | 0.3 → 0.4 → 0.5 → 0.6 → 2.3 →(5.5) |

**分工建议:** 阶段 0 由一个会话完成。之后开三个会话:Agent-S 做 S 线;Agent-A 做 A 线的 2.1–2.4、2.6、2.7;Agent-U 做 3.1–3.3 与 2.5。对话页串行链 2.5 → 2.8 → 3.4 由 Agent-U 依次完成(2.8 需等 A 线的 2.7 合并)。门槛 1、2 通过后,Agent-S 做 4.1–4.6,Agent-A 做 4.7–4.10,最后 Agent-U 做 4.11。阶段 5 由一个会话完成;真机清单需要用户本人参与。

## 已知未决与未验证项(开工即知,执行中如实更新)

1. **上游账号异常**(2026-10-05 起火山 TTS 403、方舟识别 502):Task 0.3–0.5、5.1、5.2、5.5 全部依赖用户恢复;阻塞期间按 R1 记录,不得用模拟冒充。
2. **火山流式识别**(`sauc/bigmodel*`)的鉴权方式(UUID `X-Api-Key` 是否被接受、资源 ID、是否需 App ID + Access Token)、帧格式、鉴权类错误码:Task 0.4 验证;已验证(UUID Key + `volc.bigasr.sauc.duration` 可用),开关为 `UPSTREAM_ASR_MODE=volc_stream`。
3. **方舟识别模型是否接受 `thinking: {"type": "disabled"}`、`<none>` 指令是否被严格遵守**:Task 0.3 验证。
4. **火山 TTS 的 `pcm` 输出与 24 kHz 采样率、分块到达时间**:Task 0.5 验证;实时通话的下行采样率以此为准(`REALTIME_TTS_SAMPLE_RATE`)。
5. **`@ricky0123/vad-web` 的 API**(`getStream`、`onFrameProcessed` 签名、资源文件名)随版本变化:Task 2.3 Step 1 核对并锁版本;iOS Safari 上 ONNX/WASM 的性能与它自建的第二个 `AudioContext` 是否被系统限制:未验证(真机)。
6. **iOS Safari**:AudioWorklet 可用性、`AudioContext` 在点击里解锁后跨异步是否保持、外放时回声消除强度、系统手势是否触发 `pointercancel`:只能真机验证(清单 23–32)。
7. **生产环境反向代理(1Panel/OpenResty)转发 WebSocket**:需要用户在面板里开启并调长读超时;未验证。
8. **jsdom 的 `PointerEvent`**:`web/src/test/hold.ts` 带了补丁;Starlette `TestClient.portal` 用于建表(Task 4.5)——若 Starlette 版本不提供 `portal`,改用 `anyio.from_thread.start_blocking_portal()` 自建并在同一 portal 里运行 `TestClient`。
9. **延迟目标(50% / 40%)是估算**:以 Task 0.5/5.1 的实测为准;流式识别不可用时,"松手 → 转写"主要靠 PCM 直采、裁剪与提示词收紧,能否达到 50% 未知。
10. **实时通话费用**:流式识别按连接时长计费、每句一次 TTS;单价未知,默认关闭并设上限。
11. **进程内状态**:票据、并发登记、限流都只在单 worker 下正确;多 worker 部署不受支持(写进文档)。
12. **通话录音一律保存**(与语音消息一致,`save_recordings=true`):录音配额消耗更快;超额时只评测不保存(`assessment.status = "quota"`)。

---

## 计划自检记录

- 设计文档逐节对应:§2 现状 → 「延迟测量方法」与 Task 0.1;§3.1 → R3、Task 1.5/1.6/4.x、Task 5.5;§3.2 → Task 0.1–0.6、1.2、1.3、2.1、2.4、2.6–2.8、5.1;§3.3 → R10、Task 1.2、2.2、2.3、2.5;§3.4 → R11、Task 3.1–3.5;§3.5 → R12–R16、Task 4.1–4.11、5.2;§4 → Task 1.1、1.3、1.4、1.6、4.1–4.6;§5 → Task 2.1、2.3、2.7、3.2、4.7–4.11;§6 → 「已知未决与未验证项」;§7 → 门槛 5;§8 → 阶段 0–5。
- 名称一致性:`BufferedRecognizer`/`VolcStreamRecognizer`/`make_recognizers`、`RealtimeSession`/`Upstreams`/`RealtimeLimits`、`TtsQueue`/`playQueue`/`progress`、`HoldToTalkButton`/`holdReducer`/`MAX_HOLD_MS`、`RealtimeCall`/`useRealtimeCall`/`RealtimeCallDialog` 在各任务的 Interfaces 与代码里一致。
