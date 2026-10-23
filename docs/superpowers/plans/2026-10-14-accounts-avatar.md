# 账号体系 v2 · 头像(P3)Implementation Plan

> **执行前先读 `docs/superpowers/plans/2026-10-14-accounts-INDEX.md`:合并顺序、迁移链与跨计划裁决以它为准。与 INDEX 冲突以 INDEX 为准。**

> **For agentic workers:** 一个任务一个逻辑提交;先写失败测试再实现;每个任务只跑列出的定向测试。步骤用 `- [ ]`,合并且测试通过后才勾。

- 日期:2026-10-14 · 状态:未开始(前置:`2026-10-14-accounts-foundation-email.md` 全部合并)
- Spec:`docs/superpowers/specs/2026-10-14-accounts-email-invites-design.md` §5、§7
- INDEX:`docs/superpowers/plans/2026-10-14-accounts-INDEX.md`(X16 Pillow、X17 相对 URL、X29 WS 载荷)
- 迁移:`0023_accounts_avatar`(Task 0 核对 head 为 `0022`)

**Goal:** 登录用户上传头像(`POST /api/me/avatar`,≤ 2 MB,JPEG / PNG / WebP,服务端用 Pillow 重新编码为 256×256 WebP、去元数据、防解压炸弹),存 `DATA_DIR/avatars/<128 位随机 id>.webp`,`GET /api/avatars/{id}` 免鉴权、不可猜、强缓存;「我的」页与房间成员 / 消息显示头像;成员举报头像、管理端一键移除(审计)、`AVATAR_UPLOAD_ENABLED` 总开关。房间 WS 载荷新增 `avatar_url`(只增不改,夹具重录单独一个任务)。

**Architecture:** 纯处理函数在 `services/avatars.py`(Pillow,线程中运行);存储路径与原子写在同一模块;HTTP 在新的 `routers/avatars.py`(上传 / 删除自己的、公开读取、举报);管理逻辑 `admin/avatars_admin.py`,路由 `routers/admin_avatars.py`。房间:`rooms/store.py` 的成员与消息查询多取 `User.avatar_id`,`connection.members_out` 与 `store.message_out` 输出 `avatar_url`。网页:`components/avatar.tsx` 加 `src`,`features/account` 加头像设置,`features/rooms` 只改协议类型与两个显示处。

**Tech Stack:** 新依赖 **Pillow**(`uv add pillow`,X16);其余同 F 计划。

## Global Constraints

- 同 F 计划的隐私、设置、迁移、路由、分层、网页文案与提交规则。额外:**头像文件名是唯一的标识**,不进日志(它是能拿到图片的不可猜凭据);日志只写事件与字节数。
- **协议只增不改**:`PROTOCOL_VERSION` 仍为 2;旧客户端忽略未知字段(`camelcaseKeys` 深转换后多一个键)。
- **`room-page.tsx` 不改**(冻结,`web/src/features/rooms/CLAUDE.md`);只改 `protocol.ts`、`room-message-list.tsx`、`room-settings-sheet.tsx`。
- 主包预算 ≤ 0.4 kB gzip(X25);头像设置走 `features/account` 懒加载块。

## 文件结构

```
server/
  pyproject.toml、uv.lock                         + pillow(S1)
  alembic/versions/0023_accounts_avatar.py        新(S2)
  app/models.py                                   User.avatar_id;AvatarReport(S2)
  app/core/config.py、settings_registry.py、.env.example   avatar_upload_enabled(S3)
  app/services/avatars.py                         新:process()、store()、remove()、avatar_url()(S1、S3)
  app/routers/avatars.py                          新:POST/DELETE /api/me/avatar、GET /api/avatars/{id}、POST /api/avatar-reports(S4–S6)
  app/routers/sessions.py                         /api/me + avatar_url(S4)
  app/admin/avatars_admin.py、app/routers/admin_avatars.py   新(S7)
  app/admin/users_admin.py                        USER_ROWS + AvatarReport;删除用户时删文件(S7)
  app/rooms/store.py、connection.py、protocol.py(仅文档)   avatar_url(S8)
  app/main.py                                     avatars、admin_avatars 路由(S4、S7)
  tests/test_avatars_*.py、tests/fixtures/rooms_*_contract.json(S9 重录)
web/src/
  components/avatar.tsx                           + src、onError 回落(W1)
  api/client.ts、api/types.ts                     uploadAvatar、deleteAvatar、reportAvatar;UserProfile.avatarUrl(W1)
  features/account/avatar-picker.tsx、resize-image.ts(新)、account-section.tsx、i18n/*   W1、W2
  features/rooms/protocol.ts、room-message-list.tsx、room-settings-sheet.tsx、rooms-api.ts、i18n/*   W3
admin/src/features/users/                         avatar-reports-page.tsx(新)、user-detail 移除按钮(A1)
```

