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

## 对话页增强(自动朗读、场景、提示、复盘、进度、词汇本、语速、难度)

- **自动朗读**默认开(会话配置 `auto_speak`,缺省即开;设置面板与顶栏喇叭可关):只读"用户这次操作之后完成的新回复"与场景开场白,从不读历史;录音/转写中、页面在后台、回复出错、已读过、被更新的发送取代时不读。iOS 需要在点击里解锁播放器:发送、重试、结束录音、点场景时同步调用 `primeAudioElement`(共享元素 `sharedAutoplayAudio()`),被拦截时显示一次"点此朗读"。**每条回复多一次语音合成调用(有成本)。** 编排见 `src/features/chat/use-auto-speak.ts`。
- **语速**:全局偏好 `enjoy-web.playback.rate`(0.75×/1×/1.25×,退出登录清除),`playbackRate` + `preservesPitch` 作用于所有朗读与语音气泡回放(`src/lib/playback-rate.ts`),不重新合成。
- **场景与难度**:会话配置 `scenario`/`level`;预设提示词与开场白在 `src/features/chat/scenarios.ts`,难度提示词在 `levels.ts`,系统提示词由 `chat-request.ts` 的 `effectiveSystemPrompt` 拼装。新建会话只写场景与难度,模型/音色在运行时取服务端默认值。
- **"不会说?"提示与复盘**:客户端调用 `/api/ai/chat/completions`(JSON 模式、固定提示词、严格解析);提示按"最后一条助手消息 + 难度"缓存在 IndexedDB;复盘结果写进会话配置 `recap`(≤ 约 6 KB,过期提示"重新生成")。
- **进度页** `/progress`(`GET /api/stats`,带本机时区偏移)与**词汇本** `/vocabulary`(`/api/vocabulary`,盒子法 1/2/4/7/15/30 天);查词抽屉、复盘、进度页都能"加入词汇本"。
- 场景提示词的人工抽查:`docs/superpowers/plans/2026-10-05-scenario-prompt-check.md`。

## 语音提速、按住说话与实时通话(计划 2026-10-07)

> **验证状态**:下面描述的是代码行为。单元测试用的是假设备、假 AudioContext、假上游;真机(iOS Safari、安卓 Chrome)、Docker 里的 Playwright 运行、嘈杂环境效果**都未验证**,清单见 `docs/superpowers/plans/e2e-results.md`(真机第 23–32 项)。延迟数字只引用 `docs/superpowers/plans/2026-10-07-voice-latency.md`。

- **按住说话**(`src/features/chat/hold-to-talk-button.tsx`、`use-hold-to-talk.ts`,手势逻辑是纯 reducer `hold-to-talk.ts`):
  - 按下即开始申请麦克风(iOS 要求在手势里调用 `getUserMedia`),松手发送;60 s 上限(`VOICE_MAX_MS`)自动发送。
  - 距按下 < 300 ms 的松手视为误触,丢弃并提示"按住说话";麦克风还没就绪(权限弹窗期间)就松手,丢弃并提示"麦克风已准备好,请按住说话",迟到的麦克风会被释放。
  - 手指上移 80 px 进入"落点"模式(回到 40 px 内退出,有滞回):视口左半 = 取消,右半 = 转文字(转写后**填入输入框,不发送**,已有文字时追加)。`pointercancel` / `lostpointercapture` / 页面隐藏(含系统手势打断)一律丢弃,不发送。
  - **键盘后备**:按钮获得焦点后 `Space` / `Enter` 第一次开始、第二次发送,`Escape` 取消;录音期间有可见的"麦克风在用"指示与 `role="status"` 播报。
  - 录音中不允许其他播放(`claimAudio`);按下时先停止朗读。录音期间页面切后台 = 丢弃本次(不再保留草稿)。
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
  - 浏览器端 Silero VAD(`@ricky0123/vad-web` 0.0.31 + `onnxruntime-web`)断句,检测到说话才上传 16 kHz PCM;机器人说话期间 VAD 门限提高(概率 ≥ 0.8、能量 ≥ −30 dBFS、最短 400 ms)以防回声误打断,播放结束后恢复;外放回声保护强度未验证。
  - 服务端识别 + LLM + 逐句 TTS,下行 24 kHz PCM 经 WebAudio 排队播放;打断(barge-in)时立即停播并发 `interrupt`,丢弃旧轮次的迟到音频。
  - VAD 加载失败时自动切到"按住说话"模式并提示(还有"点一下开始/再点结束"的备用开关)。每一条结束路径(挂断、服务端关闭、麦克风丢失、页面切后台、卸载)都释放麦克风与自己创建的 `AudioContext`,页面级共享上下文不被关闭;这些由 `realtime-call.test.ts` 等单测断言(假设备)。
  - **切后台 = 挂断**,回到前台显示"因切到后台已结束"(iOS 不允许后台保活);通话期间页面其余部分 `inert`,通话字幕里**不支持**查词。通话结束后重新拉取消息列表,复盘/进度/词汇本可直接用。
  - 开发服务器的 `/api` 代理已开启 `ws: true`;生产环境需要反向代理转发 WebSocket,见 `server/README.md`。
