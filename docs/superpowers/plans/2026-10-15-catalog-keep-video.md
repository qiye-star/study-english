# 精选库 · 视频素材保留画面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 日期:2026-10-15 · 状态:只有文档,没有产品代码;未提交
- 前置:精选库四条车道(`2026-10-14-curated-library-{server-core,server-import,admin-ui,web}.md`)已合并(见各自 `-results.md`)。先读
  `2026-10-14-curated-library-INDEX.md`(冻结接口与文件归属)、spec `docs/superpowers/specs/2026-10-14-curated-library-design.md`(D4、E4、R1、R6、R9)、
  `server/app/library/CLAUDE.md`、`web/src/features/library/CLAUDE.md`、`admin/src/features/catalog/CLAUDE.md`。
- **本计划覆盖 spec D4 / INDEX §7 里「目录只存音频」的部分**(站长 2026-10-15 裁定:视频源保留画面,接受存储成本;纯音频源不变)。
  本计划的裁定(R-KV*)与 INDEX 冲突时以本计划为准;其余 INDEX 冻结项不变。Task 6 给 INDEX 追加一段指向本计划的 Addendum。
- 写计划时读过的真实代码(只读):`server/app/library/{catalog_import,catalog_store,catalog_jobs,media,pipeline,paths,errors}.py`、
  `server/app/admin/catalog_admin.py`、`server/app/routers/{admin_catalog,library}.py`、`server/app/models.py`(`CatalogItem`、`LibraryItem`)、
  `server/alembic/versions/0022_curated_catalog.py`、`server/tests/{library_helpers,catalog_helpers,test_library_catalog_media,test_library_catalog_import,test_library_catalog_store,test_admin_catalog,test_library_media,test_library_range}.py`、
  `web/src/features/library/{player-page.tsx,player-page.test.tsx,use-media-source.ts,item-card.test.tsx}`、`admin/src/features/catalog/{api.ts,api.test.ts,upload.ts,strings.ts,catalog-page.tsx,catalog-page.test.tsx,catalog-detail.tsx,catalog-detail.test.tsx}`。
  **没有运行任何测试**;下面的测试是执行者先写的失败测试,首次运行以真实结果为准修正测试数据(夹具字节数、时长容差),不得改裁定、接口名与隐私断言。

**Goal:** 管理员上传 / 导入的**视频**素材在精选库里保留画面:用户加入后在播放页用 `<video>`(带封面)播放;纯音频素材照旧。已发布的旧条目(当时被转成纯音频)可由管理员「替换媒体」:重新上传同一素材的视频,句子与译文保留,所有学习者副本自动改用新文件并变成视频。

**Root cause(已读代码确认):** `catalog_import._media_stage` 对任何来源都调 `Ffmpeg.audio_only`(单声道 64 kbps `media.m4a`),`catalog_store.add_to_library` 把副本写成 `kind="audio"`;网页 `player-page.tsx` 按 `detail.kind` 选元素,`audio` → 封面图 + 隐藏的 `<audio>`,所以只有声音和跟读,没有画面。网页本身已经支持 `kind="video"` 的条目(用户自己上传的视频走同一条路)。

**Architecture:** 不写新的 ffmpeg 代码:视频源改走用户流水线已有的 `Ffmpeg.normalize`(H.264/AAC mp4、`+faststart`、高度上限),只给它加一个可选的总码率上限 `max_kbps`(用户流水线不传,行为不变)。`catalog_items` **不加列**:种类由 `media_mime` 推出(`catalog_store.kind_of`)。副本照抄种类与 mime。旧条目走新的管理接口 `POST /{id}/replace-media`(复用现有分片上传与 `complete`),导入任务看到「替换标记」就只换媒体、不动句子,同一个事务里把目录行与所有副本行指向新文件,提交后再删旧文件。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy 2 async、pytest-asyncio、真实 ffmpeg(仅 `needs_ffmpeg` 用例);管理端 React + vitest;网页 React + vitest。

## Global Constraints

- **车道与合并顺序:S →(A ‖ W)→ Z。** S(服务端,Task 0–6)一条车道顺序做(Task 3、4 同改 `catalog_import.py`);A(管理端,A1–A2)可在本计划冻结的接口上与 S 并行开发(测试全部 mock `./api`),**S 合并后才合并**;W(网页,W1)只加测试与一句文档,不依赖 S,可随时开发,建议 S 之后合并(先确认 Task 0 没有发现网页侧的播放问题)。Z 是控制者任务。
- **文件归属(一个文件一个所有者):**

| 车道 | 文件 |
|---|---|
| S | `server/app/library/{media,pipeline,catalog_store,catalog_import,catalog_jobs}.py`、`server/app/admin/catalog_admin.py`、`server/app/routers/admin_catalog.py`、`server/tests/{library_helpers,catalog_helpers}.py`、`server/tests/test_library_media.py`(只追加)、`server/tests/test_library_catalog_store.py`、`server/tests/test_library_catalog_import.py`、`server/tests/test_library_catalog_video.py`(新)、`server/tests/test_admin_catalog_replace.py`(新)、`server/app/library/CLAUDE.md`、`server/app/admin/CLAUDE.md`、`docs/superpowers/plans/2026-10-14-curated-library-INDEX.md`(只追加 Addendum)、`docs/superpowers/plans/2026-10-15-catalog-keep-video-results.md`(新) |
| A | `admin/src/features/catalog/{api.ts,api.test.ts,strings.ts,catalog-page.tsx,catalog-page.test.tsx,catalog-detail.tsx,catalog-detail.test.tsx,replace-media.tsx,replace-media.test.tsx,CLAUDE.md}` |
| W | `web/src/features/library/{player-page.test.tsx,item-card.test.tsx,CLAUDE.md}` |
| Z(控制者) | `docs/changelog/2026-10.json` |