## 车道与合并顺序

S1 → S2 → … → S9;W1(可与 S1 并行,fetch 模拟)→ W2(S4 后)→ W3(S8 后;契约测试在 S9 后)→ W4;A1(S7 后);Z1 最后。

**评审波**:S 车道合并前 `security-review`(重点:解码器攻击面、路径遍历、未鉴权读取、存储滥用、举报滥用);W 车道合并前浏览器窗格 375×812 浅色 + 深色:上传、换、删、房间成员与消息、举报。

## 本计划的裁定(Ruling)

- **R-V1 处理流程**(`services/avatars.process(data: bytes) -> bytes`,在 `asyncio.to_thread` 里跑):① `len(data) <= 2 MiB`,否则 `AvatarError("too_large")`;② 嗅探魔数只接受 JPEG / PNG / WebP(不信任 `Content-Type` 与文件名);③ `Image.open` 后检查 `img.format ∈ {"JPEG","PNG","WEBP"}`、`width * height <= 20_000_000` 且每边 ≤ 8000(在 `load()` 之前,防解压炸弹;同时把 `Image.MAX_IMAGE_PIXELS` 设为同一上限,捕获 `DecompressionBombError` / `DecompressionBombWarning`(用 `warnings.catch_warnings` 升级为错误));④ 动画只取第一帧;⑤ `ImageOps.exif_transpose`、转 `RGB` / `RGBA`;⑥ 居中裁成正方形、`resize((256,256), LANCZOS)`;⑦ 新建一张图再 `save(format="WEBP", quality=82, method=4)`——不带 `exif`、`icc_profile`、`xmp`。任何 `PIL.UnidentifiedImageError` / `OSError` / `ValueError` → `AvatarError("invalid_image")`。
- **R-V2 存储**:`DATA_DIR/avatars/<secrets.token_hex(16)>.webp`;先写 `<id>.webp.tmp` 再 `os.replace`;数据库提交成功后删旧文件,提交失败删新文件(spec「换头像 = 换 id,旧文件在提交后删除」)。`avatar_id` 在 URL 里只接受 `^[0-9a-f]{32}$`(路径参数正则),拼路径前再校验一次,杜绝路径遍历。崩溃窗口留下的孤儿文件本期不扫(列入后续)。
- **R-V3 总开关 `AVATAR_UPLOAD_ENABLED`**(热改,默认 `true`):关 → 上传 `403 {"error":"Avatar upload is disabled"}`、读取 404;已存文件与 `users.avatar_id` 保留,载荷里的 `avatar_url` 照常输出(网页加载失败回落首字);重新打开即恢复。删除自己的头像在关闭时仍允许。
- **R-V4 读取端点**:`GET /api/avatars/{avatar_id}` 不鉴权(`<img>` 带不了 Bearer);`Content-Type: image/webp`、`X-Content-Type-Options: nosniff`、`Cache-Control: public, max-age=31536000, immutable`、`Content-Security-Policy: default-src 'none'`;只认 `users.avatar_id` 里存在的 id(查一次索引,删除 / 移除后立即 404,即使文件因并发尚未删)。用 `FileResponse`。
- **R-V5 上传端点**:`multipart/form-data`,字段 `file`;读入时按块累计,超过 2 MiB 立即 413(`BodyLimitMiddleware` 放过 multipart,已核对 `core/bodylimit.py`);每用户每小时 10 次(进程内 `RateLimiter`);依赖 `current_user`(受强制绑定约束)。返回 `{"avatar_url": "/api/avatars/<id>"}`。
- **R-V6 举报**:`POST /api/avatar-reports {user_id, reason}`;举报人必须与被举报者**现在或曾经同在一个房间**(`room_members` 自连接;否则 404 `User not found`,不区分「不存在」与「无权」);被举报者必须当前有头像;同一举报人对同一 `avatar_id` 只记一次(唯一约束,重复返回 200);每用户每天 20 次;`reason ∈ {"inappropriate","impersonation","other"}`(不收自由文本,避免又一个 UGC 入口)。
- **R-V7 管理端移除**:`DELETE /api/admin/users/{id}/avatar`(operator,`ReasonIn`),同一事务清 `avatar_id`、把该 `avatar_id` 的举报置 `resolved_at` 并写审计 `user.avatar.remove`(`summary` 用户名,`after={"removed": true}`,不含 id);提交后删文件。`GET /api/admin/avatar-reports?status=open|resolved`(viewer)返回被举报用户 id / 用户名 / 昵称 / 头像 URL / 举报数 / 最近原因;`POST /api/admin/avatar-reports/{user_id}/dismiss`(operator,审计 `user.avatar.dismiss`)。管理员在管理端看头像用同一个公开 URL(管理端同源)。
- **R-V8 房间载荷**(X29):`members_out` 每项 `avatar_url`;`message_out(..., avatar_id=None)` 的 `sender.avatar_url`(用户消息有,系统 / AI 为 `null`);WS 连接在建立时取一次自己的 `(display_name, avatar_id)`,会话中换头像要重连后才体现在新消息上,历史与成员列表是实时查询的。入房申请(`request_out`)也加 `avatar_url`(房主审批时看得到)。
- **R-V9 网页客户端缩放**:选图后用 `<canvas>` 缩到长边 ≤ 1024、导出 JPEG 0.9 再上传(大图与 iOS HEIC 经浏览器解码后变 JPEG;**真机未验证**);缩放失败就原文件直传,交给服务端判定。
- **R-V10 删除用户**:`users_admin.delete_user` 在提交后删除头像文件;`avatar_reports` 两列(`reporter_id`、`avatar_user_id`)都 `ON DELETE CASCADE` 并进 `USER_ROWS`。

