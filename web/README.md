# Enjoy 手机网页版

手机优先的 PWA,练习子集(登录、跟读评测、AI 对话、查词翻译)。与自建后端同源部署,见 `server/README.md`。

## 开发

    cd server && uv run alembic upgrade head                                 # 全新克隆首次运行必须先建表,否则 API 报 "no such table"
    cd server && uv run uvicorn app.main:create_app --factory --port 8000   # 另一个终端
    yarn web:dev                                                           # http://localhost:5173,/api 代理到 8000

## 别名约定

- `~/…` → `web/src/…`(web 自己的代码)
- `@/…`、`@renderer/…` → `enjoy/src/…`(只读复用桌面端源码;不复制、不修改)
- `@renderer/components`、`@renderer/components/ui` 两个 barrel 被替换为 `src/shims/` 下的精简版;web 代码一律从子路径引入。
- `enjoy/src` 引入的第三方包必须写进 `web/package.json`,否则构建报 `guard-enjoy-deps` 错误。

## 测试

    yarn web:typecheck && yarn web:test && yarn web:build

## 对话增强(语音消息、语法、双语、加入跟读)

- 麦克风发送**语音消息**:录音(≤ 60 秒,可取消)→ 转写 → 气泡显示录音与文字并立即开始回复;发音评测(`source=chat`)与语法检查并行,晚到的结果用 `PATCH /api/messages/{id}` 补写到已保存的消息上。编排见 `src/features/chat/use-voice-turn.ts`(录音与转写)、`turn-results.ts`(评测/语法、补写、放弃清理)、`conversation-page.tsx`(回复与保存)。
- 语法检查:`POST /api/ai/grammar`(提示词与模型由服务端决定),结果按"文本 + 本机提示词版本"缓存在 IndexedDB;规则可在「我的」页自定义或恢复默认。会话设置里可关闭语法检查、打开教练模式与双语。
- 翻译用查词同一套 `cachedTranslate`;界面语言为英文时不显示"译"。句子拆分规则见 `src/features/chat/sentences.ts`。
- 自由说话评测的实测与局限:尚未运行,见 `docs/superpowers/plans/2026-10-05-free-speech-evaluation.md`(复现:`server/scripts/eval_free_speech.py`)。语音消息的语法检查开关 `GRAMMAR_FOR_VOICE`(`turn-results.ts`)目前为 true,其效果未经验证:转写可能悄悄纠正语法,从而显示误导性的"没有语法问题"。

- **对话里的跟读弹窗**(计划 `2026-10-14-shadow-sheet`):对话「不会说?」提示、语法纠正、复盘、转写详情、句子列表面板、选词查词里的「跟读」不再跳到练习页,而是在原地打开底部玻璃弹窗(挂在应用壳里,与查词同层)。弹窗里:先听范读 → 录音(最长 60 秒)→ 16 kHz WAV → `POST /api/speech/assessments`(`save=true`,**不带 `source`**,所以成绩出现在「练习 → 历史」里)→ 就地显示评分环、三项分数、逐词着色(点词走选词操作条查词)、我的录音 / 标准发音、收藏、再练一次 / 下一句(多句入口带上一句 / 下一句)、「查看完整详情」(才跳到带波形的完整页)。录音或评测中关闭会先确认。弹窗本体、玻璃样式与文案随懒加载块进入,不进主包。同样的弹窗也用于「单词操作」面板的「跟读这个词」、发音弱词页、进度页弱词与段位赛练习建议;练习页自己的练习清单与详情页的「再练一次」仍是跳转。**未在真机验证:** iOS 麦克风授权与音频路由、玻璃模糊性能、选词操作条与弹窗底部按钮的叠放、弹窗在软键盘 / 视口锁下的表现,清单见 `docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md`。波形是模拟动画,不随麦克风音量变化。

## 对话页增强(自动朗读、场景、提示、复盘、进度、词汇本、语速、难度)

- **自动朗读**默认开(会话配置 `auto_speak`,缺省即开;设置面板与顶栏喇叭可关):只读"用户这次操作之后完成的新回复"与场景开场白,从不读历史;录音/转写中、页面在后台、回复出错、已读过、被更新的发送取代时不读。iOS 需要在点击里解锁播放器:发送、重试、结束录音、点场景时同步调用 `primeAudioElement`(共享元素 `sharedAutoplayAudio()`),被拦截时显示一次"点此朗读"。**每条回复多一次语音合成调用(有成本)。** 编排见 `src/features/chat/use-auto-speak.ts`。
- **语速**:全局偏好 `enjoy-web.playback.rate`(0.75×/1×/1.25×,退出登录清除),`playbackRate` + `preservesPitch` 作用于所有朗读与语音气泡回放(`src/lib/playback-rate.ts`),不重新合成。
- **朗读音色**(`/me/voice`,「我的 → 朗读音色」):按场景选朗读音色,三个场景各自一行、各选一个模型和音色——单词(词汇、单词本、听写、选中单词的朗读)、句子(跟读范读、拼写句子)、对话消息(对话与房间的消息朗读、自动朗读)。选「默认」跟随服务端 `ai.defaultTts`;「试听」用固定句子,在点击里解锁音频。偏好存在本机 `enjoy-web.tts.voice`,退出登录清除;保存的音色若已不在服务端音色列表里,该场景退回默认并提示。对话里会话设置或角色显式选过的音色仍优先于「对话消息」。只影响朗读播放,不改实时通话音色与 LLM 请求。**未在真机验证:** iOS 上试听与对话自动朗读的解锁。
- **场景与难度**:会话配置 `scenario`/`level`;预设提示词与开场白在 `src/features/chat/scenarios.ts`,难度提示词在 `levels.ts`,系统提示词由 `chat-request.ts` 的 `effectiveSystemPrompt` 拼装。新建会话只写场景与难度,模型/音色在运行时取服务端默认值。
- **"不会说?"提示与复盘**:客户端调用 `/api/ai/chat/completions`(JSON 模式、固定提示词、严格解析);提示按"最后一条助手消息 + 难度"缓存在 IndexedDB;复盘结果写进会话配置 `recap`(≤ 约 6 KB,过期提示"重新生成")。
- **进度页** `/progress`(`GET /api/stats`,带本机时区偏移)与**词汇本** `/vocabulary`(`/api/vocabulary`,盒子法 1/2/4/7/15/30 天);查词抽屉、复盘、进度页都能"加入词汇本"。
- 场景提示词的人工抽查:`docs/superpowers/plans/2026-10-05-scenario-prompt-check.md`。

## 语音提速、按住说话与实时通话(计划 2026-10-07)

> **验证状态**:下面描述的是代码行为。单元测试用的是假设备、假 AudioContext、假上游;真机(iOS Safari、安卓 Chrome)、Docker 里的 Playwright 运行、嘈杂环境效果**都未验证**,清单见 `docs/superpowers/plans/e2e-results.md`(真机第 23–32 项)。延迟数字只引用 `docs/superpowers/plans/2026-10-07-voice-latency.md`。