- **不新增迁移**(R-KV3);alembic head 仍是 `0022`;不改 `tests/test_architecture.py`(改动都在 `library` / `admin` / `routers` 内,分层允许:library → core、models、providers、speech、services)。
- **隐私(`server/app/library/CLAUDE.md`):** 日志、错误、审计里没有标题、文件名、URL、许可说明、字幕 / 句子 / 译文、ffmpeg 输出;只有目录 id、种类(`video` / `audio`)、字节数、毫秒数、副本数、`error_kind`。审计 `after` 只放数字。票据 URL 不进日志与快照。
- **测试口径:** 每个任务只跑它列出的文件 + `tests/test_architecture.py`(服务端)或对应目录(网页 / 管理端);**不跑全量、不跑 E2E、不重建容器**;服务端用 `FakeTools` / `FakeAsr` / respx;真实 ffmpeg 只在 `test_library_catalog_video.py` 与 `test_library_media.py` 的 `needs_ffmpeg` 用例里(本机已装 ffmpeg 9.0,`ffmpeg -version` 复核),**不识别、不翻译、不联网**。
- CRLF 工作树:新文件用 Write(LF),改旧文件用 Edit(保留 CRLF);conventional 提交,一个任务一个提交,结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`(派发指令另有规定时从之);只 `git add` 本任务的文件。worktree 里联接 `node_modules`(根 `CLAUDE.md`)。

## 本计划的裁定

- **R-KV1 视频源保留画面,纯音频源不变。** 探测结果 `has_video` 为真 → `normalize`(本计划的档位)→ `media.mp4`、`video/mp4`;否则 → 现有 `audio_only`(单声道 AAC 64 kbps `media.m4a`)。封面规则不变(R-SI2:视频源从源文件截一帧 360 px 高)。识别 / 分句不变:`_sentences` 照旧对成品媒体跑 `speech_wav`(`-vn`,16 kHz 单声道 WAV),对 mp4 同样适用。
- **R-KV2 目录视频档位。** 复用 `Ffmpeg.normalize` / `normalize_plan`,只加可选参数 `max_kbps`(用户流水线不传,行为与测试不变):
  - 高度上限 `min(settings.library_transcode_max_height, catalog_import.VIDEO_MAX_HEIGHT = 720)`(管理员把全局上限调到 480 时目录跟着降);
  - 总码率上限 `catalog_import.VIDEO_MAX_KBPS = 1600`:源是 H.264 + AAC 的 mp4、高度不超限**且**源平均码率(文件字节 × 8 / 毫秒)≤ 1600 kbps 才直接复制流;否则重编码 `libx264 -preset veryfast -crf 23 -maxrate 1472k -bufsize 2944k -pix_fmt yuv420p`,音频 AAC 128 kbps 双声道;
  - 一律 `-movflags +faststart`(iOS / Range 先拿到 moov)。
  - **存储估算(UNVERIFIED,未用真实素材测):** 现在每 10 分钟约 4.8 MB(64 kbps);保留视频后典型讲座 / 新闻 720p 约 70–100 MB / 10 分钟,上限 1600 kbps 时最多约 120 MB / 10 分钟。真实数字由站长第一次真实导入后记进结果文档(`media_bytes` / `duration_ms`)。
- **R-KV3 不加列、不加迁移。** 种类由 `media_mime` 推出:`catalog_store.kind_of(row) = "video" if (row.media_mime or "").startswith("video/") else "audio"`。理由:单一事实来源(mime 与种类永远不会不一致);0022 已有 `media_mime`;账号计划已占用 `0023` / `0024`(`2026-10-14-accounts-INDEX.md`),不再撞号。`admin_out` 追加键 `kind`;用户侧 `public_out`(`CatalogCard`)与契约夹具**不变**。
- **R-KV4 副本照抄。** `add_to_library` 写 `kind=kind_of(row)`、`media_mime=row.media_mime`(已有)、`media_path` / `poster_path` 指向共享文件(已有)、`library_bytes=0`(已有)。
- **R-KV5 旧条目:替换媒体(最小路径)。** 原始上传 / 下载不保留、`source_url` 在 ready 时清空(spec R6),所以没有办法「后台自动重处理」;管理员重新提供同一素材的视频文件:
  - 新接口 `POST /api/admin/library/catalog/{catalog_id}/replace-media`,body `{"filename": str<=255, "size": int>=1}` → `{"catalog_id", "chunk_bytes"}`;角色 operator;之后复用现有 `PUT /uploads/{id}/chunks/{n}` 与 `POST /uploads/{id}/complete`(它们只看 `status == "uploading"`)。
  - 前提:`library_available`;未退役(否则 409 `Item is retired`);**未发布**(否则 409 `Item is published`,与「补全译文」同一规则:先下架、替换、再发布;副本在此期间照常可用);`status == "ready"` 且 `seg_count > 0`(否则 409 `Item is not ready`);扩展名与大小同上传(400 `Unsupported file type` / 413 `File is too large`)。
  - 开始时清空并重建暂存目录,写 `upload.<ext>.part` 与替换标记 `catalog_import.REPLACE_MARK = "replace.flag"`,行 `ready → uploading`(带 `status == "ready"` 条件的 UPDATE),`upload_total=size`、`upload_received=0`;审计 `catalog.replace_media`,`after={"bytes": size}`。
  - 任务:`process` 看到 `seg_count > 0` 且有替换标记 → `_replace_stage`(探测 → 时长校验 → 封面 → 转码 → 移入目录 → **一个事务**更新目录行与全部副本行 → 提交后删旧文件),然后照旧只补缺失译文 → `ready`。句子、译文、分析、发布状态都不动。
  - 只支持上传,不支持按链接重新取回(R6 已清链接;要用链接时管理员本机下载后上传)。
- **R-KV6 共享文件安全(spec R1 继续成立)。** 替换**绝不覆盖**副本正在读的文件:新文件名与当前不同(`media.mp4` ↔ `media-2.mp4` 交替,`_fresh_name`);写库失败 / 被取消时只删新文件,**绝不 `remove_tree(final)`**;旧文件只在提交成功后删除(尽力而为,失败只留一个无人引用的文件,随目录回收)。封面 `poster.jpg` 原地 `os.replace`(原子,小文件)。删副本 / 删用户仍只删 `library/<uid>/…`;副本仍 `library_bytes=0`、不计入条目数;目录 `media_bytes` 改成新文件的大小。正在播放的学习者:旧文件被删后下一次 Range 请求 404 → 网页 `useMediaSource` 换票 → 新票据解析到新路径继续(元素种类到下次打开才变成 `<video>`)。
- **R-KV7 时长校验。** 新文件时长与目录行 `duration_ms` 相差超过 `max(2000 ms, 原时长 2%)` → `LibraryError("unsupported_format")`(**不新增 error_kind**:`errors.ALL` 录在网页契约 `error_kinds` 里,新增会牵动网页)。失败 → `catalog_store.fail` 把有句子的条目放回 `ready` 并保留 `error_kind`,旧媒体与副本完全不变;管理端在详情里显示「替换失败:…」。新时长写回目录行与副本。
- **R-KV8 替换期间不能传字幕。** `put_subtitles` 对 `uploading` 且 `seg_count > 0` 的条目 409 `Subtitles cannot be changed now`(句子保留,字幕无用)。
- **R-KV9 失败 / 取消清暂存。** `CatalogJobs._failed`:暂存里有替换标记 → 删整个暂存目录(否则以后「补全译文」会误入替换分支)。取消(`catalog_admin._stop`)已删暂存、对有句子的条目回到 `ready` 且不动成品文件,无需改。
- **R-KV10 网页不改产品代码。** `player-page.tsx` 已按 `detail.kind` 选 `<video poster playsInline>` / `<audio>`,`use-media-source` / `use-media-player` 对两种元素一样(用户视频条目已在用);W 车道只补「精选副本是视频」的测试:`<video>` + 封面、精选徽标、「不占空间」、没有 ⋯ 菜单。
- **R-KV11 Task 0 是闸门。** 先用真实 ffmpeg 复现;若「纯音频副本也放不出来」(票据、Range、mime 或文件本身)→ 这是另一个 bug,**先修**(见 Task 0 Step 4),再做 Task 1。
- **R-KV12 不做:** 批量自动重处理(没有源文件);用户侧卡片的「视频」徽标(`public_out` 不变);链接重新取回;副本句子随目录更新(spec 原规则不变)。

---

## Task 0: 核对与复现(S;强模型)

**Files:** Create `server/tests/test_library_catalog_video.py`、`docs/superpowers/plans/2026-10-15-catalog-keep-video-results.md`

- [ ] **Step 1 核对(只读):** `cd server && uv run alembic heads` → `0022`;`ffmpeg -version`、`ffprobe -version` 能跑(记录版本);`Grep "audio_only" server/app/library/catalog_import.py` 与 `Grep 'kind="audio"' server/app/library/catalog_store.py` 仍各一处;`Grep "detail.kind === \"video\"" web/src/features/library/player-page.tsx` 一处。不一致 → 停下上报。
- [ ] **Step 2 写复现测试**(新文件 `server/tests/test_library_catalog_video.py`):

```python
"""精选库保留视频画面(plan 2026-10-15-catalog-keep-video):真实 ffmpeg 生成几秒的小视频 + 现成 SRT,走管理端上传 →
导入任务 → 发布 → 用户添加 → 媒体票据 + Range。不识别、不翻译、不联网;没有 ffmpeg 的机器整文件跳过。"""
import shutil
import subprocess

import pytest

from app.library.media import Ffmpeg
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.background import drain_background
from tests.library_helpers import SRT, library_settings
from tests.test_admin_api import register
from tests.test_admin_catalog import BASE, upload_catalog

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
pytestmark = pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg / ffprobe not installed")


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


def tiny_video(path, *, vcodec: str = "libx264", seconds: int = 6) -> bytes:
    """320x240 10 fps test picture + 440 Hz tone in mp4. `libx264` = the copy path, `mpeg4` forces a transcode."""
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=10:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest",
                    "-c:v", vcodec, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", str(path)],
                   check=True, timeout=120)
    return path.read_bytes()


async def import_and_add(app, client, data: bytes) -> tuple[str, str, dict, dict]:
    """(catalog id, the user's copy id, user headers, admin headers): upload with the SRT, run the job, publish, add."""
    admin = await login_as(app, client, "operator")
    cid = await upload_catalog(client, admin, data, subs=SRT, title="Tiny")
    await drain_background(app, timeout=120)
    item = (await client.get(f"{BASE}/{cid}", headers=admin)).json()["item"]
    assert item["status"] == "ready", item
    assert (await client.post(f"{BASE}/{cid}/publish", headers=admin, json={})).status_code == 200
    _uid, h = await register(client, "anna")
    r = await client.post(f"/api/library/catalog/{cid}/add", headers=h)
    assert r.status_code == 200, r.text
    return cid, r.json()["item"]["id"], h, admin


async def fetch_media(client, h, item_id: str, tmp_path):
    """(content type, probe of the served bytes); also proves a 206 Range answer on the copy's ticket URL."""
    url = (await client.post(f"/api/library/items/{item_id}/media-ticket", headers=h)).json()["url"]
    full = await client.get(url)
    assert full.status_code == 200
    part = await client.get(url, headers={"Range": "bytes=0-1023"})
    assert part.status_code == 206 and part.content == full.content[:1024]
    assert part.headers["content-range"] == f"bytes 0-1023/{len(full.content)}"
    out = tmp_path / "served.bin"
    out.write_bytes(full.content)
    return full.headers["content-type"], await Ffmpeg().probe(out, home=tmp_path)


async def test_a_catalog_copy_streams_decodable_audio(app, client, tmp_path):
    """Task 0 gate (R-KV11): the copy plays at all. Red here = a separate playback bug, fixed before Task 1."""
    _cid, item, h, _admin = await import_and_add(app, client, tiny_video(tmp_path / "src.mp4"))
    mime, info = await fetch_media(client, h, item, tmp_path)
    assert info.has_audio and 5500 <= info.duration_ms <= 6500
    assert mime in ("audio/mp4", "video/mp4")


