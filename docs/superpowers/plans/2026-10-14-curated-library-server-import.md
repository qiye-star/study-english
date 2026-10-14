# 精选库 · 服务端导入与管理接口(车道 SI)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **前置:车道 SC(`2026-10-14-curated-library-server-core.md`)必须已合并。** 先读 `2026-10-14-curated-library-INDEX.md`(冻结接口、文件归属)与 spec `docs/superpowers/specs/2026-10-14-curated-library-design.md` §7、§9、R1、R9。本计划只调用 SC 的 `catalog_store`、`paths`、`ai.translate_texts`、`metering.system_scope`,**不改 SC 的文件**(`main.py` 只填 SC 放好的三处锚点)。

**Goal:** 让管理员只导入一次:按链接(复用 yt-dlp 取回阶段,`FetchRequest.system=True` 绕过面向用户的链接开关)或按分片上传(可附字幕)建目录条目;`CatalogJobs` 一次一个地运行 `catalog_import.process`(取回 → 探测 → 封面 → 只要音频的转码 → 字幕 / 平台字幕 / 识别 → 分句 → 系统付费的逐句翻译 → ready 未发布);管理接口 `/api/admin/library/catalog*` 覆盖列表、详情、导入、上传、元数据、发布 / 下架、重试 / 取消 / 补全译文、逐句编辑、删除(退役)/ 强制删除、媒体与封面。

**Architecture:** 不复用 `pipeline.process`(它与 `LibraryItem` 和按用户的识别额度绑死),而是复用零件:`FetchStage`、`MediaTools.probe/poster`、`subtitles.parse`、`segment.build`、`sentences.build`,以及从 `pipeline._transcribe` 抽出的两个助手 `prepare_chunks` / `run_chunks`(用户条目的行为与测试不变)。新增 `Ffmpeg.audio_only`(单声道 64 kbps m4a)。`CatalogJobs` 没有轮询循环:建条目、重试、补译、启动恢复时 `kick()`;它从 `app.state.library.deps` 取工具、取回阶段与识别器,所以测试里 `use_fakes(app)` 与 `set_fetch_stage(...)` 自动生效。所有上游调用 `bind_user(None)`:导入 feature `cat_import`,翻译 `cat_translate`。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy 2 async、pytest-asyncio、respx(假大模型)。

## Global Constraints

- **合并顺序:SC →(SI ‖ W)→ AU → Z。** AU 依赖本车道的端点(它可以先用 mock 开发)。
- **文件归属(INDEX §9):** `app/library/{media,pipeline,ytdlp,catalog_import,catalog_jobs}.py`、`app/admin/catalog_admin.py`、`app/routers/admin_catalog.py`、`app/admin/CLAUDE.md`、`app/main.py`(只填三处锚点)、`tests/library_helpers.py`(只加 `FakeTools.audio_only`)、`tests/test_library_catalog_import.py`、`tests/test_library_catalog_jobs.py`、`tests/test_admin_catalog.py`、`tests/test_library_ytdlp.py` 与 `tests/test_library_media.py`(只追加)。
- **不新增迁移**;不改 `tests/test_architecture.py`(全部在 `library` / `admin` / `routers` 内,分层允许)。
- **隐私:** 日志、错误、审计里没有标题、URL、许可说明、字幕 / 转写 / 句子 / 译文、yt-dlp / ffmpeg 输出;只有目录 id、阶段、`error_kind`、数字。审计 `after` 只放数字、布尔、状态。
- **测试口径:** 每个任务只跑列出的文件 + `tests/test_architecture.py`;不跑全量 / E2E / 容器;假工具(`FakeTools`)、假取回(本计划的 `FakeFetch`)、假识别(`FakeAsr`)、respx 假大模型;不联网。
- CRLF 工作树;Edit 改旧文件、Write 建新文件;conventional 提交,一个任务一个提交,结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;只 `git add` 本任务的文件。

## 文件结构

```
server/app/library/media.py            + audio_only_plan()、Ffmpeg.audio_only(Task 1)
server/tests/library_helpers.py        + FakeTools.audio_only(Task 1)
server/app/library/pipeline.py         + FetchRequest.system;prepare_chunks / run_chunks;公开别名(Task 2)
server/app/library/ytdlp.py            system 请求的开关判定(Task 2)
server/app/library/catalog_import.py   新(Task 3)
server/app/library/catalog_jobs.py     新(Task 4)
server/app/main.py                     填三处锚点(Task 4、Task 5)
server/app/admin/catalog_admin.py      新(Task 5、6)
server/app/routers/admin_catalog.py    新(Task 5、6)
server/app/admin/CLAUDE.md             (Task 7)
server/tests/test_library_catalog_import.py、test_library_catalog_jobs.py、test_admin_catalog.py   新
```

## 本计划的裁定

- **R-SI1 系统任务的「用户」是 0。** `FetchRequest.user_id=0`(yt-dlp 不用它),识别器 `deps.timed_transcriber(0)` / `deps.transcriber(0)`(`uid="0"` 只是上游的会话标识,核对 `speech/asr.py`:默认值就是 `"server"`);计量用 `bind_user(None)`,不是 0。
- **R-SI2 封面从源文件截。** 视频源先 `tools.poster(src, …)`,再 `audio_only`;纯音频源没有封面(网页显示音频图标)。
- **R-SI3 阶段与进度权重**(spec §7):链接 取回 0–30、探测 / 转码 30–45、字幕 / 识别 45–85、分句 85、翻译 85–99;上传 转码 0–20、字幕 / 识别 20–85。进度写库节流同用户流水线(≥ 2 个百分点或 ≥ 1 s)。
- **R-SI4 识别不预留每日额度**,但仍经 `make_transcriber`(带 `shared_asr_gate`),与实时通话共用闸门;`asr_seconds` 记实际秒数。
- **R-SI5 翻译失败不让导入失败。** 任何一批 `AiUnavailable` → 跳过这批、继续下一批;全部完成后条目 `ready`,有失败批次时 `error_kind="upstream"`(管理端显示「部分句子未翻译」,可点「补全译文」)。`library_ai_available` 为假 → 不翻译,`error_kind` 不设。
- **R-SI6 重新入队的条目从断点继续。** 有句子(`seg_count > 0`)→ 只跑翻译阶段(R9);有成品媒体 → 跳过取回与转码;`_tmp` 里的 `fetch.json`(S2 的缓存)与 `chunks.json` 接着用。
- **R-SI7 取消。** `uploading` / `queued` / `processing` 可取消:有句子的(补译中)→ 回到 `ready`、文件不动;否则 → `canceled`,删暂存与成品目录、`media_path` 等清空。`canceled` / `failed` 且从未 ready 的条目删除时直接删(引用数必为 0)。
- **R-SI8 管理端的上传与用户上传同一套规则**(8 MiB 分片、幂等补传、`unexpected_chunk`、扩展名白名单 `limits.UPLOAD_EXTENSIONS`、`library_max_upload_mb`),但锁在 `CatalogJobs.upload_lock`,文件在 `library/_catalog/_tmp/<id>/upload.<ext>.part`。不受每日新建次数、条目数与用户配额约束(系统内容)。
- **R-SI9 链接导入的可用性** = `library_available ∧ ytdlp_present()`;**不看** `library_link_import_enabled`(spec E5)。预检同用户导入:`urlcheck.extract_link` → `precheck(resolve=not proxy)`;拒绝一律 `400 Invalid link`,原因码只进日志。
- **R-SI10 角色**:查看 viewer;导入、上传、编辑、发布、重试、取消、补译、删除(退役)operator;强制删除 `require_step_up`(superadmin + 二次验证)。确认串:删除 `DELETE <id[:8]>`、强制删除 `PURGE <id[:8]>`,不对时 409 `Confirmation required` + `details.confirm`(与 `library_admin` 同法)。
- **R-SI11 删除前先停任务**:活动中的条目先走 R-SI7 的取消,再按 spec R1 删除 / 退役 / 强制删除。

---

## Task 0: 前置核对(只读)

- [ ] **Step 1:** `cd server && uv run alembic heads` → `0022`;`Grep "plan SI" server/app/main.py` → 三处锚点在;`Grep "catalog" server/tests/background.py` → 有 `catalog.pending`。
- [ ] **Step 2:** 读 `app/library/catalog_store.py`,逐条核对 INDEX §7 的签名;读 `pipeline._transcribe`(本计划 Task 2 要抽两个助手)与 `ytdlp.YtDlpFetch.fetch` 开头的开关判定。不一致 → 只改本计划自己的文件适配;改不了停下上报。

---

## Task 1: `Ffmpeg.audio_only` 与假工具(誊写)

**Files:** Modify `server/app/library/media.py`、`server/tests/library_helpers.py`、`server/tests/test_library_media.py`(追加)

- [ ] **Step 1: 失败测试**(追加到 `tests/test_library_media.py`):

```python
from app.library.media import audio_only_plan


def test_audio_only_plan_is_mono_64k_m4a(tmp_path):
    args, result = audio_only_plan(tmp_path)
    assert args == ["-vn", "-map", "0:a:0", "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
                    "-f", "mp4", str(tmp_path / "media.m4a")]
    assert (result.path, result.mime, result.kind) == (tmp_path / "media.m4a", "audio/mp4", "audio")


async def test_fake_tools_audio_only_writes_the_file(tmp_path):
    from tests.library_helpers import FakeTools, fake_media
    src = tmp_path / "in.mp4"
    src.write_bytes(fake_media())
    tools = FakeTools()
    out = await tools.audio_only(src, tmp_path, duration_ms=6000, home=tmp_path)
    assert out.path.read_bytes() == src.read_bytes() and tools.calls == ["audio_only"]
```

- [ ] **Step 2:** 跑 `uv run pytest -q tests/test_library_media.py` → 失败。
- [ ] **Step 3: 实现。** `media.py`(`normalize_plan` 之后):

```python
def audio_only_plan(out_dir: Path) -> tuple[list[str], Normalized]:
    """Curated catalog (spec 2026-10-14-curated-library D4): always re-encode to mono AAC 64 kbps m4a."""
    out = out_dir / "media.m4a"
    return (["-vn", "-map", "0:a:0", "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
             "-f", "mp4", str(out)], Normalized(out, "audio/mp4", "audio"))
```

  `Ffmpeg` 类里(`poster` 之前):

```python
    async def audio_only(self, src: Path, out_dir: Path, *, duration_ms: int, home: Path) -> Normalized:
        args, result = audio_only_plan(out_dir)
        cmd = [*self._base(), "-nostats", "-i", str(src), "-threads", THREADS, *args]
        done = await run(cmd, timeout=timeout_for(duration_ms), env=safe_env(home))
        if done.timed_out:
            raise LibraryError("unsupported_format")
        if done.returncode != 0 or not result.path.is_file():
            raise LibraryError(_failure_kind(done.stderr, "unsupported_format"))
        return result
```

  `tests/library_helpers.py` 的 `FakeTools` 里(`poster` 之前):

