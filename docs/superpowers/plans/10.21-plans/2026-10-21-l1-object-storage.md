# L1 · 对象存储(Local / S3)、全量迁移与精选库 bundle · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 日期:2026-10-21 · 状态:**只有计划,没有产品代码;未提交**。**本计划写作时没有运行任何测试**,也没有连过真实 MinIO / 云厂商;下文凡写「已核对」只指「读过源码、行号当日成立」。
- 车道:**L1**(INDEX §1;spec §4 的 L2「bundle」与 L6「录音 / 房间 / 头像 / 备份入 S3」并入本车道末段)。
- Spec:`docs/superpowers/specs/2026-10-21-object-storage-fsrs-dubbing-design.md` §1(设计)、§5(已定决议)、§6(不丢数据保证)。
- **权威裁决**:`docs/superpowers/plans/10.21-plans/2026-10-21-INDEX.md`。本计划与 INDEX 冲突时以 INDEX 为准;INDEX §4 冻结的 `app.storage` 名字在这里只细化签名,不改名。
- 先读:`docs/CLAUDE.md`、根 `CLAUDE.md`、`server/app/library/CLAUDE.md`、`server/app/core/CLAUDE.md`、`server/README.md`「跟读库」「管理后台 v2」两节、`server/tests/CLAUDE.md`、`admin/src/features/catalog/CLAUDE.md`、风格参照 `docs/superpowers/plans/2026-10-14-curated-library-server-core.md`。

**Goal:** 新增底层包 `server/app/storage/`(`BlobStore` 协议、`LocalStore` 默认、`S3Store` 经 boto3 + `asyncio.to_thread`、读回退 `FallbackStore`、服务端代理 Range 流);把**所有**持久文件(库与精选库的媒体 / 封面 / `transcript.json`、评测录音、房间语音、头像、备份)分批改走它;一次性迁移命令 `python -m app.storage.migrate` 严格实现 spec §6;精选库 bundle 导出 / 导入;compose `minio` profile、`.env.example`、README、doctor 与管理端存储页。默认 `STORAGE_BACKEND=local`,行为与今天逐字节一致。

**Architecture:** 键 = 现有相对路径(`library/<uid>/<id>/media.mp4` 等,DB 值不变,无迁移号)。`LocalStore` 的根就是 `Settings.resolved_data_dir`,所以默认配置下磁盘布局、测试里按 `data_dir / rel` 读文件的断言全部继续成立——这是「不搞 big-bang」的支点。ffmpeg / yt-dlp / 分片上传的暂存目录永远留在本地;流水线最后一步的 `paths.replace(tmp → final)` 换成 `put_file`,再写库。播放仍是同源、票据每次重验,由 `storage.http.blob_response` 统一出 200 / 206 / 416;本地后端原样返回 Starlette `FileResponse`。

**Tech Stack:** Python 3.12(uv)、FastAPI、SQLAlchemy 2 async、boto3(新依赖)、pytest + pytest-asyncio(auto)、moto(新 dev 依赖,内存 S3);管理端 React + vitest。

## Global Constraints

- **合并顺序(INDEX §2):L1 ‖ L3 ‖ L5 → L4**;本车道不需要迁移号(INDEX §3「L1 不需要迁移」)。
- **文件所有权(INDEX §6)**:只改本计划列出的文件;共享文件(`main.py`、`tests/test_architecture.py`、`core/config.py`、`core/settings_registry.py`)只在锚点处追加。R17 列出 INDEX §6 没写明、但只有本车道会碰的调用点。
- **测试口径(INDEX §2)**:每个任务只跑它列出的测试文件 + `tests/test_architecture.py`:`cd server && uv run pytest -q <files> tests/test_architecture.py`。管理端任务只跑 `cd admin && yarn vitest run <dir>`。**不跑全量、不跑 E2E、不重建容器**;永远不连真实 S3(契约测试用 moto 内存实现)。
- **隐私(INDEX §5)**:日志 / 错误 / 审计 / 计量 / URL 里永远没有对象键、文件名、用户 id、S3 端点带凭据的形式、`S3_ACCESS_KEY` / `S3_SECRET_KEY`、预签名 URL、票据;存储层日志只有 `op=`、`code=`、`bytes=`、`ms=`、`count=`。新 `caplog` 一律 `caplog.set_level(logging.DEBUG, logger="app")`。
- **工作树是 CRLF**:改现有文件用 Edit,新文件用 Write。
- **提交**:约定式(`feat(server): …`、`refactor(server): …`、`test(server): …`、`feat(admin): …`、`docs: …`),一个任务一个提交,该任务列出的测试全绿;只 `git add` 本任务列出的文件;信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- **不重建镜像、不跑 `scripts/deploy.sh`**,除非用户要求。

## 文件结构

```
server/
  pyproject.toml / uv.lock                         + boto3;dev 组 + moto[s3](Task 1)
  app/storage/__init__.py                          公开名:BlobStore、BlobInfo、错误类、get_store、install(Task 1–4)
  app/storage/keys.py                              键 / 前缀校验、根白名单 ROOTS(Task 1)
  app/storage/base.py                              协议、BlobInfo、RangeStream、错误类(Task 1)
  app/storage/local.py                             LocalStore(Task 2)
  app/storage/s3.py                                S3Store(唯一允许 import boto3/botocore 的模块之一)(Task 3)
  app/storage/config.py                            build_store(settings, profile)、install(app)(Task 4)
  app/storage/http.py                              blob_response(Range 代理)(Task 5)
  app/storage/fallback.py                          FallbackStore(双读 + 计数)(Task 6)
  app/storage/migrate.py                           迁移 CLI(`python -m app.storage.migrate`)(Task 19–20)
  app/storage/manifest.py                          清单读写(JSONL,追加式日志)(Task 19)
  app/storage/reconcile.py                         DB ↔ 存储对账(只读)(Task 20)
  app/storage/CLAUDE.md                            新(Task 25)
  app/core/config.py、settings_registry.py         + 14 个 env-only 字段(Task 4)
  app/main.py                                      install 锚点一行(Task 4)
  app/library/paths.py                             键函数 + async 删除助手(Task 8)
  app/library/{store,worker,catalog_jobs,catalog_store}.py   删除 / 存在性改走存储(Task 8、10)
  app/library/pipeline.py、catalog_import.py、asr_chunks.py  落盘接缝(Task 9、11)
  app/library/catalog_bundle.py                    新:bundle 导出 / 导入(Task 21)
  app/routers/{library,library_catalog,admin_catalog,assessments,admin,avatars,admin_ops,rooms_voice,admin_rooms,speech,conversations}.py
  app/services/{recordings,assessment_store,chat_recordings,avatars}.py
  app/realtime/realtime_providers.py               只改 save / cleanup 的两处调用(Task 12)
  app/rooms/{audio,voice}.py
  app/admin/{storage,housekeeping,backups,users_admin,avatars_admin,catalog_admin,doctor}.py
  .env.example                                     + 存储一节(Task 4、24)
  README.md                                        + 「对象存储」一节(Task 25)
  tests/storage_contract.py                        新:两种后端共用的契约用例(Task 2)
  tests/storage_helpers.py                         新:put / read / exists / s3 夹具(Task 3、7)
  tests/test_storage_*.py                          新(见各任务)
  tests/conftest.py                                + `store` 夹具与 `storage_backend` 参数(Task 4)
  tests/catalog_helpers.py、library_helpers.py     改走存储(Task 7)
  tests/test_architecture.py                       + storage 层规则、boto3 隔离、两条收缩白名单(Task 1、各批)
docker-compose.example.yml                          + minio / minio-init(profile minio)(Task 24)
admin/src/features/catalog/**                       bundle 按钮与导入对话框(Task 23)
admin/src/features/ops/**、features/settings/doctor-card.tsx   后端 / 回退计数显示(Task 26)
```

## 本计划的裁定

- **R1 层位置与依赖方向。** `app/storage` 是新层,只依赖标准库、第三方包、`app.core`、`app.models`(`models` 只给 `reconcile.py` 用)。允许导入它的层:`services`、`realtime`、`rooms`、`library`、`admin`、`routers`、`main`;`core`、`models`、`providers`、`speech`、`rank`、`wordbook`、`agents`、`links` **不得**导入。理由:录音与头像在 `services`、房间语音在 `rooms`,存储必须在它们之下;放在 `core` 会把 boto3 拖进所有层。
  **boto3 隔离**:`boto3` / `botocore` / `s3transfer` 只允许出现在 `app/storage/s3.py`、`app/storage/config.py`(构造)中;`moto` 只允许出现在 `tests/` 里。其他模块只依赖 `BlobStore` 协议(鸭子类型),从 `get_store(app)` 或依赖对象的访问器拿实例。`tests/test_architecture.py` 用 AST 扫描执行。
- **R2 键与前缀(两种后端同一规则,`keys.py`)。**
  - 键 = 现有相对路径,`/` 分隔;长度 1–512;字符集 `[A-Za-z0-9._-]` 与 `/`;不得以 `/` 开头或结尾;没有空段、`.`、`..`、反斜杠。
  - **根白名单** `ROOTS = ("library", "recordings", "room_audio", "avatars", "backups", "bundles")`:第一段不在其中 → `ValueError`。这样 `LocalStore` 的根即使是 `data_dir`(里面有 `app.db`),任何键都拼不出数据库文件。
  - **暂存永不入库**:`library/_tmp/…`、`library/_catalog/_tmp/…` 被 `check_key` 拒绝(第二段是 `_tmp`,或 `_catalog` 之后是 `_tmp`)。`room_audio/_staging/…` **是**持久对象(DB `room_voice.staging_path` 引用,转写重试要读)。
  - `delete_prefix` / `list` 的前缀必须以 `/` 结尾(`library/1/` 不会误删 `library/10/`);`list("")` 不允许,迁移按 ROOTS 逐个前缀列。
  - 违规一律 `ValueError`(现有代码已经在 `except ValueError` 里把「路径逃逸」映射成 404,语义不变)。
