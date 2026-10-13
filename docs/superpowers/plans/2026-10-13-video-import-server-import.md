# 跟读库 · 链接导入(服务端 S2:yt-dlp、URL 预检、FetchStage 实现)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **前置:S1(`plans/2026-10-13-video-import-server-core.md`)必须已合并。** 本计划的代码导入 S1 的 `app.library.{errors,pipeline,media,limits,store}`、`app.models.LibraryItem` 与 S1 在 `main.py` 里预留的锚点。**先读文末 `## Addendum (2026-10-13)`,其中的裁定(R-LI23 起)优先于前文。** 初稿写成时 S1 还没有计划文件,下文「依赖的 S1 接口」A-1 至 A-9 当时是推定;Addendum 已按 S1 计划(「对外接口(冻结)」一节)逐条对过,正文里与 S1 不一致的地方已改。但那仍是**计划对计划**的核对,S1 合并后 Task 0b 还要逐条读真实代码;对不上时**只改本计划自己的文件**去适配,改不了就停下来上报,不得改 S1 的文件。

**Goal:** 实现 spec §7 的链接导入全部服务端部分:`app/library/urlcheck.py`(URL 预检,SSRF 第一层)、`app/library/ytdlp.py`(yt-dlp 子进程、环境变量白名单、cookies 副本、固定正则错误分类、DRM / 直播 / 播放列表 / 时长 / 大小 / 磁盘判定、字幕选择、进度、断点复用)作为 S1 `FetchStage` 协议的真实实现;`routers/library_import.py` 提供 `POST /api/library/imports` 并在启动时把 `YtDlpFetch` 注册到库的 worker;`yt-dlp` 写进 `server/pyproject.toml` + `uv.lock`;`docker-compose.example.yml` 加一段注释掉的 cookies 只读挂载示例;spike S2(锁定版本的参数语法、YouTube 是否要 JS 运行时、目标服务器真实下载)的结果追加到 `docs/superpowers/plans/2026-10-13-video-import-results.md`。

**Architecture:** 请求里只做同步的 URL 预检(语法 + 每个解析地址都必须是全局地址),通过后经 S1 的限额助手和 store 建一个 `source="link"`、`status="queued"` 的条目并 `wake()` worker,**立刻返回**,请求里从不跑 yt-dlp。worker 的取回阶段调用 `YtDlpFetch.fetch(FetchRequest)`:开关复核 → 断点缓存(`_tmp/<id>/fetch.json`)→ 再做一次预检(DNS 可能变了)→ `python -I -X utf8 -m yt_dlp --dump-single-json`(下载前判定所有永久拒绝)→ 大小与磁盘 → 下载到 `_tmp/<id>/dl.<ext>`(+ 至多一个英文字幕 `subs.<lang>.srt`)→ 返回 `FetchResult`,后面的转码 / 字幕 / 转写 / 分句全是 S1 的事。子进程统一经 S1 的 `media.run`(本计划只有一个适配函数 `media_runner` 知道它的签名);测试全部注入假的子进程,不联网。分层:`library` 只依赖 `core`、`models` 与 `library` 自身;`routers/library_import.py` 依赖 `core` + `library`(spec §3)。

**Tech Stack:** Python 3.12(uv)、FastAPI + SQLAlchemy 2 async + pydantic v2、pytest + pytest-asyncio;新增依赖 `yt-dlp[default]`(版本由 `uv.lock` 锁定,Task 1 记录实际版本);可能新增 JS 运行时(Task 6,条件任务,由 spike 决定)。不改 `enjoy/`、`web/`、`admin/`,不新增迁移。

**Spec:** `docs/superpowers/specs/2026-10-13-video-import-design.md`(**有约束力**):§2.1 E2 / E6 / E8、§5.1 磁盘检查、§5.2 设置名、§6.1 子进程约定、§6.5 重试、§6.6 错误种类、**§7 全部**、§9 `POST /imports` 与限流、§13 隐私、§15 S2 行(文件归属)与合并顺序。§16 的开放问题 1–5 按推荐默认值处理:库、识别、链接导入三个开关都默认关(1);容量按默认(2);接受 B 档估算(3,与本车道无关);平台自动字幕只在识别不可用时才用(4,见 R-LI6);**不默认配 cookies / 代理**,先在 Task 0 T0.3 用真实服务器试,被拦时界面把「本机下载后上传」列第一位(5)。

## Global Constraints

- **合并顺序(spec §15):S1 →(S2 ‖ A 服务端 ‖ W1)→ W2 → A 网页 → Z。** 本计划在 S1 合并之后开始;与 A、W1 没有共同文件,可并行。
- **文件归属(spec §15,一个文件只有一个所有者)。** 本计划独占:`server/app/library/ytdlp.py`、`server/app/library/urlcheck.py`、`server/app/routers/library_import.py`、`server/pyproject.toml`、`server/uv.lock`、`docker-compose.example.yml`、`server/tests/test_library_ytdlp.py`、`server/tests/test_library_urlcheck.py`;外加结果文档 `docs/superpowers/plans/2026-10-13-video-import-results.md` 里**本计划追加的那一节**。**唯一**碰别人文件的地方是 S1 在 `server/app/main.py` 里为 S2 预留的锚点(spec §15「S2 的 `library_import` 路由同样由 S1 预留锚点」):只追加一处导入名、一行 `library_import.install(app)`、路由元组里的一个名字(R-LI2)。`app/library/CLAUDE.md`、`routers/CLAUDE.md`、`server/README.md`、`server/.env.example`、`server/Dockerfile`、`tests/test_library_privacy.py`、`tests/test_architecture.py` 都是 S1 的:本计划需要它们变化的地方写在文末「交接」,由其所有者或 Z 落地。
- **迁移:不新增。** 表结构由 S1 的 `0018_library` 冻结。
- **隐私(spec §13):** 日志、错误、异常信息里绝不出现 URL、标题、字幕文字、yt-dlp 的输出、cookies 路径或内容、代理地址;只允许条目 id、用户 id、`error_kind`、预检原因码、退出码、毫秒、字节数、`yes/no`。新增 `caplog` 一律 `caplog.set_level(..., logger="app")`。HTTP 错误文本是固定英文串。网页端永远不请求第三方(本计划不碰网页)。
- **安全(spec §7.2、§7.3):** yt-dlp 只以 `python -I -X utf8 -m yt_dlp` 子进程运行、不经 shell、`--` 隔开 URL、`--ignore-config --no-plugin-dirs --no-cache-dir`、不传 `--exec`;子进程环境变量是白名单;不做应用内自动更新、不传 `--remote-components`(运行时不下载任何代码)。
- **测试口径(本任务的约束):每个任务只跑它列出的测试**(`cd server && uv run pytest -q <列出的文件> tests/test_architecture.py`);全量 `uv run pytest -q`、E2E、`docker compose build` 只在用户要求时做。Task 0 里联网的步骤(访问 YouTube 等站点、真实下载)**先在对话里征得用户同意**再做;T0.3 需要用户重建容器,**只在用户要求时做**。
- **工作树是 CRLF**(`core.autocrlf=true`,仓库里是 LF):改现有文件用 Edit,新文件用 Write;`uv add` 会重写 `pyproject.toml` / `uv.lock`,提交前 `git diff --stat` 确认只动了依赖相关的行。
- **提交:** conventional(`feat(server): …`、`test(server): …`、`chore(server): …`、`docs: …`),一个任务一个逻辑提交,每个提交后该任务列出的测试全绿,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。只 `git add` 本任务列出的文件(工作树里有别人的未提交改动)。
- **写计划时的实跑(如实):** `urlcheck.py` 与 `ytdlp.py` 的**全部代码**、Task 2 的 66 个用例和 Task 3 + Task 4 的 76 个用例(不含依赖测试与适配器测试),在计划作者机器上的一份副本里用本仓库的 `server/.venv`(Python 3.12、pytest-asyncio auto)真实运行过,全绿;运行时 S1 的 `errors` / `pipeline` / `media` 是按下文 A-1 至 A-3 写的**桩**。另外实跑过「monkeypatch `Settings` 的 property 在本仓库可行」(R-LI15,已被 R-LI23 取代)。**以上数字是 Addendum 之前的代码**:Addendum 改动了 `YtDlpFetch._download`、`FakeRunner`、路由与 Task 5 的测试,这些改动**没有运行过**(只对着 S1 计划核对了签名)。**没有运行过**:`routers/library_import.py` 与 Task 5 的测试(S1 尚未存在;只做了语法编译)、Task 1 的依赖测试与 Task 4 的适配器测试(写计划时没有安装 yt-dlp,也没有下载任何东西)、Task 0 的全部 spike。执行者第一次运行时以真实结果为准;差异先弄清原因,不得改裁定与接口名迁就。

---

## 文件结构

```
server/
  app/library/urlcheck.py          新:parse / precheck / blocked_address / CheckedUrl / UrlRejected(Task 2)
  app/library/ytdlp.py             新:第一部分 纯函数(Task 3);第二部分 Proc、media_runner、YtDlpFetch(Task 4);
                                       JS_RUNTIME_ARGS 由 Task 6 按 spike 结果填写
  app/routers/library_import.py    新:POST /api/library/imports、install(app)(Task 5)
  app/main.py                      [S1 的文件,只填 S2 锚点] 导入名 + install 一行 + 路由元组一项(Task 5)
  pyproject.toml、uv.lock          + yt-dlp[default](Task 1);条件:+ JS 运行时轮子(Task 6)
  tests/test_library_ytdlp.py      新:依赖(Task 1)、纯函数(Task 3)、取回阶段(Task 4)、JS 运行时(Task 6,条件)
  tests/test_library_urlcheck.py   新:预检(Task 2)、导入端点与注册(Task 5)
docker-compose.example.yml         + 注释掉的 cookies 只读挂载示例(Task 7)
docs/superpowers/plans/2026-10-13-video-import-results.md   追加「S2 链接导入」一节(Task 0、0b、1、6、8)
```

## 依赖的 S1 接口(假设;Task 0b 逐条核对)

> 依据:spec §6.1(worker、`media.run`)、§6.6(错误种类)、§8 / §9(限额、条目形状)、§15(「`pipeline.fetch` 阶段只留一个接口(`FetchStage` 协议),默认实现抛 `unsupported_site`」「S2 只需要 `FetchStage` 接口」),以及 S1 计划「对外接口(冻结)」一节(Addendum 已逐条核对,差异写在表里)。**本计划里只有下表右列的那几处调用知道它们**,对不上时只改那几处。

| # | 假设的 S1 接口(确切签名) | 本计划用在哪 |
|---|---|---|
| A-1 | `app/library/errors.py`:`class LibraryError(Exception)`,构造 `LibraryError(kind: str)`,属性 `.kind`(**未知种类抛 `ValueError`**,所以 `KINDS_RAISED` 必须是 `KINDS` 的子集,测试已覆盖);`KINDS: frozenset[str]` = §6.6 全部种类(不含准入码);`ADMIT`(`unavailable / max_items / quota / uploads / daily`,只出现在 HTTP);`Aborted(Exception)`(取消 / 删除时 `req.report` 抛它,必须原样穿出取回阶段);`api_error(code) -> HTTPException`(`"disabled"` = 404 `Library is disabled`);`http_error(err: LibraryError) -> fastapi.HTTPException`(S1 的状态码与固定英文串) | `ytdlp.py` 抛错;`test_every_kind_the_stage_raises_is_a_library_kind`;路由闸门与限额错误 |
| A-2 | `app/library/pipeline.py`:`@dataclass(frozen=True) class FetchRequest: item_id: str; user_id: int; url: str; tmp_dir: Path; settings: Settings; asr_available: bool; report: Callable[[int], Awaitable[None]]`(`report` 收取回阶段内 0–100,S1 映射到流水线的 0–40 并自己节流;**条目被取消 / 删除后 `report` 抛 `Aborted`**,R-LI24);`settings` 是真实的 `Settings`(有 `library_link_available` 等属性);`@dataclass(frozen=True) class FetchResult: media_path: Path; title: str \| None; duration_ms: int \| None; subtitle_path: Path \| None; subtitle_auto: bool; source_host: str \| None`;`class FetchStage(Protocol): async def fetch(self, req: FetchRequest) -> FetchResult`。S1 用 `FetchResult` 的约定:`title` 只在条目 `title == ""` 时采用(R-LI10);`subtitle_path` 记 `sub_source="platform"`,`subtitle_auto=True` 时走 §6.3 的滚动去重;`subtitle_path is None` 时按 §6.2 第 6 步走识别或 `no_subtitles` | `ytdlp.py`、Task 4 测试 |
| A-3 | `app/library/media.py`:`async def run(cmd: Sequence[str], *, timeout: float, env: Mapping[str, str], cwd: Path \| None = None, on_stdout_line: Callable[[str], None] \| None = None) -> RunResult`,`RunResult` 有 `returncode: int`、`stdout: bytes`、`stderr: str`、`timed_out: bool`(超时**返回** `timed_out=True`,不抛);`env` 原样作为子进程的**完整**环境(`None` = S1 的 `safe_env()`);超时 / 取消时 SIGTERM 再 SIGKILL;它自己不记录 stdout / stderr;**给了 `on_stdout_line` 时 stdout 不缓存(`stdout == b""`)**,R-LI23;POSIX 上命令前会加 `nice -n 10` | 只有 `ytdlp.media_runner` |
| A-4 | `app.state.library`(`LibraryWorker`)在 `create_app` 里就建好(不是只在 lifespan 里),有 `set_fetch_stage(stage: FetchStage) -> None`、只读属性 `fetch_stage`、`wake() -> None`(循环没起时调用也安全) | `library_import.install`、路由、Task 5 测试 |
| A-5 | `app/library/limits.py`:`async def admit_new_item(session, app, user_id: int, *, size_bytes: int = 0, upload: bool = False) -> None`——依次检查「库可用(ffmpeg 在)→ 条目数 → 配额 → (上传才查)同时上传数」,最后才**扣**每日 `library_imports_daily_per_user`;不满足抛 `LibraryError("unavailable" \| "max_items" \| "quota" \| "uploads" \| "daily")`;`async def refund_new_item(session, app, user_id: int) -> None` 退还那次每日计数。链接导入调用时不传 `size_bytes` / `upload`(**配额只在创建时检查已有用量,下载大小由取回阶段的 `too_large` / `disk_full` 兜底**) | 路由 |
| A-6 | `app/library/store.py`:`async def create_item(session, *, user_id: int, kind: str, source: str, status: str, title: str, source_url: str \| None = None, source_host: str \| None = None, upload_total: int = 0) -> LibraryItem`(自己 `commit`);`def item_out(item: LibraryItem) -> dict`(= 列表项形状,**比 spec §9 多 `resume_idx`、`has_poster`**);`def clean_title(raw: str \| None, fallback: str = "Untitled") -> str`(合并空白、≤ 200) | 路由、Task 5 测试 |
| A-7 | `app/models.py`:`LibraryItem`(§4 的列,含 `source`、`status`、`title`、`source_url`、`source_host`、`created_at`) | Task 5 测试 |
| A-8 | `app/core/config.py` 的 `Settings`:§5.2 的字段名(`library_enabled`、`library_link_import_enabled`、`library_link_allow_generic`、`library_link_timeout_minutes`、`library_transcode_max_height`、`library_max_upload_mb`、`library_max_duration_minutes`、`library_imports_daily_per_user`、`library_max_items`、`library_ytdlp_cookies_file`、`library_ytdlp_proxy`,后两者是 `str`,空 = 未配)与属性 `library_available`(总开关 ∧ `media_tools_present()`)、`library_link_available`(§5.2 末:链接开关 ∧ `ytdlp_present()`);`app.core.config.media_tools_present()` / `ytdlp_present()` 是模块函数,**测试 monkeypatch 它们**(R-LI23);`app.core.deps.get_settings`。路由闸门只看 `library_enabled`(S1 R-SC9) | 全部 |
| A-9 | `server/app/main.py`:S1 留了含 `plan S2` 字样的锚点注释——一处在 `install_library(app)` 之后(原文 `# --- anchor for plan S2 (2026-10-13-video-import-server-import): \`library_import.install(app)\` goes on the next line; it registers …`,两行注释),一处在路由元组里 `library,` 之后、`stubs` 之前(`# --- anchor for plan S2 (…): \`library_import,\` goes on the next line ---`);`tests/test_library_privacy.py` 已把 `("POST", "/api/library/imports")` 列为 `LATER`(允许的后续路由),本计划自己的测试覆盖它的请求体与日志;`tests/test_architecture.py` 已允许 `routers -> library`、`library -> core, models`;`tests/background.py` 已登记 `library.pending`(本计划不新增任务集:取回阶段里的进度小任务在 `fetch` 返回前就被取消并等待,R-LI12) | Task 5 |

## 本计划的裁定

> 格式:**裁定 / 为什么 / 猜错的代价**。spec 不改;与代码、与 spec 字面不一致的地方在这里决定。所有「核对」都读了真实代码,出处写在每条里。

