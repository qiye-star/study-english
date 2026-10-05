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