@pytest.mark.xfail(strict=True, reason="plan 2026-10-15-catalog-keep-video: Task 3 removes this marker")
async def test_a_catalog_copy_of_a_video_keeps_the_picture(app, client, tmp_path):
    _cid, item, h, _admin = await import_and_add(app, client, tiny_video(tmp_path / "src.mp4", vcodec="mpeg4"))
    assert (await client.get(f"/api/library/items/{item}", headers=h)).json()["item"]["kind"] == "video"
    mime, info = await fetch_media(client, h, item, tmp_path)
    assert mime == "video/mp4" and info.has_video and info.has_audio
    assert (info.vcodec, info.acodec, info.height) == ("h264", "aac", 240)
```

- [ ] **Step 3 运行:** `cd server && uv run pytest -q tests/test_library_catalog_video.py` → 期望:第一条**绿**,第二条 **xfail**(副本是 `audio`、文件没有视频流)。另跑一次 `uv run pytest -q tests/test_library_catalog_media.py tests/test_library_range.py`(现有的副本票据 + Range 用例)确认绿。
- [ ] **Step 4 判定(R-KV11):**
  - 第一条绿 → 服务端没有独立的播放 bug,问题只是「只存音频」的设计;继续。
  - 第一条红 → **另有 bug**。在结果文档写清失败的断言(状态码 / content-type / Range / 探测结果,不写票据与文件名);若根因在 S 车道的文件里,先提交一个 `fix(server): …`(这条测试就是失败测试),再继续 Task 1;根因在别处(例如 `routers/library.py` 的媒体路由或 `tickets.py`)→ 停下上报控制者,由控制者追加一个小任务后再继续。
  - (可选,人工)本机起真实栈:`cd server && uv run alembic upgrade head && uv run uvicorn app.main:create_app --factory --port 8000` + `yarn web:dev`,管理端上传同一个小视频 + SRT、发布,学习端加入后打开播放页,记录「只有声音 / 声音也没有」。只用本地生成的文件与本地账号,不打任何付费上游;没做就在结果文档标 UNVERIFIED。
- [ ] **Step 5 结果文档**(新文件 `docs/superpowers/plans/2026-10-15-catalog-keep-video-results.md`):日期、分支、ffmpeg 版本、Step 3 的真实输出(通过 / xfail 计数)、Step 4 的结论;后续各任务往里追加「已做 / 偏差 / 未验证」。**提交** `test(server): reproduce catalog copies losing the video picture`。

---

## Task 1: `normalize` 的可选码率上限(S;誊写)

**Files:** Modify `server/app/library/media.py`、`server/app/library/pipeline.py`(只改 `MediaTools` 协议)、`server/tests/library_helpers.py`(`FakeTools.normalize`)、`server/tests/test_library_media.py`(追加)

- [ ] **Step 1 失败测试**(追加到 `tests/test_library_media.py` 末尾):

```python
H264_720 = ProbeInfo(10_000, True, True, "h264", "aac", "mov,mp4,m4a,3gp,3g2,mj2", 720)


@pytest.mark.parametrize("src_kbps, copies", [(None, False), (900, True), (1600, True), (1601, False)],
                         ids=["unknown-rate", "small", "at-cap", "over-cap"])
def test_normalize_plan_copies_only_under_the_rate_cap(tmp_path, src_kbps, copies):
    args, out = normalize_plan(H264_720, tmp_path, 720, src_kbps=src_kbps, max_kbps=1600)
    assert ("copy" in args) is copies and out.kind == "video" and args[-1] == str(tmp_path / "media.mp4")
    assert "+faststart" in args
    if not copies:
        assert args[args.index("-maxrate") + 1] == "1472k" and args[args.index("-bufsize") + 1] == "2944k"
        assert "libx264" in args and "-crf" in args


def test_normalize_plan_without_a_cap_is_unchanged(tmp_path):
    args, _ = normalize_plan(H264_720, tmp_path, 720)
    assert "copy" in args and "-maxrate" not in args
    args, _ = normalize_plan(ProbeInfo(1000, True, True, "vp9", "opus", "matroska,webm", 720), tmp_path, 720)
    assert "-maxrate" not in args


async def test_fake_tools_normalize_records_the_caps(tmp_path):
    from tests.library_helpers import FakeTools, fake_media
    src = tmp_path / "in.mp4"
    src.write_bytes(fake_media())
    tools = FakeTools()
    info = await tools.probe(src, home=tmp_path)
    out = await tools.normalize(src, info, tmp_path, max_height=480, home=tmp_path, max_kbps=1600)
    assert out.kind == "video" and tools.normalize_kwargs == {"max_height": 480, "max_kbps": 1600}


@needs_ffmpeg
async def test_real_normalize_with_a_cap_reencodes_a_heavy_h264(tmp_path):
    src = tmp_path / "in.mp4"
    _make(src, "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=3", "-f", "lavfi", "-i", SPEECHY,
          "-shortest", "-c:v", "libx264", "-b:v", "3000k", "-c:a", "aac")
    tool = Ffmpeg()
    info = await tool.probe(src, home=tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    result = await tool.normalize(src, info, out_dir, max_height=720, home=tmp_path, max_kbps=1600)
    again = await tool.probe(result.path, home=tmp_path)
    assert (result.mime, again.vcodec, again.acodec) == ("video/mp4", "h264", "aac")
    assert result.path.stat().st_size * 8 // again.duration_ms <= 1600 + 200  # kbit/s; small encoder overshoot
```

  (若 `-b:v 3000k` 的 3 秒测试图实际码率仍低于 1600 kbps 导致走复制,改用 `-b:v 6000k -minrate 6000k -bufsize 6000k`;只改测试数据。)
- [ ] **Step 2:** `cd server && uv run pytest -q tests/test_library_media.py` → 新用例失败。
- [ ] **Step 3 实现。** `media.py` 的 `normalize_plan` 换成:

```python
def normalize_plan(info: ProbeInfo, out_dir: Path, max_height: int, *, src_kbps: int | None = None,
                   max_kbps: int | None = None) -> tuple[list[str], Normalized]:
    """ffmpeg output arguments (after `-i src`) and the result, by the rules of spec §5.1. `max_kbps` (curated catalog,
    plan 2026-10-15-catalog-keep-video R-KV2): copy only when the source's average rate is known and <= the cap, and
    cap the re-encode with -maxrate / -bufsize. The user pipeline passes neither."""
    if info.has_video:
        out = out_dir / "media.mp4"
        light = max_kbps is None or (src_kbps is not None and src_kbps <= max_kbps)
        if (info.vcodec == "h264" and info.acodec == "aac" and _is_mp4(info.format_name)
                and (info.height or 0) <= max_height and light):
            args = ["-map", "0:v:0", "-map", "0:a:0", "-c", "copy"]
        else:
            args = ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
            if max_kbps is not None:
                video_kbps = max(200, max_kbps - 128)
                args += ["-maxrate", f"{video_kbps}k", "-bufsize", f"{2 * video_kbps}k"]
            args += ["-pix_fmt", "yuv420p", "-vf", f"scale=-2:'trunc(min({max_height},ih)/2)*2'",
                     "-c:a", "aac", "-b:a", "128k", "-ac", "2"]
        return args + ["-movflags", "+faststart", "-f", "mp4", str(out)], Normalized(out, "video/mp4", "video")
    # ---- audio: unchanged ----
```

  (音频分支一字不改。)`Ffmpeg.normalize` 的签名加 `max_kbps: int | None = None`,开头改为:

```python
    async def normalize(self, src: Path, info: ProbeInfo, out_dir: Path, *, max_height: int, home: Path,
                        progress: Callable[[float], Awaitable[None]] | None = None,
                        max_kbps: int | None = None) -> Normalized:
        src_kbps = src.stat().st_size * 8 // max(1, info.duration_ms) if max_kbps is not None else None  # bits/ms
        args, result = normalize_plan(info, out_dir, max_height, src_kbps=src_kbps, max_kbps=max_kbps)
```

  `pipeline.MediaTools.normalize` 协议同样加 `max_kbps: int | None = None`(用户流水线调用处不改)。`tests/library_helpers.py` 的 `FakeTools`:`__init__` 加 `self.normalize_kwargs: dict | None = None`;`normalize` 签名改为 `async def normalize(self, src, info, out_dir, *, max_height, home, progress=None, max_kbps=None):`,`self._check("normalize")` 之后加 `self.normalize_kwargs = {"max_height": max_height, "max_kbps": max_kbps}`,其余不变。
- [ ] **Step 4:** `uv run pytest -q tests/test_library_media.py tests/test_library_worker.py tests/test_architecture.py` → 绿。**提交** `feat(server): optional bitrate cap for the media normalizer`。

---

## Task 2: 种类、副本与「副本跟随」(S;誊写)

**Files:** Modify `server/app/library/catalog_store.py`、`server/tests/catalog_helpers.py`、`server/tests/test_library_catalog_store.py`

- [ ] **Step 1 测试助手**(`tests/catalog_helpers.py`):`make_catalog` 加关键字参数 `kind: str = "audio"`;函数开头加 `name, mime = ("media.mp4", "video/mp4") if kind == "video" else ("media.m4a", "audio/mp4")`;`CatalogItem(...)` 里 `media_mime="audio/mp4"` 改为 `media_mime=mime`;`(folder / "media.m4a")` 改为 `(folder / name)`;`f"{rel}/media.m4a"` 改为 `f"{rel}/{name}"`。`media_file` 改为 `def media_file(app, catalog_id: str, name: str = "media.m4a"):` 并返回 `... / name`。默认值保持旧行为(契约夹具与现有用例不变)。
- [ ] **Step 2 失败测试**(`tests/test_library_catalog_store.py`):`test_create_get_and_outputs` 的 `admin_out` 键集合加 `"kind"`(`public_out` 键集合**不改**)。文件末尾追加:

```python
def test_kind_of_follows_the_media_mime():
    from app.models import CatalogItem
    assert catalog_store.kind_of(CatalogItem(media_mime=None)) == "audio"
    assert catalog_store.kind_of(CatalogItem(media_mime="audio/mpeg")) == "audio"
    assert catalog_store.kind_of(CatalogItem(media_mime="video/mp4")) == "video"


async def test_a_video_catalog_item_is_copied_as_video(app):
    cid = await make_catalog(app, kind="video")
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        assert row.media_path.endswith("/media.mp4")
        assert catalog_store.admin_out(row, refs=0, translated=0, media_missing=False)["kind"] == "video"
        item, created = await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid,
                                                           now=utcnow())
        assert created and (item.kind, item.media_mime, item.media_path, item.library_bytes) == (
            "video", "video/mp4", row.media_path, 0)