---

## Task 0:核对事实

- [ ] **Step 1**:

| # | 事项 | 方法 | 预期 | 不符时 |
|---|---|---|---|---|
| 1 | 迁移头 | `uv run alembic heads` | `0022` | 顺延编号并改 INDEX §3 |
| 2 | Pillow 不在依赖里 | `server/pyproject.toml` | 不在(写计划时已核对) | 已在则跳过 S1 的 `uv add` |
| 3 | Docker 能装 Pillow 轮子 | 读 `server/Dockerfile`(写计划时:`python:3.12-slim`,构建阶段 `uv sync`) | manylinux 轮子,无需系统库 | 若构建阶段禁网 / 无轮子:停下报告 |
| 4 | 数据目录 | `Settings.resolved_data_dir` | `DATA_DIR` 或默认目录 | — |
| 5 | 备份范围 | `admin/backups.create_backup` | 只做 SQLite `VACUUM INTO`,不含文件目录 | 写进 Z1 文档:`avatars/` 需要另行备份 |
| 6 | multipart 体积 | `core/bodylimit.py` | multipart 不受 1 MiB 限制,需在端点内自限 | — |
| 7 | 房间成员 / 消息序列化的唯一入口 | `rooms/connection.members_out`、`rooms/store.message_out`、`store._select`、`store.members`、`_requests_out` | 如上 | 多出的入口一并加 |
| 8 | 记录房间夹具的测试 | `Grep "rooms_.*contract.json" server/tests` | `test_web_contract.py`、`test_rooms_v2_core_contract.py`、`test_rooms_v2_voice_contract.py`、`test_rooms_reopen_contract.py`、`test_rooms_agents_contract.py`、`test_rooms_summary_api.py` | 照实列入 S9 |
| 9 | 网页读这些夹具的测试 | `Grep "contract.json" web/src/features/rooms` | `rooms-contract`、`create/rooms-v2-contract`、`voice/voice-contract`、`extras/extras-contract`、`rooms-reopen-contract`、`agents/room-agents-contract` | 同上 |
| 10 | 网页成员与消息的头像位置 | `room-settings-sheet.tsx`(成员组用 `Avatar`)、`room-message-list.tsx` | 都用 `components/avatar` | — |