- **R-LI1 路由的测试放在 `tests/test_library_urlcheck.py`。** spec §15 只给 S2 两个测试文件,而 `tests/test_library_*.py` 这个通配归 S1;新建 `test_library_import_api.py` 会落进 S1 的通配。导入端点在请求里唯一的实质工作就是 URL 预检,放在一起最贴切。*代价*:文件名不完全描述内容;文件头的 docstring 写明两部分。
- **R-LI2 `main.py` 只填 S1 的锚点。** 核对 `server/app/main.py`:路由靠 `from app.routers import (...)` 一个大元组导入、在 `for module in (...)` 里注册,`stubs` 必须在真实 API 之后;agents 计划已用「锚点注释 + 只追加」的做法(`# --- anchors for the other agents plans ...`)。本计划只做三处单点追加(Task 5 Step 4)。*若 S1 没留锚点*:仍在相同位置(`app.state.library` 赋值之后;元组里 `library` 之后)追加,并在结果文档记一笔。
- **R-LI3 注册方式:`routers/library_import.install(app)` 调 `app.state.library.set_fetch_stage(YtDlpFetch())`。** 为什么:`library` 不能导入 `routers`,`main.py` 只该多一行;与 `rooms_voice.install` 同一种「路由模块带 install」的先例(核对 `server/app/routers/rooms_voice.py::install`)。*代价*:依赖 A-4 的方法名。
- **R-LI4 格式选择优先 H.264:`bv*[height<=H][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=H][ext=mp4]+ba[ext=m4a]/b[height<=H]/b/ba`。** spec §7.1 写的是 `bv*[height<=H][ext=mp4]+ba[ext=m4a]/b[height<=H]/b`,「纯音频页面退成 `ba`」。偏离:前面多一档 `vcodec^=avc1`,末尾显式 `/ba`。为什么:YouTube 的 720p mp4 视频流常是 AV1(`av01`),S1 的转码阶段只对「已经是 H.264 + AAC 的 mp4」做秒级重封装,AV1 会走完整转码(慢、吃 CPU);`/ba` 是把 spec 的「退成 `ba`」写成格式串。*代价*:个别站点没有 avc1 时退到原 spec 的那一档,行为与 spec 相同。
- **R-LI5 字幕:只传**一个**确切的语言键。** spec §7.1 第 3 步写 `--sub-langs "en.*,en"`;那会下载多个英文变体(`en`、`en-US`、`en-GB`…),而 §6.3 只吃一个文件。改为:从探测结果里选——人工字幕按 `en` > `en-US` > `en-GB` > 其余 `en-*`(字典序第一个),自动字幕按 `en-orig` > `en`(**不用**翻译轨,如 `en-de`);用 `re.escape` 后传给 `--sub-langs`。*代价*:同时有多个英文人工字幕时只取一个(按上面的序)。
- **R-LI6 E6 / 开放问题 4:** 有人工英文字幕就下人工字幕;没有时,`req.asr_available` 为真则**不下**自动字幕(交给 S1 的识别);为假才下自动字幕(`--write-auto-subs`)。下载失败或文件没产生 = `subtitle_path=None`,不算取回失败(yt-dlp 对字幕失败只给警告)。
- **R-LI7 分类只看 stderr,且先看 `ERROR` 行、先抹掉 URL。** 探测的 stdout 是整份 JSON(含标题、简介),**永远不参与分类**;下载的 stdout 只用于进度行和「larger than max-filesize」这一句(那句 yt-dlp 打在 stdout、并以退出码 0 结束、不产生文件)。为什么:标题或简介里出现「DRM」「private」会把正常视频误判成永久失败。正则表固定在 `ytdlp.CLASSIFY`,顺序即优先级,不匹配 = `ytdlp_failed`;`HTTP Error 429` / 「not a bot」归 `blocked`;`HTTP Error 403` / 5xx 归 `ytdlp_transient`(会被 S1 自动重试 ≤ 2 次);JS 运行时 / 签名 / `n challenge` 失败归 `ytdlp_failed`(要升级 yt-dlp,重试无用)。真实 yt-dlp 的文案**未在本仓库验证**,Task 0 T0.2 采样核对。
- **R-LI8 URL 预检比 spec 多几条规则。** 核对 `server/app/admin/probes.py::_blocked`:地址规则逐字照搬(`not is_global or is_multicast`,IPv4 映射的 IPv6 按 IPv4 判),但写在 `urlcheck.py` 里(spec §7.2:分层不允许 library 依赖 admin;§14:不抽到 core)。额外规则:端口只允许缺省 / 80 / 443;拒绝单标签主机名(会经搜索域解析到内网)和 `localhost`、`.localhost`、`.local`、`.internal`、`.lan`、`.home.arpa`、`.onion`;URL 里不许有空白、控制字符、反斜杠;去掉片段(`#t=30`);**用检查过的 IDNA 主机重建 netloc**,所以 yt-dlp 拿到的主机就是被检查的那个。预检在请求里做一次,取回阶段开始时**再做一次**。*代价*:非标准端口上的公开视频页不能导入(极少见)。DNS 重绑与站点重定向到内网仍可能绕过(spec §7.2 的剩余风险),由「默认关 generic」兜底。
- **R-LI9 所有预检拒绝都是 `400 {"error": "Invalid link"}`。** 原因码(`REASONS`)只进日志。为什么:不让用户借错误文本探测内网;网页只需要一个「链接无效」文案。
- **R-LI10 标题:** 用户给了就存清洗后的(路由用 S1 的 `store.clean_title(raw, fallback="")`:合并空白、≤ 200,R-LI23);没给存 `""`,取回后由 S1 用 `FetchResult.title` 补上(A-2 的约定)。spec §4 只说「默认取平台标题」,没说处理中显示什么;`""` 是唯一不需要新列的「未定」标记。*若 S1 选了别的标记*(例如主机名),Task 0b 改路由里那一个表达式。
- **R-LI11 yt-dlp 不记 `metering`。** 核对 `core/CLAUDE.md`:`metering.record` 是给付费上游的;yt-dlp 访问的是目标站点,不花钱,也没有 `provider_of` 可言。日志只记 id / 种类 / 退出码 / 毫秒 / 字节数。
- **R-LI12 超时与进度。** 一次取回共用一个墙钟预算 `library_link_timeout_minutes × 60` 秒;探测最多 180 s;预算用完 = `ytdlp_transient`。进度:预检后 2、探测后 10、下载中 10–90(按 `--progress-template` 打出的 `LIBPROG <已下> <总> <估计>` 行,单调不回退)、文件就绪 95、返回前 100;下载中每 `tick`(1 s)最多报一次,由取回阶段内部的一个小任务完成,`fetch` 返回或被取消前**一定**取消并等它(所以不需要进 `tests/background.py`)。
- **R-LI13 子进程。** `[sys.executable, "-I", "-X", "utf8", "-m", "yt_dlp", ...]`:`-I` 让下载目录(cwd = `_tmp/<id>`)永远不在 `sys.path` 上、忽略所有 `PYTHON*` 变量;因为 `-I` 会忽略 `PYTHONUTF8`,所以用 `-X utf8`。环境变量白名单 `PATH`、`HOME`(= 本条目 `_tmp`)、`LANG=C.UTF-8`、代理四个变量;Windows 开发机另加 `SYSTEMROOT`(没有它 Python 打不开套接字)。核对 `server/Dockerfile`:`ENV PATH="/app/.venv/bin:$PATH"`,所以白名单里的 `PATH` 能找到装在 venv 里的可执行文件(Task 6 依赖这一点)。
- **R-LI14 generic 提取器双保险。** 默认传 `--use-extractors default,-generic`(精确语法 Task 0 T0.1 在锁定版本上核对),并且探测结果的 `extractor_key == "Generic"` 时直接 `unsupported_site`;`library_link_allow_generic` 打开才两处都放开。
- **R-LI15(已被 R-LI23 取代)测试里的「可用性」用 property 打桩。** 初稿的做法是 `monkeypatch.setattr(Settings, "library_available", property(...))`;S1 把可用性做成了 `core.config.media_tools_present()` / `ytdlp_present()` 两个可 monkeypatch 的模块函数,现在改用它们。
- **R-LI16 代理走环境变量,cookies 走副本。** spec §7.2:代理「从 `library_ytdlp_proxy` 注入」环境;不放进 argv(argv 会出现在进程列表里)。yt-dlp 是否读环境代理**未验证**,T0.2 用 `-v` 的「Proxy map」一行核对(只记有没有,不抄值)。cookies:每次取回把配置的文件读出来(≤ 1 MiB)写到 `_tmp/<id>/cookies.txt`(0600),`finally` 里删除;原文件只读;读不到就不带 cookies 继续,日志只写「cookies unreadable」与条目 id。
- **R-LI17 JS 运行时(spec §7.3)走 Python 轮子,不改 Dockerfile。** `Dockerfile` 是 S1 的文件;核对它的构建阶段是 `uv sync --frozen --no-dev`,最终阶段 `PATH` 含 `/app/.venv/bin`,所以**只要运行时能以 Python 依赖的形式装进 venv**,改 `pyproject.toml`(本计划的文件)就够了。Task 6 是条件任务:T0.2 证明不需要 → 什么都不做;需要且 PyPI 上有可用的 `deno` 轮子(覆盖部署架构)→ 加依赖、填 `JS_RUNTIME_ARGS`;都不行 → 把需要的 Dockerfile 行写进结果文档交给 S1 所有者 / Z,本计划不改 Dockerfile,YouTube 在那之前记为「未验证 / 不可用」。**绝不**用 `--remote-components`(运行时从 GitHub 下载代码)。
- **R-LI18 取回结果缓存 `_tmp/<id>/fetch.json`。** spec §6.5:「阶段性产物(已下载的文件)还在 `_tmp` 里就接着用」。取回成功后写下文件名、标题、时长、字幕名、主机;下一次 `fetch`(后面的阶段失败后重试)先读它,文件都在就直接返回,不联网、不重新下载。文件名只认 `dl.<ext>` / 同目录(防路径穿越),坏缓存一律当作没有。*代价*:标题以文件形式留在 `_tmp`(随 `_tmp` 一起被 S1 清理;不是日志)。
- **R-LI19 大小与磁盘(spec §5.1)。** 探测后用所选格式的 `filesize` / `filesize_approx` 估计大小(合并格式取 `requested_formats` 之和):估计 > `library_max_upload_mb` → `too_large`(不下载);数据卷剩余 < 2 × 估计(估计未知时按 2 × 上限)→ `disk_full`。下载本身再用 `--max-filesize` 卡一次。
- **R-LI20 判定细则。** 播放列表:`_type ∈ {playlist, multi_video}`(带 `&list=` 的单视频链接因 `--no-playlist` 得到的是视频本身);直播:`is_live is True` 或 `live_status ∈ {is_live, is_upcoming, post_live}`;DRM:错误文本含 `\bDRM\b`,或探测出的**所有**格式 `has_drm` 为真;时长:`duration` > 上限分钟 × 60 才拒,缺失时放行(S1 的探测阶段会再查)。条目被排队后开关被关(或 yt-dlp 不见了)→ `link_disabled`。
- **R-LI21 端点细节(闸门按 R-LI23 修订)。** 依赖顺序:`current_user`(401)→ `library_enabled` 关(404 `Library is disabled`,`errors.api_error("disabled")`)→ `library_link_available` 假(链接开关关**或** yt-dlp 不在:404 `Link import is disabled`)→ 每分钟限流(手动调用 `core/deps.limited_user`,429)→ 体校验(422)→ 预检(400)→ `limits.admit_new_item`(S1 的错误;ffmpeg 缺失 = 503 `Media tools are not installed`)→ 建条目;建条目失败退还每日计数。成功 **200**,响应体 = `store.item_out(item)`(与列表项同形,W1 不需要新类型;本仓库创建类端点一律 200,如 `POST /api/users`)。核对 `core/deps.py::limited_user` 是普通协程函数,可以在开关检查之后手动调用;核对 `core/errors.py`:错误统一渲染成 `{"error": ...}`,422 只带字段名与 pydantic 的消息,不回显输入。
- **R-LI22 依赖 `yt-dlp[default]`,下限 `>=2025.11.12`,版本以 `uv.lock` 为准。** `[default]` 额外带上 yt-dlp 推荐的可选依赖(其中应包括解 YouTube 挑战用的 `yt-dlp-ejs`——**未验证**,T0.1 用 `uv tree` 核对);下限取「需要外部 JS 运行时」这一代的开始版本(计划作者的记忆,**未验证**,不影响解析出的最新版本)。升级流程:`cd server && uv lock --upgrade-package yt-dlp` → 跑本计划的测试 → 重建镜像(只在用户要求时)。不做应用内自动更新(spec §7.3、§14)。

---

## Task 0: spike S2(结果追加到 `docs/superpowers/plans/2026-10-13-video-import-results.md`)

**Files:**
- Modify(或 Create):`docs/superpowers/plans/2026-10-13-video-import-results.md`——文件不存在就新建,第一行 `# 跟读库(导入音视频 / 链接)· 结果记录`;**只在末尾追加**本节,不改别人的节。

- [ ] **Step 1 (T0.1,本机,只联网到 PyPI):锁定版本上的参数语法。** 在一次性环境里(不改仓库):

```bash
cd server
uv run --no-project --with "yt-dlp[default]>=2025.11.12" python -I -X utf8 -m yt_dlp --version
uv run --no-project --with "yt-dlp[default]>=2025.11.12" python -I -X utf8 -c "
import subprocess, sys
help_text = subprocess.run([sys.executable, '-I', '-X', 'utf8', '-m', 'yt_dlp', '--help'], capture_output=True, text=True).stdout
flags = ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--socket-timeout', '--retries',
         '--fragment-retries', '--use-extractors', '--cookies', '--dump-single-json', '--skip-download',
         '--merge-output-format', '--max-filesize', '--no-part', '--no-mtime', '--newline', '--progress-template',
         '--paths', '--output', '--write-subs', '--write-auto-subs', '--sub-langs', '--sub-format', '--convert-subs',
         '--js-runtimes', '--remote-components']
for f in flags:
    print(('ok      ' if f in help_text else 'MISSING ') + f)
"
uv run --no-project --with "yt-dlp[default]>=2025.11.12" python -I -X utf8 -m yt_dlp --ignore-config --use-extractors "default,-generic" --simulate -- "https://example.com/clip.mp4"; echo "exit=$?"
uv run --no-project --with "yt-dlp[default]>=2025.11.12" python -I -X utf8 -c "import importlib.metadata as m; print([r for r in m.requires('yt-dlp') or [] if 'default' in r])"
```

期望:版本号;除 `--js-runtimes` / `--remote-components`(只用来确认存在与否)之外的参数全部 `ok`;第三条输出含 `Unsupported URL`、退出码非 0(证明 `default,-generic` 关掉了通用提取器,且这一步不访问网络);第四条列出 `[default]` 带来的包,看有没有 `yt-dlp-ejs`。**任何一个 `MISSING`(除那两个外)都要停下**:在结果文档写明,改 `ytdlp.py` 里对应参数(并改 Task 3 测试里的断言)后再继续。

- [ ] **Step 2 (T0.2,开发机,需要用户同意:会访问 YouTube 并下载一段短视频):** 请用户提供一个公开、≤ 2 分钟的英语视频链接(结果文档里**不写链接**,只写主机名)。依次运行并只记录「成功 / 失败、`classify` 得到的种类、耗时秒数、产物大小」:

```bash
cd server
# (a) 不给 JS 运行时:PATH 只留系统目录(去掉 node / deno 所在目录;uv 用绝对路径调用)
UV="$(command -v uv)"; env PATH="/c/Windows/System32:/c/Windows:/usr/bin" "$UV" run --no-project --with "yt-dlp[default]>=2025.11.12" python -I -X utf8 -m yt_dlp --ignore-config --no-plugin-dirs --no-cache-dir --no-playlist --use-extractors "default,-generic" --dump-single-json --skip-download -f "bv*[height<=360][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=360]/b/ba" -- "<用户给的链接>" > "$TEMP/s2-info.json" 2> "$TEMP/s2-info.err"; echo "exit=$?"
# (b) 真实下载(最低清晰度,写到临时目录,跑完删除)
uv run --no-project --with "yt-dlp[default]>=2025.11.12" python -I -X utf8 -m yt_dlp --ignore-config --no-plugin-dirs --no-cache-dir --no-playlist --use-extractors "default,-generic" -f "bv*[height<=360][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=360]/b/ba" --merge-output-format mp4 --max-filesize 100M --no-part --newline --progress-template "download:LIBPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s" -P "$TEMP/s2-dl" -o "dl.%(ext)s" -o "subtitle:subs.%(ext)s" --write-subs --sub-langs en --convert-subs srt -- "<用户给的链接>"; echo "exit=$?"
```

记录:(a) 的 stderr 里有没有提到 JavaScript 运行时 / `n challenge`(只记有 / 没有),`formats` 数量;(b) 是否得到 `dl.mp4`、进度行是否形如 `LIBPROG <数> <数|NA> <数|NA>`、字幕文件名;再用 `uv run --no-project --with "yt-dlp[default]" --with deno ...` 重跑失败的那一步(若 PyPI 上有 `deno` 轮子),记录结果与 venv 里 `deno` 可执行文件的大小。(c) 设置 `HTTPS_PROXY=http://127.0.0.1:9`(一个不存在的本地代理)后加 `-v --simulate` 运行一次,看 `[debug] Proxy map` 是否包含它、是否因连不上代理而失败(证明 yt-dlp 读环境代理;只记是 / 否)。(d) 把 `$TEMP/s2-info.err` 和 (b) 的 stderr 逐行过一遍 `classify`(`uv run python -c "from app.library.ytdlp import classify; ..."`,Task 3 之后才能跑,可以回头补),记录得到的种类,**不抄原文**。跑完删除 `$TEMP/s2-*`。(e)(Addendum R-LI23)把 (b) 的下载命令里 `--max-filesize 100M` 改成 `--max-filesize 1K` 再跑一次(用同一个链接,下载到另一个临时目录):记录退出码是否为 0、有没有产生 `dl.*`、stdout 里有没有含 `max-filesize` 的一行(只记有 / 无,不抄原文);这是 `too_large` 判定唯一依赖的行为。开发机访问不了 YouTube(例如所在网络屏蔽)时如实写「开发机无法访问,改由 T0.3 验证」。

- [ ] **Step 3 (T0.3,目标服务器,BLOCKED:等 S1 + S2 合并且用户要求重建容器):** 用户重建并启动后,在容器里:`docker compose exec server python -I -X utf8 -m yt_dlp --version`;在后台打开 `LIBRARY_ENABLED` 与 `LIBRARY_LINK_IMPORT_ENABLED`,用网页或 `POST /api/library/imports` 导入 Step 2 的同一个链接,记录条目最终 `status` / `error_kind`、取回耗时;被拦(`blocked` / `login_required`)时如实记录,并按开放问题 5 的默认值**不**配 cookies / 代理(由用户另行决定)。镜像体积变化由 Z 统一记录。

- [ ] **Step 4: 写结果** — 在结果文档末尾追加:

````markdown
## S2 链接导入(spike S2,计划 2026-10-13-video-import-server-import)

| 项 | 结果 | 状态 |
|---|---|---|
| 锁定的 yt-dlp 版本 | <版本> | T0.1 |
| `[default]` 是否带 `yt-dlp-ejs` | 是 / 否 | T0.1 |
| 参数全部存在(`--use-extractors` 等) | 是 / 缺:<列表> | T0.1 |
| `--use-extractors "default,-generic"` 对通用 URL | `Unsupported URL`,退出码 <n> | T0.1 |
| 开发机:不给 JS 运行时能否下载 YouTube | 能 / 不能(stderr 提到 JS 运行时:是 / 否) | T0.2 |
| 开发机:有 deno 轮子时 | 能 / 不能 / 未测;deno 可执行文件约 <n> MB | T0.2 |
| yt-dlp 读环境代理 | 是 / 否 | T0.2 |
| 进度行格式 | 符合 / 不符合 `LIBPROG` | T0.2 |
| `--max-filesize 1K`:退出码 / 是否产生文件 / stdout 有无 `max-filesize` 行 | <0 \| 非 0> / <有 \| 无> / <有 \| 无> | T0.2(e) |
| `classify` 对真实错误文本 | <种类列表> | T0.2 |
| 目标服务器真实导入 | <status / error_kind / 秒> 或「未做」 | T0.3 |

结论:Task 6 走 <不需要 / deno 轮子 / 交给 Dockerfile 所有者>。
````

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "docs: record video import spike S2 (yt-dlp flags, JS runtime, proxy)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Task 0b: 核对 S1 接口(不写代码)

**Files:** 只读 S1 的文件;结果追加到结果文档本节末尾。

- [ ] **Step 1: 逐条核对 A-1 至 A-9**