```python
    async def audio_only(self, src, out_dir, *, duration_ms, home):
        self._check("audio_only")
        out = out_dir / "media.m4a"
        out.write_bytes(src.read_bytes())
        return Normalized(out, "audio/mp4", "audio")
```

  `pipeline.MediaTools` 协议加 `async def audio_only(self, src: Path, out_dir: Path, *, duration_ms: int, home: Path) -> Any: ...`(放在 Task 2 一起改 `pipeline.py` 也可以;本任务只改 `media.py` 与助手)。
- [ ] **Step 4:** `uv run pytest -q tests/test_library_media.py tests/test_architecture.py` → 绿。**提交** `feat(server): mono 64 kbps audio-only transcode for the catalog`。

---

## Task 2: `pipeline` 两个助手、`FetchRequest.system`、yt-dlp 的系统旗标(强模型)

**Files:** Modify `server/app/library/pipeline.py`、`server/app/library/ytdlp.py`、`server/tests/test_library_ytdlp.py`(追加)

- [ ] **Step 1: 失败测试**(追加到 `tests/test_library_ytdlp.py`):

```python
from dataclasses import replace

from app.core import config as config_module


async def test_a_system_request_ignores_the_user_link_switch_but_not_the_library_switch(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)
    runner = FakeRunner(files=["dl.mp4"])
    req = replace(request(tmp_path, library_link_available=False, library_enabled=True), system=True)
    result = await stage(runner).fetch(req)
    assert result.media_path.name == "dl.mp4" and len(runner.calls) == 2
    with pytest.raises(LibraryError) as e:
        await stage(FakeRunner()).fetch(replace(request(tmp_path / "b", library_link_available=False,
                                                        library_enabled=False), system=True))
    assert e.value.kind == "link_disabled"
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: False)
    with pytest.raises(LibraryError) as e:
        await stage(FakeRunner()).fetch(replace(request(tmp_path / "c", library_link_available=False,
                                                        library_enabled=True), system=True))
    assert e.value.kind == "link_disabled"


def test_fetch_request_defaults_to_a_user_request(tmp_path):
    assert request(tmp_path).system is False
```

- [ ] **Step 2:** 跑 `uv run pytest -q tests/test_library_ytdlp.py` → 失败。
- [ ] **Step 3: `pipeline.py`。**
  - `FetchRequest` 末尾加 `system: bool = False  # curated catalog import (spec 2026-10-14-curated-library E5): no user's link switch`。
  - `MediaTools` 协议加 `audio_only`(见 Task 1)。
  - 把 `_transcribe` 拆成两个公开助手(行为不变),并在模块末尾加公开别名:

```python
async def prepare_chunks(deps: PipelineDeps, media: Path, duration_ms: int, tmp: Path
                         ) -> tuple[list[asr_chunks.Chunk], list[asr_chunks.Silence], Path, Path]:
    """The WAV, the silence table and the chunk plan, resumed from `_tmp` when present (shared with the catalog
    import, plan 2026-10-14-curated-library SI). Returns (chunks, silences, wav, state_path)."""
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
        overlap = limits.ASR_HARD_CUT_OVERLAP_MS if deps.timed_transcriber is not None else 0  # R-V5
        chunks = asr_chunks.plan_chunks(duration_ms, silences, overlap_ms=overlap)
        asr_chunks.save_state(state_path, chunks)
    return chunks, silences, wav, state_path


async def run_chunks(deps: PipelineDeps, chunks: list[asr_chunks.Chunk], wav: Path, state_path: Path,
                     transcribe: Callable[[bytes], Awaitable[TimedText]],
                     on_chunk: Callable[[int, int], Awaitable[None]]) -> int:
    """Transcribe the chunks that have no text yet (checkpointed after each); returns the seconds spent."""
    async def read(chunk: asr_chunks.Chunk) -> bytes:
        return await asyncio.to_thread(asr_chunks.slice_wav, wav, chunk.start_ms, chunk.end_ms)

    return await asr_chunks.transcribe_chunks_timed(
        chunks, read=read, transcribe=transcribe, save=lambda c: asr_chunks.save_state(state_path, c),
        progress=on_chunk, concurrency=limits.ASR_CONCURRENCY, retries=limits.ASR_CHUNK_RETRIES)
```

    `_transcribe` 改为:`chunks, silences, wav, state_path = await prepare_chunks(deps, media, duration_ms, tmp)`;其后的
    额度预留、`transcribe` 选择、`on_chunk`、`try: spent = await run_chunks(deps, chunks, wav, state_path, transcribe, on_chunk)`、
    失败退还、`sentences.build` 与日志**原样保留**(只是删掉已移入助手的那几段)。
  - 文件末尾:

```python
# public names for the curated catalog import (plan 2026-10-14-curated-library SI); the user pipeline keeps using
# the private ones
platform_cues = _platform_cues
fragments = _fragments
untimed = _untimed
input_file = _input_file
```

- [ ] **Step 4: `ytdlp.py`。** 导入 `from app.core import config as core_config`;`fetch` 里把
  `if not s.library_link_available:` 改为

```python
            # a user import needs the user switch; the curated catalog import (system=True, spec 2026-10-14 E5)
            # needs only the library switch and yt-dlp itself
            if not (s.library_link_available or (req.system and s.library_enabled and core_config.ytdlp_present())):
```

- [ ] **Step 5:** `uv run pytest -q tests/test_library_ytdlp.py tests/test_library_worker.py tests/test_library_words_pipeline.py tests/test_library_asr_timed.py tests/test_library_reprocess.py tests/test_library_privacy.py tests/test_architecture.py` → 全绿(用户流水线的行为不变)。
- [ ] **Step 6: 提交** `refactor(server): share chunked transcription helpers; system fetch requests`。

---

## Task 3: `catalog_import.process`(强模型)

**Files:** Create `server/app/library/catalog_import.py`、`server/tests/test_library_catalog_import.py`

- [ ] **Step 1: 失败测试** `server/tests/test_library_catalog_import.py`(直接调用 `process`;任务运行器在 Task 4):

```python
"""一条目录条目的导入(spec 2026-10-14-curated-library §7;plan SI Task 3)。"""
import json
import logging

import httpx
import pytest
import respx

from app.library import catalog_import, catalog_store, paths, pipeline
from app.library.errors import Aborted, LibraryError
from app.library.pipeline import FetchResult
from app.models import CatalogItem, utcnow
from tests.library_helpers import SRT, FakeAsr, FakeTools, enable, fake_media, library_settings, use_fakes

LLM = "https://llm.test/v1/chat/completions"


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_ai_enabled=True)


class FakeFetch:
    """A link fetch: writes the media (and optional subtitles) into the request's `_tmp`, records the request."""

    def __init__(self, media: bytes, subs: bytes | None = None, title: str | None = "Page title"):
        self.media, self.subs, self.title = media, subs, title
        self.requests = []

    async def fetch(self, req):
        self.requests.append(req)
        req.tmp_dir.mkdir(parents=True, exist_ok=True)
        (req.tmp_dir / "dl.mp4").write_bytes(self.media)
        subs = None
        if self.subs is not None:
            subs = req.tmp_dir / "subs.en.srt"
            subs.write_bytes(self.subs)
        await req.report(100)
        return FetchResult(media_path=req.tmp_dir / "dl.mp4", title=self.title, duration_ms=6000,
                           subtitle_path=subs, subtitle_auto=False, source_host="learningenglish.voanews.com")


async def queued(app, *, source="upload", title="Talk", url=None, status="processing") -> str:
    async with app.state.sessionmaker() as s:
        row = await catalog_store.create(s, source=source, status=status, title=title, level="B1", tags=[],
                                         license_note=None, ai_lang="zh-CN", source_url=url)
        return row.id


def staged_upload(app, cid: str, data: bytes, subs: bytes | None = None) -> None:
    tmp = paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / f"{pipeline.INPUT_PREFIX}mp4").write_bytes(data)
    if subs is not None:
        (tmp / pipeline.UPLOADED_SUBS).write_bytes(subs)


async def row_of(app, cid) -> CatalogItem:
    async with app.state.sessionmaker() as s:
        return await s.get(CatalogItem, cid)


def run(app, cid):
    return catalog_import.process(app.state.library.deps, cid, http=app.state.http, translate_template=None)


def reply(text):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


@respx.mock
async def test_upload_with_subtitles_becomes_a_ready_unpublished_audio_item_with_translations(app):
    tools = use_fakes(app)
    respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。\n2. 你今天好吗?"))
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=True), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.status, row.published, row.sub_source, row.seg_count, row.media_mime) == (
        "ready", False, "uploaded", 2, "audio/mp4")
    assert row.media_path == f"{paths.catalog_rel(cid)}/media.m4a" and row.poster_path.endswith("poster.jpg")
    data_dir = app.state.library.deps.data_dir
    assert (paths.catalog_dir(data_dir, cid) / "media.m4a").is_file()
    assert not paths.catalog_tmp_dir(data_dir, cid).exists()
    assert "audio_only" in tools.calls and "normalize" not in tools.calls
    async with app.state.sessionmaker() as s:
        assert [x.zh for x in await catalog_store.segments_of(s, cid)] == ["你好,我的朋友。", "你今天好吗?"]


async def test_audio_source_has_no_poster(app):
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert row.status == "ready" and row.poster_path is None and row.error_kind is None


async def test_link_import_uses_a_system_fetch_and_platform_subtitles(app):
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    fetch = FakeFetch(fake_media(6000), subs=SRT)
    app.state.library.set_fetch_stage(fetch)
    cid = await queued(app, source="link", title="", url="https://learningenglish.voanews.com/a/x.html")
    await run(app, cid)
    (req,) = fetch.requests
    assert req.system is True and req.user_id == 0 and req.item_id == cid
    assert req.tmp_dir == paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid)
    row = await row_of(app, cid)
    assert (row.status, row.sub_source, row.title, row.source_url, row.source_host) == (
        "ready", "platform", "Page title", None, "learningenglish.voanews.com")


async def test_without_subtitles_it_transcribes_as_the_system(app):
    asr = FakeAsr(["Hello there, my friend. How are you doing today?"])
    use_fakes(app, asr=asr)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False,
                                                               "library_asr_enabled": True,
                                                               "library_asr_minutes_daily_per_user": 0,
                                                               "library_asr_minutes_global_daily": 0})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False))
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.status, row.sub_source) == ("ready", "asr") and row.seg_count >= 1 and row.asr_seconds > 0
    assert asr.calls  # daily allowances at 0 did not stop it: the catalog reserves none (R-SI4)


async def test_no_subtitles_and_no_asr_fails_permanently(app):
    use_fakes(app)
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False))
    with pytest.raises(LibraryError) as e:
        await run(app, cid)
    assert e.value.kind == "no_subtitles"
    row = await row_of(app, cid)
    assert (paths.catalog_dir(app.state.library.deps.data_dir, cid) / "media.m4a").is_file()  # kept for a retry
    assert row.media_path is not None


async def test_too_long_and_no_audio(app):
    use_fakes(app)
    cid = await queued(app)
    staged_upload(app, cid, fake_media(91 * 60_000), SRT)
    with pytest.raises(LibraryError) as e:
        await run(app, cid)
    assert e.value.kind == "too_long"
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, audio=False), SRT)
    with pytest.raises(LibraryError) as e:
        await run(app, cid)
    assert e.value.kind == "no_audio"


async def test_a_canceled_item_aborts_without_writing_rows(app):
    use_fakes(app)
    cid = await queued(app, status="canceled")
    with pytest.raises(Aborted):
        await run(app, cid)


@respx.mock
async def test_translation_failures_leave_the_item_ready_with_upstream(app):
    use_fakes(app)
    respx.post(LLM).mock(return_value=httpx.Response(502, json={"error": "boom"}))
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.status, row.error_kind, row.seg_count) == ("ready", "upstream", 2)


@respx.mock
async def test_a_translate_only_rerun_translates_just_the_missing_sentences(app):
    use_fakes(app)
    route = respx.post(LLM).mock(return_value=reply("1. 你今天好吗?"))
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000), SRT)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    await run(app, cid)
    async with app.state.sessionmaker() as s:
        await catalog_store.set_translations(s, cid, [(0, "Hello there, my friend.", "你好。")], "zh-CN")
        row = await s.get(CatalogItem, cid)
        row.status = "processing"
        await s.commit()
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": True})
    await run(app, cid)
    sent = json.loads(route.calls[0].request.content)["messages"][1]["content"]
    assert "How are you doing today?" in sent and "Hello there" not in sent
    async with app.state.sessionmaker() as s:
        assert [x.zh for x in await catalog_store.segments_of(s, cid)] == ["你好。", "你今天好吗?"]


async def test_logs_carry_no_title_url_or_text(app, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    app.state.library.set_fetch_stage(FakeFetch(fake_media(6000), subs=SRT.replace(b"Hello", b"SECRET-SUB"),
                                                title="SECRET-TITLE"))
    cid = await queued(app, source="link", title="", url="https://example.invalid/SECRET-URL")
    await run(app, cid)
    text = " ".join(f"{r.getMessage()} {r.args!r}" for r in caplog.records)
    assert "SECRET" not in text and any("catalog" in r.getMessage() for r in caplog.records)
```