- **按住说话**(聊天 `src/features/chat/hold-to-talk-button.tsx` 与通话共用 `src/components/hold-to-talk-bar.tsx` + `use-hold-gesture.ts`,手势逻辑是纯 reducer `src/lib/hold-gesture.ts`):
  - 按下即开始申请麦克风(iOS 要求在手势里调用 `getUserMedia`),松手发送;60 s 上限(`VOICE_MAX_MS`)自动发送。
  - 距按下 < 300 ms 的松手视为误触,丢弃并提示"按住说话";麦克风还没就绪(权限弹窗期间)就松手,丢弃并提示"麦克风已准备好,请按住说话",迟到的麦克风会被释放。
  - 手指上移 80 px 进入"落点"模式(回到 40 px 内退出,有滞回):视口左半 = 取消,右半 = 转文字(转写后**填入输入框,不发送**,已有文字时追加)。`pointercancel` / `lostpointercapture` / 页面隐藏(含系统手势打断)一律丢弃,不发送。
  - **键盘后备**:按钮获得焦点后 `Space` / `Enter` 第一次开始、第二次发送,`Escape` 取消;录音期间有可见的"麦克风在用"指示与 `role="status"` 播报。
  - 录音中不允许其他播放(`claimAudio`);按下时先停止朗读。录音期间页面切后台 = 丢弃本次并提示"已取消录音",不再保留草稿——按住与键盘后备开始的录音都一样(R11)。
- **PCM 采集**(`src/audio/capture.ts`、`pcm.ts`、`pcm-recording.ts`、`pcm-capture.worklet.js`):
  - 优先 AudioWorklet 直采,降采样到 16 kHz 单声道 16 位 WAV(带 Kaiser 窗 FIR 低通,截止 7.2 kHz,不用盒式平均,以免混叠影响发音评分);AudioWorklet 加载失败或超时(3 s)、或上下文运行但 500 ms 没有帧,退到 `ScriptProcessorNode`;没有 `AudioContext`、或页面级 `AudioContext` 还没被点击解锁(iOS)、或 PCM 启动失败(权限拒绝/麦克风被占用/非安全上下文除外),退到旧的 MediaRecorder 路径(`recorder.ts`)。
  - 页面只有一个 `AudioContext`,在第一次 `click`/`touchend` 时解锁(`installAudioUnlock`,`main.tsx` 里装一次),被系统打断后下一次点击会重新解锁。
  - 停止即出结果,同步取走样本、释放麦克风;裁掉首尾静音(保留 200 ms 边距);近讲能量门限(−38 dBFS、连续 ≥ 250 ms)判定没有前景语音时**不上传**,直接提示"没听清"。这只能**降低**旁人声音的影响,不能排除;嘈杂环境效果未验证,16 kHz 采集对发音评分的影响也未验证。
  - worklet 文件在构建产物 `/assets/` 下(`vite.config.ts` 的 `assetsInlineLimit` 排除 `*.worklet.js`,否则会被内联成 `data:` URL),由既有 service worker 缓存。
- **按句朗读**(`use-tts-player.ts` 的 `TtsQueue`/`playQueue`、`use-auto-speak.ts` 的 `progress`):回复流到第一句结束就开始合成并播放,后面的句子排队,最多预取 2 句;每句一次 TTS 调用(**自动朗读的调用数从每条回复一次变为每句一次**),缓存键是句子文本。回复短到流式期间没有完整句子则回退到整条朗读。切句规则与服务端共用 `server/tests/fixtures/sentence_cases.json`(网页端 `sentence-stream.ts` 读取同一个文件做一致性测试,长度按 Unicode 码点计)。句间复用页面既有的 `<audio>`,两句之间可能有数十毫秒间隙(真机听感未验证)。
- **延迟打点**(`src/lib/latency.ts`):只记时间,不记文本。每一轮语音/文字对话产生一条记录,最近 50 条保存在 `window.__enjoyLatency`(数组,每项含 `kind`、`status`、`marks`、`spans`)。读法:
  - 控制台输入 `localStorage.setItem("enjoy-web.debug.latency", "1")` 后刷新,每轮结束会打印一行 `[latency] {...}`;不开也可以直接在控制台看 `window.__enjoyLatency`。
  - 标记:`release`(松手/点停止)→ `audio_ready` → `transcript` → `reply_first_delta` → `reply_done` → `tts_request` → `first_audio`。`spans`:`transcriptMs`(松手 → 转写出现)、`replyMs`、`firstAudioAfterReplyMs`(回复完成 → 开始出声)、`firstAudioAfterReleaseMs`(松手 → 开始出声)。
  - **按句朗读时 `first_audio` 通常早于 `reply_done`,所以 `firstAudioAfterReplyMs` 可能缺失或为负,比较前后请用 `firstAudioAfterReleaseMs`**。`status: "aborted"` 的记录(出错、取消、被新一轮取代、120 s 超时)不要拿来算中位数。
- **实时通话**(服务端 `REALTIME_ENABLED=true` 且浏览器有 `AudioContext` 时,会话页顶栏出现"通话"按钮;代码在 `src/features/realtime/`):
  - 点击的同步阶段先解锁页面 `AudioContext`(`prepareCallAudio`),然后依次:请求一次性票据 → 申请麦克风 → 加载 VAD → 连接 WebSocket `/api/realtime?ticket=…`。**麦克风申请不在点击的同步阶段**,iOS 上是否允许未验证。
  - 浏览器端 Silero VAD(`@ricky0123/vad-web` 0.0.31 + `onnxruntime-web`)断句,检测到说话才上传 16 kHz PCM;机器人说话期间 VAD 门限提高(概率 ≥ 0.8、能量 ≥ −30 dBFS、最短 400 ms)以防回声误打断,播放结束后恢复;外放回声保护强度未验证。判定在 `src/audio/speech-gate.ts`:等待开始时用漏桶计数(说话帧 +1 帧,其余帧 −1 帧、不低于 0,累计达到最短时长才开始),说话中概率低或能量低的帧都算静音;起点之前的 500 ms(`PRE_ROLL_MS`)一并上传,避免首词被裁。已知代价:正常模式下背景有人说话时可能误起(合成仿真里约 21/200 次每分钟),安静说话者(低于 −38 dBFS)会被裁;这些只有合成仿真,**真实设备上未验证**。
  - 服务端识别 + LLM + 逐句 TTS,下行 24 kHz PCM 经 WebAudio 排队播放;打断(barge-in)时立即停播并发 `interrupt`,丢弃旧轮次的迟到音频。
  - VAD 加载失败时自动切到"按住说话"模式并提示(还有"点一下开始/再点结束"的备用开关)。每一条结束路径(挂断、服务端关闭、麦克风丢失、页面切后台、卸载)都释放麦克风与自己创建的 `AudioContext`,页面级共享上下文不被关闭;这些由 `realtime-call.test.ts` 等单测断言(假设备)。
  - **切后台 = 挂断**,回到前台显示"因切到后台已结束"(iOS 不允许后台保活);通话期间页面其余部分 `inert`,通话字幕里**不支持**查词。有未发送的本地状态(待 Retry 的保存、失败的回复、语音草稿)时不能开始通话(提示先发送、重试或丢弃);挂断时麦克风、VAD、播放器立即释放,但 WebSocket 留到服务端存完被打断的回复、自己关闭为止(最多 3 s);随后重新拉取消息列表,约 2 s 后再按消息 id 补取一次(服务端在关闭之后才链接的发音评测),这期间输入与麦克风禁用(从关闭起最多 6 s)。复盘/进度/词汇本可直接用,晚到的语法结果按消息 id 补到气泡上。
  - **通话里的按住说话**(按住说话模式):控制台按键行下面是一条整宽 44 px 的"按住说话"长条(取代原来的 52 px 圆键),手势、阈值(300 ms 误触、上滑 80/40 px)、浮层与落点、读屏播报、键盘(`Space`/`Enter` 开始与发送、`Escape` 取消)都与聊天相同;进入落点时有一次轻触觉(`navigator.vibrate`,iOS Safari 不支持,静默跳过;聊天的长条也一样)。上滑到"取消"松手(或按得太短、手势被系统取消、失焦)→ 发 `utterance_cancel`,服务端丢弃已收到的音频,**什么都不到 AI**。上滑到"转文字"松手 → 同样 `utterance_cancel`,同时把按住期间的音频(含 500 ms 预录,最长 60 s)在本地转成 WAV,走聊天语音消息同一个转写接口 `/api/ai/audio/transcriptions`(英文提示),结果放进控制台上方的小玻璃面板,可编辑,「发送」作为用户这一轮发出(新的客户端消息 `user_text`:服务端跳过识别,与识别完成的一句走同一条路——保存 → LLM → TTS,同样消耗一次额度,不做发音评测),「丢弃」/`Escape` 关掉。转写会多一次 STT 调用;真机手感与触觉**未验证**。
  - 开发服务器的 `/api` 代理已开启 `ws: true`;生产环境需要反向代理转发 WebSocket,见 `server/README.md`。
