# 手机网页版(练习子集)设计文档

日期:2026-10-04
范围:新增 `web/`(手机优先的 PWA),并在 `server/` 补充用户数据接口与静态托管。`enjoy/` 只在必须时做最小改动。
前置:[自建后端设计](2026-10-02-self-hosted-backend-design.md)已完成(账号、AI 代理、发音评测)。

## 1. 背景与目标

桌面端(Electron)无法在手机上轻量使用,官方网页版 enjoy.bot 闭源且连接官方账号,接不上自建后端。目标:在安卓和苹果手机的浏览器里,通过一个链接(可添加到主屏幕)完成日常英语练习,外观沿用桌面端风格。

**第一版只做「练习子集」**,四项:

1. 登录 / 注册(账号 + 密码,沿用已有接口)。
2. AI 对话:文字 + 语音输入(录音转文字)+ 回复朗读(TTS)。
3. 跟读发音评测:给定参考文本,录音,得到评分和逐词反馈。
4. 查词 / 翻译:选中文字弹出 AI 释义或译文。

不做:音视频素材库、电子书、课程、社区、闪卡、本地离线模型、桌面 Copilot 面板、`/chats` 的智能体与群聊、浏览器扩展、应用商店上架、中文以外的多语言扩展、付费与配额。

## 2. 核心判断

- **复用的是「外观和叶子组件」,不是桌面端的数据层。** 桌面端界面里约 520 处调用 `EnjoyApp`(Electron 主进程接口:SQLite、ffmpeg、文件、事件总线)。浏览器没有这些能力,把它们逐个垫片化代价大且脆弱。
- **所以:`web/` 有自己的入口、路由和手机布局;样式(Tailwind 配置、shadcn/ui 组件、i18n 文件)和与 `EnjoyApp` 无关的叶子组件(评分结果视图、Markdown 渲染、波形播放器等)通过路径别名从 `enjoy/src` 复用;数据层改为直接调用服务端 API。** 某个被复用的组件如果内部碰了 `EnjoyApp`,优先在 `web/` 里写同名轻量版本,而不是去改 `enjoy/`。
- **数据放服务端。** 现有服务端对同步类接口"收下即丢"(`stubs.py`),网页版需要真实持久化,新增表与接口,注册在 stubs 之前。
- **同源部署。** FastAPI 在所有 API 路由之后托管 `web/dist`,不做 CORS,Docker 镜像多一个 Node 构建阶段。网页版与 API 同一个域名,密码与录音都必须走 HTTPS(iOS Safari 的麦克风也要求安全上下文)。
- **录音在浏览器里转成评测要的格式。** 服务端 `/api/speech/assessments` 只收 16 kHz、单声道、16 位 PCM 的 WAV(`server/app/routers/speech.py`)。浏览器 `MediaRecorder` 出 webm/opus(安卓 Chrome)或 mp4/aac(iOS Safari),用 `AudioContext.decodeAudioData` + `OfflineAudioContext` 重采样为 16 kHz 单声道,再编码 WAV。这样服务端评测接口不用改。

## 3. 复用与新写的边界

| 部分 | 做法 |
|---|---|
| Tailwind 配置、主题变量、`components/ui/*`(shadcn)、i18n(en / zh-CN / es) | 别名复用,`web/` 的 Tailwind `content` 额外包含被复用的路径 |
| 评分结果视图、Markdown 渲染、`wavesurfer-player` 等纯展示组件 | 逐个核对不依赖 `EnjoyApp` / `electron-log` / `@bugsnag/electron` 后别名复用;不满足则在 `web/` 重写 |
| LLM 提示词(`enjoy/src/commands/*.command.ts`) | 核对 import 是否干净;可直接复用则复用,否则复制提示词字符串并注明出处 |
| 登录页 | 不复用桌面的 `LoginForm`(带代理、API 地址、语言设置),新写手机版,请求沿用 `/api/sessions`、`/api/users` |
| 布局、导航、路由 | 全部新写:底部导航 + 单列页面,路由用 `react-router` 的 BrowserRouter(服务端对未知前端路径回退到 `index.html`) |
| 桌面标题栏、侧边栏、BrowserView、更新检查、代理、Copilot | 不要 |

约束:`web/` 只经路径别名读取 `enjoy/src`,不复制大段源码;不得在 `enjoy/` 里加 `web` 专用分支。必须改 `enjoy/` 时(例如把某组件里的 `EnjoyApp` 依赖抽成可注入),单独提交并说明。

## 4. 服务端设计

沿用既有约定:snake_case、错误体 `{"error": msg}`、Bearer token(`/api/sessions` 签发)、Alembic 迁移(不用方言专属类型)、单 worker。

### 4.1 新表(迁移 `0003`)