- [ ] **Step 2:** 跑 `uv run pytest -q tests/test_library_catalog_import.py` → 失败。
- [ ] **Step 3: 实现** `server/app/library/catalog_import.py`:

```python
"""精选库一条目录条目的导入(spec 2026-10-14-curated-library §7;INDEX §7)。

取回(链接,`FetchRequest.system=True`)→ 探测 → 封面(视频源)→ `audio_only` → 上传的字幕 > 平台字幕 > 识别(系统付费,
不预留每日额度)→ 分句 → 写 `catalog_segments` → 逐句翻译(`ai.translate_texts`,系统付费;失败不让导入失败)→ ready(未发布)。
已有句子的条目(补全译文,spec R9)只跑翻译。复用用户流水线的零件,不复用 `pipeline.process`(它绑定 LibraryItem 与用户额度)。
日志只有目录 id、阶段、种类与数字。"""
import asyncio
import logging
import time
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import update

from app.core import metering
from app.library import ai, catalog_store, paths, pipeline, segment, sentences as sentences_mod, store, subtitles
from app.library.errors import Aborted, LibraryError
from app.library.limits import AI_BATCH_MAX
from app.library.pipeline import FetchRequest, PipelineDeps
from app.models import CatalogItem

logger = logging.getLogger(__name__)

FEATURE = "cat_import"  # metering feature of the import job (<= 16 chars)
SYSTEM_USER = 0  # FetchRequest.user_id / transcriber argument for system jobs (R-SI1)


class Progress:
    """Throttled stage / progress writes on the catalog row; `Aborted` once it left `processing`."""

    def __init__(self, deps: PipelineDeps, catalog_id: str, monotonic: Callable[[], float] = time.monotonic):
        self._deps, self._id, self._monotonic = deps, catalog_id, monotonic
        self.stage: str | None = None
        self.value = -100
        self._at = float("-inf")

    async def set(self, stage: str, value: int) -> None:
        now = self._monotonic()
        if stage == self.stage and (value == self.value or (value - self.value < 2 and now - self._at < 1.0)):
            return
        async with self._deps.sessionmaker() as s:
            if not await catalog_store.set_progress(s, self._id, stage, value, self._deps.clock()):
                raise Aborted()
        self.stage, self.value, self._at = stage, value, now


async def _load(deps: PipelineDeps, catalog_id: str) -> CatalogItem:
    async with deps.sessionmaker() as s:
        row = await s.get(CatalogItem, catalog_id)
    if row is None or row.status != "processing":
        raise Aborted()
    return row


async def _media_stage(deps: PipelineDeps, row: CatalogItem, tmp: Path, progress: Progress) -> int:
    settings = deps.settings()
    link = row.source == "link"
    t0, t1 = (30, 45) if link else (0, 20)
    if link:
        await progress.set("fetch", 0)

        async def report(percent: int) -> None:
            await progress.set("fetch", round(30 * max(0, min(100, percent)) / 100))

        result = await deps.fetch().fetch(FetchRequest(
            item_id=row.id, user_id=SYSTEM_USER, url=row.source_url or "", tmp_dir=tmp, settings=settings,
            asr_available=settings.library_asr_available, report=report, system=True))
        src = result.media_path
        if result.subtitle_path is not None and result.subtitle_path.is_file():
            paths.replace(result.subtitle_path, tmp / pipeline.PLATFORM_SUBS)
        values = {}
        if result.title and not row.title:
            values["title"] = store.clean_title(result.title)
        if result.source_host and not row.source_host:
            values["source_host"] = result.source_host[:64]
        if values:
            async with deps.sessionmaker() as s:
                await s.execute(update(CatalogItem).where(CatalogItem.id == row.id).values(**values))
                await s.commit()
    else:
        src = pipeline.input_file(tmp)
        if src is None:
            raise LibraryError("corrupt")
    await progress.set("probe", t0)
    info = await deps.tools.probe(src, home=tmp)
    if not info.has_audio:
        raise LibraryError("no_audio")
    if info.duration_ms > settings.library_max_duration_minutes * 60_000:
        raise LibraryError("too_long")
    if paths.disk_free(tmp) < 2 * paths.file_bytes(src):
        raise LibraryError("disk_full")
    await progress.set("transcode", t0)
    out_dir = tmp / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    poster = out_dir / "poster.jpg"
    has_poster = info.has_video and await deps.tools.poster(src, poster, info.duration_ms, home=tmp)  # R-SI2
    normalized = await deps.tools.audio_only(src, out_dir, duration_ms=info.duration_ms, home=tmp)
    await progress.set("transcode", t1)
    final = paths.catalog_dir(deps.data_dir, row.id)
    media_dst = final / "media.m4a"
    paths.replace(normalized.path, media_dst)
    if has_poster:
        paths.replace(poster, final / "poster.jpg")
    size = paths.file_bytes(media_dst) + (paths.file_bytes(final / "poster.jpg") if has_poster else 0)
    rel = paths.catalog_rel(row.id)
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == row.id,
                                                         CatalogItem.status == "processing").values(
            duration_ms=info.duration_ms, media_path=f"{rel}/media.m4a",
            poster_path=f"{rel}/poster.jpg" if has_poster else None, media_mime=normalized.mime,
            media_bytes=size, updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        paths.remove_tree(final)
        raise Aborted()
    src.unlink(missing_ok=True)  # the original download / upload is not kept
    logger.info("library catalog media ready catalog=%s duration_ms=%d bytes=%d poster=%s", row.id,
                info.duration_ms, size, "yes" if has_poster else "no")
    return info.duration_ms


async def _add_asr_seconds(deps: PipelineDeps, catalog_id: str, seconds: int) -> None:
    if seconds > 0:
        async with deps.sessionmaker() as s:
            await s.execute(update(CatalogItem).where(CatalogItem.id == catalog_id)
                            .values(asr_seconds=CatalogItem.asr_seconds + seconds))
            await s.commit()


async def _sentences(deps: PipelineDeps, row: CatalogItem, media: Path, duration_ms: int, tmp: Path,
                     progress: Progress):
    """(sentences, flags, sub_source, low_confidence) by the spec E6 priority."""
    settings = deps.settings()
    t0 = 45 if row.source == "link" else 20
    await progress.set("subtitles", t0)
    if (tmp / pipeline.UPLOADED_SUBS).is_file():
        cues = subtitles.parse((tmp / pipeline.UPLOADED_SUBS).read_bytes())
        built = segment.build(pipeline.fragments(cues))
        if not built:
            raise LibraryError("bad_subtitle")
        return built, None, "uploaded", False
    if (tmp / pipeline.PLATFORM_SUBS).is_file() and (cues := pipeline.platform_cues(tmp / pipeline.PLATFORM_SUBS)):
        return segment.build(pipeline.fragments(cues)), None, "platform", False
    if not settings.library_asr_available:
        raise LibraryError("no_subtitles")
    chunks, silences, wav, state_path = await pipeline.prepare_chunks(deps, media, duration_ms, tmp)
    transcribe = (deps.timed_transcriber(SYSTEM_USER) if deps.timed_transcriber is not None
                  else pipeline.untimed(deps.transcriber(SYSTEM_USER)))

    async def on_chunk(done: int, total: int) -> None:
        await progress.set("transcribe", t0 + (85 - t0) * done // max(1, total))

    await progress.set("transcribe", t0)
    before = sum(c.seconds for c in chunks if c.text is not None)
    try:
        spent = await pipeline.run_chunks(deps, chunks, wav, state_path, transcribe, on_chunk)
    except BaseException:
        await _add_asr_seconds(deps, row.id, sum(c.seconds for c in chunks if c.text is not None) - before)
        raise
    await _add_asr_seconds(deps, row.id, spent)
    built = await asyncio.to_thread(sentences_mod.build, chunks, silences)
    logger.info("library catalog transcribed catalog=%s chunks=%d seconds=%d sentences=%d", row.id, len(chunks),
                spent, len(built.sentences))
    return built.sentences, built.flags, "asr", built.low_confidence


async def _translate(deps: PipelineDeps, http, catalog_id: str, language: str, template: str | None,
                     progress: Progress) -> tuple[int, bool]:
    """(stored, any batch failed). Only sentences without a translation in `language`; R-SI5."""
    settings = deps.settings()
    if not settings.library_ai_available:
        return 0, False
    async with deps.sessionmaker() as s:
        todo = [(x.idx, x.text) for x in await catalog_store.segments_of(s, catalog_id)
                if not (x.zh and x.zh_lang == language)]
    stored, failed = 0, False
    for start in range(0, len(todo), AI_BATCH_MAX):
        batch = todo[start:start + AI_BATCH_MAX]
        await progress.set("translate", 85 + 14 * start // max(1, len(todo)))
        try:
            with metering.feature_scope(ai.FEATURE_CAT_TRANSLATE):
                got = await ai.translate_texts(http, settings, template=template, language=language,
                                               texts=[text for _idx, text in batch])
        except ai.AiUnavailable:
            failed = True
            continue
        async with deps.sessionmaker() as s:
            stored += len(await catalog_store.set_translations(
                s, catalog_id, [(batch[n][0], batch[n][1], zh) for n, zh in sorted(got.items())], language))
    logger.info("library catalog translated catalog=%s stored=%d todo=%d failed=%s", catalog_id, stored, len(todo),
                "yes" if failed else "no")
    return stored, failed


async def process(deps: PipelineDeps, catalog_id: str, *, http, translate_template: str | None) -> None:
    """Run one claimed catalog item to `ready` (unpublished). Raises LibraryError or Aborted (the job runner maps
    them). The caller binds no user and sets feature `cat_import`."""
    row = await _load(deps, catalog_id)
    tmp = paths.catalog_tmp_dir(deps.data_dir, row.id)
    tmp.mkdir(parents=True, exist_ok=True)
    progress = Progress(deps, row.id)
    if row.seg_count == 0:
        media = None
        if row.media_path:
            candidate = paths.absolute(deps.data_dir, row.media_path)
            media = candidate if candidate.is_file() else None
        if media is None:
            duration_ms = await _media_stage(deps, row, tmp, progress)
            row = await _load(deps, catalog_id)
            media = paths.absolute(deps.data_dir, row.media_path)
        else:
            duration_ms = row.duration_ms or 0
        built, flags, sub_source, low = await _sentences(deps, row, media, duration_ms, tmp, progress)
        if not built:
            raise LibraryError("no_subtitles")
        await progress.set("segment", 85)
        async with deps.sessionmaker() as s:
            fresh = await s.get(CatalogItem, catalog_id)
            if fresh is None or fresh.status != "processing":
                raise Aborted()
            await catalog_store.write_segments(s, fresh, built, flags=flags)
            fresh.sub_source, fresh.low_confidence, fresh.updated_at = sub_source, low, deps.clock()
            await s.commit()
    _stored, failed = await _translate(deps, http, catalog_id, row.ai_lang, translate_template, progress)
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                         CatalogItem.status == "processing").values(
            status="ready", stage=None, progress=100, error_kind="upstream" if failed else None, source_url=None,
            updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        raise Aborted()
    paths.remove_tree(tmp)
    logger.info("library catalog ready catalog=%s", catalog_id)
```