- [ ] **Step 2** 提交:`docs: accounts avatar plan task 0 findings`。

### Task S1:Pillow 依赖与处理函数

**Files:** Modify `server/pyproject.toml`、`server/uv.lock`(`uv add pillow`);Create `server/app/services/avatars.py`(先只有 `process` 与 `AvatarError`)、`server/tests/test_avatars_process.py`。

- [ ] **先写失败测试**(测试里用 Pillow 现场生成图片,不提交二进制夹具):
  - PNG / JPEG / WebP 输入 → 输出以 `RIFF....WEBP` 开头,`Image.open(out).size == (256, 256)`。
  - 横图 / 竖图居中裁剪(在左上角画红块,输出左上角不是红色……用确定的色块断言裁剪中心)。
  - EXIF 被去掉:带 `Orientation=6` 与 GPS 的 JPEG → 输出 `getexif()` 为空且方向已转正。
  - 拒绝:GIF、BMP、SVG 文本、随机字节、截断的 PNG、`> 2 MiB`、`9000×10` 尺寸、像素超过 2000 万(构造一个声明巨大尺寸的 PNG 头,断言在 `load()` 前被拒、耗时 < 1 秒)。
  - 动画 WebP 只取第一帧。
- [ ] **测试**:`cd server && uv sync && uv run pytest -q tests/test_avatars_process.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): avatar image processing with Pillow (re-encode, strip metadata, size limits)`

### Task S2:迁移 0023

**Files:** Create `server/alembic/versions/0023_accounts_avatar.py`、`server/tests/test_avatars_models.py`;Modify `server/app/models.py`、`server/app/admin/users_admin.py`(`USER_ROWS` + `(AvatarReport, "reporter_id")`、`(AvatarReport, "avatar_user_id")`)、head 钉子、`server/app/CLAUDE.md`。

- [ ] **先写失败测试**:head `0023`、往返;`users.avatar_id` 唯一;`avatar_reports` 唯一约束 `(reporter_id, avatar_id)`;删除用户后两种身份的举报行都没了。
- [ ] **实现**:`User.avatar_id: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)`(batch 加列 + 唯一索引 `uq_users_avatar_id`);`AvatarReport`:`id`、`avatar_user_id` FK CASCADE + index、`avatar_id String(32)`、`reporter_id` FK CASCADE、`reason String(16)`、`created_at`、`resolved_at` 可空;`UniqueConstraint("reporter_id", "avatar_id")`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_avatars_models.py tests/test_migrations.py tests/test_library_models.py tests/test_changelog_models.py tests/test_accounts_models.py tests/test_admin_users.py`
- [ ] **提交**:`feat(server): avatar columns, reports table and migration 0023`

### Task S3:开关与存储

**Files:** Modify `server/app/core/config.py`、`settings_registry.py`(组 `accounts` 末尾 `_s("avatar_upload_enabled", "accounts", "bool", "允许上传头像", danger=...)`)、`server/.env.example`、`server/app/services/avatars.py`(`store(settings, data) -> id`、`remove(settings, id)`、`path_for(settings, id)`、`avatar_url(id) -> str | None`)、`server/tests/test_avatars_storage.py`。

- [ ] **先写失败测试**:`store` 写到 `<data_dir>/avatars/<32 hex>.webp`,没有 `.tmp` 残留;`path_for` 对 `"../x"`、大写、31 位都抛 `ValueError`;`remove` 不存在的文件不抛;`avatar_url(None) is None`;设置 spec 存在且是 `hot`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_avatars_storage.py tests/test_settings_registry.py`
- [ ] **提交**:`feat(server): avatar storage and the upload switch`

### Task S4:上传 / 删除自己的头像、`/api/me` 字段

**Files:** Create `server/app/routers/avatars.py`、`server/tests/test_avatars_api.py`;Modify `server/app/main.py`(`avatars` 在 `account` 之后)、`server/app/routers/sessions.py`(`UserOut.avatar_url`)。

