# 手机网页版(练习子集)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增手机优先的 PWA `web/`(登录注册、跟读发音评测、AI 对话、查词翻译),服务端新增对话/消息/评测记录的持久化接口,并在同一域名下托管 `web/dist`。

**Architecture:** `server/` 增加迁移 `0003`(`conversations`/`messages`/`assessments`)、三个路由文件(对话、评测记录、静态托管)和 `POST /api/speech/assessments` 的可选 `save` 字段;静态托管路由在 `stubs` 之后最后注册,`/api/**` 永不回退到 `index.html`。`web/` 是根目录 Yarn workspace,Vite 通过路径别名读取 `enjoy/src` 的 shadcn/ui、评分视图、波形播放器、i18n 与 Tailwind 配置,两个重 barrel(`@renderer/components`、`@renderer/components/ui`)被别名到精简 shim;数据层直接 `fetch` 服务端 API。浏览器录音(`MediaRecorder`,不指定 mimeType)经 `decodeAudioData` + `OfflineAudioContext` 转成 16 kHz/单声道/16 位 WAV 后上传。Docker 镜像增加 Node 构建阶段,构建上下文改为仓库根目录。

**Tech Stack:** 服务端 Python ≥3.11、FastAPI、SQLAlchemy 2(async)、Alembic、pytest;网页端 React 18.3、TypeScript 5.8、Vite 6.2、Tailwind 3.4、shadcn/ui(Radix)、react-router-dom 7.3、i18next 24、Vitest 3 + Testing Library + jsdom、Playwright 1.51(Chromium + WebKit 移动预设);Yarn 4.6 workspaces;Docker Compose。

**Spec:** `docs/superpowers/specs/2026-10-04-mobile-web-practice-design.md`(唯一权威。本计划与其冲突时以设计文档为准;设计文档没写明的地方见下文「裁定」。)

## 全局约束

(每个任务都隐含遵守本节。)

- 服务端沿用既有约定:JSON 一律 **snake_case**;错误体 `{"error": "<message>"}`;Bearer token(`/api/sessions` 签发,依赖 `app.deps.current_user`);Alembic 迁移不用方言专属类型;**单 worker**。
- 新接口均需登录、按用户隔离,**越权访问返回 404**(与"不存在"不可区分)。
- 路由注册顺序(`server/app/main.py`):`health, sessions, config_api, speech, conversations, assessments, ai_chat, ai_audio, stubs, web`。新 API 路由必须在 `stubs` 之前(`stubs` 会吞掉未知的 `POST/PUT/DELETE /api/**`);`web`(静态托管)必须最后;`/api/**` 未知路径保持 `404 {"error": "Not Found"}`。不做 CORS。
- `POST /api/speech/assessments` 不带 `save` 时,行为与响应与改动前**逐字节一致**;桌面端不受影响。
- 评测上传格式:16 kHz、单声道、16 位 PCM WAV;multipart 字段 `file`/`reference`/`language`;仅英文(`en`、`en-*`);必须有参考文本(≤2000 字符);≤300 秒;≤25 MiB。
- `web/` 只经路径别名读取 `enjoy/src`,不复制大段源码;不在 `enjoy/` 里加 web 专用分支。**本计划预期不改 `enjoy/`**;若确需改动,单独提交并在提交说明里写明原因,且桌面端行为不变。
- web 中 `@renderer/components` 与 `@renderer/components/ui` 两个 barrel 被别名到 `web/src/shims/` 下的精简版;**web 自己的代码只用子路径**(如 `@renderer/components/ui/button`)。`@bugsnag/electron`、`electron-log/renderer` 别名到空模块;构建产物中不得出现 `__ENJOY_APP__`。
- web 自身源码别名为 `~/`(`@/` 与 `@renderer/` 指向 `enjoy/src`,不可挪用)。
- 移动适配:最小触控区 44 px(`min-h-11`/`min-w-11` 或更大);输入框字号 ≥ 16 px;使用 `100dvh`/`--app-height` 与 `env(safe-area-inset-*)`;键盘弹出时输入栏不被遮挡;暗色模式沿用桌面主题变量(`.dark` 类)。
- 查词上下文约定:可被选中查词的文本容器带属性 `data-lookup-context`(阶段 3、4 的页面负责加,阶段 5 读取)。
- token 存 `localStorage` 键 `enjoy-web.auth`,所有读写包 try/catch;401 自动回到登录页。
- 质量门槛:服务端 `cd server && uv run pytest -q` 0 failed;web `yarn workspace web typecheck`、`yarn workspace web test`、`yarn workspace web build` 全部通过;新增代码有测试;不引入未使用的依赖(依赖在**用到它的任务**里添加)。
- 不提交:`web/dist`、`node_modules`、任何 `.env`、密钥;`web/.env.example` 只含占位。**计划、代码、测试、提交信息、日志里都不得出现真实密钥**;真实上游密钥只在 git 忽略的 `server/.env`。
- 环境:**Windows + Git Bash**(仓库根 `E:\workspace\everyone-can-use-english`,Git Bash 路径 `/e/workspace/everyone-can-use-english`)。Python 一律 `uv run …`(在 `server/` 下);Node 24 与 Yarn 4.6 可用。仓库包管理器是 **Yarn 4.6 workspaces**(`packageManager: yarn@4.6.0`、`nodeLinker: node-modules`、`nmHoistingLimits: workspaces`,即每个 workspace 有自己的 `node_modules`,根 `node_modules` 为空)。**不要用 npm/pnpm 给 `web/` 装依赖;本机不要运行 `yarn workspaces focus`**(会裁掉 `enjoy/node_modules`,只在 Docker 构建里用)。阶段 0 的丢弃式 spike 例外,见 Task 0.1。
- 工具调用里前台 `sleep` 被禁止:等待容器就绪一律用 `docker compose … up -d --wait`,等待页面状态用 Playwright 的 `waitFor*`。
- 提交信息 `<type>(<scope>): <说明>`(`feat(web)`/`feat(server)`/`fix(...)`/`docs`/`test`),一个提交一件事,末尾追加 `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`。分支 `feat/self-hosted-backend`。
- 不修改 `1000-hours/`、`1000h-portal/`、`book/`。

## 裁定(设计文档未写明或需要取舍之处)

| # | 裁定 |
|---|---|
| R1 | **Docker 的 Node 构建阶段放在阶段 2 末(Task 2.7)**,因为它要构建已存在的 `web/`;阶段 1 只做静态托管路由(测试用临时目录)。`docker-compose.yml` 已有 `enjoy-data:/data` 卷,设计文档第 7 节"增加数据卷"已满足,只需把 build context 改为仓库根。 |
| R2 | `assessments` 表在设计文档列出的列之外**增加 `audio_bytes`**(整数),用于按用户统计录音总量配额。 |
| R3 | 数据目录:`DATA_DIR` 显式设置时用它;否则若 `DATABASE_URL` 是 SQLite 文件库,用库文件所在目录;否则 `/data`。录音存 `<数据目录>/recordings/<user_id>/<id>.wav`,库里存相对路径。 |
| R4 | SPA 回退:`/assets/` 下不存在的文件返回 404(避免把 HTML 当脚本缓存),其余非 `/api` 的未知 GET 回退 `index.html`。`index.html`、`sw.js`、manifest 用 `Cache-Control: no-cache`;`/assets/*` 用 `public, max-age=31536000, immutable`。web 产物目录:`WEB_DIST_DIR` 显式设置时用它,否则 `<仓库根>/web/dist`(Docker 镜像内为 `/web/dist`)。目录不存在时非 API 的 GET 返回 `404 {"error": "Web app is not built"}`,服务照常启动。 |
| R5 | 上限与错误:录音总量 `413 {"error": "Recording storage quota exceeded"}`(**在调用讯飞之前检查**);对话数 `429 {"error": "Conversation limit reached"}`;单对话消息数 `429 {"error": "Message limit reached"}`。环境变量与默认值:`RECORDING_QUOTA_MB=500`、`MAX_CONVERSATIONS=200`、`MAX_MESSAGES_PER_CONVERSATION=1000`。单条录音 ≤5 分钟沿用既有 `MAX_ASSESSMENT_SECONDS=300`。 |
| R6 | 消息排序:同一次 POST 的第 i 条 `created_at = 基准 + i 微秒`,基准取 `max(当前时间, 该对话最后一条 + 1 微秒)`;列表按 `(created_at, id)` 升序。所有时间戳输出为带 `+00:00` 的 ISO 8601。 |
| R7 | 列表形状 `{"<集合名>": [...], "page": n, "next": n+1 或 null}`,`per_page` 默认 20、最大 50;消息列表一次返回该对话全部消息(受 R5 上限约束)。创建类接口返回 200(与既有 `POST /api/users` 一致),删除返回 `{"id": "<id>"}`。 |
| R8 | 主题变量:`enjoy/src/index.css` 含 vidstack/intl-tel-input 的 `@import` 和 `body { user-select: none }`(会让查词无法选中),不能整体引入。web 只把 `:root`、`.dark` 两个变量块复制到 `web/src/styles/theme.css`,**由单元测试断言与 enjoy 完全一致**(防漂移)。Tailwind 配置则由加载器直接执行 `enjoy/tailwind.config.js`(其 `@vidstack/react/tailwind.cjs` 插件替换为空插件)。 |
| R9 | 提示词:`enjoy/src/commands/{lookup,translate}.command.ts` 依赖 `@langchain`,且提示词常量未导出。web 用 Vite 的 `?raw` 读入这两个源文件文本,在 `web/src/features/lookup/prompts.ts` 中用正则提取常量(不执行其代码、不复制文本、无漂移);提取失败即抛错且有测试覆盖。调用走 `fetch /api/ai/chat/completions`(JSON 模式),不引入 openai/langchain SDK。 |
| R10 | 可复用的 enjoy 组件(已逐个核对 import):`components/ui/` 下 alert-dialog、button、card、input、label、popover、progress、radial-progress、scroll-area、separator、sheet、skeleton、switch、textarea;`pronunciation-assessments/` 下 score-result、fulltext-result(它从 `@renderer/components` barrel 引 `PronunciationAssessmentWordResult`,经 shim 解决)、word-result、score-icon;`misc/wavesurfer-player`;`lib/utils`、`@/constants`(`LANGUAGES`)、`@/i18n/*.json`。**不可复用**(依赖 `EnjoyApp`/`AppSettingsProviderContext`/桌面路由/`useAiCommand`):`pronunciation-assessment-form`、`pronunciation-assessment-card`、`misc/markdown-wrapper`、`login/*`、`hooks/use-ai-command`。web 自写轻量 Markdown(react-markdown + remark-gfm)。 |
| R11 | i18n:enjoy 的 en/zh-CN/es 语言包原样复用;web 文案放各目录下 `i18n/en.json`、`i18n/zh-CN.json`,统一在 `web.*` 命名空间,由 `import.meta.glob` 自动合并(各阶段只加自己的文件,不改共享文件);es 回退英文。「我的」页的语言同时是界面语言和翻译目标语言。 |
| R12 | 查词/翻译的选择:选中文本 ≤3 个词且 ≤40 字符 → AI 词典;否则 → 翻译;抽屉内可切换。缓存键含模式、目标语言、文本(查词还含上下文)。 |
| R13 | 录音中切后台(`visibilitychange` → hidden)、设备断开:立即停止并保留已录内容,让用户选择「评测这段」或「重录」。达到 5 分钟上限:自动停止并直接评测。 |
| R14 | E2E:独立 compose 项目 `enjoy-e2e` + 新文件 `docker-compose.e2e.yml`(invite 注册、放宽登录限流、端口 `127.0.0.1:8100`、SQLite、独立卷),不触碰用户正在使用的数据。语音素材用仓库已有的 `enjoy/samples/jfk.wav`(16 kHz 单声道,11 秒,肯尼迪就职演说片段)。Chromium 用 `--use-fake-ui-for-media-stream`/`--use-fake-device-for-media-stream`/`--use-file-for-fake-audio-capture`;WebKit 没有这些参数,用 init script 把 `getUserMedia` 换成播放该 WAV 的 `MediaStream`。若阶段 0 发现 Windows 版 Playwright WebKit 缺 `MediaRecorder` 等能力,WebKit 项目改在 Linux Playwright 容器里跑(共享 server 容器网络,命令见 Task 2.8)。 |
| R15 | 依赖确定性:Vite `resolve.dedupe` = web 的全部运行时依赖;并加 `guard-enjoy-deps` 插件:从 `enjoy/src` 引入的裸模块若解析到 `enjoy/node_modules` 就让构建失败——保证本机(有 enjoy 依赖)与 Docker(只装 web 依赖)行为一致,也避免 React 双实例。 |
| R16 | 阶段 3/4/5 的独立性:设计文档说三者互不依赖,但对话的语音输入要用阶段 3 的录音与 WAV 模块。裁定:Task 4.3(语音输入与朗读)依赖 Task 3.1–3.2;阶段 4 其余任务与阶段 3、5 并行。共享的 AI 调用(`api/ai.ts`)与服务端配置(`api/server-config.ts`)提前到阶段 2,路由与页面占位文件也在阶段 2 一次建好,三个阶段各自只改自己的目录。 |
| R17 | 录音保存失败(写文件出错)→ `500 {"error": "Could not save the recording"}`,不写库。 |
| R18 | 退出登录只清除本地 token(服务端没有注销接口,不新增)。 |
| R19 | 桌面评分视图 `pronunciation-assessment-score-result` 是三列栅格 + 160 px 圆环,手机宽度会横向溢出。不改 enjoy 源码,在 web 里包一层 `MobileScoreResult`,用 Tailwind 任意变体(`[&_.grid-cols-3]:grid-cols-1` 等)改成单列;E2E 断言页面无横向滚动。 |
| R20 | 设计文档第 10 节把 Docker 构建阶段列在阶段 1;按 R1 移到 Task 2.7。阶段 0 的 spike 放在被忽略的 `.superpowers/spike-web/`,只提交结论文档 `docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md`。 |

## 文件结构

服务端(新增 / 修改):

| 路径 | 职责 |
|---|---|
| `server/app/config.py`(改) | 新设置:`data_dir`、`recording_quota_mb`、`max_conversations`、`max_messages_per_conversation`、`web_dist_dir`;属性 `resolved_data_dir` |
| `server/app/models.py`(改) | `Conversation`、`Message`、`Assessment`;工具函数 `iso_utc` |
| `server/alembic/versions/0003_web_practice_data.py` | 迁移 |
| `server/app/recordings.py` | 录音相对路径、读写删除、按用户统计已用字节 |
| `server/app/routers/speech.py`(改) | `save` 字段 |
| `server/app/routers/conversations.py` | 对话与消息接口 |
| `server/app/routers/assessments.py` | 评测记录列表、详情、音频、删除 |
| `server/app/routers/web.py` | 静态托管与 SPA 回退 |
| `server/app/main.py`(改) | 路由注册顺序 |
| `server/tests/test_web_data_settings.py`、`test_assessment_save.py`、`test_conversations.py`、`test_assessments_api.py`、`test_web_static.py`(新)、`test_migrations.py`(改) | 测试 |
| `server/Dockerfile`(改)、`server/Dockerfile.dockerignore`(新)、`server/.dockerignore`(删)、`docker-compose.yml`(改)、`docker-compose.e2e.yml`(新)、`server/.env.example`(改)、`server/README.md`(改) | 部署与文档 |

网页端(全部新增,`web/` 下):

| 路径 | 职责 |
|---|---|
| `package.json`、`tsconfig.json`、`vite.config.ts`、`tailwind.config.cjs`、`postcss.config.cjs`、`index.html`、`.env.example`、`README.md`、`playwright.config.ts` | 工程配置 |
| `src/shims/{enjoy-ui.ts,enjoy-components.ts,empty-module.ts}` | barrel 与 Electron 依赖的替身 |
| `src/styles/theme.css`、`src/index.css` | 主题变量与全局样式 |
| `src/i18n/{index.ts,en.json,zh-CN.json}` | i18n 合并 |
| `src/lib/{storage.ts,kv-cache.ts}` | localStorage/IndexedDB 安全读写 |
| `src/api/{client.ts,types.ts,auth-storage.ts,ai.ts,server-config.ts,error-messages.ts}` | API 客户端、AI 调用、服务端配置 |
| `src/auth/{auth-context.tsx,require-auth.tsx,validation.ts}`、`src/pages/{login-page.tsx,me-page.tsx,install-page.tsx}` | 登录与「我的」 |
| `src/settings/settings-context.tsx`、`src/layout/{app-shell.tsx,bottom-nav.tsx,use-app-height.ts,color-scheme.ts,page-header.tsx}`、`src/app.tsx`、`src/main.tsx` | 布局与路由 |
| `src/pwa/{register-sw.ts,ios.ts}`、`public/{manifest.webmanifest,sw.js,icons/*}` | PWA |
| `src/audio/{wav.ts,convert.ts,recorder.ts,use-recorder.ts,describe-error.ts}` | 录音与格式转换 |
| `src/features/practice/*` | 跟读评测 |
| `src/features/chat/*`、`src/components/markdown.tsx` | AI 对话 |
| `src/features/lookup/*` | 查词/翻译 |
| `src/test/{setup.ts,fetch-mock.ts,render.tsx,fixtures/assessment-good.json}` | 测试工具 |
| `e2e/**` | Playwright |

根目录修改:`package.json`(workspaces 加 `web`、脚本)、`yarn.lock`、`.gitignore`。

## 阶段总览

| 阶段 | 目标 | 验收门槛(全部满足才进入下一阶段) |
|---|---|---|
| 0 | 可行性验证(丢弃式) | 别名构建/类型检查/单测可行;Chromium 下"录音 → WAV → 真实评测"返回 200;WebKit 结论与 E2E 方案已记录 |
| 1 | 服务端数据与托管 | pytest 全绿(SQLite 与 Postgres);迁移可升降级;不带 `save` 的评测不变 |
| 2 | 网页骨架 | typecheck/test/build 通过;Docker 镜像同源托管;登录 E2E 在移动预设下通过 |
| 3 | 跟读评测 | 单测通过;评测 E2E(真实讯飞)通过,录音保存、回放、删除可用 |
| 4 | AI 对话 | 单测通过;对话 E2E(流式、持久化、语音转文字、朗读)通过 |
| 5 | 查词 / 翻译 | 单测通过;查词/翻译 E2E 通过且命中缓存 |
| 6 | 端到端与真机、文档 | 两个浏览器全量 E2E 通过并记录;真机结果记录(或标注未验证);文档完成;桌面端零改动 |

**规则:未满足本阶段验收门槛,不得开始下一阶段**(文末「可并行开发」列出的例外除外)。

---

## 阶段 0:可行性验证(丢弃式)

spike 代码放在已被 git 忽略的 `.superpowers/spike-web/`(`.gitignore` 第 145 行 `.superpowers/`),**不提交**;只提交结论文档 `docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md`。spike 不是 Yarn workspace,用 npm 安装(只此一处例外),以模拟 Docker 里"没有 enjoy 依赖"的环境。

### Task 0.1:基线 + 别名构建可行性

**Files:**
- Create(不提交):`.superpowers/spike-web/{package.json,vite.config.ts,tsconfig.json,tailwind.config.cjs,postcss.config.cjs,index.html,src/main.tsx,src/index.css,src/styles/theme.css,src/shims/*,src/sample.json,src/spike.test.tsx}`、`.superpowers/enjoy-tsc-baseline.txt`
- Create(提交):`docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md`

**Interfaces:**
- Consumes:Task 2.1 给出的 `vite.config.ts`、`tailwind.config.cjs`、`postcss.config.cjs`、`tsconfig.json`、`src/shims/*`、`src/styles/theme.css`、`src/index.css` 的**完整内容**(spike 原样使用,唯一差异是所有指向仓库的相对路径多一层 `../`:`../enjoy` → `../../enjoy`)。
- Produces:结论文档「A. 别名构建」一节,列出:构建是否成功、`guard-enjoy-deps` 报出的缺失依赖清单(需补进 Task 2.1 的依赖列表)、`tsc` 是否通过及需要额外 include 的 enjoy 类型声明文件、vitest 能否渲染 enjoy 组件、产物大小、`__ENJOY_APP__` 检查结果。Task 2.1 的实现者必须应用这里记录的差异。

- [ ] **Step 1: 记录基线**

```bash
cd /e/workspace/everyone-can-use-english
git rev-parse --short HEAD                      # 记入结论文档(预期 f8b48fa5 之后的计划提交)
(cd server && uv run pytest -q 2>&1 | tail -1)  # 预期: 296 passed
(cd enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep "error TS" | sort > ../.superpowers/enjoy-tsc-baseline.txt)
wc -l < .superpowers/enjoy-tsc-baseline.txt     # 记入结论文档
```

- [ ] **Step 2: 建 spike 工程并安装依赖(npm,仅此处)**

```bash
mkdir -p .superpowers/spike-web && cd .superpowers/spike-web
npm init -y >/dev/null
npm i react@18.3.1 react-dom@18.3.1 i18next@24.2.3 react-i18next@15.4.1 lucide-react@0.479.0 clsx@2.1.1 tailwind-merge@2.6.0 class-variance-authority@0.7.1 dayjs@1.11.13 chart.js@4.4.8 wavesurfer.js@7.9.1 @uidotdev/usehooks@2.4.1 uuid@10.0.0 pitchfinder@2.3.2 @radix-ui/react-alert-dialog@1.1.6 @radix-ui/react-dialog@1.1.6 @radix-ui/react-icons@1.3.2 @radix-ui/react-label@2.1.2 @radix-ui/react-popover@1.1.6 @radix-ui/react-progress@1.1.2 @radix-ui/react-scroll-area@1.2.3 @radix-ui/react-separator@1.1.2 @radix-ui/react-slot@1.1.2 @radix-ui/react-switch@1.1.3
npm i -D vite@6.2.2 @vitejs/plugin-react@4.3.4 typescript@5.8.2 tailwindcss@3.4.17 postcss@8.5.3 autoprefixer@10.4.21 tailwindcss-animate@1.0.7 @tailwindcss/typography@0.5.16 tailwind-scrollbar@3.1.0 tailwind-scrollbar-hide@2.0.0 @types/react@18.3.18 @types/react-dom@18.3.5 @types/uuid@10.0.0 @types/node@22 vitest@3 jsdom@26 @testing-library/react@16 @testing-library/dom@10 @testing-library/jest-dom@6 @playwright/test@1.51.0
npm pkg set type=module
```

- [ ] **Step 3: 放入 Task 2.1 的配置与 shim**(路径多一层 `../`),再写 spike 入口:
  - `src/sample.json`:由服务端用真实夹具生成(后续 Task 2.1 会把同一命令的产物提交为 `web/src/test/fixtures/assessment-good.json`):

```bash
cd /e/workspace/everyone-can-use-english/server
uv run python -c "import json; from app.xfyun_result import to_assessment; print(json.dumps(to_assessment(open('tests/fixtures/ise_good.xml', encoding='utf-8').read(), 'Hello, nice to meet you. I would like a cup of coffee, please.')))" > ../.superpowers/spike-web/src/sample.json
```

  - `src/main.tsx`:初始化 i18n(同 Task 2.1 的 `src/i18n/index.ts`,可简化为只加载 `@/i18n/zh-CN.json`);`import sample from "./sample.json"`,用一个约 10 行的递归函数把 snake_case 键转成 camelCase(spike 不装 `camelcase-keys`),然后渲染:
    `<PronunciationAssessmentScoreResult pronunciationScore={…} accuracyScore={…} fluencyScore={…} completenessScore={…} />`、
    `<PronunciationAssessmentFulltextResult words={result.detailResult.words} />`、
    `<WavesurferPlayer id="spike" src="/jfk.wav" />`(把 `enjoy/samples/jfk.wav` 复制到 `public/jfk.wav`)。三者都从**子路径**引入,例如 `@renderer/components/pronunciation-assessments/pronunciation-assessment-score-result`。
  - `src/spike.test.tsx`:Vitest(jsdom)渲染上面的 ScoreResult,断言 `document.body.textContent` 含 `98`(总分 98.87 的整数部分);`src/test-setup.ts` 里补 `IntersectionObserver`、`ResizeObserver` 空实现(同 Task 2.1 的 `src/test/setup.ts`)。

- [ ] **Step 4: 运行并记录**

```bash
cd /e/workspace/everyone-can-use-english/.superpowers/spike-web
npx tsc --noEmit -p . ; echo "tsc exit=$?"
npx vitest run ; echo "vitest exit=$?"
npx vite build ; echo "build exit=$?"
grep -rl "__ENJOY_APP__" dist || echo "CLEAN"
du -sh dist/assets
```

判定与处理(全部写进结论文档):
  - `guard-enjoy-deps` 报 `X must be a dependency of web/package.json` → 把 X(及版本,取 `enjoy/node_modules/X/package.json` 的 version)装上后重跑,直到通过;**清单记入文档**。
  - `tsc` 报 enjoy 文件中找不到全局类型名(如 `RecodingType`)→ 在 `tsconfig.json` 的 `include` 追加对应的 `../../enjoy/src/types/<name>.d.ts`,记入文档。
  - `tsc` 报两份 React 类型冲突 → 确认 `paths` 中的 `"*"` 映射生效(见 Task 2.1),仍失败则记录完整报错并停下来报告。
  - 期望:三条命令 exit=0,输出 `CLEAN`。

- [ ] **Step 5: 写结论文档「A. 别名构建」一节并提交**(格式见 Task 0.2 Step 5 的模板)。

```bash
cd /e/workspace/everyone-can-use-english
git add docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md
git commit -m "docs: record mobile web alias-build spike results" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 0.2:浏览器录音 → WAV → 真实评测

**Files:**
- Create(不提交):`.superpowers/spike-web/{record.html,src/record.ts,src/recorder.ts,src/convert.ts,src/wav.ts,playwright.config.ts,e2e/record.spec.ts,e2e/fake-mic.ts}`
- Modify(提交):`docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md`

**Interfaces:**
- Consumes:Task 3.1 的 `wav.ts`、Task 3.2 的 `convert.ts`/`recorder.ts`(spike 原样复制这两个任务 Step 3 中给出的实现;这正是在验证它们)、Task 2.8 的 `fake-mic.ts` 中 init script 的实现。
- Produces:结论文档「B. 录音与评测」一节:每个浏览器的 `MediaRecorder.mimeType`、录音字节数、WAV 头(采样率/声道/位深)、HTTP 状态、总分、词数、错误;以及**两个决定**:①WebKit E2E 在 Windows 原生跑还是在 Linux 容器跑;②是否需要执行 Task 3.6(AudioWorklet 备选)。

- [ ] **Step 1: 启动本机服务端(真实密钥只在 `server/.env`)**

用 `run_in_background` 运行(不要在命令里写任何密钥):

```bash
cd /e/workspace/everyone-can-use-english/server
export DATABASE_URL=sqlite+aiosqlite:///./data/spike.db REGISTRATION_MODE=open
uv run alembic upgrade head && uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

检查:`curl -s http://127.0.0.1:8000/up` → `{"status":"ok"}`。

- [ ] **Step 2: spike 页面**。`record.html` 有两个按钮 `#start`、`#stop`;`src/record.ts`:

```ts
import { startRecording, type RecordingSession } from "./recorder";
import { toAssessmentWav, blobToArrayBuffer } from "./convert";
import { readWavInfo } from "./wav";

const REFERENCE =
  "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.";
declare global { interface Window { __spike: Record<string, unknown> } }
let session: RecordingSession | null = null;

document.getElementById("start")!.addEventListener("click", async () => {
  try {
    session = await startRecording({ maxDurationMs: 30_000 });
    window.__spike = { state: "recording" };
  } catch (e) {
    window.__spike = { state: "done", error: String(e) };
  }
});

document.getElementById("stop")!.addEventListener("click", async () => {
  const rec = await session!.stop();
  const out: Record<string, unknown> = { state: "converting", mimeType: rec.mimeType, blobBytes: rec.blob.size, recordedMs: rec.durationMs };
  window.__spike = out;
  try {
    const { wav, durationMs } = await toAssessmentWav(rec.blob);
    out.wav = readWavInfo(await blobToArrayBuffer(wav));
    out.wavDurationMs = durationMs;
    const form = new FormData();
    form.append("file", new File([wav], "recording.wav", { type: "audio/wav" }));
    form.append("reference", REFERENCE);
    form.append("language", "en-US");
    const token = new URLSearchParams(location.search).get("token");
    const res = await fetch("/api/speech/assessments", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const body = await res.json();
    Object.assign(out, { status: res.status, score: body.pronunciation_score, words: body.detail_result?.words?.length, error: body.error });
  } catch (e) {
    out.error = String(e);
  }
  out.state = "done";
});
```

  `vite.config.ts` 在 Task 2.1 配置基础上加 `server.proxy: { "/api": "http://127.0.0.1:8000" }`,`build.rollupOptions.input` 不需要(spike 只用 dev server)。

- [ ] **Step 3: Playwright spike**。`playwright.config.ts`:`baseURL: "http://localhost:5173"`、`webServer: { command: "npx vite --port 5173 --strictPort", url: "http://localhost:5173/record.html", reuseExistingServer: true }`、`timeout: 180_000`,两个 project 与 Task 2.8 的 `playwright.config.ts` 完全相同(`chromium-mobile` 带三个 fake 参数和 `--use-file-for-fake-audio-capture=<绝对路径>/enjoy/samples/jfk.wav`;`webkit-mobile` 为 `devices["iPhone 14"]`)。`e2e/record.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { useFakeMicrophone } from "./fake-mic";

test("record → wav → assess", async ({ page, request, browserName }) => {
  const username = `spike_${Date.now().toString(36)}`;
  const reg = await request.post("http://127.0.0.1:8000/api/users", { data: { username, password: "spike-password-1" } });
  expect(reg.status()).toBe(200);
  const token = (await reg.json()).access_token as string;
  await useFakeMicrophone(page, browserName);
  await page.goto(`/record.html?token=${token}`);
  const caps = await page.evaluate(() => ({
    secure: window.isSecureContext,
    mediaRecorder: typeof MediaRecorder,
    offline: typeof OfflineAudioContext,
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
  }));
  console.log(browserName, "caps", JSON.stringify(caps));
  await page.click("#start");
  await page.waitForFunction(() => (window as any).__spike?.state);
  await page.waitForTimeout(11_500);
  await page.click("#stop");
  await page.waitForFunction(() => (window as any).__spike?.state === "done", null, { timeout: 150_000 });
  const result = await page.evaluate(() => (window as any).__spike);
  console.log(browserName, "result", JSON.stringify(result));
  expect(result.status).toBe(200);
});
```

  `fake-mic.ts` 用 Task 2.8 Step 3 的 `useFakeMicrophone` 实现,`SPEECH_WAV` 改为 spike 内的绝对路径。

- [ ] **Step 4: 运行**

```bash
cd /e/workspace/everyone-can-use-english/.superpowers/spike-web
npx playwright install webkit            # 从 Playwright 官方 CDN 下载 WebKit;chromium 已在本机缓存
npx playwright test --project=chromium-mobile --reporter=list
npx playwright test --project=webkit-mobile --reporter=list
```

预期:Chromium `status 200`、`wav` 为 `{sampleRate:16000, channels:1, bitsPerSample:16}`、`score > 50`、`words > 10`。WebKit:记录 `caps` 与结果,允许失败。

  - **若 WebKit 的 `caps.mediaRecorder !== "function"` 或评测失败**:用 Linux 容器复测(先 `docker run --rm mcr.microsoft.com/playwright:v1.51.0-noble npx playwright --version` 确认镜像可用;容器访问本机服务端用 `--add-host=host.docker.internal:host-gateway`,并在容器里把 `baseURL` 设为 `http://host.docker.internal:5173`——注意这不是安全上下文,`getUserMedia` 不可用,因此容器复测只用来确认 `MediaRecorder`/`decodeAudioData` 是否存在:`page.evaluate(() => [typeof MediaRecorder, typeof OfflineAudioContext])`)。结论:若 Linux WebKit 有这些能力,则 **决定①=Linux 容器**(正式方案见 Task 2.8 Step 6,同源 localhost,无安全上下文问题);否则 WebKit 只做非录音用例,录音类用例在 WebKit 上标注 `test.skip` 并在结论中写明。
  - **若 Chromium 失败**:这是设计文档第 2 节核心假设被推翻——**停止,向用户报告**,不进入阶段 1。

- [ ] **Step 5: iOS 真机(可选)**。需要用户提供可从手机访问的 HTTPS 地址(例如用户自己的隧道指向 `localhost:5173`)。有则在 iPhone Safari 打开 `/record.html?token=…`,点开始、读一句、点停止,把页面上的 `window.__spike`(可在页面里加一个 `<pre>` 显示)抄进文档;没有则写「**未验证(需要用户提供设备与 HTTPS 地址)**」。

- [ ] **Step 6: 完成结论文档并提交**。文档模板:

```markdown
# 手机网页版可行性验证结果(阶段 0)

基线:commit <hash>;服务端 296 passed;enjoy tsc 基线 <N> 行。

## A. 别名构建
| 检查 | 结果 | 备注 |
|---|---|---|
| tsc --noEmit | ✅/❌ | 额外 include:… |
| vitest 渲染 ScoreResult | ✅/❌ | |
| vite build | ✅/❌ | dist/assets 大小 … |
| __ENJOY_APP__ 不在产物中 | ✅/❌ | |
| guard 报出的缺失依赖 | 无 / 列表(含版本) | 已/需补进 Task 2.1 |

## B. 录音与评测
| 浏览器 | secure | MediaRecorder | mimeType | 录音字节 | WAV 头 | HTTP | 总分 | 词数 | 错误 |
|---|---|---|---|---|---|---|---|---|---|
| Chromium(Windows) | | | | | | | | | |
| WebKit(Windows) | | | | | | | | | |
| WebKit(Linux 容器,如测) | | | | | | | | | |
| iPhone Safari 真机 | 未验证 / … | | | | | | | | |

## 决定
1. WebKit E2E 运行方式:Windows 原生 / Linux 容器 / 录音类用例跳过(理由)。
2. Task 3.6(AudioWorklet 备选)是否执行:否 / 是(理由)。
```

```bash
cd /e/workspace/everyone-can-use-english
git add docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md
git commit -m "docs: record mobile web recording spike results" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

最后停掉 Step 1 的后台服务端,删除 `server/data/spike.db`(被忽略的目录,删不删都不影响仓库)。

### 验收门槛 0

- [ ] 结论文档已提交,A 节全部 ✅(或差异已明确写出并可执行)。
- [ ] B 节 Chromium 行 `HTTP 200`、WAV 头 16000/1/16、总分 > 50。
- [ ] 「决定」两项都有明确结论。
- [ ] `git status --short` 中没有 `.superpowers/` 以外的未提交改动;`git log -1 --stat` 只含结论文档。

---

## 阶段 1:服务端数据与托管

### Task 1.1:新设置、模型与迁移 `0003`

**Files:**
- Modify: `server/app/config.py`, `server/app/models.py`, `server/tests/test_migrations.py`
- Create: `server/alembic/versions/0003_web_practice_data.py`, `server/tests/test_web_data_settings.py`

**Interfaces:**
- Produces:
  - `Settings` 新字段:`data_dir: str = ""`、`recording_quota_mb: int = 500`、`max_conversations: int = 200`、`max_messages_per_conversation: int = 1000`、`web_dist_dir: str = ""`;属性 `resolved_data_dir -> pathlib.Path`(规则见 R3)。
  - `app.models.iso_utc(value: datetime) -> str`(naive 视为 UTC,输出带 `+00:00`)。
  - 模型 `Conversation`、`Message`、`Assessment`(列见下),主键为 36 位 uuid 字符串。

- [ ] **Step 1: 写失败测试** `server/tests/test_web_data_settings.py`:

```python
from datetime import datetime, timezone
from pathlib import Path

from app.config import Settings
from app.models import iso_utc


def make(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def test_defaults():
    s = make()
    assert s.data_dir == ""
    assert s.web_dist_dir == ""
    assert s.recording_quota_mb == 500
    assert s.max_conversations == 200
    assert s.max_messages_per_conversation == 1000


def test_data_dir_explicit(tmp_path):
    assert make(data_dir=str(tmp_path)).resolved_data_dir == tmp_path


def test_data_dir_follows_sqlite_file(tmp_path):
    db = tmp_path / "sub" / "app.db"
    s = make(database_url=f"sqlite+aiosqlite:///{db.as_posix()}")
    assert s.resolved_data_dir == db.parent.resolve()


def test_data_dir_falls_back_to_slash_data():
    assert make(database_url="sqlite+aiosqlite:///:memory:").resolved_data_dir == Path("/data")
    assert make(database_url="postgresql+asyncpg://u:p@db:5432/enjoy").resolved_data_dir == Path("/data")


def test_iso_utc_handles_naive_and_aware():
    naive = datetime(2026, 10, 4, 1, 2, 3, 456789)
    aware = naive.replace(tzinfo=timezone.utc)
    assert iso_utc(naive) == "2026-10-04T01:02:03.456789+00:00"
    assert iso_utc(aware) == "2026-10-04T01:02:03.456789+00:00"
```

把 `server/tests/test_migrations.py` 改为(保留原用例并新增两个):

```python
import sqlite3
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine

from app import models  # noqa: F401
from app.db import Base

ROOT = Path(__file__).resolve().parent.parent

NEW_COLUMNS = {
    "conversations": {"id", "user_id", "name", "config", "created_at", "updated_at"},
    "messages": {"id", "conversation_id", "role", "content", "created_at"},
    "assessments": {
        "id", "user_id", "reference_text", "language", "duration_ms",
        "audio_bytes", "scores", "result", "audio_path", "created_at",
    },
}


def _config(tmp_path, monkeypatch) -> tuple[Config, Path]:
    db = tmp_path / "m.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db.as_posix()}")
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    return cfg, db


def _tables(db: Path) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
    finally:
        con.close()


def test_upgrade_head_creates_tables(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    assert {"users", "access_tokens", "speech_tokens", "alembic_version", *NEW_COLUMNS} <= _tables(db)


def test_0003_columns_and_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    try:
        for table, expected in NEW_COLUMNS.items():
            columns = {row[1] for row in con.execute(f"pragma table_info({table})")}
            assert columns == expected, table
    finally:
        con.close()
    command.downgrade(cfg, "0002")
    tables = _tables(db)
    assert not (set(NEW_COLUMNS) & tables)
    assert "speech_tokens" in tables
    command.upgrade(cfg, "head")
    assert set(NEW_COLUMNS) <= _tables(db)


def test_models_match_migrations(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    engine = create_engine(f"sqlite:///{db.as_posix()}")
    try:
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()
    assert diff == []
```

> 若 `test_models_match_migrations` 只因 SQLite 反射的类型名差异误报(例如 `DATETIME` 与 `DateTime(timezone=True)`),把 `MigrationContext.configure(conn, opts={"compare_type": False})`,并在报告里贴出原始 diff 说明理由;表、列、索引、外键差异不得放过。

- [ ] **Step 2: 运行,确认失败**

Run: `cd server && uv run pytest tests/test_web_data_settings.py tests/test_migrations.py -q`
Expected: FAIL(`ImportError: cannot import name 'iso_utc'`、新表不存在)。

- [ ] **Step 3: 实现**

`server/app/config.py`:顶部加 `from pathlib import Path` 与 `from sqlalchemy.engine import make_url`;在 `xfyun_ws_url` 之后、`app_version` 之前加字段,在类末尾加属性:

```python
    # ---- 网页版(设计文档 2026-10-04)----
    data_dir: str = ""
    recording_quota_mb: int = 500
    max_conversations: int = 200
    max_messages_per_conversation: int = 1000
    web_dist_dir: str = ""
```

```python
    @property
    def resolved_data_dir(self) -> Path:
        if self.data_dir:
            return Path(self.data_dir)
        url = make_url(self.database_url)
        if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
            return Path(url.database).resolve().parent
        return Path("/data")
```

`server/app/models.py`:把 import 改为

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
```

在 `utcnow` 之后加:

```python
def iso_utc(value: datetime) -> str:
    """SQLite 读回的是 naive 时间(实为 UTC),统一补上时区再输出。"""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def new_uuid() -> str:
    return str(uuid.uuid4())
```

文件末尾追加:

```python
class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reference_text: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(16))
    duration_ms: Mapped[int] = mapped_column(Integer)
    audio_bytes: Mapped[int] = mapped_column(Integer)
    scores: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)
    audio_path: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

`server/alembic/versions/0003_web_practice_data.py`(与 0001/0002 同一风格,手写,不依赖 autogenerate):

```python
"""web practice data: conversations, messages, assessments

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('conversations',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('config', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_conversations_user_id'), ['user_id'], unique=False)

    op.create_table('messages',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('conversation_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_messages_conversation_id'), ['conversation_id'], unique=False)

    op.create_table('assessments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('reference_text', sa.Text(), nullable=False),
    sa.Column('language', sa.String(length=16), nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('audio_bytes', sa.Integer(), nullable=False),
    sa.Column('scores', sa.JSON(), nullable=False),
    sa.Column('result', sa.JSON(), nullable=False),
    sa.Column('audio_path', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('assessments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_assessments_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('assessments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_assessments_user_id'))
    op.drop_table('assessments')
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_messages_conversation_id'))
    op.drop_table('messages')
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_conversations_user_id'))
    op.drop_table('conversations')
```

- [ ] **Step 4: 运行,确认通过**:同 Step 2 的命令 → PASS;再跑全量 `cd server && uv run pytest -q` → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/config.py server/app/models.py server/alembic/versions/0003_web_practice_data.py server/tests/test_web_data_settings.py server/tests/test_migrations.py
git commit -m "feat(server): add conversations, messages and assessments tables" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.2:录音存储与评测 `save` 参数

**Files:**
- Create: `server/app/recordings.py`, `server/tests/test_assessment_save.py`
- Modify: `server/app/routers/speech.py`

**Interfaces:**
- Consumes:`Settings.resolved_data_dir`、`Settings.recording_quota_mb`、`Assessment`(Task 1.1);`get_session`、`limited_user`、`get_settings`(`app/deps.py`)。
- Produces:
  - `app.recordings`:`recording_relpath(user_id: int, assessment_id: str) -> str`(`"recordings/<uid>/<id>.wav"`);`absolute_path(data_dir: Path, relpath: str) -> Path`(越出数据目录抛 `ValueError`);`write_recording(data_dir: Path, relpath: str, data: bytes) -> None`;`delete_recording(data_dir: Path, relpath: str) -> None`(不存在或越界时静默);`async used_bytes(session, user_id: int) -> int`。
  - HTTP:`POST /api/speech/assessments` 多一个可选表单字段 `save`;值(去空白、小写)为 `true`/`1`/`yes` 时保存,响应为原响应**追加** `"assessment_id": "<uuid>"`;其余值或缺省时行为不变。`SCORE_KEYS = ("pronunciation_score", "accuracy_score", "fluency_score", "completeness_score")`,`scores` 列存这四项。

- [ ] **Step 1: 写失败测试** `server/tests/test_assessment_save.py`:

```python
import io
import uuid
import wave
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import recordings
from app.models import Assessment
from app.xfyun import XfyunError, get_xfyun
from app.xfyun_result import to_assessment

FIXTURES = Path(__file__).parent / "fixtures"
GOOD_XML = (FIXTURES / "ise_good.xml").read_text(encoding="utf-8")
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
URL = "/api/speech/assessments"


def make_wav(seconds=0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x01\x00" * int(16000 * seconds))
    return buf.getvalue()


class FakeXfyun:
    def __init__(self):
        self.calls = []
        self.configured = True
        self.error = None

    async def evaluate(self, pcm, text, ent, timeout=60.0):
        self.calls.append(text)
        if self.error:
            raise self.error
        return GOOD_XML


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


@pytest.fixture
def fake(app):
    f = FakeXfyun()
    app.dependency_overrides[get_xfyun] = lambda: f
    return f


def post(client, headers, save=None, wav=None):
    data = {"reference": REFERENCE, "language": "en-US"}
    if save is not None:
        data["save"] = save
    files = {"file": ("audio.wav", wav or make_wav(), "audio/wav")}
    return client.post(URL, headers=headers, data=data, files=files)


async def count_rows(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(func.count()).select_from(Assessment))


def files_under(path: Path) -> list[Path]:
    return [p for p in path.rglob("*") if p.is_file()] if path.exists() else []


async def test_without_save_response_is_unchanged(app, client, auth_headers, fake):
    r = await post(client, auth_headers)
    assert r.status_code == 200, r.text
    assert r.json() == to_assessment(GOOD_XML, REFERENCE)
    assert await count_rows(app) == 0
    assert files_under(app.state.settings.resolved_data_dir) == []


@pytest.mark.parametrize("value", ["false", "0", "", "no"])
async def test_falsy_save_values_do_not_save(app, client, auth_headers, fake, value):
    r = await post(client, auth_headers, save=value)
    assert r.status_code == 200
    assert "assessment_id" not in r.json()
    assert await count_rows(app) == 0


@pytest.mark.parametrize("value", ["true", "TRUE", " 1 ", "yes"])
async def test_save_persists_recording_and_row(app, client, auth_headers, fake, value):
    wav = make_wav()
    r = await post(client, auth_headers, save=value, wav=wav)
    assert r.status_code == 200, r.text
    body = r.json()
    assessment_id = body.pop("assessment_id")
    uuid.UUID(assessment_id)
    assert body == to_assessment(GOOD_XML, REFERENCE)

    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    rel = f"recordings/{uid}/{assessment_id}.wav"
    data_dir = app.state.settings.resolved_data_dir
    assert (data_dir / rel).read_bytes() == wav

    async with app.state.sessionmaker() as s:
        row = await s.get(Assessment, assessment_id)
    assert row.user_id == uid
    assert row.reference_text == REFERENCE
    assert row.language == "en-US"
    assert row.duration_ms == 500
    assert row.audio_bytes == len(wav)
    assert row.audio_path == rel
    assert row.scores == {k: body[k] for k in ("pronunciation_score", "accuracy_score", "fluency_score", "completeness_score")}
    assert row.result == body


async def test_failed_evaluation_saves_nothing(app, client, auth_headers, fake):
    fake.error = XfyunError("boom")  # 签名:XfyunError(message, code=None)
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 502
    assert await count_rows(app) == 0
    assert files_under(app.state.settings.resolved_data_dir) == []


async def test_quota_checked_before_upstream(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 0
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 413
    assert r.json() == {"error": "Recording storage quota exceeded"}
    assert fake.calls == []


async def test_quota_counts_existing_recordings(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 1
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(Assessment(
            user_id=uid, reference_text="x", language="en-US", duration_ms=1, audio_bytes=1024 * 1024 - 100,
            scores={}, result={}, audio_path="recordings/x.wav",
        ))
        await s.commit()
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 413
    # 不保存时不受配额影响
    assert (await post(client, auth_headers)).status_code == 200


async def test_storage_failure_returns_500_and_no_row(app, client, auth_headers, fake, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(recordings, "write_recording", boom)
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 500
    assert r.json() == {"error": "Could not save the recording"}
    assert await count_rows(app) == 0


def test_absolute_path_rejects_escape(tmp_path):
    with pytest.raises(ValueError):
        recordings.absolute_path(tmp_path, "../evil.wav")
    with pytest.raises(ValueError):
        recordings.absolute_path(tmp_path, "recordings/../../evil.wav")
    assert recordings.absolute_path(tmp_path, "recordings/1/a.wav") == (tmp_path / "recordings/1/a.wav").resolve()


def test_write_and_delete_recording(tmp_path):
    rel = recordings.recording_relpath(12345678, "abc")
    assert rel == "recordings/12345678/abc.wav"
    recordings.write_recording(tmp_path, rel, b"RIFF")
    assert (tmp_path / rel).read_bytes() == b"RIFF"
    assert not list((tmp_path / "recordings/12345678").glob("*.tmp"))
    recordings.delete_recording(tmp_path, rel)
    assert not (tmp_path / rel).exists()
    recordings.delete_recording(tmp_path, rel)          # 再删不报错
    recordings.delete_recording(tmp_path, "../x.wav")   # 越界静默
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd server && uv run pytest tests/test_assessment_save.py -q`
Expected: FAIL(`ModuleNotFoundError: app.recordings`)。

- [ ] **Step 3: 实现**

`server/app/recordings.py`:

```python
"""评测录音的落盘位置与配额统计(数据目录见 Settings.resolved_data_dir)。"""

import os
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Assessment


def recording_relpath(user_id: int, assessment_id: str) -> str:
    return f"recordings/{user_id}/{assessment_id}.wav"


def absolute_path(data_dir: Path, relpath: str) -> Path:
    root = data_dir.resolve()
    path = (root / relpath).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Recording path escapes the data directory")
    return path


def write_recording(data_dir: Path, relpath: str, data: bytes) -> None:
    path = absolute_path(data_dir, relpath)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def delete_recording(data_dir: Path, relpath: str) -> None:
    try:
        absolute_path(data_dir, relpath).unlink(missing_ok=True)
    except (ValueError, OSError):
        pass


async def used_bytes(session: AsyncSession, user_id: int) -> int:
    total = await session.scalar(
        select(func.coalesce(func.sum(Assessment.audio_bytes), 0)).where(Assessment.user_id == user_id)
    )
    return int(total or 0)
```

`server/app/routers/speech.py`:
- import 增加 `import uuid`、`from app import recordings`、`from app.config import Settings`、`from app.deps import get_settings`(与已有的 `current_user, get_session, limited_user` 合并)、`from app.models import Assessment, SpeechToken, User`。
- 常量区增加 `SCORE_KEYS = ("pronunciation_score", "accuracy_score", "fluency_score", "completeness_score")` 与 `TRUTHY = {"true", "1", "yes"}`。
- 把 `create_assessment` 整个替换为(其余函数不动;`_read_limited_body`、`_wav_to_pcm` 保持原样):

```python
@router.post("/assessments")
async def create_assessment(
    request: Request,
    user: User = Depends(limited_user),
    xfyun: XfyunIse = Depends(get_xfyun),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if not xfyun.configured:
        raise HTTPException(503, "Pronunciation assessment is not configured")
    content_type = request.headers.get("content-type", "")
    if not content_type.lower().startswith("multipart/form-data"):
        raise HTTPException(400, "Expected multipart/form-data")
    body = await _read_limited_body(request)

    # The body is already buffered under the size cap; replay it to parse the form.
    sent = False

    async def replay():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    try:
        form = await StarletteRequest(request.scope, replay).form()
    except (MultiPartException, ValueError):
        raise HTTPException(400, "Invalid multipart body")

    try:
        upload = form.get("file")
        reference = form.get("reference")
        language = form.get("language")
        save = form.get("save")
        if not isinstance(upload, UploadFile):
            raise HTTPException(400, "Audio file is required")
        if not isinstance(language, str):
            raise HTTPException(400, "Unsupported language")
        ent = _ise_entry(language)
        if not isinstance(reference, str) or not reference.strip():
            raise HTTPException(400, "Reference text is required")
        reference = reference.strip()
        if len(reference) > MAX_REFERENCE_CHARS:
            raise HTTPException(400, "Reference text is too long")
        wav_bytes = await upload.read()
        pcm = _wav_to_pcm(wav_bytes)
    finally:
        await form.close()

    want_save = isinstance(save, str) and save.strip().lower() in TRUTHY
    if want_save:
        quota = settings.recording_quota_mb * 1024 * 1024
        if await recordings.used_bytes(session, user.id) + len(wav_bytes) > quota:
            raise HTTPException(413, "Recording storage quota exceeded")

    duration = len(pcm) / (2 * ASSESSMENT_RATE)
    timeout = min(TIMEOUT_BASE_SECONDS + duration, TIMEOUT_CAP_SECONDS)
    try:
        xml = await xfyun.evaluate(pcm, reference, ent, timeout=timeout)
    except XfyunNotConfigured:
        raise HTTPException(503, "Pronunciation assessment is not configured")
    except XfyunError as exc:
        # Map by code only; exc.message may contain provider text.
        if exc.code in (10163, 48195):
            raise HTTPException(400, "Invalid assessment parameters")
        if exc.code == 11200:
            raise HTTPException(503, "Speech evaluation is not authorized")
        if exc.code in (10114, 60114):
            raise HTTPException(400, "Audio is too long")
        raise HTTPException(502, "Upstream unavailable")
    try:
        result = to_assessment(xml, reference)
    except ValueError:
        raise HTTPException(502, "Upstream unavailable")
    if not want_save:
        return result

    assessment_id = str(uuid.uuid4())
    relpath = recordings.recording_relpath(user.id, assessment_id)
    data_dir = settings.resolved_data_dir
    try:
        recordings.write_recording(data_dir, relpath, wav_bytes)
    except OSError:
        raise HTTPException(500, "Could not save the recording")
    session.add(
        Assessment(
            id=assessment_id,
            user_id=user.id,
            reference_text=reference,
            language=language.strip()[:16],
            duration_ms=round(duration * 1000),
            audio_bytes=len(wav_bytes),
            scores={key: result.get(key) for key in SCORE_KEYS},
            result=result,
            audio_path=relpath,
        )
    )
    try:
        await session.commit()
    except Exception:
        recordings.delete_recording(data_dir, relpath)
        raise
    return {**result, "assessment_id": assessment_id}
```

  注意:`recordings.write_recording` 必须以**模块属性**方式调用(测试用 `monkeypatch.setattr(recordings, "write_recording", …)`)。

- [ ] **Step 4: 运行**:`uv run pytest tests/test_assessment_save.py tests/test_speech_assessments.py -q` → PASS;全量 `uv run pytest -q` → 0 failed;`git diff --stat -- server/tests/test_speech_assessments.py` → 无输出(既有测试未改)。

- [ ] **Step 5: 提交**

```bash
git add server/app/recordings.py server/app/routers/speech.py server/tests/test_assessment_save.py
git commit -m "feat(server): optionally save assessment recordings with a per-user quota" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.3:对话与消息接口

**Files:**
- Create: `server/app/routers/conversations.py`, `server/tests/test_conversations.py`
- Modify: `server/app/main.py`

**Interfaces:**
- Consumes:`Conversation`、`Message`、`iso_utc`、`utcnow`(Task 1.1);`current_user`、`get_session`、`get_settings`。
- Produces(HTTP 契约,全部需 Bearer;他人资源 → 404):

| 方法与路径 | 请求 | 成功响应 |
|---|---|---|
| `GET /api/conversations?page=1&per_page=20` | — | `{"conversations": [Conversation], "page": 1, "next": 2 或 null}`,按 `updated_at` 倒序 |
| `POST /api/conversations` | `{"name"?: str(去空白后 1–100,默认 "New conversation"), "config"?: object(序列化 ≤16 KiB)}` | `Conversation` |
| `GET /api/conversations/{id}` | — | `Conversation` |
| `PATCH /api/conversations/{id}` | `{"name"?: str, "config"?: object}`(config 整体替换) | `Conversation`(`updated_at` 刷新) |
| `DELETE /api/conversations/{id}` | — | `{"id": "<id>"}`(连同消息) |
| `GET /api/conversations/{id}/messages` | — | `{"messages": [Message]}` 升序 |
| `POST /api/conversations/{id}/messages` | `{"messages": [{"role": "user"/"assistant"/"system", "content": str(1–20000)}]}`(1–10 条) | `{"messages": [Message]}`;刷新对话 `updated_at` |
| `DELETE /api/messages/{id}` | — | `{"id": "<id>"}` |

  `Conversation = {"id", "name", "config", "created_at", "updated_at"}`;`Message = {"id", "conversation_id", "role", "content", "created_at"}`;时间为带 `+00:00` 的 ISO 8601。错误:`404 {"error": "Conversation not found"}`、`404 {"error": "Message not found"}`、`400 {"error": "Config is too large"}`、`429 {"error": "Conversation limit reached"}`、`429 {"error": "Message limit reached"}`、校验失败 422。

- [ ] **Step 1: 写失败测试** `server/tests/test_conversations.py`:

```python
import asyncio
import uuid

import pytest
from sqlalchemy import func, select

from app.models import Message

URL = "/api/conversations"
TICK = 0.02  # Windows 时钟精度约 15 ms,改变 updated_at 顺序的操作之间要等一下


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def create(client, headers, **body):
    r = await client.post(URL, headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def add_messages(client, headers, cid, *pairs):
    payload = {"messages": [{"role": role, "content": content} for role, content in pairs]}
    return await client.post(f"{URL}/{cid}/messages", headers=headers, json=payload)


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/conversations"),
        ("POST", "/api/conversations"),
        ("GET", "/api/conversations/x"),
        ("PATCH", "/api/conversations/x"),
        ("DELETE", "/api/conversations/x"),
        ("GET", "/api/conversations/x/messages"),
        ("POST", "/api/conversations/x/messages"),
        ("DELETE", "/api/messages/x"),
    ],
)
async def test_requires_login(client, method, path):
    r = await client.request(method, path, json={})
    assert r.status_code == 401
    assert r.json() == {"error": "Unauthorized"}


async def test_create_and_get(client, auth_headers):
    conv = await create(client, auth_headers, name="  Daily chat ", config={"system_prompt": "Be brief", "temperature": 0.5})
    uuid.UUID(conv["id"])
    assert conv["name"] == "Daily chat"
    assert conv["config"] == {"system_prompt": "Be brief", "temperature": 0.5}
    assert conv["created_at"].endswith("+00:00") and conv["updated_at"].endswith("+00:00")
    r = await client.get(f"{URL}/{conv['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == conv


async def test_create_defaults(client, auth_headers):
    conv = await create(client, auth_headers)
    assert conv["name"] == "New conversation"
    assert conv["config"] == {}


@pytest.mark.parametrize("body", [{"name": "x" * 101}, {"name": "   "}, {"config": [1, 2]}, {"config": "text"}])
async def test_create_validation(client, auth_headers, body):
    r = await client.post(URL, headers=auth_headers, json=body)
    assert r.status_code == 422
    assert "error" in r.json()


async def test_config_too_large(client, auth_headers):
    big = {"system_prompt": "x" * 17000}
    r = await client.post(URL, headers=auth_headers, json={"config": big})
    assert r.status_code == 400
    assert r.json() == {"error": "Config is too large"}
    conv = await create(client, auth_headers)
    r = await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"config": big})
    assert r.status_code == 400


async def test_list_orders_by_updated_and_paginates(client, auth_headers):
    ids = []
    for name in ("a", "b", "c"):
        ids.append((await create(client, auth_headers, name=name))["id"])
        await asyncio.sleep(TICK)
    first = (await client.get(URL, headers=auth_headers, params={"per_page": 2})).json()
    assert [c["name"] for c in first["conversations"]] == ["c", "b"]
    assert first["page"] == 1 and first["next"] == 2
    second = (await client.get(URL, headers=auth_headers, params={"per_page": 2, "page": 2})).json()
    assert [c["name"] for c in second["conversations"]] == ["a"]
    assert second["next"] is None
    await client.patch(f"{URL}/{ids[0]}", headers=auth_headers, json={"name": "a2"})
    names = [c["name"] for c in (await client.get(URL, headers=auth_headers)).json()["conversations"]]
    assert names == ["a2", "c", "b"]


@pytest.mark.parametrize("params", [{"per_page": 51}, {"per_page": 0}, {"page": 0}])
async def test_list_params_validated(client, auth_headers, params):
    r = await client.get(URL, headers=auth_headers, params=params)
    assert r.status_code == 422


async def test_patch(client, auth_headers):
    conv = await create(client, auth_headers, name="old", config={"a": 1})
    await asyncio.sleep(TICK)
    body = (await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"config": {"b": 2}})).json()
    assert body["name"] == "old" and body["config"] == {"b": 2}
    assert body["updated_at"] > conv["updated_at"]
    body = (await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"name": " new "})).json()
    assert body["name"] == "new" and body["config"] == {"b": 2}
    r = await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"name": ""})
    assert r.status_code == 422


async def test_delete_removes_messages(app, client, auth_headers):
    conv = await create(client, auth_headers)
    assert (await add_messages(client, auth_headers, conv["id"], ("user", "hi"))).status_code == 200
    r = await client.delete(f"{URL}/{conv['id']}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": conv["id"]}
    assert (await client.get(f"{URL}/{conv['id']}", headers=auth_headers)).status_code == 404
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(Message)) == 0


async def test_messages_pair_roundtrip_and_order(client, auth_headers):
    conv = await create(client, auth_headers)
    r = await add_messages(client, auth_headers, conv["id"], ("user", "Hello"), ("assistant", "Hi there!"))
    assert r.status_code == 200, r.text
    created = r.json()["messages"]
    assert [(m["role"], m["content"]) for m in created] == [("user", "Hello"), ("assistant", "Hi there!")]
    assert all(m["conversation_id"] == conv["id"] for m in created)
    assert created[0]["created_at"] < created[1]["created_at"]
    # 紧接着再发一批(可能落在同一个时钟刻度内),仍须排在后面
    assert (await add_messages(client, auth_headers, conv["id"], ("user", "Again"))).status_code == 200
    listed = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["content"] for m in listed] == ["Hello", "Hi there!", "Again"]


async def test_posting_messages_bumps_conversation(client, auth_headers):
    a = await create(client, auth_headers, name="a")
    await asyncio.sleep(TICK)
    await create(client, auth_headers, name="b")
    await asyncio.sleep(TICK)
    await add_messages(client, auth_headers, a["id"], ("user", "hi"))
    names = [c["name"] for c in (await client.get(URL, headers=auth_headers)).json()["conversations"]]
    assert names == ["a", "b"]


@pytest.mark.parametrize(
    "payload",
    [
        {"messages": []},
        {"messages": [{"role": "user", "content": "x"}] * 11},
        {"messages": [{"role": "tool", "content": "x"}]},
        {"messages": [{"role": "user", "content": ""}]},
        {"messages": [{"role": "user", "content": "x" * 20001}]},
    ],
)
async def test_message_validation(client, auth_headers, payload):
    conv = await create(client, auth_headers)
    r = await client.post(f"{URL}/{conv['id']}/messages", headers=auth_headers, json=payload)
    assert r.status_code == 422


async def test_delete_message(client, auth_headers):
    conv = await create(client, auth_headers)
    msg = (await add_messages(client, auth_headers, conv["id"], ("user", "a"), ("assistant", "b"))).json()["messages"][0]
    r = await client.delete(f"/api/messages/{msg['id']}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": msg["id"]}
    listed = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["content"] for m in listed] == ["b"]
    r = await client.delete(f"/api/messages/{msg['id']}", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Message not found"}


async def test_isolation(client, auth_headers):
    conv = await create(client, auth_headers, name="private")
    msg = (await add_messages(client, auth_headers, conv["id"], ("user", "secret"))).json()["messages"][0]
    bob = await register(client, "bob")
    attempts = [
        ("GET", f"{URL}/{conv['id']}", None),
        ("PATCH", f"{URL}/{conv['id']}", {"name": "x"}),
        ("DELETE", f"{URL}/{conv['id']}", None),
        ("GET", f"{URL}/{conv['id']}/messages", None),
        ("POST", f"{URL}/{conv['id']}/messages", {"messages": [{"role": "user", "content": "x"}]}),
    ]
    for method, path, body in attempts:
        r = await client.request(method, path, headers=bob, json=body)
        assert r.status_code == 404, (method, path)
        assert r.json() == {"error": "Conversation not found"}
    r = await client.delete(f"/api/messages/{msg['id']}", headers=bob)
    assert r.status_code == 404 and r.json() == {"error": "Message not found"}
    assert (await client.get(URL, headers=bob)).json()["conversations"] == []
    mine = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["id"] for m in mine] == [msg["id"]]
    assert (await client.get(f"{URL}/{conv['id']}", headers=auth_headers)).json()["name"] == "private"


@pytest.mark.parametrize("settings_overrides", [{"max_conversations": 2}], indirect=True)
async def test_conversation_limit_is_per_user(client, auth_headers):
    await create(client, auth_headers)
    await create(client, auth_headers)
    r = await client.post(URL, headers=auth_headers, json={})
    assert r.status_code == 429
    assert r.json() == {"error": "Conversation limit reached"}
    bob = await register(client, "bob")
    await create(client, bob)


@pytest.mark.parametrize("settings_overrides", [{"max_messages_per_conversation": 3}], indirect=True)
async def test_message_limit_rejects_whole_batch(client, auth_headers):
    conv = await create(client, auth_headers)
    assert (await add_messages(client, auth_headers, conv["id"], ("user", "q"), ("assistant", "a"))).status_code == 200
    r = await add_messages(client, auth_headers, conv["id"], ("user", "q2"), ("assistant", "a2"))
    assert r.status_code == 429
    assert r.json() == {"error": "Message limit reached"}
    listed = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert len(listed) == 2
```

- [ ] **Step 2: 运行,确认失败**:`uv run pytest tests/test_conversations.py -q` → FAIL(未登录用例可能已过——被 stubs 返回 401;其余 404/405/`{}`)。

- [ ] **Step 3: 实现** `server/app/routers/conversations.py`:

```python
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import current_user, get_session, get_settings
from app.models import Conversation, Message, User, iso_utc, utcnow

router = APIRouter(prefix="/api")

DEFAULT_NAME = "New conversation"
MAX_CONFIG_BYTES = 16 * 1024
ItemId = Annotated[str, Path(max_length=64)]


def _clean_name(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


class ConversationIn(BaseModel):
    name: str = Field(default=DEFAULT_NAME, max_length=100)
    config: dict = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_name(value)


class ConversationPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    config: dict | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return _clean_name(value)


class MessageIn(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=20000)


class MessagesIn(BaseModel):
    messages: list[MessageIn] = Field(min_length=1, max_length=10)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _check_config(config: dict) -> None:
    if len(json.dumps(config, ensure_ascii=False).encode("utf-8")) > MAX_CONFIG_BYTES:
        raise HTTPException(400, "Config is too large")


def conversation_out(row: Conversation) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "config": row.config,
        "created_at": iso_utc(row.created_at),
        "updated_at": iso_utc(row.updated_at),
    }


def message_out(row: Message) -> dict:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "content": row.content,
        "created_at": iso_utc(row.created_at),
    }


async def owned_conversation(session: AsyncSession, user: User, conversation_id: str) -> Conversation:
    row = (
        await session.execute(
            select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Conversation not found")
    return row


@router.get("/conversations")
async def list_conversations(
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=50),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(Conversation)
            .where(Conversation.user_id == user.id)
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page + 1)
        )
    ).scalars().all()
    return {
        "conversations": [conversation_out(r) for r in rows[:per_page]],
        "page": page,
        "next": page + 1 if len(rows) > per_page else None,
    }


@router.post("/conversations")
async def create_conversation(
    payload: ConversationIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    _check_config(payload.config)
    count = await session.scalar(
        select(func.count()).select_from(Conversation).where(Conversation.user_id == user.id)
    )
    if count >= settings.max_conversations:
        raise HTTPException(429, "Conversation limit reached")
    now = utcnow()
    row = Conversation(
        id=str(uuid.uuid4()), user_id=user.id, name=payload.name, config=payload.config,
        created_at=now, updated_at=now,
    )
    session.add(row)
    await session.commit()
    return conversation_out(row)


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    return conversation_out(await owned_conversation(session, user, conversation_id))


@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    payload: ConversationPatch,
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_conversation(session, user, conversation_id)
    if payload.config is not None:
        _check_config(payload.config)
        row.config = payload.config
    if payload.name is not None:
        row.name = payload.name
    row.updated_at = utcnow()
    await session.commit()
    return conversation_out(row)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_conversation(session, user, conversation_id)
    # SQLite 默认不开外键级联,显式删除消息
    await session.execute(delete(Message).where(Message.conversation_id == row.id))
    await session.delete(row)
    await session.commit()
    return {"id": conversation_id}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_conversation(session, user, conversation_id)
    messages = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == row.id)
            .order_by(Message.created_at.asc(), Message.id.asc())
        )
    ).scalars().all()
    return {"messages": [message_out(m) for m in messages]}


@router.post("/conversations/{conversation_id}/messages")
async def create_messages(
    payload: MessagesIn,
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    conversation = await owned_conversation(session, user, conversation_id)
    existing = await session.scalar(
        select(func.count()).select_from(Message).where(Message.conversation_id == conversation.id)
    )
    if existing + len(payload.messages) > settings.max_messages_per_conversation:
        raise HTTPException(429, "Message limit reached")
    last = await session.scalar(
        select(func.max(Message.created_at)).where(Message.conversation_id == conversation.id)
    )
    base = utcnow()
    if last is not None and _as_utc(last) >= base:
        base = _as_utc(last) + timedelta(microseconds=1)
    rows = [
        Message(
            id=str(uuid.uuid4()), conversation_id=conversation.id, role=m.role, content=m.content,
            created_at=base + timedelta(microseconds=i),
        )
        for i, m in enumerate(payload.messages)
    ]
    session.add_all(rows)
    conversation.updated_at = rows[-1].created_at
    await session.commit()
    return {"messages": [message_out(r) for r in rows]}


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(
            select(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Message.id == message_id, Conversation.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Message not found")
    await session.delete(row)
    await session.commit()
    return {"id": message_id}
```

  `server/app/main.py`:import 增加 `conversations`,注册元组改为 `(health, sessions, config_api, speech, conversations, ai_chat, ai_audio, stubs)`(Task 1.4、1.5 再补 `assessments`、`web`)。

- [ ] **Step 4: 运行**:`uv run pytest tests/test_conversations.py -q` → PASS;全量 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/routers/conversations.py server/app/main.py server/tests/test_conversations.py
git commit -m "feat(server): persist web conversations and messages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.4:评测记录接口(列表、详情、音频、删除)

**Files:**
- Create: `server/app/routers/assessments.py`, `server/tests/test_assessments_api.py`
- Modify: `server/app/main.py`

**Interfaces:**
- Consumes:`Assessment`、`iso_utc`(Task 1.1);`recordings.absolute_path`、`recordings.delete_recording`、`recordings.recording_relpath`、`recordings.write_recording`、`save=true` 行为(Task 1.2)。
- Produces(全部需 Bearer;他人记录 → `404 {"error": "Assessment not found"}`):

| 方法与路径 | 成功响应 |
|---|---|
| `GET /api/assessments?page=1&per_page=20` | `{"assessments": [Summary], "page": 1, "next": 2 或 null}`,按 `created_at` 倒序 |
| `GET /api/assessments/{id}` | `Summary` + `"result": {…save 时的完整评测响应,不含 assessment_id…}` |
| `GET /api/assessments/{id}/audio` | `audio/wav` 字节流,`Cache-Control: private, no-store`;文件缺失 → `404 {"error": "Recording not found"}` |
| `DELETE /api/assessments/{id}` | `{"id": "<id>"}`,同时删除录音文件 |

  `Summary = {"id", "reference_text", "language", "duration_ms", "scores": {"pronunciation_score", "accuracy_score", "fluency_score", "completeness_score"}, "created_at"}`(**不含** `audio_path`、`audio_bytes`、`result`)。

- [ ] **Step 1: 写失败测试** `server/tests/test_assessments_api.py`:

```python
import io
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.models import Assessment
from app.recordings import recording_relpath, write_recording
from app.xfyun import get_xfyun

FIXTURES = Path(__file__).parent / "fixtures"
GOOD_XML = (FIXTURES / "ise_good.xml").read_text(encoding="utf-8")
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
SCORES = {"pronunciation_score": 80.0, "accuracy_score": 81.0, "fluency_score": 82.0, "completeness_score": 83.0}
SUMMARY_KEYS = {"id", "reference_text", "language", "duration_ms", "scores", "created_at"}


def make_wav(seconds=0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x02\x00" * int(16000 * seconds))
    return buf.getvalue()


class FakeXfyun:
    configured = True

    async def evaluate(self, pcm, text, ent, timeout=60.0):
        return GOOD_XML


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def user_id(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def seed(app, uid, n=1) -> list[str]:
    data_dir = app.state.settings.resolved_data_dir
    base = datetime(2026, 10, 4, tzinfo=timezone.utc)
    ids = []
    async with app.state.sessionmaker() as s:
        for i in range(n):
            aid = str(uuid.uuid4())
            rel = recording_relpath(uid, aid)
            wav = make_wav()
            write_recording(data_dir, rel, wav)
            s.add(Assessment(
                id=aid, user_id=uid, reference_text=f"Sentence {i}", language="en-US", duration_ms=500,
                audio_bytes=len(wav), scores=SCORES, result={**SCORES, "detail_result": {"words": []}},
                audio_path=rel, created_at=base + timedelta(minutes=i),
            ))
            ids.append(aid)
        await s.commit()
    return ids


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/assessments"), ("GET", "/api/assessments/x"),
    ("GET", "/api/assessments/x/audio"), ("DELETE", "/api/assessments/x"),
])
async def test_requires_login(client, method, path):
    r = await client.request(method, path)
    assert r.status_code == 401


async def test_list_is_newest_first_and_paginated(app, client, auth_headers):
    ids = await seed(app, await user_id(client, auth_headers), n=3)
    first = (await client.get("/api/assessments", headers=auth_headers, params={"per_page": 2})).json()
    assert [a["id"] for a in first["assessments"]] == [ids[2], ids[1]]
    assert first["page"] == 1 and first["next"] == 2
    assert set(first["assessments"][0]) == SUMMARY_KEYS
    assert first["assessments"][0]["scores"] == SCORES
    assert first["assessments"][0]["created_at"].endswith("+00:00")
    second = (await client.get("/api/assessments", headers=auth_headers, params={"per_page": 2, "page": 2})).json()
    assert [a["id"] for a in second["assessments"]] == [ids[0]]
    assert second["next"] is None


async def test_per_page_capped(client, auth_headers):
    assert (await client.get("/api/assessments", headers=auth_headers, params={"per_page": 51})).status_code == 422


async def test_detail_includes_result(app, client, auth_headers):
    (aid,) = await seed(app, await user_id(client, auth_headers))
    body = (await client.get(f"/api/assessments/{aid}", headers=auth_headers)).json()
    assert set(body) == SUMMARY_KEYS | {"result"}
    assert body["result"]["detail_result"] == {"words": []}


async def test_audio_streams_wav(app, client, auth_headers):
    (aid,) = await seed(app, await user_id(client, auth_headers))
    r = await client.get(f"/api/assessments/{aid}/audio", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/wav")
    assert r.headers["cache-control"] == "private, no-store"
    assert r.content == make_wav()


async def test_audio_missing_file(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (aid,) = await seed(app, uid)
    (app.state.settings.resolved_data_dir / recording_relpath(uid, aid)).unlink()
    r = await client.get(f"/api/assessments/{aid}/audio", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Recording not found"}


async def test_audio_path_traversal_is_refused(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (app.state.settings.resolved_data_dir.parent / "evil.wav").write_bytes(b"EVIL")
    async with app.state.sessionmaker() as s:
        s.add(Assessment(id="evil", user_id=uid, reference_text="x", language="en-US", duration_ms=1,
                         audio_bytes=4, scores=SCORES, result={}, audio_path="../evil.wav"))
        await s.commit()
    r = await client.get("/api/assessments/evil/audio", headers=auth_headers)
    assert r.status_code == 404
    assert b"EVIL" not in r.content


async def test_delete_removes_row_and_file(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (aid,) = await seed(app, uid)
    path = app.state.settings.resolved_data_dir / recording_relpath(uid, aid)
    r = await client.delete(f"/api/assessments/{aid}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": aid}
    assert not path.exists()
    assert (await client.get(f"/api/assessments/{aid}", headers=auth_headers)).status_code == 404
    assert (await client.delete(f"/api/assessments/{aid}", headers=auth_headers)).status_code == 404


async def test_isolation(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (aid,) = await seed(app, uid)
    bob = await register(client, "bob")
    for method, path in [("GET", f"/api/assessments/{aid}"), ("GET", f"/api/assessments/{aid}/audio"),
                         ("DELETE", f"/api/assessments/{aid}")]:
        r = await client.request(method, path, headers=bob)
        assert r.status_code == 404 and r.json() == {"error": "Assessment not found"}
    assert (await client.get("/api/assessments", headers=bob)).json()["assessments"] == []
    assert (app.state.settings.resolved_data_dir / recording_relpath(uid, aid)).exists()


async def test_saved_assessment_round_trip(app, client, auth_headers):
    app.dependency_overrides[get_xfyun] = lambda: FakeXfyun()
    wav = make_wav()
    r = await client.post(
        "/api/speech/assessments", headers=auth_headers,
        data={"reference": REFERENCE, "language": "en-US", "save": "true"},
        files={"file": ("audio.wav", wav, "audio/wav")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    aid = body.pop("assessment_id")
    detail = (await client.get(f"/api/assessments/{aid}", headers=auth_headers)).json()
    assert detail["result"] == body
    assert detail["reference_text"] == REFERENCE
    assert detail["duration_ms"] == 500
    audio = await client.get(f"/api/assessments/{aid}/audio", headers=auth_headers)
    assert audio.content == wav
```

- [ ] **Step 2: 运行,确认失败**:`uv run pytest tests/test_assessments_api.py -q` → FAIL。

- [ ] **Step 3: 实现** `server/app/routers/assessments.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import recordings
from app.config import Settings
from app.deps import current_user, get_session, get_settings
from app.models import Assessment, User, iso_utc

router = APIRouter(prefix="/api")

ItemId = Annotated[str, Path(max_length=64)]


def summary_out(row: Assessment) -> dict:
    return {
        "id": row.id,
        "reference_text": row.reference_text,
        "language": row.language,
        "duration_ms": row.duration_ms,
        "scores": row.scores,
        "created_at": iso_utc(row.created_at),
    }


async def owned_assessment(session: AsyncSession, user: User, assessment_id: str) -> Assessment:
    row = (
        await session.execute(
            select(Assessment).where(Assessment.id == assessment_id, Assessment.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Assessment not found")
    return row


@router.get("/assessments")
async def list_assessments(
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=50),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(Assessment)
            .where(Assessment.user_id == user.id)
            .order_by(Assessment.created_at.desc(), Assessment.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page + 1)
        )
    ).scalars().all()
    return {
        "assessments": [summary_out(r) for r in rows[:per_page]],
        "page": page,
        "next": page + 1 if len(rows) > per_page else None,
    }


@router.get("/assessments/{assessment_id}")
async def get_assessment(
    assessment_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_assessment(session, user, assessment_id)
    return {**summary_out(row), "result": row.result}


@router.get("/assessments/{assessment_id}/audio")
async def get_assessment_audio(
    assessment_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    row = await owned_assessment(session, user, assessment_id)
    try:
        path = recordings.absolute_path(settings.resolved_data_dir, row.audio_path)
    except ValueError:
        raise HTTPException(404, "Recording not found")
    if not path.is_file():
        raise HTTPException(404, "Recording not found")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


@router.delete("/assessments/{assessment_id}")
async def delete_assessment(
    assessment_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    row = await owned_assessment(session, user, assessment_id)
    relpath = row.audio_path
    await session.delete(row)
    await session.commit()
    recordings.delete_recording(settings.resolved_data_dir, relpath)
    return {"id": assessment_id}
```

  `server/app/main.py`:import 增加 `assessments`;元组改为 `(health, sessions, config_api, speech, conversations, assessments, ai_chat, ai_audio, stubs)`。

- [ ] **Step 4: 运行**:`uv run pytest tests/test_assessments_api.py -q` → PASS;全量 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/routers/assessments.py server/app/main.py server/tests/test_assessments_api.py
git commit -m "feat(server): list, replay and delete saved assessments" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.5:静态托管与 SPA 回退、环境变量与接口文档

**Files:**
- Create: `server/app/routers/web.py`, `server/tests/test_web_static.py`
- Modify: `server/app/main.py`, `server/.env.example`, `server/README.md`(只改「接口一览」图)

**Interfaces:**
- Consumes:`Settings.web_dist_dir`(Task 1.1)。
- Produces:`app.routers.web.router`(必须最后注册);`DEFAULT_DIST = <仓库根>/web/dist`(由文件位置推导:`Path(__file__).resolve().parents[3] / "web" / "dist"`,Docker 镜像中 `/app/app/routers/web.py` 推导为 `/web/dist`);行为见 R4。

- [ ] **Step 1: 写失败测试** `server/tests/test_web_static.py`:

```python
from pathlib import Path

import pytest

INDEX = '<!doctype html><div id="root"></div>'
IMMUTABLE = "public, max-age=31536000, immutable"


@pytest.fixture
def dist(tmp_path) -> Path:
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text(INDEX, encoding="utf-8")
    (d / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (d / "assets" / "index-abc123.css").write_text("body{}", encoding="utf-8")
    (d / "sw.js").write_text("self.addEventListener('fetch', () => {})", encoding="utf-8")
    (d / "manifest.webmanifest").write_text('{"name":"Enjoy"}', encoding="utf-8")
    (tmp_path / "secret.txt").write_text("TOP-SECRET", encoding="utf-8")
    return d


@pytest.fixture
def settings_overrides(dist):
    return {"web_dist_dir": str(dist)}


async def test_root_serves_index(client):
    r = await client.get("/")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"
    assert r.text == INDEX


@pytest.mark.parametrize("path", ["/practice", "/practice/history", "/chat/abc", "/me", "/login"])
async def test_spa_fallback(client, path):
    r = await client.get(path)
    assert r.status_code == 200
    assert r.text == INDEX
    assert r.headers["cache-control"] == "no-cache"


async def test_hashed_assets_are_immutable(client):
    js = await client.get("/assets/index-abc123.js")
    assert js.status_code == 200
    assert "javascript" in js.headers["content-type"]
    assert js.headers["cache-control"] == IMMUTABLE
    css = await client.get("/assets/index-abc123.css")
    assert css.headers["content-type"].startswith("text/css")


async def test_missing_asset_is_404(client):
    r = await client.get("/assets/nope.js")
    assert r.status_code == 404
    assert r.json() == {"error": "Not Found"}


@pytest.mark.parametrize("path", ["/api", "/api/nope", "/api/conversations/x/unknown"])
async def test_api_paths_never_fall_back(client, auth_headers, path):
    r = await client.get(path, headers=auth_headers)
    assert r.status_code == 404
    assert r.json() == {"error": "Not Found"}


async def test_health_and_api_unaffected(client, auth_headers):
    assert (await client.get("/up")).json() == {"status": "ok"}
    assert (await client.get("/api/me", headers=auth_headers)).status_code == 200
    # 兜底写入仍由 stubs 处理
    assert (await client.post("/api/whatever", headers=auth_headers, json={})).json() == {}


async def test_service_worker_and_manifest(client):
    sw = await client.get("/sw.js")
    assert sw.status_code == 200
    assert "javascript" in sw.headers["content-type"]
    assert sw.headers["cache-control"] == "no-cache"
    manifest = await client.get("/manifest.webmanifest")
    assert manifest.headers["content-type"].startswith("application/manifest+json")


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/..%2fsecret.txt"])
async def test_no_path_traversal(client, path):
    r = await client.get(path)
    assert "TOP-SECRET" not in r.text


async def test_post_to_spa_path_not_allowed(client):
    assert (await client.post("/practice")).status_code == 405


async def test_head_root(client):
    assert (await client.head("/")).status_code == 200


async def test_missing_dist_reports_not_built(app, client, tmp_path):
    app.state.settings.web_dist_dir = str(tmp_path / "nowhere")
    r = await client.get("/practice")
    assert r.status_code == 404
    assert r.json() == {"error": "Web app is not built"}
    assert (await client.get("/up")).status_code == 200
```

- [ ] **Step 2: 运行,确认失败**:`uv run pytest tests/test_web_static.py -q` → FAIL(`/` 返回 404 JSON 等)。

- [ ] **Step 3: 实现** `server/app/routers/web.py`:

```python
"""托管 web/dist(手机网页版)。必须最后注册:/api/** 与其他真实路由优先。"""

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import Settings
from app.deps import get_settings

# Windows 注册表可能把 .js 映射成 text/plain,显式指定。
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/manifest+json", ".webmanifest")

router = APIRouter()

# server/app/routers/web.py → 仓库根/web/dist;镜像内 /app/app/routers/web.py → /web/dist
DEFAULT_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"
IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache"


def dist_dir(settings: Settings) -> Path:
    return Path(settings.web_dist_dir) if settings.web_dist_dir else DEFAULT_DIST


@router.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def web_app(path: str, settings: Settings = Depends(get_settings)):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "Not Found")
    root = dist_dir(settings).resolve()
    index = root / "index.html"
    if not index.is_file():
        raise HTTPException(404, "Web app is not built")
    if path:
        candidate = (root / path).resolve()
        if candidate.is_relative_to(root) and candidate.is_file():
            cache = IMMUTABLE if path.startswith("assets/") else NO_CACHE
            return FileResponse(candidate, headers={"Cache-Control": cache})
        if path.startswith("assets/"):
            raise HTTPException(404, "Not Found")
    return FileResponse(index, headers={"Cache-Control": NO_CACHE})
```

  `server/app/main.py`:import 增加 `web`;注释与元组改为:

```python
    # 顺序重要:stubs 含 /api/** 的兜底写入路由,真实 API 必须在它之前;
    # web(静态托管 + SPA 回退)兜底所有非 API 的 GET,必须最后。
    for module in (
        health, sessions, config_api, speech, conversations, assessments,
        ai_chat, ai_audio, stubs, web,
    ):
        app.include_router(module.router)
```

  `server/.env.example`:在 `APP_VERSION` 之前追加:

```
# ---- 网页版数据(对话、评测记录与录音)----
# 录音目录;留空时:SQLite 文件库 → 与库文件同目录;否则 /data(compose 卷)
DATA_DIR=
# 每个用户的录音总量上限(MB)、对话数上限、单个对话的消息数上限
RECORDING_QUOTA_MB=500
MAX_CONVERSATIONS=200
MAX_MESSAGES_PER_CONVERSATION=1000
# 网页版构建产物目录;留空使用 <仓库根>/web/dist(Docker 镜像内为 /web/dist)
WEB_DIST_DIR=
```

  `server/README.md` 的「接口一览」图:在 `/api/speech/assessments` 行下加:

```
                                ├ /api/conversations[/{id}[/messages]], /api/messages/{id}   网页版对话(持久化)
                                ├ /api/assessments[/{id}[/audio]]       网页版评测记录与录音回放
                                ├ 其余 POST/PUT/DELETE /api/**  鉴权后返回 {}(同步占位)
                                └ 其他 GET                       网页版(web/dist,SPA 回退到 index.html)
                              DB: users / access_tokens / speech_tokens / conversations / messages / assessments
```
  (替换原来的最后两行;`/api/speech/assessments` 行末补一句「`save=true` 时保存录音与记录」。)

- [ ] **Step 4: 运行**:`uv run pytest tests/test_web_static.py -q` → PASS;全量 `uv run pytest -q` → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/app/routers/web.py server/app/main.py server/tests/test_web_static.py server/.env.example server/README.md
git commit -m "feat(server): host the web app with SPA fallback after all API routes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 1

- [ ] `cd server && uv run pytest -q` → 0 failed,通过数 = 296 + 本阶段新增。
- [ ] `git diff --stat f8b48fa5 -- server/tests/test_speech_assessments.py server/tests/test_stubs.py` → 无输出(既有评测与 stubs 测试原样通过 = 不带 `save` 的行为不变)。
- [ ] Postgres(独立项目,不碰用户数据;若 5432 被占用先停掉占用者):

```bash
cd /e/workspace/everyone-can-use-english
export POSTGRES_USER=enjoy POSTGRES_PASSWORD=pgtest POSTGRES_DB=enjoy
docker compose -p enjoy-pgtest --profile postgres up -d --wait postgres
docker compose -p enjoy-pgtest exec postgres psql -U enjoy -d enjoy -c 'CREATE DATABASE enjoy_test;'
cd server
export DATABASE_URL=postgresql+asyncpg://enjoy:pgtest@127.0.0.1:5432/enjoy
uv run alembic upgrade head && uv run alembic downgrade 0002 && uv run alembic upgrade head
TEST_DATABASE_URL=postgresql+asyncpg://enjoy:pgtest@127.0.0.1:5432/enjoy_test uv run pytest -q
unset DATABASE_URL
cd .. && docker compose -p enjoy-pgtest --profile postgres down -v
```

  预期:三次 alembic 均无报错;pytest 0 failed。
- [ ] `git grep -nE "XFYUN_API_(KEY|SECRET)=.+|UPSTREAM_[A-Z]+_KEY=.+" -- . ':!server/.env'` → 无输出。

---

## 阶段 2:网页骨架

### Task 2.1:`web/` workspace、别名、主题、i18n 与测试工具

**Files:**
- Modify: `package.json`(根)、`yarn.lock`、`.gitignore`
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/tailwind.config.cjs`, `web/postcss.config.cjs`, `web/index.html`, `web/.env.example`, `web/README.md`, `web/src/main.tsx`, `web/src/app.tsx`, `web/src/index.css`, `web/src/styles/theme.css`, `web/src/shims/{enjoy-ui.ts,enjoy-components.ts,empty-module.ts}`, `web/src/i18n/{index.ts,en.json,zh-CN.json}`, `web/src/test/{setup.ts,fetch-mock.ts}`, `web/src/test/fixtures/assessment-good.json`
- Test: `web/src/styles/theme.test.ts`, `web/src/shims/shims.test.tsx`, `web/src/i18n/i18n.test.ts`

**Interfaces:**
- Consumes:阶段 0 结论文档「A. 别名构建」记录的差异(缺失依赖、额外 include)——**先读它,把差异并入本任务**。
- Produces:
  - 路径别名:`~/*` → `web/src/*`;`@/*` → `enjoy/src/*`;`@renderer/*` → `enjoy/src/renderer/*`;`@renderer/components` → `web/src/shims/enjoy-components.ts`;`@renderer/components/ui`(及 `@/renderer/components/ui`)→ `web/src/shims/enjoy-ui.ts`。
  - `~/i18n`:默认导出 i18next 实例(即 `i18next` 默认实例,enjoy 组件里的 `import { t } from "i18next"` 共用它);`SUPPORTED_LANGUAGES = ["en", "zh-CN", "es"] as const`;`type UiLanguage`;`deepMerge(a, b)`;`webMessages(lang)`。各目录 `**/i18n/{en,zh-CN}.json` 自动合并。
  - `~/test/fetch-mock`:`createFetchMock(routes: Record<"METHOD /path", Handler>) → { fetch, calls: RecordedCall[] }`、`json(body, status = 200): Response`;`RecordedCall = { method: string; url: URL; headers: Headers; body: BodyInit | null | undefined; signal?: AbortSignal | null }`。
  - 测试夹具 `~/test/fixtures/assessment-good.json`:服务端 `to_assessment` 对 `ise_good.xml` 的 snake_case 输出。
  - 根脚本:`web:dev`、`web:build`、`web:test`、`web:typecheck`、`web:e2e`。

- [ ] **Step 1: 根目录与忽略规则**

`package.json`(根):`"workspaces"` 改为 `["enjoy", "1000-hours", "1000h-portal", "web"]`;`scripts` 追加:

```json
    "web:dev": "yarn workspace web dev",
    "web:build": "yarn workspace web build",
    "web:test": "yarn workspace web test",
    "web:typecheck": "yarn workspace web typecheck",
    "web:e2e": "yarn workspace web e2e"
```

`.gitignore` 末尾追加:

```gitignore
# mobile web
web/dist/
web/.env
```

- [ ] **Step 2: `web/package.json`**(版本与 `enjoy/node_modules` 中实际安装的一致;阶段 0 记录的缺失依赖一并加入 `dependencies`):

```json
{
  "name": "web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p .",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@radix-ui/react-alert-dialog": "^1.1.6",
    "@radix-ui/react-dialog": "^1.1.6",
    "@radix-ui/react-icons": "^1.3.2",
    "@radix-ui/react-label": "^2.1.2",
    "@radix-ui/react-popover": "^1.1.6",
    "@radix-ui/react-progress": "^1.1.2",
    "@radix-ui/react-scroll-area": "^1.2.3",
    "@radix-ui/react-separator": "^1.1.2",
    "@radix-ui/react-slot": "^1.1.2",
    "@radix-ui/react-switch": "^1.1.3",
    "@uidotdev/usehooks": "^2.4.1",
    "camelcase-keys": "^9.1.3",
    "chart.js": "^4.4.8",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "dayjs": "^1.11.13",
    "i18next": "^24.2.3",
    "lucide-react": "^0.479.0",
    "pitchfinder": "^2.3.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-i18next": "^15.4.1",
    "tailwind-merge": "^2.6.0",
    "uuid": "^10.0.0",
    "wavesurfer.js": "^7.9.1"
  },
  "devDependencies": {
    "@tailwindcss/typography": "^0.5.16",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.2.0",
    "@types/node": "^22.13.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@types/uuid": "^10.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.21",
    "jsdom": "^26.0.0",
    "postcss": "^8.5.3",
    "tailwind-scrollbar": "^3.1.0",
    "tailwind-scrollbar-hide": "^2.0.0",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.8.2",
    "vite": "^6.2.2",
    "vitest": "^3.0.9"
  }
}
```

Run: `cd /e/workspace/everyone-can-use-english && yarn install`
Expected:成功;`web/node_modules/react` 存在;`git status --short` 显示 `package.json`、`yarn.lock`、`web/` 改动;**`enjoy/node_modules` 仍完整**(`ls enjoy/node_modules | wc -l` 与安装前一致,约 996)。

- [ ] **Step 3: 工程配置文件**

`web/vite.config.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..");
const enjoySrc = path.join(repoRoot, "enjoy", "src");
const posix = (p: string) => p.split(path.sep).join("/");
const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const shim = (name: string) => posix(path.join(webRoot, "src", "shims", name));

/** enjoy/src 里引入的裸模块必须由 web/package.json 提供(裁定 R15)。 */
function guardEnjoyDeps(): Plugin {
  return {
    name: "guard-enjoy-deps",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !posix(importer).includes("/enjoy/src/")) return null;
      const bare = /^(@[\w.-]+\/)?[\w.-]/.test(source) && !path.isAbsolute(source);
      if (!bare || source.startsWith("@/") || source.startsWith("@renderer/") || source.startsWith("~/")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && posix(resolved.id).includes("/enjoy/node_modules/")) {
        this.error(`"${source}" (imported by ${posix(path.relative(repoRoot, importer))}) must be a dependency of web/package.json`);
      }
      return resolved;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, webRoot, "WEB_");
  return {
    plugins: [guardEnjoyDeps(), react()],
    resolve: {
      alias: [
        { find: /^@renderer\/components$/, replacement: shim("enjoy-components.ts") },
        { find: /^@renderer\/components\/ui$/, replacement: shim("enjoy-ui.ts") },
        { find: /^@\/renderer\/components\/ui$/, replacement: shim("enjoy-ui.ts") },
        { find: /^@bugsnag\/electron$/, replacement: shim("empty-module.ts") },
        { find: /^electron-log\/renderer$/, replacement: shim("empty-module.ts") },
        { find: /^@renderer\//, replacement: `${posix(enjoySrc)}/renderer/` },
        { find: /^@\//, replacement: `${posix(enjoySrc)}/` },
        { find: /^~\//, replacement: `${posix(path.join(webRoot, "src"))}/` },
      ],
      dedupe: runtimeDeps,
    },
    server: {
      fs: { allow: [repoRoot] },
      proxy: { "/api": { target: env.WEB_DEV_API_TARGET || "http://127.0.0.1:8000" } },
    },
    build: { outDir: "dist", emptyOutDir: true, target: ["es2020", "safari15"], chunkSizeWarningLimit: 1500 },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      css: false,
      restoreMocks: true,
    },
  };
});
```

`web/tsconfig.json`(`isolatedModules`/`strict` 不开:enjoy 源码在同一程序里检查,设置须与 `enjoy/tsconfig.json` 兼容;`"*"` 映射让 enjoy 文件的裸模块类型也解析到 web 的 `node_modules`,避免两份 React 类型):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noImplicitAny": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["vite/client", "node"],
    "baseUrl": ".",
    "paths": {
      "@renderer/components": ["./src/shims/enjoy-components.ts"],
      "@renderer/components/ui": ["./src/shims/enjoy-ui.ts"],
      "@/renderer/components/ui": ["./src/shims/enjoy-ui.ts"],
      "@renderer/*": ["../enjoy/src/renderer/*"],
      "@/*": ["../enjoy/src/*"],
      "~/*": ["./src/*"],
      "*": ["./node_modules/*", "./node_modules/@types/*"]
    }
  },
  "include": ["src", "e2e", "playwright.config.ts", "vite.config.ts", "../enjoy/src/types/pronunciation-assessment.d.ts"]
}
```

`web/tailwind.config.cjs`(裁定 R8:直接执行 enjoy 的配置,插件从 web 的依赖解析,vidstack 插件换成空插件):

```js
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const ENJOY_CONFIG = path.resolve(__dirname, "../enjoy/tailwind.config.js");
const webRequire = createRequire(__filename);
const noopPlugin = webRequire("tailwindcss/plugin")(() => {});

function loadEnjoyConfig() {
  const source = fs.readFileSync(ENJOY_CONFIG, "utf8");
  const mod = { exports: {} };
  const requireFromWeb = (id) => (id === "@vidstack/react/tailwind.cjs" ? noopPlugin : webRequire(id));
  new Function("module", "exports", "require", source)(mod, mod.exports, requireFromWeb);
  return mod.exports;
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...loadEnjoyConfig(),
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../enjoy/src/renderer/components/ui/**/*.tsx",
    "../enjoy/src/renderer/components/pronunciation-assessments/**/*.tsx",
    "../enjoy/src/renderer/components/misc/wavesurfer-player.tsx",
  ],
};
```

`web/postcss.config.cjs`:

```js
const path = require("node:path");

module.exports = {
  plugins: {
    tailwindcss: { config: path.join(__dirname, "tailwind.config.cjs") },
    autoprefixer: {},
  },
};
```

`web/index.html`(PWA 相关 `<link>` 在 Task 2.6 补):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
    <title>Enjoy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/.env.example`:

```
# 开发服务器把 /api 代理到这里(本机 uvicorn 默认地址)
WEB_DEV_API_TARGET=http://127.0.0.1:8000
```

- [ ] **Step 4: shim、样式、i18n、入口**

`web/src/shims/enjoy-ui.ts`:

```ts
// enjoy 的 components/ui barrel 会把 cmdk、input-otp、react-resizable-panels 等带进来;
// web 只暴露用到的组件。被复用的 enjoy 组件 import "@renderer/components/ui" 时也走这里。
export * from "@renderer/components/ui/alert-dialog";
export * from "@renderer/components/ui/button";
export * from "@renderer/components/ui/card";
export * from "@renderer/components/ui/input";
export * from "@renderer/components/ui/label";
export * from "@renderer/components/ui/popover";
export * from "@renderer/components/ui/progress";
export * from "@renderer/components/ui/radial-progress";
export * from "@renderer/components/ui/scroll-area";
export * from "@renderer/components/ui/separator";
export * from "@renderer/components/ui/sheet";
export * from "@renderer/components/ui/skeleton";
export * from "@renderer/components/ui/switch";
export * from "@renderer/components/ui/textarea";
```

`web/src/shims/enjoy-components.ts`:

```ts
// enjoy 的 @renderer/components barrel 依赖 Electron(EnjoyApp)。被复用的评分组件只从它取这两个导出。
export { PronunciationAssessmentWordResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-word-result";
export { scoreColor } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-score-result";
```

`web/src/shims/empty-module.ts`:

```ts
// @bugsnag/electron、electron-log/renderer 在浏览器里的空实现。
const noop = () => undefined;
const stub: Record<string, unknown> = new Proxy({}, { get: () => noop });
export default stub;
export const log = noop;
```

`web/src/styles/theme.css`:把 `enjoy/src/index.css` 第一个 `@layer base { … }` 里的 `:root { … }` 与 `.dark { … }` 两个块**原样**复制进来(不带 `@layer` 外壳),文件头加注释:

```css
/* 主题变量:与 enjoy/src/index.css 的 :root / .dark 保持一致(src/styles/theme.test.ts 校验)。
   不直接 @import enjoy 的 index.css:它带 vidstack/intl-tel-input 样式与 user-select:none。 */
```

`web/src/index.css`:

```css
@import "./styles/theme.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * {
    @apply border-border;
  }
  html,
  body,
  #root {
    height: 100%;
  }
  body {
    @apply bg-background text-foreground;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior-y: none;
  }
  @font-face {
    font-family: "CharisSIL";
    src: url("../../enjoy/assets/fonts/CharisSIL-Regular.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
}

/* iOS 聚焦时会放大字号 < 16px 的输入框;触屏设备一律 16px。 */
@media (pointer: coarse) {
  input,
  textarea,
  select {
    font-size: 16px !important;
  }
}
```

`web/src/i18n/index.ts`:

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enjoyEn from "@/i18n/en.json";
import enjoyEs from "@/i18n/es.json";
import enjoyZh from "@/i18n/zh-CN.json";

export const SUPPORTED_LANGUAGES = ["en", "zh-CN", "es"] as const;
export type UiLanguage = (typeof SUPPORTED_LANGUAGES)[number];

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function deepMerge(target: Dict, source: Dict): Dict {
  const out: Dict = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isDict(value) && isDict(out[key]) ? deepMerge(out[key] as Dict, value) : value;
  }
  return out;
}

// 各目录自带的 i18n/<语言>.json(裁定 R11),新增功能不必改本文件。
const webFiles = import.meta.glob<Dict>("../**/i18n/*.json", { eager: true, import: "default" });

export function webMessages(lang: "en" | "zh-CN"): Dict {
  return Object.entries(webFiles)
    .filter(([file]) => file.endsWith(`/${lang}.json`))
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<Dict>((acc, [, dict]) => deepMerge(acc, dict), {});
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: deepMerge(enjoyEn as Dict, webMessages("en")) },
    "zh-CN": { translation: deepMerge(enjoyZh as Dict, webMessages("zh-CN")) },
    es: { translation: enjoyEs as Dict },
  },
  lng: "en",
  supportedLngs: [...SUPPORTED_LANGUAGES],
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
});

export default i18n;
```

`web/src/i18n/en.json` 与 `zh-CN.json`(阶段 2 全部文案一次写好,后续任务直接使用):

```json
{
  "web": {
    "appName": "Enjoy English Practice",
    "common": { "loading": "Loading…", "retry": "Retry", "cancel": "Cancel", "delete": "Delete", "loadMore": "Load more", "back": "Back" },
    "nav": { "label": "Main", "practice": "Practice", "chat": "Chat", "me": "Me" },
    "languages": { "en": "English", "zh-CN": "简体中文", "es": "Español" },
    "login": {
      "username": "Username", "password": "Password", "submit": "Log in", "registerSubmit": "Create account",
      "switchToRegister": "No account? Register", "switchToLogin": "Have an account? Log in",
      "inviteCode": "Invite code (if required)", "inviteHint": "Leave empty if the server allows open registration.",
      "required": "Please enter username and password.",
      "usernameInvalid": "Username: 3–32 lowercase letters, digits or underscores.",
      "passwordLength": "Password must be 8–128 characters."
    },
    "errors": {
      "invalidLogin": "Invalid username or password.", "usernameTaken": "This username is already taken.",
      "registrationClosed": "Registration is closed on this server.", "invalidInvite": "Invalid invite code.",
      "tooManyRequests": "Too many requests. Please try again later.", "network": "Network error. Check your connection.",
      "timeout": "The request timed out.", "unknown": "Something went wrong."
    },
    "me": {
      "title": "Me", "username": "Account", "language": "Language",
      "languageHint": "Also used as the target language for translations.",
      "services": "Server speech services", "stt": "Speech-to-text: server Whisper",
      "tts": "Text-to-speech models: {{models}}", "ttsDefault": "Default voice: {{voice}}",
      "logout": "Log out", "install": "Add to Home Screen"
    },
    "install": {
      "title": "Add to Home Screen", "step1": "Tap the Share button in Safari's toolbar.",
      "step2": "Scroll down and choose “Add to Home Screen”.", "step3": "Open Enjoy from the new icon on your Home Screen.",
      "httpsNote": "Recording and installing require an HTTPS address."
    }
  }
}
```

```json
{
  "web": {
    "appName": "Enjoy 英语练习",
    "common": { "loading": "加载中…", "retry": "重试", "cancel": "取消", "delete": "删除", "loadMore": "加载更多", "back": "返回" },
    "nav": { "label": "主导航", "practice": "练习", "chat": "对话", "me": "我的" },
    "languages": { "en": "English", "zh-CN": "简体中文", "es": "Español" },
    "login": {
      "username": "用户名", "password": "密码", "submit": "登录", "registerSubmit": "注册",
      "switchToRegister": "没有账号?注册", "switchToLogin": "已有账号?登录",
      "inviteCode": "邀请码(如服务器要求)", "inviteHint": "服务器开放注册时可留空。",
      "required": "请输入用户名和密码。",
      "usernameInvalid": "用户名为 3–32 位小写字母、数字或下划线。",
      "passwordLength": "密码长度为 8–128 位。"
    },
    "errors": {
      "invalidLogin": "用户名或密码错误。", "usernameTaken": "用户名已被占用。",
      "registrationClosed": "该服务器已关闭注册。", "invalidInvite": "邀请码无效。",
      "tooManyRequests": "请求过于频繁,请稍后再试。", "network": "网络错误,请检查连接。",
      "timeout": "请求超时。", "unknown": "出错了。"
    },
    "me": {
      "title": "我的", "username": "账号", "language": "语言",
      "languageHint": "同时作为翻译的目标语言。",
      "services": "服务器语音服务", "stt": "语音转文字:服务器 Whisper",
      "tts": "语音合成模型:{{models}}", "ttsDefault": "默认音色:{{voice}}",
      "logout": "退出登录", "install": "添加到主屏幕"
    },
    "install": {
      "title": "添加到主屏幕", "step1": "点 Safari 工具栏中的「分享」按钮。",
      "step2": "向下滑动,选择「添加到主屏幕」。", "step3": "从主屏幕上的新图标打开 Enjoy。",
      "httpsNote": "录音和添加到主屏幕都需要 HTTPS 地址。"
    }
  }
}
```

`web/src/app.tsx`(Task 2.5 替换为完整路由):

```tsx
import { useTranslation } from "react-i18next";

export function App() {
  const { t } = useTranslation();
  return <h1 className="p-4 text-xl font-semibold">{t("web.appName")}</h1>;
}
```

`web/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n";
import { App } from "./app";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`web/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import "~/i18n";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
// jsdom 没有这些 API;enjoy 的 ScrollArea、WavesurferPlayer 与 web 的主题代码会用到。
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => cleanup());
```

`web/src/test/fetch-mock.ts`:

```ts
import { vi } from "vitest";

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  body: BodyInit | null | undefined;
  signal?: AbortSignal | null;
}
export type Handler = (call: RecordedCall) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** routes 的键形如 "POST /api/sessions";未匹配返回 404 {"error":"Not Found"}。 */
export function createFetchMock(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const call: RecordedCall = { method, url, headers: new Headers(init.headers), body: init.body, signal: init.signal };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    return handler ? handler(call) : json({ error: "Not Found" }, 404);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
```

`web/src/test/fixtures/assessment-good.json`:用 Task 0.1 Step 3 的同一条命令生成,输出路径改为 `../web/src/test/fixtures/assessment-good.json`。

- [ ] **Step 5: 写测试**

`web/src/styles/theme.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const enjoyCss = read("../../../enjoy/src/index.css");
const webCss = read("./theme.css");

function tokens(css: string, selector: ":root" | ".dark"): Record<string, string> {
  const pattern = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const block = css.match(pattern)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("theme tokens", () => {
  it.each([":root", ".dark"] as const)("%s matches enjoy/src/index.css", (selector) => {
    const expected = tokens(enjoyCss, selector);
    expect(Object.keys(expected).length).toBeGreaterThan(15);
    expect(tokens(webCss, selector)).toEqual(expected);
  });
});
```

`web/src/shims/shims.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import * as ui from "@renderer/components/ui";
import { PronunciationAssessmentScoreResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-score-result";
import { PronunciationAssessmentFulltextResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-fulltext-result";
import raw from "~/test/fixtures/assessment-good.json";

const sample = camelcaseKeys(raw, { deep: true }) as any;

describe("enjoy component reuse", () => {
  it("ui shim exposes only the selected components", () => {
    expect(ui.Button).toBeDefined();
    expect(ui.Sheet).toBeDefined();
    expect((ui as Record<string, unknown>).Command).toBeUndefined();
  });

  it("renders the desktop score view", () => {
    render(
      <PronunciationAssessmentScoreResult
        pronunciationScore={sample.pronunciationScore}
        accuracyScore={sample.accuracyScore}
        fluencyScore={sample.fluencyScore}
        completenessScore={sample.completenessScore}
      />,
    );
    expect(screen.getAllByText(String(sample.pronunciationScore)).length).toBeGreaterThan(0);
  });

  it("renders word-level results through the components shim", () => {
    render(<PronunciationAssessmentFulltextResult words={sample.detailResult.words} />);
    expect(screen.getAllByText(/coffee/i).length).toBeGreaterThan(0);
  });
});
```

`web/src/i18n/i18n.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n, { deepMerge, webMessages } from "./index";

describe("i18n", () => {
  it("merges web keys for en and zh-CN", () => {
    expect(i18n.getFixedT("en")("web.appName")).toBe("Enjoy English Practice");
    expect(i18n.getFixedT("zh-CN")("web.appName")).toBe("Enjoy 英语练习");
  });
  it("keeps the desktop language packs", () => {
    expect(i18n.getFixedT("zh-CN")("pronunciationAssessment")).toBe("发音评估");
  });
  it("falls back to English for web keys in es", () => {
    expect(i18n.getFixedT("es")("web.nav.chat")).toBe("Chat");
  });
  it("collects web messages from i18n folders", () => {
    expect((webMessages("zh-CN").web as any).nav.practice).toBe("练习");
  });
  it("deepMerge merges nested objects without mutating inputs", () => {
    const a = { web: { a: 1, nested: { x: 1 } } };
    expect(deepMerge(a, { web: { nested: { y: 2 } } })).toEqual({ web: { a: 1, nested: { x: 1, y: 2 } } });
    expect(a).toEqual({ web: { a: 1, nested: { x: 1 } } });
  });
});
```

- [ ] **Step 6: 运行,先确认失败再修到通过**

Run(依次):`yarn workspace web test`、`yarn workspace web typecheck`、`yarn workspace web build`、`grep -rl "__ENJOY_APP__" web/dist || echo CLEAN`
Expected:测试在写好 theme.css 之前 FAIL(变量不一致),补全后全部 PASS;typecheck 0 错误;build 成功;输出 `CLEAN`。

- [ ] **Step 7: `web/README.md` 初稿**(开发、别名约定;Task 6.3 定稿):

```markdown
# Enjoy 手机网页版

手机优先的 PWA,练习子集(登录、跟读评测、AI 对话、查词翻译)。与自建后端同源部署,见 `server/README.md`。

## 开发

    cd server && uv run uvicorn app.main:create_app --factory --port 8000   # 另一个终端
    yarn web:dev                                                           # http://localhost:5173,/api 代理到 8000

## 别名约定

- `~/…` → `web/src/…`(web 自己的代码)
- `@/…`、`@renderer/…` → `enjoy/src/…`(只读复用桌面端源码;不复制、不修改)
- `@renderer/components`、`@renderer/components/ui` 两个 barrel 被替换为 `src/shims/` 下的精简版;web 代码一律从子路径引入。
- `enjoy/src` 引入的第三方包必须写进 `web/package.json`,否则构建报 `guard-enjoy-deps` 错误。

## 检查

    yarn web:typecheck && yarn web:test && yarn web:build
```

- [ ] **Step 8: 提交**

```bash
git add package.json yarn.lock .gitignore web/
git commit -m "feat(web): scaffold the mobile web workspace reusing enjoy's UI through aliases" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.2:安全存储与 API 客户端

**Files:**
- Create: `web/src/lib/storage.ts`, `web/src/api/{auth-storage.ts,client.ts,types.ts}`
- Test: `web/src/lib/storage.test.ts`, `web/src/api/auth-storage.test.ts`, `web/src/api/client.test.ts`

**Interfaces:**
- Consumes:`~/test/fetch-mock`(Task 2.1)。
- Produces:
  - `~/lib/storage`:`readJson<T>(key: string, guard: (v: unknown) => v is T): T | null`、`writeJson(key: string, value: unknown): boolean`、`removeKey(key: string): void`(全部 try/catch,失败不抛)。
  - `~/api/auth-storage`:`interface StoredAuth { token: string; user: { id: string; name: string } }`、`loadAuth(): StoredAuth | null`、`saveAuth(a: StoredAuth): void`、`clearAuth(): void`(键 `enjoy-web.auth`;localStorage 不可用时退回内存)。
  - `~/api/types`:`AuthUser { id; name; createdAt; accessToken }`、`UserProfile { id; name; createdAt }`、`Paged<K extends string, T> = { page: number; next: number | null } & Record<K, T[]>`。
  - `~/api/client`:`class ApiError extends Error { status: number }`;`interface RequestOptions { json?: unknown; form?: FormData; query?: Record<string, string | number | undefined>; auth?: boolean; as?: "json" | "blob" | "raw"; timeoutMs?: number; signal?: AbortSignal }`;`class ApiClient(options: { getToken(): string | null; onUnauthorized?(): void; fetchImpl?: typeof fetch; baseUrl?: string })`,方法 `request<T>(method, path, opts?)`、`login(username, password): Promise<AuthUser>`、`register(username, password, inviteCode?): Promise<AuthUser>`、`me(): Promise<UserProfile>`、`getConfig<T>(key): Promise<T>`。约定:JSON 请求体深度 `decamelize-keys`;JSON 响应深度 `camelcase-keys`;FormData 不设 `Content-Type`;`as: "raw"` 返回 `Response` 且不加超时(流式);默认超时 60 s;非 2xx 抛 `ApiError(status, body.error ?? "HTTP <status>")`;网络失败 `ApiError(0, "Network error")`;超时 `ApiError(0, "Request timed out")`;带 token 的请求遇 401 调 `onUnauthorized`。

- [ ] **Step 1: 加依赖**:`yarn workspace web add decamelize-keys@^2.0.1`

- [ ] **Step 2: 写失败测试**

`web/src/lib/storage.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { readJson, removeKey, writeJson } from "./storage";

const isNum = (v: unknown): v is { n: number } => typeof (v as { n?: unknown })?.n === "number";

describe("storage", () => {
  afterEach(() => localStorage.clear());
  it("round-trips JSON", () => {
    expect(writeJson("k", { n: 1 })).toBe(true);
    expect(readJson("k", isNum)).toEqual({ n: 1 });
    removeKey("k");
    expect(readJson("k", isNum)).toBeNull();
  });
  it("returns null for corrupt or wrongly shaped values", () => {
    localStorage.setItem("k", "{not json");
    expect(readJson("k", isNum)).toBeNull();
    localStorage.setItem("k", JSON.stringify({ n: "x" }));
    expect(readJson("k", isNum)).toBeNull();
  });
  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    expect(writeJson("k", { n: 1 })).toBe(false);
    expect(readJson("k", isNum)).toBeNull();
    expect(() => removeKey("k")).not.toThrow();
  });
});
```

`web/src/api/auth-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, loadAuth, saveAuth } from "./auth-storage";

const AUTH = { token: "tok", user: { id: "12345678", name: "alice" } };

describe("auth storage", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });
  it("persists to localStorage under enjoy-web.auth", () => {
    saveAuth(AUTH);
    expect(JSON.parse(localStorage.getItem("enjoy-web.auth")!)).toEqual(AUTH);
    expect(loadAuth()).toEqual(AUTH);
  });
  it("ignores invalid stored values", () => {
    localStorage.setItem("enjoy-web.auth", JSON.stringify({ token: "", user: {} }));
    expect(loadAuth()).toBeNull();
  });
  it("falls back to memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("private mode"); });
    saveAuth(AUTH);
    expect(loadAuth()).toEqual(AUTH);
  });
  it("clear removes both copies", () => {
    saveAuth(AUTH);
    clearAuth();
    expect(loadAuth()).toBeNull();
    expect(localStorage.getItem("enjoy-web.auth")).toBeNull();
  });
});
```

`web/src/api/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ApiClient, ApiError } from "./client";

const make = (routes: Parameters<typeof createFetchMock>[0], extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) => {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "tok", fetchImpl: mock.fetch, ...extra });
  return { api, mock };
};

describe("ApiClient", () => {
  it("sends bearer token, snake_case JSON and returns camelCase", async () => {
    const { api, mock } = make({ "POST /api/conversations": () => json({ id: "c1", created_at: "t", config: { tts_voice: "alloy" } }) });
    const res = await api.request<any>("POST", "/api/conversations", { json: { name: "n", config: { ttsVoice: "alloy" } } });
    expect(res).toEqual({ id: "c1", createdAt: "t", config: { ttsVoice: "alloy" } });
    const call = mock.calls[0];
    expect(call.headers.get("Authorization")).toBe("Bearer tok");
    expect(call.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call.body as string)).toEqual({ name: "n", config: { tts_voice: "alloy" } });
  });

  it("omits Authorization for auth:false and when there is no token", async () => {
    const { api, mock } = make({ "GET /api/config/x": () => json({}) });
    await api.request("GET", "/api/config/x", { auth: false });
    expect(mock.calls[0].headers.has("Authorization")).toBe(false);
    const anon = make({ "GET /api/me": () => json({}) }, { getToken: () => null });
    await anon.api.request("GET", "/api/me");
    expect(anon.mock.calls[0].headers.has("Authorization")).toBe(false);
  });

  it("builds the query string and skips undefined values", async () => {
    const { api, mock } = make({ "GET /api/assessments": () => json({ assessments: [] }) });
    await api.request("GET", "/api/assessments", { query: { page: 2, per_page: 20, q: undefined } });
    expect(mock.calls[0].url.search).toBe("?page=2&per_page=20");
  });

  it("sends FormData untouched and lets the browser set the boundary", async () => {
    const { api, mock } = make({ "POST /api/upload": () => json({}) });
    const form = new FormData();
    form.append("reference", "Hello");
    await api.request("POST", "/api/upload", { form });
    expect(mock.calls[0].body).toBe(form);
    expect(mock.calls[0].headers.has("Content-Type")).toBe(false);
  });

  it("throws ApiError carrying the server message", async () => {
    const { api } = make({ "POST /api/sessions": () => json({ error: "Invalid username or password" }, 401) });
    await expect(api.request("POST", "/api/sessions", { json: {}, auth: false })).rejects.toMatchObject({
      name: "ApiError", status: 401, message: "Invalid username or password",
    });
  });

  it("uses HTTP status when the error body is not JSON", async () => {
    const { api } = make({ "GET /x": () => new Response("<html>", { status: 502 }) });
    await expect(api.request("GET", "/x")).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
  });

  it("calls onUnauthorized for authenticated 401 only", async () => {
    const onUnauthorized = vi.fn();
    const { api } = make(
      { "GET /api/me": () => json({ error: "Unauthorized" }, 401), "POST /api/sessions": () => json({ error: "Invalid username or password" }, 401) },
      { onUnauthorized },
    );
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(api.login("a", "b")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("maps network failures and timeouts", async () => {
    const failing = new ApiClient({ getToken: () => null, fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    await expect(failing.request("GET", "/x")).rejects.toMatchObject({ status: 0, message: "Network error" });
    const { api } = make({
      "GET /slow": (call) => new Promise((_, reject) => call.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    await expect(api.request("GET", "/slow", { timeoutMs: 20 })).rejects.toMatchObject({ status: 0, message: "Request timed out" });
  });

  it("returns blobs and raw responses", async () => {
    const { api } = make({
      "GET /audio": () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/wav" } }),
      "POST /stream": () => new Response("data: x\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    });
    const blob = await api.request<Blob>("GET", "/audio", { as: "blob" });
    expect(blob.size).toBe(3);
    const raw = await api.request<Response>("POST", "/stream", { as: "raw", json: {} });
    expect(await raw.text()).toBe("data: x\n\n");
  });

  it("auth helpers hit the documented endpoints", async () => {
    const user = { id: "12345678", name: "alice", created_at: "t", access_token: "new" };
    const { api, mock } = make({
      "POST /api/sessions": () => json(user),
      "POST /api/users": () => json(user),
      "GET /api/me": () => json({ id: "12345678", name: "alice", created_at: "t" }),
      "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"] } }),
    });
    expect(await api.login("alice", "pw")).toEqual({ id: "12345678", name: "alice", createdAt: "t", accessToken: "new" });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ provider: "password", username: "alice", password: "pw" });
    await api.register("bob", "password1", "inv");
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ username: "bob", password: "password1", invite_code: "inv" });
    await api.register("carol", "password1");
    expect(JSON.parse(mock.calls[2].body as string)).toEqual({ username: "carol", password: "password1" });
    expect((await api.me()).name).toBe("alice");
    expect(await api.getConfig("tts_providers_v2")).toEqual({ enjoyai: { models: ["openai/tts-1"] } });
    expect(mock.calls[4].headers.has("Authorization")).toBe(false);
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/lib src/api` → FAIL(模块不存在)。

- [ ] **Step 4: 实现**

`web/src/lib/storage.ts`:

```ts
/** localStorage 的安全读写:隐私模式、配额满、禁用存储时都不抛错。 */
export function readJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 存储不可用时无需处理 */
  }
}
```

`web/src/api/auth-storage.ts`:

```ts
import { readJson, removeKey, writeJson } from "~/lib/storage";

export interface StoredAuth {
  token: string;
  user: { id: string; name: string };
}

const KEY = "enjoy-web.auth";
let memory: StoredAuth | null = null;

function isStoredAuth(value: unknown): value is StoredAuth {
  const a = value as StoredAuth;
  return (
    !!a && typeof a.token === "string" && a.token.length > 0 &&
    !!a.user && typeof a.user.id === "string" && typeof a.user.name === "string"
  );
}

export function loadAuth(): StoredAuth | null {
  return readJson(KEY, isStoredAuth) ?? memory;
}

export function saveAuth(auth: StoredAuth): void {
  memory = auth;
  writeJson(KEY, auth);
}

export function clearAuth(): void {
  memory = null;
  removeKey(KEY);
}
```

`web/src/api/types.ts`:

```ts
export interface AuthUser {
  id: string;
  name: string;
  createdAt: string;
  accessToken: string;
}

export interface UserProfile {
  id: string;
  name: string;
  createdAt: string;
}

export type Paged<K extends string, T> = { page: number; next: number | null } & Record<K, T[]>;
```

`web/src/api/client.ts`:

```ts
import camelcaseKeys from "camelcase-keys";
import decamelizeKeys from "decamelize-keys";
import type { AuthUser, UserProfile } from "./types";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
  as?: "json" | "blob" | "raw";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  getToken: () => string | null;
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function queryString(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.append(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

function withTimeout(ms: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  outer?.addEventListener("abort", abort, { once: true });
  const timer = ms > 0 ? setTimeout(abort, ms) : undefined;
  return {
    signal: controller.signal,
    done: () => {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", abort);
    },
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* 非 JSON 错误体 */
  }
  return `HTTP ${response.status}`;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { json, form, query, auth = true, as = "json", timeoutMs = DEFAULT_TIMEOUT_MS, signal } = opts;
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = auth ? this.options.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(decamelizeKeys(json as Record<string, unknown>, { deep: true }));
    } else if (form) {
      body = form; // 不设 Content-Type:由浏览器带上 multipart boundary
    }
    const url = `${this.options.baseUrl ?? ""}${path}${queryString(query)}`;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    // 流式响应不设超时,直接使用调用方的 signal。
    const timing = as === "raw" ? { signal, done: () => {} } : withTimeout(timeoutMs, signal);
    let response: Response;
    try {
      response = await fetchImpl(url, { method, headers, body, signal: timing.signal });
    } catch (err) {
      timing.done();
      const aborted = (err as Error)?.name === "AbortError";
      throw new ApiError(0, aborted ? (signal?.aborted ? "Request aborted" : "Request timed out") : "Network error");
    }
    try {
      if (response.status === 401 && token) this.options.onUnauthorized?.();
      if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
      if (as === "raw") return response as unknown as T;
      if (as === "blob") return (await response.blob()) as unknown as T;
      const text = await response.text();
      return (text ? camelcaseKeys(JSON.parse(text), { deep: true }) : {}) as T;
    } finally {
      timing.done();
    }
  }

  login(username: string, password: string): Promise<AuthUser> {
    return this.request("POST", "/api/sessions", { json: { provider: "password", username, password }, auth: false });
  }

  register(username: string, password: string, inviteCode?: string): Promise<AuthUser> {
    return this.request("POST", "/api/users", {
      json: { username, password, ...(inviteCode ? { inviteCode } : {}) },
      auth: false,
    });
  }

  me(): Promise<UserProfile> {
    return this.request("GET", "/api/me");
  }

  getConfig<T>(key: string): Promise<T> {
    return this.request("GET", `/api/config/${encodeURIComponent(key)}`, { auth: false });
  }
}
```

- [ ] **Step 5: 运行**:`yarn workspace web test src/lib src/api` → PASS;`yarn workspace web typecheck` → 0 错误。

- [ ] **Step 6: 提交**

```bash
git add web/package.json yarn.lock web/src/lib web/src/api
git commit -m "feat(web): add safe storage and the same-origin API client" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.3:AI 调用(流式/非流式)与服务端 AI 配置

**Files:**
- Create: `web/src/api/{ai.ts,server-config.ts}`
- Test: `web/src/api/ai.test.ts`, `web/src/api/server-config.test.ts`

**Interfaces:**
- Consumes:`ApiClient`、`ApiError`(Task 2.2)。
- Produces:
  - `~/api/ai`:`interface ChatMessageInput { role: "system" | "user" | "assistant"; content: string }`;`interface ChatRequest { messages: ChatMessageInput[]; model?: string; temperature?: number }`;`createSseParser(onData: (data: string) => void): { push(chunk: string): void; flush(): void }`;`type SseEvent = { kind: "delta"; text: string } | { kind: "done" } | { kind: "error"; message: string } | { kind: "ignore" }`;`parseSseData(data: string): SseEvent`;`streamChatCompletion(api, req, onDelta: (full: string, piece: string) => void, signal?): Promise<string>`;`completeChat(api, req & { jsonMode?: boolean }, signal?): Promise<string>`。请求体:`{ messages, stream, model?(非空才带), temperature?, response_format?: { type: "json_object" } }`。服务端中继出错时会在流里写 `data: {"error": "Upstream unavailable"}`,`streamChatCompletion` 据此抛 `ApiError(502, message)`。
  - `~/api/server-config`:`interface VoiceOption { label: string; value: string; language?: string }`;`interface ServerAiConfig { llmModels: string[]; defaultLlmModel: string; ttsModels: string[]; voices: Record<string, VoiceOption[]>; defaultTts: { model: string; voice: string } }`;`normalizeVoices(raw)`;`voicesFor(config, ttsModel, languagePrefix = "en"): VoiceOption[]`;`loadServerAiConfig(api): Promise<ServerAiConfig>`(并发去重、成功后缓存、失败不缓存);`resetServerAiConfigCache(): void`(测试用)。数据来源:`/api/config/gpt_providers`(`enjoyai.models`)、`default_gpt_preset`(`configuration.model`)、`tts_providers_v2`(`enjoyai.models`、`enjoyai.voices`:`openai` 为字符串数组,`azure`/`volcengine` 为 `{label,value,language}` 数组)、`default_tts_preset`(`configuration.tts.{model,voice}`)。

- [ ] **Step 1: 写失败测试**

`web/src/api/ai.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ApiClient } from "./client";
import { completeChat, createSseParser, parseSseData, streamChatCompletion } from "./ai";

const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

function streamOf(parts: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("SSE parsing", () => {
  it("handles events split across chunks and CRLF", () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push(d));
    parser.push("data: {\"a\"");
    parser.push(":1}\r\n\r\ndata: [DO");
    parser.push("NE]\n\n: comment\n\n");
    parser.flush();
    expect(seen).toEqual(['{"a":1}', "[DONE]"]);
  });
  it("classifies payloads", () => {
    expect(parseSseData("[DONE]")).toEqual({ kind: "done" });
    expect(parseSseData('{"error": "Upstream unavailable"}')).toEqual({ kind: "error", message: "Upstream unavailable" });
    expect(parseSseData('{"error": {"message": "bad"}}')).toEqual({ kind: "error", message: "bad" });
    expect(parseSseData(JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }))).toEqual({ kind: "delta", text: "Hi" });
    expect(parseSseData(JSON.stringify({ choices: [{ delta: { role: "assistant" } }] }))).toEqual({ kind: "ignore" });
    expect(parseSseData("not json")).toEqual({ kind: "ignore" });
  });
});

describe("streamChatCompletion", () => {
  it("accumulates deltas and posts a stream request", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => streamOf([chunk("Hel"), chunk("lo"), "data: [DONE]\n\n"]) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const onDelta = vi.fn();
    const text = await streamChatCompletion(api, { messages: [{ role: "user", content: "hi" }], model: "", temperature: 0.7 }, onDelta);
    expect(text).toBe("Hello");
    expect(onDelta).toHaveBeenLastCalledWith("Hello", "lo");
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ messages: [{ role: "user", content: "hi" }], temperature: 0.7, stream: true });
  });
  it("throws when the relay reports an error", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => streamOf([chunk("Hi"), 'data: {"error": "Upstream unavailable"}\n\n']) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(streamChatCompletion(api, { messages: [] }, () => {})).rejects.toMatchObject({ status: 502, message: "Upstream unavailable" });
  });
  it("surfaces HTTP errors before streaming", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ error: "LLM upstream is not configured" }, 503) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(streamChatCompletion(api, { messages: [] }, () => {})).rejects.toMatchObject({ status: 503 });
  });
});

describe("completeChat", () => {
  it("requests JSON mode and returns the message content", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"x"}' } }] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const out = await completeChat(api, { messages: [{ role: "system", content: "s" }], temperature: 0, model: "gpt-4o", jsonMode: true });
    expect(out).toBe('{"word":"x"}');
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({
      messages: [{ role: "system", content: "s" }], model: "gpt-4o", temperature: 0, stream: false, response_format: { type: "json_object" },
    });
  });
  it("rejects empty responses", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(completeChat(api, { messages: [] })).rejects.toMatchObject({ status: 502, message: "Empty AI response" });
  });
});
```

`web/src/api/server-config.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ApiClient } from "./client";
import { loadServerAiConfig, normalizeVoices, resetServerAiConfigCache, voicesFor } from "./server-config";

const ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o-mini", "gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({
    enjoyai: {
      models: ["openai/tts-1", "azure/speech"],
      voices: {
        openai: ["alloy", "echo"],
        azure: [
          { label: "Ava (Female)", value: "en-US-AvaNeural", language: "en-US" },
          { label: "Katja (Female)", value: "de-DE-KatjaNeural", language: "de-DE" },
        ],
      },
    },
  }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

describe("server AI config", () => {
  beforeEach(() => resetServerAiConfigCache());

  it("maps the four config snapshots", async () => {
    const mock = createFetchMock(ROUTES);
    const config = await loadServerAiConfig(new ApiClient({ getToken: () => null, fetchImpl: mock.fetch }));
    expect(config).toEqual({
      llmModels: ["gpt-4o-mini", "gpt-4o"],
      defaultLlmModel: "gpt-4o",
      ttsModels: ["openai/tts-1", "azure/speech"],
      voices: {
        openai: [{ label: "alloy", value: "alloy" }, { label: "echo", value: "echo" }],
        azure: [
          { label: "Ava (Female)", value: "en-US-AvaNeural", language: "en-US" },
          { label: "Katja (Female)", value: "de-DE-KatjaNeural", language: "de-DE" },
        ],
      },
      defaultTts: { model: "openai/tts-1", voice: "alloy" },
    });
  });

  it("deduplicates and caches, but retries after a failure", async () => {
    let fail = true;
    const mock = createFetchMock({ ...ROUTES, "GET /api/config/gpt_providers": () => (fail ? json({ error: "x" }, 500) : json({ enjoyai: { models: [] } })) });
    const api = new ApiClient({ getToken: () => null, fetchImpl: mock.fetch });
    await expect(loadServerAiConfig(api)).rejects.toBeTruthy();
    fail = false;
    const [a, b] = await Promise.all([loadServerAiConfig(api), loadServerAiConfig(api)]);
    expect(a).toBe(b);
    const before = mock.calls.length;
    await loadServerAiConfig(api);
    expect(mock.calls.length).toBe(before);
  });

  it("filters voices by provider and language, falling back to all", () => {
    const config = {
      llmModels: [], defaultLlmModel: "", ttsModels: [], defaultTts: { model: "", voice: "" },
      voices: normalizeVoices({ azure: [{ label: "K", value: "de-DE-K", language: "de-DE" }, { label: "A", value: "en-US-A", language: "en-US" }], openai: ["alloy"] }),
    };
    expect(voicesFor(config, "azure/speech").map((v) => v.value)).toEqual(["en-US-A"]);
    expect(voicesFor(config, "openai/tts-1").map((v) => v.value)).toEqual(["alloy"]);
    expect(voicesFor(config, "azure/speech", "fr").map((v) => v.value)).toEqual(["de-DE-K", "en-US-A"]);
    expect(voicesFor(config, "volcengine/seed-tts-2.0")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行,确认失败**:`yarn workspace web test src/api/ai src/api/server-config` → FAIL。

- [ ] **Step 3: 实现**

`web/src/api/ai.ts`:

```ts
import { ApiClient, ApiError } from "./client";

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessageInput[];
  model?: string;
  temperature?: number;
}

export type SseEvent =
  | { kind: "delta"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

const EVENT_BOUNDARY = /\r?\n\r?\n/;

export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  const emit = (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) onData(data);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = EVENT_BOUNDARY.exec(buffer))) {
        emit(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    flush() {
      if (buffer.trim()) emit(buffer);
      buffer = "";
    },
  };
}

export function parseSseData(data: string): SseEvent {
  if (data.trim() === "[DONE]") return { kind: "done" };
  let payload: any;
  try {
    payload = JSON.parse(data);
  } catch {
    return { kind: "ignore" };
  }
  if (typeof payload?.error === "string") return { kind: "error", message: payload.error };
  if (typeof payload?.error?.message === "string") return { kind: "error", message: payload.error.message };
  const text = payload?.choices?.[0]?.delta?.content;
  return typeof text === "string" && text ? { kind: "delta", text } : { kind: "ignore" };
}

function chatBody(req: ChatRequest) {
  return {
    messages: req.messages,
    ...(req.model ? { model: req.model } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
}

export async function streamChatCompletion(
  api: ApiClient,
  req: ChatRequest,
  onDelta: (full: string, piece: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const response = await api.request<Response>("POST", "/api/ai/chat/completions", {
    json: { ...chatBody(req), stream: true },
    as: "raw",
    signal,
  });
  const state = { full: "", failure: null as string | null, done: false };
  const parser = createSseParser((data) => {
    if (state.done || state.failure) return;
    const event = parseSseData(data);
    if (event.kind === "delta") {
      state.full += event.text;
      onDelta(state.full, event.text);
    } else if (event.kind === "done") {
      state.done = true;
    } else if (event.kind === "error") {
      state.failure = event.message;
    }
  });
  if (!response.body) {
    parser.push(await response.text());
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (state.done || state.failure) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    parser.push(decoder.decode());
  }
  parser.flush();
  if (state.failure) throw new ApiError(502, state.failure);
  return state.full;
}

export async function completeChat(
  api: ApiClient,
  req: ChatRequest & { jsonMode?: boolean },
  signal?: AbortSignal,
): Promise<string> {
  const response = await api.request<{ choices?: Array<{ message?: { content?: string } }> }>(
    "POST",
    "/api/ai/chat/completions",
    {
      json: { ...chatBody(req), stream: false, ...(req.jsonMode ? { responseFormat: { type: "json_object" } } : {}) },
      signal,
    },
  );
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new ApiError(502, "Empty AI response");
  return content;
}
```

`web/src/api/server-config.ts`:

```ts
import type { ApiClient } from "./client";

export interface VoiceOption {
  label: string;
  value: string;
  language?: string;
}

export interface ServerAiConfig {
  llmModels: string[];
  defaultLlmModel: string;
  ttsModels: string[];
  voices: Record<string, VoiceOption[]>;
  defaultTts: { model: string; voice: string };
}

type RawVoice = string | { label?: string; value?: string; language?: string } | null;

export function normalizeVoices(raw: Record<string, RawVoice[]> | undefined): Record<string, VoiceOption[]> {
  const out: Record<string, VoiceOption[]> = {};
  for (const [provider, list] of Object.entries(raw ?? {})) {
    out[provider] = (Array.isArray(list) ? list : []).flatMap((voice): VoiceOption[] => {
      if (typeof voice === "string") return [{ label: voice, value: voice }];
      if (voice && typeof voice.value === "string") {
        return [{ label: voice.label ?? voice.value, value: voice.value, ...(voice.language ? { language: voice.language } : {}) }];
      }
      return [];
    });
  }
  return out;
}

export function voicesFor(config: ServerAiConfig, ttsModel: string, languagePrefix = "en"): VoiceOption[] {
  const list = config.voices[ttsModel.split("/")[0]] ?? [];
  const matching = list.filter((v) => !v.language || v.language.toLowerCase().startsWith(languagePrefix.toLowerCase()));
  return matching.length ? matching : list;
}

let cached: Promise<ServerAiConfig> | null = null;

export function resetServerAiConfigCache(): void {
  cached = null;
}

export function loadServerAiConfig(api: ApiClient): Promise<ServerAiConfig> {
  if (!cached) {
    cached = Promise.all([
      api.getConfig<any>("gpt_providers"),
      api.getConfig<any>("default_gpt_preset"),
      api.getConfig<any>("tts_providers_v2"),
      api.getConfig<any>("default_tts_preset"),
    ])
      .then(([gpt, gptPreset, tts, ttsPreset]): ServerAiConfig => {
        const ttsModels: string[] = tts?.enjoyai?.models ?? [];
        return {
          llmModels: gpt?.enjoyai?.models ?? [],
          defaultLlmModel: gptPreset?.configuration?.model ?? "",
          ttsModels,
          voices: normalizeVoices(tts?.enjoyai?.voices),
          defaultTts: {
            model: ttsPreset?.configuration?.tts?.model ?? ttsModels[0] ?? "",
            voice: ttsPreset?.configuration?.tts?.voice ?? "",
          },
        };
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
```

- [ ] **Step 4: 运行**:同 Step 2 → PASS;`yarn workspace web typecheck` → 0 错误。

- [ ] **Step 5: 提交**

```bash
git add web/src/api/ai.ts web/src/api/ai.test.ts web/src/api/server-config.ts web/src/api/server-config.test.ts
git commit -m "feat(web): add streaming chat helpers and server AI config loader" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.4:登录 / 注册与鉴权

**Files:**
- Create: `web/src/auth/{auth-context.tsx,require-auth.tsx,validation.ts}`, `web/src/api/error-messages.ts`, `web/src/pages/login-page.tsx`, `web/src/test/render.tsx`
- Test: `web/src/auth/validation.test.ts`, `web/src/pages/login-page.test.tsx`, `web/src/auth/require-auth.test.tsx`

**Interfaces:**
- Consumes:`ApiClient`、`ApiError`、`loadAuth/saveAuth/clearAuth`(Task 2.2)。
- Produces:
  - `~/auth/auth-context`:`interface AuthContextValue { user: { id: string; name: string } | null; api: ApiClient; login(u, p): Promise<void>; register(u, p, invite?): Promise<void>; logout(): void }`;`AuthContext`;`AuthProvider({ children, fetchImpl? })`;`useAuth()`。
  - `~/auth/require-auth`:`RequireAuth`(无用户时 `<Navigate to="/login" state={{ from: pathname }} replace />`,否则 `<Outlet />`)。
  - `~/auth/validation`:`USERNAME_PATTERN`、`normalizeUsername(v)`、`validateCredentials(mode: "login" | "register", username, password): string | null`(返回 i18n 键)。
  - `~/api/error-messages`:`translateServerError(t, err, extra?: Record<string, string>): string`(服务端英文错误 → i18n 键;未知原样;非 ApiError → `web.errors.unknown`)。
  - `~/pages/login-page`:`LoginPage`;testid:`login-username`、`login-password`、`register-invite`、`login-submit`、`login-mode-toggle`、`login-error`。
  - `~/test/render`:`renderWithProviders(ui, { api?, user?, route?, path?, logout? })`,含 `MemoryRouter` 与 `LocationProbe`(testid `location`,内容为当前 pathname)。

- [ ] **Step 1: 加依赖**:`yarn workspace web add react-router-dom@^7.3.0 && yarn workspace web add -D @testing-library/user-event@^14.6.1`

- [ ] **Step 2: 写失败测试**

`web/src/auth/validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeUsername, validateCredentials } from "./validation";

describe("credential validation", () => {
  it("normalizes usernames like the server", () => {
    expect(normalizeUsername("  Alice_1 ")).toBe("alice_1");
  });
  it.each([
    ["login", "", "pw", "web.login.required"],
    ["login", "alice", "", "web.login.required"],
    ["login", "Al", "x", null],
    ["register", "ab", "password1", "web.login.usernameInvalid"],
    ["register", "bad-name", "password1", "web.login.usernameInvalid"],
    ["register", "alice", "short", "web.login.passwordLength"],
    ["register", "alice", "x".repeat(129), "web.login.passwordLength"],
    ["register", " Alice ", "password1", null],
  ] as const)("%s %s/%s → %s", (mode, username, password, expected) => {
    expect(validateCredentials(mode, username, password)).toBe(expected);
  });
});
```

`web/src/pages/login-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { LoginPage } from "./login-page";

const USER = { id: "12345678", name: "alice", created_at: "t", access_token: "tok" };

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/practice" element={<div>practice home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

describe("LoginPage", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });

  it("logs in, stores the token and goes to /practice", async () => {
    const mock = setup({ "POST /api/sessions": () => json(USER) });
    await userEvent.type(screen.getByTestId("login-username"), " Alice ");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("practice home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ provider: "password", username: "alice", password: "password123" });
    expect(JSON.parse(localStorage.getItem("enjoy-web.auth")!).token).toBe("tok");
  });

  it("shows a translated server error", async () => {
    setup({ "POST /api/sessions": () => json({ error: "Invalid username or password" }, 401) });
    await userEvent.type(screen.getByTestId("login-username"), "alice");
    await userEvent.type(screen.getByTestId("login-password"), "wrong");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Invalid username or password.");
  });

  it("validates before calling the server", async () => {
    const mock = setup({});
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(screen.getByTestId("login-error")).toHaveTextContent("Please enter username and password.");
    expect(mock.calls).toHaveLength(0);
  });

  it("registers with an optional invite code", async () => {
    const mock = setup({ "POST /api/users": () => json(USER) });
    await userEvent.click(screen.getByTestId("login-mode-toggle"));
    await userEvent.type(screen.getByTestId("login-username"), "ab");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(screen.getByTestId("login-error")).toHaveTextContent("Username: 3–32");
    expect(mock.calls).toHaveLength(0);
    await userEvent.type(screen.getByTestId("login-username"), "c");
    await userEvent.type(screen.getByTestId("register-invite"), "invite-1");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("practice home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ username: "abc", password: "password123", invite_code: "invite-1" });
  });

  it("inputs are at least 44px tall and use 16px text", () => {
    setup({});
    expect(screen.getByTestId("login-username").className).toMatch(/\bh-11\b/);
    expect(screen.getByTestId("login-username").className).toMatch(/\btext-base\b/);
  });
});
```

`web/src/auth/require-auth.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth, saveAuth } from "~/api/auth-storage";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AuthProvider, useAuth } from "./auth-context";
import { RequireAuth } from "./require-auth";

function CallsMe() {
  const { api } = useAuth();
  useEffect(() => { api.me().catch(() => undefined); }, [api]);
  return <div>protected</div>;
}

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route element={<RequireAuth />}>
            <Route path="/chat" element={<CallsMe />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });
  it("redirects anonymous users to /login", () => {
    setup({});
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
  it("renders protected routes for a stored session", () => {
    saveAuth({ token: "tok", user: { id: "1", name: "a" } });
    setup({ "GET /api/me": () => json({ id: "1", name: "a", created_at: "t" }) });
    expect(screen.getByText("protected")).toBeInTheDocument();
  });
  it("logs out and returns to /login on any 401", async () => {
    saveAuth({ token: "expired", user: { id: "1", name: "a" } });
    setup({ "GET /api/me": () => json({ error: "Unauthorized" }, 401) });
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(localStorage.getItem("enjoy-web.auth")).toBeNull();
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/auth src/pages` → FAIL。

- [ ] **Step 4: 实现**

`web/src/auth/validation.ts`:

```ts
export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** 返回 i18n 键;通过时返回 null。规则与服务端 sessions.py 一致。 */
export function validateCredentials(mode: "login" | "register", username: string, password: string): string | null {
  const name = normalizeUsername(username);
  if (!name || !password) return "web.login.required";
  if (mode === "register") {
    if (!USERNAME_PATTERN.test(name)) return "web.login.usernameInvalid";
    if (password.length < 8 || password.length > 128) return "web.login.passwordLength";
  }
  return null;
}
```

`web/src/api/error-messages.ts`:

```ts
import type { TFunction } from "i18next";
import { ApiError } from "./client";

const COMMON: Record<string, string> = {
  "Invalid username or password": "web.errors.invalidLogin",
  "Username already taken": "web.errors.usernameTaken",
  "Registration is closed": "web.errors.registrationClosed",
  "Invalid invite code": "web.errors.invalidInvite",
  "Too many requests, please try again later": "web.errors.tooManyRequests",
  "Network error": "web.errors.network",
  "Request timed out": "web.errors.timeout",
};

export function translateServerError(t: TFunction, err: unknown, extra: Record<string, string> = {}): string {
  if (err instanceof ApiError) {
    const key = extra[err.message] ?? COMMON[err.message];
    return key ? t(key) : err.message;
  }
  return t("web.errors.unknown");
}
```

`web/src/auth/auth-context.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { clearAuth, loadAuth, saveAuth, type StoredAuth } from "~/api/auth-storage";
import { ApiClient } from "~/api/client";
import type { AuthUser } from "~/api/types";
import { normalizeUsername } from "./validation";

export interface AuthContextValue {
  user: StoredAuth["user"] | null;
  api: ApiClient;
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string, inviteCode?: string): Promise<void>;
  logout(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadAuth());
  const tokenRef = useRef<string | null>(auth?.token ?? null);
  tokenRef.current = auth?.token ?? null;

  const logout = useCallback(() => {
    clearAuth();
    tokenRef.current = null;
    setAuth(null);
  }, []);

  const api = useMemo(
    () => new ApiClient({ getToken: () => tokenRef.current, onUnauthorized: logout, fetchImpl }),
    [logout, fetchImpl],
  );

  const accept = useCallback((user: AuthUser) => {
    const next: StoredAuth = { token: user.accessToken, user: { id: user.id, name: user.name } };
    saveAuth(next);
    tokenRef.current = next.token;
    setAuth(next);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => accept(await api.login(normalizeUsername(username), password)),
    [api, accept],
  );
  const register = useCallback(
    async (username: string, password: string, inviteCode?: string) =>
      accept(await api.register(normalizeUsername(username), password, inviteCode)),
    [api, accept],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user: auth?.user ?? null, api, login, register, logout }),
    [auth, api, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
```

`web/src/auth/require-auth.tsx`:

```tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";

export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
```

`web/src/pages/login-page.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { validateCredentials } from "~/auth/validation";

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/practice";

  if (user) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateCredentials(mode, username, password);
    if (problem) {
      setError(t(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password, inviteCode.trim() || undefined);
      navigate(from, { replace: true });
    } catch (err) {
      setError(translateServerError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <h1 className="mb-8 text-center text-2xl font-semibold">{t("web.appName")}</h1>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="username">{t("web.login.username")}</Label>
          <Input id="username" data-testid="login-username" autoComplete="username" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} className="h-11 text-base" value={username}
            onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("web.login.password")}</Label>
          <Input id="password" data-testid="login-password" type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="h-11 text-base" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {mode === "register" && (
          <div className="space-y-2">
            <Label htmlFor="invite">{t("web.login.inviteCode")}</Label>
            <Input id="invite" data-testid="register-invite" autoCapitalize="none" className="h-11 text-base"
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("web.login.inviteHint")}</p>
          </div>
        )}
        {error && (
          <p role="alert" data-testid="login-error" className="text-sm text-destructive">{error}</p>
        )}
        <Button type="submit" data-testid="login-submit" className="h-11 w-full" disabled={busy}>
          {mode === "login" ? t("web.login.submit") : t("web.login.registerSubmit")}
        </Button>
      </form>
      <Button type="button" variant="link" data-testid="login-mode-toggle" className="mt-4 min-h-11"
        onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
        {mode === "login" ? t("web.login.switchToRegister") : t("web.login.switchToLogin")}
      </Button>
    </div>
  );
}
```

`web/src/test/render.tsx`(Task 2.5 会在其中加 `SettingsProvider`):

```tsx
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { ApiClient } from "~/api/client";
import { AuthContext, type AuthContextValue } from "~/auth/auth-context";

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

export interface RenderOptions {
  api?: ApiClient;
  user?: AuthContextValue["user"];
  route?: string;
  path?: string;
  logout?: () => void;
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const {
    api = new ApiClient({ getToken: () => "test-token" }),
    user = { id: "12345678", name: "alice" },
    route = "/",
    path = "*",
    logout = vi.fn(),
  } = options;
  const value: AuthContextValue = { user, api, login: vi.fn(), register: vi.fn(), logout };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}
```

- [ ] **Step 5: 运行**:同 Step 3 → PASS;`yarn workspace web typecheck` → 0 错误。

- [ ] **Step 6: 提交**

```bash
git add web/package.json yarn.lock web/src/auth web/src/api/error-messages.ts web/src/pages web/src/test/render.tsx
git commit -m "feat(web): add password login, registration and auth guard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.5:移动布局、底部导航、路由与「我的」

**Files:**
- Create: `web/src/settings/settings-context.tsx`, `web/src/layout/{app-shell.tsx,bottom-nav.tsx,page-header.tsx,use-app-height.ts,color-scheme.ts}`, `web/src/pages/me-page.tsx`, `web/src/features/practice/{practice-page.tsx,history-page.tsx,assessment-page.tsx}`(占位), `web/src/features/chat/{conversations-page.tsx,conversation-page.tsx}`(占位), `web/src/features/lookup/lookup-layer.tsx`(占位), `web/src/pwa/ios.ts`, `web/src/pages/install-page.tsx`
- Modify: `web/src/app.tsx`, `web/src/main.tsx`, `web/src/test/render.tsx`
- Test: `web/src/settings/settings-context.test.tsx`, `web/src/layout/layout.test.tsx`, `web/src/pages/me-page.test.tsx`, `web/src/pwa/ios.test.ts`

**Interfaces:**
- Consumes:`useAuth`、`RequireAuth`、`LoginPage`(Task 2.4);`loadServerAiConfig`(Task 2.3);`SUPPORTED_LANGUAGES`、`UiLanguage`(Task 2.1);`readJson/writeJson`(Task 2.2)。
- Produces:
  - `~/settings/settings-context`:`SettingsProvider`、`useSettings(): { language: UiLanguage; setLanguage(l: UiLanguage): void }`(键 `enjoy-web.settings`)、`detectLanguage(navLang?: string): UiLanguage`、`nativeLanguageCode(l: UiLanguage): "en-US" | "zh-CN" | "es-ES"`。
  - `~/layout/page-header`:`PageHeader({ title, back?, actions? })`;`~/layout/app-shell`:`AppShell`(高度 `var(--app-height, 100dvh)`;挂载 `BottomNav` 与 `LookupLayer`);`~/layout/use-app-height`:`useAppHeight(win = window)`(把 `visualViewport.height` 写入 `--app-height`);`~/layout/color-scheme`:`initColorScheme(win = window): () => void`。
  - 路由表(`~/app`):`/login`、`/install`、受保护的 `/practice`、`/practice/history`、`/practice/assessments/:id`、`/chat`、`/chat/:id`、`/me`;其他 → `/practice`。**阶段 3/4/5 只替换各自的占位页面文件内容,不改 `app.tsx`。** 占位导出名:`PracticePage`、`HistoryPage`、`AssessmentPage`、`ConversationsPage`、`ConversationPage`、`LookupLayer`。
  - testid:`nav-practice`、`nav-chat`、`nav-me`、`me-username`、`me-language`、`me-services`、`me-logout`。
  - `~/pwa/ios`:`shouldShowIosInstallHint(ua: string, navigatorStandalone: boolean | undefined, displayModeStandalone: boolean): boolean`。

- [ ] **Step 1: 加依赖**:`yarn workspace web add sonner@^1.7.4`

- [ ] **Step 2: 写失败测试**

`web/src/settings/settings-context.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { SettingsProvider, detectLanguage, nativeLanguageCode, useSettings } from "./settings-context";

function Probe() {
  const { language, setLanguage } = useSettings();
  return <button onClick={() => setLanguage("zh-CN")}>{language}</button>;
}

describe("settings", () => {
  beforeEach(() => localStorage.clear());
  it.each([["zh-TW", "zh-CN"], ["zh-CN", "zh-CN"], ["es-MX", "es"], ["en-GB", "en"], ["fr", "en"], [undefined, "en"]] as const)(
    "detectLanguage(%s) = %s", (input, expected) => expect(detectLanguage(input)).toBe(expected),
  );
  it("maps UI language to the native language used for translation", () => {
    expect(nativeLanguageCode("zh-CN")).toBe("zh-CN");
    expect(nativeLanguageCode("es")).toBe("es-ES");
    expect(nativeLanguageCode("en")).toBe("en-US");
  });
  it("persists the choice and switches i18n", async () => {
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await act(async () => screen.getByRole("button").click());
    expect(screen.getByRole("button")).toHaveTextContent("zh-CN");
    expect(i18n.language).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toEqual({ language: "zh-CN" });
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});
```

`web/src/layout/layout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./bottom-nav";
import { initColorScheme } from "./color-scheme";
import { useAppHeight } from "./use-app-height";

function HeightProbe({ win }: { win: Window }) {
  useAppHeight(win);
  return null;
}

describe("layout", () => {
  it("bottom nav has three 56px targets with test ids", () => {
    render(<MemoryRouter initialEntries={["/chat"]}><BottomNav /></MemoryRouter>);
    for (const id of ["nav-practice", "nav-chat", "nav-me"]) {
      expect(screen.getByTestId(id).className).toMatch(/\bmin-h-14\b/);
    }
    expect(screen.getByTestId("nav-chat")).toHaveAttribute("aria-current", "page");
  });

  it("writes the visual viewport height to --app-height and follows resizes", () => {
    const listeners: Record<string, () => void> = {};
    const visualViewport = { height: 600, addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: () => {} };
    const fakeWindow = Object.assign(Object.create(window), { visualViewport, document, addEventListener: () => {}, removeEventListener: () => {} });
    render(<HeightProbe win={fakeWindow} />);
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("600px");
    visualViewport.height = 420;
    listeners.resize();
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("420px");
  });

  it("toggles the dark class from prefers-color-scheme", () => {
    let handler: () => void = () => {};
    const mq = { matches: true, addEventListener: (_: string, f: () => void) => (handler = f), removeEventListener: () => {} };
    const fakeWindow = Object.assign(Object.create(window), { matchMedia: () => mq, document });
    const stop = initColorScheme(fakeWindow);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    mq.matches = false;
    handler();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    stop();
  });
});
```

`web/src/pages/me-page.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MePage } from "./me-page";

const ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1", "azure/speech"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

describe("MePage", () => {
  beforeEach(() => { resetServerAiConfigCache(); localStorage.clear(); });
  it("shows the account, server services and logs out", async () => {
    const mock = createFetchMock(ROUTES);
    const logout = vi.fn();
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), logout });
    expect(screen.getByTestId("me-username")).toHaveTextContent("alice");
    await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("openai/tts-1, azure/speech"));
    expect(screen.getByTestId("me-services")).toHaveTextContent("alloy");
    await userEvent.click(screen.getByTestId("me-logout"));
    expect(logout).toHaveBeenCalled();
  });
  it("changes the language", async () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    await userEvent.selectOptions(screen.getByTestId("me-language"), "zh-CN");
    expect(await screen.findByText("退出登录")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("me-language"), "en");
  });
});
```

`web/src/pwa/ios.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldShowIosInstallHint } from "./ios";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

describe("shouldShowIosInstallHint", () => {
  it("shows only in iOS Safari outside standalone mode", () => {
    expect(shouldShowIosInstallHint(IPHONE_SAFARI, false, false)).toBe(true);
    expect(shouldShowIosInstallHint(IPHONE_SAFARI, true, false)).toBe(false);
    expect(shouldShowIosInstallHint(IPHONE_SAFARI, undefined, true)).toBe(false);
    expect(shouldShowIosInstallHint(IPHONE_CHROME, false, false)).toBe(false);
    expect(shouldShowIosInstallHint(ANDROID, undefined, false)).toBe(false);
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/settings src/layout src/pages/me-page src/pwa` → FAIL。

- [ ] **Step 4: 实现**

`web/src/settings/settings-context.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import i18n, { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { readJson, writeJson } from "~/lib/storage";

const KEY = "enjoy-web.settings";

interface SettingsValue {
  language: UiLanguage;
  setLanguage(language: UiLanguage): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

const isSettings = (v: unknown): v is { language: UiLanguage } =>
  SUPPORTED_LANGUAGES.includes((v as { language?: UiLanguage })?.language as UiLanguage);

export function detectLanguage(navLang?: string): UiLanguage {
  const lang = (navLang ?? "").toLowerCase();
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("es")) return "es";
  return "en";
}

export function nativeLanguageCode(language: UiLanguage): "en-US" | "zh-CN" | "es-ES" {
  return language === "zh-CN" ? "zh-CN" : language === "es" ? "es-ES" : "en-US";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>(
    () => readJson(KEY, isSettings)?.language ?? detectLanguage(typeof navigator === "undefined" ? undefined : navigator.language),
  );
  useEffect(() => {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next);
    writeJson(KEY, { language: next });
  }, []);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
```

`web/src/layout/use-app-height.ts`:

```ts
import { useEffect } from "react";

/** iOS 键盘弹出时 visualViewport 变矮;把它写进 --app-height,让输入栏始终可见。 */
export function useAppHeight(win: Window = window): void {
  useEffect(() => {
    const viewport = win.visualViewport;
    const apply = () => {
      const height = Math.round(viewport ? viewport.height : win.innerHeight);
      win.document.documentElement.style.setProperty("--app-height", `${height}px`);
    };
    apply();
    viewport?.addEventListener("resize", apply);
    win.addEventListener("resize", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      win.removeEventListener("resize", apply);
    };
  }, [win]);
}
```

`web/src/layout/color-scheme.ts`:

```ts
/** 暗色模式沿用桌面端的 .dark 主题变量,跟随系统设置。 */
export function initColorScheme(win: Window = window): () => void {
  const query = win.matchMedia ? win.matchMedia("(prefers-color-scheme: dark)") : null;
  const apply = () => win.document.documentElement.classList.toggle("dark", !!query?.matches);
  apply();
  query?.addEventListener?.("change", apply);
  return () => query?.removeEventListener?.("change", apply);
}
```

`web/src/layout/bottom-nav.tsx`:

```tsx
import { MessagesSquareIcon, MicIcon, UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { cn } from "@renderer/lib/utils";

const ITEMS = [
  { to: "/practice", icon: MicIcon, label: "web.nav.practice", testId: "nav-practice" },
  { to: "/chat", icon: MessagesSquareIcon, label: "web.nav.chat", testId: "nav-chat" },
  { to: "/me", icon: UserIcon, label: "web.nav.me", testId: "nav-me" },
] as const;

export function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("web.nav.label")} className="border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-3">
        {ITEMS.map(({ to, icon: Icon, label, testId }) => (
          <li key={to}>
            <NavLink
              to={to}
              data-testid={testId}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs",
                  isActive ? "font-medium text-primary" : "text-muted-foreground",
                )
              }
            >
              <Icon className="h-5 w-5" aria-hidden />
              {t(label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`web/src/layout/page-header.tsx`:

```tsx
import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";

export function PageHeader({ title, back, actions }: { title: string; back?: string; actions?: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b bg-background/95 px-1 backdrop-blur">
      {back ? (
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("web.common.back")} onClick={() => navigate(back)}>
          <ChevronLeftIcon className="h-5 w-5" />
        </Button>
      ) : (
        <span className="w-3" />
      )}
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      {actions}
    </header>
  );
}
```

`web/src/layout/app-shell.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import { LookupLayer } from "~/features/lookup/lookup-layer";
import { BottomNav } from "./bottom-nav";
import { useAppHeight } from "./use-app-height";

export function AppShell() {
  useAppHeight();
  return (
    <div className="flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)]">
        <Outlet />
      </main>
      <BottomNav />
      <LookupLayer />
    </div>
  );
}
```

占位页面(各一个文件,结构相同,注释写明由哪个任务替换),例如 `web/src/features/practice/practice-page.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

/** 占位:Task 3.3 替换为跟读评测页。 */
export function PracticePage() {
  const { t } = useTranslation();
  return <PageHeader title={t("web.nav.practice")} />;
}
```

  `history-page.tsx`(`HistoryPage`,Task 3.4)、`assessment-page.tsx`(`AssessmentPage`,Task 3.4)、`conversations-page.tsx`(`ConversationsPage`,标题 `web.nav.chat`,Task 4.1)、`conversation-page.tsx`(`ConversationPage`,Task 4.2)同理;`web/src/features/lookup/lookup-layer.tsx`:

```tsx
/** 占位:Task 5.2 替换为选中查词/翻译层。 */
export function LookupLayer() {
  return null;
}
```

`web/src/pwa/ios.ts`:

```ts
export function shouldShowIosInstallHint(
  userAgent: string,
  navigatorStandalone: boolean | undefined,
  displayModeStandalone: boolean,
): boolean {
  const isIos = /iPhone|iPad|iPod/.test(userAgent);
  const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent);
  return isIos && isSafari && !navigatorStandalone && !displayModeStandalone;
}
```

`web/src/pages/install-page.tsx`:

```tsx
import { ShareIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

export function InstallPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-[100dvh] pt-[env(safe-area-inset-top)]">
      <PageHeader title={t("web.install.title")} back="/me" />
      <ol className="list-decimal space-y-4 p-6 pl-10 text-base">
        <li>{t("web.install.step1")} <ShareIcon className="inline h-4 w-4" aria-hidden /></li>
        <li>{t("web.install.step2")}</li>
        <li>{t("web.install.step3")}</li>
      </ol>
      <p className="px-6 text-sm text-muted-foreground">{t("web.install.httpsNote")}</p>
    </div>
  );
}
```

`web/src/pages/me-page.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { PageHeader } from "~/layout/page-header";
import { shouldShowIosInstallHint } from "~/pwa/ios";
import { useSettings } from "~/settings/settings-context";

export function MePage() {
  const { t } = useTranslation();
  const { user, api, logout } = useAuth();
  const { language, setLanguage } = useSettings();
  const [ai, setAi] = useState<ServerAiConfig | null>(null);

  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((config) => alive && setAi(config)).catch(() => undefined);
    return () => { alive = false; };
  }, [api]);

  const showInstall = shouldShowIosInstallHint(
    navigator.userAgent,
    (navigator as Navigator & { standalone?: boolean }).standalone,
    window.matchMedia?.("(display-mode: standalone)").matches ?? false,
  );

  return (
    <div>
      <PageHeader title={t("web.me.title")} />
      <div className="space-y-6 p-4">
        <section>
          <h2 className="text-sm text-muted-foreground">{t("web.me.username")}</h2>
          <p data-testid="me-username" className="text-lg font-medium">{user?.name}</p>
        </section>
        <section className="space-y-2">
          <label htmlFor="language" className="text-sm text-muted-foreground">{t("web.me.language")}</label>
          <select id="language" data-testid="me-language" value={language}
            onChange={(e) => setLanguage(e.target.value as UiLanguage)}
            className="h-11 w-full rounded-md border bg-background px-3 text-base">
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>{t(`web.languages.${l}`)}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t("web.me.languageHint")}</p>
        </section>
        <section data-testid="me-services" className="space-y-1 text-sm">
          <h2 className="text-sm text-muted-foreground">{t("web.me.services")}</h2>
          <p>{t("web.me.stt")}</p>
          {ai && <p>{t("web.me.tts", { models: ai.ttsModels.join(", ") || "—" })}</p>}
          {ai?.defaultTts.voice && <p>{t("web.me.ttsDefault", { voice: ai.defaultTts.voice })}</p>}
        </section>
        {showInstall && (
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to="/install">{t("web.me.install")}</Link>
          </Button>
        )}
        <Button variant="destructive" data-testid="me-logout" className="h-11 w-full" onClick={logout}>
          {t("web.me.logout")}
        </Button>
      </div>
    </div>
  );
}
```

`web/src/app.tsx`(完整替换):

```tsx
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "~/auth/auth-context";
import { RequireAuth } from "~/auth/require-auth";
import { ConversationPage } from "~/features/chat/conversation-page";
import { ConversationsPage } from "~/features/chat/conversations-page";
import { AssessmentPage } from "~/features/practice/assessment-page";
import { HistoryPage } from "~/features/practice/history-page";
import { PracticePage } from "~/features/practice/practice-page";
import { AppShell } from "~/layout/app-shell";
import { InstallPage } from "~/pages/install-page";
import { LoginPage } from "~/pages/login-page";
import { MePage } from "~/pages/me-page";
import { SettingsProvider } from "~/settings/settings-context";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/install" element={<InstallPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/practice/history" element={<HistoryPage />} />
          <Route path="/practice/assessments/:id" element={<AssessmentPage />} />
          <Route path="/chat" element={<ConversationsPage />} />
          <Route path="/chat/:id" element={<ConversationPage />} />
          <Route path="/me" element={<MePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/practice" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <AuthProvider>
          <AppRoutes />
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
```

`web/src/main.tsx`:在 `import "./i18n";` 之后加 `import { initColorScheme } from "./layout/color-scheme";`,渲染前调用 `initColorScheme();`。

`web/src/test/render.tsx`:在 `AuthContext.Provider` 内层包一层 `<SettingsProvider>`(import 自 `~/settings/settings-context`)。

- [ ] **Step 5: 运行**:`yarn workspace web test` → 全部 PASS;`yarn workspace web typecheck`、`yarn workspace web build` 通过。

- [ ] **Step 6: 提交**

```bash
git add web/
git commit -m "feat(web): add mobile shell, bottom navigation, routes and the Me page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.6:PWA 外壳

**Files:**
- Create: `web/public/manifest.webmanifest`, `web/public/sw.js`, `web/public/icons/{icon-192.png,icon-512.png,icon-512-maskable.png,apple-touch-icon.png}`, `web/src/pwa/register-sw.ts`
- Modify: `web/index.html`, `web/src/main.tsx`
- Test: `web/src/pwa/sw.test.ts`, `web/src/pwa/register-sw.test.ts`

**Interfaces:**
- Produces:`registerServiceWorker(env = { prod: import.meta.env.PROD }, nav: Navigator = navigator, win: Window = window): boolean`;`/sw.js` 只对同源 `GET /assets/*` 做 cache-first(缓存名 `enjoy-web-assets-v1`,最多 80 条),其余请求一律不拦截(API、音频、`index.html` 走网络,裁定 R4 与设计文档 5.4)。

- [ ] **Step 1: 生成图标**(源图 `enjoy/assets/icon.png`,1024×1024;`uv run --with pillow` 只临时安装,不改任何依赖文件):

```bash
cd /e/workspace/everyone-can-use-english && mkdir -p web/public/icons
cd server && uv run --with pillow python - <<'PY'
from PIL import Image
src = Image.open("../enjoy/assets/icon.png").convert("RGBA")
out = "../web/public/icons/"
for size, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
    src.resize((size, size), Image.LANCZOS).save(out + name)
def padded(size, inner):
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    icon = src.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    bg.paste(icon, (offset, offset), icon)
    return bg
padded(512, 410).save(out + "icon-512-maskable.png")
padded(180, 150).convert("RGB").save(out + "apple-touch-icon.png")
PY
```

- [ ] **Step 2: 写失败测试**

`web/src/pwa/sw.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const code = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

function load() {
  const listeners: Record<string, (event: any) => void> = {};
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (type: string, fn: (event: any) => void) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  };
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (req: Request) => store.get(req.url)),
    put: vi.fn(async (req: Request, res: Response) => void store.set(req.url, res)),
    keys: vi.fn(async () => [...store.keys()].map((u) => new Request(u))),
    delete: vi.fn(async (req: Request) => store.delete(req.url)),
  };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["enjoy-web-assets-v0", "enjoy-web-assets-v1"]), delete: vi.fn(async () => true) };
  const fetchMock = vi.fn(async () => new Response("asset", { status: 200 }));
  new Function("self", "caches", "fetch", code)(self, caches, fetchMock);
  return { listeners, caches, cache, fetchMock };
}

const fetchEvent = (url: string, method = "GET") => {
  const event = { request: new Request(url, { method }), respondWith: vi.fn() };
  return event;
};

describe("service worker", () => {
  it.each([
    "https://app.test/",
    "https://app.test/practice",
    "https://app.test/index.html",
    "https://app.test/api/me",
    "https://app.test/api/assessments/x/audio",
    "https://cdn.other.test/assets/x.js",
  ])("does not intercept %s", (url) => {
    const { listeners } = load();
    const event = fetchEvent(url);
    listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("ignores non-GET requests", () => {
    const { listeners } = load();
    const event = fetchEvent("https://app.test/assets/a.js", "POST");
    listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("serves hashed assets cache-first", async () => {
    const { listeners, fetchMock } = load();
    const first = fetchEvent("https://app.test/assets/index-abc.js");
    listeners.fetch(first);
    expect(await (await first.respondWith.mock.calls[0][0]).text()).toBe("asset");
    const second = fetchEvent("https://app.test/assets/index-abc.js");
    listeners.fetch(second);
    await second.respondWith.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops old caches on activate", async () => {
    const { listeners, caches } = load();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.activate({ waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
    expect(caches.delete).toHaveBeenCalledWith("enjoy-web-assets-v0");
    expect(caches.delete).not.toHaveBeenCalledWith("enjoy-web-assets-v1");
  });
});
```

`web/src/pwa/register-sw.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register-sw";

describe("registerServiceWorker", () => {
  it("does nothing in development or without support", () => {
    expect(registerServiceWorker({ prod: false })).toBe(false);
    expect(registerServiceWorker({ prod: true }, {} as Navigator)).toBe(false);
  });
  it("registers /sw.js after load in production", () => {
    const register = vi.fn(() => Promise.resolve());
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    const win = { addEventListener: (_: string, fn: () => void) => fn() } as unknown as Window;
    expect(registerServiceWorker({ prod: true }, nav, win)).toBe(true);
    expect(register).toHaveBeenCalledWith("/sw.js");
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/pwa` → FAIL。

- [ ] **Step 4: 实现**

`web/public/sw.js`:

```js
/* 最小 service worker:只缓存带哈希的静态资源(/assets/*)。
   API、音频与 index.html 一律走网络;不做离线学习(设计文档 5.4)。 */
const CACHE = "enjoy-web-assets-v1";
const MAX_ENTRIES = 80;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/assets/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
        trim(cache);
      }
      return response;
    }),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
}
```

`web/public/manifest.webmanifest`:

```json
{
  "name": "Enjoy 英语练习",
  "short_name": "Enjoy",
  "start_url": "/practice",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#18181b",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`web/src/pwa/register-sw.ts`:

```ts
export function registerServiceWorker(
  env: { prod: boolean } = { prod: import.meta.env.PROD },
  nav: Navigator = navigator,
  win: Window = window,
): boolean {
  if (!env.prod || !("serviceWorker" in nav)) return false;
  win.addEventListener("load", () => {
    nav.serviceWorker.register("/sw.js").catch(() => undefined);
  });
  return true;
}
```

`web/index.html` 的 `<head>` 在 viewport 之后加:

```html
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Enjoy" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" href="/icons/icon-192.png" />
```

`web/src/main.tsx`:import `registerServiceWorker` 并在渲染后调用 `registerServiceWorker();`。

- [ ] **Step 5: 运行**:`yarn workspace web test` → PASS;`yarn workspace web build` 后 `ls web/dist/sw.js web/dist/manifest.webmanifest web/dist/icons/` 均存在,`grep -c 'assets/index-' web/dist/index.html` ≥ 1(资源名带哈希)。

- [ ] **Step 6: 提交**

```bash
git add web/public web/index.html web/src/pwa web/src/main.tsx
git commit -m "feat(web): add PWA manifest, icons and an asset-only service worker" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.7:Docker 构建阶段(同源托管)

**Files:**
- Modify: `server/Dockerfile`, `docker-compose.yml`, `server/README.md`(「快速开始」「构建说明」两节各加一句)
- Create: `server/Dockerfile.dockerignore`
- Delete: `server/.dockerignore`

**Interfaces:**
- Consumes:`web/` 可构建(Task 2.1–2.6);`/web/dist` 路径约定(Task 1.5 的 `DEFAULT_DIST`)。
- Produces:镜像内 `/web/dist`;构建上下文为仓库根;`docker compose up -d --build` 用法不变。

- [ ] **Step 1: `server/Dockerfile` 整体替换为**:

```dockerfile
# 构建上下文是仓库根目录(见 docker-compose.yml);忽略规则在 server/Dockerfile.dockerignore。

FROM node:22-bookworm-slim AS web
WORKDIR /repo
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY enjoy/package.json ./enjoy/package.json
COPY 1000-hours/package.json ./1000-hours/package.json
COPY 1000h-portal/package.json ./1000h-portal/package.json
COPY web/package.json ./web/package.json
# 只安装 web 的依赖(enjoy 的 Electron 依赖不需要)
RUN --mount=type=cache,target=/root/.yarn/berry/cache yarn workspaces focus web
COPY enjoy/src ./enjoy/src
COPY enjoy/tailwind.config.js ./enjoy/tailwind.config.js
COPY enjoy/assets/fonts ./enjoy/assets/fonts
COPY web ./web
RUN yarn workspace web build

FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY server/app ./app
COPY server/alembic ./alembic
COPY server/alembic.ini ./

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app /app
COPY --from=web /repo/web/dist /web/dist
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 app && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/up', timeout=3)"
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1"]
```

  若 `yarn workspaces focus web` 报错(例如缺某个 workspace 的 manifest),按报错补 `COPY`;仍不行则改为 `RUN yarn install`(构建变慢),并在报告里说明。

- [ ] **Step 2: `server/Dockerfile.dockerignore`**(白名单;BuildKit 对 `-f server/Dockerfile` 优先使用同目录的 `Dockerfile.dockerignore`):

```
*
!package.json
!yarn.lock
!.yarnrc.yml
!.yarn/releases
!enjoy/package.json
!1000-hours/package.json
!1000h-portal/package.json
!enjoy/src
!enjoy/tailwind.config.js
!enjoy/assets/fonts
!web
web/node_modules
web/dist
web/test-results
web/playwright-report
web/.env
!server/pyproject.toml
!server/uv.lock
!server/app
!server/alembic
!server/alembic.ini
**/__pycache__
**/*.pyc
```

  删除 `server/.dockerignore`(上下文已不是 `server/`)。

- [ ] **Step 3: `docker-compose.yml`** 的 `server.build` 改为:

```yaml
    build:
      context: .
      dockerfile: server/Dockerfile
```

  (`volumes: - enjoy-data:/data` 已存在,无需改动。)

- [ ] **Step 4: 构建并验证**(使用 Task 2.8 的 e2e 覆盖文件之前,先用临时独立项目验证托管;`server/.env` 只被读取,不修改):

```bash
cd /e/workspace/everyone-can-use-english
docker compose -p enjoy-webcheck build server
docker run --rm -d --name enjoy-webcheck -p 127.0.0.1:8200:8000 -e DATABASE_URL=sqlite+aiosqlite:////data/app.db enjoy-webcheck-server
timeout 90 bash -c 'until curl -fs localhost:8200/up >/dev/null; do :; done' && echo READY   # 不用 sleep 的忙等,约 20 秒
curl -s localhost:8200/ | grep -c '<div id="root">'                     # 1
curl -sI localhost:8200/practice/history | grep -i '^content-type'      # text/html
curl -s localhost:8200/api/nope                                          # {"error":"Not Found"}
curl -sI "localhost:8200/assets/$(ls web/dist/assets | grep '^index-.*\.js$' | head -1)" | grep -i cache-control   # immutable
curl -sI localhost:8200/sw.js | grep -i cache-control                    # no-cache
docker stop enjoy-webcheck
```

  注:本机 `web/dist` 的哈希文件名与镜像内一致的前提是同一份源码;若不一致,改用 `curl -s localhost:8200/ | grep -o '/assets/index-[^"]*\.js'` 取文件名。

- [ ] **Step 5: README**:`server/README.md`「快速开始」在 `docker compose up -d --build` 一行后加注释「镜像同时构建并托管手机网页版(`web/`),构建上下文为仓库根目录」;「构建说明」末尾加一段:「Docker 构建会在 Node 阶段运行 `yarn workspaces focus web` 与 `yarn workspace web build`,只安装网页版依赖;忽略规则见 `server/Dockerfile.dockerignore`。」

- [ ] **Step 6: 提交**

```bash
git add server/Dockerfile server/Dockerfile.dockerignore docker-compose.yml server/README.md
git rm server/.dockerignore
git commit -m "feat(server): build the web app in the image and serve it same-origin" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.8:E2E 基础设施与登录用例

**Files:**
- Create: `docker-compose.e2e.yml`, `web/playwright.config.ts`, `web/e2e/support/{auth.ts,fake-mic.ts}`, `web/e2e/login.spec.ts`
- Modify: `web/package.json`(devDependency `@playwright/test`)

**Interfaces:**
- Consumes:Docker 镜像(Task 2.7);testid(Task 2.4、2.5);阶段 0「决定 1」。
- Produces(后续 E2E 都用):
  - 环境变量:`E2E_BASE_URL`(默认 `http://localhost:8100`)、`E2E_INVITE_CODE`(必填)。
  - `e2e/support/auth.ts`:`INVITE_CODE`、`newCredentials(): { username; password }`、`registerViaApi(request): Promise<{ username; password; token }>`、`loginViaUi(page, username, password): Promise<void>`、`signIn(page, request): Promise<{ username; password; token }>`(注册 + UI 登录 + 断言到达 `/practice`)。
  - `e2e/support/fake-mic.ts`:`SPEECH_WAV`(绝对路径 `enjoy/samples/jfk.wav`)、`SPEECH_REFERENCE`、`useFakeMicrophone(page, browserName): Promise<void>`。
  - Playwright 项目名:`chromium-mobile`(Pixel 7)、`webkit-mobile`(iPhone 14)。
  - E2E 栈启动/关闭命令(见 Step 5),供各阶段门槛复用。

- [ ] **Step 1: 加依赖**:`yarn workspace web add -D @playwright/test@1.51.0`;`yarn workspace web exec playwright install webkit chromium`(从 Playwright 官方 CDN 下载浏览器)。

- [ ] **Step 2: `docker-compose.e2e.yml`**(仓库根):

```yaml
# E2E 专用覆盖文件,配合独立项目名使用(独立卷,不碰日常数据):
#   export E2E_INVITE_CODE=<随机值>
#   docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
services:
  server:
    environment:
      DATABASE_URL: sqlite+aiosqlite:////data/app.db
      REGISTRATION_MODE: invite
      INVITE_CODE: ${E2E_INVITE_CODE:?set E2E_INVITE_CODE}
      RATE_LIMIT_PER_MINUTE: "1000"
    ports: !override
      - "127.0.0.1:8100:8000"
```

- [ ] **Step 3: 支撑文件**

`web/e2e/support/fake-mic.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

export const SPEECH_WAV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../enjoy/samples/jfk.wav");
export const SPEECH_REFERENCE =
  "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.";
const FIXTURE_PATH = "/__e2e__/speech.wav";

/** Chromium 由启动参数提供假麦克风;WebKit 没有这些参数,用 init script 替换 getUserMedia。 */
export async function useFakeMicrophone(page: Page, browserName: string): Promise<void> {
  if (browserName === "chromium") return;
  await page.route(`**${FIXTURE_PATH}`, (route) => route.fulfill({ path: SPEECH_WAV, contentType: "audio/wav" }));
  await page.addInitScript((url: string) => {
    const devices = navigator.mediaDevices;
    if (!devices) return;
    devices.getUserMedia = async () => {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const resumed = ctx.resume(); // 在点击手势内同步发起
      const data = await (await fetch(url)).arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const destination = ctx.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      await resumed;
      return destination.stream;
    };
  }, FIXTURE_PATH);
}
```

`web/e2e/support/auth.ts`:

```ts
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const INVITE_CODE = process.env.E2E_INVITE_CODE ?? "";
if (!INVITE_CODE) throw new Error("E2E_INVITE_CODE is not set (see docker-compose.e2e.yml)");

export function newCredentials() {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return { username: `e2e_${suffix}`, password: "e2e-password-123" };
}

export async function registerViaApi(request: APIRequestContext) {
  const creds = newCredentials();
  const r = await request.post("/api/users", {
    data: { username: creds.username, password: creds.password, invite_code: INVITE_CODE },
  });
  expect(r.status(), await r.text()).toBe(200);
  return { ...creds, token: (await r.json()).access_token as string };
}

export async function loginViaUi(page: Page, username: string, password: string): Promise<void> {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

export async function signIn(page: Page, request: APIRequestContext) {
  const creds = await registerViaApi(request);
  await loginViaUi(page, creds.username, creds.password);
  await expect(page).toHaveURL(/\/practice$/);
  return creds;
}
```

`web/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import { SPEECH_WAV } from "./e2e/support/fake-mic";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${SPEECH_WAV}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    { name: "webkit-mobile", use: { ...devices["iPhone 14"] } },
  ],
});
```

- [ ] **Step 4: `web/e2e/login.spec.ts`**:

```ts
import { expect, test } from "@playwright/test";
import { INVITE_CODE, loginViaUi, newCredentials, registerViaApi } from "./support/auth";

test("register in the UI, log out and log back in", async ({ page }) => {
  const { username, password } = newCredentials();
  await page.goto("/login");
  await page.getByTestId("login-mode-toggle").click();
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("register-invite").fill(INVITE_CODE);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.getByTestId("nav-me").click();
  await expect(page.getByTestId("me-username")).toHaveText(username);
  await page.getByTestId("me-logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await loginViaUi(page, username, password);
  await expect(page).toHaveURL(/\/practice$/);
});

test("wrong password shows an error", async ({ page, request }) => {
  const { username } = await registerViaApi(request);
  await loginViaUi(page, username, "definitely-wrong");
  await expect(page.getByTestId("login-error")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("deep links survive the login redirect and reloads", async ({ page, request }) => {
  const { username, password } = await registerViaApi(request);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login$/);
  await loginViaUi(page, username, password);
  await expect(page).toHaveURL(/\/chat$/);
  await page.reload();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId("nav-chat")).toHaveAttribute("aria-current", "page");
});

test("mobile layout constraints", async ({ page, request }) => {
  await page.goto("/login");
  const fontSize = await page.getByTestId("login-username").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  const { username, password } = await registerViaApi(request);
  await loginViaUi(page, username, password);
  for (const id of ["nav-practice", "nav-chat", "nav-me"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("same-origin hosting basics", async ({ request }) => {
  const missing = await request.get("/api/nope");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "Not Found" });
  const manifest = await request.get("/manifest.webmanifest");
  expect((await manifest.json()).display).toBe("standalone");
  expect((await request.get("/sw.js")).status()).toBe(200);
  const deep = await request.get("/practice/history");
  expect(deep.headers()["content-type"]).toContain("text/html");
});
```

- [ ] **Step 5: 启动 E2E 栈并运行**

```bash
cd /e/workspace/everyone-can-use-english
export E2E_INVITE_CODE=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
curl -s localhost:8100/up                                   # {"status":"ok"}
yarn workspace web e2e --project=chromium-mobile e2e/login.spec.ts
yarn workspace web e2e --project=webkit-mobile e2e/login.spec.ts   # 或 Step 6
```

  Expected:两个项目各 5 passed。结束后(或在阶段门槛最后)关闭:`docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v`。

- [ ] **Step 6: (仅当阶段 0「决定 1」为 Linux 容器)WebKit 在容器中运行**,与 server 容器共享网络,页面来源仍是 `http://localhost`(安全上下文):

```bash
cd /e/workspace/everyone-can-use-english
MSYS_NO_PATHCONV=1 docker run --rm --network container:enjoy-e2e-server-1 \
  -e E2E_BASE_URL=http://localhost:8000 -e E2E_INVITE_CODE \
  -v "$(pwd -W):/repo" -w /repo/web \
  mcr.microsoft.com/playwright:v1.51.0-noble \
  node node_modules/@playwright/test/cli.js test --project=webkit-mobile e2e/login.spec.ts
```

  把这条命令(去掉最后的文件参数即为全量)写进 `web/README.md` 的「E2E」一节(Task 6.3 定稿)。

- [ ] **Step 7: 提交**

```bash
git add docker-compose.e2e.yml web/package.json yarn.lock web/playwright.config.ts web/e2e
git commit -m "test(web): add Playwright mobile E2E harness and login flows" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 2

- [ ] `yarn workspace web typecheck && yarn workspace web test && yarn workspace web build` → 全部成功。
- [ ] `grep -rl "__ENJOY_APP__\|electron-log\|@bugsnag/electron" web/dist || echo CLEAN` → `CLEAN`。
- [ ] `git diff --stat f8b48fa5 -- enjoy/` → 无输出。
- [ ] `cd server && uv run pytest -q` → 0 failed。
- [ ] E2E 栈(Task 2.8 Step 5)上:`login.spec.ts` 在 `chromium-mobile` 与 `webkit-mobile`(按阶段 0 决定的方式)均 5 passed;之后 `down -v`。

---

## 阶段 3:跟读评测

本阶段只改 `web/src/audio/`、`web/src/features/practice/`、`web/src/test/fake-media.ts`、`web/e2e/practice.spec.ts`。

### Task 3.1:16 位 PCM WAV 编码器(纯函数)

**Files:**
- Create: `web/src/audio/wav.ts`
- Test: `web/src/audio/wav.test.ts`

**Interfaces:**
- Produces:`ASSESSMENT_SAMPLE_RATE = 16000`;`encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer`(单声道、PCM 格式码 1、16 位小端、标准 44 字节头;样本先夹到 [-1, 1],负数乘 0x8000、正数乘 0x7fff 后四舍五入,NaN/±Infinity 记 0);`interface WavInfo { format: number; sampleRate: number; channels: number; bitsPerSample: number; dataBytes: number; durationMs: number }`;`readWavInfo(buffer: ArrayBuffer): WavInfo`(按 chunk 遍历,非 RIFF/WAVE 或缺 fmt/data 抛 `Error("Not a WAV file")`)。

- [ ] **Step 1: 写失败测试** `web/src/audio/wav.test.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSESSMENT_SAMPLE_RATE, encodeWavPcm16, readWavInfo } from "./wav";

const ascii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)));

describe("encodeWavPcm16", () => {
  it("writes a canonical 16 kHz mono 16-bit header", () => {
    const buffer = encodeWavPcm16(new Float32Array(16000), ASSESSMENT_SAMPLE_RATE);
    const v = new DataView(buffer);
    expect(buffer.byteLength).toBe(44 + 32000);
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 32000);
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(32000);
  });

  it("converts and clamps samples", () => {
    const input = new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2, Number.NaN, Number.POSITIVE_INFINITY]);
    const v = new DataView(encodeWavPcm16(input, 16000));
    const out = Array.from({ length: input.length }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(out).toEqual([0, 32767, -32768, 16384, -16384, 32767, -32768, 0, 0]);
  });

  it("handles empty input", () => {
    const buffer = encodeWavPcm16(new Float32Array(0), 16000);
    expect(buffer.byteLength).toBe(44);
    expect(readWavInfo(buffer)).toMatchObject({ dataBytes: 0, durationMs: 0 });
  });

  it("round-trips through readWavInfo", () => {
    expect(readWavInfo(encodeWavPcm16(new Float32Array(24000), 16000))).toEqual({
      format: 1, sampleRate: 16000, channels: 1, bitsPerSample: 16, dataBytes: 48000, durationMs: 1500,
    });
  });

  it("writes a sample for the server-side wave check", () => {
    const tone = Float32Array.from({ length: 16000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    const out = fileURLToPath(new URL("../../test-results/encoder-sample.wav", import.meta.url));
    mkdirSync(fileURLToPath(new URL("../../test-results/", import.meta.url)), { recursive: true });
    writeFileSync(out, Buffer.from(encodeWavPcm16(tone, 16000)));
  });
});

describe("readWavInfo", () => {
  it("reads the repository's 16 kHz sample (enjoy/samples/jfk.wav)", () => {
    const file = readFileSync(fileURLToPath(new URL("../../../enjoy/samples/jfk.wav", import.meta.url)));
    const info = readWavInfo(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    expect(info).toMatchObject({ format: 1, sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(Math.abs(info.durationMs - 11000)).toBeLessThan(100);
  });
  it("rejects non-WAV data", () => {
    expect(() => readWavInfo(new TextEncoder().encode("ID3 not a wav file").buffer)).toThrow("Not a WAV file");
  });
});
```

- [ ] **Step 2: 运行,确认失败**:`yarn workspace web test src/audio/wav` → FAIL。

- [ ] **Step 3: 实现** `web/src/audio/wav.ts`:

```ts
export const ASSESSMENT_SAMPLE_RATE = 16000;

export interface WavInfo {
  format: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationMs: number;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

/** 单声道 16 位 PCM WAV(服务端 /api/speech/assessments 只接受这种格式)。 */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const raw = samples[i];
    const s = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
    view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buffer;
}

export function readWavInfo(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let offset = 12;
  let fmt: Omit<WavInfo, "dataBytes" | "durationMs"> | null = null;
  let dataBytes = -1;
  while (offset + 8 <= buffer.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, buffer.byteLength - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataBytes < 0) throw new Error("Not a WAV file");
  const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  return { ...fmt, dataBytes, durationMs: bytesPerSecond ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0 };
}
```

- [ ] **Step 4: 运行**:`yarn workspace web test src/audio/wav` → PASS;再用服务端同款校验(标准库 `wave`,与 `speech.py` 的规则一致):

```bash
cd /e/workspace/everyone-can-use-english/server
uv run python -c "import wave; w = wave.open('../web/test-results/encoder-sample.wav'); print(w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getcomptype(), w.getnframes())"
```

  Expected: `16000 1 2 NONE 16000`。

- [ ] **Step 5: 提交**

```bash
git add web/src/audio/wav.ts web/src/audio/wav.test.ts
git commit -m "feat(web): add a 16-bit PCM WAV encoder for assessment uploads" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3.2:录音、格式转换与错误提示

**Files:**
- Create: `web/src/audio/{convert.ts,recorder.ts,use-recorder.ts,describe-error.ts}`, `web/src/audio/i18n/{en.json,zh-CN.json}`, `web/src/test/fake-media.ts`
- Test: `web/src/audio/convert.test.ts`, `web/src/audio/recorder.test.ts`, `web/src/audio/use-recorder.test.tsx`

**Interfaces:**
- Consumes:`encodeWavPcm16`、`readWavInfo`、`ASSESSMENT_SAMPLE_RATE`(Task 3.1);`translateServerError`(Task 2.4)。
- Produces:
  - `~/audio/convert`:`MAX_RECORDING_MS = 300_000`;`type AudioConvertErrorCode = "decode_failed" | "empty" | "too_long"`;`class AudioConvertError extends Error { code }`;`interface ConvertDeps { decode(data: ArrayBuffer): Promise<AudioBuffer>; render(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> }`;`browserConvertDeps`;`blobToArrayBuffer(blob): Promise<ArrayBuffer>`;`toAssessmentWav(blob, deps = browserConvertDeps): Promise<{ wav: Blob; durationMs: number }>`(超过 300 s 截断到 300 s;解码时长 > 305 s 抛 `too_long`)。
  - `~/audio/recorder`:`type RecorderErrorCode = "insecure_context" | "unsupported" | "permission_denied" | "no_device" | "failed"`;`class RecorderError extends Error { code }`;`type StopReason = "user" | "max_duration" | "background" | "track_ended"`;`interface RecordingResult { blob: Blob; mimeType: string; durationMs: number; stoppedBy: StopReason }`;`interface RecordingSession { readonly startedAt: number; readonly result: Promise<RecordingResult>; stop(): Promise<RecordingResult>; cancel(): void }`;`interface RecorderEnv`(见代码);`browserRecorderEnv()`;`AUDIO_CONSTRAINTS`;`startRecording({ maxDurationMs?, env? }): Promise<RecordingSession>`(不指定 mimeType;`start(1000)` 分片;切后台/设备断开/到时自动停止并保留数据)。
  - `~/audio/use-recorder`:`useRecorder({ maxDurationMs = MAX_RECORDING_MS, onAutoStop?, env? }): { state: "idle" | "starting" | "recording"; elapsedMs: number; error: RecorderError | null; start(): Promise<boolean>; stop(): Promise<RecordingResult | null>; clearError(): void }`(仅非用户触发的停止调用 `onAutoStop`)。
  - `~/audio/describe-error`:`describeAudioError(t, err, serverErrors?): string`。
  - `~/test/fake-media`:`createFakeRecorderEnv(overrides?): { env: RecorderEnv; recorders: FakeMediaRecorder[]; track: FakeTrack; fireTimer(): void; setHidden(): void; advance(ms: number): void; constraints: MediaStreamConstraints[] }`。
  - i18n 键 `web.recorder.*`、`web.audio.*`(见 Step 4)。

- [ ] **Step 1: 测试工具** `web/src/test/fake-media.ts`:

```ts
import { vi } from "vitest";
import type { RecorderEnv } from "~/audio/recorder";

export class FakeMediaRecorder extends EventTarget {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/mp4";
  timeslice?: number;
  constructor(public readonly stream: MediaStream, public readonly options?: unknown) {
    super();
  }
  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  emit(bytes: number[]) {
    const event = new Event("dataavailable") as Event & { data: Blob };
    event.data = new Blob([new Uint8Array(bytes)], { type: this.mimeType });
    this.dispatchEvent(event);
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.emit([9]);
      this.dispatchEvent(new Event("stop"));
    });
  }
}

export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: () => void;
  fireEnded(): void;
}

export function createFakeRecorderEnv(overrides: Partial<RecorderEnv> = {}) {
  const recorders: FakeMediaRecorder[] = [];
  const constraints: MediaStreamConstraints[] = [];
  let ended: () => void = () => {};
  const track: FakeTrack = {
    stop: vi.fn(),
    addEventListener: (type, fn) => { if (type === "ended") ended = fn; },
    removeEventListener: () => {},
    fireEnded: () => ended(),
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  let now = 1_000;
  let timer: (() => void) | null = null;
  class Recorder extends FakeMediaRecorder {
    constructor(s: MediaStream, options?: unknown) {
      super(s, options);
      recorders.push(this);
    }
  }
  const env: RecorderEnv = {
    isSecureContext: true,
    getUserMedia: async (c) => { constraints.push(c); return stream; },
    MediaRecorder: Recorder as unknown as RecorderEnv["MediaRecorder"],
    now: () => now,
    document: doc as unknown as RecorderEnv["document"],
    setTimeout: (fn) => { timer = fn; return 1; },
    clearTimeout: () => { timer = null; },
    ...overrides,
  };
  return {
    env, recorders, track, constraints,
    fireTimer: () => timer?.(),
    setHidden: () => { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); },
    advance: (ms: number) => { now += ms; },
  };
}
```

- [ ] **Step 2: 写失败测试**

`web/src/audio/convert.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AudioConvertError, blobToArrayBuffer, toAssessmentWav, type ConvertDeps } from "./convert";
import { readWavInfo } from "./wav";

const fakeBuffer = (duration: number) => ({ duration, length: Math.round(duration * 48000), sampleRate: 48000, numberOfChannels: 2 }) as AudioBuffer;

function deps(duration: number, samples?: Float32Array, fail = false): ConvertDeps & { rates: number[] } {
  const rates: number[] = [];
  return {
    rates,
    decode: async () => { if (fail) throw new Error("bad"); return fakeBuffer(duration); },
    render: async (_b, rate) => { rates.push(rate); return samples ?? new Float32Array(Math.round(duration * rate)); },
  };
}

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

describe("toAssessmentWav", () => {
  it("renders at 16 kHz and encodes WAV", async () => {
    const d = deps(2);
    const { wav, durationMs } = await toAssessmentWav(blob, d);
    expect(d.rates).toEqual([16000]);
    expect(wav.type).toBe("audio/wav");
    expect(readWavInfo(await blobToArrayBuffer(wav))).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationMs: 2000 });
    expect(durationMs).toBe(2000);
  });
  it("rejects empty blobs and empty audio", async () => {
    await expect(toAssessmentWav(new Blob([]), deps(1))).rejects.toMatchObject({ code: "empty" });
    await expect(toAssessmentWav(blob, deps(0))).rejects.toMatchObject({ code: "empty" });
  });
  it("maps decode failures", async () => {
    await expect(toAssessmentWav(blob, deps(1, undefined, true))).rejects.toBeInstanceOf(AudioConvertError);
    await expect(toAssessmentWav(blob, deps(1, undefined, true))).rejects.toMatchObject({ code: "decode_failed" });
  });
  it("trims slight overshoot to 300 s and rejects far longer audio", async () => {
    const { wav, durationMs } = await toAssessmentWav(blob, deps(301, new Float32Array(301 * 16000)));
    expect(durationMs).toBe(300_000);
    expect(readWavInfo(await blobToArrayBuffer(wav)).dataBytes).toBe(300 * 16000 * 2);
    await expect(toAssessmentWav(blob, deps(320))).rejects.toMatchObject({ code: "too_long" });
  });
});
```

`web/src/audio/recorder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { RecorderError, startRecording } from "./recorder";

describe("startRecording", () => {
  it("refuses insecure contexts and missing APIs", async () => {
    await expect(startRecording({ env: createFakeRecorderEnv({ isSecureContext: false }).env })).rejects.toMatchObject({ code: "insecure_context" });
    await expect(startRecording({ env: createFakeRecorderEnv({ MediaRecorder: undefined }).env })).rejects.toMatchObject({ code: "unsupported" });
    await expect(startRecording({ env: createFakeRecorderEnv({ getUserMedia: undefined }).env })).rejects.toMatchObject({ code: "unsupported" });
  });

  it.each([
    ["NotAllowedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "no_device"],
    ["NotReadableError", "no_device"],
    ["AbortError", "failed"],
  ])("maps getUserMedia %s to %s", async (name, code) => {
    const { env } = createFakeRecorderEnv({ getUserMedia: async () => { throw Object.assign(new Error(name), { name }); } });
    const err = await startRecording({ env }).catch((e) => e);
    expect(err).toBeInstanceOf(RecorderError);
    expect(err.code).toBe(code);
  });

  it("requests processed audio and lets the browser choose the format", async () => {
    const fake = createFakeRecorderEnv();
    await startRecording({ env: fake.env });
    expect(fake.constraints[0]).toEqual({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    expect(fake.recorders[0].options).toBeUndefined();
    expect(fake.recorders[0].timeslice).toBe(1000);
  });

  it("stop() returns the collected audio and releases the microphone", async () => {
    const fake = createFakeRecorderEnv();
    const session = await startRecording({ env: fake.env });
    fake.recorders[0].emit([1, 2]);
    fake.advance(2500);
    const result = await session.stop();
    expect(result).toMatchObject({ mimeType: "audio/mp4", durationMs: 2500, stoppedBy: "user" });
    expect(result.blob.size).toBe(3);
    expect(result.blob.type).toBe("audio/mp4");
    expect(fake.track.stop).toHaveBeenCalled();
    expect(await session.stop()).toBe(result);
  });

  it.each([
    ["max_duration", (f: ReturnType<typeof createFakeRecorderEnv>) => f.fireTimer()],
    ["background", (f: ReturnType<typeof createFakeRecorderEnv>) => f.setHidden()],
    ["track_ended", (f: ReturnType<typeof createFakeRecorderEnv>) => f.track.fireEnded()],
  ] as const)("stops automatically on %s and keeps the data", async (reason, trigger) => {
    const fake = createFakeRecorderEnv();
    const session = await startRecording({ env: fake.env, maxDurationMs: 300_000 });
    fake.recorders[0].emit([1, 2, 3]);
    trigger(fake);
    const result = await session.result;
    expect(result.stoppedBy).toBe(reason);
    expect(result.blob.size).toBe(4);
  });
});
```

`web/src/audio/use-recorder.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { useRecorder } from "./use-recorder";

describe("useRecorder", () => {
  it("starts and stops", async () => {
    const fake = createFakeRecorderEnv();
    const { result } = renderHook(() => useRecorder({ env: fake.env }));
    await act(async () => { expect(await result.current.start()).toBe(true); });
    expect(result.current.state).toBe("recording");
    let recording: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => { recording = await result.current.stop(); });
    expect(recording!.stoppedBy).toBe("user");
    expect(result.current.state).toBe("idle");
  });

  it("exposes start errors", async () => {
    const fake = createFakeRecorderEnv({ getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } });
    const { result } = renderHook(() => useRecorder({ env: fake.env }));
    await act(async () => { expect(await result.current.start()).toBe(false); });
    expect(result.current.error?.code).toBe("permission_denied");
    expect(result.current.state).toBe("idle");
  });

  it("reports automatic stops through onAutoStop only", async () => {
    const fake = createFakeRecorderEnv();
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useRecorder({ env: fake.env, onAutoStop }));
    await act(async () => { await result.current.start(); });
    act(() => fake.setHidden());
    await waitFor(() => expect(onAutoStop).toHaveBeenCalledWith(expect.objectContaining({ stoppedBy: "background" })));
    expect(result.current.state).toBe("idle");
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/audio` → FAIL(convert/recorder/use-recorder 未实现)。

- [ ] **Step 4: 实现**

`web/src/audio/convert.ts`:

```ts
import { ASSESSMENT_SAMPLE_RATE, encodeWavPcm16 } from "./wav";

export const MAX_RECORDING_MS = 300_000;
const HARD_LIMIT_MS = MAX_RECORDING_MS + 5_000;

export type AudioConvertErrorCode = "decode_failed" | "empty" | "too_long";

export class AudioConvertError extends Error {
  constructor(public readonly code: AudioConvertErrorCode) {
    super(code);
    this.name = "AudioConvertError";
  }
}

export interface ConvertDeps {
  decode(data: ArrayBuffer): Promise<AudioBuffer>;
  render(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array>;
}

type OfflineCtor = typeof OfflineAudioContext;

function offlineCtor(): OfflineCtor | undefined {
  return (
    (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext
  );
}

/** 用 OfflineAudioContext 解码(不占用 iOS 有限的 AudioContext 名额);兼容回调与 Promise 两种形式。 */
export function decodeWithOfflineContext(data: ArrayBuffer): Promise<AudioBuffer> {
  const Ctor = offlineCtor();
  if (!Ctor) return Promise.reject(new Error("OfflineAudioContext is not supported"));
  const ctx = new Ctor(1, 1, 44100);
  return new Promise((resolve, reject) => {
    const maybe = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
  });
}

/** 渲染成单声道(多声道按规范自动下混)并重采样到 sampleRate。 */
export async function renderMono(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error("OfflineAudioContext is not supported");
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const ctx = new Ctor(1, length, sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

export const browserConvertDeps: ConvertDeps = { decode: decodeWithOfflineContext, render: renderMono };

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** MediaRecorder 产物(webm/opus、mp4/aac 等)→ 16 kHz 单声道 16 位 WAV。 */
export async function toAssessmentWav(blob: Blob, deps: ConvertDeps = browserConvertDeps): Promise<{ wav: Blob; durationMs: number }> {
  if (blob.size === 0) throw new AudioConvertError("empty");
  const data = await blobToArrayBuffer(blob);
  let decoded: AudioBuffer;
  try {
    decoded = await deps.decode(data);
  } catch {
    throw new AudioConvertError("decode_failed");
  }
  if (!decoded || !decoded.length || !decoded.duration) throw new AudioConvertError("empty");
  if (decoded.duration * 1000 > HARD_LIMIT_MS) throw new AudioConvertError("too_long");
  let samples = await deps.render(decoded, ASSESSMENT_SAMPLE_RATE);
  const maxSamples = (MAX_RECORDING_MS / 1000) * ASSESSMENT_SAMPLE_RATE;
  if (samples.length > maxSamples) samples = samples.subarray(0, maxSamples);
  if (!samples.length) throw new AudioConvertError("empty");
  return {
    wav: new Blob([encodeWavPcm16(samples, ASSESSMENT_SAMPLE_RATE)], { type: "audio/wav" }),
    durationMs: Math.round((samples.length / ASSESSMENT_SAMPLE_RATE) * 1000),
  };
}
```

`web/src/audio/recorder.ts`:

```ts
export type RecorderErrorCode = "insecure_context" | "unsupported" | "permission_denied" | "no_device" | "failed";

export class RecorderError extends Error {
  constructor(public readonly code: RecorderErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RecorderError";
  }
}

export type StopReason = "user" | "max_duration" | "background" | "track_ended";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  stoppedBy: StopReason;
}

export interface RecordingSession {
  readonly startedAt: number;
  readonly result: Promise<RecordingResult>;
  stop(): Promise<RecordingResult>;
  cancel(): void;
}

export interface RecorderEnv {
  isSecureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: new (stream: MediaStream) => MediaRecorder;
  now(): number;
  document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

export function browserRecorderEnv(): RecorderEnv {
  const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    getUserMedia: devices?.getUserMedia ? (c) => devices.getUserMedia(c) : undefined,
    MediaRecorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    now: () => Date.now(),
    document,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

function mapGetUserMediaError(err: unknown): RecorderError {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return new RecorderError("permission_denied");
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") return new RecorderError("no_device");
  return new RecorderError("failed", String(err));
}

/** 不指定 mimeType,由浏览器决定(Chrome 多为 webm/opus,Safari 为 mp4/aac)。 */
export async function startRecording(options: { maxDurationMs?: number; env?: RecorderEnv } = {}): Promise<RecordingSession> {
  const env = options.env ?? browserRecorderEnv();
  if (!env.isSecureContext) throw new RecorderError("insecure_context");
  if (!env.getUserMedia || !env.MediaRecorder) throw new RecorderError("unsupported");
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia(AUDIO_CONSTRAINTS);
  } catch (err) {
    throw mapGetUserMediaError(err);
  }
  const tracks = stream.getTracks();
  let recorder: MediaRecorder;
  try {
    recorder = new env.MediaRecorder(stream);
  } catch (err) {
    tracks.forEach((t) => t.stop());
    throw new RecorderError("unsupported", String(err));
  }

  const chunks: Blob[] = [];
  const startedAt = env.now();
  let reason: StopReason = "user";
  let stopping = false;
  let settled = false;
  let timer: unknown;
  let resolveResult!: (value: RecordingResult) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<RecordingResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const onVisibility = () => {
    if (env.document.visibilityState === "hidden") finish("background");
  };
  const onEnded = () => finish("track_ended");
  const cleanup = () => {
    if (timer !== undefined) env.clearTimeout(timer);
    env.document.removeEventListener("visibilitychange", onVisibility);
    tracks.forEach((t) => {
      t.removeEventListener?.("ended", onEnded);
      t.stop();
    });
  };
  const onStop = () => {
    if (settled) return;
    settled = true;
    cleanup();
    const mimeType = recorder.mimeType || chunks[0]?.type || "";
    resolveResult({
      blob: new Blob(chunks, mimeType ? { type: mimeType } : undefined),
      mimeType,
      durationMs: env.now() - startedAt,
      stoppedBy: reason,
    });
  };
  function finish(why: StopReason) {
    if (stopping) return;
    stopping = true;
    reason = why;
    if (recorder.state === "inactive") return onStop();
    try {
      recorder.stop();
    } catch {
      onStop();
    }
  }

  recorder.addEventListener("dataavailable", (event) => {
    const data = (event as BlobEvent).data;
    if (data && data.size > 0) chunks.push(data);
  });
  recorder.addEventListener("stop", onStop);
  recorder.addEventListener("error", (event) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectResult(new RecorderError("failed", String((event as Event & { error?: unknown }).error ?? "MediaRecorder error")));
  });
  env.document.addEventListener("visibilitychange", onVisibility);
  tracks.forEach((t) => t.addEventListener?.("ended", onEnded));
  if (options.maxDurationMs) timer = env.setTimeout(() => finish("max_duration"), options.maxDurationMs);
  recorder.start(1000);

  return {
    startedAt,
    result,
    stop: () => {
      finish("user");
      return result;
    },
    cancel: () => finish("user"),
  };
}
```

`web/src/audio/use-recorder.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS } from "./convert";
import { RecorderError, startRecording, type RecorderEnv, type RecordingResult, type RecordingSession } from "./recorder";

export type RecorderState = "idle" | "starting" | "recording";

export interface UseRecorderOptions {
  maxDurationMs?: number;
  onAutoStop?: (result: RecordingResult) => void;
  env?: RecorderEnv;
}

const asRecorderError = (err: unknown) => (err instanceof RecorderError ? err : new RecorderError("failed", String(err)));

export function useRecorder({ maxDurationMs = MAX_RECORDING_MS, onAutoStop, env }: UseRecorderOptions = {}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const session = useRef<RecordingSession | null>(null);
  const autoStop = useRef(onAutoStop);
  autoStop.current = onAutoStop;

  useEffect(() => {
    if (state !== "recording") return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - started), 250);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => () => session.current?.cancel(), []);

  const start = useCallback(async () => {
    if (session.current) return false;
    setError(null);
    setElapsedMs(0);
    setState("starting");
    try {
      const current = await startRecording({ maxDurationMs, env });
      session.current = current;
      setState("recording");
      current.result.then(
        (result) => {
          if (session.current !== current) return; // 用户主动 stop() 已处理
          session.current = null;
          setState("idle");
          autoStop.current?.(result);
        },
        (err) => {
          if (session.current === current) session.current = null;
          setState("idle");
          setError(asRecorderError(err));
        },
      );
      return true;
    } catch (err) {
      setState("idle");
      setError(asRecorderError(err));
      return false;
    }
  }, [maxDurationMs, env]);

  const stop = useCallback(async () => {
    const current = session.current;
    if (!current) return null;
    session.current = null;
    try {
      return await current.stop();
    } catch (err) {
      setError(asRecorderError(err));
      return null;
    } finally {
      setState("idle");
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { state, elapsedMs, error, start, stop, clearError };
}
```

`web/src/audio/describe-error.ts`:

```ts
import type { TFunction } from "i18next";
import { translateServerError } from "~/api/error-messages";
import { AudioConvertError } from "./convert";
import { RecorderError } from "./recorder";

export function describeAudioError(t: TFunction, err: unknown, serverErrors: Record<string, string> = {}): string {
  if (err instanceof RecorderError) return t(`web.recorder.${err.code}`);
  if (err instanceof AudioConvertError) return t(`web.audio.${err.code}`);
  return translateServerError(t, err, serverErrors);
}
```

`web/src/audio/i18n/en.json`:

```json
{
  "web": {
    "recorder": {
      "insecure_context": "Recording needs a secure (HTTPS) connection.",
      "unsupported": "This browser cannot record audio.",
      "permission_denied": "Microphone access was denied. Allow it in the browser settings and try again.",
      "no_device": "No microphone was found.",
      "failed": "Recording failed. Please try again.",
      "start": "Start recording",
      "stop": "Stop recording",
      "background": "Recording stopped because the app went to the background. {{seconds}} s were kept.",
      "trackEnded": "Recording stopped because the microphone was disconnected. {{seconds}} s were kept."
    },
    "audio": {
      "decode_failed": "The recording could not be decoded.",
      "empty": "The recording is empty.",
      "too_long": "The recording is longer than 5 minutes."
    }
  }
}
```

`web/src/audio/i18n/zh-CN.json`:

```json
{
  "web": {
    "recorder": {
      "insecure_context": "录音需要安全连接(HTTPS)。",
      "unsupported": "当前浏览器不支持录音。",
      "permission_denied": "麦克风权限被拒绝,请在浏览器设置中允许后重试。",
      "no_device": "没有找到麦克风。",
      "failed": "录音失败,请重试。",
      "start": "开始录音",
      "stop": "停止录音",
      "background": "应用切到后台,录音已停止,保留了 {{seconds}} 秒。",
      "trackEnded": "麦克风断开,录音已停止,保留了 {{seconds}} 秒。"
    },
    "audio": {
      "decode_failed": "无法解码这段录音。",
      "empty": "录音是空的。",
      "too_long": "录音超过 5 分钟。"
    }
  }
}
```

- [ ] **Step 5: 运行**:`yarn workspace web test src/audio` → PASS;`yarn workspace web typecheck` → 0 错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/audio web/src/test/fake-media.ts
git commit -m "feat(web): record with MediaRecorder and convert to 16 kHz mono WAV" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3.3:跟读评测页(录音 → 上传 → 保存)

**Files:**
- Create: `web/src/features/practice/assessment-api.ts`, `web/src/features/practice/i18n/{en.json,zh-CN.json}`
- Modify(替换占位): `web/src/features/practice/practice-page.tsx`
- Test: `web/src/features/practice/assessment-api.test.ts`, `web/src/features/practice/practice-page.test.tsx`

**Interfaces:**
- Consumes:`useRecorder`、`toAssessmentWav`、`describeAudioError`、`RecorderEnv`、`RecordingResult`(Task 3.2);`useAuth`、`PageHeader`、`readJson/writeJson`、`ApiError`。
- Produces:
  - `~/features/practice/assessment-api`:`interface AssessmentScores { pronunciationScore; accuracyScore; fluencyScore; completenessScore }`;`interface AssessmentResult extends AssessmentScores { detailResult: { display: string; words: PronunciationAssessmentWordResultType[] } }`;`interface AssessResponse extends AssessmentResult { assessmentId?: string }`;`interface AssessmentSummary { id; referenceText; language; durationMs; scores: AssessmentScores; createdAt }`;`interface AssessmentDetail extends AssessmentSummary { result: AssessmentResult }`;`assessPronunciation(api, { wav, reference, language, save }): Promise<AssessResponse>`(multipart `file`=`recording.wav`、`reference`、`language`,仅 `save` 为真时追加 `save=true`;超时 330 s);`listAssessments(api, page = 1, perPage = 20): Promise<Paged<"assessments", AssessmentSummary>>`;`getAssessment(api, id)`;`getAssessmentAudio(api, id): Promise<Blob>`;`deleteAssessment(api, id)`;`PRACTICE_SERVER_ERRORS`。
  - `PracticePage({ recorderEnv?: RecorderEnv })`;草稿键 `enjoy-web.practice.reference`;接受 `location.state.reference` 预填;testid:`reference-input`、`record-toggle`、`record-timer`、`practice-status`(`data-state` ∈ `idle|recording|processing|kept|error`)、`practice-history`、`practice-error`、`practice-assess-kept`、`practice-discard`;`formatClock(ms): string`(`mm:ss`)。

- [ ] **Step 1: 写失败测试**

`web/src/features/practice/assessment-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { assessPronunciation, deleteAssessment, getAssessment, getAssessmentAudio, listAssessments } from "./assessment-api";

const api = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("assessment api", () => {
  it("uploads multipart with save=true only when requested", async () => {
    const { api: client, mock } = api({ "POST /api/speech/assessments": () => json({ pronunciation_score: 90, assessment_id: "a1" }) });
    const wav = new Blob(["RIFF"], { type: "audio/wav" });
    const res = await assessPronunciation(client, { wav, reference: "Hello", language: "en-US", save: true });
    expect(res).toMatchObject({ pronunciationScore: 90, assessmentId: "a1" });
    const form = mock.calls[0].body as FormData;
    expect(form.get("reference")).toBe("Hello");
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
    const file = form.get("file") as File;
    expect(file.name).toBe("recording.wav");
    expect(file.type).toBe("audio/wav");
    await assessPronunciation(client, { wav, reference: "Hello", language: "en-US", save: false });
    expect((mock.calls[1].body as FormData).has("save")).toBe(false);
  });

  it("lists, fetches, streams audio and deletes", async () => {
    const { api: client, mock } = api({
      "GET /api/assessments": () => json({ assessments: [{ id: "a1", reference_text: "Hi", duration_ms: 500, scores: { pronunciation_score: 80 } }], page: 1, next: null }),
      "GET /api/assessments/a1": () => json({ id: "a1", result: { detail_result: { words: [] } } }),
      "GET /api/assessments/a1/audio": () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/wav" } }),
      "DELETE /api/assessments/a1": () => json({ id: "a1" }),
    });
    const page = await listAssessments(client, 2, 10);
    expect(mock.calls[0].url.search).toBe("?page=2&per_page=10");
    expect(page.assessments[0]).toMatchObject({ referenceText: "Hi", durationMs: 500, scores: { pronunciationScore: 80 } });
    expect((await getAssessment(client, "a1")).result.detailResult.words).toEqual([]);
    expect((await getAssessmentAudio(client, "a1")).size).toBe(2);
    expect(await deleteAssessment(client, "a1")).toEqual({ id: "a1" });
  });
});
```

`web/src/features/practice/practice-page.test.tsx`:

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PracticePage, formatClock } from "./practice-page";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

function setup(routes: Parameters<typeof createFetchMock>[0], envOverrides = {}) {
  const mock = createFetchMock(routes);
  const fake = createFakeRecorderEnv(envOverrides);
  renderWithProviders(<PracticePage recorderEnv={fake.env} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/practice",
  });
  return { mock, fake };
}

describe("PracticePage", () => {
  beforeEach(() => localStorage.clear());

  it("formats the timer", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_400)).toBe("01:05");
  });

  it("needs reference text before recording", async () => {
    setup({});
    expect(screen.getByTestId("record-toggle")).toBeDisabled();
    await userEvent.type(screen.getByTestId("reference-input"), "Hello world");
    expect(screen.getByTestId("record-toggle")).toBeEnabled();
    expect(JSON.parse(localStorage.getItem("enjoy-web.practice.reference")!)).toBe("Hello world");
  });

  it("records, uploads with save=true and opens the result", async () => {
    const { mock } = setup({ "POST /api/speech/assessments": () => json({ pronunciation_score: 88, assessment_id: "a1" }) });
    await userEvent.type(screen.getByTestId("reference-input"), "  Hello world  ");
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "recording");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a1"));
    const form = mock.calls[0].body as FormData;
    expect(form.get("reference")).toBe("Hello world");
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
  });

  it("shows translated server errors", async () => {
    setup({ "POST /api/speech/assessments": () => json({ error: "Reference text is required" }, 400) });
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(await screen.findByTestId("practice-error")).toHaveTextContent("Please enter the reference text first.");
  });

  it("explains microphone permission problems", async () => {
    setup({}, { getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } });
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    expect(await screen.findByTestId("practice-error")).toHaveTextContent("Microphone access was denied");
  });

  it("keeps audio recorded before going to the background", async () => {
    const { mock, fake } = setup({ "POST /api/speech/assessments": () => json({ assessment_id: "a2" }) });
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await act(async () => fake.setHidden());
    await waitFor(() => expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "kept"));
    await userEvent.click(screen.getByTestId("practice-assess-kept"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a2"));
    expect(mock.calls).toHaveLength(1);
  });

  it("can discard the kept audio", async () => {
    const { mock, fake } = setup({});
    await userEvent.type(screen.getByTestId("reference-input"), "Hi");
    await userEvent.click(screen.getByTestId("record-toggle"));
    await act(async () => fake.setHidden());
    await userEvent.click(await screen.findByTestId("practice-discard"));
    expect(screen.getByTestId("practice-status")).toHaveAttribute("data-state", "idle");
    expect(mock.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行,确认失败**:`yarn workspace web test src/features/practice` → FAIL。

- [ ] **Step 3: 实现**

`web/src/features/practice/assessment-api.ts`:

```ts
import type { ApiClient } from "~/api/client";
import type { Paged } from "~/api/types";

export interface AssessmentScores {
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
}

export interface AssessmentResult extends AssessmentScores {
  detailResult: { display: string; words: PronunciationAssessmentWordResultType[] };
}

export interface AssessResponse extends AssessmentResult {
  assessmentId?: string;
}

export interface AssessmentSummary {
  id: string;
  referenceText: string;
  language: string;
  durationMs: number;
  scores: AssessmentScores;
  createdAt: string;
}

export interface AssessmentDetail extends AssessmentSummary {
  result: AssessmentResult;
}

export const ASSESSMENT_TIMEOUT_MS = 330_000;

export const PRACTICE_SERVER_ERRORS: Record<string, string> = {
  "Reference text is required": "web.practice.errors.referenceRequired",
  "Reference text is too long": "web.practice.errors.referenceTooLong",
  "Audio is too long": "web.practice.errors.audioTooLong",
  "Audio must be a 16 kHz mono 16-bit WAV": "web.practice.errors.badAudio",
  "Unsupported language": "web.practice.errors.language",
  "Pronunciation assessment is not configured": "web.practice.errors.notConfigured",
  "Recording storage quota exceeded": "web.practice.errors.quota",
  "Upstream unavailable": "web.practice.errors.upstream",
  "Assessment not found": "web.practice.errors.notFound",
};

const path = (id: string) => `/api/assessments/${encodeURIComponent(id)}`;

export function assessPronunciation(
  api: ApiClient,
  params: { wav: Blob; reference: string; language: string; save: boolean },
): Promise<AssessResponse> {
  const form = new FormData();
  form.append("file", new File([params.wav], "recording.wav", { type: "audio/wav" }));
  form.append("reference", params.reference);
  form.append("language", params.language);
  if (params.save) form.append("save", "true");
  return api.request("POST", "/api/speech/assessments", { form, timeoutMs: ASSESSMENT_TIMEOUT_MS });
}

export function listAssessments(api: ApiClient, page = 1, perPage = 20): Promise<Paged<"assessments", AssessmentSummary>> {
  return api.request("GET", "/api/assessments", { query: { page, per_page: perPage } });
}

export function getAssessment(api: ApiClient, id: string): Promise<AssessmentDetail> {
  return api.request("GET", path(id));
}

export function getAssessmentAudio(api: ApiClient, id: string): Promise<Blob> {
  return api.request("GET", `${path(id)}/audio`, { as: "blob" });
}

export function deleteAssessment(api: ApiClient, id: string): Promise<{ id: string }> {
  return api.request("DELETE", path(id));
}
```

`web/src/features/practice/practice-page.tsx`:

```tsx
import { HistoryIcon, LoaderIcon, MicIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { cn } from "@renderer/lib/utils";
import { ApiError } from "~/api/client";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { readJson, writeJson } from "~/lib/storage";
import { PRACTICE_SERVER_ERRORS, assessPronunciation } from "./assessment-api";

const DRAFT_KEY = "enjoy-web.practice.reference";
const isString = (v: unknown): v is string => typeof v === "string";

export function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PracticePage({ recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [reference, setReference] = useState(
    () => (location.state as { reference?: string } | null)?.reference ?? readJson(DRAFT_KEY, isString) ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    writeJson(DRAFT_KEY, reference);
  }, [reference]);

  const submit = useCallback(
    async (recording: RecordingResult) => {
      setKept(null);
      setBusy(true);
      setError(null);
      try {
        const { wav } = await toAssessmentWav(recording.blob);
        const res = await assessPronunciation(api, { wav, reference: reference.trim(), language: "en-US", save: true });
        if (!res.assessmentId) throw new ApiError(500, "Could not save the recording");
        navigate(`/practice/assessments/${res.assessmentId}`);
      } catch (err) {
        setError(describeAudioError(t, err, PRACTICE_SERVER_ERRORS));
      } finally {
        setBusy(false);
      }
    },
    [api, navigate, reference, t],
  );

  const recorder = useRecorder({
    env: recorderEnv,
    onAutoStop: (result) => (result.stoppedBy === "max_duration" ? void submit(result) : setKept(result)),
  });

  const toggle = async () => {
    if (recorder.state === "recording") {
      const result = await recorder.stop();
      if (result) await submit(result);
      return;
    }
    setError(null);
    setKept(null);
    await recorder.start();
  };

  const recording = recorder.state === "recording";
  const shownError = error ?? (recorder.error ? describeAudioError(t, recorder.error) : null);
  const status = busy ? "processing" : recording ? "recording" : kept ? "kept" : shownError ? "error" : "idle";
  const canRecord = recording || (reference.trim().length > 0 && !busy && recorder.state === "idle");

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={t("web.practice.title")}
        actions={
          <Button asChild variant="ghost" className="h-11" data-testid="practice-history">
            <Link to="/practice/history"><HistoryIcon className="mr-1 h-4 w-4" />{t("web.practice.history")}</Link>
          </Button>
        }
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <label htmlFor="reference" className="text-sm text-muted-foreground">{t("web.practice.referenceLabel")}</label>
        <Textarea id="reference" data-testid="reference-input" rows={5} maxLength={2000} className="text-base"
          placeholder={t("web.practice.referencePlaceholder")} value={reference} disabled={recording || busy}
          onChange={(e) => setReference(e.target.value)} />
        {!reference.trim() && <p className="text-xs text-muted-foreground">{t("web.practice.referenceHint")}</p>}
        <div data-testid="practice-status" data-state={status} className="mt-auto flex flex-col items-center gap-3 pb-4">
          <span data-testid="record-timer" className="font-mono text-sm tabular-nums">
            {formatClock(recorder.elapsedMs)} / 05:00
          </span>
          <button type="button" data-testid="record-toggle" onClick={toggle} disabled={!canRecord}
            aria-label={recording ? t("web.recorder.stop") : t("web.recorder.start")}
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition disabled:opacity-40",
              recording ? "animate-pulse bg-red-600 text-white" : "bg-primary text-primary-foreground",
            )}>
            {busy ? <LoaderIcon className="h-8 w-8 animate-spin" /> : recording ? <SquareIcon className="h-8 w-8" /> : <MicIcon className="h-8 w-8" />}
          </button>
          {busy && <p className="text-sm text-muted-foreground">{t("web.practice.assessing")}</p>}
          {kept && (
            <div className="w-full space-y-2 rounded-md border p-3 text-sm">
              <p>{t(kept.stoppedBy === "background" ? "web.recorder.background" : "web.recorder.trackEnded", { seconds: Math.round(kept.durationMs / 1000) })}</p>
              <div className="flex gap-2">
                <Button data-testid="practice-assess-kept" className="h-11 flex-1" onClick={() => void submit(kept)}>{t("web.practice.assessKept")}</Button>
                <Button data-testid="practice-discard" variant="outline" className="h-11 flex-1" onClick={() => setKept(null)}>{t("web.practice.discard")}</Button>
              </div>
            </div>
          )}
          {shownError && <p role="alert" data-testid="practice-error" className="text-center text-sm text-destructive">{shownError}</p>}
        </div>
      </div>
    </div>
  );
}
```

`web/src/features/practice/i18n/en.json`(Task 3.4 的文案一并写好):

```json
{
  "web": {
    "practice": {
      "title": "Read aloud", "history": "History", "referenceLabel": "Reference text",
      "referencePlaceholder": "Type or paste the English text you will read.",
      "referenceHint": "Enter the text first, then tap the microphone.",
      "assessing": "Assessing…", "assessKept": "Assess this", "discard": "Record again",
      "errors": {
        "referenceRequired": "Please enter the reference text first.", "referenceTooLong": "The reference text is too long (2000 characters max).",
        "audioTooLong": "The recording is longer than 5 minutes.", "badAudio": "The recording format was not accepted.",
        "language": "Only English is supported.", "notConfigured": "Pronunciation assessment is not configured on the server.",
        "quota": "Your recording storage is full. Delete some old recordings.", "upstream": "The assessment service is unavailable. Please try again.",
        "notFound": "This recording does not exist."
      },
      "result": {
        "title": "Result", "again": "Practice again", "deleteConfirm": "Delete this recording?",
        "deleteDescription": "The recording and its score will be removed.", "audioUnavailable": "The recording is unavailable."
      },
      "historyTitle": "History", "empty": "No practice yet."
    }
  }
}
```

`web/src/features/practice/i18n/zh-CN.json`:

```json
{
  "web": {
    "practice": {
      "title": "跟读评测", "history": "历史", "referenceLabel": "参考文本",
      "referencePlaceholder": "输入或粘贴要朗读的英文。",
      "referenceHint": "先输入参考文本,再点麦克风。",
      "assessing": "正在评测…", "assessKept": "评测这段", "discard": "重录",
      "errors": {
        "referenceRequired": "请先输入参考文本。", "referenceTooLong": "参考文本过长(最多 2000 字符)。",
        "audioTooLong": "录音超过 5 分钟。", "badAudio": "录音格式未被服务器接受。",
        "language": "目前只支持英文。", "notConfigured": "服务器未配置发音评测。",
        "quota": "录音存储空间已满,请删除一些旧录音。", "upstream": "评测服务暂不可用,请重试。",
        "notFound": "这条录音不存在。"
      },
      "result": {
        "title": "评测结果", "again": "再练一次", "deleteConfirm": "删除这条录音?",
        "deleteDescription": "录音与评分将被删除。", "audioUnavailable": "录音不可用。"
      },
      "historyTitle": "练习历史", "empty": "还没有练习记录。"
    }
  }
}
```

- [ ] **Step 4: 运行**:`yarn workspace web test src/features/practice` → PASS;typecheck 0 错误。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/practice
git commit -m "feat(web): record and assess pronunciation against reference text" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3.4:评测结果、历史与回放

**Files:**
- Create: `web/src/features/practice/mobile-score-result.tsx`
- Modify(替换占位): `web/src/features/practice/{assessment-page.tsx,history-page.tsx}`
- Test: `web/src/features/practice/assessment-page.test.tsx`, `web/src/features/practice/history-page.test.tsx`

**Interfaces:**
- Consumes:`getAssessment`、`getAssessmentAudio`、`deleteAssessment`、`listAssessments`、类型(Task 3.3);enjoy 组件 `PronunciationAssessmentScoreResult`、`PronunciationAssessmentFulltextResult`、`PronunciationAssessmentScoreIcon`、`WavesurferPlayer`、`formatDateTime`(子路径引入);`AlertDialog*`、`Skeleton`、`Button`。
- Produces:
  - `MobileScoreResult({ scores }: { scores: AssessmentScores })`:包一层 Tailwind 任意变体把桌面三列评分改为单列(`[&_.grid-cols-3]:grid-cols-1 [&_.col-span-2]:col-span-1 [&_.gap-8]:gap-4`),不改 enjoy 源码。testid `assessment-scores`。
  - `AssessmentPage`:testid `assessment-reference`(带 `data-lookup-context`)、`assessment-scores`、`assessment-audio`、`assessment-words`、`assessment-delete`、`assessment-delete-confirm`、`assessment-again`;音频经带鉴权的 `fetch` 取 Blob 后 `URL.createObjectURL`,卸载时 `revokeObjectURL`。
  - `HistoryPage`:testid `assessment-item`(链接到详情)、`history-load-more`、`history-empty`。

- [ ] **Step 1: 写失败测试**

`web/src/features/practice/assessment-page.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import raw from "~/test/fixtures/assessment-good.json";
import { renderWithProviders } from "~/test/render";
import { AssessmentPage } from "./assessment-page";

const REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please.";
const DETAIL = {
  id: "a1", reference_text: REFERENCE, language: "en-US", duration_ms: 3000, created_at: "2026-10-04T00:00:00+00:00",
  scores: { pronunciation_score: raw.pronunciation_score, accuracy_score: raw.accuracy_score, fluency_score: raw.fluency_score, completeness_score: raw.completeness_score },
  result: raw,
};

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:audio-1"), revokeObjectURL: vi.fn() });
});

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  renderWithProviders(<AssessmentPage />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/practice/assessments/a1",
    path: "/practice/assessments/:id",
  });
  return mock;
}

describe("AssessmentPage", () => {
  it("shows scores, words and the authenticated recording", async () => {
    const mock = setup({
      "GET /api/assessments/a1": () => json(DETAIL),
      "GET /api/assessments/a1/audio": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/wav" } }),
    });
    expect(await screen.findByTestId("assessment-reference")).toHaveTextContent(REFERENCE);
    expect(screen.getByTestId("assessment-reference")).toHaveAttribute("data-lookup-context");
    expect(screen.getByTestId("assessment-scores")).toHaveTextContent(String(raw.pronunciation_score));
    expect(screen.getByTestId("assessment-words")).toHaveTextContent(/coffee/i);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const audioCall = mock.calls.find((c) => c.url.pathname.endsWith("/audio"))!;
    expect(audioCall.headers.get("Authorization")).toBe("Bearer t");
  });

  it("deletes after confirmation", async () => {
    const mock = setup({
      "GET /api/assessments/a1": () => json(DETAIL),
      "GET /api/assessments/a1/audio": () => new Response(new Uint8Array([1])),
      "DELETE /api/assessments/a1": () => json({ id: "a1" }),
    });
    await userEvent.click(await screen.findByTestId("assessment-delete"));
    await userEvent.click(await screen.findByTestId("assessment-delete-confirm"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/history"));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("handles missing records and audio", async () => {
    setup({
      "GET /api/assessments/a1": () => json({ error: "Assessment not found" }, 404),
      "GET /api/assessments/a1/audio": () => json({ error: "Assessment not found" }, 404),
    });
    expect(await screen.findByText("This recording does not exist.")).toBeInTheDocument();
  });

  it("practice again carries the reference text", async () => {
    setup({ "GET /api/assessments/a1": () => json(DETAIL), "GET /api/assessments/a1/audio": () => json({ error: "Recording not found" }, 404) });
    expect(await screen.findByText("The recording is unavailable.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("assessment-again"));
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
  });
});
```

`web/src/features/practice/history-page.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { HistoryPage } from "./history-page";

const item = (id: string, text: string) => ({
  id, reference_text: text, language: "en-US", duration_ms: 1000, created_at: "2026-10-04T00:00:00+00:00",
  scores: { pronunciation_score: 75, accuracy_score: 70, fluency_score: 80, completeness_score: 90 },
});

describe("HistoryPage", () => {
  it("lists records and loads more", async () => {
    const mock = createFetchMock({
      "GET /api/assessments": (call) =>
        call.url.searchParams.get("page") === "2"
          ? json({ assessments: [item("a3", "Third")], page: 2, next: null })
          : json({ assessments: [item("a1", "First"), item("a2", "Second")], page: 1, next: 2 }),
    });
    renderWithProviders(<HistoryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/history" });
    expect(await screen.findAllByTestId("assessment-item")).toHaveLength(2);
    expect(screen.getAllByTestId("assessment-item")[0]).toHaveAttribute("href", "/practice/assessments/a1");
    await userEvent.click(screen.getByTestId("history-load-more"));
    expect(await screen.findByText("Third")).toBeInTheDocument();
    expect(screen.queryByTestId("history-load-more")).toBeNull();
  });

  it("shows the empty state", async () => {
    const mock = createFetchMock({ "GET /api/assessments": () => json({ assessments: [], page: 1, next: null }) });
    renderWithProviders(<HistoryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByTestId("history-empty")).toHaveTextContent("No practice yet.");
  });
});
```

- [ ] **Step 2: 运行,确认失败**:`yarn workspace web test src/features/practice` → FAIL。

- [ ] **Step 3: 实现**

`web/src/features/practice/mobile-score-result.tsx`:

```tsx
import { PronunciationAssessmentScoreResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-score-result";
import type { AssessmentScores } from "./assessment-api";

/** 桌面评分视图是三列布局 + 160px 圆环,手机上会横向溢出;用任意变体改成单列,不改 enjoy 源码。 */
export function MobileScoreResult({ scores }: { scores: AssessmentScores }) {
  return (
    <div data-testid="assessment-scores"
      className="overflow-hidden [&_.col-span-2]:col-span-1 [&_.gap-8]:gap-4 [&_.grid-cols-3]:grid-cols-1">
      <PronunciationAssessmentScoreResult
        pronunciationScore={scores.pronunciationScore}
        accuracyScore={scores.accuracyScore}
        fluencyScore={scores.fluencyScore}
        completenessScore={scores.completenessScore}
      />
    </div>
  );
}
```

`web/src/features/practice/assessment-page.tsx`:

```tsx
import { RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { PronunciationAssessmentFulltextResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-fulltext-result";
import { WavesurferPlayer } from "@renderer/components/misc/wavesurfer-player";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { PRACTICE_SERVER_ERRORS, deleteAssessment, getAssessment, getAssessmentAudio, type AssessmentDetail } from "./assessment-api";
import { MobileScoreResult } from "./mobile-score-result";

export function AssessmentPage() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    getAssessment(api, id)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(translateServerError(t, err, PRACTICE_SERVER_ERRORS)));
    getAssessmentAudio(api, id)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      })
      .catch(() => alive && setAudioError(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, id, t]);

  const remove = async () => {
    try {
      await deleteAssessment(api, id);
      navigate("/practice/history", { replace: true });
    } catch (err) {
      setError(translateServerError(t, err, PRACTICE_SERVER_ERRORS));
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.practice.result.title")} back="/practice/history"
        actions={detail && (
          <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="assessment-delete"
            aria-label={t("web.common.delete")} onClick={() => setConfirming(true)}>
            <Trash2Icon className="h-5 w-5" />
          </Button>
        )} />
      {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
      {!detail && !error && <Skeleton className="m-4 h-40" />}
      {detail && (
        <div className="space-y-4 p-4">
          <p data-testid="assessment-reference" data-lookup-context className="select-text text-base leading-relaxed">
            {detail.referenceText}
          </p>
          <MobileScoreResult scores={detail.scores} />
          <div data-testid="assessment-audio">
            {audioUrl ? (
              <WavesurferPlayer id={`assessment-${id}`} src={audioUrl} height={64} setCurrentTime={setCurrentTime} />
            ) : audioError ? (
              <p className="text-sm text-muted-foreground">{t("web.practice.result.audioUnavailable")}</p>
            ) : (
              <Skeleton className="h-16" />
            )}
          </div>
          <div data-testid="assessment-words">
            <PronunciationAssessmentFulltextResult words={detail.result?.detailResult?.words ?? []}
              currentTime={currentTime} src={audioUrl ?? undefined} />
          </div>
          <Button data-testid="assessment-again" className="h-11 w-full"
            onClick={() => navigate("/practice", { state: { reference: detail.referenceText } })}>
            <RotateCcwIcon className="mr-2 h-4 w-4" />{t("web.practice.result.again")}
          </Button>
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("web.practice.result.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("web.practice.result.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="assessment-delete-confirm" className="h-11" onClick={() => void remove()}>
              {t("web.common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

`web/src/features/practice/history-page.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { PronunciationAssessmentScoreIcon } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-score-icon";
import { formatDateTime } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { listAssessments, type AssessmentSummary } from "./assessment-api";

export function HistoryPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<AssessmentSummary[]>([]);
  const [next, setNext] = useState<number | null>(1);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await listAssessments(api, page);
      setItems((prev) => (page === 1 ? res.assessments : [...prev, ...res.assessments]));
      setNext(res.next);
      setError(null);
    } catch (err) {
      setError(translateServerError(t, err));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [api, t]);

  useEffect(() => { void load(1); }, [load]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.practice.historyTitle")} back="/practice" />
      {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
      {loaded && !items.length && !error && (
        <p data-testid="history-empty" className="p-8 text-center text-muted-foreground">{t("web.practice.empty")}</p>
      )}
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            <Link to={`/practice/assessments/${a.id}`} data-testid="assessment-item"
              className="flex min-h-14 items-center gap-3 border-b px-4 py-3">
              <PronunciationAssessmentScoreIcon score={a.scores?.pronunciationScore ?? 0} />
              <div className="min-w-0 flex-1">
                <p className="truncate">{a.referenceText}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {next && loaded && (
        <Button variant="ghost" data-testid="history-load-more" className="m-4 h-11" disabled={loading} onClick={() => void load(next)}>
          {t("web.common.loadMore")}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行**:`yarn workspace web test` → 全部 PASS;typecheck、build 通过。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/practice
git commit -m "feat(web): show assessment results with replay, history and delete" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3.5:跟读评测 E2E

**Files:**
- Create: `web/e2e/practice.spec.ts`

**Interfaces:**
- Consumes:`signIn`、`useFakeMicrophone`、`SPEECH_REFERENCE`(Task 2.8);阶段 3 的 testid;阶段 0 记录的 Chromium 总分(若低于 60,把下面的 `50` 改为「阶段 0 记录值 − 10」并在提交说明里写明)。

- [ ] **Step 1: 写用例** `web/e2e/practice.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { SPEECH_REFERENCE, useFakeMicrophone } from "./support/fake-mic";

test("record, assess with the real service, replay and delete", async ({ page, request, browserName }) => {
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.getByTestId("reference-input").fill(SPEECH_REFERENCE);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "recording");
  await page.waitForTimeout(11_500);
  const assessed = page.waitForResponse(
    (r) => r.url().endsWith("/api/speech/assessments") && r.request().method() === "POST",
    { timeout: 150_000 },
  );
  await page.getByTestId("record-toggle").click();
  const response = await assessed;
  expect(response.status()).toBe(200); // 服务端只接受 16 kHz/单声道/16 位 WAV,200 即格式被接受
  const body = await response.json();
  expect(body.assessment_id).toBeTruthy();
  expect(body.pronunciation_score).toBeGreaterThan(50);
  expect(body.detail_result.words.length).toBeGreaterThan(10);

  await expect(page).toHaveURL(new RegExp(`/practice/assessments/${body.assessment_id}$`));
  await expect(page.getByTestId("assessment-scores")).toBeVisible();
  await expect(page.getByTestId("assessment-words")).toContainText(/country/i);
  const audio = await page.evaluate(async (id) => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    const r = await fetch(`/api/assessments/${id}/audio`, { headers: { Authorization: `Bearer ${token}` } });
    const view = new DataView(await r.arrayBuffer());
    return { status: r.status, rate: view.getUint32(24, true), channels: view.getUint16(22, true), bits: view.getUint16(34, true) };
  }, body.assessment_id);
  expect(audio).toEqual({ status: 200, rate: 16000, channels: 1, bits: 16 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.goto("/practice/history");
  await expect(page.getByTestId("assessment-item")).toHaveCount(1);
  await page.getByTestId("assessment-item").first().click();
  await page.getByTestId("assessment-delete").click();
  await page.getByTestId("assessment-delete-confirm").click();
  await expect(page).toHaveURL(/\/practice\/history$/);
  await expect(page.getByTestId("history-empty")).toBeVisible();
});

test("going to the background keeps what was recorded", async ({ page, request, browserName }) => {
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.getByTestId("reference-input").fill(SPEECH_REFERENCE);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "recording");
  await page.waitForTimeout(3_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "kept");
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }));
  await page.getByTestId("practice-discard").click();
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "idle");
});
```

- [ ] **Step 2: 运行**(E2E 栈按 Task 2.8 Step 5 启动,`--build` 以包含阶段 3 代码):

```bash
yarn workspace web e2e --project=chromium-mobile e2e/practice.spec.ts
yarn workspace web e2e --project=webkit-mobile e2e/practice.spec.ts   # 或按阶段 0 决定在容器中运行 / 记录跳过
docker compose -p enjoy-e2e exec server sh -c 'ls -R /data/recordings | head'   # 删除用例之前的录音目录结构
```

  Expected:两个用例 PASS。若 WebKit 失败且阶段 0 已判定 WebKit 录音不可用,则在该文件里对 WebKit 录音用例加 `test.skip(browserName === "webkit", "<阶段 0 结论>")` 并在提交说明里引用结论文档。

- [ ] **Step 3: 提交**

```bash
git add web/e2e/practice.spec.ts
git commit -m "test(web): cover read-aloud assessment end to end on mobile presets" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3.6(条件任务):AudioWorklet 采集备选

**仅当阶段 0「决定 2」为「是」时执行**(即 Safari/WebKit 下 `MediaRecorder` 产物无法稳定解码)。否则跳过并在门槛 3 中注明「未触发」。

**Files:**
- Create: `web/src/audio/pcm-recorder.ts`
- Modify: `web/src/audio/use-recorder.ts`(选择采集方式)
- Test: `web/src/audio/pcm-recorder.test.ts`

**Interfaces:**
- Consumes:`RecorderEnv`、`RecordingSession`、`RecorderError`、`AUDIO_CONSTRAINTS`(Task 3.2);`encodeWavPcm16`(Task 3.1)。
- Produces:`concatFloat32(chunks: Float32Array[]): Float32Array`;`shouldUsePcmCapture(userAgent: string): boolean`(iOS/iPadOS Safari 与 macOS Safari 返回 true);`startPcmRecording(options): Promise<RecordingSession>`(与 `startRecording` 同一接口与停止语义;结果 Blob 为原生采样率的 `audio/wav`,后续仍走 `toAssessmentWav` 重采样到 16 kHz);`useRecorder` 在 `shouldUsePcmCapture(navigator.userAgent)` 为真且未注入 `env` 时改用 `startPcmRecording`。

- [ ] **Step 1: 写失败测试**:

```ts
import { describe, expect, it } from "vitest";
import { concatFloat32, shouldUsePcmCapture } from "./pcm-recorder";

describe("pcm capture helpers", () => {
  it("concatenates chunks in order", () => {
    expect(Array.from(concatFloat32([new Float32Array([1, 2]), new Float32Array([]), new Float32Array([3])]))).toEqual([1, 2, 3]);
  });
  it("targets Safari only", () => {
    expect(shouldUsePcmCapture("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(shouldUsePcmCapture("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe(true);
    expect(shouldUsePcmCapture("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")).toBe(false);
  });
});
```

- [ ] **Step 2: 实现** `web/src/audio/pcm-recorder.ts`:

```ts
import { encodeWavPcm16 } from "./wav";
import { AUDIO_CONSTRAINTS, RecorderError, browserRecorderEnv, type RecorderEnv, type RecordingResult, type RecordingSession, type StopReason } from "./recorder";

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function shouldUsePcmCapture(userAgent: string): boolean {
  return /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android/.test(userAgent);
}

export async function startPcmRecording(options: { maxDurationMs?: number; env?: RecorderEnv } = {}): Promise<RecordingSession> {
  const env = options.env ?? browserRecorderEnv();
  if (!env.isSecureContext) throw new RecorderError("insecure_context");
  if (!env.getUserMedia || typeof AudioWorkletNode === "undefined") throw new RecorderError("unsupported");
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia(AUDIO_CONSTRAINTS);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    throw new RecorderError(name === "NotAllowedError" || name === "SecurityError" ? "permission_denied" : name === "NotFoundError" ? "no_device" : "failed");
  }
  const ctx = new AudioContext();
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const chunks: Float32Array[] = [];
  node.port.onmessage = (event: MessageEvent<Float32Array>) => chunks.push(event.data);
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination); // 部分浏览器要求节点接到 destination 才会被驱动
  await ctx.resume();

  const startedAt = env.now();
  let stopping = false;
  let timer: unknown;
  let resolveResult!: (r: RecordingResult) => void;
  const result = new Promise<RecordingResult>((resolve) => (resolveResult = resolve));
  const tracks = stream.getTracks();
  const onVisibility = () => env.document.visibilityState === "hidden" && finish("background");
  const onEnded = () => finish("track_ended");
  function finish(reason: StopReason) {
    if (stopping) return;
    stopping = true;
    if (timer !== undefined) env.clearTimeout(timer);
    env.document.removeEventListener("visibilitychange", onVisibility);
    tracks.forEach((t) => { t.removeEventListener?.("ended", onEnded); t.stop(); });
    source.disconnect();
    node.disconnect();
    const samples = concatFloat32(chunks);
    const sampleRate = ctx.sampleRate;
    void ctx.close();
    resolveResult({
      blob: new Blob([encodeWavPcm16(samples, sampleRate)], { type: "audio/wav" }),
      mimeType: "audio/wav",
      durationMs: env.now() - startedAt,
      stoppedBy: reason,
    });
  }
  env.document.addEventListener("visibilitychange", onVisibility);
  tracks.forEach((t) => t.addEventListener?.("ended", onEnded));
  if (options.maxDurationMs) timer = env.setTimeout(() => finish("max_duration"), options.maxDurationMs);
  return { startedAt, result, stop: () => { finish("user"); return result; }, cancel: () => finish("user") };
}
```

  `use-recorder.ts`:`const begin = env ? startRecording : shouldUsePcmCapture(navigator.userAgent) ? startPcmRecording : startRecording;`,`start` 中把 `startRecording(...)` 换成 `begin(...)`。

- [ ] **Step 3: 运行** 单测 + `practice.spec.ts`(WebKit)→ PASS;真机项在 Task 6.2 复核。

- [ ] **Step 4: 提交**

```bash
git add web/src/audio
git commit -m "feat(web): capture raw PCM with AudioWorklet on Safari" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 3

- [ ] `yarn workspace web typecheck && yarn workspace web test && yarn workspace web build` → 通过。
- [ ] Task 3.1 Step 4 的 Python `wave` 检查输出 `16000 1 2 NONE 16000`。
- [ ] E2E 栈(`--build`)上 `practice.spec.ts`:`chromium-mobile` 2 passed;`webkit-mobile` 2 passed 或按阶段 0 结论跳过录音用例(写明原因)。
- [ ] Task 3.6:已执行(附结果)或「未触发」。
- [ ] `git diff --stat f8b48fa5 -- enjoy/` 无输出;`cd server && uv run pytest -q` 0 failed。

---

## 阶段 4:AI 对话

本阶段只改 `web/src/features/chat/`、`web/src/components/markdown.tsx`、`web/e2e/chat.spec.ts`。Task 4.1、4.2 可与阶段 3 并行;**Task 4.3 依赖 Task 3.1–3.2**(裁定 R16)。

### Task 4.1:对话接口封装、请求构造与会话列表

**Files:**
- Create: `web/src/features/chat/{chat-api.ts,chat-request.ts}`, `web/src/features/chat/i18n/{en.json,zh-CN.json}`
- Modify(替换占位): `web/src/features/chat/conversations-page.tsx`
- Test: `web/src/features/chat/chat-api.test.ts`, `web/src/features/chat/chat-request.test.ts`, `web/src/features/chat/conversations-page.test.tsx`

**Interfaces:**
- Consumes:`ApiClient`、`Paged`、`ChatMessageInput`(Task 2.2–2.3);`ServerAiConfig`、`loadServerAiConfig`(Task 2.3);服务端对话接口(Task 1.3)。
- Produces:
  - `~/features/chat/chat-api`:`interface ConversationConfig { systemPrompt: string; model: string; temperature: number; ttsModel: string; ttsVoice: string }`;`interface Conversation { id; name; config: ConversationConfig; createdAt; updatedAt }`;`interface ChatMessage { id; conversationId; role: "user" | "assistant" | "system"; content; createdAt }`;`DEFAULT_CONVERSATION_NAME = "New conversation"`(与服务端一致);`listConversations(api, page = 1, perPage = 20)`、`createConversation(api, { name?, config })`、`getConversation(api, id)`、`updateConversation(api, id, { name?, config? })`、`deleteConversation(api, id)`、`listMessages(api, conversationId): Promise<{ messages: ChatMessage[] }>`、`createMessages(api, conversationId, messages: Array<{ role; content }>): Promise<{ messages: ChatMessage[] }>`、`deleteMessage(api, id)`;`CHAT_SERVER_ERRORS`。
  - `~/features/chat/chat-request`:`DEFAULT_SYSTEM_PROMPT`、`HISTORY_LIMIT = 20`、`defaultConversationConfig(ai: ServerAiConfig | null): ConversationConfig`(温度 0.7)、`withConfigDefaults(config: Partial<ConversationConfig> | undefined, ai): ConversationConfig`、`buildChatMessages(config, history, userText, limit = HISTORY_LIMIT): ChatMessageInput[]`、`titleFrom(text, max = 30): string`、`displayName(conversation, untitled: string): string`。
  - `ConversationsPage`:testid `conversation-new`、`conversation-item`、`conversation-delete`、`conversation-delete-confirm`、`conversations-empty`。

- [ ] **Step 1: 加依赖**:无。

- [ ] **Step 2: 写失败测试**

`web/src/features/chat/chat-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { createConversation, createMessages, deleteConversation, deleteMessage, listConversations, listMessages, updateConversation } from "./chat-api";

const CONFIG = { systemPrompt: "Be brief", model: "gpt-4o", temperature: 0.7, ttsModel: "openai/tts-1", ttsVoice: "alloy" };
const SNAKE = { system_prompt: "Be brief", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };

describe("chat api", () => {
  it("round-trips conversation config through snake_case", async () => {
    const mock = createFetchMock({
      "POST /api/conversations": () => json({ id: "c1", name: "New conversation", config: SNAKE, created_at: "t", updated_at: "t" }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: SNAKE }),
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "DELETE /api/conversations/c1": () => json({ id: "c1" }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const created = await createConversation(api, { config: CONFIG });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ config: SNAKE });
    expect(created.config).toEqual(CONFIG);
    await updateConversation(api, "c1", { name: "Hi" });
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ name: "Hi" });
    await listConversations(api, 3);
    expect(mock.calls[2].url.search).toBe("?page=3&per_page=20");
    expect(await deleteConversation(api, "c1")).toEqual({ id: "c1" });
  });

  it("saves message pairs", async () => {
    const mock = createFetchMock({
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1", conversation_id: "c1", role: "user", content: "Hi" }] }),
      "GET /api/conversations/c1/messages": () => json({ messages: [] }),
      "DELETE /api/messages/m1": () => json({ id: "m1" }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const saved = await createMessages(api, "c1", [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }]);
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] });
    expect(saved.messages[0].conversationId).toBe("c1");
    expect(await listMessages(api, "c1")).toEqual({ messages: [] });
    expect(await deleteMessage(api, "m1")).toEqual({ id: "m1" });
  });
});
```

`web/src/features/chat/chat-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildChatMessages, defaultConversationConfig, displayName, titleFrom, withConfigDefaults, DEFAULT_SYSTEM_PROMPT } from "./chat-request";

const AI = { llmModels: ["gpt-4o"], defaultLlmModel: "gpt-4o", ttsModels: ["openai/tts-1"], voices: {}, defaultTts: { model: "openai/tts-1", voice: "alloy" } };

describe("chat request helpers", () => {
  it("derives defaults from the server config", () => {
    expect(defaultConversationConfig(AI)).toEqual({ systemPrompt: DEFAULT_SYSTEM_PROMPT, model: "gpt-4o", temperature: 0.7, ttsModel: "openai/tts-1", ttsVoice: "alloy" });
    expect(defaultConversationConfig(null)).toMatchObject({ model: "", ttsModel: "", ttsVoice: "" });
    expect(withConfigDefaults({ ttsVoice: "echo", model: undefined }, AI)).toMatchObject({ model: "gpt-4o", ttsVoice: "echo" });
  });

  it("builds system + last 20 turns + the new user message", () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    const out = buildChatMessages({ ...defaultConversationConfig(AI), systemPrompt: "SYS" }, [{ role: "system", content: "old" }, ...history], "new");
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out).toHaveLength(22);
    expect(out[1].content).toBe("m5");
    expect(out.at(-1)).toEqual({ role: "user", content: "new" });
    expect(buildChatMessages({ ...defaultConversationConfig(AI), systemPrompt: "  " }, [], "x")).toEqual([{ role: "user", content: "x" }]);
  });

  it("makes short titles", () => {
    expect(titleFrom("  Hello   there ")).toBe("Hello there");
    expect(titleFrom("x".repeat(40))).toBe(`${"x".repeat(29)}…`);
    expect(displayName({ name: "New conversation" } as never, "Untitled")).toBe("Untitled");
    expect(displayName({ name: "Trip" } as never, "Untitled")).toBe("Trip");
  });
});
```

`web/src/features/chat/conversations-page.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationsPage } from "./conversations-page";

const CONFIG_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const conv = (id: string, name: string) => ({ id, name, config: {}, created_at: "2026-10-04T00:00:00+00:00", updated_at: "2026-10-04T00:00:00+00:00" });

describe("ConversationsPage", () => {
  beforeEach(() => resetServerAiConfigCache());

  it("creates a conversation with server defaults and opens it", async () => {
    const mock = createFetchMock({
      ...CONFIG_ROUTES,
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json(conv("c9", "New conversation")),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    expect(await screen.findByTestId("conversations-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("conversation-new"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c9"));
    const body = JSON.parse(mock.calls.find((c) => c.method === "POST")!.body as string);
    expect(body.config).toMatchObject({ model: "gpt-4o", tts_model: "openai/tts-1", tts_voice: "alloy", temperature: 0.7 });
  });

  it("lists and deletes conversations", async () => {
    const mock = createFetchMock({
      ...CONFIG_ROUTES,
      "GET /api/conversations": () => json({ conversations: [conv("c1", "Trip"), conv("c2", "New conversation")], page: 1, next: null }),
      "DELETE /api/conversations/c1": () => json({ id: "c1" }),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    const items = await screen.findAllByTestId("conversation-item");
    expect(items[0]).toHaveTextContent("Trip");
    expect(items[1]).toHaveTextContent("Untitled conversation");
    await userEvent.click(screen.getAllByTestId("conversation-delete")[0]);
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("conversation-item")).toHaveLength(1));
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/features/chat` → FAIL。

- [ ] **Step 4: 实现**

`web/src/features/chat/chat-api.ts`:

```ts
import type { ApiClient } from "~/api/client";
import type { Paged } from "~/api/types";

export interface ConversationConfig {
  systemPrompt: string;
  model: string;
  temperature: number;
  ttsModel: string;
  ttsVoice: string;
}

export interface Conversation {
  id: string;
  name: string;
  config: ConversationConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export const DEFAULT_CONVERSATION_NAME = "New conversation";

export const CHAT_SERVER_ERRORS: Record<string, string> = {
  "LLM upstream is not configured": "web.chat.errors.notConfigured",
  "Upstream unavailable": "web.chat.errors.upstream",
  "Upstream authentication failed": "web.chat.errors.upstream",
  "Empty AI response": "web.chat.errors.empty",
  "Message limit reached": "web.chat.errors.messageLimit",
  "Conversation limit reached": "web.chat.errors.conversationLimit",
  "Conversation not found": "web.chat.errors.notFound",
  "Whisper upstream is not configured": "web.chat.errors.sttNotConfigured",
  "Unsupported audio format (wav or mp3)": "web.chat.errors.sttFormat",
};

const conversationPath = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

export function listConversations(api: ApiClient, page = 1, perPage = 20): Promise<Paged<"conversations", Conversation>> {
  return api.request("GET", "/api/conversations", { query: { page, per_page: perPage } });
}

export function createConversation(api: ApiClient, input: { name?: string; config: ConversationConfig }): Promise<Conversation> {
  return api.request("POST", "/api/conversations", { json: input });
}

export function getConversation(api: ApiClient, id: string): Promise<Conversation> {
  return api.request("GET", conversationPath(id));
}

export function updateConversation(api: ApiClient, id: string, patch: { name?: string; config?: ConversationConfig }): Promise<Conversation> {
  return api.request("PATCH", conversationPath(id), { json: patch });
}

export function deleteConversation(api: ApiClient, id: string): Promise<{ id: string }> {
  return api.request("DELETE", conversationPath(id));
}

export function listMessages(api: ApiClient, conversationId: string): Promise<{ messages: ChatMessage[] }> {
  return api.request("GET", `${conversationPath(conversationId)}/messages`);
}

export function createMessages(
  api: ApiClient,
  conversationId: string,
  messages: Array<Pick<ChatMessage, "role" | "content">>,
): Promise<{ messages: ChatMessage[] }> {
  return api.request("POST", `${conversationPath(conversationId)}/messages`, { json: { messages } });
}

export function deleteMessage(api: ApiClient, id: string): Promise<{ id: string }> {
  return api.request("DELETE", `/api/messages/${encodeURIComponent(id)}`);
}
```

`web/src/features/chat/chat-request.ts`:

```ts
import type { ChatMessageInput } from "~/api/ai";
import type { ServerAiConfig } from "~/api/server-config";
import { DEFAULT_CONVERSATION_NAME, type ChatMessage, type Conversation, type ConversationConfig } from "./chat-api";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a friendly English conversation partner for a language learner. Reply in natural, simple English " +
  "in no more than three sentences, and end with a short question to keep the conversation going.";
export const HISTORY_LIMIT = 20;

export function defaultConversationConfig(ai: ServerAiConfig | null): ConversationConfig {
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    model: ai?.defaultLlmModel ?? "",
    temperature: 0.7,
    ttsModel: ai?.defaultTts.model ?? "",
    ttsVoice: ai?.defaultTts.voice ?? "",
  };
}

export function withConfigDefaults(config: Partial<ConversationConfig> | undefined, ai: ServerAiConfig | null): ConversationConfig {
  const defined = Object.fromEntries(Object.entries(config ?? {}).filter(([, v]) => v !== undefined && v !== null));
  return { ...defaultConversationConfig(ai), ...defined };
}

export function buildChatMessages(
  config: ConversationConfig,
  history: Array<Pick<ChatMessage, "role" | "content">>,
  userText: string,
  limit = HISTORY_LIMIT,
): ChatMessageInput[] {
  const recent = history.filter((m) => m.role !== "system").slice(-limit);
  return [
    ...(config.systemPrompt.trim() ? [{ role: "system" as const, content: config.systemPrompt }] : []),
    ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userText },
  ];
}

export function titleFrom(text: string, max = 30): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function displayName(conversation: Pick<Conversation, "name">, untitled: string): string {
  return conversation.name === DEFAULT_CONVERSATION_NAME ? untitled : conversation.name;
}
```

`web/src/features/chat/conversations-page.tsx`:

```tsx
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { formatDateTime } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { CHAT_SERVER_ERRORS, createConversation, deleteConversation, listConversations, type Conversation } from "./chat-api";
import { defaultConversationConfig, displayName } from "./chat-request";

export function ConversationsPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Conversation[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (page: number) => {
    try {
      const res = await listConversations(api, page);
      setItems((prev) => (page === 1 ? res.conversations : [...prev, ...res.conversations]));
      setNext(res.next);
    } catch (err) {
      setError(translateServerError(t, err, CHAT_SERVER_ERRORS));
    } finally {
      setLoaded(true);
    }
  }, [api, t]);

  useEffect(() => { void load(1); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const ai = await loadServerAiConfig(api).catch(() => null);
      const created = await createConversation(api, { config: defaultConversationConfig(ai) });
      navigate(`/chat/${created.id}`);
    } catch (err) {
      setError(translateServerError(t, err, CHAT_SERVER_ERRORS));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (conversation: Conversation) => {
    try {
      await deleteConversation(api, conversation.id);
      setItems((prev) => prev.filter((c) => c.id !== conversation.id));
    } catch (err) {
      setError(translateServerError(t, err, CHAT_SERVER_ERRORS));
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.chat.title")} actions={
        <Button data-testid="conversation-new" className="mr-1 h-11" disabled={creating} onClick={() => void create()}>
          <PlusIcon className="mr-1 h-4 w-4" />{t("web.chat.new")}
        </Button>
      } />
      {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
      {loaded && !items.length && !error && (
        <p data-testid="conversations-empty" className="p-8 text-center text-muted-foreground">{t("web.chat.empty")}</p>
      )}
      <ul>
        {items.map((c) => (
          <li key={c.id} className="flex items-center border-b">
            <Link to={`/chat/${c.id}`} data-testid="conversation-item" className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-2">
              <span className="truncate">{displayName(c, t("web.chat.untitled"))}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(c.updatedAt)}</span>
            </Link>
            <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-delete"
              aria-label={t("web.common.delete")} onClick={() => setPendingDelete(c)}>
              <Trash2Icon className="h-5 w-5" />
            </Button>
          </li>
        ))}
      </ul>
      {next && <Button variant="ghost" className="m-4 h-11" onClick={() => void load(next)}>{t("web.common.loadMore")}</Button>}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("web.chat.deleteConfirm")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="conversation-delete-confirm" className="h-11"
              onClick={() => pendingDelete && void remove(pendingDelete)}>{t("web.common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

`web/src/features/chat/i18n/en.json`(整个阶段 4 的文案):

```json
{
  "web": {
    "chat": {
      "title": "Chat", "new": "New", "empty": "No conversations yet. Start one!", "untitled": "Untitled conversation",
      "deleteConfirm": "Delete this conversation and its messages?", "placeholder": "Message in English…",
      "send": "Send", "settings": "Conversation settings", "notSaved": "The reply was shown but could not be saved.",
      "noSpeech": "No speech was recognized.", "mic": "Speak instead of typing", "transcribing": "Transcribing…",
      "speak": "Read aloud", "stopSpeaking": "Stop", "speakFailed": "Could not play the reply.",
      "settingsForm": { "systemPrompt": "Role / instructions", "model": "Model", "ttsModel": "Voice model", "voice": "Voice", "save": "Save", "serverDefault": "Server default" },
      "errors": {
        "notConfigured": "The AI service is not configured on the server.", "upstream": "The AI service is unavailable. Please try again.",
        "empty": "The AI returned an empty reply.", "messageLimit": "This conversation is full. Start a new one.",
        "conversationLimit": "You have too many conversations. Delete some first.", "notFound": "This conversation does not exist.",
        "sttNotConfigured": "Speech-to-text is not configured on the server.", "sttFormat": "The recording format was not accepted."
      }
    }
  }
}
```

`web/src/features/chat/i18n/zh-CN.json`:

```json
{
  "web": {
    "chat": {
      "title": "对话", "new": "新建", "empty": "还没有对话,开始一个吧!", "untitled": "未命名对话",
      "deleteConfirm": "删除这个对话及其消息?", "placeholder": "用英文输入…",
      "send": "发送", "settings": "对话设置", "notSaved": "回复已显示,但未能保存。",
      "noSpeech": "没有识别到语音。", "mic": "说话代替打字", "transcribing": "正在转写…",
      "speak": "朗读", "stopSpeaking": "停止", "speakFailed": "无法播放回复。",
      "settingsForm": { "systemPrompt": "角色 / 指令", "model": "模型", "ttsModel": "语音模型", "voice": "音色", "save": "保存", "serverDefault": "服务器默认" },
      "errors": {
        "notConfigured": "服务器未配置 AI 服务。", "upstream": "AI 服务暂不可用,请重试。",
        "empty": "AI 返回了空回复。", "messageLimit": "这个对话的消息已满,请新建对话。",
        "conversationLimit": "对话数量已达上限,请先删除一些。", "notFound": "这个对话不存在。",
        "sttNotConfigured": "服务器未配置语音转文字。", "sttFormat": "录音格式未被服务器接受。"
      }
    }
  }
}
```

- [ ] **Step 5: 运行**:`yarn workspace web test src/features/chat` → PASS;typecheck 通过。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/chat
git commit -m "feat(web): list, create and delete persisted conversations" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4.2:会话页:流式回复、保存、Markdown 与设置

**Files:**
- Create: `web/src/components/markdown.tsx`, `web/src/features/chat/{message-bubble.tsx,conversation-settings-sheet.tsx}`
- Modify(替换占位): `web/src/features/chat/conversation-page.tsx`
- Test: `web/src/features/chat/conversation-page.test.tsx`, `web/src/components/markdown.test.tsx`

**Interfaces:**
- Consumes:`streamChatCompletion`(Task 2.3);`chat-api`、`chat-request`(Task 4.1);`loadServerAiConfig`、`voicesFor`;`Sheet*`、`Textarea`、`Button`。
- Produces:
  - `MarkdownText({ content, className? })`(react-markdown + remark-gfm,不渲染原始 HTML,链接新窗口打开)。
  - `type UiMessage = { key: string; id?: string; role: "user" | "assistant"; content: string; status: "done" | "streaming" | "error" }`;`MessageBubble({ message, onRetry?, actions? })`:testid `message-user` / `message-assistant`(`data-status`)、`message-retry`;正文容器带 `data-lookup-context` 与 `select-text`。
  - `ConversationSettingsSheet({ open, onOpenChange, config, ai, onSave })`:testid `settings-system-prompt`、`settings-model`、`settings-tts-model`、`settings-tts-voice`、`settings-save`。
  - `ConversationPage({ recorderEnv? })`:testid `message-list`、`chat-input`、`chat-send`、`conversation-settings`;发送流程:乐观追加用户消息与流式占位 → 流式完成后 `createMessages` 成对保存 → 默认名对话以首句 `titleFrom` 改名;流式失败显示错误气泡与重试,**不保存**;保存失败 toast `web.chat.notSaved`;离开页面中止流。Task 4.3 在此组件上加麦克风与朗读。

- [ ] **Step 1: 加依赖**:`yarn workspace web add react-markdown@^9.1.0 remark-gfm@^4.0.1`

- [ ] **Step 2: 写失败测试**

`web/src/components/markdown.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./markdown";

describe("MarkdownText", () => {
  it("renders GFM and never raw HTML", () => {
    render(<MarkdownText content={"**bold** and a [link](https://example.com)\n\n| a |\n|---|\n| 1 |\n\n<img src=x onerror=alert(1)>"} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
```

`web/src/features/chat/conversation-page.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationPage } from "./conversation-page";

const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), {
    headers: { "Content-Type": "text/event-stream" },
  });
};
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o-mini", "gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy", "echo"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    "GET /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: CONFIG }),
    "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier **reply**" }] }),
    ...extra,
  };
}

function setup(r: Record<string, Handler>) {
  const mock = createFetchMock(r);
  renderWithProviders(<ConversationPage />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/chat/c1",
    path: "/chat/:id",
  });
  return mock;
}

describe("ConversationPage", () => {
  beforeEach(() => resetServerAiConfigCache());

  it("streams a reply, saves the pair and names the conversation", async () => {
    const mock = setup(routes({
      "POST /api/ai/chat/completions": () => sse([delta("Hello "), delta("there!"), "data: [DONE]\n\n"]),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1", role: "user", content: "Hi" }, { id: "m2", role: "assistant", content: "Hello there!" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
    }));
    expect(await screen.findByText("reply")).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    const chat = JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/ai/chat/completions")!.body as string);
    expect(chat).toMatchObject({ model: "gpt-4o", temperature: 0.7, stream: true });
    expect(chat.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "assistant", content: "Earlier **reply**" },
      { role: "user", content: "Hi" },
    ]);
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    const saved = JSON.parse(mock.calls.find((c) => c.url.pathname.endsWith("/messages") && c.method === "POST")!.body as string);
    expect(saved).toEqual({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello there!" }] });
    expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string)).toEqual({ name: "Hi" });
    expect(screen.getAllByTestId("message-user").at(-1)!.querySelector("[data-lookup-context]")).not.toBeNull();
  });

  it("shows an error bubble without saving, and retries", async () => {
    let attempt = 0;
    const mock = setup(routes({
      "POST /api/ai/chat/completions": () => (++attempt === 1 ? sse(['data: {"error": "Upstream unavailable"}\n\n']) : sse([delta("OK"), "data: [DONE]\n\n"])),
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: CONFIG }),
    }));
    await screen.findByText("reply");
    await userEvent.type(screen.getByTestId("chat-input"), "Hi");
    await userEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("The AI service is unavailable. Please try again.")).toBeInTheDocument();
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/messages") && c.method === "POST")).toBe(false);
    await userEvent.click(screen.getByTestId("message-retry"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("OK"));
    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
  });

  it("saves conversation settings", async () => {
    const mock = setup(routes({ "PATCH /api/conversations/c1": () => json({ id: "c1", name: "New conversation", config: { ...CONFIG, tts_voice: "echo" } }) }));
    await screen.findByText("reply");
    await userEvent.click(screen.getByTestId("conversation-settings"));
    await waitFor(() => expect(screen.getByTestId("settings-tts-voice").querySelectorAll("option")).toHaveLength(2));
    await userEvent.selectOptions(screen.getByTestId("settings-tts-voice"), "echo");
    await userEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.method === "PATCH")!.body as string).config).toMatchObject({ tts_voice: "echo", system_prompt: "SYS" });
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/features/chat src/components` → FAIL。

- [ ] **Step 4: 实现**

`web/src/components/markdown.tsx`:

```tsx
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@renderer/lib/utils";

/** 轻量 Markdown(桌面的 markdown-wrapper 依赖 EnjoyApp,不能复用)。不启用原始 HTML。 */
export function MarkdownText({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("prose prose-sm max-w-none break-words dark:prose-invert", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" /> }}
      >
        {content}
      </Markdown>
    </div>
  );
}
```

`web/src/features/chat/message-bubble.tsx`:

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { MarkdownText } from "~/components/markdown";

export interface UiMessage {
  key: string;
  id?: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "streaming" | "error";
}

export function MessageBubble({ message, onRetry, actions }: { message: UiMessage; onRetry?: () => void; actions?: ReactNode }) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  return (
    <div data-testid={isUser ? "message-user" : "message-assistant"} data-status={message.status}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-3 py-2 text-base",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        message.status === "error" && "border border-destructive bg-background text-destructive",
      )}>
        <div data-lookup-context className="select-text">
          {isUser || message.status === "error" ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownText content={message.content || "…"} />
          )}
        </div>
        {!isUser && message.status === "done" && actions}
        {message.status === "error" && onRetry && (
          <Button variant="link" data-testid="message-retry" className="h-11 px-0" onClick={onRetry}>{t("web.common.retry")}</Button>
        )}
      </div>
    </div>
  );
}
```

`web/src/features/chat/conversation-settings-sheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { Textarea } from "@renderer/components/ui/textarea";
import { voicesFor, type ServerAiConfig } from "~/api/server-config";
import type { ConversationConfig } from "./chat-api";

const selectClass = "h-11 w-full rounded-md border bg-background px-3 text-base";

export function ConversationSettingsSheet({ open, onOpenChange, config, ai, onSave }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  config: ConversationConfig;
  ai: ServerAiConfig | null;
  onSave(next: ConversationConfig): Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setDraft(config); }, [open, config]);
  const voices = ai ? voicesFor(ai, draft.ttsModel) : [];

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader><SheetTitle className="text-left">{t("web.chat.settings")}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.systemPrompt")}</span>
            <Textarea data-testid="settings-system-prompt" rows={4} className="text-base" value={draft.systemPrompt}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.model")}</span>
            <select data-testid="settings-model" className={selectClass} value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
              <option value="">{t("web.chat.settingsForm.serverDefault")}</option>
              {(ai?.llmModels ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.ttsModel")}</span>
            <select data-testid="settings-tts-model" className={selectClass} value={draft.ttsModel}
              onChange={(e) => {
                const ttsModel = e.target.value;
                const first = ai ? voicesFor(ai, ttsModel)[0]?.value ?? "" : "";
                setDraft({ ...draft, ttsModel, ttsVoice: first });
              }}>
              {(ai?.ttsModels ?? [draft.ttsModel]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("web.chat.settingsForm.voice")}</span>
            <select data-testid="settings-tts-voice" className={selectClass} value={draft.ttsVoice}
              onChange={(e) => setDraft({ ...draft, ttsVoice: e.target.value })}>
              {voices.length ? voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)
                : <option value={draft.ttsVoice}>{draft.ttsVoice}</option>}
            </select>
          </label>
          <Button data-testid="settings-save" className="h-11 w-full" disabled={saving} onClick={() => void save()}>
            {t("web.chat.settingsForm.save")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

`web/src/features/chat/conversation-page.tsx`:

```tsx
import { SendIcon, Settings2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { streamChatCompletion } from "~/api/ai";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import {
  CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME, createMessages, getConversation, listMessages, updateConversation,
  type Conversation, type ConversationConfig,
} from "./chat-api";
import { buildChatMessages, displayName, titleFrom, withConfigDefaults } from "./chat-request";
import { ConversationSettingsSheet } from "./conversation-settings-sheet";
import { MessageBubble, type UiMessage } from "./message-bubble";

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${++keySeq}`;

export function ConversationPage({ recorderEnv: _recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const { t } = useTranslation();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => alive && setAi(c)).catch(() => undefined);
    Promise.all([getConversation(api, id), listMessages(api, id)])
      .then(([c, list]) => {
        if (!alive) return;
        setConversation(c);
        setMessages(list.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ key: m.id, id: m.id, role: m.role as "user" | "assistant", content: m.content, status: "done" })));
      })
      .catch((err) => alive && setLoadError(translateServerError(t, err, CHAT_SERVER_ERRORS)));
    return () => { alive = false; };
  }, [api, id, t]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  const config: ConversationConfig = withConfigDefaults(conversation?.config, ai);

  const send = useCallback(async (text: string, base: UiMessage[]) => {
    const content = text.trim();
    if (!content || !conversation) return;
    const history = base.filter((m) => m.status === "done").map(({ role, content: c }) => ({ role, content: c }));
    const userKey = nextKey("u");
    const botKey = nextKey("a");
    setMessages([...base, { key: userKey, role: "user", content, status: "done" },
      { key: botKey, role: "assistant", content: "", status: "streaming" }]);
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const patch = (key: string, change: Partial<UiMessage>) =>
      setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, ...change } : m)));
    let reply = "";
    try {
      reply = await streamChatCompletion(api,
        { messages: buildChatMessages(config, history, content), model: config.model, temperature: config.temperature },
        (full) => patch(botKey, { content: full }), controller.signal);
      if (!reply.trim()) throw new ApiError(502, "Empty AI response");
      patch(botKey, { content: reply, status: "done" });
    } catch (err) {
      if (!controller.signal.aborted) patch(botKey, { status: "error", content: translateServerError(t, err, CHAT_SERVER_ERRORS) });
      setSending(false);
      return;
    }
    setSending(false);
    try {
      const saved = await createMessages(api, conversation.id, [{ role: "user", content }, { role: "assistant", content: reply }]);
      patch(userKey, { id: saved.messages[0]?.id });
      patch(botKey, { id: saved.messages[1]?.id });
      if (conversation.name === DEFAULT_CONVERSATION_NAME) {
        setConversation(await updateConversation(api, conversation.id, { name: titleFrom(content) }));
      }
    } catch {
      toast.error(t("web.chat.notSaved"));
    }
  }, [api, config, conversation, t]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const text = input;
    setInput("");
    void send(text, messages);
  };

  const retry = (botKey: string) => {
    const index = messages.findIndex((m) => m.key === botKey);
    const user = messages[index - 1];
    if (!user || user.role !== "user") return;
    void send(user.content, messages.slice(0, index - 1));
  };

  const saveSettings = async (next: ConversationConfig) => {
    setConversation(await updateConversation(api, id, { config: next }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={conversation ? displayName(conversation, t("web.chat.untitled")) : t("web.common.loading")} back="/chat"
        actions={
          <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-settings"
            aria-label={t("web.chat.settings")} onClick={() => setSettingsOpen(true)}>
            <Settings2Icon className="h-5 w-5" />
          </Button>
        } />
      {loadError && <p role="alert" className="p-4 text-sm text-destructive">{loadError}</p>}
      <div ref={listRef} data-testid="message-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m.key} message={m} onRetry={m.status === "error" ? () => retry(m.key) : undefined} />
        ))}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t bg-background p-2">
        <Textarea data-testid="chat-input" rows={1} value={input} placeholder={t("web.chat.placeholder")}
          className="max-h-40 min-h-11 flex-1 resize-none text-base" onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" data-testid="chat-send" size="icon" className="h-11 w-11 shrink-0"
          aria-label={t("web.chat.send")} disabled={!input.trim() || sending || !conversation}>
          <SendIcon className="h-5 w-5" />
        </Button>
      </form>
      <ConversationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} config={config} ai={ai} onSave={saveSettings} />
    </div>
  );
}
```

- [ ] **Step 5: 运行**:`yarn workspace web test` → PASS;typecheck、build 通过。

- [ ] **Step 6: 提交**

```bash
git add web/package.json yarn.lock web/src/components web/src/features/chat
git commit -m "feat(web): stream AI replies and persist conversation messages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4.3:语音输入(转写)与回复朗读(TTS)

**Files:**
- Create: `web/src/features/chat/{speech-api.ts,tts.ts,use-tts-player.ts,voice-input-button.tsx}`
- Modify: `web/src/features/chat/conversation-page.tsx`
- Test: `web/src/features/chat/speech-api.test.ts`, `web/src/features/chat/tts.test.ts`, `web/src/features/chat/use-tts-player.test.tsx`, `web/src/features/chat/voice-input-button.test.tsx`

**Interfaces:**
- Consumes:`useRecorder`、`toAssessmentWav`、`describeAudioError`、`encodeWavPcm16`、`RecorderEnv`(Task 3.1–3.2);`ConversationPage`、`MessageBubble`、`CHAT_SERVER_ERRORS`(Task 4.1–4.2)。
- Produces:
  - `~/features/chat/speech-api`:`transcribe(api, wav: Blob, language = "en"): Promise<{ text: string }>`(multipart `file`=`recording.wav`、`model`=`whisper-1`、`language`、`response_format`=`json`;超时 300 s;服务端 chat 模式按魔数接受 wav);`synthesizeSpeech(api, { input, model, voice }): Promise<Blob>`(`POST /api/ai/audio/speech`,超时 120 s)。
  - `~/features/chat/tts`:`ttsKey(model, voice, text)`、`class TtsCache(max = 50, urls?)`(LRU,淘汰时 `revokeObjectURL`;`get(key)`、`set(key, blob): string`)、`speakableText(markdown): string`(去 Markdown 记号,截断到 4096 字符)、`sharedTtsCache`。
  - `~/features/chat/use-tts-player`:`type TtsState = "idle" | "loading" | "playing" | "error"`;`useTtsPlayer(api, { cache?, createAudio? }): { states: Record<string, TtsState>; play(messageKey, text, model, voice): Promise<void>; stop(): void }`(同一条再点即停止;点击时先同步"解锁"音频元素以满足 iOS 的手势要求)。
  - `VoiceInputButton({ onText, disabled?, recorderEnv? })`:testid `chat-mic`,`data-state` ∈ `idle|recording|transcribing`。
  - 会话页:每条完成的助手消息有 `message-tts` 按钮(`data-state` 为 `TtsState`);识别文本追加到输入框。

- [ ] **Step 1: 写失败测试**

`web/src/features/chat/speech-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { synthesizeSpeech, transcribe } from "./speech-api";

describe("speech api", () => {
  it("transcribes a WAV via the server whisper endpoint", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: "hello", segments: [] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await transcribe(api, new Blob(["RIFF"], { type: "audio/wav" }))).toMatchObject({ text: "hello" });
    const form = mock.calls[0].body as FormData;
    expect((form.get("file") as File).name).toBe("recording.wav");
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("en");
    expect(form.get("response_format")).toBe("json");
  });
  it("synthesizes speech as a blob", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/mpeg" } }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await synthesizeSpeech(api, { input: "Hi", model: "openai/tts-1", voice: "alloy" })).size).toBe(2);
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ input: "Hi", model: "openai/tts-1", voice: "alloy" });
  });
});
```

`web/src/features/chat/tts.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { TtsCache, speakableText, ttsKey } from "./tts";

describe("tts helpers", () => {
  it("evicts least recently used urls and revokes them", () => {
    let n = 0;
    const urls = { create: vi.fn(() => `blob:${++n}`), revoke: vi.fn() };
    const cache = new TtsCache(2, urls);
    cache.set("a", new Blob(["a"]));
    cache.set("b", new Blob(["b"]));
    expect(cache.get("a")).toBe("blob:1");
    cache.set("c", new Blob(["c"]));
    expect(urls.revoke).toHaveBeenCalledWith("blob:2");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.set("a", new Blob(["x"]))).toBe("blob:1");
  });
  it("strips markdown before speaking", () => {
    expect(speakableText("# Title\n**Bold** `code` [link](http://x) and _it_\n- item\n```js\nx()\n```")).toBe("Title Bold code link and it item");
    expect(speakableText("x".repeat(5000))).toHaveLength(4096);
  });
  it("keys by model, voice and text", () => {
    expect(ttsKey("m", "v", "t")).not.toBe(ttsKey("m", "v2", "t"));
  });
});
```

`web/src/features/chat/use-tts-player.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TtsCache } from "./tts";
import { useTtsPlayer } from "./use-tts-player";

function fakeAudio() {
  return { src: "", play: vi.fn(() => Promise.resolve()), pause: vi.fn(), onended: null as null | (() => void) } as unknown as HTMLAudioElement;
}

describe("useTtsPlayer", () => {
  it("fetches once, then plays from the cache", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const audio = fakeAudio();
    const cache = new TtsCache(5, { create: () => "blob:1", revoke: () => {} });
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache, createAudio: () => audio }));
    await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
    expect(result.current.states.m1).toBe("playing");
    act(() => (audio.onended as () => void)());
    expect(result.current.states.m1).toBe("idle");
    await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/speech")).toHaveLength(1);
  });
  it("toggles off and reports errors", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => json({ error: "Upstream unavailable" }, 502) });
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache: new TtsCache(5, { create: () => "blob:x", revoke: () => {} }), createAudio: fakeAudio }));
    await act(() => result.current.play("m2", "Hi", "openai/tts-1", "alloy"));
    expect(result.current.states.m2).toBe("error");
  });
});
```

`web/src/features/chat/voice-input-button.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { VoiceInputButton } from "./voice-input-button";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

describe("VoiceInputButton", () => {
  it("records, transcribes and hands back the text", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: " Ask not what your country can do " }) });
    const onText = vi.fn();
    const fake = createFakeRecorderEnv();
    renderWithProviders(<VoiceInputButton onText={onText} recorderEnv={fake.env} />, {
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    });
    await userEvent.click(screen.getByTestId("chat-mic"));
    expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
    await userEvent.click(screen.getByTestId("chat-mic"));
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Ask not what your country can do"));
    expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
  });
});
```

- [ ] **Step 2: 运行,确认失败**:`yarn workspace web test src/features/chat` → FAIL。

- [ ] **Step 3: 实现**

`web/src/features/chat/speech-api.ts`:

```ts
import type { ApiClient } from "~/api/client";

export function transcribe(api: ApiClient, wav: Blob, language = "en"): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", new File([wav], "recording.wav", { type: "audio/wav" }));
  form.append("model", "whisper-1");
  form.append("language", language);
  form.append("response_format", "json");
  return api.request("POST", "/api/ai/audio/transcriptions", { form, timeoutMs: 300_000 });
}

export function synthesizeSpeech(api: ApiClient, params: { input: string; model: string; voice: string }): Promise<Blob> {
  return api.request("POST", "/api/ai/audio/speech", { json: params, as: "blob", timeoutMs: 120_000 });
}
```

`web/src/features/chat/tts.ts`:

```ts
export const MAX_TTS_INPUT = 4096;

export function ttsKey(model: string, voice: string, text: string): string {
  return [model, voice, text].join("\u0000");
}

interface UrlFactory {
  create(blob: Blob): string;
  revoke(url: string): void;
}

/** 朗读音频只缓存在内存里(设计文档 4.1:TTS 第一版不落盘)。 */
export class TtsCache {
  private readonly map = new Map<string, string>();
  constructor(
    private readonly max = 50,
    private readonly urls: UrlFactory = { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) },
  ) {}

  get(key: string): string | undefined {
    const url = this.map.get(key);
    if (url) {
      this.map.delete(key);
      this.map.set(key, url);
    }
    return url;
  }

  set(key: string, blob: Blob): string {
    const existing = this.get(key);
    if (existing) return existing;
    const url = this.urls.create(blob);
    this.map.set(key, url);
    while (this.map.size > this.max) {
      const [oldKey, oldUrl] = this.map.entries().next().value as [string, string];
      this.map.delete(oldKey);
      this.urls.revoke(oldUrl);
    }
    return url;
  }
}

export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TTS_INPUT);
}

export const sharedTtsCache = new TtsCache();
```

`web/src/features/chat/use-tts-player.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "~/api/client";
import { encodeWavPcm16 } from "~/audio/wav";
import { synthesizeSpeech } from "./speech-api";
import { TtsCache, sharedTtsCache, speakableText, ttsKey } from "./tts";

export type TtsState = "idle" | "loading" | "playing" | "error";

let silentUrl: string | null = null;
function silentWavUrl(): string {
  silentUrl ??= URL.createObjectURL(new Blob([encodeWavPcm16(new Float32Array(160), 16000)], { type: "audio/wav" }));
  return silentUrl;
}

export function useTtsPlayer(
  api: ApiClient,
  { cache = sharedTtsCache, createAudio = () => new Audio() }: { cache?: TtsCache; createAudio?: () => HTMLAudioElement } = {},
) {
  const [states, setStates] = useState<Record<string, TtsState>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentRef = useRef<string | null>(null);
  const setState = (key: string, state: TtsState) => setStates((prev) => ({ ...prev, [key]: state }));

  const audio = () => (audioRef.current ??= createAudio());

  const stop = useCallback(() => {
    audioRef.current?.pause();
    if (currentRef.current) setState(currentRef.current, "idle");
    currentRef.current = null;
  }, []);

  const play = useCallback(async (messageKey: string, text: string, model: string, voice: string) => {
    if (currentRef.current === messageKey) return stop();
    stop();
    currentRef.current = messageKey;
    setState(messageKey, "loading");
    const element = audio();
    // iOS:在点击的同步阶段先播放一段静音,解锁这个 <audio>,之后异步拿到数据再播放才不会被拦截。
    try {
      element.src = silentWavUrl();
      void element.play()?.catch(() => undefined);
    } catch {
      /* jsdom 等环境没有 createObjectURL */
    }
    const input = speakableText(text);
    try {
      const key = ttsKey(model, voice, input);
      const url = cache.get(key) ?? cache.set(key, await synthesizeSpeech(api, { input, model, voice }));
      if (currentRef.current !== messageKey) return;
      element.src = url;
      element.onended = () => {
        if (currentRef.current === messageKey) {
          currentRef.current = null;
          setState(messageKey, "idle");
        }
      };
      await element.play();
      setState(messageKey, "playing");
    } catch {
      if (currentRef.current === messageKey) currentRef.current = null;
      setState(messageKey, "error");
    }
  }, [api, cache, stop]);

  useEffect(() => () => audioRef.current?.pause(), []);
  return { states, play, stop };
}
```

`web/src/features/chat/voice-input-button.tsx`:

```tsx
import { LoaderIcon, MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import { CHAT_SERVER_ERRORS } from "./chat-api";
import { transcribe } from "./speech-api";

export function VoiceInputButton({ onText, disabled, recorderEnv }: { onText(text: string): void; disabled?: boolean; recorderEnv?: RecorderEnv }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handle = async (recording: RecordingResult) => {
    setBusy(true);
    try {
      const { wav } = await toAssessmentWav(recording.blob);
      const { text } = await transcribe(api, wav, "en");
      if (text?.trim()) onText(text.trim());
      else toast.info(t("web.chat.noSpeech"));
    } catch (err) {
      toast.error(describeAudioError(t, err, CHAT_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  const recorder = useRecorder({ env: recorderEnv, onAutoStop: (r) => void handle(r) });
  useEffect(() => {
    if (recorder.error) toast.error(describeAudioError(t, recorder.error));
  }, [recorder.error, t]);

  const state = busy ? "transcribing" : recorder.state === "recording" ? "recording" : "idle";
  return (
    <Button type="button" data-testid="chat-mic" data-state={state} size="icon"
      variant={state === "recording" ? "destructive" : "ghost"} className="h-11 w-11 shrink-0"
      disabled={disabled || busy || recorder.state === "starting"}
      aria-label={state === "recording" ? t("web.recorder.stop") : state === "transcribing" ? t("web.chat.transcribing") : t("web.chat.mic")}
      onClick={async () => {
        if (recorder.state === "recording") {
          const result = await recorder.stop();
          if (result) await handle(result);
        } else {
          await recorder.start();
        }
      }}>
      {busy ? <LoaderIcon className="h-5 w-5 animate-spin" /> : state === "recording" ? <SquareIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
    </Button>
  );
}
```

  `conversation-page.tsx` 的改动:
  - 参数改为 `{ recorderEnv }`(去掉下划线别名),import `VoiceInputButton`、`useTtsPlayer`、`Volume2Icon, LoaderIcon, SquareIcon`;
  - 组件内 `const tts = useTtsPlayer(api);`;
  - 表单里在 `Textarea` 之前插入 `<VoiceInputButton recorderEnv={recorderEnv} disabled={sending} onText={(text) => setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))} />`;
  - `MessageBubble` 传入 `actions`:

```tsx
actions={
  <Button variant="ghost" size="sm" data-testid="message-tts" data-state={tts.states[m.key] ?? "idle"}
    className="mt-1 h-11 px-2" aria-label={tts.states[m.key] === "playing" ? t("web.chat.stopSpeaking") : t("web.chat.speak")}
    onClick={() => void tts.play(m.key, m.content, config.ttsModel, config.ttsVoice)}>
    {tts.states[m.key] === "loading" ? <LoaderIcon className="h-4 w-4 animate-spin" />
      : tts.states[m.key] === "playing" ? <SquareIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
  </Button>
}
```

  - 在 `conversation-page.test.tsx` 追加一个用例:渲染后历史助手消息上存在 `message-tts`,`data-state="idle"`。

- [ ] **Step 4: 运行**:`yarn workspace web test` → PASS;typecheck、build 通过。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat
git commit -m "feat(web): add voice input via server whisper and read-aloud replies" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4.4:AI 对话 E2E

**Files:**
- Create: `web/e2e/chat.spec.ts`

**Interfaces:**
- Consumes:`signIn`、`useFakeMicrophone`(Task 2.8);阶段 4 的 testid;真实上游(LLM、TTS、Whisper)。

- [ ] **Step 1: 写用例** `web/e2e/chat.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { useFakeMicrophone } from "./support/fake-mic";

test("chat: stream, persist, read aloud, dictate and delete", async ({ page, request, browserName }) => {
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  const streamed = page.waitForResponse((r) => r.url().endsWith("/api/ai/chat/completions"));
  await page.getByTestId("chat-input").fill("Hi! Please reply with one short sentence about the weather.");
  await page.getByTestId("chat-send").click();
  expect((await streamed).headers()["content-type"]).toContain("text/event-stream");
  const reply = page.getByTestId("message-assistant").last();
  await expect(reply).toHaveAttribute("data-status", "done", { timeout: 90_000 });
  await expect(reply).not.toBeEmpty();

  await page.reload();
  await expect(page.getByTestId("message-user")).toHaveCount(1);
  await expect(page.getByTestId("message-assistant")).toHaveCount(1);

  const speech = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/speech"), { timeout: 60_000 });
  await page.getByTestId("message-tts").first().click();
  const speechResponse = await speech;
  expect(speechResponse.status()).toBe(200);
  expect(speechResponse.headers()["content-type"]).toMatch(/^audio\//);
  await expect(page.getByTestId("message-tts").first()).not.toHaveAttribute("data-state", "error");

  await page.getByTestId("chat-mic").click();
  await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
  await page.waitForTimeout(5_000);
  const transcription = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/transcriptions"), { timeout: 120_000 });
  await page.getByTestId("chat-mic").click();
  expect((await transcription).status()).toBe(200);
  await expect(page.getByTestId("chat-input")).toHaveValue(/fellow|americans|country|ask/i);

  await page.getByTestId("nav-chat").click();
  await expect(page.getByTestId("conversation-item")).toHaveCount(1);
  await page.getByTestId("conversation-delete").first().click();
  await page.getByTestId("conversation-delete-confirm").click();
  await expect(page.getByTestId("conversations-empty")).toBeVisible();
});

test("composer stays visible on a phone-sized screen", async ({ page, request }) => {
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("chat-input").focus();
  const input = await page.getByTestId("chat-input").boundingBox();
  const viewport = page.viewportSize()!;
  expect(input!.y + input!.height).toBeLessThanOrEqual(viewport.height);
  const fontSize = await page.getByTestId("chat-input").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});
```

- [ ] **Step 2: 运行**(E2E 栈 `--build`):两个项目各 2 passed(WebKit 录音部分按阶段 0 结论处理)。

- [ ] **Step 3: 提交**

```bash
git add web/e2e/chat.spec.ts
git commit -m "test(web): cover streaming chat, TTS and dictation end to end" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 4

- [ ] `yarn workspace web typecheck && yarn workspace web test && yarn workspace web build` → 通过。
- [ ] E2E 栈上 `chat.spec.ts` 在两个项目上通过(按阶段 0 结论处理 WebKit 录音部分)。
- [ ] `login.spec.ts`、`practice.spec.ts` 回归通过。
- [ ] `git diff --stat f8b48fa5 -- enjoy/` 无输出;`cd server && uv run pytest -q` 0 failed。

---

## 阶段 5:查词 / 翻译

本阶段只改 `web/src/features/lookup/`、`web/src/lib/kv-cache.ts`、`web/e2e/lookup.spec.ts`。依赖阶段 2 的 `completeChat`;**选中目标**由阶段 3/4 页面上的 `data-lookup-context` 提供(未完成时可先用单测验证,E2E 需阶段 3 的结果页)。

### Task 5.1:提示词复用、查词/翻译调用与 IndexedDB 缓存

**Files:**
- Create: `web/src/features/lookup/{prompts.ts,lookup.ts}`, `web/src/lib/kv-cache.ts`
- Test: `web/src/features/lookup/prompts.test.ts`, `web/src/features/lookup/lookup.test.ts`, `web/src/lib/kv-cache.test.ts`

**Interfaces:**
- Consumes:`completeChat`(Task 2.3);`ApiError`;enjoy 的 `@/constants`(`LANGUAGES`)与 `@/commands/{lookup,translate}.command.ts?raw`(只读文本,裁定 R9)。
- Produces:
  - `~/features/lookup/prompts`:`extractPrompt(source, pattern, name): string`;`DICTIONARY_PROMPT`、`TRANSLATION_SYSTEM_PROMPT`、`TRANSLATION_PROMPT`(从 enjoy 源码文本提取);`renderTemplate(template, vars): string`(LangChain 语法:`{name}` 为变量,`{{`/`}}` 为字面花括号,未知变量原样保留)。
  - `~/features/lookup/lookup`:`type LookupMode = "lookup" | "translate"`;`interface LookupResult { word; lemma; pronunciation; pos; definition; translation; contextTranslation }`(均为字符串);`LEARNING_LANGUAGE = "en-US"`;`normalizeSelection(text)`;`classifySelection(text): LookupMode | null`(裁定 R12);`languageName(code)`;`parseLookupJson(raw): LookupResult`(容忍 ```json 围栏,解析失败抛 `ApiError(502, "Invalid dictionary response")`);`lookupWord(api, { word, context, nativeLanguage })`;`translateText(api, { text, nativeLanguage })`;`lookupCacheKey(word, context, native)`、`translateCacheKey(text, native)`;`cachedLookup(api, params)`、`cachedTranslate(api, params)`(文本与上下文截到 1000 字符)。
  - `~/lib/kv-cache`:`kvGet<T>(key): Promise<T | undefined>`、`kvSet(key, value): Promise<void>`(库 `enjoy-web`、仓库 `kv`;IndexedDB 不可用或出错时静默)、`resetKvCacheForTests()`。

- [ ] **Step 1: 加依赖**:`yarn workspace web add -D fake-indexeddb@^6.0.0`

- [ ] **Step 2: 写失败测试**

`web/src/features/lookup/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DICTIONARY_PROMPT, TRANSLATION_PROMPT, TRANSLATION_SYSTEM_PROMPT, extractPrompt, renderTemplate } from "./prompts";

describe("prompts reused from enjoy/src/commands", () => {
  it("extracts the desktop prompts", () => {
    expect(DICTIONARY_PROMPT.startsWith("You are an {learning_language}-{native_language} dictionary.")).toBe(true);
    expect(DICTIONARY_PROMPT).toContain('"context_translation": "translation of the context in {native_language}"');
    expect(TRANSLATION_SYSTEM_PROMPT).toBe("You are a professional, authentic translation engine, only returns translations.");
    expect(TRANSLATION_PROMPT.startsWith("Translate the text to {native_language} Language")).toBe(true);
    expect(TRANSLATION_PROMPT).toContain("{text}");
  });
  it("fails loudly when the source changes shape", () => {
    expect(() => extractPrompt("const X = 1;", /const Y = `([\s\S]*?)`;/, "Y")).toThrow("Prompt Y not found");
  });
  it("renders LangChain-style templates", () => {
    expect(renderTemplate("A {x} {{literal}} {missing}", { x: "1" })).toBe("A 1 {literal} {missing}");
    const rendered = renderTemplate(DICTIONARY_PROMPT, { learning_language: "English (United States)", native_language: "普通话" });
    expect(rendered).toContain("You are an English (United States)-普通话 dictionary.");
    expect(rendered).toContain('{\n  "word"');
    expect(rendered).not.toMatch(/\{\{|\}\}/);
  });
});
```

`web/src/lib/kv-cache.test.ts`:

```ts
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kvGet, kvSet, resetKvCacheForTests } from "./kv-cache";

describe("kv cache", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetKvCacheForTests(); });
  it("stores and reads values", async () => {
    await kvSet("k1", { a: 1 });
    expect(await kvGet("k1")).toEqual({ a: 1 });
    expect(await kvGet("missing")).toBeUndefined();
  });
  it("degrades silently without IndexedDB", async () => {
    resetKvCacheForTests();
    vi.stubGlobal("indexedDB", undefined);
    await expect(kvSet("k2", 1)).resolves.toBeUndefined();
    expect(await kvGet("k2")).toBeUndefined();
  });
});
```

`web/src/features/lookup/lookup.test.ts`:

```ts
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { cachedLookup, classifySelection, lookupWord, parseLookupJson, translateText } from "./lookup";

const reply = (content: string) => () => json({ choices: [{ message: { content } }] });

describe("lookup", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); });

  it.each([
    ["country", "lookup"], ["  look   up ", "lookup"], ["ask not what", "lookup"],
    ["ask not what your", "translate"], ["x".repeat(41), "translate"], ["   ", null],
  ] as const)("classifySelection(%j) = %s", (text, mode) => expect(classifySelection(text)).toBe(mode));

  it("asks the AI dictionary in JSON mode with the desktop prompt", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": reply('```json\n{"word":"country","pos":"noun","definition":"a nation","translation":"国家","context_translation":"不要问国家"}\n```') });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const result = await lookupWord(api, { word: "country", context: "ask not what your country can do", nativeLanguage: "zh-CN" });
    expect(result).toEqual({ word: "country", lemma: "", pronunciation: "", pos: "noun", definition: "a nation", translation: "国家", contextTranslation: "不要问国家" });
    const body = JSON.parse(mock.calls[0].body as string);
    expect(body).toMatchObject({ temperature: 0, stream: false, response_format: { type: "json_object" } });
    expect(body.model).toBeUndefined();
    expect(body.messages[0].content).toContain("You are an English (United States)-普通话 dictionary.");
    expect(JSON.parse(body.messages[1].content)).toEqual({ word: "country", context: "ask not what your country can do" });
  });

  it("rejects malformed dictionary output", () => {
    expect(() => parseLookupJson("not json")).toThrow("Invalid dictionary response");
  });

  it("translates with the desktop translation prompt", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": reply("  你好  ") });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await translateText(api, { text: "Hello", nativeLanguage: "zh-CN" })).toBe("你好");
    const body = JSON.parse(mock.calls[0].body as string);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([
      { role: "system", content: "You are a professional, authentic translation engine, only returns translations." },
      { role: "user", content: "Translate the text to 普通话 Language, please do not explain my original text.:\n\nHello\n" },
    ]);
  });

  it("caches lookups in IndexedDB", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": reply('{"word":"country","definition":"a nation"}') });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const params = { word: "Country", context: "your country", nativeLanguage: "zh-CN" };
    await cachedLookup(api, params);
    expect((await cachedLookup(api, { ...params, word: "country" })).definition).toBe("a nation");
    expect(mock.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 运行,确认失败**:`yarn workspace web test src/features/lookup src/lib/kv-cache` → FAIL。

- [ ] **Step 4: 实现**

`web/src/features/lookup/prompts.ts`:

```ts
/**
 * 查词与翻译提示词复用桌面端原文:enjoy/src/commands/lookup.command.ts(DICITIONARY_PROMPT)
 * 与 enjoy/src/commands/translate.command.ts(SYSTEM_PROMPT、TRANSLATION_PROMPT)。
 * 这两个文件依赖 @langchain 且常量未导出,因此只以 ?raw 读入源码文本并提取(不执行、不复制)。
 */
import lookupSource from "@/commands/lookup.command.ts?raw";
import translateSource from "@/commands/translate.command.ts?raw";

export function extractPrompt(source: string, pattern: RegExp, name: string): string {
  const match = source.match(pattern);
  if (!match) throw new Error(`Prompt ${name} not found in enjoy source`);
  return match[1];
}

export const DICTIONARY_PROMPT = extractPrompt(lookupSource, /const DICITIONARY_PROMPT = `([\s\S]*?)`;/, "DICITIONARY_PROMPT");
export const TRANSLATION_SYSTEM_PROMPT = extractPrompt(translateSource, /const SYSTEM_PROMPT =\s*"([^"]*)";/, "SYSTEM_PROMPT");
export const TRANSLATION_PROMPT = extractPrompt(translateSource, /const TRANSLATION_PROMPT = `([\s\S]*?)`;/, "TRANSLATION_PROMPT");

/** LangChain 模板语法:{name} 为变量,{{ 与 }} 为字面花括号。 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (token, name?: string) => {
    if (token === "{{") return "{";
    if (token === "}}") return "}";
    return name && name in vars ? vars[name] : token;
  });
}
```

`web/src/lib/kv-cache.ts`:

```ts
const DB_NAME = "enjoy-web";
const STORE = "kv";
const VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined" || !indexedDB) return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB blocked"));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await run<T | undefined>("readonly", (store) => store.get(key))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await run("readwrite", (store) => store.put(value, key));
  } catch {
    /* 隐私模式等:不缓存即可 */
  }
}

export function resetKvCacheForTests(): void {
  dbPromise = null;
}
```

`web/src/features/lookup/lookup.ts`:

```ts
import { LANGUAGES } from "@/constants";
import { completeChat } from "~/api/ai";
import { ApiError, type ApiClient } from "~/api/client";
import { kvGet, kvSet } from "~/lib/kv-cache";
import { DICTIONARY_PROMPT, TRANSLATION_PROMPT, TRANSLATION_SYSTEM_PROMPT, renderTemplate } from "./prompts";

export type LookupMode = "lookup" | "translate";

export interface LookupResult {
  word: string;
  lemma: string;
  pronunciation: string;
  pos: string;
  definition: string;
  translation: string;
  contextTranslation: string;
}

export const LEARNING_LANGUAGE = "en-US";
const MAX_TEXT = 1000;

export function normalizeSelection(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function classifySelection(text: string): LookupMode | null {
  const normalized = normalizeSelection(text);
  if (!normalized) return null;
  return normalized.split(" ").length <= 3 && normalized.length <= 40 ? "lookup" : "translate";
}

export function languageName(code: string): string {
  return (LANGUAGES as Array<{ code: string; name: string }>).find((l) => l.code === code)?.name ?? code;
}

export function parseLookupJson(raw: string): LookupResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new ApiError(502, "Invalid dictionary response");
  }
  const field = (key: string) => (typeof data?.[key] === "string" ? (data[key] as string).trim() : "");
  return {
    word: field("word"), lemma: field("lemma"), pronunciation: field("pronunciation"), pos: field("pos"),
    definition: field("definition"), translation: field("translation"), contextTranslation: field("context_translation"),
  };
}

export async function lookupWord(
  api: ApiClient,
  { word, context, nativeLanguage }: { word: string; context: string; nativeLanguage: string },
): Promise<LookupResult> {
  const system = renderTemplate(DICTIONARY_PROMPT, {
    learning_language: languageName(LEARNING_LANGUAGE),
    native_language: languageName(nativeLanguage),
  });
  const raw = await completeChat(api, {
    messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ word, context }) }],
    temperature: 0,
    jsonMode: true,
  });
  return parseLookupJson(raw);
}

export async function translateText(api: ApiClient, { text, nativeLanguage }: { text: string; nativeLanguage: string }): Promise<string> {
  const prompt = renderTemplate(TRANSLATION_PROMPT, { native_language: languageName(nativeLanguage), text });
  const out = await completeChat(api, {
    messages: [{ role: "system", content: TRANSLATION_SYSTEM_PROMPT }, { role: "user", content: prompt }],
    temperature: 0,
  });
  return out.trim();
}

export const lookupCacheKey = (word: string, context: string, native: string) =>
  `lookup:v1:${native}:${normalizeSelection(word).toLowerCase()}:${normalizeSelection(context)}`;
export const translateCacheKey = (text: string, native: string) => `translate:v1:${native}:${normalizeSelection(text)}`;

export async function cachedLookup(api: ApiClient, params: { word: string; context: string; nativeLanguage: string }): Promise<LookupResult> {
  const word = normalizeSelection(params.word).slice(0, MAX_TEXT);
  const context = normalizeSelection(params.context).slice(0, MAX_TEXT);
  const key = lookupCacheKey(word, context, params.nativeLanguage);
  const hit = await kvGet<LookupResult>(key);
  if (hit) return hit;
  const result = await lookupWord(api, { word, context, nativeLanguage: params.nativeLanguage });
  await kvSet(key, result);
  return result;
}

export async function cachedTranslate(api: ApiClient, params: { text: string; nativeLanguage: string }): Promise<string> {
  const text = normalizeSelection(params.text).slice(0, MAX_TEXT);
  const key = translateCacheKey(text, params.nativeLanguage);
  const hit = await kvGet<string>(key);
  if (hit) return hit;
  const result = await translateText(api, { text, nativeLanguage: params.nativeLanguage });
  await kvSet(key, result);
  return result;
}
```

- [ ] **Step 5: 运行**:同 Step 3 → PASS;`yarn workspace web build` 后确认没有把 langchain 打包进来:`grep -l "LangChainTracer\|BaseChatModel" web/dist/assets/*.js || echo "NO LANGCHAIN"` → `NO LANGCHAIN`(产物里会出现 `"@langchain/core/prompts"` 字样,那只是 `?raw` 读入的源码文本字符串,属预期)。

- [ ] **Step 6: 提交**

```bash
git add web/package.json yarn.lock web/src/features/lookup web/src/lib/kv-cache.ts web/src/lib/kv-cache.test.ts
git commit -m "feat(web): reuse desktop lookup and translation prompts with an IndexedDB cache" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5.2:选中文字 → 底部抽屉

**Files:**
- Create: `web/src/features/lookup/use-text-selection.ts`, `web/src/features/lookup/i18n/{en.json,zh-CN.json}`
- Modify(替换占位): `web/src/features/lookup/lookup-layer.tsx`
- Test: `web/src/features/lookup/use-text-selection.test.ts`, `web/src/features/lookup/lookup-layer.test.tsx`

**Interfaces:**
- Consumes:`cachedLookup`、`cachedTranslate`、`classifySelection`、`normalizeSelection`(Task 5.1);`useSettings`、`nativeLanguageCode`(Task 2.5);`Sheet*`、`Button`;`translateServerError`。
- Produces:
  - `~/features/lookup/use-text-selection`:`interface TextSelectionInfo { text: string; context: string }`;`LOOKUP_CONTEXT_SELECTOR = "[data-lookup-context]"`;`readSelection(selection: Selection | null): TextSelectionInfo | null`(选区两端须在同一个 `data-lookup-context` 元素内);`useTextSelection(debounceMs = 300, doc = document): { selection; clear() }`。
  - `LookupLayer`(挂在 `AppShell`):选中后在底部导航上方显示浮动按钮 `lookup-trigger`(按下时 `preventDefault`,避免选区丢失);点击打开 `Sheet side="bottom"`(`lookup-drawer`,最高 70dvh,安全区内边距);结果区 `lookup-result`(`data-status` ∈ `loading|done|error`);切换按钮 `lookup-switch-mode`;出错时 `lookup-retry`。

- [ ] **Step 1: 写失败测试**

`web/src/features/lookup/use-text-selection.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSelection, useTextSelection } from "./use-text-selection";

function setup() {
  document.body.innerHTML = `
    <div data-lookup-context id="a">Ask not what your   country can do</div>
    <div data-lookup-context id="b">Second block</div>
    <p id="c">outside</p>`;
}

function select(node: Node, start: number, endNode: Node = node, end = start) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(endNode, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("readSelection", () => {
  afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; });

  it("returns the selected text and its context", () => {
    setup();
    const text = document.getElementById("a")!.firstChild!;
    const start = text.textContent!.indexOf("country");
    expect(readSelection(select(text, start, text, start + 7))).toEqual({ text: "country", context: "Ask not what your country can do" });
  });
  it("ignores collapsed, outside and cross-context selections", () => {
    setup();
    const a = document.getElementById("a")!.firstChild!;
    expect(readSelection(select(a, 2))).toBeNull();
    const c = document.getElementById("c")!.firstChild!;
    expect(readSelection(select(c, 0, c, 3))).toBeNull();
    const b = document.getElementById("b")!.firstChild!;
    expect(readSelection(select(a, 0, b, 3))).toBeNull();
    expect(readSelection(null)).toBeNull();
  });
});

describe("useTextSelection", () => {
  it("debounces selectionchange", () => {
    vi.useFakeTimers();
    setup();
    const { result } = renderHook(() => useTextSelection(300));
    const a = document.getElementById("a")!.firstChild!;
    act(() => { select(a, 0, a, 3); document.dispatchEvent(new Event("selectionchange")); });
    expect(result.current.selection).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.selection?.text).toBe("Ask");
    act(() => result.current.clear());
    expect(result.current.selection).toBeNull();
    vi.useRealTimers();
  });
});
```

`web/src/features/lookup/lookup-layer.test.tsx`:

```tsx
import "fake-indexeddb/auto";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LookupLayer } from "./lookup-layer";

function Page() {
  return (
    <>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <LookupLayer />
    </>
  );
}

async function selectText(needle: string) {
  const node = screen.getByTestId("ctx").firstChild!;
  const start = node.textContent!.indexOf(needle);
  await act(async () => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + needle.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("LookupLayer", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); localStorage.clear(); });

  it("looks up a selected word, switches to translation and reuses the cache", async () => {
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": (call) => {
        const body = JSON.parse(call.body as string);
        return body.response_format
          ? json({ choices: [{ message: { content: '{"word":"country","pos":"noun","definition":"a nation","translation":"国家"}' } }] })
          : json({ choices: [{ message: { content: "国家" } }] });
      },
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(screen.getByTestId("lookup-result")).toHaveTextContent("a nation");
    await userEvent.click(screen.getByTestId("lookup-switch-mode"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("国家"));
    expect(mock.calls).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(mock.calls).toHaveLength(2);
  });

  it("translates long selections and offers retry on errors", async () => {
    let fail = true;
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": () => (fail ? json({ error: "Upstream unavailable" }, 502) : json({ choices: [{ message: { content: "不要问" } }] })),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("ask not what your country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "error"));
    fail = false;
    await userEvent.click(screen.getByTestId("lookup-retry"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("不要问"));
    expect(JSON.parse(mock.calls[1].body as string).response_format).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行,确认失败**:`yarn workspace web test src/features/lookup` → FAIL。

- [ ] **Step 3: 实现**

`web/src/features/lookup/use-text-selection.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { normalizeSelection } from "./lookup";

export interface TextSelectionInfo {
  text: string;
  context: string;
}

export const LOOKUP_CONTEXT_SELECTOR = "[data-lookup-context]";
const MAX_TEXT = 1000;

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

export function readSelection(selection: Selection | null): TextSelectionInfo | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = normalizeSelection(selection.toString());
  if (!text) return null;
  const anchor = elementOf(selection.anchorNode)?.closest(LOOKUP_CONTEXT_SELECTOR);
  const focus = elementOf(selection.focusNode)?.closest(LOOKUP_CONTEXT_SELECTOR);
  if (!anchor || anchor !== focus) return null;
  return { text: text.slice(0, MAX_TEXT), context: normalizeSelection(anchor.textContent ?? "").slice(0, MAX_TEXT) };
}

export function useTextSelection(debounceMs = 300, doc: Document = document) {
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setSelection(readSelection(doc.getSelection())), debounceMs);
    };
    doc.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      doc.removeEventListener("selectionchange", onChange);
    };
  }, [debounceMs, doc]);
  const clear = useCallback(() => {
    setSelection(null);
    doc.getSelection()?.removeAllRanges();
  }, [doc]);
  return { selection, clear };
}
```

`web/src/features/lookup/lookup-layer.tsx`:

```tsx
import { LanguagesIcon, LoaderIcon, SearchIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { cachedLookup, cachedTranslate, classifySelection, type LookupMode, type LookupResult } from "./lookup";
import { useTextSelection, type TextSelectionInfo } from "./use-text-selection";

type LookupState =
  | { status: "loading" }
  | { status: "done"; lookup?: LookupResult; translation?: string }
  | { status: "error"; error: string };

const LOOKUP_ERRORS = {
  "Invalid dictionary response": "web.lookup.invalid",
  "Empty AI response": "web.lookup.invalid",
  "Upstream unavailable": "web.lookup.upstream",
  "LLM upstream is not configured": "web.lookup.notConfigured",
};

export function LookupLayer() {
  const { api } = useAuth();
  const { language } = useSettings();
  const { t } = useTranslation();
  const { selection, clear } = useTextSelection();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TextSelectionInfo | null>(null);
  const [mode, setMode] = useState<LookupMode>("lookup");
  const [state, setState] = useState<LookupState>({ status: "loading" });
  const native = nativeLanguageCode(language);

  const run = useCallback(async (info: TextSelectionInfo, nextMode: LookupMode) => {
    setMode(nextMode);
    setState({ status: "loading" });
    try {
      if (nextMode === "lookup") {
        setState({ status: "done", lookup: await cachedLookup(api, { word: info.text, context: info.context, nativeLanguage: native }) });
      } else {
        setState({ status: "done", translation: await cachedTranslate(api, { text: info.text, nativeLanguage: native }) });
      }
    } catch (err) {
      setState({ status: "error", error: translateServerError(t, err, LOOKUP_ERRORS) });
    }
  }, [api, native, t]);

  const openFor = (info: TextSelectionInfo) => {
    setTarget(info);
    setOpen(true);
    void run(info, classifySelection(info.text) ?? "translate");
  };

  const suggested = selection ? classifySelection(selection.text) : null;

  return (
    <>
      {selection && suggested && !open && (
        <Button data-testid="lookup-trigger"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 h-11 -translate-x-1/2 rounded-full px-5 shadow-lg"
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
          onClick={() => openFor(selection)}>
          {suggested === "lookup" ? <SearchIcon className="mr-2 h-4 w-4" /> : <LanguagesIcon className="mr-2 h-4 w-4" />}
          {suggested === "lookup" ? t("web.lookup.lookup") : t("web.lookup.translate")}
        </Button>
      )}
      <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) clear(); }}>
        <SheetContent side="bottom" data-testid="lookup-drawer"
          className="max-h-[70dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader><SheetTitle className="line-clamp-3 text-left">{target?.text}</SheetTitle></SheetHeader>
          <div data-testid="lookup-result" data-status={state.status} className="mt-3 select-text space-y-2 text-base">
            {state.status === "loading" && <LoaderIcon className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} />}
            {state.status === "error" && <p role="alert" className="text-destructive">{state.error}</p>}
            {state.status === "done" && state.lookup && (
              <>
                <p className="text-lg font-semibold">
                  {state.lookup.word || target?.text}
                  {state.lookup.pronunciation && <span className="ml-2 font-code font-normal text-muted-foreground">/{state.lookup.pronunciation}/</span>}
                  {state.lookup.pos && <span className="ml-2 text-sm font-normal text-muted-foreground">{state.lookup.pos}</span>}
                </p>
                {state.lookup.lemma && state.lookup.lemma !== state.lookup.word && (
                  <p className="text-sm text-muted-foreground">{t("web.lookup.lemma")}: {state.lookup.lemma}</p>
                )}
                {state.lookup.definition && <p>{state.lookup.definition}</p>}
                {state.lookup.translation && <p className="font-medium">{state.lookup.translation}</p>}
                {state.lookup.contextTranslation && (
                  <p className="border-l-2 pl-2 text-sm text-muted-foreground">{state.lookup.contextTranslation}</p>
                )}
              </>
            )}
            {state.status === "done" && state.translation !== undefined && <p className="whitespace-pre-wrap">{state.translation}</p>}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" data-testid="lookup-switch-mode" className="h-11 flex-1"
              disabled={!target || state.status === "loading"}
              onClick={() => target && void run(target, mode === "lookup" ? "translate" : "lookup")}>
              {mode === "lookup" ? t("web.lookup.translateInstead") : t("web.lookup.lookupInstead")}
            </Button>
            {state.status === "error" && target && (
              <Button data-testid="lookup-retry" className="h-11 flex-1" onClick={() => void run(target, mode)}>{t("web.common.retry")}</Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

`web/src/features/lookup/i18n/en.json`:

```json
{
  "web": {
    "lookup": {
      "lookup": "Look up", "translate": "Translate", "lookupInstead": "Dictionary", "translateInstead": "Translate instead",
      "lemma": "Base form", "invalid": "The dictionary answer could not be read. Try again.",
      "upstream": "The AI service is unavailable. Please try again.", "notConfigured": "The AI service is not configured on the server."
    }
  }
}
```

`web/src/features/lookup/i18n/zh-CN.json`:

```json
{
  "web": {
    "lookup": {
      "lookup": "查词", "translate": "翻译", "lookupInstead": "查词典", "translateInstead": "改为翻译",
      "lemma": "原形", "invalid": "无法解析词典结果,请重试。",
      "upstream": "AI 服务暂不可用,请重试。", "notConfigured": "服务器未配置 AI 服务。"
    }
  }
}
```

- [ ] **Step 4: 运行**:`yarn workspace web test` → PASS;typecheck、build 通过。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/lookup
git commit -m "feat(web): look up or translate selected text in a bottom drawer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5.3:查词 / 翻译 E2E

**Files:**
- Create: `web/e2e/lookup.spec.ts`

**Interfaces:**
- Consumes:`signIn`、`SPEECH_WAV`、`SPEECH_REFERENCE`(Task 2.8);结果页(Task 3.4)与会话页(Task 4.2)上的 `data-lookup-context`;`me-language`(Task 2.5)。

- [ ] **Step 1: 写用例** `web/e2e/lookup.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { SPEECH_REFERENCE, SPEECH_WAV } from "./support/fake-mic";

async function selectIn(page: Page, testId: string, needle: string | null) {
  await page.evaluate(([id, n]) => {
    const node = document.querySelector(`[data-testid="${id}"]`)!.firstChild as Text;
    const text = node.textContent!;
    const start = n ? text.indexOf(n) : 0;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, n ? start + n.length : text.length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, [testId, needle] as const);
}

test("look up a word and translate a sentence, served from cache the second time", async ({ page, request }) => {
  const { token } = await signIn(page, request);
  const saved = await request.post("/api/speech/assessments", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: "jfk.wav", mimeType: "audio/wav", buffer: readFileSync(SPEECH_WAV) },
      reference: SPEECH_REFERENCE, language: "en-US", save: "true",
    },
    timeout: 150_000,
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const id = (await saved.json()).assessment_id as string;

  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-language").selectOption("zh-CN");
  let aiCalls = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/ai/chat/completions")) aiCalls++; });

  await page.goto(`/practice/assessments/${id}`);
  await expect(page.getByTestId("assessment-reference")).toBeVisible();
  const result = page.getByTestId("lookup-result");

  await selectIn(page, "assessment-reference", "country");
  await page.getByTestId("lookup-trigger").click();
  await expect(result).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(result).toContainText(/[一-鿿]/);
  expect(aiCalls).toBe(1);
  await page.keyboard.press("Escape");

  await selectIn(page, "assessment-reference", null);
  await page.getByTestId("lookup-trigger").click();
  await expect(result).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(result).toContainText(/[一-鿿]/);
  expect(aiCalls).toBe(2);
  await page.keyboard.press("Escape");

  await selectIn(page, "assessment-reference", "country");
  await page.getByTestId("lookup-trigger").click();
  await expect(result).toHaveAttribute("data-status", "done");
  expect(aiCalls).toBe(2);

  const box = await page.getByTestId("lookup-drawer").boundingBox();
  expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.7 + 1);
});
```

- [ ] **Step 2: 运行**(E2E 栈 `--build`):两个项目均 1 passed。

- [ ] **Step 3: 提交**

```bash
git add web/e2e/lookup.spec.ts
git commit -m "test(web): cover selection lookup and translation end to end" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 5

- [ ] `yarn workspace web typecheck && yarn workspace web test && yarn workspace web build` → 通过。
- [ ] E2E 栈上 `lookup.spec.ts` 两个项目通过;此前三个 spec 回归通过。
- [ ] `git diff --stat f8b48fa5 -- enjoy/` 无输出;`cd server && uv run pytest -q` 0 failed。

---

## 阶段 6:端到端与真机验收、文档

### Task 6.1:全量 E2E(Chromium + WebKit,真实上游)并记录

**Files:**
- Modify: `docs/superpowers/plans/e2e-results.md`(追加一节)
- 视失败情况修改对应源码(每个修复单独提交,`fix(web): …` / `fix(server): …`)

**Interfaces:**
- Consumes:全部 E2E 用例与 E2E 栈(Task 2.8)。

- [ ] **Step 1: 全新构建并运行全部用例**

```bash
cd /e/workspace/everyone-can-use-english
export E2E_INVITE_CODE=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
yarn workspace web e2e --project=chromium-mobile
yarn workspace web e2e --project=webkit-mobile      # 或 Task 2.8 Step 6 的容器命令(去掉文件参数)
```

  Expected:`login`(5)、`practice`(2)、`chat`(2)、`lookup`(1)在每个项目上通过(WebKit 录音类用例按阶段 0 结论可为 skipped,须有原因)。

- [ ] **Step 2: 失败处理**:按 superpowers:systematic-debugging 定位;修复后重跑**全部**用例,不只重跑失败的那个。

- [ ] **Step 3: 记录** — 在 `docs/superpowers/plans/e2e-results.md` 末尾追加:

```markdown
## 手机网页版 Playwright 端到端(Task 6.1)

日期:<YYYY-MM-DD>;commit:<hash>;E2E 栈:`docker compose -p enjoy-e2e …`(真实上游,密钥来自 server/.env,未记录);
WebKit 运行方式:<Windows 原生 / Linux 容器 mcr.microsoft.com/playwright:v1.51.0-noble>。

| 用例 | chromium-mobile(Pixel 7) | webkit-mobile(iPhone 14) | 备注 |
|---|---|---|---|
| login.spec.ts(5) | ✅/❌ | ✅/❌ | |
| practice.spec.ts:评测/保存/回放/删除 | | | 总分 <n>、词数 <n> |
| practice.spec.ts:切后台保留录音 | | | |
| chat.spec.ts:流式/持久化/朗读/听写/删除 | | | 朗读模型 <…> |
| chat.spec.ts:输入栏可见 | | | |
| lookup.spec.ts | | | |
```

- [ ] **Step 4: 关闭栈并提交**

```bash
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v
git add docs/superpowers/plans/e2e-results.md
git commit -m "docs: record mobile web Playwright results" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6.2:真机验收(需要用户配合)

**Files:**
- Modify: `docs/superpowers/plans/e2e-results.md`

**Interfaces:**
- Consumes:用户提供的 **HTTPS** 地址(反向代理或隧道指向 `127.0.0.1:8000`)与至少一台 iPhone(Safari)、一台安卓(Chrome)。没有 HTTPS,手机无法录音也无法添加到主屏幕。

- [ ] **Step 1: 向用户请求**设备与 HTTPS 地址;用户用其日常栈(`docker compose up -d --build`)部署,注册方式由用户决定(`invite` 推荐)。**不要**代用户在任何外部服务创建账号或输入密码。

- [ ] **Step 2: 交给用户的清单**(每台设备各做一遍,结果写回文档):

| # | 操作 | 预期 |
|---|---|---|
| 1 | 打开 HTTPS 地址,注册/登录 | 进入「练习」 |
| 2 | 输入一句英文,点麦克风,允许权限,朗读后停止 | 几秒内出现评分页;总分、逐词结果可见;页面无横向滚动 |
| 3 | 结果页播放录音、点单词听片段 | 有声音 |
| 4 | 录音中按 Home 键/切到别的 App 再回来 | 提示录音已停止并保留,可选择评测或重录 |
| 5 | 对话页发一条消息 | 回复逐字出现;键盘弹出时输入框不被遮挡 |
| 6 | 点回复的朗读按钮 | 有声音(iOS 重点:首次点击即可播放) |
| 7 | 点麦克风说一句英文再停止 | 文字出现在输入框 |
| 8 | 长按选中一个单词,点「查词」;选中一句,点「翻译」 | 底部抽屉显示释义/译文;再次查同一词立即显示 |
| 9 | iOS:「我的」→「添加到主屏幕」按说明操作;安卓:浏览器菜单「安装应用」 | 主屏幕图标以全屏打开 |
| 10 | 系统切到深色模式 | 界面变为深色 |

- [ ] **Step 3: 写回结果**:在 e2e-results.md 新增「手机网页版真机验收(Task 6.2)」表,列为 `# / iPhone(型号、iOS 版本) / 安卓(型号、Chrome 版本) / 备注`。**未执行的格子写「未验证(需要用户提供设备与 HTTPS 地址)」**,不得写成通过。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/plans/e2e-results.md
git commit -m "docs: record mobile web real-device checks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6.3:文档定稿与回归

**Files:**
- Modify: `server/README.md`(新增「手机网页版」一节,并在「必须使用 HTTPS」补一段)、`web/README.md`(定稿)

- [ ] **Step 1: `server/README.md`** 在「让客户端指向它」之前新增:

```markdown
## 手机网页版

同一个镜像同时托管手机网页版(`web/`,PWA):`docker compose up -d --build` 后访问 `https://<你的域名>/` 即可,API 与网页同源,无需 CORS。

- **必须 HTTPS**:手机浏览器只在安全上下文里允许录音;iOS 的「添加到主屏幕」也需要 HTTPS。反向代理配置同上一节,请求体上限保持 `25m`(录音上传)。
- **数据**:对话、消息、评测记录存数据库;评测录音存 `DATA_DIR/recordings/<用户 ID>/`(默认 compose 卷 `/data`)。备份时同时备份数据库与该目录。
- **上限**:`RECORDING_QUOTA_MB`(每用户录音总量,默认 500)、`MAX_CONVERSATIONS`(默认 200)、`MAX_MESSAGES_PER_CONVERSATION`(默认 1000);单条录音 ≤ 5 分钟。超限分别返回 413 / 429。用户可在网页里删除旧录音。
- **更新**:前端资源带哈希、`index.html` 与 `sw.js` 不缓存;重新部署后用户刷新即得到新版本(service worker 只缓存 `/assets/*`,不做离线学习)。
- **接口**:`/api/conversations`、`/api/messages/{id}`、`/api/assessments`(见「接口一览」);`POST /api/speech/assessments` 加 `save=true` 时保存录音并在响应里返回 `assessment_id`,不带时与桌面端行为完全一致。
- 开发与测试见 `web/README.md`。
```

  「必须使用 HTTPS」一节末尾追加一句:「手机网页版的录音与「添加到主屏幕」同样依赖 HTTPS。」

- [ ] **Step 2: `web/README.md`** 定稿:保留 Task 2.1 的内容,追加「测试」「E2E」「部署」三节:

```markdown
## 测试

    yarn web:typecheck && yarn web:test && yarn web:build

## E2E(Playwright,真实上游)

    export E2E_INVITE_CODE=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
    docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
    yarn web:e2e --project=chromium-mobile
    yarn web:e2e --project=webkit-mobile        # Windows 上不可用时见下方容器命令
    docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v

- E2E 栈使用独立项目名与卷(端口 8100、invite 注册),不影响日常数据;上游密钥来自 `server/.env`。
- 语音素材:`enjoy/samples/jfk.wav`。Chromium 通过假设备参数读取;WebKit 通过 init script 替换 `getUserMedia`。
- WebKit 在 Linux 容器中运行(Windows 版 WebKit 能力不足时;在仓库根执行,与 server 容器共享网络,页面来源仍是 localhost):

      MSYS_NO_PATHCONV=1 docker run --rm --network container:enjoy-e2e-server-1 \
        -e E2E_BASE_URL=http://localhost:8000 -e E2E_INVITE_CODE \
        -v "$(pwd -W):/repo" -w /repo/web mcr.microsoft.com/playwright:v1.51.0-noble \
        node node_modules/@playwright/test/cli.js test --project=webkit-mobile

## 部署

由 `server/Dockerfile` 的 Node 阶段构建并由 FastAPI 同源托管,见 `server/README.md`「手机网页版」。
```

- [ ] **Step 3: 回归**

```bash
cd /e/workspace/everyone-can-use-english
(cd server && uv run pytest -q)                                  # 0 failed
yarn web:typecheck && yarn web:test && yarn web:build
git diff --stat f8b48fa5 -- enjoy/                               # 无输出
(cd enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep "error TS" | sort) | diff - .superpowers/enjoy-tsc-baseline.txt && echo "TSC BASELINE OK"
git grep -nE "XFYUN_API_(KEY|SECRET)=.+|UPSTREAM_[A-Z]+_KEY=.+|VOLCENGINE_TTS_KEY=.+|AZURE_SPEECH_KEY=.+" -- . ':!server/.env' || echo "NO KEYS"
```

- [ ] **Step 4: 提交**

```bash
git add server/README.md web/README.md
git commit -m "docs: document deploying and testing the mobile web app" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 6(项目完成标准,对应设计文档第 8 节)

- [ ] **8.1 服务端**:`uv run pytest -q` 0 failed;门槛 1 的 Postgres 迁移与测试在最终代码上重跑一次通过;隔离、配额、越权测试在 `test_conversations.py`、`test_assessments_api.py`、`test_assessment_save.py` 中;不带 `save` 的评测由未改动的 `test_speech_assessments.py` 与 `test_without_save_response_is_unchanged` 保证。
- [ ] **8.2 网页端**:typecheck、单测、build 通过;编码器头部由 Task 3.1 单测 + Python `wave` 检查验证,服务端接受由 `practice.spec.ts`(真实评测 200)验证。
- [ ] **8.3 端到端**:Task 6.1 的结果表全部 ✅(WebKit 跳过项有阶段 0 依据)。
- [ ] **8.4 真机**:Task 6.2 的表已填写;未做的格子明确写「未验证」。
- [ ] **8.5 桌面端不受影响**:`git diff --stat f8b48fa5 -- enjoy/` 无输出;enjoy `tsc` 错误行与阶段 0 基线一致(`TSC BASELINE OK`);服务端原有 296 项测试全部仍在且通过。
- [ ] 仓库中没有真实密钥(`NO KEYS`);`web/dist`、`.env` 未被跟踪(`git ls-files web/dist server/.env` 无输出)。

---

## 可并行开发

> 前提:**阶段 0 门槛已通过**(别名构建方案与录音方案已定)。并行不改变「每个阶段过自己的门槛」这一规则;各线使用 superpowers:using-git-worktrees 的独立工作树与分支,合并回 `feat/self-hosted-backend` 后再统一过门槛。

**1. 阶段 1(服务端)与阶段 2(网页骨架)两路并行。**

| 并行线 | 任务 | 独占文件 |
|---|---|---|
| S | Task 1.1 → 1.2 → 1.3 → 1.4 → 1.5 | `server/app/**`、`server/alembic/versions/0003_*`、`server/tests/**`、`server/.env.example`、`server/README.md` |
| W | Task 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 | `web/**`(除 e2e)、根 `package.json`、`yarn.lock`、`.gitignore` |

- 接口契约已在 Task 1.3/1.4/1.2 的 Interfaces 表中固定,W 线的单测全部用 fetch mock,不需要真实服务端。
- Task 2.7(Docker)**同时依赖** S 线的 Task 1.5(`/web/dist` 约定)与 W 线的 2.1–2.6,两线合并后再做;Task 2.8 在 2.7 之后。
- 两线都不改对方文件,合并无冲突;合并后跑 `uv run pytest -q` 与 web 三件套。

**2. 阶段 3、4、5 在阶段 2 门槛通过后三路并行。**

| 并行线 | 任务 | 独占文件 |
|---|---|---|
| P(评测) | 3.1 → 3.2 → 3.3 → 3.4 → 3.5(→ 3.6 如触发) | `web/src/audio/**`、`web/src/features/practice/**`、`web/src/test/fake-media.ts`、`web/e2e/practice.spec.ts` |
| C(对话) | 4.1 → 4.2;**4.3 等 P 线的 3.1–3.2 合并后**;→ 4.4 | `web/src/features/chat/**`、`web/src/components/markdown.tsx`、`web/e2e/chat.spec.ts` |
| L(查词) | 5.1 → 5.2;5.3 等 P 线 3.4 合并后 | `web/src/features/lookup/**`、`web/src/lib/kv-cache.ts`、`web/e2e/lookup.spec.ts` |

- 路由、占位页面、i18n 合并机制(`**/i18n/*.json` glob)、`api/ai.ts`、`api/server-config.ts` 都在阶段 2 建好(裁定 R16),三条线**不需要改** `app.tsx`、`src/i18n/*`、`src/api/*`。
- 共享文件只有 `web/package.json` 与 `yarn.lock`(4.2 加 react-markdown/remark-gfm,5.1 加 fake-indexeddb):合并时以 `yarn install` 重新生成 `yarn.lock` 解决冲突。
- 合并顺序:P → C → L;每次合并后跑 web 三件套与已合并线的 E2E。

**3. 不可并行(必须串行)**

- 阶段 0 两个任务串行(0.2 复用 0.1 的工程)。
- 阶段 1 内部串行(1.2 依赖 1.1 的模型;1.4 的往返用例依赖 1.2)。
- 阶段 2 内部 2.1 → 2.6 串行(共享 `web/src` 基础文件)。
- Task 6.1 → 6.2 → 6.3 在全部功能合并之后。

**4. 分工建议**

阶段 0 通过后开两个会话:Agent-S(服务端 S 线)与 Agent-W(网页骨架 W 线);两线合并后由其中一个做 Task 2.7、2.8。阶段 2 门槛通过后开三个会话 P / C / L。C 线做完 4.2 时若 P 线还没合并 3.2,就等待合并后再做 4.3(4.4 的用例也包含麦克风,不能提前跑),等待期间可评审 L 线。真机验收(6.2)需要用户本人参与,安排在最后。