```bash
cd server
uv run alembic heads
grep -n "class LibraryError\|^KINDS\|^ADMIT\|class Aborted\|def api_error\|def http_error" app/library/errors.py
grep -n "class FetchRequest\|class FetchResult\|class FetchStage\|class NoFetch\|title\b.*not item.title\|PLATFORM_SUBS\|Aborted" app/library/pipeline.py
grep -n "async def run\|class RunResult\|timed_out\|on_stdout_line\|cwd\|stdout: " app/library/media.py
grep -n "def set_fetch_stage\|def fetch_stage\|def wake\|app.state.library\|DROP_STAGING" app/library/worker.py app/main.py
grep -n "async def admit_new_item\|async def refund_new_item" app/library/limits.py
grep -n "async def create_item\|def item_out\|def clean_title" app/library/store.py
grep -n "class LibraryItem" app/models.py
grep -n "library_link_available\|library_available\|def media_tools_present\|def ytdlp_present\|library_ytdlp_proxy\|library_ytdlp_cookies_file\|library_link_timeout_minutes\|library_link_allow_generic" app/core/config.py
grep -n "plan S2" app/main.py
grep -n "\"library\"" tests/test_architecture.py
grep -n "library" tests/background.py
grep -n "def enable\|def library_settings\|def use_fakes\|def process\|def fake_media\|^SRT" tests/library_helpers.py
grep -n "imports" tests/test_library_privacy.py
```

- [ ] **Step 2: 对不上时的处理(只改本计划的文件)**

| 不一致 | 改哪里 |
|---|---|
| 错误类 / `KINDS` / `http_error` 名字不同 | `ytdlp.py` 与 `library_import.py` 的导入行;Task 3 的 `test_every_kind_the_stage_raises_is_a_library_kind` |
| `FetchRequest` / `FetchResult` 字段名不同 | `YtDlpFetch.fetch`、`load_cache`、Task 4 测试里的 `request()` 与 `FetchResult(...)` |
| `media.run` 参数名不同、没有 `cwd`、`stdout` 不在结果里 | 只改 `media_runner`(`-P` 与 `--cookies` 都是绝对路径,没有 `cwd` 可以去掉);**`stdout` 拿不到时停下上报**(探测必须读 JSON),不要自己另写子进程 |
| worker 的注册方法不同 | `library_import.install` 与 `test_create_app_registers_the_ytdlp_fetch_stage` |
| 限额助手 / store 函数名或参数不同 | `library_import.create_import` 里对应的那一行 |
| S1 用别的「标题未定」标记 | `create_import` 里 `clean_title(body.title) or ""` 这个表达式和 Task 5 的断言 |
| 没有 `plan S2` 锚点 | 按 R-LI2 的位置追加 |
| `media.run` 带回调时不再逐行回调(例如 S1 改成只缓存 stdout) | 只改 `media_runner`:`run` 返回后把 `result.stdout` 逐行喂给 `on_line` 再返回(`_download` 只认回调,R-LI23) |
| `tests/library_helpers.py` 的 `enable` / `use_fakes` / `process` / `fake_media` / `SRT` / `library_settings` 名字或签名不同 | 只改 Task 5 第二部分(端到端用例)的导入与调用;不改 S1 的文件 |
| `Aborted` 不在 `errors.py` 里 | 改 Task 4 测试 `test_an_aborted_report_stops_the_download` 的导入;实现不引用该名字(只让异常原样穿出) |

- [ ] **Step 3: 记录** — 在结果文档本节末尾追加一张「A-x → 真实名字」对照表(只有名字与签名,没有代码)。和 Task 0 合并成一个提交,或单独:

```bash
git add docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "docs: map plan S2 assumptions onto the merged library core" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 1: 依赖 `yt-dlp[default]`

**Files:**
- Modify: `server/pyproject.toml`、`server/uv.lock`(由 `uv add` 写)
- Create: `server/tests/test_library_ytdlp.py`(第一部分)

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_library_ytdlp.py`:

```python
"""The yt-dlp fetch stage (spec 2026-10-13-video-import §7): the dependency, argv / env rules, error classification,
probe checks, subtitle choice and `YtDlpFetch.fetch` with a fake child process. No network; the only real yt-dlp
run is `--version` (adapter test)."""
import importlib.metadata
import importlib.util


def test_ytdlp_dependency_is_installed():
    assert importlib.util.find_spec("yt_dlp") is not None
    assert importlib.metadata.version("yt-dlp")
```

- [ ] **Step 2: 运行确认失败**

`cd server && uv run pytest -q tests/test_library_ytdlp.py` → 失败(`find_spec("yt_dlp")` 为 `None`)。

- [ ] **Step 3: 加依赖**

```bash
cd server
uv add "yt-dlp[default]>=2025.11.12"
git diff --stat
uv tree --package yt-dlp
```

`git diff --stat` 只应有 `pyproject.toml`(`dependencies` 末尾多一行 `"yt-dlp[default]>=2025.11.12",`)和 `uv.lock`。`uv` 若警告「没有名为 `default` 的 extra」:改成 `uv add "yt-dlp>=2025.11.12"` 并在结果文档记一笔。把 `uv tree` 里 yt-dlp 的版本与它带来的包名写进结果文档(Task 0 那一节的「锁定版本」行)。

- [ ] **Step 4: 运行确认通过**

`cd server && uv run pytest -q tests/test_library_ytdlp.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/pyproject.toml server/uv.lock server/tests/test_library_ytdlp.py
git commit -m "chore(server): add yt-dlp for library link import" -m "Locked by uv.lock; upgrade with uv lock --upgrade-package yt-dlp (no in-app updates, spec 2026-10-13-video-import §7.3)." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: URL 预检 `app/library/urlcheck.py`

**Files:**
- Create: `server/app/library/urlcheck.py`
- Create: `server/tests/test_library_urlcheck.py`(第一部分)

**Interfaces:**
- Produces:`MAX_URL_CHARS = 2000`、`REASONS`、`KIND = "bad_url"`、`Resolver`、`UrlRejected(reason)`(`.reason`、`.kind`)、`CheckedUrl(url, host)`(+ `source_host`,≤ 64)、`blocked_address(address) -> bool`、`system_resolve(host)`、`parse(raw) -> CheckedUrl`、`async precheck(raw, *, resolver=None, timeout=5.0) -> CheckedUrl`。
- Consumes:只用标准库。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_library_urlcheck.py`:

```python
"""Link-import URL precheck (spec 2026-10-13-video-import §7.2) and `POST /api/library/imports` (§7.1, §9)."""
import asyncio

import pytest

from app.library import urlcheck
from app.library.urlcheck import UrlRejected, blocked_address, parse, precheck


def fake_resolver(*addresses: str, calls: list | None = None):
    async def resolve(host: str) -> list[str]:
        if calls is not None:
            calls.append(host)
        return list(addresses)
    return resolve


# ---- addresses ----

@pytest.mark.parametrize("address, blocked", [
    ("8.8.8.8", False), ("93.184.216.34", False), ("2606:4700:4700::1111", False),
    ("127.0.0.1", True), ("10.1.2.3", True), ("172.16.0.1", True), ("192.168.1.1", True),
    ("169.254.169.254", True), ("100.64.0.1", True), ("0.0.0.0", True), ("224.0.0.1", True),
    ("::1", True), ("fe80::1%eth0", True), ("fd00::1", True), ("::ffff:127.0.0.1", True),
    ("::ffff:8.8.8.8", False), ("not-an-ip", True),
])
def test_blocked_address(address, blocked):
    assert blocked_address(address) is blocked


# ---- syntax ----

@pytest.mark.parametrize("raw, reason", [
    ("", "empty"), ("   ", "empty"), (None, "empty"), (123, "empty"),
    ("https://example.com/" + "a" * 2000, "length"),
    ("https://exa mple.com/", "chars"), ("https://example.com/\x00", "chars"), ("https://example.com\\@10.0.0.1/", "chars"),
    ("ftp://example.com/a", "scheme"), ("file:///etc/passwd", "scheme"), ("javascript:alert(1)", "scheme"),
    ("example.com/watch", "scheme"), ("//example.com/a", "scheme"),
    ("https://user:pw@example.com/", "userinfo"), ("https://user@example.com/", "userinfo"),
    ("https://example.com:22/", "port"), ("https://example.com:8080/", "port"), ("https://example.com:99999/", "port"),
    ("https:///path", "host"), ("https://[::1/", "host"), ("https://intranet/", "host"),
    ("http://localhost/", "private"), ("http://LOCALHOST./", "private"), ("http://a.localhost/", "private"),
    ("http://nas.local/", "private"), ("http://metadata.google.internal/", "private"), ("http://router.lan/", "private"),
    ("http://x.home.arpa/", "private"), ("http://abc.onion/", "private"),
    ("http://127.0.0.1/", "private"), ("http://[::1]/", "private"), ("http://169.254.169.254/latest/", "private"),
    ("http://10.0.0.5:80/", "private"),
])
def test_parse_rejects(raw, reason):
    with pytest.raises(UrlRejected) as info:
        parse(raw)
    assert info.value.reason == reason and info.value.reason in urlcheck.REASONS
    assert info.value.kind == "bad_url"
    assert "example" not in str(info.value)  # the message is the reason code, never the URL


@pytest.mark.parametrize("raw, url, host", [
    ("https://www.youtube.com/watch?v=abc123#t=30", "https://www.youtube.com/watch?v=abc123", "www.youtube.com"),
    ("  HTTPS://WWW.Example.COM  ", "https://www.example.com/", "www.example.com"),
    ("http://example.com:80/a?b=1", "http://example.com:80/a?b=1", "example.com"),
    ("https://example.com.:443/v", "https://example.com:443/v", "example.com"),
    ("https://bücher.example/x", "https://xn--bcher-kva.example/x", "xn--bcher-kva.example"),
    ("http://8.8.8.8/v", "http://8.8.8.8/v", "8.8.8.8"),
    ("http://[2606:4700:4700::1111]/v", "http://[2606:4700:4700::1111]/v", "2606:4700:4700::1111"),
])
def test_parse_normalises(raw, url, host):
    checked = parse(raw)
    assert (checked.url, checked.host) == (url, host)


def test_source_host_fits_the_column():
    checked = parse("https://" + "a" * 40 + "." + "b" * 30 + ".example.com/v")
    assert len(checked.source_host) == 64 and checked.host.startswith(checked.source_host)


# ---- DNS ----

async def test_precheck_accepts_public_addresses():
    calls: list[str] = []
    checked = await precheck("https://www.youtube.com/watch?v=x", resolver=fake_resolver("142.250.1.1", "2607:f8b0::1", calls=calls))
    assert checked.host == "www.youtube.com" and calls == ["www.youtube.com"]


@pytest.mark.parametrize("addresses", [("10.0.0.1",), ("8.8.8.8", "127.0.0.1"), ("::1",), ("169.254.169.254",)])
async def test_precheck_rejects_any_private_address(addresses):
    with pytest.raises(UrlRejected) as info:
        await precheck("https://rebind.example.com/v", resolver=fake_resolver(*addresses))
    assert info.value.reason == "private"


async def test_precheck_resolution_failures_are_rejected():
    async def boom(host):
        raise OSError("nodename nor servname provided")

    async def slow(host):
        await asyncio.sleep(10)
        return ["8.8.8.8"]

    for resolver in (boom, fake_resolver()):
        with pytest.raises(UrlRejected) as info:
            await precheck("https://nowhere.example.com/", resolver=resolver)
        assert info.value.reason == "resolve"
    with pytest.raises(UrlRejected) as info:
        await precheck("https://slow.example.com/", resolver=slow, timeout=0.05)
    assert info.value.reason == "resolve"


async def test_precheck_skips_dns_for_public_literals():
    calls: list[str] = []
    checked = await precheck("http://8.8.8.8/v", resolver=fake_resolver("10.0.0.1", calls=calls))
    assert checked.host == "8.8.8.8" and calls == []


async def test_precheck_uses_the_module_resolver_by_default(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr("app.library.urlcheck.system_resolve", fake_resolver("8.8.8.8", calls=calls))
    await precheck("https://example.org/v")
    assert calls == ["example.org"]
```

- [ ] **Step 2: 运行确认失败**

`cd server && uv run pytest -q tests/test_library_urlcheck.py` → 收集失败(`ModuleNotFoundError: app.library.urlcheck`)。

- [ ] **Step 3: 实现** — 创建 `server/app/library/urlcheck.py`:

```python
"""Link-import URL precheck (spec 2026-10-13-video-import §7.2). Standard library only.

Written for the library on its own: `app.library` may not import `app.admin.probes` (layering), so the address rule
is the same as `probes._blocked` but kept here (spec §14: merging the two is out of scope).

Passing the check describes the moment it ran. DNS rebinding and site redirects to private addresses can still
bypass it (residual risk, spec §7.2); the generic extractor is therefore off by default and the fetch stage runs
the check again right before yt-dlp starts. Nothing here logs or returns the URL: `UrlRejected.reason` is a fixed
code (for logs and tests), and every rejection maps to the one error kind `bad_url`."""
from __future__ import annotations

import asyncio
import ipaddress
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

MAX_URL_CHARS = 2000
SCHEMES = ("http", "https")
ALLOWED_PORTS = (None, 80, 443)
RESOLVE_TIMEOUT = 5.0
BLOCKED_NAMES = ("localhost",)
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa", ".onion")
REASONS = ("empty", "length", "chars", "scheme", "userinfo", "host", "port", "private", "resolve")
KIND = "bad_url"

Resolver = Callable[[str], Awaitable[list[str]]]


class UrlRejected(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason
        self.kind = KIND


@dataclass(frozen=True)
class CheckedUrl:
    url: str  # normalised: lowercase scheme, IDNA host, no fragment
    host: str  # lowercase ASCII host (IDNA), no port, no brackets

    @property
    def source_host(self) -> str:
        """For `library_items.source_host` (`String(64)`)."""
        return self.host[:64]


def blocked_address(address: str) -> bool:
    """True for anything that is not a public unicast address (loopback, private, link-local incl. 169.254.169.254,
    CGNAT, multicast, reserved, unspecified; IPv4-mapped IPv6 is judged as IPv4). Unparseable = blocked."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return True
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not ip.is_global or ip.is_multicast


def _literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


async def system_resolve(host: str) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    return [info[4][0] for info in infos]


def parse(raw: object) -> CheckedUrl:
    """Syntax rules only (no DNS). Raises `UrlRejected`."""
    if not isinstance(raw, str) or not raw.strip():
        raise UrlRejected("empty")
    url = raw.strip()
    if len(url) > MAX_URL_CHARS:
        raise UrlRejected("length")
    if any(c.isspace() or ord(c) < 0x20 or ord(c) == 0x7F or c == "\\" for c in url):
        raise UrlRejected("chars")
    try:
        parts = urlsplit(url)
    except ValueError:  # e.g. an unbalanced IPv6 bracket
        raise UrlRejected("host") from None
    if parts.scheme.lower() not in SCHEMES:
        raise UrlRejected("scheme")
    if "@" in parts.netloc:
        raise UrlRejected("userinfo")
    try:
        port = parts.port
    except ValueError:
        raise UrlRejected("port") from None
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise UrlRejected("host")
    if _literal(host):
        ascii_host = host.lower()
    else:
        try:
            ascii_host = host.encode("idna").decode("ascii").lower()
        except UnicodeError:
            raise UrlRejected("host") from None
        if ascii_host in BLOCKED_NAMES or ascii_host.endswith(BLOCKED_SUFFIXES):
            raise UrlRejected("private")
        if "." not in ascii_host:  # single-label names resolve through search domains (intranet)
            raise UrlRejected("host")
    if port not in ALLOWED_PORTS:
        raise UrlRejected("port")
    if _literal(ascii_host) and blocked_address(ascii_host):
        raise UrlRejected("private")
    netloc = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return CheckedUrl(urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", parts.query, "")), ascii_host)


async def precheck(raw: object, *, resolver: Resolver | None = None,
                   timeout: float = RESOLVE_TIMEOUT) -> CheckedUrl:
    """`parse` + every resolved address must be public. `resolver(host) -> [addresses]` replaces DNS in tests."""
    checked = parse(raw)
    if _literal(checked.host):
        return checked
    try:
        async with asyncio.timeout(timeout):
            addresses = await (resolver or system_resolve)(checked.host)
    except (OSError, UnicodeError, ValueError, TimeoutError):
        raise UrlRejected("resolve") from None
    if not addresses:
        raise UrlRejected("resolve")
    if any(blocked_address(a) for a in addresses):
        raise UrlRejected("private")
    return checked
```

- [ ] **Step 4: 运行确认通过**

`cd server && uv run pytest -q tests/test_library_urlcheck.py tests/test_architecture.py` → 全绿(写计划时实跑:本文件 66 个用例通过)。

- [ ] **Step 5: 提交**

```bash
git add server/app/library/urlcheck.py server/tests/test_library_urlcheck.py
git commit -m "feat(server): add the library link URL precheck" -m "Public addresses only (every resolved address), http/https on default ports, no userinfo, no single-label or local names; one bad_url kind, reason codes only in logs (spec 2026-10-13-video-import §7.2)." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: `ytdlp.py` 第一部分:参数、环境、分类、探测判定、字幕选择、缓存、进度(纯函数)

**Files:**
- Create: `server/app/library/ytdlp.py`(第一部分)
- Modify: `server/tests/test_library_ytdlp.py`(末尾追加第二部分)

**Interfaces:**
- Produces(`app/library/ytdlp.py`):`MB`、`INFO_TIMEOUT = 180.0`、`SOCKET_TIMEOUT`、`RETRIES`、`COOKIES_NAME`、`CACHE_NAME`、`MAX_COOKIES_BYTES`、`JS_RUNTIME_ARGS`、`MEDIA_SUFFIXES`、`MANUAL_LANGS`、`AUTO_LANGS`、`LIVE_STATUSES`、`PROGRESS_TEMPLATE`、`P_CHECKED / P_PROBED / P_DOWNLOADED / P_DONE`、`CLASSIFY`、`KINDS_RAISED`、`installed_version()`、`classify(stderr)`、`clean_title(value)`、`format_selector(h)`、`child_env(tmp, proxy)`、`common_args(...)`、`info_args(...)`、`download_args(...)`、`check_info(info, *, max_minutes, allow_generic)`、`estimate_bytes(info)`、`check_space(estimate, cap_bytes, free_bytes)`、`pick_subtitles(info, asr_available)`、`find_media(tmp)`、`find_subtitles(tmp)`、`copy_cookies(source, tmp, item_id)`、`save_cache(tmp, result)`、`load_cache(tmp)`、`Progress(low, high).feed(line)`。
- Consumes:A-1 `LibraryError`、A-2 `FetchRequest` / `FetchResult`、A-3 模块 `media`(本部分只导入)、`urlcheck`。

- [ ] **Step 1: 写失败测试** — 在 `server/tests/test_library_ytdlp.py` 末尾追加(前面空两行;本部分自带导入块,`# noqa: E402` 是有意的):