- [ ] **先写失败测试**:
  - 上传 PNG → 200 `{"avatar_url"}`;`GET /api/me` 的 `avatar_url` 相同;文件存在。
  - 再上传 → 新 id;旧文件已删;旧 URL 404。
  - `DELETE /api/me/avatar` → 204;文件删;`avatar_url` 缺省。
  - 413(> 2 MiB)、422(非图片,`{"error":"Invalid image"}`)、403(开关关)、429(第 11 次 / 小时)、401(无 token)、403 `email_binding_required`(强制状态,未绑定)。
  - 数据库提交失败(monkeypatch `session.commit` 抛)→ 新文件被删、旧头像不变。
  - `caplog`:不含 avatar id、文件路径。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_avatars_api.py tests/test_auth.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): upload, replace and remove your avatar`

### Task S5:公开读取端点

**Files:** Modify `server/app/routers/avatars.py`;Modify `server/tests/test_avatars_api.py`。

- [ ] **先写失败测试**:无 token 也 200;响应头(R-V4)逐项断言;不存在 / 被移除 / 开关关 → 404 且体为 `{"error":"Not Found"}`;`/api/avatars/../../etc/passwd`、大写 id → 404/422(路径正则);路由在 `stubs` 之前(否则 stubs 的 `GET` 兜底先返回 404 也会「通过」——所以用 200 用例证明顺序)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_avatars_api.py`
- [ ] **提交**:`feat(server): serve avatars by unguessable id with immutable caching`

### Task S6:举报

**Files:** Modify `server/app/routers/avatars.py`;Create `server/tests/test_avatars_reports.py`。

- [ ] **先写失败测试**:同房间成员可举报(201 / 重复 200 且只一行);没同过房间 → 404;被举报者无头像 → 404;`reason` 不在枚举 → 422;每日 20 次;被举报者换头像后可以再次被同一人举报(新 `avatar_id`);`caplog` 不含 avatar id。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_avatars_reports.py`
- [ ] **提交**:`feat(server): room members can report an avatar`

### Task S7:管理端移除与举报列表、删除用户删文件

**Files:** Create `server/app/admin/avatars_admin.py`、`server/app/routers/admin_avatars.py`、`server/tests/test_admin_avatars.py`;Modify `server/app/main.py`(`admin_avatars` 在 `admin_changelog` 之后、`stubs` 之前)、`server/app/admin/users_admin.py::delete_user`、`server/tests/test_admin_users.py`、`server/app/admin/service.py`(用户详情加 `avatar_url`)。

- [ ] **先写失败测试**:R-V7 三个端点的角色(`test_admin_routes_guarded.py`)、审计行(同事务、不含 id)、移除后公开 URL 404、举报列表聚合正确;删除用户后文件不在。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_admin_avatars.py tests/test_admin_users.py tests/test_admin_routes_guarded.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): admin removes reported avatars with audit`

### Task S8:房间载荷加 `avatar_url`

**Files:** Modify `server/app/rooms/store.py`(`MemberView` 加 `avatar_id`;`members`、`_select`、`_requests_out`、`message_out`、`request_out`)、`server/app/rooms/connection.py`(`members_out`;连接持有自己的 `avatar_id`)、`server/app/routers/rooms.py`(建立连接处取 `(name, avatar_id)`)、`server/app/rooms/protocol.py`(模块文档一句)、`server/app/rooms/CLAUDE.md`;Create `server/tests/test_rooms_avatars.py`。

