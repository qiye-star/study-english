# app/admin/

Admin console business logic behind `/api/admin/*` (routers `admin.py` v1 read-only, `admin_auth.py`,
`admin_*.py` v2). **No longer read-only:** every write goes through `perms.require(...)` (+ step-up for dangerous
actions) and writes an audit row in the same transaction. Spec: `docs/superpowers/specs/2026-10-09-admin-console-v2-design.md`.
Disabled (404 everywhere) unless `ADMIN_USERNAME` and `ADMIN_PASSWORD` (>= 12 chars) are set, or when the
client IP is outside `ADMIN_IP_ALLOWLIST`.

## What lives here
- `perms.py` – `require_enabled` (+ IP allowlist), `current_admin` (cookie session, MFA, CSRF/Origin, denials audited
  as `auth.denied` via `deny`,
  `ADMIN_REQUIRE_TOTP` gate), `require(role)`, `require_step_up` / `require_operator_step_up` /
  `require_self_step_up`, `AdminContext`, `REQUIRED_ROLE_ATTR`
- `sessions.py` – DB sessions (`admin_sessions`): token/CSRF stored as SHA-256 only, idle + absolute
  expiry, `__Host-enjoy_admin` (or `enjoy_admin` when `ADMIN_COOKIE_SECURE=false`) HttpOnly SameSite=Strict
- `accounts.py` – env emergency superadmin + DB accounts (argon2), `authenticate`, `check_password`,
  `totp_secret`, recovery codes
- `audit.py` – append-only `admin_audit` with a SHA-256 hash chain: `record`, `verify`, `listing`,
  `redact_setting`, `Actor`, `CLI_ACTOR`
- `lockout.py` – per (username, IP) lockout doubling to 24 h; per-username global count only alarms
- `totp.py` – RFC 6238 TOTP (stdlib) and recovery codes
- `recover.py` – `python -m app.admin.recover list-overrides|clear-overrides|unlock|reset-totp|revoke-sessions|rotate-key`
- `auth.py` – env credential comparison (`credentials_match`)
- `settings_service.py` – runtime settings: `list_settings`, `save` (danger/step-up/typed confirm, key-pair guard on
  every key-bearing endpoint: `url` settings and `HOST_FORMING` ones such as `azure_speech_region`, compared as
  (scheme, host, port),
  revisions, publish through the hub; the **only** settings write path, also used by `announcements.set_maintenance`
  and import/revert), `revert`, export/import; the six `managed_by="rank_rules"` keys are read-only (409
  `Managed by rank rules`) once a rank rules version is published
- `doctor.py` – config doctor findings (`diagnose(settings, Facts)` pure + `gather_facts`; includes
  `missing_prices` from `usage.missing_prices`, `invite_without_codes`, `wordbook_data_missing`, `wordbook_ai_unavailable`,
  `agents_unavailable` / `agents_native_unverified`, `links_breaker_open` / `links_dropping` read from `app.state.learning_bus` without importing `app.links`; 跟读库 `library_ffmpeg_missing` / `library_ytdlp_missing` / `library_asr_unavailable` / `library_cookies_missing` / `library_link_proxy_missing` (info) / `library_link_dns_private` (warn: while link import is on and no `LIBRARY_YTDLP_PROXY`, `gather_facts` resolves only `www.youtube.com` with `urlcheck.system_resolve`, 5 s, via `doctor.dns_state`; never a user link, never the proxy value), only while `LIBRARY_ENABLED`, cookies permissions checked on POSIX only, messages never include the path)
- `probes.py` – "test connection" per upstream (`UPSTREAMS`), SSRF-guarded (one DNS lookup, every address must be
  `is_global`, the connection is pinned to it; no HTTP or WebSocket redirects), returns only `{ok, status, ms, code}`.
  Probing unsaved values that would send the saved key to a new endpoint needs step-up + `confirm_pairs`
- `rank_rules_admin.py` / `rank_ops.py` / `rank_sim.py` – rank rules drafts/validate/publish (bumps
  `config_revisions['rank_rules']`), per-user and site-wide rank operations (reset with undo), impact simulation.
  Resets, point cuts and undo void the affected users' open matches (409 `Match is busy` mid-request); bulk ops hold
  every affected user's `ledger.user_lock` across the commit; batch ids are `all-…` (site-wide, the overview's undo)
  or `usr-…`; undo skips users reset again later; snapshots are purged after `UNDO_DAYS` by `purge_expired`
- `prompts_admin.py` – prompt drafts/publish/test run (bodies never logged or audited); room templates render through
  `rooms.assistant.render_test`, same as live