async def test_sync_copies_moves_every_copy_to_the_catalog_media(app):
    cid = await make_catalog(app)
    a, b = await _uid(app, "alice"), await _uid(app, "bob")
    async with app.state.sessionmaker() as s:
        for uid in (a, b):
            await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid, now=utcnow())
        row = await catalog_store.get(s, cid)
        row.media_path = row.media_path.replace("media.m4a", "media.mp4")
        row.media_mime, row.duration_ms = "video/mp4", 6100
        assert await catalog_store.sync_copies(s, row, utcnow()) == 2
        await s.commit()
        copies = (await s.scalars(select(LibraryItem).where(LibraryItem.catalog_id == cid)
                                  .execution_options(populate_existing=True))).all()
        assert {(c.kind, c.media_path, c.media_mime, c.poster_path, c.duration_ms, c.library_bytes) for c in copies} == {
            ("video", row.media_path, "video/mp4", row.poster_path, 6100, 0)}
```

- [ ] **Step 3:** `uv run pytest -q tests/test_library_catalog_store.py` → 失败。
- [ ] **Step 4 实现**(`catalog_store.py`):
  - 「output shapes」节之前加:

```python
def kind_of(row: CatalogItem) -> str:
    """video / audio, from the stored mime (plan 2026-10-15-catalog-keep-video R-KV3: no column, one source of truth)."""
    return "video" if (row.media_mime or "").startswith("video/") else "audio"
```

  - `admin_out` 的字典里 `"media_bytes": row.media_bytes,` 之前加 `"kind": kind_of(row),`。
  - `add_to_library` 里 `LibraryItem(id=new_uuid(), user_id=user_id, kind="audio", …` 改为 `kind=kind_of(row)`。
  - 「copy-on-add」节末尾(`fill_translations` 之后)加:

```python
async def sync_copies(session: AsyncSession, row: CatalogItem, now: datetime) -> int:
    """R-KV5: after a media replacement every user's copy follows the catalog's media (kind, file, mime, poster,
    duration). Sentences, titles, progress and `library_bytes` (0) stay. Caller commits; returns the copy count."""
    result = await session.execute(update(LibraryItem).where(LibraryItem.catalog_id == row.id).values(
        kind=kind_of(row), media_path=row.media_path, media_mime=row.media_mime, poster_path=row.poster_path,
        duration_ms=row.duration_ms, updated_at=now))
    return result.rowcount or 0
```

  - 模块文档串追加一句:「种类由 `media_mime` 推出(`kind_of`);媒体替换后 `sync_copies` 让副本跟随。」
- [ ] **Step 5:** `uv run pytest -q tests/test_library_catalog_store.py tests/test_library_catalog_media.py tests/test_library_catalog_api.py tests/test_library_contract.py tests/test_architecture.py` → 绿(契约夹具不应变化;若 `test_library_contract.py` 报 `catalog_*` 键有差异,说明 `make_catalog` 默认值被改了,回去修助手,**不要**重录夹具)。**提交** `feat(server): catalog kind from the media mime; copies take it and can follow the catalog`。

---

## Task 3: 导入时视频源保留画面(S;强模型)

**Files:** Modify `server/app/library/catalog_import.py`、`server/tests/test_library_catalog_import.py`、`server/tests/test_library_catalog_video.py`(去掉 xfail)

- [ ] **Step 1 改测试**(`tests/test_library_catalog_import.py`):
  - `test_upload_with_subtitles_becomes_a_ready_unpublished_audio_item_with_translations` 改名为 `test_a_video_upload_keeps_the_picture_with_translations`,断言改为:

```python
    assert (row.status, row.published, row.sub_source, row.seg_count, row.media_mime) == (
        "ready", False, "uploaded", 2, "video/mp4")
    assert row.media_path == f"{paths.catalog_rel(cid)}/media.mp4" and row.poster_path.endswith("poster.jpg")
    data_dir = app.state.library.deps.data_dir
    assert (paths.catalog_dir(data_dir, cid) / "media.mp4").is_file()
    assert not paths.catalog_tmp_dir(data_dir, cid).exists()
    assert "normalize" in tools.calls and "audio_only" not in tools.calls
    assert tools.normalize_kwargs == {"max_height": 720, "max_kbps": catalog_import.VIDEO_MAX_KBPS}
```

  (译文断言保持不变。)
  - 追加:

```python
async def test_an_audio_source_stays_mono_audio(app):
    tools = use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.media_mime, row.media_path) == ("audio/mp4", f"{paths.catalog_rel(cid)}/media.m4a")
    assert "audio_only" in tools.calls and "normalize" not in tools.calls
    assert catalog_store.kind_of(row) == "audio"


async def test_the_video_height_follows_a_lower_admin_setting(app):
    tools = use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False,
                                                               "library_transcode_max_height": 480})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=True), SRT)
    await run(app, cid)
    assert tools.normalize_kwargs["max_height"] == 480


async def test_media_log_lines_carry_only_the_id_kind_and_numbers(app, caplog):
    caplog.set_level(logging.INFO)
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    cid = await queued(app, title="Secret talk title")
    staged_upload(app, cid, fake_media(6000, video=True), SRT)
    await run(app, cid)
    assert f"catalog={cid}" in caplog.text and "kind=video" in caplog.text
    assert "Secret talk title" not in caplog.text and "Hello there" not in caplog.text
```

  - `tests/test_library_catalog_video.py`:删掉 `test_a_catalog_copy_of_a_video_keeps_the_picture` 上的 `@pytest.mark.xfail(...)` 一行。
- [ ] **Step 2:** `uv run pytest -q tests/test_library_catalog_import.py tests/test_library_catalog_video.py` → 失败(`VIDEO_MAX_KBPS` 不存在、仍走 `audio_only`)。
- [ ] **Step 3 实现**(`catalog_import.py`):
  - import 加 `from app.library.media import Normalized`。`SYSTEM_USER` 之后加:

```python
VIDEO_MAX_HEIGHT = 720  # plan 2026-10-15-catalog-keep-video R-KV2 (and never above library_transcode_max_height)
VIDEO_MAX_KBPS = 1600  # total; copy only below it, re-encode capped at it
REPLACE_MARK = "replace.flag"  # in the catalog _tmp dir: this upload replaces the media of an item with sentences


async def _transcode(deps: PipelineDeps, src: Path, info, out_dir: Path, tmp: Path) -> Normalized:
    """R-KV1: a video source keeps its picture (the user pipeline's normalizer, capped); audio stays mono 64 kbps."""
    if info.has_video:
        height = min(deps.settings().library_transcode_max_height, VIDEO_MAX_HEIGHT)
        return await deps.tools.normalize(src, info, out_dir, max_height=height, home=tmp, max_kbps=VIDEO_MAX_KBPS)
    return await deps.tools.audio_only(src, out_dir, duration_ms=info.duration_ms, home=tmp)
```

  - `_media_stage` 里:`normalized = await deps.tools.audio_only(src, out_dir, duration_ms=info.duration_ms, home=tmp)` 改为 `normalized = await _transcode(deps, src, info, out_dir, tmp)`;`media_dst = final / "media.m4a"` 改为 `media_dst = final / normalized.path.name`;UPDATE 里 `media_path=f"{rel}/media.m4a"` 改为 `media_path=f"{rel}/{media_dst.name}"`;日志行改为:

```python
    logger.info("library catalog media ready catalog=%s kind=%s duration_ms=%d bytes=%d poster=%s", row.id,
                normalized.kind, info.duration_ms, size, "yes" if has_poster else "no")