- [ ] **先写失败测试**:welcome / presence / REST 房间详情的成员带 `avatar_url`(有头像为路径、无为 `null`);历史与实时消息的 `sender.avatar_url`;AI 与系统消息为 `null`;入房申请带 `avatar_url`;已有字段与顺序不变(用现有房间测试全绿证明)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_rooms_avatars.py tests/test_rooms_api.py tests/test_rooms_ws.py tests/test_rooms_store.py tests/test_rooms_store_v2.py tests/test_architecture.py`。契约测试此时会因多出的键失败,这是预期的:**S8 与 S9 在同一车道连续合并,中间不得部署**;S8 的定向测试不含契约测试。
- [ ] **提交**:`feat(server): rooms payloads carry avatar_url (additive)`

### Task S9:重录房间契约夹具

**Files:** Modify `server/tests/fixtures/rooms_contract.json`、`rooms_v2_core_contract.json`、`rooms_v2_voice_contract.json`、`rooms_v2_summary_contract.json`、`rooms_reopen_contract.json`、`rooms_agents_contract.json`(以 Task 0 第 8 项的实际清单为准);Modify 网页 `web/src/features/rooms/protocol.ts`(`RoomMemberInfo.avatarUrl?`、`RoomSender.avatarUrl?`、`JoinRequestInfo.avatarUrl?`)及受影响的网页契约测试。

- [ ] **Step 1**:`cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_web_contract.py tests/test_rooms_v2_core_contract.py tests/test_rooms_v2_voice_contract.py tests/test_rooms_reopen_contract.py tests/test_rooms_agents_contract.py tests/test_rooms_summary_api.py`
- [ ] **Step 2**:`git diff --stat server/tests/fixtures` 与逐文件 diff:**只允许新增 `avatar_url` 键**(值为 `null` 或 `/api/avatars/` + 32 位十六进制;录制时把 id 固定为 32 个 `0`)。任何别的变化:停下排查。
- [ ] **Step 3**:去掉 `CONTRACT_UPDATE` 再跑一遍上面的命令;网页 `cd web && yarn typecheck && yarn vitest run src/features/rooms`。
- [ ] **提交**:`test: re-record rooms contracts with avatar_url`

### Task W1:头像组件与 API

**Files:** Modify `web/src/components/avatar.tsx`(可选 `src`;`<img alt="" loading="lazy" decoding="async">`,`onError` 回落首字;`role="img"`/`aria-label` 保持在外层)、`web/src/api/client.ts`、`web/src/api/types.ts`;Create `web/src/features/account/resize-image.ts` + 测试;`web/src/components/primitives.test.tsx`(或新的 `avatar.test.tsx`)。

- [ ] **先写失败测试**:有 `src` 渲染图片;图片 `error` 事件后显示首字;无 `src` 与今天一致(快照不变的那部分断言);`uploadAvatar(blob)` 发 multipart 字段 `file`;`resizeImage` 在 jsdom 下对 canvas 不可用时返回原文件(R-V9 的回退)。
- [ ] **测试**:`cd web && yarn vitest run src/components src/api src/features/account`
- [ ] **提交**:`feat(web): avatar component shows an image with an initial fallback`

### Task W2:「我的」页头像设置

**Files:** Create `web/src/features/account/avatar-picker.tsx` + 测试;Modify `account-section.tsx`、`i18n/*`、`web/src/pages/me-page.tsx`(资料卡的 `Avatar` 传 `src`,一行)。

- [ ] **先写失败测试**:选择文件 → 缩放 → 上传 → 头像更新;403(关闭)显示「管理员暂时关闭了头像上传」并隐藏按钮;413 / 422 本地化提示;「移除头像」二次确认;上传中禁用按钮。
- [ ] **测试**:`cd web && yarn typecheck && yarn vitest run src/features/account src/pages`
- [ ] **提交**:`feat(web): set or remove your avatar on the me page`

### Task W3:房间里的头像与举报

**Files:** Modify `web/src/features/rooms/room-message-list.tsx`、`room-settings-sheet.tsx`(成员行:头像 + 「举报头像」菜单项,仅对有头像的他人)、`rooms-api.ts`(`reportAvatar`)、`create/join-requests.tsx`、`web/src/features/rooms/i18n/*`(`web.rooms.avatarReport.*`)及测试。

- [ ] **先写失败测试**:成员与消息传入 `avatarUrl` 时渲染图片、`null` 时首字;举报弹层三选一原因,提交后提示「已收到,管理员会处理」,重复举报同样提示;自己没有举报入口。
- [ ] **测试**:`cd web && yarn typecheck && yarn vitest run src/features/rooms src/architecture.test.ts`
- [ ] **提交**:`feat(web): avatars in rooms and reporting an avatar`

### Task W4:文案、360 px、主包

- [ ] 中英键对齐(`src/i18n/i18n.test.ts`);浏览器窗格 360×740 / 375×812 英文检查「我的」头像区与举报弹层(标「模拟」);`yarn web:build && node web/scripts/check-main-bundle.mjs --max-delta=0.4`,数字写 PR 描述。
- [ ] **测试**:`cd web && yarn vitest run src/i18n src/build`
- [ ] **提交**:`chore(web): avatar strings review and bundle check`

### Task A1:管理端网页

**Files:** Create `admin/src/features/users/avatar-reports-page.tsx` + 测试;Modify `admin/src/features/users/{api.ts,strings.ts,index.ts}`、`admin/src/app.tsx`(路由 `avatar-reports`)、`admin/src/components/layout.tsx`(导航项,`min: "viewer"`)、`admin/src/pages/user-detail-page.tsx`(头像 + 「移除头像」)。

- [ ] **先写失败测试**:列表显示头像缩略图、举报数、原因;「移除」要求原因、成功后从列表消失;「忽略」;viewer 看不到按钮(`RoleGate`)。
- [ ] **测试**:`cd admin && yarn typecheck && yarn vitest run src/features/users src/pages src/app.test.tsx`
- [ ] **提交**:`feat(admin): avatar reports page and remove avatar action`

### Task Z1:隐私、文档、验收

**Files:** Create `server/tests/test_avatars_privacy.py`;Modify `server/README.md`(`DATA_DIR/avatars/` 需要另行备份;内置备份只含 SQLite 数据库)、`server/app/{CLAUDE.md,services/CLAUDE.md,routers/CLAUDE.md,admin/CLAUDE.md,rooms/CLAUDE.md}`、`web/src/features/account/CLAUDE.md`、`web/README.md`(头像在真机上未验证)。

- [ ] **先写失败测试**:完整流程(上传 → 房间里显示 → 举报 → 管理员移除 → 删除用户)全程 `caplog`(`app`,DEBUG)与审计全部行不含 avatar id、文件路径、举报人以外的用户文本。
- [ ] 跑本计划全部定向测试 + 两个架构测试;本文件末尾追加「执行结果」。
- [ ] **提交**:`docs: avatar notes and privacy sweep`

## 未验证(本计划范围)

真机上的选图(含 HEIC)、客户端缩放、头像渲染与缓存;Postgres 上的 `0023`;经反向代理的 `Cache-Control` / `nosniff` 是否被改写;Pillow 在生产镜像里的实际安装(只在本地 `uv sync` 过);头像内容安全(无自动审核)。

## 后续(本期不做)

孤儿头像文件扫描(崩溃窗口);自动内容审核;桌面端显示头像(需要绝对 URL,X17)。

## 执行结果(Z1 服务端,2026-10-19,分支 feat/av-s)

**提交**:`8f0c2269 test(server): avatar privacy sweep`;docs 提交见 `git log`(`docs(server): avatars — setup, limits and results`)。

**定向测试**(`cd server && .venv\Scripts\python.exe -m pytest -q tests/test_avatars_*.py tests/test_admin_avatars.py tests/test_rooms_avatars.py tests/test_web_contract.py tests/test_rooms_*contract*.py tests/test_architecture.py tests/test_admin_routes_guarded.py tests/test_migrations.py tests/test_admin_users.py tests/test_settings_registry.py`):**148 passed,0 failed**(67 s)。其中 `tests/test_avatars_privacy_sweep.py` 2 passed(全流程隐私扫描 + 头像路由只含 `avatar_id` / `user_id` 路径参数)。没有跑全量套件,没有跑网页测试。

**偏差**:隐私测试文件名为 `test_avatars_privacy_sweep.py`(对齐 `test_accounts_privacy_sweep.py`,计划写的是 `test_avatars_privacy.py`)。扫描结果未发现真实泄露,没有 xfail。两个有意的例外写在测试模块文档里:管理端移除头像的原因会进审计行(操作者自己的备注,设计如此);`user.delete` 审计的 summary 是被删账号的用户名(既有行为,不属于头像改动)。举报原因是固定枚举,不作「独特值」检查。

**未验证**:Postgres;多 worker(限流、头像上传配额都在进程内);真机选图与 HEIC;Docker 镜像里的 Pillow 安装(只在本地 `uv sync` 过);内容审核(没有:只有举报、管理员移除与总开关)。

**已知限制**:
- 头像读取带 `public, max-age=31536000, immutable`,被移除的头像可能在浏览器或代理缓存里残留,直到用户的头像 id 变化。
- 崩溃遗留的临时文件与未被引用的头像文件不做清扫(计划「后续」)。
- 开关关闭时读取返回 404,已有头像保留;删除自己的头像仍允许。
- 举报只限现在或曾经同过房间的成员,且每人每张头像只记一次。