- [ ] **Step 4:** `uv run pytest -q tests/test_library_catalog_import.py tests/test_architecture.py` → 绿。首次运行若 `FakeAsr` 分句结果与 `seg_count >= 1` 之外的断言有出入,以真实结果修正测试数据,不改代码裁定。
- [ ] **Step 5: 提交** `feat(server): curated catalog import pipeline (audio only, system-paid)`。

---

## Task 4: `CatalogJobs` 与 `main.py` 锚点(强模型)

**Files:** Create `server/app/library/catalog_jobs.py`、`server/tests/test_library_catalog_jobs.py`;Modify `server/app/main.py`(锚点 1、2)

- [ ] **Step 1: 失败测试** `server/tests/test_library_catalog_jobs.py`:

```python
"""CatalogJobs(plan SI Task 4):一次一个、kick 触发、失败 / 取消 / 恢复、系统计量。"""
import asyncio

import pytest

from app.core import metering
from app.library import catalog_jobs, catalog_store, paths
from app.models import CatalogItem, utcnow
from tests.background import drain_background
from tests.library_helpers import SRT, FakeTools, enable, fake_media, library_settings, use_fakes
from tests.test_library_catalog_import import queued, row_of, staged_upload


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path)


async def kick_and_wait(app) -> None:
    app.state.catalog.kick()
    await drain_background(app)


async def test_installed_on_app_state(app):
    assert isinstance(app.state.catalog, catalog_jobs.CatalogJobs)


async def test_queued_items_run_one_after_another(app, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    ids = []
    for _ in range(2):
        cid = await queued(app, status="queued")
        staged_upload(app, cid, fake_media(6000), SRT)
        ids.append(cid)
    await kick_and_wait(app)
    assert [(await row_of(app, cid)).status for cid in ids] == ["ready", "ready"]


async def test_nothing_runs_without_media_tools(app):
    cid = await queued(app, status="queued")  # no enable(): ffmpeg is "missing"
    await kick_and_wait(app)
    assert (await row_of(app, cid)).status == "queued"


async def test_failures_are_recorded_without_auto_retry(app, monkeypatch):
    enable(monkeypatch)
    use_fakes(app, FakeTools(fail={"probe": "corrupt"}))
    cid = await queued(app, status="queued")
    staged_upload(app, cid, fake_media(6000), SRT)
    await kick_and_wait(app)
    row = await row_of(app, cid)
    assert (row.status, row.error_kind) == ("failed", "corrupt")
    assert not paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid).exists()  # useless staging dropped


async def test_a_crash_is_upstream_and_jobs_bind_no_user(app, monkeypatch):
    enable(monkeypatch)
    seen = []

    class Boom(FakeTools):
        async def probe(self, *a, **kw):
            seen.append((metering.current_user_id(), metering.current_feature()))
            raise RuntimeError("bug")

    use_fakes(app, Boom())
    metering.bind_user(99)
    cid = await queued(app, status="queued")
    staged_upload(app, cid, fake_media(6000), SRT)
    await kick_and_wait(app)
    assert (await row_of(app, cid)).error_kind == "upstream"
    assert seen == [(None, "cat_import")]
    metering.bind_user(None)


async def test_recover_requeues_processing_items_and_runs_them(app, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    cid = await queued(app, status="processing")
    staged_upload(app, cid, fake_media(6000), SRT)
    assert await app.state.catalog.recover() == 1
    await drain_background(app)
    assert (await row_of(app, cid)).status == "ready"


async def test_cancel_stops_a_running_job(app, monkeypatch):
    enable(monkeypatch)
    gate = asyncio.Event()

    class Slow(FakeTools):
        async def probe(self, *a, **kw):
            await gate.wait()
            return await super().probe(*a, **kw)

    use_fakes(app, Slow())
    cid = await queued(app, status="queued")
    staged_upload(app, cid, fake_media(6000), SRT)
    app.state.catalog.kick()
    for _ in range(50):
        if cid in app.state.catalog.running:
            break
        await asyncio.sleep(0.01)
    async with app.state.sessionmaker() as s:
        row = await s.get(CatalogItem, cid)
        row.status = "canceled"
        await s.commit()
    await app.state.catalog.cancel(cid)
    await drain_background(app)
    assert (await row_of(app, cid)).status == "canceled"
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: 实现** `server/app/library/catalog_jobs.py`:

```python
"""精选库的导入任务(spec 2026-10-14-curated-library E6):`app.state.catalog`。

一次一个、没有轮询循环:建条目、重试、补全译文、启动恢复时 `kick()`;`run_once()` 连续认领直到队列为空。
工具、取回阶段、识别器取自 `app.state.library.deps`(测试的 use_fakes / set_fetch_stage 自动生效)。
不自动重试(管理员按「重试」)。每个任务 `bind_user(None)` + feature `cat_import`。日志只有目录 id、种类与数字。"""
import asyncio
import logging
import time
import weakref

from app.core import metering
from app.library import catalog_import, catalog_store, paths
from app.library.errors import Aborted, LibraryError
from app.library.pipeline import PipelineDeps
from app.library.worker import DROP_STAGING
from app.services.prompts import prompt_cache

logger = logging.getLogger(__name__)

CANCEL_WAIT_SECONDS = 5.0


class CatalogJobs:
    def __init__(self, app, *, monotonic=time.monotonic):
        self._app = app
        self._monotonic = monotonic
        self.pending: set[asyncio.Task] = set()
        self.running: dict[str, asyncio.Task] = {}
        self._runner: asyncio.Task | None = None
        self._again = False
        self._canceled: set[str] = set()
        self._locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()

    @property
    def deps(self) -> PipelineDeps:
        return self._app.state.library.deps

    def upload_lock(self, catalog_id: str) -> asyncio.Lock:
        lock = self._locks.get(catalog_id)
        if lock is None:
            lock = self._locks[catalog_id] = asyncio.Lock()
        return lock

    def kick(self) -> None:
        if self._runner is not None and not self._runner.done():
            self._again = True
            return
        task = asyncio.get_running_loop().create_task(self.run_once())
        self._runner = task
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)

    async def run_once(self) -> int:
        count = 0
        while True:
            if not self.deps.settings().library_available:
                return count
            self._again = False
            async with self.deps.sessionmaker() as s:
                row = await catalog_store.claim_next(s, self.deps.clock())
            if row is None:
                if self._again:
                    continue
                return count
            job = asyncio.get_running_loop().create_task(self._job(row.id))
            self.running[row.id] = job
            self.pending.add(job)
            job.add_done_callback(self.pending.discard)
            await asyncio.gather(job, return_exceptions=True)
            count += 1

    async def _job(self, catalog_id: str) -> None:
        started = self._monotonic()
        metering.bind_user(None)  # the system pays (spec R4); this task's own context copy
        try:
            _version, template = await prompt_cache(self._app).get("library.translate")
            with metering.feature_scope(catalog_import.FEATURE):
                await catalog_import.process(self.deps, catalog_id, http=self._app.state.http,
                                             translate_template=template)
        except Aborted:
            logger.info("library catalog job aborted catalog=%s", catalog_id)
        except asyncio.CancelledError:
            if catalog_id not in self._canceled:
                raise  # shutdown: the row stays `processing`, recovered at the next start
            logger.info("library catalog job canceled catalog=%s", catalog_id)
        except LibraryError as e:
            await self._failed(catalog_id, e.kind)
        except Exception as e:  # noqa: BLE001 - a bug: classify as upstream, log the class only
            logger.warning("library catalog job crashed catalog=%s error=%s", catalog_id, type(e).__name__)
            await self._failed(catalog_id, "upstream")
        else:
            logger.info("library catalog job done catalog=%s ms=%d", catalog_id, (self._monotonic() - started) * 1000)
        finally:
            self.running.pop(catalog_id, None)
            self._canceled.discard(catalog_id)

    async def _failed(self, catalog_id: str, kind: str) -> None:
        async with self.deps.sessionmaker() as s:
            await catalog_store.fail(s, catalog_id, kind, self.deps.clock())
        if kind in DROP_STAGING:
            paths.remove_tree(paths.catalog_tmp_dir(self.deps.data_dir, catalog_id))
        logger.info("library catalog job failed catalog=%s kind=%s", catalog_id, kind)

    async def cancel(self, catalog_id: str) -> None:
        """Stop a running job (the caller already changed the row) and wait for its subprocesses."""
        task = self.running.get(catalog_id)
        if task is None or task.done():
            return
        self._canceled.add(catalog_id)
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(asyncio.gather(task, return_exceptions=True)), CANCEL_WAIT_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            logger.warning("library catalog cancel slow catalog=%s", catalog_id)

    async def recover(self) -> int:
        async with self.deps.sessionmaker() as s:
            count = await catalog_store.recover(s, self.deps.clock())
        logger.info("library catalog recovered=%d", count)
        self.kick()
        return count

    async def shutdown(self, wait: float = 2.0) -> None:
        tasks = [t for t in self.pending if not t.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), wait)
            except (TimeoutError, asyncio.TimeoutError):
                logger.warning("library catalog shutdown left jobs=%d", len([t for t in tasks if not t.done()]))


