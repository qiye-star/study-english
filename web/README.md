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

两个功能都由服务端开关控制(`RANK_ENABLED`、`ROOMS_ENABLED`,默认关,见 `server/README.md`「段位赛与联机练习」)。关闭时网页与原来完全一样:底部导航 3 个标签,练习页与「我的」没有段位卡,页面加载时只多请求一次 `GET /api/rank/config` 与 `GET /api/rooms/config`(`src/layout/feature-flags.test.tsx` 断言);直接打开 `/rank`、`/rooms` 只显示"未开启"。

- **段位赛**(`src/features/rank`):练习页与「我的」顶部的段位卡 → `/rank`(段位、小段进度、阶段练习、赛季、晋级赛卡)→ `/rank/match/:id` 晋级赛 → 结果页;`/rank/achievements` 成就墙。晋级赛**只收语音**:复用共享的按住说话长条但传 `allowToText={false}`,没有「转文字」落点(上滑只能取消);考官台词默认只播放不显示(「看文字」可开);iOS 在点击/松手的同步阶段预热播放。评分失败的场次在服务端仍算「进行中」(会挡住新的晋级赛),错误卡同时提供「重新打分」与「放弃本场」。未通过不使用红色。
- **联机练习**(`src/features/rooms`,底部第 3 个标签「联机」):输入 6 位房间号加入或建房;群聊经 `WS /api/rooms/ws`(一次性票据,不进日志与错误信息),断线按 `last_seq` 重连补齐,服务端重启(1012)自动重连;`@ai` 的回答所有人可见;私聊助手(组句)只给自己,一键发到群里;房主可锁定、关闭 AI、移出成员、结束房间;已结束的房间只读可查历史;可举报他人消息。
- 与服务端的契约:`src/features/rank/rank-contract.test.ts`、`src/features/rooms/rooms-contract.test.ts` 读取 `server/tests/fixtures/{rank,rooms}_contract.json`(由服务端测试对真实应用录制/核对),逐键绑定 TypeScript 类型。
- **联机练习 v2**(spec `docs/superpowers/specs/2026-10-10-rooms-v2-design.md`;服务端见 `server/README.md`「联机练习 v2」):创建表单 7 项设置(房间名、场景、水平、加入方式、人数、AI 公开回答、允许语音);「需房主同意」的房间凭号申请、房主在横幅里同意后自动进房;邀请链接与本地生成的二维码(`/rooms/invite/:token`,直接进入);助手改为停靠在输入条上方的面板(三档高度,键盘弹出收成一行,不遮挡聊天);语音消息(与对话页同一手势,上传 16 kHz WAV,服务端存 MP3;转写与翻译全房共享,「转文字」「翻译」手动展开或在「我的」里开自动转文字);引用回复、6 个表情回应、正在输入/正在说话;房间结束后的学习小结(`/rooms/r/:roomId/summary`)。语音与小结各有服务端子开关(默认关)。语音配额为每人每天 200 MB + 100 条。
- 契约:`src/features/rooms/create/rooms-v2-contract.test.ts`、`extras/extras-contract.test.ts`、`voice/voice-contract.test.ts` 分别核对 `server/tests/fixtures/rooms_v2_{core,summary,voice}_contract.json`。E2E:`e2e/rooms-v2.spec.ts`(两个上下文审批加入、引用、回应、正在输入、助手面板不遮挡、邀请链接第三人进入;语音上传用契约样例应答,零上游成本)。
- **联机练习 v2 未在真机验证**(iOS Safari 与 Android Chrome 各一台;结果记在 `docs/superpowers/plans/e2e-results.md`「Rooms v2」):按住说话录 10 秒并发送、上滑取消、上滑转文字;对方播放 MP3(iOS `<audio>` 播放 Blob)、语速跟随;键盘弹出时助手面板收成一行与恢复(`visualViewport`);拖动面板三档;切后台/锁屏再回来重连与补齐;二维码被另一台手机扫码打开;邀请链接从微信等应用内浏览器打开;Android 数字键盘粘贴房间号;自动转文字设置在真机上的表现。
- **未在真机验证**:iOS 后台/锁屏后房间重连;Android 数字键盘粘贴 6 位房间号;晋级赛在 iOS 上首轮 AI 台词的自动播放;晋级赛按住说话(无转文字落点)的真机手感。
- **未在真机验证**:iOS Safari 点输入框页面跳到顶部的修复(`useAppHeight` 在键盘相关事件后 `scrollTo(0,0)` 复位 + 固定 `html` / `body`,计划 `2026-10-13-ios-keyboard-scroll`)。清单见 `docs/superpowers/plans/2026-10-13-ios-keyboard-scroll-device-checklist.md`。