- **VAD 资源自托管**(不访问任何 CDN):`scripts/copy-vad-assets.mjs` 在 `yarn dev` / `yarn build` 之前把 4 个文件从 `node_modules`(`@ricky0123/vad-web/dist` 的 `silero_vad_v5.onnx`、`vad.worklet.bundle.min.js`,`onnxruntime-web/dist` 的 `ort-wasm-simd-threaded.wasm`、`.mjs`)复制到 `public/vad/<vad-web 版本>/`(目前 `0.0.31`,依赖是精确锁版本;该目录被 git 忽略,构建产物 `dist/vad/` 里有)。运行时从同源 `/vad/<版本>/` 加载,`sw.js` 按 `/assets/` 同样的规则缓存。首次使用约 16.6 MB(wasm 14.2 MB + 模型 2.3 MB),蜂窝网络下的加载时间**未验证**。脚本发现文件数不是 4 会报错;升级这两个依赖后要重新核对文件名。
- **测延迟**:
  - 服务端层:本机起 uvicorn(被测进程带 `UPSTREAM_ASR_MODE=chat` 作基线口径,临时 SQLite),`cd server && uv run python scripts/measure_latency.py --base-url http://127.0.0.1:8765 --label after --samples ../.superpowers/latency --runs 7 --out ../.superpowers/latency/after.json`。样本先用 `server/scripts/latency_samples.py` 生成到 `.superpowers/latency/`(不提交)。
  - 浏览器层:先按下面「E2E」起 E2E 栈,然后(chromium-mobile,假麦克风文件):`E2E_LATENCY=1 E2E_FAKE_AUDIO=<repo>/.superpowers/latency/s5.wav E2E_HOLD_MS=5000 yarn playwright test e2e/latency.spec.ts --project=chromium-mobile`(s15 换成 `s15.wav` 与 `E2E_HOLD_MS=15000`;`E2E_LATENCY_RUNS` 默认 5);输出里的 `LATENCY_RESULTS {...}` 一行就是各轮 `spans`(第一轮热身已剔除)。要真实上游(识别、LLM、TTS),会产生费用。
  - 方法(N、中位数、同日同机)、基线与结果表都在 `docs/superpowers/plans/2026-10-07-voice-latency.md`;`latency.spec.ts` 与 `hold-to-talk.spec.ts`(Playwright 触摸)**写好后没有在 Docker 栈上运行过**(本环境没有 Docker),第一次运行可能要调整触摸合成与选择器。

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

- 这些是 Playwright 的引擎加设备模拟,不能替代真机验收(见 `docs/superpowers/plans/e2e-results.md`)。

## 部署

由 `server/Dockerfile` 的 Node 阶段构建并由 FastAPI 同源托管,见 `server/README.md`「手机网页版」。