- **VAD 资源自托管**(不访问任何 CDN):`scripts/copy-vad-assets.mjs` 在 `yarn dev` / `yarn build` 之前把 4 个文件从 `node_modules`(`@ricky0123/vad-web/dist` 的 `silero_vad_v5.onnx`、`vad.worklet.bundle.min.js`,`onnxruntime-web/dist` 的 `ort-wasm-simd-threaded.wasm`、`.mjs`)复制到 `public/vad/<vad-web 版本>-ort<onnxruntime-web 版本>/`(取两个包的*已安装*版本,目前 `0.0.31-ort1.30.0`;任一包升级都会换 URL,缓存优先的 `sw.js` 不会给出旧文件;复制前会删掉 `public/vad/` 下的其他版本目录,`dist` 里不带旧版本;该目录被 git 忽略)。运行时从同源同一路径加载(`vite.config.ts` 的 `__VAD_ASSET_BASE__` 与脚本共用 `scripts/vad-assets.mjs`),`sw.js` 按 `/assets/` 同样的规则缓存。首次使用约 16.6 MB(wasm 14.2 MB + 模型 2.3 MB),蜂窝网络下的加载时间**未验证**。脚本发现文件数不是 4 会报错;升级这两个依赖后要重新核对文件名。
- **测延迟**:
  - 服务端层:本机起 uvicorn(被测进程带 `UPSTREAM_ASR_MODE=chat` 作基线口径,临时 SQLite),`cd server && uv run python scripts/measure_latency.py --base-url http://127.0.0.1:8765 --label after --samples ../.superpowers/latency --runs 7 --out ../.superpowers/latency/after.json`。样本先用 `server/scripts/latency_samples.py` 生成到 `.superpowers/latency/`(不提交)。
  - 浏览器层:先按下面「E2E」起 E2E 栈,然后(chromium-mobile,假麦克风文件):`E2E_LATENCY=1 E2E_FAKE_AUDIO=<repo>/.superpowers/latency/s5.wav E2E_HOLD_MS=5000 yarn playwright test e2e/latency.spec.ts --project=chromium-mobile`(s15 换成 `s15.wav` 与 `E2E_HOLD_MS=15000`;`E2E_LATENCY_RUNS` 默认 5);输出里的 `LATENCY_RESULTS {...}` 一行就是各轮 `spans`(第一轮热身已剔除)。要真实上游(识别、LLM、TTS),会产生费用。
  - 方法(N、中位数、同日同机)、基线与结果表都在 `docs/superpowers/plans/2026-10-07-voice-latency.md`;`latency.spec.ts` 与 `hold-to-talk.spec.ts`(Playwright 触摸)**写好后没有在 Docker 栈上运行过**(本环境没有 Docker),第一次运行可能要调整触摸合成与选择器。

## 段位赛与联机练习(计划 2026-10-09)

两个功能都由服务端开关控制(`RANK_ENABLED`、`ROOMS_ENABLED`,默认关,见 `server/README.md`「段位赛与联机练习」)。关闭时网页与原来完全一样:底部导航 3 个标签,练习页没有段位卡,练习页只多请求一次 `GET /api/rank/config`;`GET /api/rooms/config` 只在进入对话区(`/chat`、`/rooms`、`/rooms/ended`)与「我的」时请求一次(同一 ApiClient 缓存,导航本身不再读取;`src/layout/feature-flags.test.tsx`、`src/layout/bottom-nav.test.tsx` 断言);直接打开 `/rank`、`/rooms` 只显示"未开启"。

- **段位赛**(`src/features/rank`):练习页顶部的段位卡 → `/rank`(段位、小段进度、阶段练习、赛季、晋级赛卡)→ `/rank/match/:id` 晋级赛 → 结果页;`/rank/achievements` 成就墙。晋级赛**只收语音**:复用共享的按住说话长条但传 `allowToText={false}`,没有「转文字」落点(上滑只能取消);考官台词默认只播放不显示(「看文字」可开);iOS 在点击/松手的同步阶段预热播放。评分失败的场次在服务端仍算「进行中」(会挡住新的晋级赛),错误卡同时提供「重新打分」与「放弃本场」。未通过不使用红色。
- **联机练习**(`src/features/rooms`,「对话」标签里的「AI 对话 | 联机」切换;联机关闭时没有切换条;URL 仍是 `/rooms…`,邀请链接不变;切换条在 `src/pages/chat-hub.tsx`):输入 6 位房间号加入或建房;群聊经 `WS /api/rooms/ws`(一次性票据,不进日志与错误信息),断线按 `last_seq` 重连补齐,服务端重启(1012)自动重连;`@ai` 的回答所有人可见;私聊助手(组句)只给自己,一键发到群里;房主可锁定、关闭 AI、移出成员、结束房间;已结束的房间只读可查历史;可举报他人消息。
- 与服务端的契约:`src/features/rank/rank-contract.test.ts`、`src/features/rooms/rooms-contract.test.ts` 读取 `server/tests/fixtures/{rank,rooms}_contract.json`(由服务端测试对真实应用录制/核对),逐键绑定 TypeScript 类型。
- **联机练习 v2**(spec `docs/superpowers/specs/2026-10-10-rooms-v2-design.md`;服务端见 `server/README.md`「联机练习 v2」):创建表单 7 项设置(房间名、场景、水平、加入方式、人数、AI 公开回答、允许语音);「需房主同意」的房间凭号申请、房主在横幅里同意后自动进房;邀请链接与本地生成的二维码(`/rooms/invite/:token`,直接进入);助手改为停靠在输入条上方的面板(三档高度,键盘弹出收成一行,不遮挡聊天);语音消息(与对话页同一手势,上传 16 kHz WAV,服务端存 MP3;转写与翻译全房共享,「转文字」「翻译」手动展开或在「我的」里开自动转文字);引用回复、6 个表情回应、正在输入/正在说话;房间结束后的学习小结(`/rooms/r/:roomId/summary`)。语音与小结各有服务端子开关(默认关)。语音配额为每人每天 200 MB + 100 条。
- 契约:`src/features/rooms/create/rooms-v2-contract.test.ts`、`extras/extras-contract.test.ts`、`voice/voice-contract.test.ts` 分别核对 `server/tests/fixtures/rooms_v2_{core,summary,voice}_contract.json`。E2E:`e2e/rooms-v2.spec.ts`(两个上下文审批加入、引用、回应、正在输入、助手面板不遮挡、邀请链接第三人进入;语音上传用契约样例应答,零上游成本)。
- **联机练习 v2 未在真机验证**(iOS Safari 与 Android Chrome 各一台;结果记在 `docs/superpowers/plans/e2e-results.md`「Rooms v2」):按住说话录 10 秒并发送、上滑取消、上滑转文字;对方播放 MP3(iOS `<audio>` 播放 Blob)、语速跟随;键盘弹出时助手面板收成一行与恢复(`visualViewport`);拖动面板三档;切后台/锁屏再回来重连与补齐;二维码被另一台手机扫码打开;邀请链接从微信等应用内浏览器打开;Android 数字键盘粘贴房间号;自动转文字设置在真机上的表现。
- **未在真机验证**:iOS 后台/锁屏后房间重连;Android 数字键盘粘贴 6 位房间号;晋级赛在 iOS 上首轮 AI 台词的自动播放;晋级赛按住说话(无转文字落点)的真机手感。「对话 / 联机」合并(计划 L6)的设备清单见 `docs/superpowers/plans/10.21-plans/2026-10-21-l6-results.md`,全部未验证。
- **未在真机验证**:iOS Safari 点输入框页面跳到顶部的修复(`useAppHeight` 在键盘相关事件后 `scrollTo(0,0)` 复位 + 固定 `html` / `body`,计划 `2026-10-13-ios-keyboard-scroll`)。清单见 `docs/superpowers/plans/2026-10-13-ios-keyboard-scroll-device-checklist.md`。