```python
# ==== Task 3: pure helpers ====
import sys  # noqa: E402

import pytest  # noqa: E402

from app.library import errors, ytdlp  # noqa: E402
from app.library.errors import LibraryError  # noqa: E402

URL = "https://www.youtube.com/watch?v=SECRETVIDEO1"
TITLE = "A very private title 42"


def info(**over):
    data = {"_type": "video", "id": "SECRETVIDEO1", "title": TITLE, "duration": 61.5, "extractor_key": "Youtube",
            "is_live": False, "live_status": "not_live", "formats": [{"format_id": "18"}],
            "requested_formats": [{"filesize": 10 * ytdlp.MB}, {"filesize_approx": 2 * ytdlp.MB}],
            "subtitles": {"en": [{"ext": "vtt"}]}, "automatic_captions": {"en": [], "en-orig": [], "fr": []}}
    data.update(over)
    return data


# ---- classification ----

@pytest.mark.parametrize("stderr, kind", [
    ("ERROR: [youtube] abc: This video is DRM protected", "drm"),
    ("ERROR: [youtube] abc: This live event will begin in 3 hours.", "live_unsupported"),
    ("ERROR: [youtube] abc: Premieres in 2 days", "live_unsupported"),
    ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser", "blocked"),
    ("ERROR: [youtube] abc: Sign in to confirm you're not a bot", "blocked"),
    ("ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests", "blocked"),
    ("ERROR: [youtube] abc: Video unavailable. The uploader has not made this video available in your country", "geo_blocked"),
    ("ERROR: [vimeo] 1: This video is not available from your location due to geo restriction", "geo_blocked"),
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video", "private"),
    ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate", "login_required"),
    ("ERROR: [youtube] abc: Join this channel to get access to members-only content", "login_required"),
    ("ERROR: Unsupported URL: https://example.com/page", "unsupported_site"),
    ("ERROR: 'foo' is not a valid URL. Set --default-search", "bad_url"),
    ("ERROR: [youtube] abc: n challenge solving failed: No supported JavaScript runtime", "ytdlp_failed"),
    ("ERROR: [youtube] abc: Requested format is not available", "ytdlp_failed"),
    ("ERROR: Unable to download webpage: <urlopen error timed out>", "network"),
    ("ERROR: Unable to download webpage: [Errno 104] Connection reset by peer", "network"),
    ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "ytdlp_transient"),
    ("ERROR: Unable to download JSON metadata: HTTP Error 503", "ytdlp_transient"),
    ("ERROR: something nobody has seen before", "ytdlp_failed"),
    ("", "ytdlp_failed"),
])
def test_classify(stderr, kind):
    assert ytdlp.classify(stderr) == kind


def test_classify_ignores_urls_and_prefers_error_lines():
    assert ytdlp.classify("ERROR: Unsupported URL: https://example.com/what-is-drm-explained") == "unsupported_site"
    assert ytdlp.classify("WARNING: [youtube] Sign in to confirm your age\nERROR: Unable to download webpage: "
                          "<urlopen error timed out>") == "network"
    assert ytdlp.classify("WARNING: login required for hd\nsome other text") == "login_required"  # no ERROR line


def test_every_kind_the_stage_raises_is_a_library_kind():
    assert ytdlp.KINDS_RAISED <= errors.KINDS
    assert {kind for kind, _ in ytdlp.CLASSIFY} <= errors.KINDS


# ---- argv and environment ----

def test_info_args(tmp_path):
    argv = ytdlp.info_args(URL, allow_generic=False, cookies=None, max_height=480)
    assert argv[:6] == [sys.executable, "-I", "-X", "utf8", "-m", "yt_dlp"]
    for flag in ("--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-playlist", "--dump-single-json",
                 "--skip-download"):
        assert flag in argv
    assert argv[argv.index("--use-extractors") + 1] == "default,-generic"
    assert argv[-2:] == ["--", URL] and "[height<=480]" in argv[argv.index("-f") + 1]
    assert "--cookies" not in argv and not any(a.startswith("--exec") for a in argv)
    generic = ytdlp.info_args(URL, allow_generic=True, cookies=tmp_path / "c.txt", max_height=720)
    assert "--use-extractors" not in generic and generic[generic.index("--cookies") + 1] == str(tmp_path / "c.txt")


def test_format_selector_prefers_h264_and_falls_back_to_audio():
    assert ytdlp.format_selector(720) == ("bv*[height<=720][ext=mp4][vcodec^=avc1]+ba[ext=m4a]"
                                          "/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b/ba")


def test_download_args(tmp_path):
    argv = ytdlp.download_args(URL, tmp_path, allow_generic=False, cookies=None, max_height=720, max_mb=500,
                               sub_lang="en-US", sub_auto=False)
    pairs = {argv[i]: argv[i + 1] for i in range(len(argv) - 1)}
    assert pairs["--max-filesize"] == "500M" and pairs["-P"] == str(tmp_path)
    assert pairs["--merge-output-format"] == "mp4" and pairs["--sub-langs"] == r"en\-US"
    assert pairs["--convert-subs"] == "srt" and "--write-subs" in argv and "--write-auto-subs" not in argv
    assert [argv[i + 1] for i, a in enumerate(argv) if a == "-o"] == ["dl.%(ext)s", "subtitle:subs.%(ext)s"]
    assert "--no-part" in argv and "--newline" in argv and argv[-2:] == ["--", URL]
    auto = ytdlp.download_args(URL, tmp_path, allow_generic=False, cookies=None, max_height=720, max_mb=500,
                               sub_lang="en-orig", sub_auto=True)
    assert "--write-auto-subs" in auto and "--write-subs" not in auto
    none = ytdlp.download_args(URL, tmp_path, allow_generic=False, cookies=None, max_height=720, max_mb=500,
                               sub_lang=None, sub_auto=False)
    assert "--sub-langs" not in none and "--write-subs" not in none


def test_child_env_is_a_whitelist(monkeypatch, tmp_path):
    for key in ("UPSTREAM_LLM_KEY", "ADMIN_PASSWORD", "DATABASE_URL", "AZURE_SPEECH_KEY", "PYTHONPATH",
                "HTTPS_PROXY"):
        monkeypatch.setenv(key, "leak-" + key)
    env = ytdlp.child_env(tmp_path, "")
    assert set(env) <= {"PATH", "HOME", "LANG", "SYSTEMROOT"} and env["HOME"] == str(tmp_path)
    assert not any("leak-" in v for v in env.values())
    proxied = ytdlp.child_env(tmp_path, "http://user:pw@proxy.example:3128")
    assert {proxied[k] for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")} == {
        "http://user:pw@proxy.example:3128"}


# ---- probe checks ----

@pytest.mark.parametrize("over, kind", [
    ({"_type": "playlist"}, "playlist_unsupported"), ({"_type": "multi_video"}, "playlist_unsupported"),
    ({"is_live": True}, "live_unsupported"), ({"live_status": "is_upcoming"}, "live_unsupported"),
    ({"live_status": "post_live"}, "live_unsupported"),
    ({"extractor_key": "Generic"}, "unsupported_site"),
    ({"formats": [{"has_drm": True}, {"has_drm": "maybe"}]}, "drm"),
    ({"duration": 90 * 60 + 1}, "too_long"),
])
def test_check_info_refuses(over, kind):
    with pytest.raises(LibraryError) as e:
        ytdlp.check_info(info(**over), max_minutes=90, allow_generic=False)
    assert e.value.kind == kind


def test_check_info_accepts():
    ytdlp.check_info(info(), max_minutes=90, allow_generic=False)
    ytdlp.check_info(info(extractor_key="Generic"), max_minutes=90, allow_generic=True)
    ytdlp.check_info(info(duration=None, formats=[{"has_drm": True}, {"has_drm": False}]), max_minutes=1,
                     allow_generic=False)


def test_estimate_and_space():
    assert ytdlp.estimate_bytes(info()) == 12 * ytdlp.MB
    assert ytdlp.estimate_bytes({"filesize_approx": 5.5}) == 5
    assert ytdlp.estimate_bytes({"requested_formats": [{"filesize": 1}, {}]}) is None
    ytdlp.check_space(10, 100, 20)
    for args, kind in (((101, 100, 10 ** 9), "too_large"), ((10, 100, 19), "disk_full"), ((None, 100, 199), "disk_full")):
        with pytest.raises(LibraryError) as e:
            ytdlp.check_space(*args)
        assert e.value.kind == kind


@pytest.mark.parametrize("subs, auto, asr, expected", [
    ({"en": []}, {}, False, ("en", False)),
    ({"en-GB": [], "en-US": []}, {}, True, ("en-US", False)),
    ({"en-CA": [], "de": []}, {}, True, ("en-CA", False)),
    ({"live_chat": [], "de": []}, {"en-orig": [], "en": []}, False, ("en-orig", True)),
    ({}, {"en": [], "fr": []}, False, ("en", True)),
    ({}, {"en": []}, True, (None, False)),  # ASR is preferred over auto captions (E6)
    ({}, {"en-de": [], "fr": []}, False, (None, False)),  # translated tracks are never used
    ({}, {}, False, (None, False)),
])
def test_pick_subtitles(subs, auto, asr, expected):
    assert ytdlp.pick_subtitles({"subtitles": subs, "automatic_captions": auto}, asr) == expected


def test_progress_is_monotonic_and_bounded():
    p = ytdlp.Progress(10, 90)
    for line in ("noise", "LIBPROG 50 100 NA", "LIBPROG 10 100 NA", "LIBPROG 1 NA 4.0", "LIBPROG NA NA NA",
                 "LIBPROG 999 100 NA"):
        p.feed(line)
    assert p.value == 90
    q = ytdlp.Progress(10, 90)
    q.feed("LIBPROG 25 NA 100.0")
    assert q.value == 30


def test_find_media_ignores_partial_merges(tmp_path):
    (tmp_path / "dl.f137.mp4").write_bytes(b"x" * 50)
    (tmp_path / "subs.en.srt").write_text("1")
    assert ytdlp.find_media(tmp_path) is None
    (tmp_path / "dl.webm").write_bytes(b"x" * 5)
    assert ytdlp.find_media(tmp_path) == tmp_path / "dl.webm"
    assert ytdlp.find_subtitles(tmp_path) == tmp_path / "subs.en.srt"


def test_installed_version_matches_the_dependency():
    assert ytdlp.installed_version() == importlib.metadata.version("yt-dlp")


def test_clean_title():
    assert ytdlp.clean_title("  A\tB\n\x00C  ") == "A B C"
    assert ytdlp.clean_title("x" * 300) == "x" * 200
    assert ytdlp.clean_title(None) is None and ytdlp.clean_title("   ") is None


```

- [ ] **Step 2: 运行确认失败**

`cd server && uv run pytest -q tests/test_library_ytdlp.py` → 收集失败(`ImportError: cannot import name 'ytdlp'`)。

- [ ] **Step 3: 实现** — 创建 `server/app/library/ytdlp.py`(第一部分;Task 4 接在末尾):

```python
"""The link-import fetch stage (spec 2026-10-13-video-import §7): yt-dlp as a child process.

`YtDlpFetch.fetch(req)` is the real `app.library.pipeline.FetchStage` (S1 ships only the interface and a default
that raises `unsupported_site`); `routers/library_import.install(app)` registers it on the worker.

Steps (spec §7.1): re-run the URL precheck (DNS may have changed since the item was queued) -> `--dump-single-json`
(title, duration, live / playlist / DRM, subtitle lists; all permanent refusals happen before any download) ->
size + disk check -> download into `_tmp/<item>/dl.<ext>` (+ at most one English subtitle file `subs.<lang>.srt`).

Safety (spec §7.2, §13):
- `python -I -X utf8 -m yt_dlp` (isolated: no PYTHON* variables, no user site, the downloads directory is never on
  `sys.path`), never through a shell, `--` before the URL, `--ignore-config --no-plugin-dirs --no-cache-dir`, no
  `--exec`; fixed output names only;
- the child environment is a whitelist (`child_env`): PATH, HOME (= the item's `_tmp`), LANG and, when configured,
  the proxy variables; never UPSTREAM_*, *_KEY, ADMIN_*, DATABASE_URL;
- the generic extractor is off unless `library_link_allow_generic` (`--use-extractors default,-generic` and an
  `extractor_key` check on the probe result);
- cookies are copied into `_tmp` (mode 0600) for each run and deleted in `finally`; the configured file is only read;
- stderr / stdout are only classified (`classify`, a fixed regex table) or parsed for progress, then dropped. Logs
  carry the item id, the error kind, the exit code, milliseconds and byte counts: never the URL, the title, subtitle
  text, yt-dlp output, the cookies path or the proxy."""
from __future__ import annotations

import asyncio
import importlib.metadata
import json
import logging
import math
import os
import re
import shutil
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.library import media, urlcheck
from app.library.errors import LibraryError
from app.library.pipeline import FetchRequest, FetchResult

logger = logging.getLogger(__name__)

MB = 1_048_576
INFO_TIMEOUT = 180.0  # seconds for the probe; the download gets the rest of library_link_timeout_minutes
SOCKET_TIMEOUT = 15
RETRIES = 3
COOKIES_NAME = "cookies.txt"
CACHE_NAME = "fetch.json"  # a finished fetch, reused by a retry of a later stage (spec §6.5): no second download
MAX_COOKIES_BYTES = MB
# Extra arguments that select the JavaScript runtime for YouTube challenges; filled by Task 6 from spike T0.2
# (empty = yt-dlp's own default). Never `--remote-components`: no code is downloaded at run time (spec §7.3).
JS_RUNTIME_ARGS: tuple[str, ...] = ()
MEDIA_SUFFIXES = frozenset({".mp4", ".m4a", ".m4v", ".mov", ".webm", ".mkv", ".mp3", ".aac", ".ogg", ".opus",
                            ".oga", ".flac", ".wav", ".flv", ".3gp"})
MANUAL_LANGS = ("en", "en-US", "en-GB")
AUTO_LANGS = ("en-orig", "en")  # never a machine-translated track
LIVE_STATUSES = frozenset({"is_live", "is_upcoming", "post_live"})
PROGRESS_TEMPLATE = ("download:LIBPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s "
                     "%(progress.total_bytes_estimate)s")
# progress inside the fetch stage (S1 maps 0-100 onto the pipeline's 0-40)
P_CHECKED, P_PROBED, P_DOWNLOADED, P_DONE = 2, 10, 95, 100

_PROGRESS = re.compile(r"^LIBPROG (\d+(?:\.\d+)?) (\S+) (\S+)$")
_URLS = re.compile(r"https?://\S+", re.I)
_EN = re.compile(r"en(?:[-_][A-Za-z0-9]+)*")
_TOO_LARGE = re.compile(r"larger than max-filesize", re.I)

# First match wins. Applied to yt-dlp's ERROR lines first, then to all of stderr; URLs are blanked out before
# matching so a link or a slug can never decide the kind. Unmatched -> ytdlp_failed.
CLASSIFY: tuple[tuple[str, re.Pattern[str]], ...] = tuple((kind, re.compile(pattern, re.I)) for kind, pattern in (
    ("drm", r"\bDRM\b"),
    ("live_unsupported", r"live event will begin|premieres? in \d|this live stream|is (?:currently )?live\b"
                         r"|live stream recording is not available"),
    ("blocked", r"not a bot|HTTP Error 429|too many requests|unusual traffic|IP (?:address )?(?:is |has been )?blocked"),
    ("geo_blocked", r"not available in your country|not made this video available in your country"
                    r"|available from your location|geo[- ]?restrict"),
    ("private", r"private video|this video is private|video is private"),
    ("login_required", r"sign in to confirm your age|age[- ]restricted|members[- ]only|join this channel"
                       r"|login required|requires? (?:a )?(?:login|account|subscription|authentication)|sign in"),
    ("unsupported_site", r"unsupported url|no suitable (?:infoextractor|extractor)"),
    ("bad_url", r"is not a valid url"),
    ("too_large", r"larger than max-filesize"),
    ("ytdlp_failed", r"javascript runtime|n challenge|\bnsig\b|signature extraction failed|unable to extract"
                     r"|requested format is not available"),
    ("network", r"timed out|connection (?:reset|refused|aborted)|temporary failure in name resolution"
                r"|name or service not known|getaddrinfo failed|network is unreachable|remote end closed"
                r"|incompleteread|eof occurred|urlopen error"),
    ("ytdlp_transient", r"HTTP Error 5\d\d|HTTP Error 403|unable to download (?:webpage|api page|json)"
                        r"|giving up after \d+ (?:fragment )?retries"),
))
KINDS_RAISED = frozenset({kind for kind, _ in CLASSIFY} | {
    "link_disabled", "bad_url", "playlist_unsupported", "unsupported_site", "too_long", "too_large", "disk_full",
    "ytdlp_failed", "ytdlp_transient"})


def installed_version() -> str | None:
    """The installed yt-dlp version (admin overview, spec §12), or None when the package is missing."""
    try:
        return importlib.metadata.version("yt-dlp")
    except importlib.metadata.PackageNotFoundError:
        return None


# ---- pure helpers ----

def _match(text: str) -> str | None:
    for kind, pattern in CLASSIFY:
        if pattern.search(text):
            return kind
    return None


def classify(stderr: str) -> str:
    text = _URLS.sub(" ", stderr or "")
    errors = "\n".join(line for line in text.splitlines() if line.lstrip().startswith("ERROR"))
    return _match(errors) or _match(text) or "ytdlp_failed"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return float(value)


def clean_title(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join("".join(c if c.isprintable() else " " for c in value).split())
    return text[:200] or None


def format_selector(max_height: int) -> str:
    h = int(max_height)
    return (f"bv*[height<={h}][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[height<={h}][ext=mp4]+ba[ext=m4a]"
            f"/b[height<={h}]/b/ba")


def child_env(tmp: Path, proxy: str | None) -> dict[str, str]:
    env = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(tmp), "LANG": "C.UTF-8"}
    if os.name == "nt":  # dev machines only: Python cannot open sockets without it
        env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", r"C:\Windows")
    if proxy:
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            env[key] = proxy
    return env


def common_args(*, allow_generic: bool, cookies: Path | None) -> list[str]:
    args = [sys.executable, "-I", "-X", "utf8", "-m", "yt_dlp", "--ignore-config", "--no-plugin-dirs",
            "--no-cache-dir", "--no-playlist", "--socket-timeout", str(SOCKET_TIMEOUT), "--retries", str(RETRIES),
            "--fragment-retries", str(RETRIES), *JS_RUNTIME_ARGS]
    if not allow_generic:
        args += ["--use-extractors", "default,-generic"]
    if cookies is not None:
        args += ["--cookies", str(cookies)]
    return args


def info_args(url: str, *, allow_generic: bool, cookies: Path | None, max_height: int) -> list[str]:
    return [*common_args(allow_generic=allow_generic, cookies=cookies), "--dump-single-json", "--skip-download",
            "-f", format_selector(max_height), "--", url]


def download_args(url: str, tmp: Path, *, allow_generic: bool, cookies: Path | None, max_height: int,
                  max_mb: int, sub_lang: str | None, sub_auto: bool) -> list[str]:
    args = [*common_args(allow_generic=allow_generic, cookies=cookies), "-f", format_selector(max_height),
            "--merge-output-format", "mp4", "--max-filesize", f"{int(max_mb)}M", "--no-part", "--no-mtime",
            "--newline", "--progress-template", PROGRESS_TEMPLATE, "-P", str(tmp), "-o", "dl.%(ext)s",
            "-o", "subtitle:subs.%(ext)s"]
    if sub_lang:
        args += ["--write-auto-subs" if sub_auto else "--write-subs", "--sub-langs", re.escape(sub_lang),
                 "--sub-format", "srt/vtt/best", "--convert-subs", "srt"]
    return [*args, "--", url]


def check_info(info: dict, *, max_minutes: int, allow_generic: bool) -> None:
    """Permanent refusals decided before any byte of media is downloaded (spec §7.1 step 1, §7.4)."""
    if info.get("_type") in ("playlist", "multi_video"):
        raise LibraryError("playlist_unsupported")
    if info.get("is_live") is True or info.get("live_status") in LIVE_STATUSES:
        raise LibraryError("live_unsupported")
    extractor = str(info.get("extractor_key") or info.get("extractor") or "").lower()
    if not allow_generic and extractor == "generic":
        raise LibraryError("unsupported_site")
    formats = [f for f in info.get("formats") or [] if isinstance(f, dict)]
    if formats and all(f.get("has_drm") for f in formats):
        raise LibraryError("drm")
    duration = _number(info.get("duration"))
    if duration is not None and duration > max_minutes * 60:
        raise LibraryError("too_long")


def estimate_bytes(info: dict) -> int | None:
    """Sum of the selected formats' sizes (exact or approximate); None when any part is unknown."""
    parts = info.get("requested_formats") or [info]
    total = 0.0
    for part in parts:
        if not isinstance(part, dict):
            return None
        size = _number(part.get("filesize")) or _number(part.get("filesize_approx"))
        if not size:
            return None
        total += size
    return int(total)


def check_space(estimate: int | None, cap_bytes: int, free_bytes: int) -> None:
    if estimate is not None and estimate > cap_bytes:
        raise LibraryError("too_large")
    if free_bytes < 2 * (estimate if estimate is not None else cap_bytes):
        raise LibraryError("disk_full")


def _pick_lang(keys, preferred: tuple[str, ...], *, any_english: bool) -> str | None:
    names = [k for k in keys if isinstance(k, str)]
    for lang in preferred:
        if lang in names:
            return lang
    if any_english:
        english = sorted(k for k in names if _EN.fullmatch(k))
        return english[0] if english else None
    return None


def pick_subtitles(info: dict, asr_available: bool) -> tuple[str | None, bool]:
    """(language key, is_auto). Spec E6: manual English > (ASR, decided by the pipeline) > platform auto captions,
    and auto captions only when ASR is unavailable."""
    manual = info.get("subtitles") if isinstance(info.get("subtitles"), dict) else {}
    lang = _pick_lang(manual.keys(), MANUAL_LANGS, any_english=True)
    if lang:
        return lang, False
    if asr_available:
        return None, False
    auto = info.get("automatic_captions") if isinstance(info.get("automatic_captions"), dict) else {}
    lang = _pick_lang(auto.keys(), AUTO_LANGS, any_english=False)
    return (lang, True) if lang else (None, False)


def find_media(tmp: Path) -> Path | None:
    """`dl.<ext>` only: `dl.f137.mp4`-style leftovers of a failed merge never count."""
    found = [p for p in tmp.iterdir() if p.is_file() and p.stem == "dl" and p.suffix.lower() in MEDIA_SUFFIXES]
    return max(found, key=lambda p: p.stat().st_size) if found else None


def find_subtitles(tmp: Path) -> Path | None:
    found = sorted(p for p in tmp.glob("subs.*.srt") if p.is_file())
    return found[0] if found else None


def copy_cookies(source: str | None, tmp: Path, item_id: str) -> Path | None:
    if not source:
        return None
    try:
        path = Path(source)
        if path.stat().st_size > MAX_COOKIES_BYTES:
            raise OSError("too large")
        data = path.read_bytes()
    except OSError:
        logger.warning("library fetch cookies unreadable item=%s", item_id)  # never the path
        return None
    target = tmp / COOKIES_NAME
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return target


def save_cache(tmp: Path, result: FetchResult) -> None:
    data = {"media": result.media_path.name, "title": result.title, "duration_ms": result.duration_ms,
            "subtitles": result.subtitle_path.name if result.subtitle_path else None,
            "auto": result.subtitle_auto, "host": result.source_host}
    (tmp / CACHE_NAME).write_text(json.dumps(data), encoding="utf-8")


def load_cache(tmp: Path) -> FetchResult | None:
    """The cached result when it is intact and its files are still there; anything odd = None (fetch again)."""
    try:
        data = json.loads((tmp / CACHE_NAME).read_text(encoding="utf-8"))
        media_name, subs_name = data["media"], data.get("subtitles")
        if Path(media_name).name != media_name or Path(media_name).stem != "dl":
            return None
        media_path = tmp / media_name
        subs = tmp / subs_name if subs_name and Path(subs_name).name == subs_name else None
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
    if not media_path.is_file():
        return None
    if subs is not None and not subs.is_file():
        subs = None
    duration, host = data.get("duration_ms"), data.get("host")
    return FetchResult(media_path=media_path, title=clean_title(data.get("title")),
                       duration_ms=duration if isinstance(duration, int) and not isinstance(duration, bool) else None,
                       subtitle_path=subs, subtitle_auto=bool(data.get("auto")) and subs is not None,
                       source_host=host if isinstance(host, str) else None)


class Progress:
    """Turns `LIBPROG <done> <total> <estimate>` lines into a monotonic percentage between `low` and `high`."""

    def __init__(self, low: int, high: int):
        self.low, self.high, self.value = low, high, low

    def feed(self, line: str) -> None:
        m = _PROGRESS.match(line.strip())
        if not m:
            return
        total = None
        for raw in (m[2], m[3]):
            try:
                total = float(raw)
            except ValueError:
                continue
            if math.isfinite(total) and total > 0:
                break
            total = None
        if not total:
            return
        fraction = min(1.0, max(0.0, float(m[1]) / total))
        self.value = max(self.value, self.low + int((self.high - self.low) * fraction))
```