- `conversations`:`id`(uuid 字符串)、`user_id`、`name`、`config`(JSON:系统提示词、模型、温度、TTS 引擎/音色等)、`created_at`、`updated_at`。
- `messages`:`id`(uuid)、`conversation_id`、`role`(`user`/`assistant`/`system`)、`content`、`created_at`。
- `assessments`:`id`(uuid)、`user_id`、`reference_text`、`language`、`duration_ms`、`scores`(JSON,主要分数便于列表展示)、`result`(JSON,完整评测结果)、`audio_path`(相对数据目录)、`created_at`。
- 数据目录:`DATA_DIR`(默认 `/data`,compose 挂卷;本机 SQLite 部署时与库文件同目录),评测录音存 `DATA_DIR/recordings/<user_id>/<id>.wav`。

TTS 音频第一版不落盘:点击朗读时请求,客户端内存缓存,刷新后重新请求(成本可控,实现最小)。

### 4.2 新接口(均需登录,按用户隔离,越权访问返回 404)

- `GET/POST /api/conversations`,`GET/PATCH/DELETE /api/conversations/{id}`。
- `GET/POST /api/conversations/{id}/messages`(POST 支持一次提交多条,用于「用户消息 + 助手回复」成对保存),`DELETE /api/messages/{id}`。
- `GET /api/assessments`(分页,倒序),`GET /api/assessments/{id}`,`GET /api/assessments/{id}/audio`(带鉴权的音频流),`DELETE /api/assessments/{id}`。
- 评测写入:沿用 `POST /api/speech/assessments`(multipart,参数不变),响应不变;新增可选表单字段 `save=true` 时服务端在评测成功后保存录音和记录,并在响应里追加 `assessment_id`。不带 `save` 的行为与桌面端完全一致,桌面端不受影响。
- 静态托管:所有 `/api/**` 之外的 GET,先查 `web/dist` 里的文件,没有则返回 `index.html`;`/api/**` 未知路径保持原有 404。
- 限制:单用户录音总量上限(默认 500 MB,环境变量可调)、单条 ≤ 5 分钟(与 UI 一致)、对话与消息数量设合理上限,超限返回 413/429 并给出明确错误体。

### 4.3 不变的接口

登录、注册、`/api/me`、`/api/config/*`、`/api/ai/*`、`/api/speech/tokens` 全部保持。网页版对 `/api/ai/chat/completions` 使用 `openai` SDK(`dangerouslyAllowBrowser`,`baseURL` 指向同源 `/api/ai`)或直接 `fetch` 流式读取,与桌面端调用形态一致。

## 5. 网页端设计

### 5.1 技术栈

React 18 + TypeScript + Vite + Tailwind + shadcn/ui(复用)、`react-router`、i18next(复用语言包)。测试用 Vitest + Testing Library;端到端用 Playwright(Chromium + WebKit,移动设备预设)。独立 `web/package.json`,不并入 `enjoy` 的 Forge 构建。

### 5.2 页面

- **登录 / 注册**:账号 + 密码,记住 token(`localStorage`,读写包 try/catch),401 自动回到登录页。
- **练习**(底部导航第一项):跟读评测。输入/粘贴参考文本 → 录音(按住或点击开始/停止,最长 5 分钟)→ 上传评测 → 结果页(总分、准确度/流利度/完整度等、逐词/音素反馈,复用桌面评分视图),记录自动保存,列表可回看并回放录音。
- **对话**(第二项):会话列表 + 会话页。文字输入,麦克风按钮录音转文字填入输入框(`/api/ai/audio/transcriptions`);助手回复流式显示,每条回复有朗读按钮(TTS,音色沿用服务端下发的列表与默认值);消息自动保存。
- **查词 / 翻译**:在对话与评测结果里选中文字,弹出底部抽屉(不用桌面的 `w-96 h-96` 弹层)显示 AI 释义或翻译,结果缓存在 IndexedDB;只用 AI 词典,不做本地词典。
- **我的**(第三项):用户名、语言、退出登录、(只读)服务端当前 STT/TTS 说明。

### 5.3 录音与格式转换(`web/src/audio/`)

- 采集:`getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })` + `MediaRecorder`,不指定 mimeType,由浏览器决定。
- 转换:`decodeAudioData` → `OfflineAudioContext` 重采样 16 kHz 单声道 → 手写 16 位 PCM WAV 编码器(纯函数,单元测试)。
- 失败处理:权限被拒、浏览器不支持、解码失败、超时长,均给出可读提示;录音中切到后台(iOS 常见)要能保留已录内容或明确提示。
- 转写用同一个 WAV(服务端 chat 模式 Whisper 接受 wav)。

### 5.4 PWA

`manifest.webmanifest`(名称、图标、`display: standalone`、主题色)与最小 service worker(只缓存应用壳静态资源,API 与音频一律走网络,不做离线学习);iOS 的"添加到主屏幕"提示页。