## 背单词(计划 2026-10-10)

服务端开关 `WORDBOOK_ENABLED`(默认关,见 `server/README.md`「背单词」)。关闭时网页与原来一样:练习页没有「背单词」大卡,「我的 → 学习」没有「背单词」一行,页面加载时只多请求一次 `GET /api/wordbook/config`;直接打开 `/wordbook` 显示「背单词未开启」。

- **入口与路由**(`src/features/wordbook`):练习页大卡(未选书 → 「选择词书」;已选书 → 今日计划环、待复习与新词剩余)、「我的」一行 → `/wordbook` 首页(今日计划、已掌握/已学/剩余、明天预计复习)、`/wordbook/books` 选书与每日设置、`/wordbook/learn` 学新词(5 张词卡 → 释义小测,答错回队尾 → 小结)、`/wordbook/review` 复习(释义选择、看释义选词、例句选词、听写、拼写五种题型)、`/wordbook/spell` 按句拼写。没有自己的底部标签,停留在这些页面时高亮「练习」。各页面按路由懒加载(主包只多了入口卡、「我的」一行与文案)。
- **拼写入口**(`src/features/wordbook/word-spell`,计划 2026-10-27):`/wordbook/spell` 是入口页,两项:**例句拼写**(`/wordbook/spell/sentences`,即原「按句拼写」,行为不变)与 **单词拼写**(`/wordbook/spell/words`)。单词拼写一轮 10 个(可选 20),玩法切换:**单词听写**(只有朗读键,界面不显示单词)与 **看中文拼英文**(中文释义 + 旁边的朗读键;音标不显示)。看中文拼英文想不起来时,点输入框下方的「想不起来?点这里看单词」按钮(手机上的主入口)、点输入框的虚线边框或旁边的小眼睛按钮看单词,开始输入后单词自动收起;点输入框本身只聚焦、不偷看。偷看过的题按「用过提示」(得分减半),反馈里标「看过单词」。答题页顶部可以中途切换玩法(当前题清空重答、进度保留、不弹确认);每题可以「跳过」(不提交、不计入答对,小结里写「跳过 N 题」)。听写的重播键每次都会重新播放。只有服务端没配朗读时才会强制看中文拼英文。判分复用 `/answers` 的自由练习路径(`mode: "free"`):**不改盒子、不计入复习进度和段位**。**未在真机验证**:iOS 点输入框边框时是否收起键盘、Android Gboard 组合输入时的自动收起、「开始」之后第一题的自动朗读、iOS 上重播键的音频解锁、读屏对偷看牌子的播报。桌面 Chromium 的手机视口(触摸模拟)已验证:触摸偷看(按钮与框线)、中途切换、跳过、听写重播(媒体 play 调用次数增加;同一单词的重播命中共享缓存,不再发出朗读请求)、答错后的重播与「跳过 N 题」小结。慢速朗读开关未做(服务端的朗读接口没有语速参数)。
- **例句拼写**(`src/features/wordbook/spell`):3–6 句一组,只挖目标词(多词词头拆成连续空),一个隐藏输入框管理全部空(`autocomplete/autocorrect/autocapitalize/spellcheck` 关闭,16px 字号防缩放);空格跳到下一空、空的空上退格回到上一空、回车提交;默认不显示字母数(设置里可开,存在本机 `enjoy-web.wordbook.prefs`,退出登录时清除)。「首字母」提示(该空得分减半)与「听这句」使用句中的实际词形(go → went,服务端随空下发 `form`,提交前不显示)。结果分四种(正确 / 小笔误 / 词形不对 / 错误,图标 + 文字,错误用中性灰而不是红色),笔误逐字母标出差异,每个词有「为什么?」与「举报例句」。
- **AI 讲解**:「为什么?」只在服务端 `WORDBOOK_AI_ENABLED` 打开且配置了 LLM 时请求;不可用时显示「AI 讲解暂不可用」,词典讲解照常。讲解按纯文本显示。
- **判分全部在服务端**:网页从不自己判对错;选择题的正确项由 `/api/wordbook/answers` 的 `correct_option` 给出。
- 契约:`src/features/wordbook/wordbook-contract.test.ts` 逐键核对 `server/tests/fixtures/wordbook_contract.json`(服务端测试对真实应用录制)。E2E:`e2e/wordbook.spec.ts`(选书 → 学 5 个词 → 小结 → 首页与大卡计数 → 按句拼写提交 → 「我的」一行;零上游:守卫只放行 `/api/wordbook/*` 的数据库路径,`/api/wordbook/explain` 不放行)。
- **背单词 v2:认识 / 模糊 / 不认识 与「快速回忆」**(计划 2026-10-11-wordbook-recall):新词卡的释义先被遮罩盖住(遮罩时释义、例句不在页面里),下面三个键 认识 / 模糊 / 不认识;点遮罩算偷看,之后的「认识」按「模糊」记。盒子由服务端决定(认识 → 第 3 级,模糊 → 第 2 级,不认识 → 第 1 级;同一个词连续两次模糊按不认识记),「认识」按管理端比例(默认 33%,`WORDBOOK_SPOT_CHECK_PCT`)被抽查,点得太快(< 1 秒)必抽。一轮 5 张评完进入本轮小测:模糊的词、不认识的词(两次:选释义 + 看释义选词)、被抽查的认识词;小结多一行「认识 · 模糊 · 不认识」与「抽查 · 通过」。复习页声明支持后,盒 1/2/4/5 的到期词约 40% 出「快速回忆」:只看词头自评 → 翻面核对,认识按同一比例先答一道选释义,认识之后可点「记错了」。管理端设置:抽查比例、快速回忆开关、自动朗读(第一次点击之后才自动读,「不认识」总是读)、翻开后显示例句。E2E:`e2e/wordbook-recall.spec.ts`(栈要 `WORDBOOK_SPOT_CHECK_PCT=100`;复习段需要 `E2E_SQLITE_PATH`(本机临时 SQLite)或 `E2E_COMPOSE_PROJECT`(Docker 栈)把词改到期,否则那一段跳过并写注解)。未在真机验证:iPhone Safari / 主屏 PWA 的第一次点击后自动朗读、「不认识」立即发声与三键 dock 的安全区;中低端安卓的翻面动画与玻璃 dock;VoiceOver / TalkBack 读遮罩「已折叠」;两平台深色下遮罩与卡片的区分;360px 宽下英文「Don't know」等按钮标签。
- **背单词:释义默认仅英文**(计划 2026-10-13-defs-default):没存过偏好的用户翻开词卡只看英文释义;这张卡没有英文释义(国家 / 城市等)时自动显示中文;卡片右上角的「中」按钮临时显示这一张卡的中文释义(不保存,换卡复位);「每日目标」面板里「短语:自动展开 / 收起」只管学新词页,存在本机。小测题面仍是中文。未在真实浏览器 / 真机验证:「中」按钮在 360 / 375 px 下与徽标的并排、深色下的按下态;E2E `wordbook-recall.spec.ts` 已改成先切到「中英」但本轮未运行。
- **复习页答题后界面**(计划 2026-10-13-review-after-answer,2026-10-14-review-bilingual-longpress 修订):选择题答完后,「看单词选中文」的每个选项保留原来的中文,下面加一行小字英文单词(对错项都一样);「看中文选单词」的每个选项显示单词 + 小字中文与词性。题目下方出「学习内容」(英→中:英英释义 + 最多 3 条短语 + 朗读;中→英:正确单词的卡片);「仅英文」偏好下中文释义与短语译文藏在区内的「中文」按钮后面(换题复位),「中文 / 中英」偏好或没有英文释义的词直接显示中文。**点词查词**:答后点一下选项里的英文单词出现横线,再点一次选中它并弹出选词操作条(查词 · 朗读 · 加入生词本);答题前选项是按钮,不参与。第一次答题后在题下提示一次「点一下单词会出现横线,再点一次查词」,记在本机 `enjoy-web.wordbook.prefs`(`tapLookupHintSeen`,退出登录清除;旧 `longPressHintSeen` 忽略)。服务端 `/api/wordbook/answers` 对这两种选择题追加可选的 `option_info`(进程内备忘,取不到就省略,网页退回旧显示)、`phrases`、`example`。查词抽屉在「仅英文」下也有同样的「中文」按钮(每次查词单独记)。听写 / 看释义拼写(键入题)答完后也在题下出同一块「学习内容」(批次词卡的英英释义 + 短语 + 例句 + 朗读,「中文」按钮默认收起;批次里没有该词卡则保持原样);快速回忆抽查答完翻面后本来就显示词卡,故不重复。学新词小测不变。**未在真机验证**:Android Chrome 上点第二下的程序化选中是否不会弹出系统原生工具栏(复制 / 全选 / 分享);各浏览器对 CSS Custom Highlight API 的支持与不支持时的横线回退;横线在玻璃背景上是否清晰;一次性提示;iOS Safari 点词;读屏;清单与结果见 `docs/superpowers/plans/2026-10-15-tap-lookup-results.md`。
- **每日目标面板**(计划 2026-10-11-wordbook-goals):首页顶栏齿轮(「每日目标设置」)与今日计划卡齿轮(「调整今天的目标」)打开同一个底部面板,改动即存、首页计数立刻变化(失败退回并说明原因):方案 轻松 / 标准 / 冲刺(「约 N 天学完 · 稳定后每天复习约 5N」,按全对模型在网页端估算,学到最后的复习量写在说明行)、每日新词(10/20/30/50 + 自定义 1–200)、每日复习上限(50/100/200 + 自定义 10–1000 +「不限」)、今天预览与积压说明(积压时今天新词总数最多 5 个)、顺序、今天加练(5/10/20,今天新词学完且没有积压才可用)、连续达标(第四格「连续 N 天」)、换书 / 暂停 / 重置进度(输入书名确认,唯一的红色)。暂停后首页显示暂停卡(继续学习 / 换一本),不再跳选书页;选书页用同一组设置字段。管理员可在设置注册表收窄范围、关闭「不限」与加练,面板相应禁用并写原因。E2E:`e2e/wordbook-goals.spec.ts`(零上游;本机临时 SQLite 服务通过,未在 Docker E2E 栈运行)。未在真机验证:iOS / 安卓数字键盘(`inputmode="numeric"`)与 Gboard 回车提交、搜狗全角数字与重置框中文组字、面板内焦点困住与关闭后回到齿轮、VoiceOver / TalkBack 读方案卡(天数与复习估算)与步进器、两平台深色下选中描边。
- **未在真机验证**(清单见 `docs/superpowers/plans/e2e-results.md`「背单词」):iOS Safari 系统键盘与简体拼音、Android Chrome + Gboard、搜狗输入法下的拼写输入(空格跳空、退格回跳、回车提交、输入法组字);读屏(VoiceOver / TalkBack);真实 TTS 的「听这句」;Docker E2E 栈上的 `wordbook.spec.ts`。