- [ ] **Step 4: 运行确认通过**

`cd server && uv run pytest -q tests/test_library_ytdlp.py tests/test_architecture.py` → 全绿(写计划时实跑:本部分 48 个用例在第一部分代码上单独通过)。

- [ ] **Step 5: 提交**

```bash
git add server/app/library/ytdlp.py server/tests/test_library_ytdlp.py
git commit -m "feat(server): add yt-dlp argv, env whitelist and error classification for library import" -m "Fixed regex table over stderr ERROR lines with URLs blanked; probe-time refusals for playlist, live, generic, DRM, too long; one English subtitle track (spec 2026-10-13-video-import §7)." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `ytdlp.py` 第二部分:`YtDlpFetch`(真实的 `FetchStage`)

**Files:**
- Modify: `server/app/library/ytdlp.py`(末尾追加)
- Modify: `server/tests/test_library_ytdlp.py`(末尾追加第三部分)

**Interfaces:**
- Produces(`_download` 返回 `(Proc, too_large)`,见 R-LI23 / R-LI24):`Proc(returncode, stdout, stderr, timed_out=False)`、`Runner`、`media_runner(argv, *, timeout, env, cwd, on_line=None) -> Proc`(A-3 的唯一适配点)、`YtDlpFetch(runner=media_runner, *, resolver=None, disk_free=..., clock=time.monotonic, tick=1.0)`、`async YtDlpFetch.fetch(req: FetchRequest) -> FetchResult`。
- Consumes:A-1、A-2、A-3、A-8 的设置名。

- [ ] **Step 1: 写失败测试** — 在 `server/tests/test_library_ytdlp.py` 末尾追加(前面空两行;本部分自带导入块,`# noqa: E402` 是有意的):

```python
# ==== Task 4: the stage ====
import asyncio  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
from pathlib import Path  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from app.library.pipeline import FetchRequest, FetchResult  # noqa: E402
from app.library.ytdlp import Proc, YtDlpFetch  # noqa: E402

STDERR_SECRET = "ERROR: [youtube] SECRETVIDEO1: Sign in to confirm you're not a bot. cookie=SESSIONSECRET"


def settings(**over):
    values = dict(library_link_available=True, library_link_timeout_minutes=20, library_link_allow_generic=False, library_ytdlp_cookies_file="",
                  library_ytdlp_proxy="", library_transcode_max_height=720, library_max_upload_mb=500,
                  library_max_duration_minutes=90)
    values.update(over)
    return SimpleNamespace(**values)


async def public(host):
    return ["142.250.1.1"]


async def private(host):
    return ["10.0.0.7"]


class FakeRunner:
    """Plays yt-dlp: the first call is the probe (prints `info`), the second the download (writes files).

    Like S1's real `media.run`, a call that passes `on_line` gets its stdout line by line and the returned process
    has an EMPTY stdout (R-LI23): the `download` stdout is therefore fed through `on_line`, never returned.
    `contents` maps a file name to the bytes written for it (default 1000 x "x")."""

    def __init__(self, probe: Proc | None = None, download: Proc | None = None, files=("dl.mp4", "subs.en.srt"),
                 lines=(), on_download=None, contents: dict[str, bytes] | None = None):
        self.calls: list[dict] = []
        self.probe = probe or Proc(0, json.dumps(info()), "")
        self.download = download or Proc(0, "", "")
        self.files, self.lines, self.on_download = files, lines, on_download
        self.contents = contents or {}

    async def __call__(self, argv, *, timeout, env, cwd, on_line=None):
        self.calls.append({"argv": list(argv), "timeout": timeout, "env": dict(env), "cwd": Path(cwd),
                           "cookies": (Path(cwd) / ytdlp.COOKIES_NAME).exists()})
        if "--dump-single-json" in argv:
            return self.probe
        if self.on_download is not None:
            await self.on_download()
        for line in (*self.lines, *self.download.stdout.splitlines()):
            on_line(line)
        for name in self.files:
            (Path(cwd) / name).write_bytes(self.contents.get(name, b"x" * 1000))
        return Proc(self.download.returncode, "", self.download.stderr, self.download.timed_out)


def request(tmp_path, *, asr=False, reports=None, **over):
    async def report(pct):
        if reports is not None:
            reports.append(pct)
    return FetchRequest(item_id="item-1", user_id=7, url=URL, tmp_dir=tmp_path / "_tmp" / "item-1",
                        settings=settings(**over), asr_available=asr, report=report)


def stage(runner, **kw):
    kw.setdefault("resolver", public)
    kw.setdefault("disk_free", lambda p: 100 * 1024 * ytdlp.MB)
    return YtDlpFetch(runner, **kw)


# ---- the stage ----

async def test_fetch_success(tmp_path):
    runner = FakeRunner(lines=["LIBPROG 50 100 NA", "LIBPROG 100 100 NA"])
    reports: list[int] = []
    result = await stage(runner, tick=0.001).fetch(request(tmp_path, reports=reports))
    tmp = tmp_path / "_tmp" / "item-1"
    assert result == FetchResult(media_path=tmp / "dl.mp4", title=TITLE, duration_ms=61500,
                                 subtitle_path=tmp / "subs.en.srt", subtitle_auto=False,
                                 source_host="www.youtube.com")
    assert reports[0] == ytdlp.P_CHECKED and reports[-1] == ytdlp.P_DONE and reports == sorted(reports)
    probe, download = runner.calls
    assert probe["cwd"] == tmp and probe["timeout"] == ytdlp.INFO_TIMEOUT and download["timeout"] <= 20 * 60
    assert download["argv"][download["argv"].index("--sub-langs") + 1] == "en"


async def test_a_finished_fetch_is_reused_by_a_retry(tmp_path):
    first = await stage(FakeRunner()).fetch(request(tmp_path))
    assert (tmp_path / "_tmp" / "item-1" / ytdlp.CACHE_NAME).is_file()
    again = FakeRunner(probe=Proc(1, "", "ERROR: must not run"))
    reports: list[int] = []
    assert await stage(again, resolver=private).fetch(request(tmp_path, reports=reports)) == first
    assert again.calls == [] and reports == [ytdlp.P_DONE]


@pytest.mark.parametrize("cache", ["not json", '{"media": "../dl.mp4"}', '{"media": "other.mp4"}', '{"media": 5}',
                                   '{"media": "dl.mp4"}', "[]"])
async def test_a_broken_or_stale_cache_means_fetch_again(tmp_path, cache):
    tmp = tmp_path / "_tmp" / "item-1"
    tmp.mkdir(parents=True)
    (tmp / ytdlp.CACHE_NAME).write_text(cache, encoding="utf-8")
    if "other" in cache:
        (tmp / "other.mp4").write_bytes(b"x")
    runner = FakeRunner()
    result = await stage(runner).fetch(request(tmp_path))
    assert len(runner.calls) == 2 and result.media_path == tmp / "dl.mp4"


async def test_fetch_uses_auto_captions_only_without_asr(tmp_path):
    runner = FakeRunner(probe=Proc(0, json.dumps(info(subtitles={})), ""), files=("dl.mp4", "subs.en-orig.srt"))
    result = await stage(runner).fetch(request(tmp_path, asr=False))
    assert result.subtitle_auto is True and result.subtitle_path.name == "subs.en-orig.srt"
    runner = FakeRunner(probe=Proc(0, json.dumps(info(subtitles={})), ""), files=("dl.mp4",))
    result = await stage(runner).fetch(request(tmp_path / "b", asr=True))
    assert result.subtitle_path is None and "--sub-langs" not in runner.calls[1]["argv"]


async def test_fetch_missing_subtitle_file_is_not_an_error(tmp_path):
    result = await stage(FakeRunner(files=("dl.mp4",))).fetch(request(tmp_path))
    assert result.subtitle_path is None and result.subtitle_auto is False


@pytest.mark.parametrize("runner, kind", [
    (FakeRunner(probe=Proc(1, "", STDERR_SECRET)), "blocked"),
    (FakeRunner(probe=Proc(-9, "", "", timed_out=True)), "ytdlp_transient"),
    (FakeRunner(probe=Proc(0, "not json", "")), "ytdlp_failed"),
    (FakeRunner(probe=Proc(0, "[1, 2]", "")), "ytdlp_failed"),
    (FakeRunner(probe=Proc(0, json.dumps(info(is_live=True)), "")), "live_unsupported"),
    (FakeRunner(probe=Proc(0, json.dumps(info(duration=10 ** 6)), "")), "too_long"),
    (FakeRunner(download=Proc(1, "", "ERROR: This video is DRM protected")), "drm"),
    # yt-dlp prints this on stdout and exits 0 without a file; the real runner does not buffer stdout when it has a
    # line callback, so only the callback can see it (R-LI23). FakeRunner feeds it through `on_line` only.
    (FakeRunner(download=Proc(0, "[download] File is larger than max-filesize (9 bytes > 1 bytes). Aborting.", ""),
                files=()), "too_large"),
    (FakeRunner(download=Proc(0, "", ""), files=("dl.f1.mp4",)), "ytdlp_failed"),
    (FakeRunner(download=Proc(-9, "", "", timed_out=True)), "ytdlp_transient"),
])
async def test_fetch_failures(tmp_path, runner, kind):
    with pytest.raises(LibraryError) as e:
        await stage(runner).fetch(request(tmp_path))
    assert e.value.kind == kind


async def test_fetch_rechecks_the_url_before_running_anything(tmp_path):
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner, resolver=private).fetch(request(tmp_path))
    assert e.value.kind == "bad_url" and runner.calls == []


async def test_fetch_refuses_when_link_import_was_switched_off(tmp_path):
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner).fetch(request(tmp_path, library_link_available=False))
    assert e.value.kind == "link_disabled" and runner.calls == []


async def test_fetch_refuses_without_disk_space(tmp_path):
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner, disk_free=lambda p: 5 * ytdlp.MB).fetch(request(tmp_path))
    assert e.value.kind == "disk_full" and len(runner.calls) == 1  # never downloaded


async def test_fetch_wall_clock_budget(tmp_path):
    ticks = iter([0.0, 0.0, 1300.0, 1300.0])  # started, probe budget, download budget (> 20 min), log
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner, clock=lambda: next(ticks)).fetch(request(tmp_path))
    assert e.value.kind == "ytdlp_transient" and len(runner.calls) == 1


async def test_cookies_are_copied_for_the_run_and_removed(tmp_path):
    source = tmp_path / "cookies-source.txt"
    source.write_text("# Netscape HTTP Cookie File\n")
    runner = FakeRunner(probe=Proc(1, "", STDERR_SECRET))
    with pytest.raises(LibraryError):
        await stage(runner).fetch(request(tmp_path, library_ytdlp_cookies_file=str(source)))
    assert runner.calls[0]["cookies"] is True
    copied = tmp_path / "_tmp" / "item-1" / ytdlp.COOKIES_NAME
    assert runner.calls[0]["argv"][runner.calls[0]["argv"].index("--cookies") + 1] == str(copied)
    assert not copied.exists() and source.exists()


async def test_unreadable_cookies_are_skipped(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="app")
    runner = FakeRunner()
    await stage(runner).fetch(request(tmp_path, library_ytdlp_cookies_file=str(tmp_path / "missing" / "c.txt")))
    assert "--cookies" not in runner.calls[0]["argv"]
    assert "missing" not in caplog.text and "cookies unreadable" in caplog.text


async def test_cancel_kills_nothing_left_behind(tmp_path):
    source = tmp_path / "c.txt"
    source.write_text("x")

    async def hang():
        await asyncio.sleep(30)

    task = asyncio.create_task(stage(FakeRunner(on_download=hang), tick=0.001).fetch(
        request(tmp_path, library_ytdlp_cookies_file=str(source))))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not (tmp_path / "_tmp" / "item-1" / ytdlp.COOKIES_NAME).exists()


async def test_an_aborted_report_stops_the_download(tmp_path):
    """S1's `report` raises `Aborted` once the item was canceled / deleted: yt-dlp must be stopped (the runner is
    cancelled, which is what `media.run` turns into SIGTERM / SIGKILL), the exception must come out unchanged
    (not swallowed with the ticker, not turned into a LibraryError) and the cookies copy must be gone (R-LI24)."""
    from app.library.errors import Aborted
    source = tmp_path / "c.txt"
    source.write_text("x")
    killed: list[int] = []

    class Hanging(FakeRunner):
        async def __call__(self, argv, *, timeout, env, cwd, on_line=None):
            if "--dump-single-json" in argv:
                return self.probe
            on_line("LIBPROG 50 100 NA")  # the ticker reports 50 % -> report() raises Aborted
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                killed.append(1)
                raise

    async def report(pct):
        if pct > ytdlp.P_PROBED:
            raise Aborted()

    req = FetchRequest(item_id="item-1", user_id=7, url=URL, tmp_dir=tmp_path / "_tmp" / "item-1",
                       settings=settings(library_ytdlp_cookies_file=str(source)), asr_available=False, report=report)
    with pytest.raises(Aborted):
        await asyncio.wait_for(stage(Hanging(), tick=0.001).fetch(req), 5)
    assert killed == [1]
    assert not (tmp_path / "_tmp" / "item-1" / ytdlp.COOKIES_NAME).exists()


async def test_fetch_logs_no_url_title_output_or_secrets(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    source = tmp_path / "cookie-file-name.txt"
    source.write_text("x")
    over = dict(library_ytdlp_cookies_file=str(source), library_ytdlp_proxy="http://u:PROXYPASS@p.example:1")
    await stage(FakeRunner()).fetch(request(tmp_path, **over))
    with pytest.raises(LibraryError):
        await stage(FakeRunner(probe=Proc(1, "", STDERR_SECRET))).fetch(request(tmp_path / "b", **over))
    text = caplog.text
    for secret in ("SECRETVIDEO1", "youtube.com", TITLE, "SESSIONSECRET", "not a bot", "cookie-file-name",
                   "PROXYPASS", str(tmp_path)):
        assert secret not in text
    assert "item=item-1" in text and "kind=blocked" in text


async def test_media_runner_runs_the_real_yt_dlp(tmp_path):
    """Pins assumption A-3 against S1's real `media.run`: no network, only `--version`."""
    argv = [sys.executable, "-I", "-X", "utf8", "-m", "yt_dlp", "--ignore-config", "--version"]
    proc = await asyncio.wait_for(
        ytdlp.media_runner(argv, timeout=60, env=ytdlp.child_env(tmp_path, ""), cwd=tmp_path), 90)
    assert proc.returncode == 0 and not proc.timed_out
    printed = [int(x) for x in proc.stdout.strip().split(".")[:3]]
    assert printed == [int(x) for x in ytdlp.installed_version().split(".")[:3]]
```