```

  - 模块文档串第一行的「`audio_only`」改为「转码(视频源 `normalize` ≤ 720p / ≤ 1600 kbps,音频源 `audio_only`)」。
- [ ] **Step 4:** `uv run pytest -q tests/test_library_catalog_import.py tests/test_library_catalog_jobs.py tests/test_admin_catalog.py tests/test_library_catalog_video.py tests/test_architecture.py` → 绿(`test_library_catalog_video.py` 两条都绿,并且第二条真实走了 `libx264` 重编码)。在结果文档记下两条真实用例产物的字节数与时长(只为核对 `+faststart` 与码率,不是存储估算)。**提交** `feat(server): keep the picture of video sources in the curated catalog`。

---

## Task 4: 替换媒体(S;强模型)

**Files:** Modify `server/app/library/catalog_import.py`、`server/app/library/catalog_jobs.py`、`server/app/admin/catalog_admin.py`、`server/app/routers/admin_catalog.py`;Create `server/tests/test_admin_catalog_replace.py`

- [ ] **Step 1 失败测试**(新文件 `tests/test_admin_catalog_replace.py`):

```python
"""替换精选条目的媒体(plan 2026-10-15-catalog-keep-video R-KV5–R-KV9)。假工具,不联网。"""
import logging

import pytest
from sqlalchemy import select

from app.library import catalog_import, paths
from app.models import AdminAudit, CatalogItem
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.background import drain_background
from tests.library_helpers import SRT, enable, fake_media, library_settings, use_fakes
from tests.test_admin_api import register
from tests.test_admin_catalog import BASE, upload_catalog


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


async def replace_media(client, h, cid: str, data: bytes, *, filename: str = "Talk.mp4") -> None:
    r = await client.post(f"{BASE}/{cid}/replace-media", headers=h, json={"filename": filename, "size": len(data)})
    assert r.status_code == 200, r.text
    assert r.json()["catalog_id"] == cid
    size = r.json()["chunk_bytes"]
    for n in range(max(1, (len(data) + size - 1) // size)):
        r = await client.put(f"{BASE}/uploads/{cid}/chunks/{n}", headers=h,
                             files={"chunk": ("blob", data[n * size:(n + 1) * size], "application/octet-stream")})
        assert r.status_code == 200, r.text
    r = await client.post(f"{BASE}/uploads/{cid}/complete", headers=h)
    assert r.status_code == 200, r.text


async def old_audio_item_with_a_copy(app, client, monkeypatch):
    """An item from before this plan (audio source -> media.m4a), published, added by one user, then unpublished."""
    enable(monkeypatch)
    tools = use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000, video=False), subs=SRT)
    await drain_background(app)
    assert (await client.post(f"{BASE}/{cid}/publish", headers=h, json={})).status_code == 200
    _uid, uh = await register(client, "anna")
    copy = (await client.post(f"/api/library/catalog/{cid}/add", headers=uh)).json()["item"]
    assert copy["kind"] == "audio"
    assert (await client.post(f"{BASE}/{cid}/unpublish", headers=h, json={})).status_code == 200
    return tools, h, uh, cid, copy["id"]


async def _row(app, cid) -> CatalogItem:
    async with app.state.sessionmaker() as s:
        return await s.get(CatalogItem, cid)


def _data_dir(app):
    return app.state.library.deps.data_dir


async def test_replacing_with_the_video_keeps_sentences_and_moves_every_copy(app, client, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    tools, h, uh, cid, item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    before = (await client.get(f"{BASE}/{cid}", headers=h)).json()
    old = paths.catalog_dir(_data_dir(app), cid) / "media.m4a"
    assert old.is_file()
    await replace_media(client, h, cid, fake_media(6100, video=True))
    await drain_background(app)
    after = (await client.get(f"{BASE}/{cid}", headers=h)).json()
    assert (after["item"]["status"], after["item"]["kind"], after["item"]["error_kind"]) == ("ready", "video", None)
    assert after["item"]["published"] is False and after["segments"] == before["segments"]
    assert tools.normalize_kwargs["max_kbps"] == catalog_import.VIDEO_MAX_KBPS
    row = await _row(app, cid)
    assert (row.media_path, row.media_mime, row.duration_ms) == (
        f"{paths.catalog_rel(cid)}/media.mp4", "video/mp4", 6100)
    assert row.poster_path == f"{paths.catalog_rel(cid)}/poster.jpg"
    assert not old.exists() and not paths.catalog_tmp_dir(_data_dir(app), cid).exists()
    copy = (await client.get(f"/api/library/items/{item}", headers=uh)).json()["item"]
    assert (copy["kind"], copy["library_bytes"], copy["catalog_id"], copy["duration_ms"]) == ("video", 0, cid, 6100)
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=uh)).json()["url"]
    r = await client.get(url, headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and r.headers["content-type"] == "video/mp4"
    async with app.state.sessionmaker() as s:
        audits = [a for a in (await s.scalars(select(AdminAudit))).all() if a.action == "catalog.replace_media"]
    assert len(audits) == 1 and audits[0].target_id == cid
    assert "Talk.mp4" not in caplog.text and "ticket=" not in caplog.text


async def test_a_second_replace_never_overwrites_the_file_in_use(app, client, monkeypatch):
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    for _ in range(2):
        await replace_media(client, h, cid, fake_media(6000, video=True))
        await drain_background(app)
    row = await _row(app, cid)
    folder = paths.catalog_dir(_data_dir(app), cid)
    assert row.media_path.endswith("/media-2.mp4")
    assert sorted(p.name for p in folder.iterdir()) == ["media-2.mp4", "poster.jpg"]


async def test_a_different_duration_fails_back_to_ready_and_changes_nothing(app, client, monkeypatch):
    _tools, h, uh, cid, item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    await replace_media(client, h, cid, fake_media(20_000, video=True))
    await drain_background(app)
    row = await _row(app, cid)
    assert (row.status, row.error_kind, row.media_mime, row.seg_count) == ("ready", "unsupported_format", "audio/mp4", 2)
    assert row.media_path.endswith("/media.m4a") and paths.absolute(_data_dir(app), row.media_path).is_file()
    assert not paths.catalog_tmp_dir(_data_dir(app), cid).exists()
    assert (await client.get(f"/api/library/items/{item}", headers=uh)).json()["item"]["kind"] == "audio"


async def test_replace_refusals(app, client, monkeypatch):
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    url = f"{BASE}/{cid}/replace-media"
    assert (await client.post(f"{BASE}/{cid}/publish", headers=h, json={})).status_code == 200
    r = await client.post(url, headers=h, json={"filename": "a.mp4", "size": 10})
    assert (r.status_code, r.json()) == (409, {"error": "Item is published"})
    await client.post(f"{BASE}/{cid}/unpublish", headers=h, json={})
    r = await client.post(url, headers=h, json={"filename": "a.exe", "size": 10})
    assert (r.status_code, r.json()) == (400, {"error": "Unsupported file type"})
    assert (await client.post(url, headers=h, json={"filename": "a.mp4", "size": 10})).status_code == 200
    r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert (r.status_code, r.json()) == (409, {"error": "Subtitles cannot be changed now"})
    r = await client.post(url, headers=h, json={"filename": "a.mp4", "size": 10})
    assert (r.status_code, r.json()) == (409, {"error": "Item is not ready"})


async def test_canceling_a_replace_upload_goes_back_to_ready_with_the_old_media(app, client, monkeypatch):
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    assert (await client.post(f"{BASE}/{cid}/replace-media", headers=h,
                              json={"filename": "a.mp4", "size": 10})).status_code == 200
    assert (await _row(app, cid)).status == "uploading"
    r = await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})
    assert r.status_code == 200 and r.json()["item"]["status"] == "ready"
    row = await _row(app, cid)
    assert row.media_path.endswith("/media.m4a") and paths.absolute(_data_dir(app), row.media_path).is_file()
    assert not paths.catalog_tmp_dir(_data_dir(app), cid).exists()


async def test_a_translate_rerun_without_the_mark_does_not_touch_the_media(app, client, monkeypatch):
    tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    calls = len(tools.calls)
    async with app.state.sessionmaker() as s:  # what the admin "translate" action does, AI being off here
        row = await s.get(CatalogItem, cid)
        row.status = "queued"
        await s.commit()
    await app.state.catalog.run_once()
    await drain_background(app)
    assert (await _row(app, cid)).media_path.endswith("/media.m4a")
    assert "normalize" not in tools.calls[calls:] and "probe" not in tools.calls[calls:]
```

- [ ] **Step 2:** `uv run pytest -q tests/test_admin_catalog_replace.py` → 失败(404 / 405)。
- [ ] **Step 3 实现:导入任务**(`catalog_import.py`,`_media_stage` 之后):

```python
def _fresh_name(current_rel: str | None, wanted: str) -> str:
    """R-KV6: never write over the file copies are streaming; alternate media.mp4 <-> media-2.mp4."""
    if (current_rel or "").rsplit("/", 1)[-1] != wanted:
        return wanted
    stem, ext = wanted.rsplit(".", 1)
    return f"{stem}-2.{ext}"