## 学习联动(计划 2026-10-11)

服务端开关 `LINKS_ENABLED`(默认关,见 `server/README.md`「学习联动」)。关闭时网页与原来一样:页面加载只多请求一次 `GET /api/links/config`,所有插槽只渲染核心贡献(「加入词汇本」按钮,DOM 与直接渲染完全相同,`src/plugins/word-actions/parity.test.tsx`),联动路由不可达(直达 `/me/links` 等先空白一瞬再回练习页)。

- **组合方式**:`src/lib/extension-points.ts`(类型化扩展点注册表 + 旗标)与 `extension-points-react.tsx`(`<Slot>`、`<WordActions>`、每个贡献一个错误边界);`src/plugins/index.ts` 一行一个插件(`core`、`links`、`word-actions`、`daily-tasks`、`mistakes`、`pron-shadow`、`chat-words`),feature 的 `register*.ts(x)` 只被插件导入(`src/architecture.test.ts`)。删掉一行 = 删掉一个联动。
- **入口**:生词本按钮旁的「更多」→「单词操作」面板(加入词汇本 / 加入词书学习 / 跟读这个词 / 查看词卡);练习页「今日任务」卡(背单词、跟读一句、对话一次、段位阶段任务、对话用今日词);跟读区的「发音弱词」「今日新词例句」来源条;生词本「易错词」「发音弱词」入口与页面;词卡上的「对话里用过」小标;「我的 → 学习联动」六个开关(管理员关掉的置灰并说明,乐观更新、失败回滚)。页面与面板懒加载。
- **测试**:`src/plugins/links-matrix.test.tsx`(全关只剩核心贡献;全开每个点的贡献;只开一个不带出别的联动);各插件的契约测试逐键核对服务端录制的 `links_*_contract.json`。`src/test/setup.ts` 只给「依赖图里有 `extension-points-react`」的测试文件加载核心贡献。E2E:`e2e/links.spec.ts`(零上游;栈要 `LINKS_ENABLED=true`)。
- **主包**:联动合计 +7.79 kB gzip(506.54 → 514.33 kB;验收上限 +8 kB,余量很小)。
- **未验证**(见 `docs/superpowers/plans/e2e-results.md`「学习联动」):Docker E2E 栈上的 `links.spec.ts`;真机(iOS Safari / 安卓 Chrome)上的「更多」面板、今日任务卡、开关页;VoiceOver / TalkBack 读开关与今日任务行;真实评测产生的发音弱词;大模型用法检查的真实上游。