- **R3 接口(冻结名字见 INDEX §4,签名在此定死)。**

  ```python
  # app/storage/base.py
  @dataclass(frozen=True)
  class BlobInfo:
      key: str
      size: int
      mtime: float              # epoch 秒(UTC);S3 = LastModified,本地 = st_mtime
      etag: str                 # 不透明;用于 HTTP ETag / If-Range(本地后端不用它,FileResponse 自己算)
      sha256: str | None = None # S3:对象元数据 x-amz-meta-sha256;本地:None(要算就流式算)
      content_type: str | None = None

  class StorageError(OSError):            # 现有 `except OSError` 继续兜住存储故障
      code: str                           # unavailable | denied | integrity | too_large | bad_config
  class BlobNotFound(StorageError, FileNotFoundError): ...   # code="not_found";现有 `except FileNotFoundError` 不用改

  class RangeStream(Protocol):
      info: BlobInfo
      start: int                          # 含
      end: int                            # 含
      def __aiter__(self) -> AsyncIterator[bytes]: ...
      async def aclose(self) -> None: ...

  @runtime_checkable
  class BlobStore(Protocol):
      name: str                                                      # "local" | "s3" | "fallback"(只用于诊断,从不含端点)
      async def put_file(self, key: str, path: Path, *, content_type: str | None = None) -> BlobInfo: ...
      async def put_bytes(self, key: str, data: bytes, *, content_type: str | None = None) -> BlobInfo: ...
      async def get_bytes(self, key: str, *, max_bytes: int | None = None) -> bytes: ...      # 超限 StorageError("too_large")
      async def download_to(self, key: str, path: Path) -> BlobInfo: ...                     # 先写 path.part 再 os.replace
      async def open_range(self, key: str, start: int = 0, end: int | None = None) -> RangeStream: ...
      async def stat(self, key: str) -> BlobInfo | None: ...                                  # 不存在 = None,不抛
      async def delete(self, key: str) -> bool: ...                                           # 不存在 = False,不抛 BlobNotFound
      async def delete_prefix(self, prefix: str) -> int: ...                                  # 返回删除的对象数
      def list(self, prefix: str) -> AsyncIterator[BlobInfo]: ...                             # 异步生成器,按键升序
      async def probe(self) -> str: ...                                                       # ok | unreachable | denied | no_bucket | not_writable

  def get_store(app) -> BlobStore: ...   # 返回 app.state.storage;**不得缓存**(测试会替换它)
  ```

  - `put_file` **不消耗源文件**:调用方在写库成功后自己删暂存(spec「put_file 再删本地」)。
  - `name` 与 `probe()` 是 INDEX §4 九个方法之外的附加成员,只给 doctor / 管理端用;其他车道不要依赖。
  - 依赖对象(`PipelineDeps`、`VoiceDeps`、`XfyunAssessor`)存的是访问器 `storage: Callable[[], BlobStore]`(`lambda: app.state.storage`),不是实例:`create_app` 里各 `install` 的先后顺序与测试替换都不受影响。
- **R4 LocalStore = 今天的行为。** 根 = `Settings.resolved_data_dir`(env-only,启动时固定,与 `worker.install` 现在的做法一致,`app/library/worker.py:246`)。所有阻塞调用走 `asyncio.to_thread`。
  - `put_file`:先 `os.link(src, final.<随机>.part)`(同卷硬链接,O(1),不复制 1 GB 视频),失败(跨卷 / 文件系统不支持)回落 `shutil.copyfile`;再 `os.replace` 到最终位置。等价于今天 `paths.replace` 的原子性,且不消耗源。注意:硬链接意味着暂存文件与成品共享 inode——暂存文件在 put 之后**只允许删除,不允许改写**(现有代码就是如此:只 `unlink` / `rmtree`)。
  - `put_bytes`:写 `final.<随机>.part` 再 `os.replace`(与 `services/recordings.py:24-36`、`services/avatars.py:110-126` 相同)。
  - `list`:`os.walk`,跳过 `*.part` 与 R2 拒绝的暂存目录;`mtime` 用 `st_mtime`。`delete_prefix`:先数文件再 `shutil.rmtree`,best effort。
  - 额外一个**非协议**方法 `path_of(key) -> Path`(带 `is_relative_to(root)` 复核),**只**给 `storage/http.py` 返回 `FileResponse` 用;架构测试禁止 `app/storage` 之外调用它。
- **R5 S3Store。** 一个 boto3 client(线程安全),所有调用包 `asyncio.to_thread`;`botocore.config.Config(s3={"addressing_style": "path" if path_style else "virtual"}, retries={"mode": "standard", "max_attempts": 3}, connect_timeout=5, read_timeout=60, request_checksum_calculation="when_required", response_checksum_validation="when_required")`。最后两项是为了兼容不完全实现新默认校验和的 S3 兼容端点(**未验证**:各厂商实际表现,见风险 K3)。
  - 每次 put 都先流式算 sha256,写入 `Metadata={"sha256": …}`(即 `x-amz-meta-sha256`)与 `ContentType`;大文件用 `upload_file` + `TransferConfig(multipart_threshold=64 MiB, max_concurrency=4)`。多段上传的 ETag 不是 MD5,所以完整性只看 sha256 元数据 + 大小。
  - `open_range`:`get_object(Range="bytes=a-b")`,`StreamingBody` 每次 `read(256 KiB)` 走线程;`aclose()` 关闭 body(客户端断开时 Starlette 取消迭代 → 关闭)。
  - `delete_prefix`:`list_objects_v2` 分页 + `delete_objects` 每批 ≤ 1000;端点返回 `NotImplemented` 时逐个 `delete_object`(**未验证**:哪些厂商需要这条退路)。
  - `probe()`:`head_bucket`;`404 → no_bucket`、`403 → denied`、连接错误 / 超时 → `unreachable`。
  - **不用**预签名、不用厂商私有头、不用版本控制 / 生命周期 API(spec §5.4)。
  - `__repr__` 只给 `S3Store(bucket=<已配置|未配置>)`;端点、区域、键对都不进 repr。错误映射只读 `e.response["Error"]["Code"]` 与类名,**从不** `str(e)`(botocore 的异常消息含桶名与对象键)。
  - `install` 时把 `botocore`、`boto3`、`s3transfer`、`urllib3` 的 logger 钉在 `WARNING`(根 logger 现在本来就是 WARNING,`app/core/logging_setup.py:3`;这里防的是以后有人调成 DEBUG 时 botocore 打出带键的请求行)。
- **R6 原子性(`os.replace` 在 S3 上没有对应物)。** 单个对象的 PUT 本身是原子的(读者看到旧的或新的,不会看到半个);跨对象 + DB 的一致性靠顺序:
  1. **先 put,再写库**;写库发现条目已不在 `processing`(`rowcount != 1`)→ 删除**本次刚写的键**(不是整个前缀,以免误删副本正在读的旧媒体),抛 `Aborted`。
  2. **删除总在提交之后**,且从不抛:失败只记 `op=delete code=…`;残留由下面两条回收。
  3. 进程在「put 之后、提交之前」崩溃留下的对象:该条目会被恢复重跑(同键覆盖)或被 7 天清扫 `remove_item_files` → `delete_prefix` 删掉;其余情况由 `migrate --reconcile-only` 报告(只报告,R12)。
  4. **绝不覆盖可能正在被播放的键**:精选库换媒体保留 `media.mp4 ↔ media-2.mp4` 交替(`app/library/catalog_import.py:134-139`,R-KV6)。S3 上这条更重要:播放是很多次独立的 Range GET,中途覆盖会让同一次播放拼出两个文件。
  5. 额度仍按 DB 字节数记账(`library_bytes`、`assessments.audio_bytes`、`room_voice.audio_bytes`),与后端无关。
- **R7 暂存留本地。** 分片上传 `.part`、`in.*`、`subs.raw`、`platform.srt`、`speech.wav`、`silences.json`、`chunks.json`、`out/` 全在 `library/_tmp/<id>/` 或 `library/_catalog/_tmp/<id>/`,与今天相同;`disk_free` 检查继续看本地卷。单 worker 前提不变(票据、分片锁、运行中任务都在进程内)。
  识别需要本地媒体:本次运行刚转码出的文件就在 `tmp/out/`,`put_file` 不消耗它,直接用;断点续跑(媒体已在存储、`_tmp` 已清)时才 `download_to(key, tmp / "media.<ext>")`,用完随 `_tmp` 一起删。只有字幕(上传 / 平台)的条目不下载。
- **R8 播放 = 服务端代理流式(spec §5.1)。** `storage.http.blob_response(store, key, request, *, media_type, headers, filename=None) -> Response`:
  - `LocalStore` → 原样 `FileResponse(store.path_of(key), …)`;`tests/test_library_range.py` 钉住的 Starlette 行为一字不变。
  - 其他后端 → 自己的 `BlobRangeResponse`:先 `stat`(拿 size / etag / mtime)再按请求头决定;单段 `bytes=a-b` / `a-` / `-n` → 206 + `Content-Range`;越界 → 416 `bytes */size`;倒序或非 `bytes` 单位 → 400;`If-Range` 不匹配 ETag → 200 全量;**多段 → 200 全量**(RFC 允许忽略 Range;iOS / Chrome 播放只发单段——**未在真机验证**,见设备清单);`HEAD` 只回头。始终 `Accept-Ranges: bytes`、`Content-Length`、`ETag`、`Last-Modified`。
  - **票据语义不变**:路由先 `tickets.resolve` + 查用户与条目(`app/routers/library.py:565-586`),全部通过后才 `stat` / `open_range`;每个 Range 请求都重验。
  - 存储不可达(`StorageError(code="unavailable")`)→ 由 `storage.install` 注册的异常处理器回 503 `{"error": "Storage unavailable"}`;对象缺失(`BlobNotFound` / `stat → None`)仍走各路由现有的 404 文案。
  - 预签名 302(`S3_PRESIGN_REDIRECT`)**不做**(spec §5.1:后续再议)。
- **R9 设置(env-only、`apply="restart"`,group `ops`)。** `storage_backend: Literal["local", "s3"] = "local"`、`storage_fallback: Literal["", "local", "s3_fallback"] = ""`、`s3_endpoint: str = ""`(空 = boto3 默认 AWS 端点)、`s3_bucket: str = ""`、`s3_access_key: str = ""`(kind `secret`)、`s3_secret_key: str = ""`(kind `secret`)、`s3_region: str = "us-east-1"`、`s3_path_style: bool = False`;以及同形的 `s3_fallback_endpoint / s3_fallback_bucket / s3_fallback_access_key(secret) / s3_fallback_secret_key(secret) / s3_fallback_region / s3_fallback_path_style`。共 14 个字段。
  - 秘密只来自环境(`env_only`),不进管理端可编辑设置、不进审计、不进日志;登记为 `secret` 后自动进入 `main._log_secrets` 的脱敏集合(`app/main.py:168-170`)。
  - 校验(值无关的错误信息):`storage_backend="s3"` 时 `s3_bucket`、两把钥匙必填;`storage_fallback` 不能与主后端是同一个(`local`/`local` 或 `s3`/`s3_fallback` 指向同一端点 + 同一桶)。校验放在 `storage.config.build_store`,启动时抛 `RuntimeError("storage: S3_BUCKET is required")` 这类只含键名的消息。
  - 「档案」(profile)概念:`build_store(settings, profile)`,`profile ∈ {"local", "s3", "s3_fallback"}`。主后端 = `storage_backend`;回退 = `storage_fallback`;迁移 CLI 的 `--from / --to` 也用这三个名字(R12)。这样 **MinIO → 云厂商只改配置**:旧 MinIO 写进 `S3_FALLBACK_*`,新厂商写进 `S3_*`。