def _same_length(new_ms: int, old_ms: int) -> bool:
    return abs(new_ms - old_ms) <= max(2000, old_ms // 50)  # R-KV7: 2 s or 2 %


async def _replace_stage(deps: PipelineDeps, row: CatalogItem, tmp: Path, progress: Progress) -> None:
    """R-KV5: new media for an item that keeps its sentences; the catalog row and every copy move in one commit,
    then the old file goes. A failure before the commit leaves the old media and the copies untouched."""
    src = pipeline.input_file(tmp)
    if src is None:
        raise LibraryError("corrupt")
    await progress.set("probe", 0)
    info = await deps.tools.probe(src, home=tmp)
    if not info.has_audio:
        raise LibraryError("no_audio")
    if not _same_length(info.duration_ms, row.duration_ms or 0):
        raise LibraryError("unsupported_format")
    if paths.disk_free(tmp) < 2 * paths.file_bytes(src):
        raise LibraryError("disk_full")
    await progress.set("transcode", 5)
    out_dir = tmp / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    poster = out_dir / "poster.jpg"
    has_poster = info.has_video and await deps.tools.poster(src, poster, info.duration_ms, home=tmp)
    normalized = await _transcode(deps, src, info, out_dir, tmp)
    await progress.set("transcode", 80)
    final = paths.catalog_dir(deps.data_dir, row.id)
    rel = paths.catalog_rel(row.id)
    name = _fresh_name(row.media_path, normalized.path.name)
    media_dst = final / name
    paths.replace(normalized.path, media_dst)
    poster_rel = row.poster_path
    if has_poster:
        paths.replace(poster, final / "poster.jpg")
        poster_rel = f"{rel}/poster.jpg"
    size = paths.file_bytes(media_dst) + (paths.file_bytes(final / "poster.jpg") if poster_rel else 0)
    old_rel = row.media_path
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == row.id,
                                                         CatalogItem.status == "processing").values(
            duration_ms=info.duration_ms, media_path=f"{rel}/{name}", poster_path=poster_rel,
            media_mime=normalized.mime, media_bytes=size, updated_at=deps.clock()))
        if done.rowcount != 1:
            await s.rollback()
            media_dst.unlink(missing_ok=True)  # only the new file: copies still read the old one (never the tree)
            raise Aborted()
        fresh = await s.get(CatalogItem, row.id)
        copies = await catalog_store.sync_copies(s, fresh, deps.clock())
        await s.commit()
    (tmp / REPLACE_MARK).unlink(missing_ok=True)
    if old_rel and old_rel != f"{rel}/{name}":
        try:
            paths.absolute(deps.data_dir, old_rel).unlink(missing_ok=True)
        except (ValueError, OSError):
            pass  # an unreferenced leftover; removed with the catalog directory (R-KV6)
    src.unlink(missing_ok=True)
    logger.info("library catalog media replaced catalog=%s kind=%s duration_ms=%d bytes=%d copies=%d", row.id,
                normalized.kind, info.duration_ms, size, copies)
```

  `process` 里 `if row.seg_count == 0:` 整块之后、`_stored, failed = await _translate(...)` 之前加:

```python
    elif (tmp / REPLACE_MARK).is_file():
        await _replace_stage(deps, row, tmp, progress)
```

  (即把原来的 `if row.seg_count == 0: …` 接成 `if … elif …`;有句子且无标记的条目仍只跑翻译。)
- [ ] **Step 4 实现:任务失败清暂存**(`catalog_jobs.py` 的 `_failed`):`if kind in DROP_STAGING:` 改为

```python
        tmp = paths.catalog_tmp_dir(self.deps.data_dir, catalog_id)
        if kind in DROP_STAGING or (tmp / catalog_import.REPLACE_MARK).is_file():  # R-KV9
            paths.remove_tree(tmp)
```

- [ ] **Step 5 实现:管理端**(`catalog_admin.py`):import 加 `from app.library.catalog_import import REPLACE_MARK`。`put_subtitles` 的条件改为

```python
    if not ((row.status == "uploading" and row.seg_count == 0)
            or (row.status == "failed" and row.error_kind == "no_subtitles")):
        raise _err(409, "Subtitles cannot be changed now")  # R-KV8: a media replacement keeps its sentences
```

  `complete_upload` 之后加:

```python
async def start_replace(session, app, actor, catalog_id: str, *, filename: str, size: int) -> dict:
    """R-KV5: re-upload the media of a ready, unpublished item that has sentences (e.g. the video of an item imported
    as audio only). The chunk / complete endpoints of the upload are reused; the job keeps the sentences."""
    s = app.state.settings
    if not s.library_available:
        raise _err(503, "Media tools are not installed")
    row = await get_row(session, catalog_id)
    if row.retired_at is not None:
        raise _err(409, "Item is retired")
    if row.published:
        raise _err(409, "Item is published")
    if row.status != "ready" or row.seg_count <= 0:
        raise _err(409, "Item is not ready")
    ext = store.extension_of(filename)
    if ext not in limits.UPLOAD_EXTENSIONS:
        raise _err(400, "Unsupported file type")
    if size > s.library_max_upload_mb * limits.MB:
        raise _err(413, "File is too large")
    done = await session.execute(update(CatalogItem).where(CatalogItem.id == row.id, CatalogItem.status == "ready")
                                 .values(status="uploading", stage=None, progress=0, error_kind=None,
                                         upload_total=size, upload_received=0, updated_at=utcnow()))
    if done.rowcount != 1:
        await session.rollback()
        raise _err(409, "Item is not ready")
    tmp = paths.catalog_tmp_dir(data_dir(app), row.id)
    paths.remove_tree(tmp)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / f"upload.{ext}.part").write_bytes(b"")
    (tmp / REPLACE_MARK).write_bytes(b"")
    await audit.record(session, actor, "catalog.replace_media", target_type="catalog_item", target_id=row.id,
                       after={"bytes": size})
    await session.commit()
    logger.info("library catalog media replace started catalog=%s bytes=%d", row.id, size)
    return {"catalog_id": row.id, "chunk_bytes": limits.CHUNK_BYTES}
```

  (先改行、后写暂存:与并发的「重试 / 补译」比赛时输的一方不碰文件。若 `get_row` 返回的 ORM 对象因 UPDATE 而过期,`row.id` 仍可读;需要时 `await session.refresh(row)`。)
- [ ] **Step 6 实现:路由**(`routers/admin_catalog.py`):`UploadIn` 之后加

```python
class ReplaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=1)
```

  `catalog_complete` 之后加

```python
@router.post("/{catalog_id}/replace-media")
async def catalog_replace_media(catalog_id: CatalogUuid, body: ReplaceIn, request: Request,
                                ctx: AdminContext = Depends(require("operator")),
                                session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.start_replace(session, request.app, ctx.actor, catalog_id,
                                                                     filename=body.filename, size=body.size))
```

- [ ] **Step 7:** `uv run pytest -q tests/test_admin_catalog_replace.py tests/test_admin_catalog.py tests/test_library_catalog_import.py tests/test_library_catalog_jobs.py tests/test_admin_routes_guarded.py tests/test_library_privacy.py tests/test_architecture.py` → 绿。**提交** `feat(server): replace a catalog item's media and move its copies`。

---

## Task 5: 真实 ffmpeg 的端到端替换(S;誊写)

**Files:** Modify `server/tests/test_library_catalog_video.py`(追加)

- [ ] **Step 1 追加用例**(`tests/test_library_catalog_video.py` 末尾;import 加 `from tests.test_admin_catalog_replace import replace_media`):

```python
async def test_an_old_audio_only_item_gets_its_picture_back(app, client, tmp_path):
    """The owner's case: an item stored as audio, a user's copy, then the admin replaces the media with the video."""
    video = tiny_video(tmp_path / "src.mp4", vcodec="mpeg4")
    audio = tmp_path / "src.m4a"
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(tmp_path / "src.mp4"),
                    "-vn", "-c:a", "copy", str(audio)], check=True, timeout=120)
    cid, item, h, admin = await import_and_add(app, client, audio.read_bytes())
    mime, info = await fetch_media(client, h, item, tmp_path)
    assert mime == "audio/mp4" and not info.has_video  # a plain audio copy plays (Range, mime, decodable)
    assert (await client.post(f"{BASE}/{cid}/unpublish", headers=admin, json={})).status_code == 200
    await replace_media(client, admin, cid, video)
    await drain_background(app, timeout=120)
    copy = (await client.get(f"/api/library/items/{item}", headers=h)).json()["item"]
    assert (copy["kind"], copy["library_bytes"], copy["has_poster"]) == ("video", 0, True)
    mime, info = await fetch_media(client, h, item, tmp_path)
    assert mime == "video/mp4" and info.has_video and info.has_audio and info.vcodec == "h264"
```