- `service.py` – v1 cross-user read queries (overview, users with `status`/`sort`, conversations, assessments, ...)
- `users_admin.py` – disable/enable, revoke tokens, reset password (temp password returned once, never logged),
  delete user (explicit deletes: SQLite has no FK cascade; rank snapshots deleted, metering rows anonymised to the
  system user; owned rooms pass to the earliest other member, a room
  nobody else joined is kept closed with `owner_id = NULL` — rooms and room messages are never deleted),
  per-user quota overrides (`quota.set|clear`; above `operator_ceiling` = 10x the site value only superadmin + step-up)
- `invites.py` – multi-use invite codes (SHA-256 only; plain code returned once); consumption in `services/invites.py`
- `rooms_admin.py` – room/report queries and `report.resolve`; live actions (close/kick/hide/AI mute) are in
  `routers/admin_rooms.py`
- `wordbook_admin.py` – word books (spec 2026-10-10-wordbook §9): `overview` (enabled books: file bytes + sha256 vs
  `SOURCE.json`, cached by size/mtime; index state; learners / 7-day / learned / mastered / open reports; AI calls today),
  `reload` (`wordbook.reload`), `reports` (open reports grouped per sentence, text read from the dictionary),
  `resolve` hide/dismiss (`wordbook.sentence.hide` / `wordbook.report.dismiss`; hide refreshes the live hidden set).
  Never returns user input, explanation bodies or absolute paths
- `agents_admin.py` – 智能体(spec 2026-10-12-agents §10.2):`overview`(数字)、`personas`(查询,含人设原文仅供审核)、`set_disabled` / `edit` / `remove` / `resolve`(审计 `agents.*`,只记 id、字段名与计数)、`probe_tools`(先调上游再审计;结果存 `app.state.agents_tools_probe`)。管理员不能读任何记忆内容
- `library_admin.py` – 跟读库(spec 2026-10-13-video-import §12、E10;plan `2026-10-13-video-import-admin.md`):`overview`(开关、计数、
  队列、今日识别分钟、AI 译文 / 分析开关与今日句数(只读 `daily_usage`,D8)、ffmpeg / yt-dlp 版本、cookies / 代理只给布尔值)、`items`(分页 + 状态 / 所有者 / 种类筛选)、`top_users`、
  `user_usage`;**只选数字、状态、种类、阶段与来源主机名,永不选 title / source_url / 路径,不读 `library_segments`(句子、译文 zh、分析 analysis 都是内容)**。`delete_item` / `cancel_item` /
  `purge_failed`(操作员 + 输入确认 `DELETE <id 前 8 位>` / `PURGE <n> ITEMS`,不需要 step-up)只经 `_s1_delete` / `_s1_cancel` 调
  `app.library.store`,审计在 S1 调用之后(`library.item.delete {bytes}`、`library.item.cancel`、`library.purge_failed {count, bytes}`,
  summary 留空)。新增 `/api/admin/library*` 路由要同时改 `tests/test_admin_library.py::test_admin_library_urls_carry_only_ids`
- `catalog_admin.py` – 精选库(spec 2026-10-14-curated-library):导入(链接 / 分片上传 + 字幕)、状态与列表、详情(含句子:目录是系统内容,R5)、元数据、发布 / 下架、重试 / 取消 / 补全译文、替换媒体(`POST /{id}/replace-media`,未发布 + 就绪 + 有句子;复用分片上传;审计 `catalog.replace_media`)、逐句编辑(未发布时)、删除(无副本即删,有副本则退役)与强制删除(superadmin + step-up,连同所有副本);审计只记 id、动作与数字。路由 `routers/admin_catalog.py`,任务 `app.state.catalog`(`library/catalog_jobs.py`)
- `usage.py` – usage/estimated cost from `upstream_calls` (+ older `usage_daily`): `parse_prices`, `estimate`,
  `summary`, `top_users`, `health`, `missing_prices` (for the config doctor)
- `announcements.py` – announcements (create/update/archive, public `active`) and `set_maintenance` (a thin wrapper
  over `settings_service.save(action="maintenance.set")`; turning it on = step-up + reason + typed `MAINTENANCE_MODE`)