- **R10 厂商切换的注意事项(写进 README,spec §5.4)。** MinIO / 自建 → `S3_PATH_STYLE=true`;AWS、阿里云 OSS、腾讯 COS 多数用 virtual-hosted(`false`),R2 两者都支持;`S3_REGION` 对 R2 写 `auto`,MinIO 任意(常用 `us-east-1`);签名版本用 boto3 默认 SigV4。阿里云 OSS 的 S3 兼容层对 path-style 与部分 API 有限制,**未验证**——切换前在目标端跑一遍设备 / 运维清单 §B 的冒烟。「切换」= 先迁移对象(R12)再改 env,不是只改 env。
- **R11 读回退(双读,spec §6)。** `FallbackStore(primary, secondary)`:`stat / get_bytes / download_to / open_range` 先读主后端,`BlobNotFound`(或 `stat → None`)才读次后端,并 `hits += 1`、记 `storage fallback hit op=<op>`(无键)。**写只写主后端;删只删主后端**——源数据在观察期内保持原样(spec「只复制、不移动」)。`list` 只列主后端(清扫 / 对账针对新后端)。计数在进程内,管理端存储页与 doctor 显示;确认计数长期为 0 后由用户清空 `STORAGE_FALLBACK` 并重启。
  隐私后果(写进 README):观察期内被删除的用户 / 条目,其旧副本仍在源后端,直到用户手动退役源后端;对账报告会把它们算进「源有、库里没有」。
- **R12 迁移 CLI 精确实现 spec §6。** 见 Task 19–20;要点:只复制不移动;每个对象 `stat` 比大小 + sha256(上传时写进 `x-amz-meta-sha256`;本地目标重算);清单(键、大小、sha256、状态)落本地 JSONL、追加式、可续跑;`--dry-run`(只建清单与统计,不写目标、不备份)、`--verify-only`(只核对不写);迁移前强制 DB 备份;对账报告「库里有、存储没有」与「存储有、库里没有」,**从不删除**;回滚 = 改回 `STORAGE_BACKEND`;日志只有数量、字节、毫秒、错误码。源与目标可以是三种档案中任意两种(`local→s3`、`s3_fallback→s3`、`s3→local` 反向补齐回滚期间的新写入)。
  分层:迁移需要 DB 备份,但 `app/storage` 不能导入 `app/admin`。裁定:`migrate.py` 自己用 `VACUUM INTO` 写一份与 `admin/backups.py` **同名规则**(`app-YYYYmmdd-HHMMSS.db`)的快照到 `resolved_backup_dir`;一条契约测试断言 `admin.backups.list_backups` 能列出它、两边的正则相等。PostgreSQL:应用内不备份(与 `admin/backups.py:23` 一致),必须带 `--pg-backup-done` 才继续(由运维先跑 `pg_dump`)。
- **R13 备份进存储。** `VACUUM INTO` 仍写本地 `resolved_backup_dir`;主后端是 S3 时,写完上传到 `backups/<name>`,并按 `BACKUP_KEEP` 分别修剪本地与 `backups/`。主后端是本地时不上传(默认 `BACKUP_DIR` 就在 `data_dir/backups`,键与文件是同一个;自定义 `BACKUP_DIR` 时也不复制,与今天一致)。列表 = 本地 ∪ 远端,每项带 `where: "local" | "remote" | "both"`;下载优先本地文件,否则经 `blob_response` 从存储流式给出。备份含用户数据:对象只放在同一个桶里、不公开;README 写明桶策略必须私有。
- **R14 精选库 bundle(L2)。** 导出:管理员对一条 `ready`、未退役的目录条目写 `bundles/<cid>/manifest.json`(`schema_version: 1`、条目元数据、句子(时间、原文、译文、分析、标记)、媒体与封面的键 / 字节 / sha256);**不含**任何用户数据(无副本数、无用户 id、无发布状态、无审计)。导入:读 manifest → 严格校验(版本、id 形状、媒体键**必须**在 `library/_catalog/<cid>/` 之下、`stat` 存在且大小相等、sha256 相等(目标没有元数据时流式重算)、元数据走现有 `clean_*`)→ 一个事务建 `catalog_items`(`status="ready"`、`published=False`、`asr_seconds=0`、`source_url=None`)与 `catalog_segments`,**不跑流水线、不花识别与翻译费用**;同 id 已存在 → 409。目录句子表没有词级时间(`app/models.py` `CatalogSegment` 只有句级 `start_ms/end_ms`),所以 manifest 也没有词级时间(spec §1.4 的「词级时间」在目录侧不存在,这里如实不导出)。L5 若给目录加 `speaker`,v1 读取时忽略未知键、导出时作为可选键追加,不升版本(见风险 K8)。
- **R15 管理端清理工具语义不变。** `housekeeping` / `storage` / `users_admin` 的 `os.walk` / `rmtree` 换成 `list` / `delete` / `delete_prefix`;宽限期用 `BlobInfo.mtime`(S3 = LastModified);扫描令牌算法不变(`_token` 对排序后的键做 sha256,`app/admin/housekeeping.py:61-62`)。房间语音的逐行 `stat` 改成一次 `list("room_audio/")` 建字典,避免 N 次 HEAD。样例(`samples`)仍返回相对键给超级管理员(现有行为),但**不进日志**。
- **R16 测试策略(不搞 big-bang)。**
  - `create_app` 照常建 `app.state.storage`(默认 `LocalStore(resolved_data_dir)`),所以现有 ~500 个触及数据目录的用例(grep:`tests/` 下 49 个文件引用 `data_dir` / `resolved_data_dir` 且与词书无关,含 `def test_` 约 510 个——**这是 grep 计数,不是运行结果**)在默认后端下零改动仍应通过。
  - `tests/conftest.py` 新增 `storage_backend` 参数夹具(默认 `"local"`)与 `store` 夹具;`"s3"` 时在 moto `mock_aws()` 里建桶并把 `app.state.storage` 换成 `S3Store`。只有精选的一组用例(各批列出)参数化跑两种后端,其余保持本地。
  - 契约:`tests/storage_contract.py` 一套用例,`test_storage_local.py` 与 `test_storage_s3.py` 各跑一遍;Range 行为另有 `test_storage_range.py`。
  - 助手先行:`catalog_helpers.make_catalog` 改经 `store.put_bytes`,`media_file()` 换成 `async media_bytes()`;新 `tests/storage_helpers.py`(`put`、`read`、`exists`、`keys_under`)。之后每批只改「本批模块对应的测试文件里直接读写磁盘的断言」。
  - 两条**收缩白名单**写进 `tests/test_architecture.py`(Task 1 建立,每批删掉自己的条目,Task 18 收口):`FILE_RESPONSE_ALLOWED`(谁可以 import `FileResponse`)、`DATA_DIR_ALLOWED`(谁可以引用 `resolved_data_dir` / `deps.data_dir`)。迁移进度由白名单长度表达,回退会让测试变红。
- **R17 INDEX §6 未逐条列出的调用点(只有本车道会碰)。** `app/library/{store,worker,catalog_jobs,catalog_store,asr_chunks}.py` 的删除 / 存在性行、`app/admin/{users_admin,avatars_admin,catalog_admin,doctor}.py` 的文件行、`app/rooms/voice.py` 的 `VoiceDeps.data_dir` 与四处调用、`app/routers/{rooms_voice,admin_rooms,speech,conversations}.py` 与 `app/realtime/realtime_providers.py` 的调用点、管理端 `admin/src/features/{catalog,ops,settings}`。与其他车道的已知冲突面见风险 K6–K7;合并时手工解决并写进本车道 results 文档。
- **R18 不做的事。** 预签名重定向、对象版本 / 生命周期、跨区域复制、`S3_KEY_PREFIX`(一桶多部署)、加密 SSE 配置、多 worker。都可以以后单独立项。

---

## Task 0: 前置核对(只读,不提交)

- [ ] `cd server && uv run alembic heads`:INDEX §3 写的头是 `0027_captcha_replay`(本计划写作时 `alembic/versions/` 最新文件确为 `0027_captcha_replay.py`,**未运行** `alembic heads`)。L1 **不建迁移**;若此时 L3 / L5 已合并,头会是 `0028` / `0029`,与本车道无关,只记录在 results 里。
- [ ] 确认 INDEX §4 的 `app.storage` 名单与本计划 R3 一致;若 INDEX 已被改过,以 INDEX 为准并在本计划加 Addendum。
- [ ] 重新核对本计划引用的行号(L3 / L5 可能先合并改动了 `pipeline.py`、`catalog_store.py`):`app/library/pipeline.py:133-198, 301-363`、`app/library/catalog_import.py:67-131, 146-198, 274-315`、`app/library/catalog_store.py:270-279, 289-327, 350-387`、`app/routers/library.py:293-299, 342-343, 370-372, 411, 565-598`、`app/routers/library_catalog.py:46, 54-65`、`app/routers/admin_catalog.py:231-255`、`app/routers/assessments.py:76-104`、`app/routers/admin.py:98-110`、`app/routers/avatars.py:77-93`、`app/routers/admin_ops.py:180-218, 241-243`、`app/routers/rooms_voice.py:90, 189`、`app/routers/admin_rooms.py:244-264`、`app/rooms/audio.py:99-110`、`app/rooms/voice.py:146-155, 190, 211, 336`、`app/services/recordings.py:16-43`、`app/services/assessment_store.py:24-42`、`app/services/chat_recordings.py:31-37`、`app/services/avatars.py:106-133, 146-191`、`app/admin/housekeeping.py:35-89, 116-196`、`app/admin/storage.py:17-51`、`app/admin/backups.py:36-92`、`app/admin/users_admin.py:216-218, 285-291`、`app/realtime/realtime_providers.py:322-330, 347-361`。
- [ ] `uv add --dry-run boto3` 与 `uv add --dev --dry-run "moto[s3]"`(或等价的 `uv lock --dry-run`)看能否解析、记录将锁定的版本(**本计划不写版本号**,以锁文件为准)。
- [ ] 确认管理端测试命令:`cd admin && yarn vitest run src/features/catalog`(`admin/src/features/catalog/CLAUDE.md`)。

---

## 批次 A · 底座(无行为变化)

### Task 1: 依赖、`keys.py`、`base.py`、架构规则

**Files:** `server/pyproject.toml`、`server/uv.lock`、新 `server/app/storage/__init__.py`、`keys.py`、`base.py`;`server/tests/test_architecture.py`;新 `server/tests/test_storage_keys.py`