def install(app) -> CatalogJobs:
    """Build the one runner on `app.state.catalog` (called from `create_app` at plan SC's anchor)."""
    jobs = CatalogJobs(app)
    app.state.catalog = jobs
    return jobs
```

  `catalog_jobs` 导入 `worker`(同包)只为了 `DROP_STAGING`;`worker` 不导入 `catalog_jobs`,没有环。
- [ ] **Step 4: `main.py` 锚点。** 顶部导入旁加 `from app.library.catalog_jobs import install as install_catalog  # curated catalog jobs (plan 2026-10-14 SI)`;锚点 1 下一行 `install_catalog(app)`;锚点 2 两处分别为 `await app_.state.catalog.recover()  # requeue + run interrupted catalog imports` 与 `await app_.state.catalog.shutdown()`。
- [ ] **Step 5:** `uv run pytest -q tests/test_library_catalog_jobs.py tests/test_library_catalog_import.py tests/test_library_worker.py tests/test_architecture.py` → 绿。
- [ ] **Step 6: 提交** `feat(server): catalog import job runner`。

---

## Task 5: 管理接口第一部分:状态、列表、详情、导入、上传、元数据、发布(大多誊写)

**Files:** Create `server/app/admin/catalog_admin.py`、`server/app/routers/admin_catalog.py`、`server/tests/test_admin_catalog.py`;Modify `server/app/main.py`(锚点 3)

- [ ] **Step 1: 失败测试** `server/tests/test_admin_catalog.py`(第一部分):

```python
"""管理端精选库(spec 2026-10-14-curated-library §9、R1;INDEX §6)。"""
import logging

import pytest
from sqlalchemy import select

from app.core import config as config_module
from app.library import catalog_store, paths
from app.models import AdminAudit, CatalogItem
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.background import drain_background
from tests.catalog_helpers import make_catalog, media_file
from tests.library_helpers import SRT, enable, fake_media, library_settings, use_fakes
from tests.test_admin_api import register
from tests.test_library_catalog_import import FakeFetch

BASE = "/api/admin/library/catalog"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True,
                                                library_ytdlp_proxy="http://proxy.invalid:3128")}


async def upload_catalog(client, h, data: bytes, *, subs: bytes | None = None, **meta) -> str:
    r = await client.post(f"{BASE}/uploads", headers=h, json={"filename": "Talk.mp4", "size": len(data), **meta})
    assert r.status_code == 200, r.text
    cid, size = r.json()["catalog_id"], r.json()["chunk_bytes"]
    for n in range(max(1, (len(data) + size - 1) // size)):
        r = await client.put(f"{BASE}/uploads/{cid}/chunks/{n}", headers=h,
                             files={"chunk": ("blob", data[n * size:(n + 1) * size], "application/octet-stream")})
        assert r.status_code == 200, r.text
    if subs is not None:
        r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                             files={"file": ("t.srt", subs, "application/x-subrip")})
        assert r.status_code == 200, r.text
    r = await client.post(f"{BASE}/uploads/{cid}/complete", headers=h)
    assert r.status_code == 200, r.text
    return cid


async def test_state_and_roles(app, client, monkeypatch):
    enable(monkeypatch)
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)
    h = await login_as(app, client, "viewer")
    r = await client.get(BASE, headers=h)
    assert r.status_code == 200
    state = r.json()["state"]
    assert state["enabled"] is True and state["available"] is True and state["link"] is True
    assert state["proxy_configured"] is True and "zh-CN" in state["languages"] and state["chunk_bytes"] == 8388608
    assert (await client.post(f"{BASE}/imports", headers=h, json={"url": "https://x.invalid/a"})).status_code == 403


async def test_upload_runs_to_a_ready_unpublished_item_then_publish(app, client, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000), subs=SRT, title="Talk one", level="b1",
                               tags=["News"], license_note="VOA Learning English · Public domain")
    await drain_background(app)
    detail = (await client.get(f"{BASE}/{cid}", headers=h)).json()
    item = detail["item"]
    assert (item["status"], item["published"], item["level"], item["tags"], item["seg_count"]) == (
        "ready", False, "B1", ["News"], 2)
    assert [s["text"] for s in detail["segments"]] == ["Hello there, my friend.", "How are you doing today?"]
    r = await client.post(f"{BASE}/{cid}/publish", headers=h, json={})
    assert r.status_code == 200 and r.json()["item"]["published"] is True
    _uid, uh = await register(client, "anna")
    assert [c["id"] for c in (await client.get("/api/library/catalog", headers=uh)).json()["items"]] == [cid]
    r = await client.post(f"{BASE}/{cid}/unpublish", headers=h, json={})
    assert r.json()["item"]["published"] is False
    assert (await client.get("/api/library/catalog", headers=uh)).json()["items"] == []
    actions = [a.action for a in (await _audits(app))]
    assert {"catalog.upload", "catalog.publish", "catalog.unpublish"} <= set(actions)


async def _audits(app):
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all())


async def test_link_import_runs_with_the_user_switch_off(app, client, monkeypatch):
    enable(monkeypatch)
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)
    use_fakes(app)
    app.state.library.set_fetch_stage(FakeFetch(fake_media(6000), subs=SRT))
    assert app.state.settings.library_link_import_enabled is False
    h = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/imports", headers=h,
                          json={"url": "看这个 https://learningenglish.voanews.com/a/7000000.html 好", "tags": []})
    assert r.status_code == 200, r.text
    cid = r.json()["item"]["id"]
    await drain_background(app)
    item = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (item["status"], item["source"], item["title"], item["sub_source"]) == (
        "ready", "link", "Page title", "platform")
    assert (await client.post(f"{BASE}/imports", headers=h, json={"url": "file:///etc/passwd"})).json() == {
        "error": "Invalid link"}
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: False)
    r = await client.post(f"{BASE}/imports", headers=h, json={"url": "https://learningenglish.voanews.com/a/1.html"})
    assert (r.status_code, r.json()) == (503, {"error": "Link import is unavailable"})


async def test_metadata_validation_and_edits(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app, published=False)
    r = await client.patch(f"{BASE}/{cid}", headers=h, json={"title": "  New  title ", "level": None,
                                                             "tags": ["a", "b"], "license_note": "TED · CC BY-NC-ND 4.0"})
    item = r.json()["item"]
    assert (item["title"], item["level"], item["tags"], item["license_note"]) == (
        "New title", None, ["a", "b"], "TED · CC BY-NC-ND 4.0")
    assert (await client.patch(f"{BASE}/{cid}", headers=h, json={"level": "Z9"})).status_code == 400
    assert (await client.patch(f"{BASE}/{cid}", headers=h, json={"tags": list("abcdef")})).status_code == 400
    assert (await client.post(f"{BASE}/uploads", headers=h, json={"filename": "a.exe", "size": 10})).json() == {
        "error": "Unsupported file type"}


async def test_publish_needs_a_ready_item_with_media(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    busy = await make_catalog(app, status="processing", published=False)
    gone = await make_catalog(app, published=False, with_files=False)
    assert (await client.post(f"{BASE}/{busy}/publish", headers=h, json={})).json() == {"error": "Item is not ready"}
    assert (await client.post(f"{BASE}/{gone}/publish", headers=h, json={})).json() == {"error": "Media is missing"}
    assert (await client.get(f"{BASE}/{gone}", headers=h)).json()["item"]["media_missing"] is True


async def test_admin_media_plays_with_the_cookie_and_supports_range(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "viewer")
    cid = await make_catalog(app)
    r = await client.get(f"{BASE}/{cid}/media", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and len(r.content) == 10
    assert (await client.get(f"{BASE}/{cid}/poster")).status_code == 200
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: 业务** `server/app/admin/catalog_admin.py`(第一部分;Task 6 追加删除类):

```python
"""管理端「精选库」(spec 2026-10-14-curated-library §9、§11、R1、R5;plan SI)。

目录是系统内容:管理员可以看标题与句子(R5),但审计只记 id、动作、数字与布尔。数据库读写经 `app.library.catalog_store`
(车道 SC),任务经 `app.state.catalog`(`CatalogJobs`)。"""
import logging

from sqlalchemy import update

from app.admin import audit
from app.core import config as core_config
from app.library import ai, catalog_store, limits, paths, store, subtitles, urlcheck
from app.library.errors import LibraryError
from app.library.pipeline import INPUT_PREFIX, UPLOADED_SUBS
from app.models import CatalogItem, utcnow
from app.services import usage

logger = logging.getLogger(__name__)