## 背单词(计划 2026-10-10)

服务端开关 `WORDBOOK_ENABLED`(默认关,见 `server/README.md`「背单词」)。关闭时网页与原来一样:练习页没有「背单词」大卡,「我的 → 学习」没有「背单词」一行,页面加载时只多请求一次 `GET /api/wordbook/config`;直接打开 `/wordbook` 显示「背单词未开启」。

- **入口与路由**(`src/features/wordbook`):练习页大卡(未选书 → 「选择词书」;已选书 → 今日计划环、待复习与新词剩余)、「我的」一行 → `/wordbook` 首页(今日计划、已掌握/已学/剩余、明天预计复习)、`/wordbook/books` 选书与每日设置、`/wordbook/learn` 学新词(5 张词卡 → 释义小测,答错回队尾 → 小结)、`/wordbook/review` 复习(释义选择、看释义选词、例句选词、听写、拼写五种题型)、`/wordbook/spell` 按句拼写。没有自己的底部标签,停留在这些页面时高亮「练习」。各页面按路由懒加载(主包只多了入口卡、「我的」一行与文案)。
- **按句拼写**(`src/features/wordbook/spell`):3–6 句一组,只挖目标词(多词词头拆成连续空),一个隐藏输入框管理全部空(`autocomplete/autocorrect/autocapitalize/spellcheck` 关闭,16px 字号防缩放);空格跳到下一空、空的空上退格回到上一空、回车提交;默认不显示字母数(设置里可开,存在本机 `enjoy-web.wordbook.prefs`,退出登录时清除)。「首字母」提示(该空得分减半)与「听这句」使用句中的实际词形(go → went,服务端随空下发 `form`,提交前不显示)。结果分四种(正确 / 小笔误 / 词形不对 / 错误,图标 + 文字,错误用中性灰而不是红色),笔误逐字母标出差异,每个词有「为什么?」与「举报例句」。
- **AI 讲解**:「为什么?」只在服务端 `WORDBOOK_AI_ENABLED` 打开且配置了 LLM 时请求;不可用时显示「AI 讲解暂不可用」,词典讲解照常。讲解按纯文本显示。
- **判分全部在服务端**:网页从不自己判对错;选择题的正确项由 `/api/wordbook/answers` 的 `correct_option` 给出。
- 契约:`src/features/wordbook/wordbook-contract.test.ts` 逐键核对 `server/tests/fixtures/wordbook_contract.json`(服务端测试对真实应用录制)。E2E:`e2e/wordbook.spec.ts`(选书 → 学 5 个词 → 小结 → 首页与大卡计数 → 按句拼写提交 → 「我的」一行;零上游:守卫只放行 `/api/wordbook/*` 的数据库路径,`/api/wordbook/explain` 不放行)。
- **背单词 v2:认识 / 模糊 / 不认识 与「快速回忆」**(计划 2026-10-11-wordbook-recall):新词卡的释义先被遮罩盖住(遮罩时释义、例句不在页面里),下面三个键 认识 / 模糊 / 不认识;点遮罩算偷看,之后的「认识」按「模糊」记。盒子由服务端决定(认识 → 第 3 级,模糊 → 第 2 级,不认识 → 第 1 级;同一个词连续两次模糊按不认识记),「认识」按管理端比例(默认 33%,`WORDBOOK_SPOT_CHECK_PCT`)被抽查,点得太快(< 1 秒)必抽。一轮 5 张评完进入本轮小测:模糊的词、不认识的词(两次:选释义 + 看释义选词)、被抽查的认识词;小结多一行「认识 · 模糊 · 不认识」与「抽查 · 通过」。复习页声明支持后,盒 1/2/4/5 的到期词约 40% 出「快速回忆」:只看词头自评 → 翻面核对,认识按同一比例先答一道选释义,认识之后可点「记错了」。管理端设置:抽查比例、快速回忆开关、自动朗读(第一次点击之后才自动读,「不认识」总是读)、翻开后显示例句。E2E:`e2e/wordbook-recall.spec.ts`(栈要 `WORDBOOK_SPOT_CHECK_PCT=100`;复习段需要 `E2E_SQLITE_PATH`(本机临时 SQLite)或 `E2E_COMPOSE_PROJECT`(Docker 栈)把词改到期,否则那一段跳过并写注解)。未在真机验证:iPhone Safari / 主屏 PWA 的第一次点击后自动朗读、「不认识」立即发声与三键 dock 的安全区;中低端安卓的翻面动画与玻璃 dock;VoiceOver / TalkBack 读遮罩「已折叠」;两平台深色下遮罩与卡片的区分;360px 宽下英文「Don't know」等按钮标签。
- **背单词:释义默认仅英文**(计划 2026-10-13-defs-default):没存过偏好的用户翻开词卡只看英文释义;这张卡没有英文释义(国家 / 城市等)时自动显示中文;卡片右上角的「中」按钮临时显示这一张卡的中文释义(不保存,换卡复位);「每日目标」面板里「短语:自动展开 / 收起」只管学新词页,存在本机。小测题面仍是中文。未在真实浏览器 / 真机验证:「中」按钮在 360 / 375 px 下与徽标的并排、深色下的按下态;E2E `wordbook-recall.spec.ts` 已改成先切到「中英」但本轮未运行。
- **复习页答题后界面**(计划 2026-10-13-review-after-answer):选择题(看单词选中文 / 看中文选单词)答完后,选项换成英文单词——英→中题的错误项显示它对应的单词(对比辨析),正确项保持绿色,中文默认藏起、点题卡右上角的「中」才看;中→英题的每个选项显示单词 + 小字中文与词性;题目下方出「学习内容」(英→中:英英释义 + 最多 3 条短语 + 朗读;中→英:正确单词的卡片),释义行遵守「释义显示」偏好(仅中文时改显中文,没有英文释义的词回退中文)。**双击**(300 ms 内点两下)答后的某个选项会选中它的单词并弹出选词操作条(查词 · 朗读 · 加入生词本);第一次答题后在题下提示一次「双击选项可查词」,记在本机 `enjoy-web.wordbook.prefs`(`doubleTapHintSeen`,退出登录清除)。服务端 `/api/wordbook/answers` 对这两种选择题追加可选的 `option_info`(靠出题时的进程内备忘,重启 / 多 worker 取不到就省略,网页退回旧显示)、`phrases`、`example`。例句选词、学新词小测、快速回忆抽查不变。**未在真机验证**:iPhone Safari 上双击是否稳定触发程序化选中与操作条、`touch-action: manipulation` 是否消除双击缩放、操作条是否盖住底部 dock、VoiceOver 激活;清单见 `docs/superpowers/plans/2026-10-13-review-after-answer-device-checklist.md`。
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

## 选词操作条与本地词典

选中单词后底部是一排操作条:查词 · 朗读 · 加入词汇本。查词先问服务端本地词典(`POST /api/dictionary/lookup`,词只在请求体里,与 AI 共用限流),命中立即显示并标「词典」,可再点「AI 结合语境讲解」;未命中或词典出错自动改问大模型并标「AI 查询」。朗读在点击手势里调用(iOS 要求)。**未在真机验证:** iOS Safari 点「朗读」能否出声、360 px 宽度下操作条是否溢出。