- [ ] 先写失败测试 `tests/test_storage_keys.py`:合法键(`library/1/<uuid>/media.mp4`、`library/_catalog/<uuid>/poster.jpg`、`recordings/3/<uuid>.wav`、`room_audio/_staging/<uuid>.wav`、`avatars/<32hex>.webp`、`backups/app-20261021-010203.db`、`bundles/<uuid>/manifest.json`);非法键(空、`/x`、`x/`、`a//b`、`..`、`.`、反斜杠、非 ASCII、513 字符、`app.db`、`library/_tmp/<uuid>/in.mp4`、`library/_catalog/_tmp/<uuid>/x`、首段不在 ROOTS);`check_prefix` 必须以 `/` 结尾、拒绝 `""`;`BlobNotFound` 同时是 `FileNotFoundError` 与 `OSError`。
- [ ] `tests/test_architecture.py`(锚点处追加):`LAYERS` 加 `"storage"`;`ALLOWED["storage"] = {"storage", "core", "models"}`;把 `"storage"` 加进 `services`、`realtime`、`rooms`、`library`、`admin`、`routers`、`main` 的允许集;新测试 `test_storage_layer_rules`(用 `tmp_path` 造违例:`core` / `providers` / `speech` / `wordbook` / `agents` / `links` / `rank` 导入 storage 被抓);`test_boto3_only_inside_storage`(AST 扫描 `app/` 下 `boto3` / `botocore` / `s3transfer` 只出现在 `app/storage/s3.py`、`app/storage/config.py`;`moto` 不出现在 `app/`);建立两条收缩白名单 `FILE_RESPONSE_ALLOWED`(当前全部:`routers/{library,library_catalog,admin_catalog,assessments,admin,avatars,admin_ops,web}.py`)与 `DATA_DIR_ALLOWED`(当前全部引用 `resolved_data_dir` / `deps.data_dir` / `catalog_admin.data_dir` 的模块,实现时 grep 生成)+ 测试「实际集合 ⊆ 白名单」。顶部 docstring 补一行 `storage -> core (bottom I/O layer; boto3 lives only here)`。
- [ ] 实现 `keys.py`(`ROOTS`、`check_key`、`check_prefix`、`join(*parts)`)与 `base.py`(R3 全部类型);`__init__.py` 只再导出公开名。
- [ ] `pyproject.toml`:`dependencies` 加 `boto3`(下限按 Task 0 解析结果);`dev` 组加 `moto[s3]`;`uv lock`。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_keys.py tests/test_architecture.py`
- [ ] 提交:`feat(server): add the storage layer skeleton, key rules and layering checks`

### Task 2: `LocalStore` 与可复用契约测试

**Files:** 新 `server/app/storage/local.py`;新 `server/tests/storage_contract.py`、`server/tests/test_storage_local.py`

- [ ] 先写 `tests/storage_contract.py`(普通函数集合,参数是一个 `BlobStore` 工厂):put_bytes → stat(size、mtime、content_type)→ get_bytes;`max_bytes` 超限抛 `StorageError(code="too_large")`;put_file 不消耗源文件;覆盖写入后读到新内容;download_to 写到目标路径且无 `.part` 残留;open_range 的 `(0,1)`、`(100,None)`、末尾越界截断;stat 不存在 → None;delete 不存在 → False;delete_prefix 只删前缀内(`library/1/` 不碰 `library/10/`)、返回个数;list 升序且不含其他前缀;get_bytes / download_to / open_range 对缺失键抛 `BlobNotFound`;非法键抛 `ValueError`。
- [ ] `tests/test_storage_local.py` 跑契约 + 本地专属:put_file 在同卷时是硬链接(`os.stat(a).st_ino == os.stat(b).st_ino`;Windows NTFS 也支持——**未在 CI 外验证**,不支持时测试 `skip` 而不是失败);`os.link` 失败时回落复制;put 中途 `os.replace` 失败不留 `.part`(把 `tests/test_avatars_storage.py:32` 那条用例的意图搬到这里);`list` 跳过 `.part` 与暂存目录;键 `../x` 即使绕过 `check_key` 也被 `path_of` 的 `is_relative_to` 拒绝;`probe()` 对只读目录返回 `not_writable`(POSIX 才测)。
- [ ] 实现 `LocalStore(root: Path)`(R4)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_local.py tests/test_storage_keys.py tests/test_architecture.py`
- [ ] 提交:`feat(server): add LocalStore with a shared storage contract suite`

### Task 3: `S3Store`(boto3 + to_thread)与 moto 契约

**Files:** 新 `server/app/storage/s3.py`;新 `server/tests/storage_helpers.py`(此任务只放 moto 夹具 `moto_bucket()`)、`server/tests/test_storage_s3.py`

- [ ] 先写 `tests/test_storage_s3.py`:在 `moto.mock_aws()` 里建桶,跑整套 `storage_contract`;S3 专属:每次 put 都写 `Metadata["sha256"]` 且 `stat().sha256` 等于内容的 sha256;`content_type` 被保存;大于阈值的 put_file 走多段上传后 sha256 仍正确(测试里把阈值 monkeypatch 到 5 MiB,moto 的最小分段);`delete_prefix` 跨分页(>1000 个键,用 1001 个小对象);`DeleteObjects` 返回 `NotImplemented` 时逐个删除(monkeypatch client);错误映射(`NoSuchKey → BlobNotFound`、`AccessDenied → StorageError("denied")`、`EndpointConnectionError → StorageError("unavailable")`);`repr(store)` 与所有异常的 `str()` 里没有桶名、端点、键、两把钥匙(用 `SECRET-…` 占位值断言);`probe()` 的 `ok / no_bucket`;`botocore` logger 级别 ≥ WARNING。
- [ ] 风险钉子:moto 的 `mock_aws` 拦截的是 botocore 的发送层,`asyncio.to_thread` 的工作线程也受影响——**未验证**;若不成立,`storage_helpers` 改用 `moto.server.ThreadedMotoServer`(本机随机端口)并在 results 里记录。
- [ ] 实现 `S3Store(client, bucket)` 与构造函数 `S3Store.from_settings(...)`(只在 `config.py` 调用)(R5)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_s3.py tests/test_storage_local.py tests/test_architecture.py`
- [ ] 提交:`feat(server): add S3Store over boto3 with moto contract tests`

### Task 4: 设置、`build_store` / `install` / `get_store`、conftest 注入

**Files:** `server/app/core/config.py`、`server/app/core/settings_registry.py`、新 `server/app/storage/config.py`、`server/app/storage/__init__.py`、`server/app/main.py`(一行锚点)、`server/.env.example`、`server/tests/conftest.py`、`server/tests/test_settings_registry.py`;新 `server/tests/test_storage_config.py`

- [ ] 先写 `tests/test_storage_config.py`:默认 `app.state.storage` 是 `LocalStore` 且根 = `resolved_data_dir`;`STORAGE_BACKEND=s3` 缺桶 / 缺钥匙时 `create_app` 抛 `RuntimeError`,消息只有键名(断言不含占位秘密值);同档案回退被拒;`get_store(app)` 每次读 `app.state.storage`(替换后立即生效);`StorageError(code="unavailable")` 从任意路由冒出 → 503 `{"error": "Storage unavailable"}`;`.env.example` 为 14 个键各有一行中文注释(参照 `tests/test_library_image.py:16` 的写法);`s3_access_key` 等四个钥匙在 `SECRETS` 里、14 个都在 `ENV_ONLY` 里;`log_buffer.redact` 能抹掉 `S3_SECRET_KEY` 的当前值。
- [ ] `tests/test_settings_registry.py`:`EXPECTED_ENV_ONLY` 加 14 个、`EXPECTED_SECRETS` 加 4 个。
- [ ] `tests/conftest.py`:新夹具 `storage_backend`(`request.param` 默认 `"local"`)与 `store`;`app` 夹具在 `create_app` 之后,若为 `"s3"` 则进入 `mock_aws()`、建桶、`app.state.storage = S3Store(...)`,结束时退出 mock。不改现有夹具的签名与默认行为。
- [ ] 实现:`config.py` / `settings_registry.py` 在锚点处追加 14 个字段与 `_env(..., group="ops")`;`storage/config.py` 的 `build_store(settings, profile)`、`install(app)`(建主后端;配了回退则包 `FallbackStore`——Task 6 之前回退值被拒绝并给出「尚未支持」);`main.py` 在 `install_library(app)` 之前加一行 `install_storage(app)  # L1: app.state.storage (plan 2026-10-21-l1-object-storage)`。
- [ ] `.env.example` 新增「对象存储」一节:全部占位(`S3_ACCESS_KEY=`、`S3_SECRET_KEY=`,绝无真实值),注明 MinIO 用 `S3_PATH_STYLE=true`。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_config.py tests/test_settings_registry.py tests/test_config.py tests/test_architecture.py`
- [ ] 提交:`feat(server): wire STORAGE_BACKEND and S3 settings into app.state.storage`

### Task 5: `blob_response`(服务端代理 Range)

**Files:** 新 `server/app/storage/http.py`;新 `server/tests/test_storage_range.py`

- [ ] 先写 `tests/test_storage_range.py`:一个最小 FastAPI 应用 `GET/HEAD /m` 调 `blob_response`,对 `local` 与 `s3`(moto)两种后端参数化,复用 `tests/test_library_range.py` 的数据(10240 字节)与断言:200 全量 + `accept-ranges` / `content-length` / `etag` / `last-modified`;四个单段 206 用例逐字节相等;`bytes=10240-` → 416 `bytes */10240`;`bytes=5-2`、`items=0-1` → 400;`If-Range` 等于 ETag → 206、不等 → 200 全量;多段:本地 → `multipart/byteranges`(Starlette),S3 → 200 全量(R8,显式断言差异);HEAD 无正文;客户端中途断开时 `RangeStream.aclose()` 被调用(用假的 `RangeStream` 计数);缺失键 → 调用方拿到 `BlobNotFound`(由路由映射 404)。`tests/test_library_range.py` **不改**。
- [ ] 实现 `blob_response` 与 `BlobRangeResponse`(R8);`filename` 参数给备份下载用(`Content-Disposition: attachment`,文件名只来自 `BACKUP_RE` 校验过的名字)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_range.py tests/test_library_range.py tests/test_architecture.py`
- [ ] 提交:`feat(server): stream blobs with Range support through blob_response`

### Task 6: `FallbackStore`(双读 + 计数)

**Files:** 新 `server/app/storage/fallback.py`、`server/app/storage/config.py`;新 `server/tests/test_storage_fallback.py`