class CatalogAdminError(Exception):
    def __init__(self, status: int, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details


def _err(status: int, message: str, details: dict | None = None) -> CatalogAdminError:
    return CatalogAdminError(status, message, details)


def jobs(app):
    return app.state.catalog


def data_dir(app):
    return app.state.library.deps.data_dir


def clean_meta(*, title=None, level=None, tags=None, license_note=None, ai_lang=None, partial: bool) -> dict:
    """Validated metadata (400 on a bad value). `partial` keeps absent keys absent (PATCH)."""
    out: dict = {}
    try:
        if title is not None or not partial:
            out["title"] = store.clean_title(title, fallback="")
        if level is not None or not partial:
            out["level"] = catalog_store.clean_level(level)
        if tags is not None or not partial:
            out["tags"] = catalog_store.clean_tags(tags)
        if license_note is not None or not partial:
            out["license_note"] = catalog_store.clean_license(license_note)
    except ValueError as e:
        raise _err(400, f"Invalid {e.args[0]}") from None
    if not partial:
        language = ai_lang or catalog_store.DEFAULT_AI_LANG
        if language not in ai.LANGS:
            raise _err(400, "Unsupported language")
        out["ai_lang"] = language
    return out


async def row_out(session, app, row: CatalogItem) -> dict:
    refs = await catalog_store.refs(session, row.id)
    translated = (await catalog_store.translated_counts(session, [row]))[row.id]
    return catalog_store.admin_out(row, refs=refs, translated=translated,
                                   media_missing=catalog_store.media_missing(data_dir(app), row))


async def state(session, app) -> dict:
    s = app.state.settings
    day = limits.day_of(utcnow())
    used = s.library_catalog_ai_daily - await usage.remaining(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day,
                                                              s.library_catalog_ai_daily)
    return {"enabled": s.library_catalog_enabled, "available": s.library_available, "asr": s.library_asr_available,
            "ai": s.library_ai_available, "link": bool(s.library_enabled and core_config.ytdlp_present()),
            "proxy_configured": bool((s.library_ytdlp_proxy or "").strip()), "ai_daily": s.library_catalog_ai_daily,
            "ai_today": max(0, used), "languages": list(ai.LANGS), "levels": list(catalog_store.LEVELS),
            "chunk_bytes": limits.CHUNK_BYTES, "max_upload_mb": s.library_max_upload_mb,
            "formats": list(limits.UPLOAD_EXTENSIONS)}


async def list_items(session, app) -> dict:
    rows = await catalog_store.list_all(session)
    refs = await catalog_store.ref_counts(session, [r.id for r in rows])
    translated = await catalog_store.translated_counts(session, rows)
    return {"items": [catalog_store.admin_out(r, refs=refs.get(r.id, 0), translated=translated.get(r.id, 0),
                                              media_missing=catalog_store.media_missing(data_dir(app), r))
                      for r in rows],
            "state": await state(session, app)}


async def get_row(session, catalog_id: str) -> CatalogItem:
    row = await catalog_store.get(session, catalog_id)
    if row is None:
        raise _err(404, "Catalog item not found")
    return row


async def detail(session, app, catalog_id: str) -> dict:
    row = await get_row(session, catalog_id)
    segs = await catalog_store.segments_of(session, row.id)
    return {"item": await row_out(session, app, row), "segments": [catalog_store.segment_admin_out(s) for s in segs]}


async def create_import(session, app, actor, *, url: str, meta: dict) -> dict:
    s = app.state.settings
    if not s.library_available:
        raise _err(503, "Media tools are not installed")
    if not core_config.ytdlp_present():
        raise _err(503, "Link import is unavailable")
    try:
        checked = await urlcheck.precheck(urlcheck.extract_link(url), resolve=not (s.library_ytdlp_proxy or "").strip())
    except urlcheck.UrlRejected as e:
        logger.info("library catalog import rejected reason=%s", e.reason)
        raise _err(400, "Invalid link") from None
    row = await catalog_store.create(session, source="link", status="queued", source_url=checked.url,
                                     source_host=checked.source_host, **meta)
    await audit.record(session, actor, "catalog.import", target_type="catalog_item", target_id=row.id,
                       after={"source": "link"})
    await session.commit()
    jobs(app).kick()
    logger.info("library catalog import queued catalog=%s", row.id)
    return {"item": await row_out(session, app, row)}


async def start_upload(session, app, actor, *, filename: str, size: int, meta: dict) -> dict:
    s = app.state.settings
    if not s.library_available:
        raise _err(503, "Media tools are not installed")
    ext = store.extension_of(filename)
    if ext not in limits.UPLOAD_EXTENSIONS:
        raise _err(400, "Unsupported file type")
    if size > s.library_max_upload_mb * limits.MB:
        raise _err(413, "File is too large")
    if not meta.get("title"):
        meta = {**meta, "title": store.title_from_filename(filename)}
    row = await catalog_store.create(session, source="upload", status="uploading", upload_total=size, **meta)
    tmp = paths.catalog_tmp_dir(data_dir(app), row.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / f"upload.{ext}.part").write_bytes(b"")
    await audit.record(session, actor, "catalog.upload", target_type="catalog_item", target_id=row.id,
                       after={"bytes": size})
    await session.commit()
    logger.info("library catalog upload started catalog=%s bytes=%d", row.id, size)
    return {"catalog_id": row.id, "chunk_bytes": limits.CHUNK_BYTES}


def upload_state(row: CatalogItem) -> dict:
    return {"catalog_id": row.id, "status": row.status, "upload_received": row.upload_received,
            "upload_total": row.upload_total, "chunk_bytes": limits.CHUNK_BYTES}


def _part(app, catalog_id: str):
    tmp = paths.catalog_tmp_dir(data_dir(app), catalog_id)
    return next(iter(sorted(tmp.glob("upload.*.part"))), None) if tmp.is_dir() else None


async def put_chunk(session, app, catalog_id: str, n: int, data: bytes) -> dict:
    """Same rules as the user upload (R-SI8): idempotent resend, strict order, exact size."""
    row = await get_row(session, catalog_id)
    async with jobs(app).upload_lock(row.id):
        await session.refresh(row)
        if row.status != "uploading":
            raise _err(409, "Upload is not in progress")
        part = _part(app, row.id)
        if part is None:
            raise _err(409, "Upload expired")
        offset = n * limits.CHUNK_BYTES
        expected = min(limits.CHUNK_BYTES, row.upload_total - offset)
        if offset + len(data) <= row.upload_received and len(data) == expected:
            return upload_state(row)
        if offset != row.upload_received:
            raise _err(409, "Unexpected chunk")
        if expected <= 0 or len(data) != expected:
            raise _err(400, "Wrong chunk size")
        with part.open("ab") as fh:
            fh.write(data)
        row.upload_received += len(data)
        row.updated_at = utcnow()
        await session.commit()
    return upload_state(row)


async def put_subtitles(session, app, catalog_id: str, data: bytes) -> dict:
    """While uploading, or to retry a `failed(no_subtitles)` item (then it is queued again)."""
    row = await get_row(session, catalog_id)
    if not (row.status == "uploading" or (row.status == "failed" and row.error_kind == "no_subtitles")):
        raise _err(409, "Subtitles cannot be changed now")
    try:
        cues = subtitles.parse(data)
    except LibraryError:
        raise _err(400, "Invalid subtitle file") from None
    tmp = paths.catalog_tmp_dir(data_dir(app), row.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / UPLOADED_SUBS).write_bytes(data)
    if row.status == "failed":
        row.status, row.stage, row.progress, row.error_kind, row.updated_at = "queued", None, 0, None, utcnow()
        await session.commit()
        jobs(app).kick()
    return {"cue_count": len(cues)}


async def complete_upload(session, app, catalog_id: str) -> dict:
    row = await get_row(session, catalog_id)
    async with jobs(app).upload_lock(row.id):
        await session.refresh(row)
        if row.status != "uploading":
            raise _err(409, "Upload is not in progress")
        if row.upload_received != row.upload_total:
            raise _err(409, "Upload is incomplete")
        part = _part(app, row.id)
        if part is None:
            raise _err(409, "Upload expired")
        part.rename(part.with_name(f"{INPUT_PREFIX}{part.name.split('.')[1]}"))
        row.status, row.updated_at = "queued", utcnow()
        await session.commit()
    jobs(app).kick()
    return {"item": await row_out(session, app, row)}


async def patch_meta(session, app, actor, catalog_id: str, changes: dict) -> dict:
    row = await get_row(session, catalog_id)
    meta = clean_meta(**changes, partial=True)
    if "title" in meta:
        row.title = meta["title"] or row.title
    if "level" in changes:
        row.level = meta.get("level")
    if "tags" in meta:
        row.tags = ",".join(meta["tags"]) or None
    if "license_note" in changes:
        row.license_note = meta.get("license_note")
    row.updated_at = utcnow()
    await audit.record(session, actor, "catalog.edit", target_type="catalog_item", target_id=row.id,
                       after={"fields": len(changes)})
    await session.commit()
    return {"item": await row_out(session, app, row)}


async def set_published(session, app, actor, catalog_id: str, published: bool) -> dict:
    row = await get_row(session, catalog_id)
    if published:
        if row.retired_at is not None:
            raise _err(409, "Item is retired")
        if row.status != "ready" or row.seg_count <= 0:
            raise _err(409, "Item is not ready")
        if catalog_store.media_missing(data_dir(app), row):
            raise _err(409, "Media is missing")
        row.published, row.published_at = True, row.published_at or utcnow()
    else:
        row.published = False
    row.updated_at = utcnow()
    await audit.record(session, actor, "catalog.publish" if published else "catalog.unpublish",
                       target_type="catalog_item", target_id=row.id, after={"published": published})
    await session.commit()
    return {"item": await row_out(session, app, row)}
```

  - `patch_meta` 里 `level` / `license_note` 用 `"level" in changes` 判断,是为了让 `null` 能清空;路由用 `model_dump(exclude_unset=True)` 传 `changes`(**不是** `exclude_none`)。`clean_meta(partial=True)` 对显式 `None` 的 `level` 返回 `None`(`clean_level(None)`)。
- [ ] **Step 4: 路由** `server/app/routers/admin_catalog.py`:

```python
"""/api/admin/library/catalog*:精选库的导入、上传、审核、发布、编辑、删除(spec 2026-10-14-curated-library §9)。
业务在 app/admin/catalog_admin.py。URL 里只有 uuid 与序号。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.admin import catalog_admin
from app.admin.perms import AdminContext, require, require_step_up
from app.core.deps import get_session
from app.library import limits, paths
from app.services.uploads import parse_buffered_form

router = APIRouter(prefix="/api/admin/library/catalog")
CatalogUuid = Annotated[str, Path(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
NO_STORE = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"}


def _error(e: catalog_admin.CatalogAdminError) -> JSONResponse:
    body: dict = {"error": e.message}
    if e.details:
        body["details"] = e.details
    return JSONResponse(body, status_code=e.status)


async def _guard(session, call):
    try:
        return await call()
    except catalog_admin.CatalogAdminError as e:
        await session.rollback()
        return _error(e)


class Meta(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=400)
    level: str | None = Field(default=None, max_length=4)
    tags: list[Annotated[str, Field(max_length=64)]] | None = Field(default=None, max_length=10)
    license_note: str | None = Field(default=None, max_length=600)


class ImportIn(Meta):
    url: str = Field(min_length=1, max_length=4000)
    ai_lang: str | None = Field(default=None, max_length=16)


class UploadIn(Meta):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=1)
    ai_lang: str | None = Field(default=None, max_length=16)


class Empty(BaseModel):
    model_config = ConfigDict(extra="forbid")


async def _form_bytes(request: Request, field: str, limit: int) -> bytes | catalog_admin.CatalogAdminError:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit + limits.CHUNK_SLACK:
        return catalog_admin.CatalogAdminError(413, "File is too large")
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > limit + limits.CHUNK_SLACK:
            return catalog_admin.CatalogAdminError(413, "File is too large")
    form = await parse_buffered_form(request, body)
    try:
        upload = form.get(field)
        if not isinstance(upload, UploadFile):
            return catalog_admin.CatalogAdminError(400, "File is required")
        data = await upload.read()
    finally:
        await form.close()
    return data if len(data) <= limit else catalog_admin.CatalogAdminError(413, "File is too large")


@router.get("")
async def catalog_list(request: Request, _: AdminContext = Depends(require("viewer")),
                       session: AsyncSession = Depends(get_session)):
    return await catalog_admin.list_items(session, request.app)


@router.get("/{catalog_id}")
async def catalog_detail(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("viewer")),
                         session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.detail(session, request.app, catalog_id))


@router.post("/imports")
async def catalog_import(body: ImportIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    async def call():
        meta = catalog_admin.clean_meta(title=body.title, level=body.level, tags=body.tags,
                                        license_note=body.license_note, ai_lang=body.ai_lang, partial=False)
        return await catalog_admin.create_import(session, request.app, ctx.actor, url=body.url, meta=meta)
    return await _guard(session, call)


@router.post("/uploads")
async def catalog_upload(body: UploadIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    async def call():
        meta = catalog_admin.clean_meta(title=body.title, level=body.level, tags=body.tags,
                                        license_note=body.license_note, ai_lang=body.ai_lang, partial=False)
        return await catalog_admin.start_upload(session, request.app, ctx.actor, filename=body.filename,
                                                size=body.size, meta=meta)
    return await _guard(session, call)


@router.put("/uploads/{catalog_id}/chunks/{n}")
async def catalog_chunk(catalog_id: CatalogUuid, request: Request, n: int = Path(ge=0, le=1_000_000),
                        _: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    data = await _form_bytes(request, "chunk", limits.CHUNK_BYTES)
    if isinstance(data, catalog_admin.CatalogAdminError):
        return _error(data)
    return await _guard(session, lambda: catalog_admin.put_chunk(session, request.app, catalog_id, n, data))


@router.put("/uploads/{catalog_id}/subtitles")
async def catalog_subtitles(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("operator")),
                            session: AsyncSession = Depends(get_session)):
    data = await _form_bytes(request, "file", limits.SUBTITLE_MAX_BYTES)
    if isinstance(data, catalog_admin.CatalogAdminError):
        return _error(data)
    return await _guard(session, lambda: catalog_admin.put_subtitles(session, request.app, catalog_id, data))


@router.post("/uploads/{catalog_id}/complete")
async def catalog_complete(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("operator")),
                           session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.complete_upload(session, request.app, catalog_id))


@router.patch("/{catalog_id}")
async def catalog_patch(catalog_id: CatalogUuid, body: Meta, request: Request,
                        ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return _error(catalog_admin.CatalogAdminError(400, "No changes"))
    return await _guard(session, lambda: catalog_admin.patch_meta(session, request.app, ctx.actor, catalog_id, changes))


@router.post("/{catalog_id}/publish")
async def catalog_publish(catalog_id: CatalogUuid, _body: Empty, request: Request,
                          ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.set_published(session, request.app, ctx.actor, catalog_id, True))


@router.post("/{catalog_id}/unpublish")
async def catalog_unpublish(catalog_id: CatalogUuid, _body: Empty, request: Request,
                            ctx: AdminContext = Depends(require("operator")),
                            session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.set_published(session, request.app, ctx.actor, catalog_id, False))


async def _file(session, request: Request, catalog_id: str, column: str, mime: str | None):
    row = await catalog_admin.get_row(session, catalog_id)
    rel = getattr(row, column)
    if not rel:
        raise catalog_admin.CatalogAdminError(404, "Not Found")
    try:
        path = paths.absolute(catalog_admin.data_dir(request.app), rel)
    except ValueError:
        raise catalog_admin.CatalogAdminError(404, "Not Found") from None
    if not path.is_file():
        raise catalog_admin.CatalogAdminError(404, "Not Found")
    return FileResponse(path, media_type=mime or row.media_mime or "application/octet-stream", headers=NO_STORE)


@router.get("/{catalog_id}/media")
@router.head("/{catalog_id}/media")
async def catalog_media(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("viewer")),
                        session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: _file(session, request, catalog_id, "media_path", None))


@router.get("/{catalog_id}/poster")
async def catalog_poster(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("viewer")),
                         session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: _file(session, request, catalog_id, "poster_path", "image/jpeg"))
```

  - 注意:`HEAD` 与 `GET` 共享一个函数是现有做法(`routers/library.py::media`);`tests/test_admin_routes_guarded.py` 要求每个方法 + 路径唯一且有角色,`require("viewer")` 满足。`require_step_up` 在 Task 6 用。
- [ ] **Step 5: `main.py` 锚点 3** 下一行 `admin_catalog,`(导入元组按字母序加 `admin_catalog`)。
- [ ] **Step 6:** `uv run pytest -q tests/test_admin_catalog.py tests/test_admin_routes_guarded.py tests/test_architecture.py` → 绿。
- [ ] **Step 7: 提交** `feat(server): admin catalog list, import, chunked upload, edit and publish`。

---

## Task 6: 管理接口第二部分:重试、取消、补全译文、逐句编辑、删除 / 退役、强制删除

**Files:** Modify `server/app/admin/catalog_admin.py`、`server/app/routers/admin_catalog.py`、`server/tests/test_admin_catalog.py`(追加)

- [ ] **Step 1: 追加失败测试**:

```python
async def test_retry_cancel_and_translate(app, client, monkeypatch):
    import httpx
    import respx
    enable(monkeypatch)
    use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000))  # no subtitles, ASR off -> failed(no_subtitles)
    await drain_background(app)
    item = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (item["status"], item["error_kind"]) == ("failed", "no_subtitles")
    r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert r.status_code == 200
    await drain_background(app)
    assert (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]["status"] == "ready"
    assert (await client.post(f"{BASE}/{cid}/retry", headers=h, json={})).json() == {"error": "Item has not failed"}
    assert (await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})).json() == {"error": "Item is not running"}
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": True})
    with respx.mock:
        respx.post("https://llm.test/v1/chat/completions").mock(return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "1. 你好,我的朋友。\n2. 你今天好吗?"}}]}))
        assert (await client.post(f"{BASE}/{cid}/translate", headers=h, json={})).status_code == 200
        await drain_background(app)
    item = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (item["status"], item["translated"]) == ("ready", 2)
    await client.post(f"{BASE}/{cid}/publish", headers=h, json={})
    assert (await client.post(f"{BASE}/{cid}/translate", headers=h, json={})).json() == {"error": "Item is published"}


async def test_cancel_an_upload_removes_its_staging(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/uploads", headers=h, json={"filename": "a.mp4", "size": 10})
    cid = r.json()["catalog_id"]
    r = await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})
    assert r.json()["item"]["status"] == "canceled"
    assert not paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid).exists()


async def test_segment_edits_only_while_unpublished(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app, published=False)
    r = await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"text": "Hello there, my good friend."})
    seg = r.json()["segment"]
    assert seg["text"] == "Hello there, my good friend." and seg["zh"] is None  # stale translation cleared (R8)
    r = await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"zh": "你好,我的好朋友。"})
    assert (r.json()["segment"]["zh"], r.json()["segment"]["zh_lang"]) == ("你好,我的好朋友。", "zh-CN")
    assert (await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"end_ms": 3500})).json() == {
        "error": "Invalid sentence times"}  # overlaps sentence 1 (starts at 3200)
    assert (await client.patch(f"{BASE}/{cid}/segments/9", headers=h, json={"text": "x y"})).status_code == 404
    await client.post(f"{BASE}/{cid}/publish", headers=h, json={})
    assert (await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"text": "Hi."})).json() == {
        "error": "Item is published"}


async def test_delete_without_copies_removes_everything(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    r = await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "重复", "confirm": "nope"})
    assert r.status_code == 409 and r.json()["details"]["confirm"] == f"DELETE {cid[:8]}"
    r = await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "重复", "confirm": f"DELETE {cid[:8]}"})
    assert r.json() == {"id": cid, "outcome": "deleted", "refs": 0}
    assert not media_file(app, cid).exists()


async def test_delete_with_copies_retires_and_copies_keep_playing(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    _uid, uh = await register(client, "anna")
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=uh)).json()["item"]["id"]
    r = await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "下线", "confirm": f"DELETE {cid[:8]}"})
    assert r.json() == {"id": cid, "outcome": "retired", "refs": 1}
    row = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (row["retired"], row["published"]) == (True, False)
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=uh)).json()["url"]
    assert (await client.get(url)).status_code == 200
    assert (await client.post(f"{BASE}/{cid}/publish", headers=h, json={})).json() == {"error": "Item is retired"}
    await client.delete(f"/api/library/items/{item}", headers=uh)  # the last copy goes -> collected (SC)
    assert (await client.get(f"{BASE}/{cid}", headers=h)).status_code == 404


async def test_purge_needs_step_up_and_deletes_copies(app, client, monkeypatch):
    enable(monkeypatch)
    cid = await make_catalog(app)
    _uid, uh = await register(client, "anna")
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=uh)).json()["item"]["id"]
    op = await login_as(app, client, "operator")
    body = {"reason": "版权投诉", "confirm": f"PURGE {cid[:8]}"}
    assert (await client.post(f"{BASE}/{cid}/purge", headers=op, json=body)).status_code == 403
    su = await login_as(app, client, "superadmin")
    assert (await client.post(f"{BASE}/{cid}/purge", headers=su, json=body)).status_code == 403  # no step-up yet
    await client.post("/api/admin/step-up", headers=su, json={"password": PASSWORD})
    r = await client.post(f"{BASE}/{cid}/purge", headers=su, json=body)
    assert r.json() == {"id": cid, "copies_deleted": 1, "users": 1}
    assert (await client.get(f"/api/library/items/{item}", headers=uh)).status_code == 404
    assert not media_file(app, cid).exists()
    audits = {a.action: a for a in await _audits(app)}
    assert audits["catalog.purge"].after == {"copies": 1, "users": 1}


async def test_admin_logs_and_audit_carry_no_titles_or_text(app, client, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable(monkeypatch)
    use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000), subs=SRT.replace(b"Hello", b"SECRET-SUB"),
                               title="SECRET-TITLE", license_note="SECRET-LICENSE")
    await drain_background(app)
    await client.patch(f"{BASE}/{cid}", headers=h, json={"title": "SECRET-TITLE 2"})
    await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"text": "SECRET-EDIT words", "zh": "SECRET-ZH"})
    await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "r", "confirm": f"DELETE {cid[:8]}"})
    text = " ".join(f"{r.getMessage()} {r.args!r}" for r in caplog.records)
    assert "SECRET" not in text
    for a in await _audits(app):
        assert "SECRET" not in f"{a.summary} {a.before} {a.after}"
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: 业务**(追加到 `catalog_admin.py`):

```python
def delete_phrase(catalog_id: str) -> str:
    return f"DELETE {catalog_id[:8]}"


def purge_phrase(catalog_id: str) -> str:
    return f"PURGE {catalog_id[:8]}"


async def retry(session, app, actor, catalog_id: str) -> dict:
    row = await get_row(session, catalog_id)
    if row.status != "failed":
        raise _err(409, "Item has not failed")
    row.status, row.stage, row.progress, row.error_kind, row.updated_at = "queued", None, 0, None, utcnow()
    await audit.record(session, actor, "catalog.retry", target_type="catalog_item", target_id=row.id)
    await session.commit()
    jobs(app).kick()
    return {"item": await row_out(session, app, row)}


async def _stop(session, app, row: CatalogItem) -> bool:
    """R-SI7. False = not active. A translate-only re-run goes back to ready and keeps its files."""
    if row.status not in catalog_store.ACTIVE:
        return False
    restore = row.seg_count > 0
    values = dict(status="ready", stage=None, progress=100) if restore else dict(status="canceled", stage=None)
    done = await session.execute(update(CatalogItem).where(CatalogItem.id == row.id,
                                                           CatalogItem.status.in_(catalog_store.ACTIVE))
                                 .values(updated_at=utcnow(), **values))
    await session.commit()
    if done.rowcount != 1:
        return False
    await jobs(app).cancel(row.id)
    paths.remove_tree(paths.catalog_tmp_dir(data_dir(app), row.id))
    if not restore:
        paths.remove_tree(paths.catalog_dir(data_dir(app), row.id))
        await session.execute(update(CatalogItem).where(CatalogItem.id == row.id).values(
            media_path=None, poster_path=None, media_bytes=0, source_url=None))
        await session.commit()
    await session.refresh(row)
    return True


async def cancel(session, app, actor, catalog_id: str) -> dict:
    row = await get_row(session, catalog_id)
    before = row.status
    if not await _stop(session, app, row):
        raise _err(409, "Item is not running")
    await audit.record(session, actor, "catalog.cancel", target_type="catalog_item", target_id=row.id,
                       before={"status": before})
    await session.commit()
    return {"item": await row_out(session, app, row)}


async def translate(session, app, actor, catalog_id: str) -> dict:
    """Spec R9: unpublished + ready + AI available -> queued; the job only translates what is missing."""
    row = await get_row(session, catalog_id)
    if row.published:
        raise _err(409, "Item is published")
    if row.status != "ready" or row.seg_count <= 0:
        raise _err(409, "Item is not ready")
    if not app.state.settings.library_ai_available:
        raise _err(503, "AI is unavailable")
    row.status, row.stage, row.progress, row.error_kind, row.updated_at = "queued", None, 0, None, utcnow()
    await audit.record(session, actor, "catalog.translate", target_type="catalog_item", target_id=row.id)
    await session.commit()
    jobs(app).kick()
    return {"item": await row_out(session, app, row)}


async def patch_segment(session, app, actor, catalog_id: str, idx: int, changes: dict) -> dict:
    """Spec R8, only while unpublished."""
    row = await get_row(session, catalog_id)
    if row.published:
        raise _err(409, "Item is published")
    if row.status != "ready":
        raise _err(409, "Item is not ready")
    segs = await catalog_store.segments_of(session, row.id)
    if idx >= len(segs):
        raise _err(404, "Sentence not found")
    seg = segs[idx]
    if "text" in changes:
        text = " ".join((changes["text"] or "").split())
        if not text or len(text) > limits.SEGMENT_TEXT_MAX or not any(c.isalpha() for c in text):
            raise _err(400, "Invalid sentence text")
        if not store.same_text(text, seg.text):
            seg.analysis = seg.analysis_lang = None
            if "zh" not in changes:
                seg.zh = seg.zh_lang = None
        seg.text = text
    if "zh" in changes:
        zh = " ".join((changes["zh"] or "").split())[:limits.TRANSLATION_MAX]
        seg.zh, seg.zh_lang = (zh, row.ai_lang) if zh else (None, None)
    start, end = changes.get("start_ms", seg.start_ms), changes.get("end_ms", seg.end_ms)
    low = segs[idx - 1].end_ms if idx > 0 else 0
    high = segs[idx + 1].start_ms if idx + 1 < len(segs) else (row.duration_ms or end)
    if not (low <= start < end <= high):
        raise _err(400, "Invalid sentence times")
    if (start, end) != (seg.start_ms, seg.end_ms):
        seg.flags = None
    seg.start_ms, seg.end_ms = start, end
    row.updated_at = utcnow()
    await audit.record(session, actor, "catalog.segment.edit", target_type="catalog_item", target_id=row.id,
                       after={"idx": idx, "fields": len(changes)})
    await session.commit()
    return {"segment": catalog_store.segment_admin_out(seg)}


async def delete(session, app, actor, catalog_id: str, *, reason: str, confirm: str) -> dict:
    """Spec R1: no copies -> rows + files go now; copies -> retired (unpublished, files kept, collected later)."""
    row = await get_row(session, catalog_id)
    if (confirm or "").strip() != delete_phrase(row.id):
        raise _err(409, "Confirmation required", {"confirm": delete_phrase(row.id)})
    await _stop(session, app, row)  # R-SI11
    refs = await catalog_store.refs(session, row.id)
    if refs == 0:
        await catalog_store.delete_rows(session, row.id)
        await audit.record(session, actor, "catalog.delete", target_type="catalog_item", target_id=catalog_id,
                           after={"refs": 0}, reason=reason)
        await session.commit()
        paths.remove_catalog_files(data_dir(app), catalog_id)
        return {"id": catalog_id, "outcome": "deleted", "refs": 0}
    row.published, row.retired_at, row.updated_at = False, row.retired_at or utcnow(), utcnow()
    await audit.record(session, actor, "catalog.retire", target_type="catalog_item", target_id=row.id,
                       after={"refs": refs}, reason=reason)
    await session.commit()
    return {"id": row.id, "outcome": "retired", "refs": refs}


async def purge(session, app, actor, catalog_id: str, *, reason: str, confirm: str) -> dict:
    row = await get_row(session, catalog_id)
    if (confirm or "").strip() != purge_phrase(row.id):
        raise _err(409, "Confirmation required", {"confirm": purge_phrase(row.id)})
    await _stop(session, app, row)
    copies, users = await catalog_store.purge(session, app, row.id)
    await audit.record(session, actor, "catalog.purge", target_type="catalog_item", target_id=catalog_id,
                       after={"copies": copies, "users": users}, reason=reason)
    await session.commit()
    return {"id": catalog_id, "copies_deleted": copies, "users": users}
```

  路由(追加到 `admin_catalog.py`):

```python
class SegmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(default=None, max_length=2000)
    zh: str | None = Field(default=None, max_length=2400)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)


class ReasonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=200)
    confirm: str = Field("", max_length=40)


@router.post("/{catalog_id}/retry")
async def catalog_retry(catalog_id: CatalogUuid, _body: Empty, request: Request,
                        ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.retry(session, request.app, ctx.actor, catalog_id))


@router.post("/{catalog_id}/cancel")
async def catalog_cancel(catalog_id: CatalogUuid, _body: Empty, request: Request,
                         ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.cancel(session, request.app, ctx.actor, catalog_id))


@router.post("/{catalog_id}/translate")
async def catalog_translate(catalog_id: CatalogUuid, _body: Empty, request: Request,
                            ctx: AdminContext = Depends(require("operator")),
                            session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.translate(session, request.app, ctx.actor, catalog_id))


@router.patch("/{catalog_id}/segments/{idx}")
async def catalog_segment(catalog_id: CatalogUuid, body: SegmentPatch, request: Request,
                          idx: int = Path(ge=0, le=1_000_000), ctx: AdminContext = Depends(require("operator")),
                          session: AsyncSession = Depends(get_session)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return _error(catalog_admin.CatalogAdminError(400, "No changes"))
    return await _guard(session, lambda: catalog_admin.patch_segment(session, request.app, ctx.actor, catalog_id,
                                                                     idx, changes))


@router.post("/{catalog_id}/delete")
async def catalog_delete(catalog_id: CatalogUuid, body: ReasonIn, request: Request,
                         ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.delete(session, request.app, ctx.actor, catalog_id,
                                                              reason=body.reason.strip(), confirm=body.confirm))


@router.post("/{catalog_id}/purge")
async def catalog_purge(catalog_id: CatalogUuid, body: ReasonIn, request: Request,
                        ctx: AdminContext = Depends(require_step_up), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.purge(session, request.app, ctx.actor, catalog_id,
                                                             reason=body.reason.strip(), confirm=body.confirm))
```

  - `audit.record` 的签名核对 `app/admin/audit.py::record(session, actor, action, *, target_type=None, target_id=None, summary="", before=None, after=None, reason=None)`(Task 0 读真实签名;`after` 是 dict)。
- [ ] **Step 4:** `uv run pytest -q tests/test_admin_catalog.py tests/test_admin_routes_guarded.py tests/test_library_catalog_media.py tests/test_architecture.py` → 绿。
- [ ] **Step 5: 提交** `feat(server): admin catalog retry, cancel, translate, sentence edits, delete and purge`。

---

## Task 7: 文档(誊写)

**Files:** `server/app/admin/CLAUDE.md`

- [ ] **Step 1:** 「What lives here」追加:`` `catalog_admin.py` `` – 精选库(spec 2026-10-14-curated-library):导入(链接 / 分片上传 + 字幕)、状态与列表、详情(含句子:目录是系统内容,R5)、元数据、发布 / 下架、重试 / 取消 / 补全译文、逐句编辑(未发布时)、删除(无副本即删,有副本则退役)与强制删除(superadmin + step-up,连同所有副本);审计只记 id、动作与数字。
- [ ] **Step 2:** 「Pitfalls」追加:「精选库的删除永远不按副本的 `media_path` 删文件;删目录文件只经 `catalog_store.collect_if_orphan` / `purge` 或「引用数为 0 的删除」。活动中的目录条目先 `_stop` 再删。」
- [ ] **Step 3:** `uv run pytest -q tests/test_architecture.py` → 绿。**提交** `docs: admin catalog notes`。

## 交接

- 给 AU:端点与形状见 INDEX §6;确认串 `DELETE <id[:8]>` / `PURGE <id[:8]>`,409 时 `details.confirm` 给出;上传状态 `{"catalog_id","status","upload_received","upload_total","chunk_bytes"}`;错误文本是固定英文串(见 spec §9)。
- 结果节(写进本计划末尾的 `## Results`,执行者填):Task 2 后用户流水线测试是否全绿;真实 ffmpeg `audio_only` 产物大小 / 速度(**未验证**,需在部署机上跑一次,只在用户要求时);大陆服务器 + 代理的系统取回(**未验证**)。