## 智能体记忆页

`/me/agents/memory`(`src/features/agents/memory/`):档案 / 长期 / 回顾 / 管理四个标签;单条删除、按角色清空、清空全部都经抽屉二次确认,文案写明永久。**未验证**:智能体记忆页未在真机、真实上游(记忆整理模型)、Postgres 上验证;360 px 宽度只有结构性测试(英文标签长度、无固定像素宽度、只有筛选条横向滚动),jsdom 没有布局,没有在真实浏览器里量过。

## 智能体导师模式「带我学」

智能体对话输入条提示行右侧的「带我学」入口 → 开始面板(主题 / 场景 / 题数 5·8·12 / 回答方式)→ 导师先出题,你打字或语音回答,每题即时点评;带学条(`src/features/agents/tutor/`)显示第 n / m 题、难度、提示 / 跳过 / 听一遍 / 翻译、两次点击结束;答完最后一题或结束后弹出总结抽屉(得分分布、做得好、要加强、建议加入生词本的词,经 `<WordActions>` 扩展点)。语音回答走对话页现有的「按住说话 → 转写」路径,转写文字就是回合文本,带学条本身不录音。导师组件全部懒加载,经 `agents/chat-parts.tsx` 的 `TUTOR_SLOTS` 接入对话页。**未验证**:真机 iOS Safari / 安卓 Chrome 上的「听一遍」(TTS)与语音回答;真实上游模型对 META 协议的遵守率(回落率未实测);Postgres;反向代理下的 SSE;360 / 375 px 宽度只有结构性测试(英文标签长度),没有在真实浏览器里量过;刷新页面后不会自动回到进行中的带学(服务端会话保留,再点「带我学」会续上)。

## 更新日志(计划 2026-10-14)

练习页顶栏「练习清单」图标左边有「更新日志」入口(星花图标;没有已发布条目时不显示;有未读时红点 + 提示环,第一次出现未读时一条一次性小提示,「已显示」记在本机 `enjoy-web.changelog.prefs`,退出登录清除)。点开进入整页 `/practice/changelog`(懒加载):月份分组、类型筛选、首条展开、「新」角标、超过 2 条折叠、滚动 + 按钮分页、离线时显示上次保存的第一页。未读数与已读位置在服务端(`GET /api/changelog`、`POST /api/changelog/seen`,多设备同步),内容由管理后台的「更新日志」页写。**未验证**:真机 iPhone 上的入口红点与提示环、页面滚动与分页、`IntersectionObserver` 自动加载;清单见 `docs/superpowers/plans/2026-10-14-changelog-device-checklist.md`。

## 跟读库「精选」(计划 2026-10-14-curated-library-web)

跟读库列表页顶部在服务端开着精选库(`GET /api/library/config` 的 `catalog` 为真)时多一条「我的素材 / 精选」分段(`/library?tab=catalog`,为假时没有分段、`?tab=catalog` 被忽略)。「精选」列出管理员已发布的内置素材:封面(没有封面是耳机图标渐变底)、标题、级别(客户端筛选芯片)、至多 3 个标签、时长 · 句数、许可说明一行;≤ 390 px 是紧凑行卡,≥ 430 px 才是 2 列。「添加到我的库」是幂等的,成功(含已添加过)进入播放页,已添加的卡片显示「已添加 · 去学习」;添加时条目已下架(404)会弹「这条精选素材已下架」并立刻把卡片从列表去掉。目录为空显示「精选素材正在准备中」。「我的素材」里的副本带「精选」徽标、大小处显示「不占空间」、没有 ⋯ 菜单(不能重新识别 / 重新分句),删除确认有单独的文案(原条目不受影响,可重新添加);播放页对有封面的音频条目显示 16:9 封面,副本自带译文,即使管理员关了 AI,「译」开关也能显示已存的译文(不会请求新的)。组件在跟读库的懒加载块里,不进主包。**未验证:** 真机(iOS Safari / 安卓 Chrome)上精选网格的滚动性能与玻璃效果;iOS / 安卓上播放共享的音频(Range 播放、单句循环精度);用真实目录(管理员真实导入并发布)走完整的「添加 → 播放」流程;未在真实浏览器里量过 360 / 390 / 430 px 的版面(只有 CSS 结构测试)。

## 级别标注(计划 2026-10-14-level-annotations)

凡是显示 CEFR 级别代码的地方都带上中文级别名(「B1 · 中级」;英文界面「B1 · Intermediate」),让人选级别的地方(对话「英语难度」、房间「目标水平」、角色「英文水平」、记忆页「水平」、精选「按级别筛选」)旁边有一行说明这个级别的意思(如「能应对大多数日常场景」),读屏经 `aria-describedby` 读到。房间目标水平的分段控件改为两行(代码 + 级别名),不选时说明「不选时按你的段位自动定」。段位首页「对齐 CEFR」下也有一行说明。存储与提交的值不变。共用 `src/lib/levels.ts` + `src/components/level-hint.tsx`,文案 `web.level.*` 在 `src/components/i18n`;管理后台的级别下拉 / 列 / 详情用同样的中文(`admin/src/lib/levels.ts`,测试逐字比对)。**未在真机验证:** 360–390 px 宽下分段控件两行字是否截断(英文界面「Upper intermediate」等短标签在 375 px 宽的 5 段里必然被省略号截断,是否可接受待看真机截图)、精选芯片与角色芯片换行后的排布、对话顶栏副标题与带我学条的截断位置、读屏是否读出说明行、深色模式下说明行的对比度;清单见计划「真机 / 视觉清单」。**主包体积未测:** `components/i18n` 是急切文案(每种语言 +13 键、chat 里 −4 键),`lib/levels.ts` 与 `LevelHint` 可能进主包,`yarn web:build` 与 `scripts/main-bundle.mjs` 未运行(超出预算再议把说明句移到懒加载)。E2E 未运行。

## 液态玻璃皮肤(计划 2026-10-15-liquid-glass)

「我的」首页只留高频项:一张个人卡(头像、用户名、邮箱绑定状态、三项统计,整张卡进入 `/me/account`)、学习、偏好(播放速度、外观、语言、联机自动转文字、安装提示)与设置(账号设置 → `/me/account`:昵称、头像、邮箱、改密、邀请码、退出登录;语法检查规则 → `/me/grammar`,「恢复默认」在顶栏且仍先确认;语音服务 → `/me/services`,只读展示)。