- [ ] 先写测试:主有 → 读主、计数 0;主无次有 → 读次、计数 +1、日志行 `storage fallback hit op=get_bytes`(caplog 里没有键);写只到主;`delete` / `delete_prefix` 只动主(次后端对象仍在);`list` 只列主;`stat` 回退;`open_range` 回退;两边都无 → `BlobNotFound`;`hits` 可从 `app.state.storage` 读到;`STORAGE_FALLBACK=local` + `STORAGE_BACKEND=s3` 能启动;契约套件对 `FallbackStore(主=moto, 次=local)` 也全绿。
- [ ] 实现(R11),`config.install` 去掉 Task 4 的「尚未支持」。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_fallback.py tests/test_storage_config.py tests/test_architecture.py`
- [ ] 提交:`feat(server): add the read-fallback store for the migration observation period`

---

## 批次 B · 跟读库与精选库(体积大头)

### Task 7: 测试助手先改走存储

**Files:** `server/tests/storage_helpers.py`、`server/tests/catalog_helpers.py`、`server/tests/library_helpers.py`;`server/tests/test_library_catalog_media.py`、`server/tests/test_library_catalog_store.py`(只改用到 `media_file()` / 直接写目录的断言)

- [ ] `storage_helpers.py`:`async put(app, key, data)`、`async read(app, key) -> bytes`、`async exists(app, key) -> bool`、`async keys_under(app, prefix) -> list[str]`,全部经 `get_store(app)`。
- [ ] `catalog_helpers.make_catalog`:`with_files=True` 时用 `store.put_bytes(f"{rel}/{name}", MEDIA)` 与封面(原 `tests/catalog_helpers.py:28-32` 的 `mkdir` + `write_bytes`);`media_file()`(`:43`)保留一版过渡(仍返回本地路径,仅本地后端可用),新增 `async media_bytes(app, cid, name)`;本批之后的测试改用后者。
- [ ] `library_helpers`:新增 `async item_files(app, user_id, item_id) -> list[str]`(经 `keys_under`),旧的磁盘断言保持可用。
- [ ] 这一步不改任何产品代码;默认后端下全部断言应保持绿(**未运行**)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_library_catalog_media.py tests/test_library_catalog_store.py tests/test_architecture.py`
- [ ] 提交:`test(server): route catalog and library test helpers through the store`

### Task 8: `paths.py` 键函数与删除改走存储

**Files:** `server/app/library/paths.py`、`server/app/library/store.py`、`server/app/library/worker.py`、`server/app/library/catalog_jobs.py`、`server/app/library/catalog_store.py`(仅 `collect_if_orphan` / `collect_retired` / `purge`)、`server/app/library/pipeline.py`(仅 `PipelineDeps.storage` 字段)、`server/app/admin/users_admin.py`(仅 `:217` 一行)、`server/app/routers/library.py`(仅 `:288` 一行);新 `server/tests/test_library_storage_delete.py`;`tests/test_architecture.py`(收缩 `DATA_DIR_ALLOWED`)

- [ ] 先写失败测试 `tests/test_library_storage_delete.py`(参数化 `storage_backend=["local","s3"]`):删条目只删 `library/<uid>/<id>/` 前缀(另一个用户 `10` 的同名前缀不受影响);删副本绝不按 `media_path` 删 `_catalog` 对象;取消条目删媒体但保留暂存外的一切;退役且引用为 0 的目录被清扫时删 `library/_catalog/<cid>/` 前缀;强制删除删全部副本前缀与目录前缀;删用户删 `library/<uid>/`;所有删除在提交之后,删除失败(monkeypatch `delete_prefix` 抛 `StorageError`)不让接口失败,日志只有 `op=delete_prefix code=…`。
- [ ] `paths.py`:新增纯函数 `media_key(user_id, item_id, name)`、`poster_key(user_id, item_id)`、`transcript_key(user_id, item_id)`、`catalog_media_key(catalog_id, name)`、`catalog_poster_key(catalog_id)`、`item_prefix(...)`(带尾 `/`)、`user_prefix(user_id)`、`catalog_prefix(catalog_id)`;`remove_item_files` / `remove_user_files` / `remove_catalog_files` 改为 `async`,签名加 `store`:先 `delete_prefix`(持久),再 `remove_tree`(本地暂存,`paths.py:65-82, 126-128` 现有逻辑)。`item_dir` / `catalog_dir` 保留到 Task 11 末尾删除(届时无调用者)。
- [ ] `PipelineDeps` 加 `storage: Callable[[], BlobStore]`;`worker.install`(`worker.py:246`)传 `lambda: state.storage`。
- [ ] 调用点:`store.py:201, 221, 239`、`worker.py:137, 189, 202`、`catalog_jobs.py:100-103`(只动 `catalog_tmp_dir`,保持本地)、`catalog_store.py:350-387`、`users_admin.py:217`、`routers/library.py:288`。删除一律包 `try/except Exception` 记类名,与 `services/chat_recordings.py:31-37` 的风格一致。
- [ ] 验证:`cd server && uv run pytest -q tests/test_library_storage_delete.py tests/test_library_worker.py tests/test_library_delete_user.py tests/test_library_catalog_store.py tests/test_admin_users.py tests/test_architecture.py`
- [ ] 提交:`refactor(server): delete library and catalog files through the store`

### Task 9: 流水线落盘接缝(用户库)

**Files:** `server/app/library/pipeline.py`、`server/app/library/asr_chunks.py`;新 `server/tests/test_library_pipeline_storage.py`;`tests/test_architecture.py`(收缩白名单)

- [ ] 先写失败测试(参数化两种后端,`FakeTools`):上传条目处理到 `ready` 后,`media.mp4` / `poster.jpg` / `transcript.json` 在存储里、内容正确;本地 `library/<uid>/<id>/` 在 S3 后端下**不存在**;`_tmp/<id>` 被清掉;写库前取消(让 `set_progress` 返回 False)→ 已 put 的键被删、抛 `Aborted`、无残留;断点续跑:媒体已在存储且 `_tmp` 为空、需要识别 → 触发一次 `download_to`,只有字幕时不下载(给 `FakeTools` 计数);`put_file` 抛 `StorageError("unavailable")` → 流水线把它转成 `LibraryError("network")`,条目按瞬时错误自动重试(`app/library/errors.py:19` 的 `TRANSIENT = {"upstream", "network", "ytdlp_transient"}`,已核对;不新增错误种类,契约夹具不变)。
- [ ] `asr_chunks.py`:新增 `dump_transcript(chunks, silences) -> bytes` 与 `parse_transcript(data: bytes)`;`save_transcript` / `load_transcript`(`asr_chunks.py:240-256`)改为它们的薄包装(其余调用者不变)。
- [ ] `pipeline._media_stage`(`pipeline.py:177-195`):`paths.replace(normalized → final)` 换成 `await store.put_file(media_key, normalized.path, content_type=mime)`,封面同理;`size` 用 `BlobInfo.size`;写库 `rowcount != 1` → 只删本次两个键;成功后不删 `tmp/out/` 里的成品(R7:识别还要用),由 `process` 末尾的 `remove_tree(tmp)` 统一删;返回 `(duration_ms, local_media)`。
- [ ] `pipeline.process`(`:308-318`):续跑判断从 `media.is_file()` 改成 `await store.stat(item.media_path)`;识别分支需要本地媒体时 `local_media or download_to(...)`;`transcript.json`(`:342-361`)改为提交后 `put_bytes(transcript_key, dump_transcript(...))`——**顺序裁定**:今天是「写库前写 `.new`、提交后 replace」,S3 上没有 replace,改成「提交后 put」;put 失败只记日志并把 `rebuildable` 回写为 False(后续「重新分句」不可用,但条目可播放),理由:不能让已提交的 ready 条目因转写备份失败而回滚。
- [ ] 验证:`cd server && uv run pytest -q tests/test_library_pipeline_storage.py tests/test_library_worker.py tests/test_library_api.py tests/test_library_words_pipeline.py tests/test_library_alignment.py tests/test_architecture.py`
- [ ] 提交:`feat(server): put library media and transcripts into the store at the pipeline seam`

### Task 10: 跟读库与精选库的用户路由

**Files:** `server/app/routers/library.py`、`server/app/routers/library_catalog.py`、`server/app/library/catalog_store.py`(`media_missing`、`add_to_library`);`server/tests/test_library_api.py`(媒体 / 封面用例参数化)、`server/tests/test_library_catalog_media.py`、`server/tests/test_library_reprocess.py`、`server/tests/test_library_privacy.py`;`tests/test_architecture.py`(从 `FILE_RESPONSE_ALLOWED` 删掉这两个路由)

- [ ] 先写 / 改失败测试(参数化两种后端):`GET /items/{id}/media` 的 200、单段 206、416、HEAD、票据过期 / 用户被禁 / 条目删除后立即 404(每个 Range 请求都重验,`routers/library.py:565-586`);封面;副本经 `_catalog` 键播放;目录封面;`reprocess` 在媒体缺失时 `no_material`(`:342-343`);`retry` 的 `_has_material`(`:293-299`);`rebuild` 从存储读 `transcript.json`(`:370-372`);换字幕删除 `transcript.json`(`:411`);添加目录条目时媒体缺失 → `catalog_not_found`;存储不可达 → 503;`test_library_privacy.py` 新增「S3 后端下媒体请求失败时日志里没有键与票据」。
- [ ] 实现:`media` / `poster` / `catalog_poster` 改用 `blob_response`(先完成票据与行检查,再触碰存储);`_has_material`、`reprocess` 的存在性改 `await store.stat`(本地暂存 `in.*` 判断保持本地);`rebuild` 用 `get_bytes(transcript_key, max_bytes=…)` + `parse_transcript`(上限取 `limits` 里新加常量 `TRANSCRIPT_MAX_BYTES`,**实现时按现有最大条目时长估算并写注释**);`catalog_store.media_missing` → `async media_missing(store, row)`,`add_to_library(session, store, …)`。
- [ ] 验证:`cd server && uv run pytest -q tests/test_library_api.py tests/test_library_catalog_media.py tests/test_library_reprocess.py tests/test_library_privacy.py tests/test_library_range.py tests/test_architecture.py`
- [ ] 提交:`feat(server): serve library media and posters through the store`

### Task 11: 精选库导入、换媒体与管理端

**Files:** `server/app/library/catalog_import.py`、`server/app/admin/catalog_admin.py`、`server/app/routers/admin_catalog.py`、`server/app/library/paths.py`(删掉已无调用者的 `item_dir` / `catalog_dir`);`server/tests/test_library_catalog_import.py`、`server/tests/test_admin_catalog.py`、`server/tests/test_admin_catalog_replace.py`、`server/tests/test_library_catalog_jobs.py`;`tests/test_architecture.py`(收缩两条白名单)