- [ ] **Step 2: 运行确认失败**

`cd server && uv run pytest -q tests/test_library_ytdlp.py` → 收集失败(`ImportError: cannot import name 'Proc'`)。

- [ ] **Step 3: 实现** — 在 `server/app/library/ytdlp.py` 末尾追加(前面空两行):

```python
# ---- the child process ----

@dataclass(frozen=True)
class Proc:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


Runner = Callable[..., Awaitable[Proc]]  # (argv, *, timeout, env, cwd, on_line) -> Proc


def _text(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", "replace")
    return value or ""


async def media_runner(argv: list[str], *, timeout: float, env: dict[str, str], cwd: Path,
                       on_line: Callable[[str], None] | None = None) -> Proc:
    """The only place that knows S1's `media.run` signature (plan assumption A-3)."""
    result = await media.run(argv, timeout=timeout, env=env, cwd=cwd, on_stdout_line=on_line)
    return Proc(int(result.returncode), _text(result.stdout), _text(result.stderr),
                bool(getattr(result, "timed_out", False)))


def _disk_free(path: Path) -> int:
    return shutil.disk_usage(path).free


class YtDlpFetch:
    """The real `FetchStage`. Everything external is injectable for tests: `runner`, `resolver` (DNS), `disk_free`,
    `clock`, `tick` (seconds between progress reports while downloading)."""

    def __init__(self, runner: Runner = media_runner, *, resolver: urlcheck.Resolver | None = None,
                 disk_free: Callable[[Path], int] = _disk_free, clock: Callable[[], float] = time.monotonic,
                 tick: float = 1.0):
        self._runner, self._resolver, self._disk_free = runner, resolver, disk_free
        self._clock, self._tick = clock, tick

    def _remaining(self, deadline: float) -> float:
        left = deadline - self._clock()
        if left <= 0:
            raise LibraryError("ytdlp_transient")
        return left

    async def _download(self, argv: list[str], *, timeout: float, env: dict[str, str], cwd: Path,
                        report: Callable[[int], Awaitable[None]]) -> tuple[Proc, bool]:
        """Run the download; returns `(process, refused_for_size)`.

        S1's `media.run` does not buffer stdout when it is given a line callback, so the one stdout line that matters
        besides progress ("File is larger than max-filesize": yt-dlp exits 0 without a file) is caught in the
        callback (R-LI23). The progress ticker and the child run side by side: when `report` raises (S1 raises
        `Aborted` for a canceled / deleted item) the child is cancelled and the exception comes out unchanged
        (R-LI24); an outer cancellation cancels both. Nothing outlives this call."""
        progress = Progress(P_PROBED, P_DOWNLOADED - 5)
        too_large = False

        def on_line(line: str) -> None:
            nonlocal too_large
            progress.feed(line)
            if _TOO_LARGE.search(line):
                too_large = True

        async def tick() -> None:
            sent = progress.low
            while True:
                await asyncio.sleep(self._tick)
                if progress.value > sent:
                    sent = progress.value
                    await report(sent)

        run = asyncio.ensure_future(self._runner(argv, timeout=timeout, env=env, cwd=cwd, on_line=on_line))
        ticker = asyncio.ensure_future(tick())
        try:
            await asyncio.wait({run, ticker}, return_when=asyncio.FIRST_COMPLETED)
            if not run.done():  # the ticker only ends by raising
                run.cancel()
                await asyncio.gather(run, return_exceptions=True)
                ticker.result()
            return run.result(), too_large
        finally:
            for task in (run, ticker):
                task.cancel()
            await asyncio.gather(run, ticker, return_exceptions=True)

    async def fetch(self, req: FetchRequest) -> FetchResult:
        s = req.settings
        started = self._clock()
        deadline = started + int(s.library_link_timeout_minutes) * 60
        tmp = Path(req.tmp_dir)
        tmp.mkdir(parents=True, exist_ok=True)
        cookies: Path | None = None
        exit_code: int | None = None
        try:
            if not s.library_link_available:  # switched off (or yt-dlp gone) after the item was queued
                raise LibraryError("link_disabled")
            cached = load_cache(tmp)
            if cached is not None:
                await req.report(P_DONE)
                logger.info("library fetch reused item=%s", req.item_id)
                return cached
            try:
                checked = await urlcheck.precheck(req.url, resolver=self._resolver)
            except urlcheck.UrlRejected as e:
                logger.info("library fetch precheck rejected item=%s reason=%s", req.item_id, e.reason)
                raise LibraryError("bad_url") from None
            await req.report(P_CHECKED)
            allow_generic = bool(s.library_link_allow_generic)
            cookies = copy_cookies(s.library_ytdlp_cookies_file, tmp, req.item_id)
            env = child_env(tmp, s.library_ytdlp_proxy)

            proc = await self._runner(
                info_args(checked.url, allow_generic=allow_generic, cookies=cookies,
                          max_height=s.library_transcode_max_height),
                timeout=min(INFO_TIMEOUT, self._remaining(deadline)), env=env, cwd=tmp, on_line=None)
            exit_code = proc.returncode
            if proc.timed_out:
                raise LibraryError("ytdlp_transient")
            if proc.returncode != 0:
                raise LibraryError(classify(proc.stderr))
            try:
                info = json.loads(proc.stdout)
            except ValueError:
                raise LibraryError("ytdlp_failed") from None
            if not isinstance(info, dict):
                raise LibraryError("ytdlp_failed")
            check_info(info, max_minutes=int(s.library_max_duration_minutes), allow_generic=allow_generic)
            check_space(estimate_bytes(info), int(s.library_max_upload_mb) * MB, self._disk_free(tmp))
            sub_lang, sub_auto = pick_subtitles(info, req.asr_available)
            await req.report(P_PROBED)

            proc, too_large = await self._download(
                download_args(checked.url, tmp, allow_generic=allow_generic, cookies=cookies,
                              max_height=s.library_transcode_max_height, max_mb=s.library_max_upload_mb,
                              sub_lang=sub_lang, sub_auto=sub_auto),
                timeout=self._remaining(deadline), env=env, cwd=tmp, report=req.report)
            exit_code = proc.returncode
            if proc.timed_out:
                raise LibraryError("ytdlp_transient")
            if proc.returncode != 0:
                raise LibraryError(classify(proc.stderr))
            media_path = find_media(tmp)
            if media_path is None:
                raise LibraryError("too_large" if too_large else "ytdlp_failed")
            await req.report(P_DOWNLOADED)
            subtitles = find_subtitles(tmp) if sub_lang else None
            duration = _number(info.get("duration"))
            result = FetchResult(media_path=media_path, title=clean_title(info.get("title")),
                                 duration_ms=round(duration * 1000) if duration is not None else None,
                                 subtitle_path=subtitles, subtitle_auto=bool(subtitles is not None and sub_auto),
                                 source_host=checked.source_host)
            save_cache(tmp, result)
            await req.report(P_DONE)
            logger.info("library fetch done item=%s ms=%d bytes=%d subs=%s auto=%s", req.item_id,
                        (self._clock() - started) * 1000, media_path.stat().st_size,
                        "yes" if subtitles else "no", "yes" if result.subtitle_auto else "no")
            return result
        except LibraryError as e:
            logger.info("library fetch failed item=%s kind=%s exit=%s ms=%d", req.item_id, e.kind,
                        exit_code if exit_code is not None else "-", (self._clock() - started) * 1000)
            raise
        finally:
            if cookies is not None:
                cookies.unlink(missing_ok=True)
```

- [ ] **Step 4: 运行确认通过**

`cd server && uv run pytest -q tests/test_library_ytdlp.py tests/test_architecture.py` → 全绿。写计划时实跑:除 `test_ytdlp_dependency_is_installed`、`test_installed_version_matches_the_dependency`、`test_media_runner_runs_the_real_yt_dlp` 三个(需要真实 yt-dlp 与 S1 的 `media.run`)之外,Task 3 + Task 4 的 76 个用例在桩上通过(Addendum 之前的代码;之后新增了 `test_an_aborted_report_stops_the_download`,并把 `FakeRunner` 与 `_download` 改成 R-LI23 / R-LI24 的写法,**这部分没有运行过**,第一次运行以真实结果为准)。`test_media_runner_runs_the_real_yt_dlp` 失败 = A-3 不成立:按 Task 0b Step 2 的表只改 `media_runner`。

- [ ] **Step 5: 提交**

```bash
git add server/app/library/ytdlp.py server/tests/test_library_ytdlp.py
git commit -m "feat(server): implement the library fetch stage with yt-dlp" -m "Re-checks the URL, probes before downloading, size and disk checks, copied cookies, env proxy, progress, reuse of a finished fetch on retry; logs ids and kinds only (spec 2026-10-13-video-import §7, §13)." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: `POST /api/library/imports`、注册取回阶段、填 `main.py` 锚点

**Files:**
- Create: `server/app/routers/library_import.py`
- Modify: `server/app/main.py`(只在 S1 的 `plan S2` 锚点处,R-LI2)
- Modify: `server/tests/test_library_urlcheck.py`(末尾追加第二部分;含 `settings_overrides` 夹具的本文件级重定义,R-LI23)
- 本任务的测试依赖 S1 的 `tests/library_helpers.py` 与 Task 4 写好的 `tests/test_library_ytdlp.py::FakeRunner`(跨测试模块导入是仓库允许的,见 `tests/CLAUDE.md`)

**Interfaces:**
- Produces:`router`(`POST /api/library/imports`)、`install(app)`、`import_user`、`ImportIn`、常量 `LINK_DISABLED = "Link import is disabled"`、`BAD_URL = "Invalid link"`(`Library is disabled` 来自 S1 的 `errors.api_error("disabled")`,不再重复定义)。
- Consumes:A-1 `api_error` / `http_error`、A-4、A-5、A-6(含 `store.clean_title`)、A-7、A-8;`core.deps.current_user / get_session / get_settings / limited_user`;测试用 S1 的 `tests/library_helpers.py`(`enable`、`library_settings`、`use_fakes`、`process`、`fake_media`、`SRT`)与本计划 Task 4 的 `FakeRunner`。

- [ ] **Step 1: 写失败测试** — 在 `server/tests/test_library_urlcheck.py` 末尾追加(前面空两行;本部分自带导入块):

```python
# ==== Task 5: POST /api/library/imports (spec §7.1, §9) ====
import logging  # noqa: E402

from sqlalchemy import select  # noqa: E402

from app.core import config as config_module  # noqa: E402
from app.library import store  # noqa: E402
from app.library.ytdlp import Proc, YtDlpFetch  # noqa: E402
from app.models import LibraryItem  # noqa: E402
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, use_fakes  # noqa: E402
from tests.test_library_ytdlp import STDERR_SECRET, TITLE, FakeRunner  # noqa: E402

ON = {"library_enabled": True, "library_link_import_enabled": True}
LINK = "https://www.youtube.com/watch?v=SECRETVIDEO9"
TOO_MANY = (429, {"error": "Too many requests, please try again later"})


@pytest.fixture
def settings_overrides(request, tmp_path):
    """Every case gets its own data directory (the end-to-end cases write `library/_tmp/...`); a case lists only the
    settings it changes. `library_settings` turns `library_enabled` on, so the 404 cases say `False` explicitly."""
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture
def available(monkeypatch):
    """ffmpeg / yt-dlp presence belongs to the machine, not to these tests: S1's two module functions are patched
    (R-LI23; S1's own tests patch `media_tools_present` the same way)."""
    enable(monkeypatch)  # media_tools_present -> True
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)


@pytest.fixture
def dns(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr("app.library.urlcheck.system_resolve", fake_resolver("142.250.1.1", calls=calls))
    return calls


@pytest.fixture
def wakes(app, monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(app.state.library, "wake", lambda: calls.append(1))
    return calls


async def items_of(app) -> list:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(LibraryItem).order_by(LibraryItem.created_at))).all())


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_needs_login(client, available, dns):
    r = await client.post("/api/library/imports", json={"url": LINK})
    assert r.status_code == 401 and dns == []


@pytest.mark.parametrize("settings_overrides, error", [
    ({"library_enabled": False}, "Library is disabled"),
    ({"library_enabled": False, "library_link_import_enabled": True}, "Library is disabled"),
    ({"library_enabled": True, "library_link_import_enabled": False}, "Link import is disabled"),
], indirect=["settings_overrides"])
async def test_import_is_404_when_off(client, auth_headers, available, dns, wakes, error):
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": error})
    assert dns == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_is_404_when_yt_dlp_is_missing(client, auth_headers, available, dns, wakes, monkeypatch):
    """`library_link_available` = switch AND yt-dlp importable (spec §5.2): a missing package reads as 'off'."""
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: False)
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Link import is disabled"})
    assert dns == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [{**ON, "library_imports_daily_per_user": 1}], indirect=True)