全应用换上液态玻璃外观:`<html data-glass="v2">` 在 `main.tsx` 里对所有人设置(`lib/glass-flag.ts`;旧的开发开关 `?glass=v2` / `enjoy-web.dev.glass` 已移除,首次加载会清掉它);`/library*`(跟读库)与 `/practice/changelog`(更新日志)由 `GlassRoutePin` 钉成 `data-glass="pin"`,继续使用经典皮肤,这些页面用到的共享组件因此永远保留经典分支。外观设置在「我的 → 外观与主题」(`/me/appearance`):预设(清透 / 磨砂 / 实色;默认是清透,从未自定义过的设备没有存储,直接得到它;已存主题保持原值,「恢复默认」回到清透)、透明度、模糊、圆角、边缘高光、阴影、浅色 / 深色各一套背景(渐变、颗粒、纯色、自定义颜色,过深或过浅会自动调整以保证文字可读)、玻璃效果「减弱」。设置只保存在本机(`settings/glass-theme-store.ts`),退出登录时清除。`theme-color` 随所选背景变化(`layout/color-scheme.ts`)。类名约定:在原有类名后追加 `liquid:` 变体与 `components/liquid.ts` 的 `LQ_*` 常量,不改已有令牌的值;守卫测试在 `src/styles/`(`glass-budget`、`locked-pages`、`liquid-colour-guard` 等)。经典分支仍留在代码里(回滚只需还原一次提交);删除它们是后续工作。

**未在真机验证(液态玻璃):** 低端安卓上 3 层模糊的真实模糊质量与帧率;iOS Safari 底部弹窗进入时的模糊闪烁;顶部胶囊淡入与模糊的配合;自定义背景在户外的可读性;石墨色气泡上的查词高亮;单色答题反馈是否一眼可辨;320–360px 宽度下的大标题;iOS 的 `prefers-reduced-transparency`;不支持 `:is()` / `rgb(r g b / a)` 的旧 WebView。清单见 `docs/superpowers/plans/2026-10-15-liquid-glass-device-checklist.md`。

## 对话主页与每日问候(计划 2026-10-23-chat-home-daily-greeting)

开关 `CHAT_HOME_ENABLED`(服务端,管理端可热改;网页读 `GET /api/chat-home/config`):**关(或配置 404 / 失败 / 超过 3 秒)= 旧界面原样**——`/chat` 是旧会话列表、`/chat/:id` 是旧对话页、`/chat/new` 跳回 `/chat`;旧列表页与旧对话页各自成懒加载块。**开 =** `/chat` 是「今天的对话」(用户本地日,每天新建一个默认对话,角色默认「学习伙伴」),`/chat/:id` 在同一个外框里显示指定对话(从不弹问候),`/chat/new` 是只在本地的新对话草稿(不建服务端对话;[选择角色] / [直接开始] / [从场景开始] 才真正创建,然后 `replace` 到 `/chat/:id`;没有输入框,[直接开始] 等于旧的「自由对话」)。外框:左上角历史按钮 → 左侧浮动抽屉(今天置顶、按最近活动日分组、可删除今天的对话,删除后立即重建并写回问候、不弹窗);标题「今天 · 周五」;右上角通话 + 设置。设置面板:本对话角色(单选 + 「更多角色」)、问候语言(中文 / English / 中英双语)、问候时机(每天首次 / 每次上线 / 关闭)、问候里提学习数据、本对话的双语 / 自动朗读 / 语速、复盘、更多对话设置、重播今天的问候。旧顶栏的「调整」弹出面板只在旧外框里出现。

问候弹窗:只在对话主页 `/chat` 出现(别的页面、深链都不弹;「打开」发生在别处时,本次打开期间第一次进入 `/chat` 再弹)。「打开」= 冷启动,或回到前台且隐藏 ≥ 30 分钟。`daily` 只在服务端 `first_view` 为真且本机今天没弹过时弹(出现时上报 `seen`);`every_open` 每次打开都弹,只重放弹窗、**不追加消息**;`off` 不弹也不生成。重播不调用 `/today`、不上报 `seen`、不写本机标记。弹窗关闭时三行问候飞入对话里对应的问候气泡;气泡是普通助手消息(听 / 翻译 / 跟读 / 查词照旧,朗读的是不含 `*` 的原文)。数据与隐私:`/today` 结果只放内存(登出清空);`localStorage` 只存 `enjoy.chatHome.shown`(日期)与 `enjoy.chatHome.roleHintSeen`(`"1"`);URL 里只有对话 id。主包:路由分发、开关钩子、打开检测的挂载壳在主包里,新主页 / 抽屉 / 设置面板 / 弹窗 / 文案都是懒块;旧会话列表也改成懒块,主包因此比基线小(见 `scripts/main-bundle-baseline.json`)。

E2E:`e2e/chat-home.spec.ts` 需要 E2E 栈开 `CHAT_HOME_ENABLED=true` 与 `CHAT_GREETING_LLM_ENABLED=false`(模板问候,零上游费用),开关关时整个文件跳过;`chat.spec.ts`、`hold-to-talk.spec.ts`、`grammar-prompt.spec.ts`、`progress.spec.ts`、`latency.spec.ts`、`scenario-spot-check.spec.ts` 的进入方式走 `e2e/support/chat.ts`(模式无关,两种开关状态都能过)。`docker-compose.e2e.yml` 与本地未跟踪的 compose 文件不改:这两个变量写进 E2E 栈读取的 `server/.env`(compose 的 `env_file`,已 git 忽略;或起栈后在管理端设置里改,开关可热改)再起栈。守卫(`upstream-guard.ts`)放行 `/api/chat-home/{config,settings,today,greetings/*/seen}`。

**未验证(对话主页):** 全部动画观感与帧率(逐行模糊落下、飞入对齐气泡、极光)、减弱动效下的表现、iPhone PWA / 安卓上的安全区(刘海、Home 横条)、抽屉左滑与 Safari 边缘返回手势、自动朗读(弹窗期间不出声,关闭后点「听」能出声)、320×568 下最长问候不裁切、深色 / 液态皮肤下小字对比度、E2E `chat-home.spec.ts` 与改过入口的老规格(**编写并通过类型检查,未运行**)、真实 LLM 问候的长度与时延。清单见计划 §8。
## 人机验证(ALTCHA,计划 2026-10-20-captcha-altcha)

注册、找回密码、绑定 / 换绑邮箱发码与登录页使用同一个共享组件(`src/components/captcha/`)。服务端模式由 `GET /api/captcha/config` 给出:

- **`off`:** 不渲染组件,也不请求挑战(`GET /api/captcha/challenge`);网页只做一次配置探测。
- **`adaptive`:** 注册、找回、发码都先验证;登录只在服务端回 `428 captcha_required` 之后才出现组件并提示,验证后重试。
- **`always`:** 每个受保护页都显示组件。**会阻止桌面端(`enjoy/`)登录**,生产环境请用 `adaptive`。

工作方式:组件只在需要时懒加载(`React.lazy`),主包只含外壳与门(`useCaptchaGate`)。组件用 ALTCHA 的复选框样式、`auto="off"`,用户勾选后在后台求解。每次带载荷的请求都用**新的一次性载荷**:请求结束(成功或失败)后门调用 `consumed()`,组件重置并在仍需要时重新求解,所以注册第二步、找回第二步都有新载荷。载荷只放在内存里,经请求头 `X-Captcha` 发送,不进 URL、JSON 体、存储或日志。