- [ ] 先写 / 改失败测试(参数化两种后端):导入完成后媒体与封面在 `library/_catalog/<cid>/`;续跑判断用 `stat`(`catalog_import.py:283-291`);换媒体:新名字(`media-2.mp4`)先 put、提交后才删旧键,提交前失败只删新键、旧媒体与副本不受影响(R6.4,`:167-196`);管理端列表的 `media_missing` 用**一次** `list("library/_catalog/")` 判断(给 S3 夹具计数 `HeadObject` 调用 = 0);发布前媒体缺失 → 409;`_stop` 取消一条没有句子的导入时删目录前缀(`catalog_admin.py:314-335`);删除 / 强制删除删前缀;管理端试听 `GET …/media` 支持 Range(`admin_catalog.py:231-250`)。
- [ ] 实现:`catalog_import._media_stage`(`:111-131`)与 `_replace_stage`(`:167-196`)同 Task 9 的接缝写法(存储不可达同样转 `LibraryError("network")`);识别需要的本地媒体同 R7;`catalog_admin.row_out` / `list_items` / `set_published`(`:61-88, 283`)改成异步存在性检查(列表用 `list` 建集合);`_file` 改 `blob_response`。
- [ ] 暂存相关(`catalog_admin.py:137-154, 193-195, 246-250`、`catalog_jobs.py:100-103`)**保持本地不动**(R7)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_library_catalog_import.py tests/test_admin_catalog.py tests/test_admin_catalog_replace.py tests/test_library_catalog_jobs.py tests/test_architecture.py`
- [ ] 提交:`feat(server): store curated catalog media and serve the admin preview through the store`

---

## 批次 C · 录音、房间语音、头像

### Task 12: 评测录音

**Files:** `server/app/services/recordings.py`、`server/app/services/assessment_store.py`、`server/app/services/chat_recordings.py`、`server/app/routers/speech.py`(两处调用)、`server/app/routers/conversations.py`(`:304, 470` 两处)、`server/app/realtime/realtime_providers.py`(`:322-330` 调用、`:347-361` 构造传 `lambda: app.state.storage`)、`server/app/routers/assessments.py`、`server/app/routers/admin.py`;`server/tests/test_assessment_store.py`、`test_assessment_save.py`、`test_assessments_api.py`、`test_chat_orphan_cleanup.py`、`test_realtime_assessor.py`、`test_admin_api.py`(录音下载用例);`tests/test_architecture.py`

- [ ] 先写 / 改失败测试(`test_assessments_api.py` 的下载用例参数化两种后端):保存评测后 `recordings/<uid>/<aid>.wav` 在存储;提交失败 → 键被删(`assessment_store.py:24-42` 的语义);删除评测在提交后删键;孤儿对话录音清理删键;用户下载与管理端下载支持 Range;键缺失 → 404「Recording not found」;实时通话保存时存储抛 `StorageError` → 仍走现有 `except OSError` 分支(`realtime_providers.py:328-333`),不打断通话。
- [ ] 实现:`recordings.write_recording(store, relpath, data)` / `delete_recording(store, relpath)` 改为 `async`(键校验替代 `absolute_path`;`absolute_path` 保留到 Task 13 末尾,房间语音还在用);`save_assessment(..., store=…)`;`remove_files(store, relpaths)` 改 `async`、从不抛;两个下载路由改 `blob_response`;`used_bytes` 不变(按 DB 字节)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_assessment_store.py tests/test_assessment_save.py tests/test_assessments_api.py tests/test_chat_orphan_cleanup.py tests/test_realtime_assessor.py tests/test_admin_api.py tests/test_architecture.py`
- [ ] 提交:`feat(server): store assessment recordings through the store`

### Task 13: 房间语音

**Files:** `server/app/rooms/audio.py`、`server/app/rooms/voice.py`、`server/app/routers/rooms_voice.py`、`server/app/routers/admin_rooms.py`、`server/app/services/recordings.py`(删 `absolute_path`);`server/tests/test_rooms_audio.py`、`test_rooms_voice_service.py`、`test_rooms_voice_api.py`、`test_admin_rooms_v2.py`(播放用例);`tests/test_architecture.py`

- [ ] 先写 / 改失败测试(`test_rooms_voice_api.py` 参数化两种后端):上传后 `room_audio/<room>/<msg>.<fmt>` 与 `room_audio/_staging/<msg>.wav` 在存储;写库失败两键都删(`voice.py:146-155`);转写读暂存(`:190`)、成功后删暂存(`:211`);清扫删陈旧暂存(`:336`);播放:缺失 → 410「Audio removed」(`rooms_voice.py:189` 的 `FileNotFoundError` 分支由 `BlobNotFound` 继承关系保持);管理端只允许 `room_audio/` 前缀的键(`admin_rooms.py:244-252` 的 `is_relative_to` 换成键前缀检查),`recordings/…` 被拒。
- [ ] 实现:`audio.write_file / read_file / delete_file` 改为 `async` 且接 `store`;`VoiceDeps.data_dir` → `storage: Callable[[], BlobStore]`(`voice.py:53`、`rooms_voice.py:90`);房间语音 ≤ 2.1 MB,播放继续用 `get_bytes(max_bytes=MAX_UPLOAD_BYTES)` + `Response`(保留现有 ETag / 304 逻辑,不需要 Range)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_rooms_audio.py tests/test_rooms_voice_service.py tests/test_rooms_voice_api.py tests/test_admin_rooms_v2.py tests/test_rooms_addressing_voice.py tests/test_architecture.py`
- [ ] 提交:`feat(server): store room voice clips and staging WAVs through the store`

### Task 14: 头像

**Files:** `server/app/services/avatars.py`、`server/app/routers/avatars.py`、`server/app/admin/avatars_admin.py`(`:92`)、`server/app/admin/users_admin.py`(`:218`);`server/tests/test_avatars_storage.py`、`test_avatars_api.py`、`test_admin_avatars.py`、`test_avatars_privacy_sweep.py`;`tests/test_architecture.py`

- [ ] 先写 / 改失败测试(`test_avatars_api.py` 读取用例参数化两种后端):上传写 `avatars/<id>.webp`;提交失败删新键、旧头像不变;提交成功后删旧键;公开读取只认 `users.avatar_id` 里存在的 id(`avatars.py:181-191` 的语义),缺失 → 404;响应头不变(`immutable`、`nosniff`、CSP);`test_avatars_storage.py:32` 的「`os.replace` 失败不留临时文件」用例已在 Task 2 的本地契约里覆盖,这里删掉并在注释里指向那条。
- [ ] 实现:`store(settings, data)` → `async save(store, data) -> str`;`remove(store, avatar_id)` → `async`、从不抛;`public_path` → `async public_read(session, store, avatar_id) -> bytes | None`(`get_bytes(max_bytes=MAX_UPLOAD_BYTES)`);路由用 `Response`(头像 ≤ 256×256 webp,不需要 Range)。模块 docstring 的「只接受 Settings 参数」改为「只接受 store 参数,不读 app.state」(INDEX X32 的约束保持)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_avatars_storage.py tests/test_avatars_api.py tests/test_admin_avatars.py tests/test_avatars_privacy_sweep.py tests/test_admin_users.py tests/test_architecture.py`
- [ ] 提交:`feat(server): store avatars through the store`

---

## 批次 D · 管理端

### Task 15: 清理工具、存储页、删用户

**Files:** `server/app/admin/housekeeping.py`、`server/app/admin/storage.py`、`server/app/admin/users_admin.py`(`_remove_recordings`,`:285-291`)、`server/app/routers/admin_ops.py`(`:241-243`);`server/tests/test_housekeeping.py`、`test_admin_storage.py`、`test_admin_users.py`;`tests/test_architecture.py`

- [ ] 先写 / 改失败测试(`test_housekeeping.py`、`test_admin_storage.py` 参数化两种后端):孤儿录音扫描只看 `recordings/`、宽限期内的(按 `BlobInfo.mtime`)不算;令牌不变则删除、变了 409;房间语音清理只删 `room_audio/` 键,DB 置 `purged_at`;存储摘要 `staging_bytes` = `list("room_audio/_staging/")` 的字节和;摘要新增 `backend`(`"local"`/`"s3"`)、`fallback`(`""`/档案名)、`fallback_hits`;删用户删 `recordings/<uid>/` 前缀、失败不抛(行为变化:今天 `rmtree(ignore_errors=False)` 会在提交后抛出——改为记类名不抛,在 results 里写明)。
- [ ] 实现(R15):`_walk` / `_room_audio_files` 改为 `async`,数据来自 `list`;逐行 `stat` 改字典查找;删除用 `store.delete`;`storage_summary(session, store)`。
- [ ] 验证:`cd server && uv run pytest -q tests/test_housekeeping.py tests/test_admin_storage.py tests/test_admin_users.py tests/test_architecture.py`
- [ ] 提交:`feat(server): run housekeeping and storage usage over the store`

### Task 16: 备份上传与修剪

**Files:** `server/app/admin/backups.py`、`server/app/routers/admin_ops.py`(`:161-218`);`server/tests/test_backups.py`;`tests/test_architecture.py`

- [ ] 先写失败测试:本地后端行为与今天完全一致(现有 5 个用例不改);S3 后端(moto):`create_backup` 后本地文件存在且 `backups/<name>` 对象存在、sha256 一致;`BACKUP_KEEP=2` 时本地与远端各剩 2 份;列表合并、`where` 字段正确;本地文件被删后下载仍从存储流式给出(一次性链接、审计不变);删除同时删两边;上传失败 → 备份仍算成功(本地有),日志 `backup upload failed code=…`,doctor 可见(Task 17)。
- [ ] 实现(R13)。`path_of` / `BACKUP_RE` 不变。
- [ ] 验证:`cd server && uv run pytest -q tests/test_backups.py tests/test_architecture.py`
- [ ] 提交:`feat(server): upload SQLite backups to object storage and prune both copies`

### Task 17: doctor 存储诊断

**Files:** `server/app/admin/doctor.py`;`server/tests/test_admin_doctor.py`

- [ ] 先写失败测试:新代码 `storage_s3_unreachable`(error;`probe()` 返回 `unreachable` / `denied` / `no_bucket`,消息只含键名 `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY`,不含值)、`storage_fallback_active`(warn;配置了回退,附 `fallback_hits` 数字)、`storage_backup_not_uploaded`(warn;S3 后端下最近一份本地备份没有远端副本);本地后端只做 `probe()` 的 `not_writable`;`probe` 有 3 秒超时,超时 = `unreachable`;doctor 页不会对每个条目发 HEAD。
- [ ] 实现:`CODES` 追加三项;`Facts` 加 `storage_backend`、`storage_probe`、`storage_fallback`、`storage_fallback_hits`、`backup_unsynced`;`gather_facts` 只调一次 `probe()`。
- [ ] 验证:`cd server && uv run pytest -q tests/test_admin_doctor.py tests/test_architecture.py`
- [ ] 提交:`feat(server): diagnose object storage connectivity in the admin doctor`

### Task 18: 收口:白名单、隐私扫描

**Files:** `server/tests/test_architecture.py`;新 `server/tests/test_storage_privacy.py`

- [ ] `FILE_RESPONSE_ALLOWED` 收到只剩 `storage/http.py` 与 `routers/web.py`(SPA 静态文件);`DATA_DIR_ALLOWED` 收到只剩:`core/config.py`、`storage/config.py`、`library/worker.py`(暂存根)、`library/pipeline.py` / `catalog_import.py`(暂存)、`routers/library.py`(分片上传暂存)、`admin/catalog_admin.py`(目录上传暂存)、`admin/system.py`(磁盘用量)、`admin/backups.py`(本地备份目录)——以实际 grep 为准,多出的都是遗漏。新增断言:`LocalStore.path_of` 只在 `app/storage/` 内被调用。
- [ ] `tests/test_storage_privacy.py`:用含 `SECRET-KEY-…` 的键、`SECRET-ACCESS` / `SECRET-SECRET` 钥匙、`https://SECRET-ENDPOINT.test` 端点驱动 S3 后端的成功、`NoSuchKey`、`AccessDenied`、连接失败、回退命中、删除失败路径,断言 `caplog`、异常 `str()`、503 响应体、审计行里都没有这些占位值与用户 id。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_privacy.py tests/test_architecture.py`
- [ ] 提交:`test(server): pin the storage privacy rules and close the migration allowlists`

---

## 批次 E · 一次性迁移命令(spec §6)

命令形状(R12):

```
python -m app.storage.migrate --from local --to s3 [--manifest PATH] [--prefix library/ …]
                              [--dry-run | --verify-only | --reconcile-only]
                              [--concurrency 4] [--pg-backup-done] [--report PATH]