- [ ] **Step 2:** `uv run pytest -q tests/test_library_catalog_video.py` → 3 条绿;把通过数写进结果文档。**提交** `test(server): real ffmpeg check for catalog videos and media replacement`。

---

## Task 6: 服务端文档(S;誊写)

**Files:** Modify `server/app/library/CLAUDE.md`、`server/app/admin/CLAUDE.md`、`docs/superpowers/plans/2026-10-14-curated-library-INDEX.md`(末尾追加)、`docs/superpowers/plans/2026-10-15-catalog-keep-video-results.md`

- [ ] `server/app/library/CLAUDE.md`:`catalog_import.py` 一行里「封面 → `audio_only`」改为「封面 → 转码(视频源 `normalize` ≤ 720p / ≤ 1600 kbps 保留画面,音频源 `audio_only`)」,并加「有句子且暂存里有 `replace.flag` → 只替换媒体(`_replace_stage`)」;`catalog_store.py` 一行加「`kind_of`(由 `media_mime` 推出,无列)、`sync_copies`」。Pitfalls 的精选库条目追加一句:「替换媒体绝不覆盖副本正在读的文件(`media.mp4` ↔ `media-2.mp4`),写库成功后才删旧文件;中途失败只删新文件,绝不删目录(plan 2026-10-15-catalog-keep-video R-KV6)。」
- [ ] `server/app/admin/CLAUDE.md`:`catalog_admin.py` 一行的动作列表加「替换媒体(`POST /{id}/replace-media`,未发布 + 就绪 + 有句子;复用分片上传;审计 `catalog.replace_media`)」。
- [ ] INDEX 末尾追加:

```markdown
## Addendum (2026-10-15):视频素材保留画面

站长裁定:视频源不再只存音频。见 `2026-10-15-catalog-keep-video.md`(R-KV1–R-KV12),它覆盖本文 §7 `catalog_import` / `Ffmpeg.audio_only` 「只存音频」的部分:
视频源走 `normalize`(≤ 720p、≤ 1600 kbps)存 `media.mp4`;`CatalogAdminRow` 追加 `kind`;新管理接口 `POST /{catalog_id}/replace-media`;审计动作追加 `catalog.replace_media`。无迁移。
```

- [ ] 结果文档补全「已做(各任务提交主题)/ 裁定与偏差 / 未验证」。**提交** `docs: catalog keeps the video picture`。

---

## Task A1: 管理端接口与文案(A;誊写)

**Files:** Modify `admin/src/features/catalog/{api.ts,api.test.ts,strings.ts}`

- [ ] **Step 1 失败测试**(`api.test.ts`:import 加 `startReplace`;`describe` 里追加):

```ts
  it("starts a media replacement on the same item", async () => {
    const calls = stub({ catalog_id: ID, chunk_bytes: 8388608 });
    const out = await startReplace(ID, "talk.mp4", 1234);
    expect(calls[0].url).toBe(`/api/admin/library/catalog/${ID}/replace-media`);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ filename: "talk.mp4", size: 1234 });
    expect(out).toEqual({ catalogId: ID, chunkBytes: 8388608 });
  });
```

- [ ] **Step 2:** `cd admin && yarn vitest run src/features/catalog/api.test.ts` → 失败。
- [ ] **Step 3 实现。** `api.ts`:`CatalogStatus` 之后加 `export type CatalogKind = "video" | "audio";`;`CatalogRow` 里 `mediaBytes: number;` 之前加 `kind: CatalogKind;`;`completeUpload` 之后加

```ts
/** plan 2026-10-15-catalog-keep-video R-KV5:同一条目重新上传媒体;分片与 complete 复用上传的接口。 */
export const startReplace = async (id: string, filename: string, size: number) =>
  camel<{ catalogId: string; chunkBytes: number }>(await request(`${BASE}/${enc(id)}/replace-media`, { json: { filename, size } }));
```

  (若 `request` 带 `json` 时默认方法不是 POST,显式传 `method: "POST"`,以 `startUpload` 的写法为准。)`strings.ts`:`cols` 加 `media: "媒体"`;顶层加 `kind: { video: "视频", audio: "音频" } as Record<string, string>,`;`detail` 加
  `replace: "替换媒体文件"`、`replaceHint: "上传同一素材的视频(时长需一致):句子与译文保留,已加入的学习者副本自动改用新文件。只能在下架状态替换。"`、`replacing: (p: string) => \`上传中 ${p}\``、`replaceFailed: (why: string) => \`上次替换媒体失败:${why}\``;`errorKinds` 加 `unsupported_format: "格式不支持,或与原素材时长不一致"`。
  同步修 TS 类型:`catalog-page.test.tsx` 的 `ROW`(显式类型 `api.CatalogRow`)加 `kind: "audio",`(`catalog-detail.test.tsx` 的 `ITEM` 用了 `as`,A2 再改)。
- [ ] **Step 4:** `cd admin && yarn vitest run src/features/catalog && yarn typecheck` → 绿。**提交** `feat(admin): catalog kind and media replacement API`。

---

## Task A2: 列表的媒体列、详情的视频试听与「替换媒体」(A;中等)

**Files:** Create `admin/src/features/catalog/{replace-media.tsx,replace-media.test.tsx}`;Modify `catalog-page.tsx`、`catalog-page.test.tsx`、`catalog-detail.tsx`、`catalog-detail.test.tsx`、`CLAUDE.md`

- [ ] **Step 1 失败测试。** 新文件 `replace-media.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { ReplaceMedia } from "./replace-media";
import { S } from "./strings";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), startReplace: vi.fn(), putChunk: vi.fn(), completeUpload: vi.fn() }));
afterEach(cleanup);

const ID = "3f2a9c1e-0000-4000-8000-000000000001";

describe("ReplaceMedia", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads the picked file in chunks to the same item, then completes", async () => {
    vi.mocked(api.startReplace).mockResolvedValue({ catalogId: ID, chunkBytes: 4 });
    vi.mocked(api.putChunk).mockResolvedValue({ catalogId: ID, status: "uploading", uploadReceived: 4, uploadTotal: 6, chunkBytes: 4 });
    vi.mocked(api.completeUpload).mockResolvedValue({ id: ID } as api.CatalogRow);
    const onDone = vi.fn();
    const onError = vi.fn();
    render(<ReplaceMedia id={ID} disabled={false} onDone={onDone} onError={onError} />);
    await userEvent.upload(screen.getByLabelText(S.detail.replace), new File([new Uint8Array(6)], "talk.mp4", { type: "video/mp4" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.startReplace).toHaveBeenCalledWith(ID, "talk.mp4", 6);
    expect(vi.mocked(api.putChunk).mock.calls.map((c) => c[1])).toEqual([0, 1]);
    expect(api.completeUpload).toHaveBeenCalledWith(ID);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a refusal and does not upload", async () => {
    vi.mocked(api.startReplace).mockRejectedValue(new Error("Item is published"));
    const onError = vi.fn();
    render(<ReplaceMedia id={ID} disabled={false} onDone={vi.fn()} onError={onError} />);
    await userEvent.upload(screen.getByLabelText(S.detail.replace), new File([new Uint8Array(2)], "talk.mp4"));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(api.putChunk).not.toHaveBeenCalled();
  });
});
```

  `catalog-detail.test.tsx`:`ITEM` 加 `kind: "audio",`;vi.mock 列表加 `startReplace: vi.fn()`;追加:

```tsx
  it("plays a video item in a <video> element", async () => {
    vi.mocked(api.fetchCatalogItem).mockResolvedValue({ item: { ...ITEM, kind: "video", hasPoster: true }, segments: SEGS });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("Hello there.");
    expect(document.querySelector("video")?.getAttribute("src")).toBe(api.mediaUrl(ID));
    expect(document.querySelector("audio")).toBeNull();
  });

  it("offers media replacement only for a ready, unpublished, live item", async () => {
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByLabelText(S.detail.replace)).toBeInTheDocument();
    cleanup();
    vi.mocked(api.fetchCatalogItem).mockResolvedValue({ item: { ...ITEM, published: true }, segments: SEGS });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("Hello there.");
    expect(screen.queryByLabelText(S.detail.replace)).toBeNull();
  });

  it("shows why the last replacement failed on a ready item", async () => {
    vi.mocked(api.fetchCatalogItem).mockResolvedValue({ item: { ...ITEM, errorKind: "unsupported_format" }, segments: SEGS });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText(S.detail.replaceFailed(S.errorKinds.unsupported_format))).toBeInTheDocument();
  });
```

  `catalog-page.test.tsx` 追加(import 加 `formatBytes` 自 `../../lib/format`):

```tsx
  it("shows the media kind and size", async () => {
    signIn("viewer");
    vi.mocked(api.fetchCatalog).mockResolvedValue({ items: [{ ...ROW, kind: "video" }], state: STATE });
    render(<MemoryRouter><CatalogPage /></MemoryRouter>);
    expect(await screen.findByText(`${S.kind.video} · ${formatBytes(500000)}`)).toBeInTheDocument();
  });
```

  (`STATE` 用该文件里现有的状态夹具名;没有就照现有用例的写法内联。)