错误映射:`428 captcha_required` / `428 captcha_invalid` 打开组件并提示;`503 Captcha is not configured` 显示「人机验证未配置」;`404 Captcha is off` 只出现在挑战端点,网页不会在 `off` 下请求它。

**非安全上下文:** 组件要求安全上下文(HTTPS,或 `localhost`)。不满足时不加载组件分块,只显示提示。

**实测(`yarn web:build` 与 `scripts/check-main-bundle.mjs`,gzip 级别 9,kB = 1000 字节):** 主包增量 +0.62 kB(基线 411.67 kB,预算 0.65 kB);组件分块 `captcha-widget` 40.75 kB、外壳分块 `captcha-field` 0.90 kB。设计稿里的「约 34 kB」是估计,以此为准。

**未验证:** 真机解题(iOS Safari、安卓 Chrome、低端机)与解题耗时;移动端解题时长;深色模式下组件的对比度;360–375 px 宽度下的布局与按钮是否截断;组件的读屏与键盘操作;非安全上下文提示在真机上的表现;官方库与组件今后版本的格式兼容。

## E2E(Playwright,真实上游)

    export E2E_INVITE_CODE=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
    docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
    yarn web:e2e --project=chromium-mobile      # 默认访问 http://localhost:8100(E2E_BASE_URL 可覆盖)
    docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v

- E2E 栈使用独立项目名与卷(端口 8100、invite 注册),不影响日常数据;上游密钥来自 `server/.env`,因此用例访问真实上游。
- 语音素材:`enjoy/samples/jfk.wav`。Chromium 通过假设备参数读取;WebKit 通过 init script 替换 `getUserMedia`。
- Node 24 + `"type": "module"` 下 Playwright 1.51 无法加载 `.ts` 配置(报 `Named export 'defineConfig' not found`),因此配置文件是 `web/playwright.config.cts`,`web/e2e/package.json` 声明为 `commonjs`,`e2e/support` 里用 `__dirname` 而不是 `import.meta.url`;不要改回 ESM。
- Playwright 的 WebKit 没有 MediaRecorder,需要录音的用例在 `webkit-mobile` 下会跳过(Chromium 下覆盖)。
- Windows 主机上 WebKit 能力不足时,在 Linux 容器里跑(仓库根目录执行,与 E2E server 容器共享网络,页面来源仍是 localhost;需先按上面启动 E2E 栈):

      MSYS_NO_PATHCONV=1 docker run --rm --network container:enjoy-e2e-server-1         -e E2E_BASE_URL=http://localhost:8000 -e E2E_INVITE_CODE         -v "$(pwd -W):/repo" -w /repo/web mcr.microsoft.com/playwright:v1.51.0-noble         node node_modules/@playwright/test/cli.js test --project=webkit-mobile

- 若用户本地未提交的 `docker-compose.yml` 声明了外部网络 `1panel-network` 而起不来,E2E 栈只用 `-f docker-compose.e2e.yml`(必要时先 `docker network create 1panel-network`),见计划 R34。
- 这些是 Playwright 的引擎加设备模拟,不能替代真机验收(见 `docs/superpowers/plans/e2e-results.md`)。

## 部署

由 `server/Dockerfile` 的 Node 阶段构建并由 FastAPI 同源托管,见 `server/README.md`「手机网页版」。

## 影视配音(计划 L5)

入口是练习首页的「影视配音」卡(配置关闭时不显示)。页面 `/dub`(选素材)与 `/dub/:itemId`(选片段 → 选角色 → 彩排 → 录制 → 结果)使用液态玻璃皮肤;`/library*` 固定在经典皮肤上,所以配音不放在 `/library` 下。代码在 `src/features/dubbing/`,对跟读库只通过 `loadDubbingKit()` 懒加载的工具包。

- **角色:** 句子循环标注 无 → A → … → F,改动防抖 600 ms 合并保存,离开页面前提交。精选副本的角色由管理员标注,对用户只读。「智能建议」只给草稿,点「采用建议」后才保存。
- **片段(服务端强制,占位):** 至多 12 句、至多 90 秒;片段里必须有所选角色的台词。
- **录制:** 点「开始录制」在同一次点按里开一次麦并放视频(整段只开一次)。自己的句子窗口是句首前 300 ms 到句尾后 600 ms,窗口内视频静音;3-2-1 倒计时叠在画面上,视频不停。每句窗口关闭即切片并入队评测(并发 2),片段结束后最多等 60 s 再提交。切后台或麦克风被占用即停止,本遍作废。首次录制前提示戴耳机(读写 localStorage 都包在 try/catch 里)。
- **字幕高亮** 是按字母数把句子时长线性分给各词的估计,不是真实词时间。
- **结果:** 总分与发音 / 流利 / 同步三项;逐句显示分数与同步依据(按时间 / 按时长 / 无),「原声」「我的」回放互斥;可「再录一遍」或「换片段」。
- **文案** 只有英文与简体中文(`src/features/dubbing/locales/`),没有西语。

**未做:** 逐句的 ScoreCard 详情弹层;从列表打开旧录音与「未完成」列表(只在结果数据里显示「句子已变化」)。

**未验证:** 上面所有数值(片段上限、窗口、权重、并发、等待时间、建议额度)都是占位,未用真实素材校准。iOS / Android 上播放视频同时开麦的音频会话、回声消除、切后台与来电、PCM 与 MediaRecorder 哪条路径实际生效、字幕高亮的观感,都没有在真机验证。真机清单见 `docs/superpowers/plans/10.21-plans/2026-10-21-l5-dubbing-device-checklist.md`。

## 选词操作条与本地词典

选中单词后底部是一排操作条:查词 · 朗读 · 加入词汇本。查词先问服务端本地词典(`POST /api/dictionary/lookup`,词只在请求体里,与 AI 共用限流),命中立即显示并标「词典」,可再点「AI 结合语境讲解」;未命中或词典出错自动改问大模型并标「AI 查询」。朗读在点击手势里调用(iOS 要求)。**未在真机验证:** iOS Safari 点「朗读」能否出声、360 px 宽度下操作条是否溢出;**Android Chrome 标签页**长按选词后点操作条(此前一点就消失、动作不执行,修复为按下期间锁住选区 + 条不可选,另含链接节点稳定与选区越界裁剪)未在真机验证,结果与清单见 `docs/superpowers/plans/2026-10-14-chat-longpress-lookup-fix-results.md`。**全站点词查词**(点一下任意标记过的英文单词出现横线,再点一次选中并出现操作条;长按仍走系统原生选词;资料库与更新日志页除外;触屏与手写笔,桌面鼠标保持原生)与玻璃操作条 / 抽屉未在真机验证:iOS / Android 上的点词查词、Android 第二下点按后原生选词工具栏是否被压住、CSS Custom Highlight API 支持与回退、横线在海报上的可读性、玻璃在海报上的可读性、操作条或抽屉显示时的多层模糊、抽屉滑入是否闪烁、资料库页 `:has()` 实底回退;清单见 `docs/superpowers/plans/2026-10-15-global-longpress-glass-lookup.md`。