### 5.5 移动适配约束

最小触控区域 44 px;输入框字号 ≥ 16 px(避免 iOS 聚焦缩放);使用 `100dvh` 和安全区(`env(safe-area-inset-*)`);键盘弹出时输入栏不被遮挡;暗色模式沿用桌面端主题变量。

## 6. 仓库规范

- 目录:`web/`(源码)、`server/`(后端)、`docs/superpowers/{specs,plans}/`(文档);分支沿用 `feat/self-hosted-backend`。
- 提交信息:`feat(web): …` / `feat(server): …` / `fix(...)` / `docs: …` / `test: …`,尾部附 `Co-Authored-By`;一个提交一件事。
- 不提交:`web/dist`、`node_modules`、`.env`、密钥;`web/.env.example` 只含占位。
- 质量门槛:服务端 `uv run pytest -q` 全绿;`web` 的 `tsc --noEmit`、`vitest run`、`vite build` 通过;新增代码有测试(WAV 编码器、API 客户端、关键页面状态);不引入未使用的依赖。
- 文档:`server/README.md` 增加网页版部署与 HTTPS 说明;`web/README.md` 写开发/构建/别名约定。
- 对 `enjoy/` 的改动单独提交,保持与桌面端行为一致。

## 7. 部署

`server/Dockerfile` 增加 Node 构建阶段(构建 `web/`),运行镜像仅拷贝 `dist`;`docker-compose.yml` 增加数据卷(`/data`)。仍不内置反向代理:对外必须经 HTTPS(例如 Caddy/Nginx 或隧道),端口仍绑定 `127.0.0.1:8000`。

## 8. 验收标准

1. 服务端:新表迁移在 SQLite 和 Postgres 上都通过;新接口有用户隔离、配额、越权测试;未带 `save` 的评测请求行为与改动前完全一致。
2. 网页端:`tsc`、单元测试、`vite build` 通过;WAV 编码器对已知输入产出 16 kHz/单声道/16 位头部且被服务端接受(用真实评测请求验证)。
3. 真实服务端到端(Docker + 真实上游 key):注册登录、对话(流式、语音转文字、朗读)、跟读评测并保存与回放、查词/翻译,全部在移动设备预设的 Chromium 与 WebKit 下由 Playwright 跑通。
4. 真机:至少一台 iPhone(Safari)和一台安卓(Chrome)通过 HTTPS 链接完成"录音 → 评测"和"语音转文字"。**这一步需要用户配合提供设备与 HTTPS 地址;未完成则明确标注为未验证。**
5. 已有的桌面端流程与服务端 296 项测试不受影响。

## 9. 风险与未验证项

- **iOS Safari 录音**:`MediaRecorder` 在 Safari 输出 mp4/aac,`decodeAudioData` 对其的支持与稳定性需要真机验证;若不稳,备选是在浏览器里用 `AudioWorklet` 直接采 PCM,放弃 `MediaRecorder`。阶段 0 先做这个验证。
- **iOS 后台与锁屏**:录音时切后台可能中断;需要明确提示并保留已录内容。
- **组件复用的实际成本**:`@renderer/components` 是一个大 barrel,依赖 Electron 的组件较多;只通过子路径引入,并在阶段 0 验证别名构建能通过(`electron-log`、`@bugsnag/electron` 在 web 构建中需别名为空实现)。
- **录音数据增长**:靠配额与删除接口控制;不做自动清理。
- **同源托管与缓存**:service worker 缓存策略要保证前端发布后能及时更新(带版本号的资源名 + `index.html` 不缓存)。
- **HTTPS 前提**:没有 HTTPS 地址,手机浏览器无法录音,也无法"添加到主屏幕"。

## 10. 阶段划分(详细计划另写)

0. **可行性验证**(丢弃式):浏览器录音 → WAV → 现有评测接口,在 Chromium/WebKit 下跑通;Vite 别名复用 `enjoy/src` 的 UI 组件与 Tailwind 配置并构建成功;iOS 真机能验则一并验。
1. **服务端数据与托管**:迁移 `0003`、对话/消息/评测接口、`save` 参数、静态托管、Docker 构建阶段。
2. **网页骨架**:脚手架、别名、登录注册、底部导航与移动布局、PWA 外壳。
3. **跟读评测**:录音与 WAV 模块、评测页、历史与回放。
4. **AI 对话**:会话与消息、流式回复、语音转文字、朗读。
5. **查词 / 翻译**:选中弹出抽屉,缓存。
6. **端到端与真机验收、文档**。

可并行:阶段 3、4、5 在阶段 2 完成后互不依赖(各自只动自己的页面目录和各自的服务端路由文件);阶段 1 的服务端接口与阶段 2 的前端骨架在接口契约(本文 4.2)确定后可并行。