- [ ] **Step 2:** `cd admin && yarn vitest run src/features/catalog` → 新用例失败。
- [ ] **Step 3 实现。** 新文件 `replace-media.tsx`:

```tsx
/** 替换媒体(plan 2026-10-15-catalog-keep-video R-KV5):同一条目重新上传(分片),服务端转码后句子与译文保留,
 *  学习者副本自动改用新文件。真实 <input type=file> 留在 DOM 里(sr-only),由 <label htmlFor> 打开。 */
import { useId, useRef, useState } from "react";
import { completeUpload, startReplace } from "./api";
import { S } from "./strings";
import { uploadChunks } from "./upload";

export function ReplaceMedia({ id, disabled, onDone, onError }: {
  id: string; disabled: boolean; onDone: () => void; onError: (e: unknown) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setPercent(0);
    try {
      const { chunkBytes } = await startReplace(id, file.name, file.size);
      await uploadChunks(id, file, chunkBytes, (p) => setPercent(Math.floor((p.sent * 100) / Math.max(1, p.total))));
      await completeUpload(id);
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setPercent(null);
    }
  };
  const busy = disabled || percent !== null;
  return (
    <span className="inline-flex items-center gap-2" title={S.detail.replaceHint}>
      <label htmlFor={inputId} className={`btn-ghost btn-sm ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
        {percent === null ? S.detail.replace : S.detail.replacing(`${percent}%`)}
      </label>
      <input id={inputId} ref={input} type="file" accept="video/*,audio/*" className="sr-only" disabled={busy}
        aria-label={S.detail.replace} onChange={(e) => void pick(e.target.files?.[0])} />
    </span>
  );
}
```

  `catalog-detail.tsx`:
  - 试听:`<audio controls preload="none" src={mediaUrl(id)} … />` 换成

```tsx
                {!item.mediaMissing && (item.kind === "video" ? (
                  <video controls preload="none" src={mediaUrl(id)} poster={item.hasPoster ? posterUrl(id) : undefined}
                    className="max-h-64 w-full rounded-lg bg-black" aria-label={S.detail.listen} />
                ) : (
                  <audio controls preload="none" src={mediaUrl(id)} className="w-full" aria-label={S.detail.listen} />
                ))}
```

  - 失败行之后加:`{item.status === "ready" && item.errorKind && item.errorKind !== "upstream" && <p className="text-warn">{S.detail.replaceFailed(S.errorKinds[item.errorKind] ?? item.errorKind)}</p>}`
  - `RoleGate min="operator"` 的按钮组里(「补全译文」之后)加:

```tsx
                {item.status === "ready" && !item.published && !item.retired && item.segCount > 0 && !item.mediaMissing && (
                  <ReplaceMedia id={id} disabled={busy} onDone={refresh} onError={(e) => setError(errorText(apiErrorText(e)))} />
                )}
```

    (`refresh`、`errorText`、`apiErrorText` 是该文件已有的;import 加 `import { ReplaceMedia } from "./replace-media";`。媒体缺失的条目不给替换:`media_missing` 时服务端也能替换,但界面让管理员走「重新导入」,与现有提示一致。)
  `catalog-page.tsx`:列定义里 `duration` 之后加 `{ key: "media", header: S.cols.media, render: (r) => (r.mediaBytes > 0 ? \`${S.kind[r.kind] ?? r.kind} · ${formatBytes(r.mediaBytes)}\` : "—") },`(import `formatBytes` 自 `../../lib/format`,与 `formatDuration` 同处)。
  `CLAUDE.md`:What lives here 加 `replace-media.tsx`(同一条目重新上传媒体,保留句子;plan 2026-10-15-catalog-keep-video);Pitfalls「试听直接用 `<audio src>`」改为「试听直接用 `<audio src>` / 视频用 `<video src>`(同源 Cookie)」。
- [ ] **Step 4:** `cd admin && yarn vitest run src/features/catalog && yarn typecheck` → 绿。**提交** `feat(admin): catalog media column, video preview and media replacement`。

---

## Task W1: 网页:精选视频副本的测试与说明(W;誊写)

**Files:** Modify `web/src/features/library/{player-page.test.tsx,item-card.test.tsx,CLAUDE.md}`

- [ ] **Step 1 测试**(本计划不改网页产品代码,R-KV10;这些用例应**直接绿**,红了说明网页另有问题 → 停下上报,不在本任务里改产品代码)。`player-page.test.tsx` 的「shows the cover of an audio item…」之后追加:

```tsx
  it("a featured copy of a video plays in a <video> with its cover (plan 2026-10-15-catalog-keep-video)", async () => {
    URL.createObjectURL = vi.fn(() => "blob:poster-v");
    URL.revokeObjectURL = vi.fn();
    render(detailRaw({ kind: "video", source: "catalog", catalog_id: "c1", has_poster: true, library_bytes: 0 }), {
      "GET /api/library/items/i1/poster": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } }),
    });
    const video = await screen.findByTestId("library-media");
    expect(video.tagName).toBe("VIDEO");
    await waitFor(() => expect(video).toHaveAttribute("src", TICKET));
    await waitFor(() => expect(video).toHaveAttribute("poster", "blob:poster-v"));
    expect(document.querySelector(".lib-stage-audio")).toBeNull();
  });
```

  `item-card.test.tsx` 的 `describe("ItemCard · featured copy …")` 里追加:

```tsx
  it("a copy of a video keeps the badge, 不占空间 and has no ⋯ menu", () => {
    card({ item: { ...copy, kind: "video" }, ...handlers(), onRebuild: vi.fn() });
    expect(screen.getByText("精选")).toBeInTheDocument();
    expect(screen.getByText("2:05 · 3 句 · 不占空间")).toBeInTheDocument();
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
  });
```

- [ ] **Step 2:** `cd web && yarn vitest run src/features/library/player-page.test.tsx src/features/library/item-card.test.tsx` → 绿。
- [ ] **Step 3:** `web/src/features/library/CLAUDE.md` 的 Featured library 一段末尾加一句:「A copy plays like any item by its `kind`: video sources keep the picture since plan `2026-10-15-catalog-keep-video` (a replaced catalog item turns existing copies into `video`; the open player recovers through a ticket refresh).」**提交** `test(web): featured video copies play in a video element`。

---

## Task Z: 更新日志草稿(控制者,不是实现者的任务)

- [ ] S、A、W 全部合并、站长在真实环境确认(新视频导入能看画面、旧条目替换后副本能看画面)之后,**控制者**在 `docs/changelog/2026-10.json` 追加一条**草稿**(`version: null`;中英都写;每项一句、≤ 200 字符、≤ 4 项;面向用户的平实措辞,不提迁移 / 接口 / 转码参数),例如:
  `{"entry_date": "<合并验证当天>", "version": null, "title_zh": "精选视频能看画面了", "title_en": "Featured videos now show the picture", "items": [{"tag": "fix", "zh": "精选里的视频素材现在播放时能看到画面,不再只有声音。", "en": "Featured videos now play with the picture, not just the sound."}, {"tag": "library", "zh": "之前加入的精选视频在管理员更新后会自动变成可看的视频,无需重新添加。", "en": "Featured videos you added earlier turn into watchable videos once they are updated, with no need to add them again."}]}`。
  只写实际上线的内容(第二项只在站长确实替换了旧条目后写)。
- [ ] 跑 `cd server && uv run pytest -q tests/test_changelog_import.py`;提醒站长部署后运行 `docker compose exec server python -m app.admin.changelog_import` 并在管理后台发布(重建容器只在站长要求时做)。

---

## UNVERIFIED(各车道的结果节逐条写「已做 / 未做」)

- 存储估算(R-KV2)没有用真实素材测;真实讲座 / 新闻视频在 crf 23 + 1472k 上限下的大小与画质;`veryfast` 在服务器 CPU 上的转码耗时(超时规则与用户流水线相同:`timeout_for` = max(120 s, 3 × 时长),超时记 `unsupported_format`;长视频在弱 CPU 上是否够用未测)。
- iOS Safari / 安卓 Chrome 上播放共享的 mp4 副本(Range、单句循环精度、`playsInline`);播放中被替换时「换票后继续」的真实表现。
- Postgres 上「目录行 + 副本行同一事务」与并发 `add_to_library` 的竞争(只在 SQLite 单连接验证)。
- 管理端浏览器上传数百 MB 视频的耗时;数据卷剩余空间(替换时新旧文件短暂并存)。
- Task 0 Step 4 的人工真实栈检查(若没做)。
- 未跑全量测试、E2E、容器重建。

## 交接

- S 合并后 A 才合并(A 的接口以本计划 Task A1 为准);W 随时可合并(只加测试)。
- 站长操作说明(写进结果文档):新导入的视频自动保留画面;旧的已发布条目 → 详情里「下架」→「替换媒体文件」选同一素材的视频(时长一致)→ 处理完成后「发布」;已加入的学习者无需任何操作。