- `avatars_admin.py` – avatar moderation: `reports` (viewer; `open` = unresolved reports on the user's current avatar, `resolved` = handled; one row per user with count, last reason and time), `remove` (operator + step-up; clears `avatar_id`, resolves that avatar's reports, audit `user.avatar.remove` with `after={removed, reports}` and the operator's reason, then deletes the file after the commit), `dismiss` (operator; keeps the avatar, audit `user.avatar.dismiss`, 404 `No open reports`). Audit rows carry user ids, actions and counts, never avatar ids, file names or paths. Routes in `routers/admin_avatars.py`; tests `tests/test_admin_avatars.py` and `tests/test_avatars_privacy_sweep.py`
- `changelog.py` – 更新日志(spec 2026-10-14-changelog-design;plan `2026-10-14-changelog.md`):用户侧 `public_page`(已发布、按 `entry_date` 倒序、游标 `YYYY-MM-DD.<id>`、`unread` / `latest_id` / 逐条 `is_new`)与 `mark_seen`(已读位置只前进、夹到最大已发布 id、新用户首次最多 `FIRST_VISIT_UNREAD = 3` 条未读);管理侧 `validate`(逐键、错误只回字段名)、`admin_listing`、`create` / `edit` / `publish` / `unpublish` / `remove`(软删除 `archived_at`),审计 `changelog.*` 只记条目 id 与动作(无 summary / before / after)。没有任何日志调用。路由 `routers/changelog.py`、`routers/admin_changelog.py`;已读按 **id** 比较(spec),id 较小的草稿在用户标记已读之后才发布不会再亮红点,所以导入命令按日期升序建草稿
- `changelog_import.py` – `python -m app.admin.changelog_import [--dir DIR] [--dry-run]`:读 `*.json` 草稿(容器里 `/app/changelog`,检出里 `docs/changelog`),按 `(entry_date, title_zh)` 幂等建草稿(已发布 / 已编辑 / 已删除的都不动不复活;改标题 = 新草稿),全有或全无(失败退出 2,目录不存在退出 1),只打印数量;每条记审计 `changelog.import`(actor `cli`)。镜像靠 `COPY docs/changelog /app/changelog` 带上草稿,**重建容器只在用户要求时做**
- `system.py` – `status(app, session)` for `GET /api/admin/system` (version, DB/alembic, disk, tasks, settings;
  its findings are computed locally, separate from `doctor.py`)
- `housekeeping.py` – orphan recording scan/delete (token-guarded rescan), audit purge with anchor, `purge_expired`
- `backups.py` – SQLite `VACUUM INTO` backups, prune, signed one-time download links, `daily_loop` (backup at
  `BACKUP_HOUR_UTC` + daily `purge_expired`; registered in `app.state.background_tasks["backups"]`)

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`, `app.realtime`, `app.rank`, `app.rooms`, `app.wordbook`, `app.agents`, `app.library`.
Only `app/routers/` and `app/main.py` may import `app.admin` (enforced by `tests/test_architecture.py`).
Never import routers from here (room runtime lives in `routers/admin_rooms.py` via `app.routers.rooms.runtime`).

## Rules for every write
- Endpoint declares its minimum role (`Depends(require(...))`); `tests/test_admin_routes_guarded.py` walks the
  route table. Non-GET requests pass CSRF in `current_admin`. Dangerous actions use a step-up dependency + `reason`.
- Write the audit row with `audit.record(session, ctx.actor, "area.verb", ...)` in the same transaction.
- Secrets appear only as `{"set", "source", "fp"}`; tests scan responses with `tests/admin_helpers.assert_no_secrets`.

## Tests
`uv run pytest -q tests/test_admin_*.py tests/test_quotas*.py tests/test_architecture.py tests/test_usage*.py
tests/test_announcements.py tests/test_changelog_*.py tests/test_system_status.py tests/test_housekeeping.py tests/test_backups.py
tests/test_invites.py tests/test_invite_mode_db_codes.py tests/test_prompts*.py tests/test_rank_rules*.py`
(helpers: `tests/admin_helpers.py` — `ADMIN_ENABLED`, `PASSWORD`, `login_as(app, client, role)`, `assert_no_secrets`)

## Pitfalls
- Never log or audit passwords, TOTP/recovery codes, tokens, CSRF, secrets, user text or prompt bodies.
- `ADMIN_SESSION_SECRET` empty => generated once and stored in `app_secrets` (`sessions.ensure_secret`, loaded on the
  first admin request), so CSRF tokens and env fingerprints survive restarts and match across workers; changing the
  env value revokes every admin session. Read it via `await sessions.ensure_secret(app)`, never `app.state` directly.
- `admin_web` must be registered before `web` (SPA fallback) in `create_app`.
- 精选库的删除永远不按副本的 `media_path` 删文件;删目录文件只经 `catalog_store.collect_if_orphan` / `purge` 或「引用数为 0 的删除」。活动中的目录条目先 `_stop` 再删。
- The audit chain is serialised through the one-row `audit_head` (DB write/row lock held until the caller commits):
  commit promptly after `audit.record`, never await upstream calls between them. `verify` also needs the oldest row
  to start at GENESIS or be named by an `audit.purge` anchor.