```

退出码:`0` 全部 verified / 对账无差异;`2` 有失败或差异;`3` 前置条件不满足(同一档案、缺备份、配置缺失)。标准输出与日志只有计数、字节、毫秒、错误码。清单默认 `<resolved_data_dir>/storage-migrate/<from>-to-<to>.jsonl`(不在 ROOTS 之下,永远不会被当成对象;POSIX 下 `0600`);清单与 `--report` 文件里有键,**属于本机运维文件,不是日志**,README 写明不要外传。

### Task 19: 清单、复制、校验、续跑、`--dry-run`、`--verify-only`

**Files:** 新 `server/app/storage/manifest.py`、`server/app/storage/migrate.py`;新 `server/tests/test_storage_migrate.py`

- [ ] 先写失败测试(本地目录 + 两个 moto 桶,覆盖 `local→s3`、`s3_fallback→s3`、`s3→local`):
  - 建清单:按 ROOTS 前缀列源(默认 `library/ recordings/ room_audio/ avatars/ bundles/`;`backups/` 只有显式 `--prefix backups/` 才包含),每项流式算 sha256;`app.db`、`_tmp`、`.part` 永不入清单。
  - `--dry-run`:目标零写入、不备份、输出「将复制 N 个 / B 字节,已存在且一致 M 个」。
  - 复制:目标已有同大小 + 同 sha256 → 记 `verified` 跳过;否则 `download_to` 本地临时文件 → `put_file`(写 sha256 元数据)→ `stat` 比大小与 sha256(本地目标重算)→ `verified` 或 `failed(integrity)`;**源永不删除、永不修改**(测试比较源的 mtime 与内容)。
  - 续跑:第一次在第 k 个对象处抛 `KeyboardInterrupt`;第二次只处理剩余的,已 `verified` 的不再上传(给目标计 `PutObject` 次数)。清单是追加式 JSONL(每行一个状态变化,后写的生效),半行(崩溃时写一半)被忽略。
  - `--verify-only`:不写目标,只核对清单里每个键在目标的大小与 sha256(S3 元数据缺失时流式重算),报告 `ok / missing / mismatch` 计数,有差异退出码 2。
  - 增量:迁移后源新增对象,再跑一次 `plan` 只追加新键。
  - 日志与 stdout:caplog 与 capsys 里没有任何键、用户 id、钥匙。
- [ ] 实现:`manifest.py`(`Entry(key, size, sha256, state, error)`、`append`、`load`)、`migrate.py`(`argparse`、`build_store(settings, profile)` 构造两端、`asyncio.Semaphore(concurrency)`)。同一档案作源与目标 → 退出码 3。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_migrate.py tests/test_architecture.py`
- [ ] 提交:`feat(server): add the manifest-driven, resumable storage migration command`

### Task 20: 强制备份、对账报告、回退观察期

**Files:** `server/app/storage/migrate.py`、新 `server/app/storage/reconcile.py`;新 `server/tests/test_storage_reconcile.py`、`server/tests/test_storage_migrate_backup.py`

- [ ] 先写失败测试:
  - 非 `--dry-run` / `--verify-only` 的运行先写 DB 快照到 `resolved_backup_dir`,文件名满足 `admin.backups.BACKUP_RE`,`admin.backups.list_backups(settings)` 能列出它(测试可以同时 import 两边);快照失败 → 退出码 3、零写入。PostgreSQL(monkeypatch 方言)无 `--pg-backup-done` → 退出码 3 并打印 pg_dump 提示(与 `admin/backups.py:23` 同文案)。
  - 对账(`--reconcile-only` 或复制结束后自动跑一次,只读):DB 引用集合 = `library_items.media_path/poster_path` + `rebuildable` 条目的 `transcript_key` + `catalog_items.media_path/poster_path` + `assessments.audio_path` + `room_voice.audio_path/staging_path` + `users.avatar_id → avatars/<id>.webp`;与目标 `list` 结果比较,输出分类计数「库里有、存储没有」「存储有、库里没有」(按 ROOTS 分组);`--report PATH` 时把两类键写进本地文件;**从不删除任何对象**(测试:对账前后目标对象集合完全相同)。副本(`source="catalog"`)指向 `_catalog` 键,不算缺失也不重复计数。
  - 回滚演练:迁移后 `STORAGE_BACKEND=s3, STORAGE_FALLBACK=local` 启动应用,删除一个目标对象,读取经回退成功且 `hits == 1`;改回 `STORAGE_BACKEND=local` 后所有读取不依赖目标(源未动)。
- [ ] 实现:`reconcile.py`(只读查询 + 集合运算,依赖 `app.models`,R1 允许);`migrate.py` 的备份步骤(R12 的分层裁定)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_reconcile.py tests/test_storage_migrate_backup.py tests/test_storage_migrate.py tests/test_backups.py tests/test_architecture.py`
- [ ] 提交:`feat(server): back up before migrating and report DB-vs-storage drift without deleting`

---

## 批次 F · 精选库 bundle(原 L2)

### Task 21: `catalog_bundle.py` 导出 / 导入

**Files:** 新 `server/app/library/catalog_bundle.py`;新 `server/tests/test_catalog_bundle.py`

- [ ] 先写失败测试(参数化两种后端,`make_catalog` 造条目):
  - 导出:`bundles/<cid>/manifest.json` 结构 = `{"schema_version": 1, "kind": "enjoy.catalog_bundle", "exported_at", "catalog_id", "item": {title, level, tags, license_note, source, source_host, duration_ms, media_mime, sub_source, low_confidence, ai_lang}, "media": {key, bytes, sha256}, "poster": {…} | null, "segments": [{idx, start_ms, end_ms, text, zh, zh_lang, analysis, analysis_lang, flags}]}`;不含 `published`、`refs`、`asr_seconds`、任何用户 id(用一个有副本、有用户的条目断言);非 `ready` / 已退役 / 媒体缺失 → 拒绝。
  - 导入(换一个空库 + 同一存储,模拟「生产库 + 已 mirror 的桶」):建出 `ready`、`published=False`、句子逐列相等、`media_bytes` 正确;**不调用** `FakeTools` / 识别 / 大模型(计数 = 0);同 id 已存在 → 409;版本 2 → 「Unsupported bundle version」;manifest 里的媒体键指向 `library/<uid>/…`(用户媒体)或别的 `<cid>` → 拒绝;媒体缺失 / 大小不符 / sha256 不符 → 拒绝且不建行;句子 idx 不连续、时间倒序、文本超长、`ai_lang` 不支持 → 拒绝;manifest 超过 8 MiB → 拒绝;未知可选键被忽略。
- [ ] 实现:`async export_bundle(session, store, catalog_id, now) -> dict`(计数摘要)、`async import_bundle(session, store, catalog_id, now) -> CatalogItem`、`async list_bundles(store) -> list[dict]`(只列 `bundles/<cid>/manifest.json` 的 id、字节、时间,不逐个下载)、`BundleError(status, message)`。元数据清洗复用 `catalog_store.clean_*` 与 `store.clean_title`;日志只有目录 id 与计数。
- [ ] 验证:`cd server && uv run pytest -q tests/test_catalog_bundle.py tests/test_architecture.py`
- [ ] 提交:`feat(server): export and import curated catalog bundles without re-running the pipeline`

### Task 22: 管理端接口与审计

**Files:** `server/app/routers/admin_catalog.py`、`server/app/admin/catalog_admin.py`;新 `server/tests/test_admin_catalog_bundle.py`

- [ ] 先写失败测试:`POST /api/admin/library/catalog/{cid}/bundle`(operator,审计 `catalog.bundle_export`,`after` 只有 `segments` / `bytes`)、`GET /api/admin/library/catalog/bundles`(viewer;每项 `{catalog_id, bytes, exported_at, importable}`,`importable` = 本库没有该 id)、`POST /api/admin/library/catalog/bundles/{cid}/import`(operator,`reason` 必填,审计 `catalog.bundle_import`);路由顺序:`/bundles…` 声明在 `/{catalog_id}` 之前(否则 `CatalogUuid` 校验把 `bundles` 判成 422——**实现时核对** FastAPI 的匹配顺序);错误串英文、固定;日志 / 审计里没有标题、许可说明、句子(扩展 `tests/test_library_privacy.py` 的目录用例或在本测试里扫 caplog)。
- [ ] 验证:`cd server && uv run pytest -q tests/test_admin_catalog_bundle.py tests/test_admin_catalog.py tests/test_library_privacy.py tests/test_architecture.py`
- [ ] 提交:`feat(server): add admin endpoints for catalog bundle export and import`

### Task 23: 管理端界面挂点(最小)

**Files:** `admin/src/features/catalog/api.ts`、`api.test.ts`、`catalog-detail.tsx`、`catalog-detail.test.tsx`、`catalog-page.tsx`、`catalog-page.test.tsx`、新 `bundle-dialog.tsx`、`strings.ts`、`CLAUDE.md`

- [ ] 先写失败测试(mock `./api`):详情页对 `ready` 且未退役的条目显示「导出 bundle」,点击调用 `exportBundle(id)` 并提示成功;列表页「从 bundle 导入」打开对话框,列出 `importable` 的 bundle,选择 + 填理由 → `importBundle(id, reason)`,完成后刷新列表;服务端错误经 `S.errors` 映射(新增 `Unsupported bundle version`、`Item exists`、`Bundle media is missing`、`Bundle is invalid`)。
- [ ] 文案只有 zh-CN(管理端现有约定;INDEX §5 的三语要求针对 `web/src/i18n`,本车道不改用户网页)。
- [ ] 验证:`cd admin && yarn vitest run src/features/catalog`
- [ ] 提交:`feat(admin): add catalog bundle export and import controls`

---

## 批次 G · 运维与文档

### Task 24: compose `minio` profile 与 env 样例

**Files:** `docker-compose.example.yml`、`server/.env.example`;`server/tests/test_storage_config.py`(加一条文本检查)

- [ ] 先写失败测试:`docker-compose.example.yml` 含 `minio` 与 `minio-init` 两个服务且都在 `profiles: ["minio"]`;端口只绑 `127.0.0.1`;没有写死的密码(只用 `${MINIO_ROOT_PASSWORD:-change-me-minio}` 这类占位);`server` 服务的 `depends_on` 对 `minio-init` 是 `required: false`(不开 profile 时照常启动,与现有 `postgres` 写法一致);`.env.example` 的 S3 注释里出现 `S3_ENDPOINT=http://minio:9000` 与 `S3_PATH_STYLE=true` 的示例。
- [ ] 内容:`minio`(固定 tag,**实现时选并核对许可与镜像发布状态**,见风险 K4)、`minio-init`(`minio/mc`,`until mc alias set …; do sleep 1; done && mc mb --ignore-existing local/${S3_BUCKET:-enjoy}`;不设匿名访问策略 = 私有桶);`MINIO_ROOT_*` 来自 compose 项目环境,**不**把 `server/.env` 传给 MinIO 容器(沿用 `postgres` 段的注释);卷 `minio-data`。注释建议为服务端建专用访问钥匙而不是用 root。
- [ ] 验证:`cd server && uv run pytest -q tests/test_storage_config.py tests/test_architecture.py`
- [ ] 提交:`feat(server): add an optional MinIO compose profile with bucket bootstrap`