async def test_import_without_ffmpeg_is_503_and_spends_nothing(app, client, auth_headers, available, dns, wakes,
                                                               monkeypatch):
    """The route gate is `library_enabled` only (S1 R-SC9); missing media tools surface through S1's admission as
    503, and the refused request does not spend the daily count."""
    monkeypatch.setattr(config_module, "media_tools_present", lambda: False)
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (503, {"error": "Media tools are not installed"})
    assert await items_of(app) == [] and wakes == []
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    assert (await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)).status_code == 200


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_creates_a_queued_link_item(app, client, auth_headers, available, dns, wakes):
    r = await client.post("/api/library/imports", json={"url": "  " + LINK + "#t=30 "}, headers=auth_headers)
    assert r.status_code == 200, r.text
    [row] = await items_of(app)
    assert r.json()["id"] == row.id and set(r.json()) == set(store.item_out(row))
    assert (row.source, row.status, row.title) == ("link", "queued", "")
    assert (row.source_url, row.source_host) == (LINK, "www.youtube.com")
    assert dns == ["www.youtube.com"] and wakes == [1]
    r = await client.post("/api/library/imports", json={"url": LINK, "title": "  My\ttalk  "}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["title"] == "My talk" and wakes == [1, 1]


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
@pytest.mark.parametrize("url", ["ftp://example.com/v", "http://localhost/v", "https://intranet/v",
                                 "https://user:pw@example.com/v", "https://example.com:8443/v",
                                 "https://example.com/" + "a" * 2100])
async def test_import_rejects_bad_links(app, client, auth_headers, available, dns, wakes, url):
    r = await client.post("/api/library/imports", json={"url": url}, headers=auth_headers)
    assert (r.status_code, r.json()) == (400, {"error": "Invalid link"})
    assert await items_of(app) == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_rejects_hosts_that_resolve_privately(app, client, auth_headers, available, wakes, monkeypatch):
    monkeypatch.setattr("app.library.urlcheck.system_resolve", fake_resolver("8.8.8.8", "10.0.0.2"))
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (400, {"error": "Invalid link"})
    assert await items_of(app) == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
@pytest.mark.parametrize("body", [{}, {"url": ""}, {"url": 5}, {"url": LINK, "title": "t" * 201}])
async def test_import_validates_the_body(app, client, auth_headers, available, dns, body):
    r = await client.post("/api/library/imports", json=body, headers=auth_headers)
    assert r.status_code == 422 and "SECRETVIDEO9" not in r.text
    assert await items_of(app) == []


@pytest.mark.parametrize("settings_overrides, refused", [
    ({**ON, "library_max_items": 1}, (409, {"error": "Library item limit reached"})),
    ({**ON, "library_imports_daily_per_user": 1}, (429, {"error": "Daily import limit reached"})),
], indirect=["settings_overrides"])
async def test_import_counts_against_the_library_limits(app, client, auth_headers, available, dns, wakes, refused):
    """S1's `admit_new_item` (A-5): the same rules and the same fixed texts as the upload start."""
    first = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert first.status_code == 200, first.text
    second = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (second.status_code, second.json()) == refused
    assert len(await items_of(app)) == 1 and wakes == [1]


@pytest.mark.parametrize("settings_overrides", [{**ON, "ai_rate_limit_per_minute": 1}], indirect=True)
async def test_import_is_rate_limited_per_minute(app, client, auth_headers, available, dns):
    assert (await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)).status_code == 200
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == TOO_MANY
    assert len(await items_of(app)) == 1


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_logs_neither_url_nor_title(client, auth_headers, available, dns, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await client.post("/api/library/imports", json={"url": LINK, "title": "Secret Title 77"}, headers=auth_headers)
    await client.post("/api/library/imports", json={"url": "http://localhost/SECRETVIDEO9"}, headers=auth_headers)
    for secret in ("SECRETVIDEO9", "youtube", "Secret Title 77", "localhost"):
        assert secret not in caplog.text
    assert "reason=private" in caplog.text and "library import queued" in caplog.text


async def test_create_app_registers_the_ytdlp_fetch_stage(app):
    assert isinstance(app.state.library.fetch_stage, YtDlpFetch)


# ---- through S1's worker with a fake yt-dlp (R-LI25) ----

async def row_of(app, item_id: str) -> LibraryItem:
    async with app.state.sessionmaker() as s:
        return await s.get(LibraryItem, item_id)


def fake_stage(runner) -> YtDlpFetch:
    return YtDlpFetch(runner, resolver=fake_resolver("142.250.1.1"), disk_free=lambda p: 10 ** 12)


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_an_import_runs_to_ready_through_the_worker(app, client, auth_headers, available, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    use_fakes(app)  # S1's fake ffmpeg / ffprobe; the "downloaded" file below is a fake media file for it
    runner = FakeRunner(contents={"dl.mp4": fake_media(6000), "subs.en.srt": SRT})
    app.state.library.set_fetch_stage(fake_stage(runner))
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert await process(app) == 1
    row = await row_of(app, r.json()["id"])
    assert (row.status, row.error_kind, row.sub_source, row.title) == ("ready", None, "platform", TITLE)
    assert row.source_url is None and row.source_host == "www.youtube.com" and row.seg_count >= 1
    probe, download = runner.calls
    assert probe["argv"][-1] == LINK and download["argv"][-1] == LINK
    assert not any(k in probe["env"] for k in ("UPSTREAM_LLM_KEY", "ADMIN_PASSWORD", "DATABASE_URL"))
    for secret in ("SECRETVIDEO9", "SECRETVIDEO1", "youtube", TITLE):
        assert secret not in caplog.text
    assert "library fetch done" in caplog.text


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_a_blocked_site_fails_the_item_with_a_kind_and_logs_nothing_else(app, client, auth_headers, available,
                                                                               caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    use_fakes(app)
    app.state.library.set_fetch_stage(fake_stage(FakeRunner(probe=Proc(1, "", STDERR_SECRET))))
    r = await client.post("/api/library/imports", json={"url": LINK, "title": "Secret Title 77"},
                          headers=auth_headers)
    await process(app)
    row = await row_of(app, r.json()["id"])
    assert (row.status, row.error_kind) == ("failed", "blocked")
    assert (await client.get(f"/api/library/items/{row.id}", headers=auth_headers)).json()["error_kind"] == "blocked"
    for secret in ("SECRETVIDEO9", "SECRETVIDEO1", "youtube", "Secret Title 77", "SESSIONSECRET", "not a bot"):
        assert secret not in caplog.text
    assert "kind=blocked" in caplog.text


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_a_transient_yt_dlp_failure_is_retried_by_the_worker(app, client, auth_headers, available):
    """`ytdlp_transient` is one of the kinds S1 retries automatically (spec §6.5): back to `queued` with a backoff."""
    use_fakes(app)
    app.state.library.set_fetch_stage(fake_stage(FakeRunner(probe=Proc(-9, "", "", timed_out=True))))
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    await process(app)
    row = await row_of(app, r.json()["id"])
    assert (row.status, row.attempts) == ("queued", 1) and row.next_run_at is not None  # not asserting error_kind: S1's call


def test_the_import_route_carries_no_text_in_its_url(app):
    paths = {route.path for route in app.routes if getattr(route, "path", "").startswith("/api/library/imports")}
    assert paths == {"/api/library/imports"}
```

- [ ] **Step 2: 运行确认失败**

`cd server && uv run pytest -q tests/test_library_urlcheck.py` → 新用例失败(路由不存在时 `POST /api/library/imports` 落到 404 / `stubs`;`fetch_stage` 还是 S1 的默认实现)。

- [ ] **Step 3: 实现** — 创建 `server/app/routers/library_import.py`:

```python
"""Link import (spec 2026-10-13-video-import §7.1, §9): `POST /api/library/imports {url, title?}`.

Only the URL precheck runs inside the request (yt-dlp never runs here): the item is created `queued` and the
worker's fetch stage does the rest (`app.library.ytdlp.YtDlpFetch`, registered by `install`). Order: 401 (login),
404 `Library is disabled` when `library_enabled` is off (S1's gate, R-SC9), 404 `Link import is disabled` when the
link switch is off or yt-dlp is missing (D4: admin switch, default off), 429 per-minute limit, 422 body, 400
`Invalid link` for every precheck rejection (the reason code only goes to the log), then S1's shared admission
(`limits.admit_new_item`: 503 without ffmpeg, 409 item / quota limits, 429 daily). Never logs the URL or the title."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.library import limits, store, urlcheck
from app.library.errors import LibraryError, api_error, http_error
from app.library.ytdlp import YtDlpFetch
from app.models import User

router = APIRouter(prefix="/api/library")
logger = logging.getLogger(__name__)

LINK_DISABLED = "Link import is disabled"
BAD_URL = "Invalid link"
MAX_BODY_URL = 4096  # pydantic bound only; the precheck's own limit (2000 after trimming) answers 400


class ImportIn(BaseModel):
    url: str = Field(min_length=1, max_length=MAX_BODY_URL)
    title: str | None = Field(default=None, max_length=200)


def install(app) -> None:
    """Called once from `create_app` at S1's anchor: the worker's fetch stage becomes yt-dlp (S1's default raises
    `unsupported_site`)."""
    app.state.library.set_fetch_stage(YtDlpFetch())


async def import_user(request: Request, user: User = Depends(current_user),
                      settings: Settings = Depends(get_settings),
                      session: AsyncSession = Depends(get_session)) -> User:
    # `get_settings` reads `app.state.settings` per request: the switches are hot (never cache them)
    if not settings.library_enabled:  # same gate as every other library route; ffmpeg is checked by admit_new_item
        raise api_error("disabled")
    if not settings.library_link_available:
        raise HTTPException(404, LINK_DISABLED)
    return await limited_user(request, user, session)


@router.post("/imports")
async def create_import(body: ImportIn, request: Request, user: User = Depends(import_user),
                        session: AsyncSession = Depends(get_session)) -> dict:
    try:
        checked = await urlcheck.precheck(body.url)
    except urlcheck.UrlRejected as e:
        logger.info("library import rejected user=%s reason=%s", user.id, e.reason)
        raise HTTPException(400, BAD_URL) from None
    try:
        await limits.admit_new_item(session, request.app, user.id)
    except LibraryError as e:
        logger.info("library import refused user=%s kind=%s", user.id, e.kind)
        raise http_error(e) from None
    try:
        item = await store.create_item(session, user_id=user.id, kind="video", source="link", status="queued",
                                       title=store.clean_title(body.title, fallback=""), source_url=checked.url,
                                       source_host=checked.source_host)
    except Exception:
        await limits.refund_new_item(session, request.app, user.id)
        raise
    request.app.state.library.wake()
    logger.info("library import queued user=%s item=%s", user.id, item.id)
    return store.item_out(item)
```

- [ ] **Step 4: 填 `main.py` 锚点**(Edit 工具,三处单点追加,不动别的行)

1. `from app.routers import (` 那个导入列表里,在 S1 加的 `library` 之后加 `library_import`(同一行的逗号列表里追加 `library_import,`)。
2. 在第一处 `plan S2` 锚点注释**两行**(`# --- anchor for plan S2 (2026-10-13-video-import-server-import): \`library_import.install(app)\` goes on the next` / `# line; it registers the yt-dlp fetch stage with app.state.library.set_fetch_stage(...) ---`,紧跟在 `install_library(app)` 之后)正下方加一行,缩进与上下文一致(锚点注释保留,不删):

```python
    library_import.install(app)  # plan S2: the worker's fetch stage becomes yt-dlp (spec 2026-10-13-video-import §7)
```

3. 在 `for module in (...)` 的元组里,第二处锚点注释(`# --- anchor for plan S2 (…): \`library_import,\` goes on the next line ---`,在 `library,` 之后)正下方加 `library_import,`(必须在 `stubs` 之前;锚点注释保留)。

注意:`install` 在 `create_app` 里只执行一次,而 `app.state.library` 由 S1 的 `install_library(app)` 在它**之前**建好;顺序反了会 `AttributeError`(`test_create_app_registers_the_ytdlp_fetch_stage` 会红)。

- [ ] **Step 5: 运行确认通过**

`cd server && uv run pytest -q tests/test_library_urlcheck.py tests/test_library_ytdlp.py tests/test_architecture.py` → 全绿;另跑 S1 的隐私测试确认新路由也满足它:`uv run pytest -q tests/test_library_privacy.py`(S1 的文件;S1 已把 `("POST", "/api/library/imports")` 列进它的 `LATER` 集合,允许这条后续路由;请求体与日志由本任务的 `test_import_logs_neither_url_nor_title` 与端到端用例覆盖。失败时**不改它**,把失败用例名写进交接)。

- [ ] **Step 6: 提交**

```bash
git add server/app/routers/library_import.py server/app/main.py server/tests/test_library_urlcheck.py
git commit -m "feat(server): add POST /api/library/imports and register the yt-dlp fetch stage" -m "404 unless the library and link import are available (admin switch, default off); URL precheck only in the request, the worker fetches; fills plan S1's main.py anchor (spec 2026-10-13-video-import §7.1, §9, §15)." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: JS 运行时(条件任务,按 Task 0 T0.2 的结论三选一)

**Files(只在分支 B):** `server/pyproject.toml`、`server/uv.lock`、`server/app/library/ytdlp.py`(`JS_RUNTIME_ARGS` 一行)、`server/tests/test_library_ytdlp.py`(末尾追加)

- [ ] **分支 A(T0.2:不给运行时也能下载):** 不改代码。结果文档写「Task 6:不需要」。没有提交。
- [ ] **分支 C(需要运行时,但没有覆盖部署架构的 Python 轮子):** 不改代码、不改 Dockerfile(S1 的文件)。在结果文档写给 S1 所有者 / Z 的交接:需要的运行时、版本、建议的 Dockerfile 行(例如官方镜像的 `COPY --from=<运行时镜像>:<版本> <可执行文件> /usr/local/bin/`,写成具体版本号)、T0.2 测得的大小;在 YouTube 那一行写「未验证 / 等镜像」。提交只含结果文档。
- [ ] **分支 B(需要,且 PyPI 上有 `deno` 轮子覆盖 linux x86_64,以及部署机若是 arm64 也要覆盖):**

Step 1 — 在 `server/tests/test_library_ytdlp.py` 末尾追加失败测试:

```python


# ==== Task 6 (branch B): the JavaScript runtime ships in the venv ====
import shutil  # noqa: E402


def test_js_runtime_is_installed_next_to_python():
    """The container's PATH starts with /app/.venv/bin (server/Dockerfile), so child_env's PATH finds it."""
    assert shutil.which("deno", path=str(Path(sys.executable).parent)) is not None


def test_js_runtime_args_name_the_runtime():
    assert ytdlp.JS_RUNTIME_ARGS == ("--js-runtimes", "deno")
    assert all(a not in ytdlp.JS_RUNTIME_ARGS for a in ("--remote-components",))
```

Step 2 — `cd server && uv run pytest -q tests/test_library_ytdlp.py -k js_runtime` → 失败。

Step 3 — `cd server && uv add "deno==<T0.2 实测可用的版本>"`;把 `ytdlp.py` 里的 `JS_RUNTIME_ARGS: tuple[str, ...] = ()` 改为 `JS_RUNTIME_ARGS: tuple[str, ...] = ("--js-runtimes", "deno")`(若 T0.1 证明锁定版本的参数名不同,用真实参数名,同时改测试)。`git diff --stat` 只应有这三个文件。

Step 4 — `cd server && uv run pytest -q tests/test_library_ytdlp.py tests/test_architecture.py` → 全绿。

Step 5 — 提交:

```bash
git add server/pyproject.toml server/uv.lock server/app/library/ytdlp.py server/tests/test_library_ytdlp.py
git commit -m "chore(server): ship a JavaScript runtime for yt-dlp YouTube challenges" -m "Installed as a Python wheel into the venv (on the container PATH); no runtime downloads of code (spec 2026-10-13-video-import §7.3, spike S2)." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: `docker-compose.example.yml` 的 cookies 挂载示例

**Files:**
- Modify: `docker-compose.example.yml`

- [ ] **Step 1: 改文件**(Edit 工具)。核对现状:`server` 服务的 `volumes:` 只有 `- enjoy-data:/data` 一项。在它下面追加(全部是注释,不改变任何行为):

```yaml
      # 跟读库 · 链接导入(可选,默认不需要;spec 2026-10-13-video-import §7.3):给 yt-dlp 用的 cookies 文件
      # (Netscape 格式,从浏览器导出)。它含账号会话,等同密钥:只用专门的小号,主账号有被平台限制的风险。
      # 宿主机上:chown 10001 ./secrets/ytdlp-cookies.txt && chmod 600 ./secrets/ytdlp-cookies.txt(容器用户 uid 10001)
      # 然后在 server/.env 写 LIBRARY_YTDLP_COOKIES_FILE=/run/secrets/ytdlp-cookies.txt;服务端每次取回复制一份副本用完即删,
      # 原文件只读。被拦时最稳的办法仍是在本机下载后「上传文件」。
      # - ./secrets/ytdlp-cookies.txt:/run/secrets/ytdlp-cookies.txt:ro
```

- [ ] **Step 2: 验证** — `git diff docker-compose.example.yml` 只有这 6 行新增、都以 `#` 开头且缩进与 `- enjoy-data:/data` 对齐;若本机有 Docker,可选:`docker compose -f docker-compose.example.yml config -q`(没有 `server/.env` 时会因 `env_file` 报错,那不是本改动的问题,跳过即可)。

- [ ] **Step 3: 提交**

```bash
git add docker-compose.example.yml
git commit -m "chore: document the optional yt-dlp cookies mount in the example compose file" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 8: 结果与未验证清单、交接

**Files:**
- Modify: `docs/superpowers/plans/2026-10-13-video-import-results.md`(本计划那一节末尾)

- [ ] **Step 1:** 在本计划那一节末尾追加「S2 已做 / 未做」表(spec §13 的要求,逐条写):本文「未验证清单」的每一项 → 「已做(结果)/ 未做(原因)」;各任务实跑的测试个数(`uv run pytest -q tests/test_library_ytdlp.py tests/test_library_urlcheck.py` 的汇总行);锁定的 yt-dlp 版本;Task 6 走的分支。
- [ ] **Step 2:** 把文末「交接」一节复制为结果文档里的待办清单(给 S1 所有者 / A / W1 / Z),每条注明是否已被对方落地。
- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "docs: record plan S2 results and hand-offs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## 验证矩阵

| 要验证的事 | 怎么验证 | 写计划时的状态 |
|---|---|---|
| 地址规则(回环 / 私网 / 链路本地 / 元数据 / CGNAT / 组播 / IPv4 映射) | `test_blocked_address`(17 个参数) | 副本实跑,通过 |
| URL 语法(scheme、userinfo、端口、单标签、本地后缀、字面 IP、反斜杠、长度) | `test_parse_rejects`(33)、`test_parse_normalises`(7) | 副本实跑,通过 |
| 每个解析地址都必须公网、解析失败 / 超时 | `test_precheck_*` | 副本实跑,通过 |
| 子进程参数(`-I`、`--`、`--ignore-config`、`--no-plugin-dirs`、无 `--exec`、generic 开关、格式串、字幕参数) | `test_info_args`、`test_download_args`、`test_format_selector_*` | 副本实跑,通过;**真实 yt-dlp 上的语法待 T0.1** |
| 环境变量白名单(无 `UPSTREAM_*` / `*_KEY` / `ADMIN_*` / `DATABASE_URL`)与代理注入 | `test_child_env_is_a_whitelist` | 副本实跑,通过;**yt-dlp 读环境代理待 T0.2** |
| 错误分类(固定正则、先 ERROR 行、抹掉 URL) | `test_classify`(21)、`test_classify_ignores_urls_*` | 副本实跑,通过;**真实文案待 T0.2** |
| 探测判定(播放列表、直播、generic、DRM、时长)、大小与磁盘 | `test_check_info_*`、`test_estimate_and_space`、`test_fetch_refuses_without_disk_space` | 副本实跑,通过 |
| 字幕选择(E6、不用翻译轨) | `test_pick_subtitles`(8)、`test_fetch_uses_auto_captions_only_without_asr` | 副本实跑,通过 |
| 取回全流程、失败种类、墙钟预算、开关复核、预检复核 | `test_fetch_*` | 副本实跑,通过(假子进程) |
| cookies 副本与删除、读不到时跳过、取消时不留副本 | `test_cookies_*`、`test_unreadable_cookies_*`、`test_cancel_*` | 副本实跑,通过 |
| 断点复用与坏缓存 | `test_a_finished_fetch_is_reused_*`、`test_a_broken_or_stale_cache_*`(6) | 副本实跑,通过 |
| 日志不含 URL / 标题 / 输出 / cookies / 代理 / 路径 | `test_fetch_logs_no_url_title_output_or_secrets`、`test_import_logs_neither_url_nor_title` | 前者副本实跑通过;后者待 Task 5 |
| `media.run` 适配(A-3) | `test_media_runner_runs_the_real_yt_dlp` | **待 Task 4(需要 S1 与 yt-dlp)** |
| 端点:401 / 404×4(库关、库关+链接开、链接关、yt-dlp 缺)/ 503(ffmpeg 缺且不扣每日)/ 400 / 422 / 409 + 429 限额的固定文案 / 每分钟 429 / 成功形状 / 唤醒 | Task 5 的 `test_import_*` | **待 Task 5(需要 S1)** |
| 经 S1 worker 的端到端:`ready`(标题补成平台标题、字幕来源 `platform`、`source_url` 清空)/ `failed(blocked)` / 瞬时失败回到 `queued` 并计 `attempts`;日志不含 URL / 标题 / stderr | Task 5 的 `test_an_import_runs_to_ready_through_the_worker` 等三个 | **待 Task 5(需要 S1;假 yt-dlp + S1 的假 ffmpeg)** |
| 下载中 `report` 抛 `Aborted` → 子进程被取消、异常原样穿出、cookies 副本已删 | `test_an_aborted_report_stops_the_download` | **待 Task 4(Addendum 新增,未运行)** |
| `too_large` 的判定在真实 `media.run`(不缓存带回调的 stdout)下仍成立 | `test_fetch_failures` 的 too_large 用例(`FakeRunner` 照真实行为只经回调给 stdout) | **待 Task 4(Addendum 修改,未运行);真实 yt-dlp 的那句文案待 T0.2** |
| 启动时注册 `YtDlpFetch` | `test_create_app_registers_the_ytdlp_fetch_stage` | 待 Task 5 |
| 分层不放宽 | `tests/test_architecture.py`(每个任务) | 待执行 |
| 依赖已安装且版本一致 | `test_ytdlp_dependency_is_installed`、`test_installed_version_matches_the_dependency` | 待 Task 1 |

## 未验证清单(如实;Task 8 逐条回填)

- **yt-dlp 的真实行为**:锁定版本上每个参数的存在与语义(尤其 `--use-extractors "default,-generic"`、`--progress-template` 的字段名与 `NA` 写法、`-o "subtitle:..."`、`--js-runtimes`)——T0.1;`[default]` 是否带 `yt-dlp-ejs`——T0.1。
- **YouTube 是否需要外部 JS 运行时、PyPI `deno` 轮子是否存在 / 覆盖哪些架构 / 多大**——T0.2;计划作者对「较新的 yt-dlp 需要外部 JS 运行时」的说法来自记忆,**没有在本仓库核实**。
- **yt-dlp 是否读 `HTTP(S)_PROXY` 环境变量**——T0.2;不读的话代理不生效(需要改成 `--proxy`,会让代理出现在进程参数里,届时另行裁定)。
- **错误文案**:`CLASSIFY` 的每一行都是按 yt-dlp 常见报错写的,没有用真实输出逐条核对——T0.2 只能覆盖样本里出现的那几种。
- **目标服务器(机房 / 云主机 IP)能否下载 YouTube**、被拦的比例——T0.3,要用户重建容器。
- **镜像体积增量**(yt-dlp 及其依赖、可能的 deno)——Z 在 `docker compose build` 时实测。
- **SSRF 剩余风险**:DNS 重绑、站点 3xx 重定向到内网、站点提取器访问的 CDN 主机——本计划不能在请求层面阻止(spec §7.2 明说);默认关 generic 是唯一缓解。
- **Postgres**:路由测试只在 SQLite 上跑;本计划不写 SQL,依赖 S1 的 store。
- **S1 接口**:A-1 至 A-9 已对过 S1 **计划**(Addendum),但 S1 代码尚未合并、没有运行过;Task 0b 对真实代码核对之前不成立。
- **真实 yt-dlp 打印的「larger than max-filesize」那一句**(只有它能触发 `too_large` 的「退出码 0、没有文件」路径)与 stdout 是否逐行到达回调——T0.2(b)用 `--max-filesize 1K` 重跑一次记录(只记有 / 无,不抄原文)。
- **取消路径在真实子进程上的行为**:`Aborted` / `task.cancel()` 经 S1 `media.run` 终止真实 yt-dlp 并清掉半截文件——只有假进程测过;Z 联调时手工取消一次进行中的链接导入确认(UNVERIFIED)。

## 不做

- 应用内自动更新 yt-dlp、`--remote-components`、任何运行时下载代码(spec §7.3、§14)。
- 绕过 DRM、播放列表 / 频道批量导入、直播(spec §14)。
- 改 `server/Dockerfile`、`.env.example`、`app/library/` 下 S1 的文件、`tests/test_library_privacy.py`、`tests/test_architecture.py`、任何 `CLAUDE.md` / README(都不是本计划的文件,见「交接」)。
- 把 SSRF 检查抽到 `core/`(spec §14);按用户限制可用站点。
- 管理端显示 yt-dlp 版本(A 车道;本计划提供 `ytdlp.installed_version()`)。

## 交接(本计划产出、别的车道要用或要落地的东西)

**给 W1(网页)——确切的线上行为:**
1. `POST /api/library/imports`,JSON 体 `{"url": string, "title"?: string|null}`(`title` ≤ 200 字,否则 422)。成功 **200**,响应体与 `GET /api/library/items` 的列表项**同形**(`store.item_out`,S1 比 spec §9 多 `resume_idx`、`has_poster`,以 `library_contract.json` 为准),`status = "queued"`、`source = "link"`;用户没给标题时 `title = ""`(处理中界面自己显示占位,取回后服务端补成平台标题)。
2. 错误(`{"error": <固定英文串>}`):401 未登录;404 `Library is disabled`(**只有 `library_enabled` 关**,S1 R-SC9;ffmpeg 缺失不是 404)/ `Link import is disabled`(链接开关没开或 yt-dlp 缺失);429 `Too many requests, please try again later`(每分钟);422(体不合法);400 `Invalid link`(任何预检失败:协议、内网地址、端口、解析失败……);S1 的准入错误:503 `Media tools are not installed`(ffmpeg 缺失)、409 `Library item limit reached`、409 `Library storage quota reached`、429 `Daily import limit reached`。**`Invalid link` 与 `Link import is disabled` 不在 S1 的 `API_ERRORS` 表里,所以不在 `library_contract.json` 的错误文本录制中**:W1 的 `LIBRARY_SERVER_ERRORS` 要自己加这两条(`Invalid link` → 「链接无效」文案;`Link import is disabled` → 「管理员没有开启链接导入」),否则会落到通用错误文案。
3. 取回阶段可能写进 `error_kind` 的种类:`link_disabled`、`bad_url`、`drm`、`private`、`geo_blocked`、`login_required`、`blocked`、`playlist_unsupported`、`live_unsupported`、`unsupported_site`、`too_long`、`too_large`、`disk_full`、`ytdlp_failed`(永久)与 `network`、`ytdlp_transient`(瞬时,S1 自动重试)。`blocked` / `login_required` 的文案按 spec §7.3 把「在本机下载后上传」列第一位;`drm` 用 §7.4 的整段说明。

**给 S1 所有者(这些是 S1 的文件,本计划不改):**
1. `app/library/CLAUDE.md` 的「What lives here」加两条:`urlcheck.py`——链接预检(只用标准库;每个解析地址都要公网;一个 `bad_url`,原因码只进日志);`ytdlp.py`——取回阶段的真实实现 `YtDlpFetch`(子进程规则、白名单、cookies 副本、固定正则分类、`fetch.json` 断点复用),由 `routers/library_import.install` 注册。
2. `routers/CLAUDE.md` 加 `library_import`(`POST /api/library/imports`,必须在 `stubs` 之前;`install(app)` 注册取回阶段)。
3. `server/README.md` 的跟读库一节:链接导入默认关;yt-dlp 升级流程(`cd server && uv lock --upgrade-package yt-dlp` → 测试 → 重建镜像);cookies 小号与只读挂载(见 `docker-compose.example.yml`);机房 IP 常被拦,最稳的是本机下载后上传;DRM 站点不支持;SSRF 剩余风险一句。
4. `tests/test_library_privacy.py`:S1 已把 `POST /api/library/imports` 放进 `LATER`(允许集合);本计划的 Task 5 用例覆盖它的请求体与日志。若 S1 之后想把它并进 `ROUTES` 做统一扫描,那是 S1 的事。
5. 若 Task 6 走分支 C:按结果文档里的交接改 `server/Dockerfile`。S1 计划(文末「交接」第 1 条)允许 S2 / Z 在 `Dockerfile` 只追加一行 `RUN`,在 `app/library/CLAUDE.md` 末尾只追加上面第 1 条的两个条目;本计划**仍按 spec §15 不碰这两个文件**,由 Z(或用户明确要求时的执行者)落地。

**给 A(管理端):** `from app.library.ytdlp import installed_version`(`str | None`)用于 overview 的 yt-dlp 版本;doctor 的 `library_ytdlp_missing` 与 S1 的 `library_link_available` 同一判断(能否 import `yt_dlp`)。

**给 Z:** 镜像体积(yt-dlp 依赖、可能的 deno)与 T0.3 的真实导入结果写进结果文档与 README 的「未验证」一节。

---

## Addendum (2026-10-13)

> 缘由:spec 当天修订(D8 译文与 AI 分析、E9 独立底部标签、D11 深色优先玻璃外观、D12 外观切换、§5.2 新增设置、§9 新端点),S1 计划(`2026-10-13-video-import-server-core.md`)随后写成并冻结了接口。本节逐条列出对本计划(S2 链接导入)的**全部**改动与裁定;**与前文冲突时以本节为准**(`docs/CLAUDE.md`)。正文里已同步改好的地方在下面标了「正文已改」。
> 本次只改计划文档,没有运行任何代码。

### 1. 对 spec 修订的逐项核对

| 修订项 | 对本计划的影响 |
|---|---|
| D8 / E11 / E12(译文、AI 分析、`library_segments` 四个新列、`library_ai_*` 四个设置、`translate` / `analysis` 端点、`app/library/ai.py`) | **无影响。** 本计划不碰句子、不碰大模型、不碰 `library_ai_*`;`FetchResult` 只供标题 / 字幕,不含译文。唯一相关的是隐私:链接导入的日志规则(§13)不变,D8 的「句子文字发给大模型上游」与本计划无关。 |
| E9(独立底部标签)、D9、D10(第二期清单)、D11(深色优先强玻璃、12 个效果、`library.css`)、D12(外观:跟随系统 / 浅色 / 深色) | **无影响**——全是网页与视觉。用户要求「可以切换深色和浅色」由 W1(`web/src/settings/*`、`layout/color-scheme.ts`)落地,本计划是纯服务端。D10 的第二期清单不进本计划。 |
| §5.2 设置表 | 本计划读到的设置没有变:`library_enabled`、`library_link_import_enabled`、`library_link_allow_generic`、`library_link_timeout_minutes`、`library_transcode_max_height`、`library_max_upload_mb`、`library_max_duration_minutes`、`library_imports_daily_per_user`、`library_max_items`、`library_ytdlp_cookies_file`、`library_ytdlp_proxy`(后两者 env-only、`str`、空 = 未配)。`library_job_concurrency`(默认 1,最大 4)与链接导入相关:每个条目有自己的 `_tmp/<id>/`、cookies 副本和 `HOME`,并发 > 1 时互不干扰(R-LI13、R-LI16 已满足,**无需改**)。新增属性 `library_ai_available` 与本计划无关。 |
| §9 `POST /api/library/imports` | 形状不变;限流与每日计数的语义不变。S1 的 `item_out` 比 spec 多 `resume_idx`、`has_poster`(见 §3 对 W1 的交接)。 |
| §13 隐私 | 规则不变;本计划新增了「经 S1 worker 的端到端日志扫描」(R-LI25),补上 spec §13「worker 的成功 / 失败 / 重试路径用假的 yt-dlp」对链接导入的覆盖。 |
| §15 文件归属 | 本计划的文件集合**不变**:`ytdlp.py`、`urlcheck.py`、`routers/library_import.py`、`pyproject.toml` / `uv.lock`、`docker-compose.example.yml`、两个测试文件,外加 `main.py` 的两个 S1 锚点。D8 / D12 增补里没有分给 S2 的文件。 |
| §16 开放问题 1–5 | 仍按推荐默认值:三个开关默认关;容量按默认;接受 B 档;平台自动字幕只在识别不可用时才用(R-LI6);不默认配 cookies / 代理,被拦时「本机下载后上传」列第一位。 |

### 2. 按 S1 计划核对后的改动与裁定

- **R-LI23 对齐 S1 的真实接口(正文已改:A 表、R-LI10、R-LI15、R-LI21、Task 4、Task 5)。**
  1. **`media.run` 给了 `on_stdout_line` 时不缓存 stdout**(S1 `RunResult.stdout` 恒为 `b""`)。初稿的下载阶段用回调读进度、却用 `proc.stdout` 判断 yt-dlp 的「File is larger than max-filesize」(那句打在 stdout、退出码 0、不产生文件)——在真实 runner 上永远读不到,`too_large` 会被误判成 `ytdlp_failed`。改为:`YtDlpFetch._download` 的行回调**同时**喂 `Progress` 并检测该句,返回 `(Proc, too_large)`;`FakeRunner` 照真实行为改为「带回调时 stdout 只经回调给、返回的 `Proc.stdout` 为空」。`stdout` 的类型是 `bytes`(`_text()` 已处理),`stderr` 是 `str`。
  2. **可用性打桩**用 S1 的两个模块函数:`monkeypatch.setattr(config_module, "media_tools_present" / "ytdlp_present", lambda: True)`(`tests/library_helpers.enable` 已封装前者)。取代初稿的 `Settings` property 打桩(R-LI15 作废)。
  3. **路由闸门**:S1 R-SC9 规定闸门是 `library_enabled`(关 → 404 `Library is disabled`,经 `errors.api_error("disabled")`);初稿用了 `library_available`(含 ffmpeg),会在 ffmpeg 缺失时错误地回 404。现在:`library_enabled` 关 → 404;`library_link_available` 假(链接开关关或 yt-dlp 缺)→ 404 `Link import is disabled`;ffmpeg 缺失 → 经 `admit_new_item` 的 `unavailable` 回 503 `Media tools are not installed`,且不扣每日计数。设置经 `Depends(get_settings)` 读(热更新)。
  4. **限额错误的固定文案**按 S1 的 `API_ERRORS` 写进测试:`max_items` → 409 `Library item limit reached`;`daily` → 429 `Daily import limit reached`;`quota` → 409 `Library storage quota reached`(初稿只断言「不是 400 / 404 / 422」)。`admit_new_item` 调用时不传 `size_bytes` / `upload`:链接的大小在创建时未知,配额只按已有用量拦,下载大小由取回阶段的 `too_large`(> `library_max_upload_mb`)与 `disk_full` 兜底。
  5. **标题清洗**用 S1 的 `store.clean_title(raw, fallback="")`(无标题存 `""`,R-LI10);`ytdlp.clean_title` 只保留给 `FetchResult.title`(S1 取回后还会再清一次,无害)。
  6. **测试夹具**:`test_library_urlcheck.py` 第二部分重定义 `settings_overrides`(合并 `library_settings(tmp_path, …)`,每个用例独立数据目录),所以「库关」用例要显式写 `library_enabled: False`。
- **R-LI24 取消 / 删除:`report` 抛 `Aborted` 必须停掉 yt-dlp 并原样穿出(正文已改:Task 4 `_download`、新测试)。** S1 的 `FetchRequest.report` 在条目离开 `processing` 后抛 `errors.Aborted`;`worker.cancel` 另外会 `task.cancel()` 运行中的任务。初稿的进度小任务把 `report` 的异常用 `gather(..., return_exceptions=True)` 吞掉了,子进程会一直下载到结束。现在子进程与进度小任务并行 `asyncio.wait(FIRST_COMPLETED)`:小任务先结束(只会因抛错)→ 取消子进程(`media.run` 在取消时 SIGTERM / SIGKILL)→ 重抛;外部取消两者都取消;`finally` 一定等它们结束,所以不需要进 `tests/background.py`(R-LI12 不变)。新测试 `test_an_aborted_report_stops_the_download`。*代价*:`report` 的任何异常(包括数据库错误)都会中止下载——它本来就会让条目失败。
- **R-LI25 端到端测试(正文已改:Task 5)。** 用 S1 的 `use_fakes`(假 ffmpeg)+ 本计划的 `FakeRunner`(新增 `contents` 参数写假媒体与 SRT)+ `process(app)`,三个用例:导入 → `ready`(标题补成平台标题、`sub_source="platform"`、`source_url` 清空、子进程环境没有密钥)、`blocked` → `failed`、`ytdlp_transient` → 回到 `queued` 并计 `attempts`;全部扫 `caplog` 里没有 URL / 视频 id / 标题 / stderr 片段 / cookies。这是 spec §13「worker 的成功 / 失败 / 重试路径」对链接导入的覆盖;S1 的 `test_library_privacy.py` 里 `POST /imports` 在 `LATER` 集合,由本计划自己的用例补请求体与日志。*代价*:Task 5 的测试依赖 S1 的 `tests/library_helpers.py` 与 Task 4 的 `FakeRunner`(跨测试模块导入,`tests/CLAUDE.md` 允许);S1 的 helper 改名时只改 Task 5 第二部分。
- **R-LI26 与 S1 流水线的相互作用(核对结论,无需改代码,仅记录)。**
  - S1 在取回后把 `subtitle_path` **移动**到 `_tmp/<id>/platform.srt`,并在转码成功后删除 `dl.*`;字幕阶段只看 `platform.srt` 是否在,与 `fetch` 的返回值无关。所以:转码之前失败后重试 → `fetch.json` 缓存仍指向 `dl.<ext>`,字幕文件已被移走时 `load_cache` 把 `subtitle_path` 置 `None`(正文已是这样),`platform.srt` 照样被 S1 用到;转码成功之后的重试 S1 直接跳过取回。
  - `subtitle_auto` S1 不读(`subtitles.parse` 自己去滚动重复),保留字段只为接口完整。
  - S1 的 `DROP_STAGING` 含全部链接专属永久错误:这些失败立刻删 `_tmp`(含 `fetch.json`),手动重试重新取回;`network` / `ytdlp_transient`(瞬时)与 `quota` / `disk_full` 保留,断点缓存才有意义。
  - S1 的 `FetchRequest.settings` 是真实 `Settings`,`s.library_link_available` 成立;`asr_available` = `settings.library_asr_available`。
- **R-LI27 spec §6.1「stdout 只解析进度」的偏离(沿用 R-LI7,现在明说)。** 探测必须读 stdout 的整份 JSON(`--dump-single-json`),所以 stdout 不只用于进度;约束是:**永远不记录、不参与错误分类**(分类只看 stderr)。下载阶段 stdout 只用于进度行与「larger than max-filesize」这一句。
- **R-LI28 给 W1 的错误文案交接(正文已改:交接 W1 第 2 条)。** `Invalid link`(400)与 `Link import is disabled`(404)不在 S1 的 `API_ERRORS` 里,因此不在 `library_contract.json` 录制的错误文本中;W1 的 `LIBRARY_SERVER_ERRORS` 要自己加这两条。若 W1 / S1 更愿意让它们进 `API_ERRORS`,那是 S1 的文件,本计划不改;改的话只需把路由里的两处文本换成 `api_error(code)`。spec §9 写「错误 `bad_url` 等」:本计划仍按 R-LI9 对所有预检拒绝回同一个 400,原因码只进日志。
- **R-LI29 文件归属不变,S1 允许的「顺手追加」不采用。** S1 计划的交接允许 S2 / Z 在 `app/library/CLAUDE.md` 末尾追加两个条目、在 `Dockerfile` 追加一行 `RUN`(分支 C)。本计划按 spec §15 仍不碰这两个文件,保持原交接(给 S1 所有者 / Z)。

### 3. 任务与测试的变化清单

| 位置 | 改动 |
|---|---|
| 文首、A-1 至 A-9 表 | 按 S1 计划改写(`Aborted`、`api_error`、`ADMIT`、`bytes` stdout、带回调不缓存、`admit_new_item` 的完整签名、`store.clean_title`、`media_tools_present` / `ytdlp_present`、两个锚点的原文、`LATER`) |
| R-LI10、R-LI15、R-LI21 | 就地改写并指向 R-LI23 |
| Task 0 Step 2 | 加 (e):`--max-filesize 1K` 重跑,记录退出码 / 有无文件 / stdout 有无该行;结果表加一行 |
| Task 0b | grep 清单扩充(`Aborted`、`api_error`、`ytdlp_present`、`tests/library_helpers.py` 等);对不上时的处理表加三行 |
| Task 4 | `FakeRunner` 照真实 `media.run` 行为(带回调 → stdout 为空,`contents` 参数);`_download` 重写并返回 `(Proc, too_large)`;`fetch` 里 `too_large` 判定改用它;新增 `test_an_aborted_report_stops_the_download`;too_large 用例加注释 |
| Task 5 | 导入与夹具改为 S1 的 helper;路由闸门与错误文案按 R-LI23;404 用例拆为四种 + yt-dlp 缺失 + ffmpeg 缺失(503、不扣每日);限额用例断言固定文案;新增三个端到端用例;`main.py` 锚点步骤写明两行锚点原文与顺序依赖 |
| 验证矩阵、未验证清单、交接 | 同步更新(新增三行矩阵、两条未验证、W1 / S1 交接各改一条) |
| 任务数 | 仍是 9 个(Task 0、0b、1 至 8),没有新增或删除任务 |

### 4. 风险与未验证(新增)

- **Addendum 改的代码全部没有运行过**:`_download` 的并行结构(`asyncio.wait` + 取消)、新的 `FakeRunner`、路由、Task 5 的端到端用例。写计划时的实跑数字(见文首)属于 Addendum 之前的代码。第一次运行以真实结果为准,差异先弄清原因,不得改裁定与接口名迁就。
- **UNVERIFIED(需要真实上游 / 真机)**:真实 yt-dlp 的 `max-filesize` 文案与 stdout 逐行到达(T0.2 (e));取消时真实子进程被终止并且不留半截文件(需要真机 / 目标服务器手工取消一次);YouTube 是否需要 JS 运行时、机房 IP 是否被拦(T0.2、T0.3,与初稿相同)。
- **S1 尚未合并**:A 表是对 S1 **计划**的核对;S1 实现时若改名,Task 0b 的映射表是唯一的适配点。
- **Postgres**:端到端用例只在 SQLite 上跑(与初稿一致;本计划不写 SQL)。