### Task 25: 文档

**Files:** 新 `server/app/storage/CLAUDE.md`;`server/README.md`(新「对象存储」一节 + 「跟读库」的存储 / 备份两条更新)、`server/app/CLAUDE.md`(层列表)、`server/app/library/CLAUDE.md`(Pitfalls:持久文件只经存储、`put` 先于写库、暂存留本地、bundle)、`server/tests/CLAUDE.md`(`storage_backend` 夹具与 moto)

- [ ] README「对象存储」:何时需要;三种档案;MinIO / OSS / COS / R2 / AWS 的 `S3_PATH_STYLE` / `S3_REGION` 对照(R10,标注**未验证**的厂商);桶必须私有;反向代理不变(媒体仍从本服务出);**迁移步骤**:① `docker compose exec server python -m app.storage.migrate --from local --to s3 --dry-run` → ② 不带 `--dry-run` 在线复制 → ③ 管理端打开 `maintenance_mode=read_only` 并等跟读库 / 精选库队列空闲 → ④ 再跑一次(增量)→ ⑤ `--verify-only` 与 `--reconcile-only` → ⑥ `STORAGE_BACKEND=s3`、`STORAGE_FALLBACK=local` 重启 → ⑦ 关维护模式,观察存储页「回退命中」→ ⑧ 长期为 0 后清空 `STORAGE_FALLBACK` 重启;源数据由用户自行决定何时删除。**回滚**:改回 `STORAGE_BACKEND=local` 重启;若切换后已有新写入,先 `--from s3 --to local` 反向补齐。MinIO → 云厂商:旧端点写进 `S3_FALLBACK_*`,`--from s3_fallback --to s3`,其余相同。bundle 的「开发 → 生产」步骤(`mc mirror` 两个前缀,**未验证** `mc mirror` 是否保留用户元数据;导入时缺元数据会流式重算 sha256,所以不影响正确性)。
- [ ] 不写任何真实端点、桶名、钥匙;不写未测量的性能数字。
- [ ] 验证:`cd server && uv run pytest -q tests/test_architecture.py`(文档任务只确认没有误改代码)
- [ ] 提交:`docs: document object storage, the migration runbook and catalog bundles`

### Task 26: 管理端存储页 / doctor 卡片显示后端与回退

**Files:** `admin/src/features/ops/api.ts`、`data-page.tsx`、`data-page.test.tsx`、`strings.ts`;`admin/src/features/settings/doctor-card.tsx`(新代码的中文说明,如该卡片按代码映射文案——**实现时核对**)

- [ ] 先写失败测试:数据页显示「存储后端:本地 / S3」「回退:未启用 / 本地 / 旧 S3」「回退命中 N 次」;`fallback_hits > 0` 时高亮;不显示端点或桶名(接口本来就不返回)。
- [ ] 验证:`cd admin && yarn vitest run src/features/ops src/features/settings`
- [ ] 提交:`feat(admin): show the storage backend and fallback hits on the data page`

---

## 顺序与分批

| 批 | 任务 | 合并后的状态 |
|---|---|---|
| A 底座 | 0–6 | 新包可用,`app.state.storage` 存在;所有业务代码仍走磁盘,行为零变化 |
| B 库 / 精选库 | 7–11 | 体积大头走存储;`S3` 后端下跟读库完整可用 |
| C 录音 / 房间 / 头像 | 12–14 | 用户产生的全部持久文件走存储 |
| D 管理端 | 15–18 | 清理、存储页、备份、doctor 走存储;白名单收口 |
| E 迁移命令 | 19–20 | 可以把现有部署搬到 S3(或在 S3 之间搬) |
| F bundle | 21–23 | 开发环境处理好的精选条目可不重跑流水线搬到生产 |
| G 运维 / 文档 | 24–26 | compose、README、管理端显示 |

- A 必须最先;B、C、D 之间只有 Task 8 → Task 15 一条依赖(`users_admin` 两处都改,先后不冲突);E 依赖 A–D 全部(对账要知道所有键);F 依赖 B;G 可与 E / F 并行。
- **在 D 合并之前不要在任何环境把 `STORAGE_BACKEND` 设成 `s3`**:B 合并后录音仍在本地、备份 / 清理仍按磁盘,混合状态只适合测试。Task 18 是「可以切换」的门槛。
- 每个任务一个提交,提交后列出的测试保持绿;批次之间无需等待用户,但 E 的真实迁移(运维清单 §C)只在用户要求时做。

## 风险与未验证项

- **K1(未验证)moto + `asyncio.to_thread`**:`mock_aws` 是否在工作线程里生效未跑过;退路是 `ThreadedMotoServer`(Task 3)。
- **K2(未验证)Range 代理在真机上的表现**:iOS Safari / Android Chrome 对「多段 Range 回 200」、对 S3 ETag(多段上传的 `"…-N"` 形式)做 `If-Range` 的反应;反向代理(1Panel OpenResty)对流式响应的缓冲。只在设备清单 §A 验证后才可写「已验证」。
- **K3(未验证)厂商兼容性**:`request_checksum_calculation="when_required"` 的必要性与效果、`DeleteObjects` 支持、阿里云 OSS / 腾讯 COS 的 path-style 与 SigV4 细节、R2 的 `region=auto`;本计划只承诺 S3 API 的公共子集,每个厂商切换前跑运维清单 §B。
- **K4(未验证)MinIO 社区版镜像与许可现状**:MinIO 社区版近一年的发行方式与功能有变动(实现时查官方说明再定 tag;不行就改用其他 S3 兼容自建实现,只影响 compose 样例,不影响代码)。
- **K5 代理流式占服务端带宽**(spec §1.6):单 worker 下大量并发播放会占满出口与事件循环;**没有测量数字**。先量(运维清单 §A 记录同时 N 路播放时的 CPU / 带宽),再决定是否立项预签名 302。
- **K6 与 L4 的冲突面**:L4 要在 `pipeline.process` 与 `catalog_import.process` 的完成处补发 `LibraryItemReady`(INDEX §4),与本车道 Task 9 / 11 改同一函数的末尾。约定:L1 只改文件读写行,不挪动「提交之后」的位置;后合并者手工合并。
- **K7 与 L5 的冲突面**:L5 给 `library_segments` / 目录加角色字段,可能改 `catalog_store.add_to_library` 的复制列表;本车道 Task 10 也改它的签名(`data_dir → store`)。后合并者手工合并;bundle(R14)对 `speaker` 只做「可选键」。L5 的配音录音经 `services/assessment_store` 保存,自动随 Task 12 进存储,L5 不需要碰存储。
- **K8 bundle 版本演进**:v1 读者忽略未知键;将来字段语义变化(不是追加)才升 `schema_version`,导入端拒绝更高版本。
- **K9 观察期隐私**:回退期内被删除的数据仍留在源后端(R11),直到用户退役源;README 必须写清。
- **K10 硬链接**:`LocalStore.put_file` 的硬链接要求暂存文件此后只删不改(R4);若将来有人原地改写 `tmp/out/` 里的成品,会改坏已存储的文件。`app/storage/CLAUDE.md` 写进 Pitfalls。
- **K11 行为变化清单**(写进 results):删用户时录音目录删除失败从「提交后抛出」改为「记类名不抛」(Task 15);`transcript.json` 从「提交前写、提交后 replace」改为「提交后 put,失败则 `rebuildable=False`」(Task 9);存储不可达时相关接口返回 503(新)。
- **K12 镜像体积**:boto3 / botocore 进生产镜像,增大多少**未测**(需要 `docker compose build`,只在用户要求时做)。
- **K13 计数来源**:「约 159 个测试触及 data_dir」(spec §1.6)与本计划的 grep 数字(49 个文件、约 510 个 `def test_`)口径不同,都没有运行验证;实际要改的只是各任务点名的文件。

## 设备 / 运维清单(需要人工,在用户要求时进行)

**A. 真机 Range 播放(MinIO,本机 compose)**
- [ ] `docker compose --profile minio up -d`;`server/.env` 设 `STORAGE_BACKEND=s3`、`S3_ENDPOINT=http://minio:9000`、`S3_PATH_STYLE=true`、专用钥匙;重启。
- [ ] 上传一段 ≥ 5 分钟的视频,手机经 HTTPS 反向代理打开:iPhone Safari 与 Android Chrome 各测 拖动进度、句子循环、锁屏后恢复、票据 30 分钟过期后自动换票。记录结果与反向代理配置到 `docs/superpowers/plans/10.21-plans/2026-10-21-l1-object-storage-results.md`。
- [ ] 同时 3–5 路播放时记录服务端 CPU 与出口带宽(只记实测数字,不推算)。
- [ ] 管理端精选库试听、评测录音回放、房间语音回放、头像显示各一次。

**B. 厂商冒烟(每个要切换到的厂商一次)**
- [ ] 用目标厂商的测试桶跑 `uv run pytest -q tests/test_storage_s3.py` 的「真实端点」变体(Task 3 预留 `S3_LIVE=1` 环境变量开关,默认跳过;**不进 CI、不提交任何凭据**)。
- [ ] `python -m app.storage.migrate --from s3_fallback --to s3 --dry-run` 与 `--verify-only` 各一次;确认 sha256 元数据可写可读、`delete_prefix` 可用。

**C. 真实迁移演练(先在副本数据上)**
- [ ] 复制一份生产数据卷到测试机;按 README 迁移步骤 ①–⑧ 走一遍;记录对象数、字节数、耗时、失败码;`--reconcile-only` 两类差异的计数;回滚演练(改回 `local`)。
- [ ] 确认迁移前备份文件存在且可在管理端列出、下载。

**D. bundle 开发 → 生产**
- [ ] 开发环境导出一条目录 bundle;`mc mirror` 两个前缀到另一个桶;另一套实例导入;确认句子、译文、播放正常,且没有产生识别 / 大模型计量记录。
