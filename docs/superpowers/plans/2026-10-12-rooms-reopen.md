# 联机房间 · 已结束房间隐藏 + 房主重新开启 Implementation Plan

> **执行前先读 `docs/superpowers/plans/2026-10-12-agents-INDEX.md`:合并顺序、迁移链与跨计划冲突的裁决以它为准(与本计划冲突时,INDEX 优先)。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「我的房间」默认只列开放中的房间,底部入口「已结束的房间(N)」进入独立的已结束页(该用户作为有效成员的全部已关闭房间,按结束时间倒序游标分页,查看历史只读、学习小结状态、房主可「重新开启」);房主 `POST /api/rooms/{id}/reopen`、管理员 `POST /api/admin/rooms/{id}/reopen`(写审计)把已结束的房间改回开放(新房间码、成员不变、`opened_at` 重置、`reopen_count + 1`);过期计时改以 `opened_at` 为锚点;再次结束时学习小结重新生成且失败不丢旧小结;WS 协议只增不改(新增 `reopened` 事件);消息与语音永久保留。

**Architecture:** 迁移 `0014` 给 `rooms` 加 `opened_at`(可空,迁移内回填 `created_at`,代码里 `coalesce(opened_at, created_at)`)与 `reopen_count`;`RoomStore` 追加 `reopen / ended / ended_count`,`mine()` 只返回开放房间,`sweep()` 以 `opened_at` 起算;`routers/rooms.py` 追加 `GET /ended`、`POST /{id}/reopen`,`/mine` 追加 `ended_count`,`room_out` 追加 `close_reason`;小结仓库按「`room_summaries.created_at` 早于 `opened_at` 即过期」认领重新生成,失败/跳过时恢复为 `done` + `reason="stale"`(旧 `data` 从不清空);管理员端点在 `routers/admin_rooms.py`,审计 `room.reopen`。网页:`room-state` 加 `reopened` 事件与 `reset`,`use-room` 对只读查看者轮询房间状态并在开启后重连;新增懒加载的 `ended/ended-rooms-page.tsx`、`extras/reopen-bar.tsx`(插槽)、大厅底部入口;管理后台房间详情加「重新开启」。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pytest-asyncio(Python 3.12,uv);React 18 + react-router + Tailwind 3 + vitest + Testing Library;管理后台 React(桌面)。不新增依赖,不新增设置项。

**Spec:** `docs/superpowers/specs/2026-10-12-wordbook-review-and-room-reopen-design.md` 第二部分(本计划只实现第二部分);项目规范 `docs/superpowers/specs/2026-10-12-agents-design.md` §11。前置:`docs/superpowers/plans/2026-10-10-rooms-v2.md`(房间 v2)、`docs/superpowers/specs/2026-10-10-rooms-v2-design.md`。

## Global Constraints

- **合并顺序(跨计划)**:W(已学词)→ **R(本计划,迁移 `0014`,`down_revision = "0013"`)** → A1(`0015`)→ A2/A3(`0016`)→ A4 → A5(agents-design §12)。本计划合并时 `alembic heads` 必须只有 `0014`;两处旧断言 `== ["0013"]`(`tests/test_migrations.py`)随本计划改成 `["0014"]`。
- **消息与语音永久保留**:本计划不删除任何 `RoomMessage` / `RoomVoice` / 音频文件;重新开启只改 `rooms` 行与小结行。`purge`(`ROOM_MESSAGE_RETENTION_DAYS > 0`)的行为不变,被 purge 的房间没有成员行,重新开启自然失败(`not_found`)。
- **日志与审计不含文本**:日志只写房间 id、计数与异常类名;不写房间名、新房间码、用户名、邀请 token、消息或小结文本(每个新端点与小结重新生成路径各有 `caplog` 断言)。审计 `after` 只含 `reopen_count`。
- **协议只增不改**:`SERVER_EVENT_TYPES` 末尾追加 `"reopened"`(`protocol.py` 与 `protocol.ts` 同序);不改任何已有事件、字段与关闭码;`PROTOCOL_VERSION` 仍为 2(旧客户端忽略未知事件类型,`parseRoomEvent` 对未知类型返回 null)。
- **分层不变**:`tests/test_architecture.py`、`web/src/architecture.test.ts` 不放宽、不改冻结边数(本计划没有新的跨 feature 边,没有新的服务端包)。`rooms` 仍不导入 `rank / realtime / admin / routers`。
- **主包不增长**:已结束页走懒加载(`features/rooms/lazy-ended.tsx`,`React.lazy`);大厅(已在主包)删掉已结束行的小结分支、只加一行入口。验收:`yarn web:build` 前后对比主 chunk gzip,增量 ≤ 0.2 kB(数字写进 PR 描述,不在本文件里编造)。
- **i18n**:新增字符串全部在 `web/src/features/rooms/ended/i18n/{zh-CN,en}.json`(`web.rooms.*`,由 `web/src/i18n/index.ts` 的 glob 深合并);中英齐全;英文标签在 360–375 px 不换行溢出(行内按钮 `whitespace-nowrap`,标题 `truncate`)。
- **每个改动目录更新自己的 `CLAUDE.md`**:`server/app/rooms/`、`server/app/routers/`、`server/app/`(迁移头 0014)、`web/src/features/rooms/`(含新目录 `ended/`)、`admin/src/features/rooms/`(该目录目前没有 `CLAUDE.md`,本计划新建,见 A1)。
- 每个任务结束:`cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py`;网页 `yarn web:typecheck && cd web && yarn vitest run src/features/rooms src/architecture.test.ts`;管理后台 `yarn workspace` 对应的 admin 测试命令见 A1。车道合并前跑全量(只在 Z1 与各车道合并前各一次)。
- 提交 conventional(`feat(server): …`、`feat(web): …`、`feat(admin): …`、`test(…)`、`docs: …`),一个任务一个逻辑提交,信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- **未验证项如实标注**:Postgres 路径(迁移与 keyset 游标比较)、真机、反向代理 WebSocket、多进程部署下的小结认领,本计划只在 SQLite + 测试里验证,验证清单里标「未验证」(Z1)。

---

## 文件结构

```
server/
  alembic/versions/0014_rooms_reopen.py               新:opened_at(可空)+ reopen_count;迁移内回填;batch 双路径
  app/models.py                                       Room: + opened_at / reopen_count(插入点:invite_token 之后)
  app/rooms/protocol.py                               SERVER_EVENT_TYPES 末尾 + "reopened"(+ 模块文档一句)
  app/rooms/rules.py                                  RoomLimits: + reopen_per_minute;mine_closed_days 标注已不用
  app/rooms/store.py                                  opened_anchor / encode_cursor / decode_cursor;create 写 opened_at;
                                                      _owned_room(closed=) ;_check_slots;reopen / ended / ended_count;
                                                      mine 只开放;sweep 以 opened_at 起算;room_out + close_reason
  app/rooms/summary_store.py                          start(since=) 过期认领;fail/skip 保留旧小结;SummaryRunner.opened_of
  app/routers/rooms.py                                ROOM_ERRORS + 3 条;RoomsRuntime.reopen_limiter;/mine + ended_count;
                                                      GET /ended;POST /{id}/reopen;announce_reopened
  app/routers/rooms_summary.py                        opened_of 接线;retry 接受 done+stale
  app/routers/admin_rooms.py                          POST /rooms/{id}/reopen(operator,审计 room.reopen)
  app/admin/rooms_admin.py                            _room_row + opened_at / reopen_count
  tests/test_migrations.py                            test_0014…;两处 heads 断言改 0014
  tests/test_rooms_reopen_store.py                    新:store 层
  tests/test_rooms_reopen_api.py                      新:HTTP(异步 client)
  tests/test_rooms_reopen_ws.py                       新:WS(同步 rooms_client)+ reopened 事件契约
  tests/test_rooms_summary_reopen.py                  新:小结重新生成
  tests/test_admin_rooms_reopen.py                    新:管理员端点与审计
  tests/test_rooms_store.py / test_rooms_api.py / test_rooms_ws.py / test_rooms_summary_api.py / test_rooms_rules.py
                                                      各单点改断言(closed 不再出现在 /mine)
  tests/fixtures/rooms_reopen_contract.json           新:reopen / ended / mine / reopened 事件形状
  tests/fixtures/rooms_*_contract.json                重录(room 多一个 close_reason 键)
  app/rooms/CLAUDE.md、app/routers/CLAUDE.md、app/CLAUDE.md
web/src/features/rooms/
  protocol.ts                                         ROOM_SERVER_EVENT_TYPES + reopened;RoomEvent + reopened;RoomInfo + closeReason
  room-state.ts                                       reopenSignal;事件 reopened;动作 reset
  use-room.ts                                         epoch 重连;reopened();只读查看者轮询
  rooms-api.ts                                        endedRooms / reopenRoom / myRoomsOverview;错误表 + 2 条
  rooms-lobby-page.tsx                                只列开放房间;底部入口
  room-page.tsx                                       冻结页的一行接线(WR-1)
  lazy-ended.tsx                                      新:懒加载壳
  ended/ended-rooms-page.tsx、ended/use-ended-rooms.ts、ended/i18n/{zh-CN,en}.json     新
  extras/reopen-bar.tsx、extras/summary-page.tsx(stale 提示)
  index.ts、CLAUDE.md、room-fixtures.ts
  各测试(见任务)
web/src/app.tsx                                       + /rooms/ended 路由
admin/src/features/rooms/
  api.ts、strings.ts、room-detail-page.tsx、test-fixtures.ts、room-detail-page.test.tsx、CLAUDE.md(新)
```

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件(车道进行期间只有它改) | 依赖 |
|---|---|---|---|
| **server S**(一个执行者,串行) | S1–S6 | 上表 `server/` 下全部文件 | W 计划已合并(迁移号 0014 之前没有别的迁移) |
| **web W**(一个执行者,串行) | W1–W5 | 上表 `web/` 下全部文件 | W1 可与 S 并行(只动 `protocol.ts` / reducer / hook);W2 起用 fetch 模拟,W5 契约测试需 S6 的夹具 |
| **admin A** | A1 | 上表 `admin/` 下全部文件 | S5 合并(端点存在) |
| **review Z** | Z1 | 本文件(勾选与结果)、验证清单 | S、W、A 全部合并 |

**共享文件的插入点**(其余计划后合并,在此之后追加,不得重排):

| 文件 | 本计划的插入点 | 后续计划(agents)追加位置 |
|---|---|---|
| `server/app/models.py` | `class Room` 末尾,`invite_token` 一行之后加两列 | 新模型追加在文件末尾,不动 `Room` |
| `server/app/rooms/protocol.py` | `SERVER_EVENT_TYPES` 元组末尾 | A5 的 agents 事件接在 `"reopened"` 之后 |
| `server/app/rooms/store.py` | `create` 之前加辅助函数;`close_by_owner` 之后加 `reopen`;`mine` 之后加 `ended / ended_count` | A5 在文件末尾追加 |
| `server/app/routers/rooms.py` | `ROOM_ERRORS` 末尾;`RoomsRuntime` 在 `react_limiter` 之后;`/mine` 路由之后 | A5 在 `/{room_id}/close` 之后追加 |
| `server/alembic/versions/` | `0014_rooms_reopen.py`(`down_revision = "0013"`) | A1 用 `0015`,A2/A3 用 `0016` |
| `web/src/features/rooms/i18n` | 不动;本计划只新增 `ended/i18n/` | — |
| `web/src/app.tsx` | `/rooms` 路由之后加 `/rooms/ended` | — |

**合并顺序**:S1 → S2 → S3 → S4 → S5 → S6;W1 → W2 → W3 → W4 → W5(W5 在 S6 之后);A1(在 S5 之后);Z1。

**评审波**:S 车道合并前 `/code-review high` + `security-review`(权限:谁能重新开启、`admin` 关闭的边界、游标输入、日志卫生、竞态);W 车道合并前在浏览器窗格 375×812 浅色 + 深色走一遍(大厅入口、已结束页、房主重新开启后进入在线、只读成员自动上线)并用键盘走一遍;Z1 全量测试。

## 本计划的裁定(Ruling)

- **R-O1 迁移方案**:`opened_at` 取「可空新增 + 迁移内一条 `UPDATE rooms SET opened_at = created_at WHERE opened_at IS NULL` 回填 + 永久保持可空,代码里 `coalesce(opened_at, created_at)`」;`reopen_count` 取 `NOT NULL DEFAULT 0`。理由:Postgres 上 `ADD COLUMN`(可空,或带常量默认值)只改元数据不重写表;`rooms` 表小(每个房间一行,不随消息增长),一条回填 UPDATE 是秒级;**不做 `SET NOT NULL`**——它要全表扫描并持 `ACCESS EXCLUSIVE` 锁,而且滚动发布期间旧进程仍会插入没有 `opened_at` 的行(旧进程的 `create` 不写这一列),NOT NULL 反而会让旧进程建房失败;所以「可空 + `opened_anchor()` 的 coalesce」才是安全终态。代价:读取处必须统一经过 `opened_anchor(room)`(任务 S2 把 `sweep` 与小结过期判断都收敛到它)。SQLite 走 `batch_alter_table`(加列不重建表,降级删列重建表,往返测试检查 FK 与唯一约束保留)。判错的代价:若以后想要 NOT NULL,另起迁移在确认无旧进程后加。
- **R-O2 `sweep()` 的锚点**:过期 = `opened_anchor(room) <= now - max_hours`;闲置仍按 `last_active_at` 且当前不在线。重新开启把 `opened_at = last_active_at = now`,所以新开的房间至少活 `rooms_idle_minutes`(无人连接时)/ 最多 `rooms_max_hours`。`create` 同时写 `opened_at = created_at = now`。判错的代价:无(两个口径对从未重开的房间完全一致)。
- **R-O3(规格与代码矛盾)只读查看者没有 WebSocket**:`POST /{id}/ticket` 对已结束房间 404,WS 握手也拒绝非 open 房间,所以「正在只读查看已关闭房间的成员收到 `reopened` 后切换在线」在现有架构里没有连接可收。裁定:① 仍按规格新增 `reopened` 事件(协议 + 契约 + reducer 处理),服务端在重新开启后向该房间的现有连接广播(通常为空,保证有人持连接——例如未来允许只读订阅——时语义正确);② 真正生效的机制是 **网页轮询**:`use-room` 在只读状态下每 20 秒(页面可见时)`GET /api/rooms/{id}`,看到 `status=open` 就合成同一个 `reopened` 事件;房主自己点「重新开启」后本地直接合成。③ 不开放对已结束房间的 WS 只读订阅(范围与滥用面都更大)。判错的代价:只读成员最多晚 20 秒看到房间上线;若要即时,后续再加只读订阅。
- **R-O4 `mine_closed_days` 不是设置项**:它是 `RoomLimits.mine_closed_days` 字段的默认值 7,没有对应的环境变量或设置注册表键(`grep` 只在 `rules.py` 与一条规则测试里出现)。裁定:字段保留(注释标明「不再影响列表」),`mine()` 不再读它,`test_rooms_rules.py` 的默认值断言不动;不新增、不删除任何设置键。
- **R-O5 学习小结的覆盖与保留**:`room_summaries` 主键是 `room_id`,采用「覆盖更新」。**现有 `SummaryStore.start` 只会认领 `failed` 行**,所以再次结束时 `run()` 会看到 `done` 而不重新生成——规格没有发现这一点。裁定:① 过期判定 = 小结行 `created_at`(本次生成的首次认领时间)早于房间 `opened_at`(只对 `reopen_count > 0` 的房间检查);过期的 `done / skipped / failed` 行被原子认领为 `pending`、`attempts = 1`、`created_at = now`,**`data` 与 `model` 不清空**;② 生成期间(秒级)小结页显示「正在生成」,与首次生成一致;③ 失败 / 跳过 / 重启兜底:凡是该行 `data` 非空(= 有旧小结),`fail` / `skip` 一律把行恢复为 `status="done"`、`reason="stale"`(旧内容立刻重新可读,不丢);`data` 为空的行行为不变;④ `stale` 的行在剩余次数内(`attempts < summary_attempts`)可由任一成员 `POST /summary/retry` 重试;⑤ 仍受「每房主每天」「全局每天」预算约束(走原来的 `_claim_budget`)。已知边界:首次小结还在生成(`pending`)时房主就重新开启并再次结束——此时认领不到(状态是 `pending`),最后写入的是只覆盖旧内容的小结;下一次结束会重新生成(`created_at` 仍早于新的 `opened_at`)。判错的代价:少一份覆盖最新会话的小结,可手动重试之外无数据丢失。
- **R-O6 重新开启的幂等与竞态**:`reopen` 在 `RoomStore._admission`(与 `create / join` 同一把锁)内完成「读 → 校验 → 写」,两个并发请求串行化;第二个看到 `status="open"` 返回 `not_closed`(HTTP 409 `Room is not closed`),`reopen_count` 只加一次。网页收到该 409 时重读房间,若已开放就当作成功(双击与多标签页都安全)。`close()` / `sweep()` 只处理 `status="open"` 行,与 `reopen` 不会互相覆盖:sweeper 的候选集合在它自己的会话里读取,重新开启的房间在读取时是 closed,不在候选里。
- **R-O7 `rooms_max_owned` 与容量**:重新开启和创建走同一个 `_check_slots`(全站开放房间数 `max_active` → `capacity`;房主开放房间数 `max_owned`(含管理员给该用户的配额覆盖,经 `core.quotas.effective`)→ `too_many`)。管理员路径**不绕过**:用房主的有效配额检查,超限返回 409,管理员需先关掉房主的另一个房间。判错的代价:管理员多一步操作。
- **R-O8 成员与邀请**:重新开启不改任何 `room_members` 行(被踢者保持 `kicked`,拒绝再进);主动退出的人和任何新人一样,可以凭**新房间码**按开放房间的规则加入(规格「已退出的人仍然不能进」只能理解为「不会被自动拉回」,因为现有 `join` 允许 `left_at` 非空的人重新加入,本计划不收紧这条);`locked`、`join_mode`、其余设置保持原样;**旧邀请 token 清空**(`invite_token = None`),旧链接 404,避免已结束房间的旧链接自动复活;新房间码用 `code_gen`,与所有当前 `code` 非空的房间不重复(撞车重试 `CODE_ATTEMPTS` 次,耗尽 `capacity`)。
- **R-O9 谁能重新开启**:房主路径要求是该房间有效的房主(沿用 `_owned_room` 的规则,放开 `status` 检查);`close_reason == "admin"` 对房主返回 `admin_closed`(403 `Closed by an administrator`)。规格写的是白名单 `{owner, idle, expired, disabled}`;现有代码里只会写出 `owner / idle / expired / admin` 四种原因(`disabled` 从未被写入——功能关闭只断开连接,不关房),所以用「仅排除 `admin`」的黑名单,与白名单今天等价,且不会让未来/遗留的原因卡死。管理员路径要求 `owner_id` 非空(房主被删除且无人接手的房间返回 409 `Room has no owner`)。
- **R-O10 频率**:每用户每分钟 5 次重新开启(`RoomLimits.reopen_per_minute = 5`,固定值,不加设置;`RateLimiter`,超限 429 与加入房间同一句文案)。不设「每房间重新开启总次数」上限:被 `max_owned` 与每分钟限流约束,且 `reopen_count` 供管理后台观察。
- **R-O11 `room_out` 增加 `close_reason`**:网页要在「房主 + 非管理员关闭」时才显示按钮,而现有 `room_out` 只有 `closed_at`。这是 `room` 对象的加法(额外一个键,开放房间为 null),所有 `rooms_*_contract.json` 重录(Diff 只应多这个键)。
- **R-O12 已结束列表**:排序键 `coalesce(closed_at, last_active_at)` 倒序、`id` 倒序;游标是该键与房间 id 的 base64url(不含任何用户文本);`limit` 默认 20、最大 50;`GET /api/rooms/mine` 增加 `ended_count`(有效成员的已关闭房间总数),网页大厅用它显示「已结束的房间(N)」,**N 为 0 时不显示入口**。退出(`leave`)某个已结束房间会让它从该用户的已结束页消失(沿用「只是从列表里移除」的语义)。
- **R-O13 冻结的 `room-page.tsx`**:按 `web/src/features/rooms/CLAUDE.md` 的规则要在计划里写 Addendum。**WR-1**:本计划对 `room-page.tsx` 只做「导入 `ReopenBar` + 一行接线」,功能逻辑全在 `extras/reopen-bar.tsx` 与 `use-room.ts`。
- **R-O14 系统消息**:重新开启后追加一条公共系统消息(只存模板 key,P-7):`reopened`(`{name}` = 房主用户名)或 `reopened_admin`(无参数);网页 `web.rooms.room.system.*` 渲染。系统消息同样永久保留。
- **R-O15 旧小结提示**:`done` 且 `reason="stale"` 时,小结页顶部加一句「这是上一次的小结;新的小结暂时没能生成。」(`web.rooms.extras.summary.stale`);小结卡不变。

**规格与代码不符 / 规格没想到的地方**(汇总,均已按上面的 Ruling 处理,规格文件未改):R-O3(只读查看者没有 socket)、R-O4(`mine_closed_days` 不是设置项)、R-O5(小结运行器不会为 `done` 行重新生成)、R-O8(「已退出仍不能进」与现有 `join` 矛盾)、R-O9(`disabled` 原因从未被写入)、R-O11(`room_out` 缺 `close_reason`)。

---

## Lane server (S)

### Task S1: 迁移 0014 与 `Room` 模型

**Files:**
- Create: `server/alembic/versions/0014_rooms_reopen.py`
- Modify: `server/app/models.py`、`server/tests/test_migrations.py`

**Interfaces:**
- Produces:`Room.opened_at: datetime | None`、`Room.reopen_count: int`(默认 0);`alembic heads == ["0014"]`。

- [ ] **Step 1: 写失败测试**(`server/tests/test_migrations.py`,放在 `test_0013…` 之后;同时把文件里两处 `get_heads() == ["0013"]`(`test_0011…` 与 `test_0013…`)改成 `["0014"]`):

```python
def test_0014_rooms_reopen_columns_backfill_and_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0014"]
    assert ScriptDirectory.from_config(cfg).get_revision("0014").down_revision == "0013"
    command.upgrade(cfg, "0013")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (7, 'lily', 'x', '2026-10-09')")
    con.execute("insert into rooms (id, code, last_code, owner_id, topic, status, locked, ai_public, last_seq, created_at,"
                " last_active_at, ai_muted) values ('r1', '482913', '482913', 7, '', 'open', 0, 1, 0, '2026-10-09 08:00:00',"
                " '2026-10-09 08:30:00', 0), ('r2', null, '573920', 7, '', 'closed', 0, 1, 0, '2026-10-08 08:00:00',"
                " '2026-10-08 09:00:00', 0)")
    con.commit()
    con.close()
    command.upgrade(cfg, "0014")
    con = sqlite3.connect(db)
    try:
        # backfilled to created_at, and the column stays nullable (R-O1: code coalesces, no SET NOT NULL)
        assert dict(con.execute("select id, opened_at from rooms")) == {"r1": "2026-10-09 08:00:00", "r2": "2026-10-08 08:00:00"}
        assert {r[0] for r in con.execute("select reopen_count from rooms")} == {0}
        cols = {r[1]: r for r in con.execute("pragma table_info(rooms)")}
        assert cols["opened_at"][3] == 0  # notnull flag
        assert cols["reopen_count"][3] == 1 and cols["reopen_count"][4] == "'0'"
    finally:
        con.close()
    command.downgrade(cfg, "0013")
    con = sqlite3.connect(db)
    try:
        cols = {r[1] for r in con.execute("pragma table_info(rooms)")}
        assert "opened_at" not in cols and "reopen_count" not in cols
        assert [(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(rooms)")] == [("users", "owner_id", "SET NULL")]
        assert any(r[1] == "uq_rooms_invite_token" or r[2] for r in con.execute("pragma index_list(rooms)"))
        assert con.execute("select count(*) from rooms").fetchone()[0] == 2  # rooms are never lost
    finally:
        con.close()
    command.upgrade(cfg, "head")
```

- [ ] **Step 2: 运行确认失败**:`cd server && uv run pytest -q tests/test_migrations.py -k "0014 or 0011 or 0013"` → FAIL(没有 0014)。

- [ ] **Step 3: 写迁移** `server/alembic/versions/0014_rooms_reopen.py`:

```python
"""rooms reopen: opened_at (nullable, backfilled) + reopen_count (spec 2026-10-12 part 2, plan R-O1)

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-12 09:00:00.000000

`opened_at` stays NULLABLE for good: readers use coalesce(opened_at, created_at) (`rooms.store.opened_anchor`). A later
SET NOT NULL would scan the table under an ACCESS EXCLUSIVE lock on Postgres and would break old processes during a
rolling deploy (they insert rooms without this column). ADD COLUMN (nullable, or NOT NULL with a constant default) is
metadata-only on Postgres; the backfill is one UPDATE on a small table. SQLite: batch ops (adding columns does not
recreate the table; the downgrade drop does, and keeps the owner FK and the invite-token unique constraint).
Linear: 0013 -> 0014; the agents plans use 0015 / 0016.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0014'
down_revision: Union[str, Sequence[str], None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    with op.batch_alter_table('rooms') as b:
        b.add_column(sa.Column('opened_at', TZ, nullable=True))
        b.add_column(sa.Column('reopen_count', sa.Integer(), nullable=False, server_default='0'))
    op.execute("UPDATE rooms SET opened_at = created_at WHERE opened_at IS NULL")


def downgrade() -> None:
    with op.batch_alter_table('rooms') as b:
        b.drop_column('reopen_count')
        b.drop_column('opened_at')
```

- [ ] **Step 4: 模型**(`server/app/models.py`,`class Room` 里 `invite_token` 之后):

```python
    # ---- reopen (spec 2026-10-12 part 2): the expiry clock starts at the last (re)opening ----
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # NULL = created_at
    reopen_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
```

- [ ] **Step 5: 运行**:`cd server && uv run pytest -q tests/test_migrations.py` → 全绿(含 `test_models_match_migrations`、`test_user_foreign_keys…`)。
- [ ] **Step 6: 更新 `server/app/CLAUDE.md`** 的迁移句:`head 0013` → `head 0014`。
- [ ] **Step 7: Commit**:`feat(server): rooms.opened_at and reopen_count (migration 0014)`。

---

### Task S2: `RoomStore`:锚点、只列开放、已结束分页、重新开启

**Files:**
- Modify: `server/app/rooms/store.py`、`server/app/rooms/rules.py`
- Create: `server/tests/test_rooms_reopen_store.py`
- Modify(单点):`server/tests/test_rooms_store.py`(第 164–165 行两条断言)、`server/tests/test_rooms_rules.py`(无需改,默认值断言保留)

**Interfaces:**
- Produces(`app.rooms.store`):
  - `opened_anchor(room: Room) -> datetime`(UTC 有时区)
  - `encode_cursor(ended_at: datetime, room_id: str) -> str`、`decode_cursor(raw: str) -> tuple[datetime, str]`(非法抛 `ValueError`)
  - `RoomStore.reopen(room_id, user_id: int | None, now, *, max_owned: int | None = None, admin: bool = False) -> Room`
    (`user_id=None` 仅在 `admin=True` 时合法;错误码 `not_found / forbidden / not_closed / admin_closed / no_owner / too_many / capacity`)
  - `RoomStore.ended(user_id, after: tuple[datetime, str] | None, limit: int) -> tuple[list[tuple[Room, str]], tuple[datetime, str] | None]`
  - `RoomStore.ended_count(user_id) -> int`
  - `RoomStore.mine(user_id, now)` 只返回开放房间(签名不变)
  - `room_out(...)` 多一个键 `close_reason`
  - `RoomLimits.reopen_per_minute: int = 5`

- [ ] **Step 1: 写失败测试** `server/tests/test_rooms_reopen_store.py`:

```python
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import Room, RoomMember, User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomError, RoomStore, decode_cursor, encode_cursor, opened_anchor, room_out

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A, B, C = 11111111, 22222222, 33333333


def make_store(app, codes, **limits):
    it = iter(codes)
    return RoomStore(app.state.sessionmaker, RoomLimits(max_members=4, **limits), code_gen=lambda: next(it))


@pytest.fixture
async def users(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=u, username=n, password_hash="x") for u, n in ((A, "alice"), (B, "bob"), (C, "carol"))])
        await s.commit()


async def closed_room(store, owner=A, reason="owner", at=NOW):
    room = await store.create(owner, "", at)
    await store.close(room.id, reason, at)
    return room


async def test_create_sets_opened_at_and_sweep_counts_from_it(app, users):
    store = make_store(app, ["482913", "573920"], max_hours=24, idle_minutes=30)
    room = await store.create(A, "", NOW)
    assert room.opened_at == NOW and room.reopen_count == 0
    # keep it "online" so only the age rule can fire
    assert await store.sweep(NOW + timedelta(hours=23), {room.id}) == []
    assert await store.sweep(NOW + timedelta(hours=25), {room.id}) == [(room.id, "expired")]
    # a legacy row (no opened_at) falls back to created_at
    legacy = await store.create(B, "", NOW)
    async with app.state.sessionmaker() as s:
        row = await s.get(Room, legacy.id)
        row.opened_at = None
        await s.commit()
    assert opened_anchor(await store.room(legacy.id)) == NOW
    assert await store.sweep(NOW + timedelta(hours=25), {legacy.id}) == [(legacy.id, "expired")]


async def test_reopen_resets_the_expiry_clock(app, users):
    store = make_store(app, ["482913", "573920"], max_hours=24)
    room = await closed_room(store, reason="expired", at=NOW + timedelta(hours=24))
    reopened = await store.reopen(room.id, A, NOW + timedelta(hours=30))
    assert reopened.opened_at == NOW + timedelta(hours=30)
    # created 31h ago but reopened 1h ago: not expired
    assert await store.sweep(NOW + timedelta(hours=31), {room.id}) == []
    assert await store.sweep(NOW + timedelta(hours=55), {room.id}) == [(room.id, "expired")]


async def test_reopen_state_changes_and_members_stay(app, users):
    store = make_store(app, ["482913", "573920"])
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW)
    await store.join(room.code, C, NOW)
    await store.kick(room.id, A, C, NOW)
    await store.leave(room.id, B, NOW)
    async with app.state.sessionmaker() as s:
        (await s.get(Room, room.id)).invite_token = "tok-secret"
        await s.commit()
    await store.close(room.id, "idle", NOW + timedelta(minutes=40))
    later = NOW + timedelta(days=2)
    reopened = await store.reopen(room.id, A, later)
    assert (reopened.status, reopened.code, reopened.last_code) == ("open", "573920", "573920")
    assert reopened.closed_at is None and reopened.close_reason is None
    assert reopened.opened_at == later and reopened.last_active_at == later and reopened.reopen_count == 1
    assert reopened.invite_token is None  # R-O8: old links do not come back
    async with app.state.sessionmaker() as s:
        rows = {m.user_id: (m.role, m.left_at is not None, m.kicked) for m in
                (await s.scalars(select(RoomMember).where(RoomMember.room_id == room.id))).all()}
    assert rows == {A: ("owner", False, False), B: ("member", True, False), C: ("member", True, True)}
    with pytest.raises(RoomError) as e:
        await store.join("573920", C, later)
    assert e.value.code == "kicked"  # R-O8
    assert (await store.join("573920", B, later))[1] is True  # a member who left may come back with the NEW code


async def test_reopen_permissions_and_conditions(app, users):
    store = make_store(app, ["482913", "573920", "684031"])
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW)
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, A, NOW)  # still open
    assert e.value.code == "not_closed"
    await store.close(room.id, "owner", NOW)
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, B, NOW)  # a member is not the owner
    assert e.value.code == "forbidden"
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, C, NOW)  # a stranger
    assert e.value.code == "forbidden"
    with pytest.raises(RoomError) as e:
        await store.reopen("nope", A, NOW)
    assert e.value.code == "not_found"
    admin_closed = await closed_room(store, reason="admin")
    with pytest.raises(RoomError) as e:
        await store.reopen(admin_closed.id, A, NOW)
    assert e.value.code == "admin_closed"
    assert (await store.reopen(admin_closed.id, None, NOW, admin=True)).status == "open"  # R-O9: the operator may
    async with app.state.sessionmaker() as s:
        ownerless = await s.get(Room, room.id)
        ownerless.owner_id = None
        await s.commit()
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, None, NOW, admin=True)
    assert e.value.code == "no_owner"


async def test_reopen_respects_max_owned_and_site_capacity(app, users):
    store = make_store(app, [f"{482900 + i}" for i in range(10)], max_owned=1, max_active=2)
    closed = await closed_room(store)
    live = await store.create(A, "", NOW)
    with pytest.raises(RoomError) as e:
        await store.reopen(closed.id, A, NOW)
    assert e.value.code == "too_many"
    assert (await store.reopen(closed.id, A, NOW, max_owned=2)).status == "open"  # the user's own cap (quota override)
    await store.close(live.id, "owner", NOW)
    other = await closed_room(store, owner=B)
    await store.create(C, "", NOW)  # second open room site-wide -> full (A's reopened one + C's)
    with pytest.raises(RoomError) as e:
        await store.reopen(other.id, B, NOW)
    assert e.value.code == "capacity"


async def test_two_parallel_reopens_count_once(app, users):
    store = make_store(app, ["482913", "573920", "684031"])
    room = await closed_room(store)

    async def run():
        try:
            return (await store.reopen(room.id, A, NOW)).reopen_count
        except RoomError as e:
            return e.code

    results = await asyncio.gather(run(), run())
    assert sorted(map(str, results)) == ["1", "not_closed"]
    assert (await store.room(room.id)).reopen_count == 1


async def test_reopen_skips_a_code_that_an_open_room_holds(app, users):
    store = make_store(app, ["482913", "573920", "573920", "684031"])  # A's room: 482913; B's room: 573920
    mine = await closed_room(store)
    await store.create(B, "", NOW)
    reopened = await store.reopen(mine.id, A, NOW)
    assert reopened.code == "684031"  # the 573920 draw collided with B's open room


async def test_mine_lists_only_open_rooms_and_ended_pages_by_end_time(app, users):
    store = make_store(app, [f"{482900 + i}" for i in range(20)], max_owned=10)
    first = await closed_room(store, at=NOW)
    second = await closed_room(store, at=NOW + timedelta(hours=1))
    third = await closed_room(store, at=NOW + timedelta(hours=2))
    live = await store.create(A, "", NOW)
    shared = await store.create(B, "", NOW)
    await store.join(shared.code, A, NOW)
    await store.close(shared.id, "idle", NOW + timedelta(hours=3))
    await store.leave(first.id, A, NOW)  # leaving removes it from my ended list
    assert [r.id for r, _ in await store.mine(A, NOW + timedelta(days=400))] == [live.id]  # no 7-day window any more
    assert await store.ended_count(A) == 3
    page, nxt = await store.ended(A, None, 2)
    assert [r.id for r, _ in page] == [shared.id, third.id] and [role for _, role in page] == ["member", "owner"]
    assert nxt is not None
    page2, nxt2 = await store.ended(A, decode_cursor(encode_cursor(*nxt)), 2)
    assert [r.id for r, _ in page2] == [second.id] and nxt2 is None
    assert await store.ended(C, None, 10) == ([], None)  # strangers see nothing


async def test_ended_includes_old_rooms_and_cursor_rejects_garbage(app, users):
    store = make_store(app, ["482913"])
    old = await closed_room(store, at=NOW - timedelta(days=900))
    assert [r.id for r, _ in (await store.ended(A, None, 5))[0]] == [old.id]
    for bad in ("", "!!!", "bm9wZQ", encode_cursor(NOW, "x")[:-3]):
        with pytest.raises(ValueError):
            decode_cursor(bad)


async def test_room_out_carries_the_close_reason(app, users):
    store = make_store(app, ["482913"])
    room = await closed_room(store, reason="idle")
    out = room_out(await store.room(room.id), my_role="owner", member_count=1, online_count=0)
    assert out["close_reason"] == "idle" and out["status"] == "closed" and out["code"] is None
    live = room_out(await store.create(B, "", NOW), my_role="owner", member_count=1, online_count=0)
    assert live["close_reason"] is None
```

- [ ] **Step 2: 运行确认失败**:`cd server && uv run pytest -q tests/test_rooms_reopen_store.py` → FAIL(导入错误)。
- [ ] **Step 3: `rules.py`**:`RoomLimits` 里 `mine_closed_days` 一行改注释并在 `name_max` 之后加字段:

```python
    mine_closed_days: int = 7  # DEPRECATED (R-O4): no longer used; GET /api/rooms/mine lists open rooms only
```
```python
    reopen_per_minute: int = 5  # per user (R-O10), fixed value like react_per_minute
```
- [ ] **Step 4: `store.py` 实现**。

(a) 导入:`import base64`;`from sqlalchemy import and_, delete, func, or_, select, update`(加 `and_`)。常量与辅助函数放在 `_chunks` 之前:

```python
REOPEN_ADMIN_ONLY = ("admin",)  # R-O9: a room an operator closed can only be reopened by an operator


def opened_anchor(room: Room) -> datetime:
    """The start of the room's current life: `opened_at`, or `created_at` for rows from before migration 0014 and for
    rows an old process inserted during a rolling deploy (R-O1). Always UTC-aware."""
    return as_utc(room.opened_at or room.created_at)


def encode_cursor(ended_at: datetime, room_id: str) -> str:
    """Opaque keyset cursor of the ended list: the sort key and the room id, nothing user-written."""
    return base64.urlsafe_b64encode(f"{as_utc(ended_at).isoformat()}|{room_id}".encode()).decode().rstrip("=")


def decode_cursor(raw: str) -> tuple[datetime, str]:
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        stamp, room_id = text.split("|", 1)
        at = datetime.fromisoformat(stamp)
    except (ValueError, UnicodeDecodeError) as e:  # binascii.Error is a ValueError
        raise ValueError("bad cursor") from e
    if at.tzinfo is None or not room_id or len(room_id) > 64:
        raise ValueError("bad cursor")
    return at, room_id
```
(`raw=""` → `split` ValueError → 抛 `ValueError`;`encode_cursor(NOW,"x")[:-3]` 截断后 base64 解出乱码,`split`/`fromisoformat` 失败 → `ValueError`。)

(b) `room_out` 的返回字典末尾加 `"close_reason": room.close_reason`(放在 `allow_voice` 之后)。

(c) `create`:`Room(...)` 构造里加 `opened_at=now`;把两段计数检查替换为 `await self._check_slots(s, owner_id, max_owned)`,并在 `create` 之前加:

```python
    async def _check_slots(self, s, owner_id: int, max_owned: int | None) -> None:
        """Site-wide and per-owner open-room caps; shared by create and reopen. Callers hold `_admission`."""
        if await s.scalar(select(func.count()).select_from(Room).where(Room.status == "open")) >= self.limits.max_active:
            raise RoomError("capacity")
        owned = await s.scalar(select(func.count()).select_from(Room).where(Room.status == "open",
                                                                            Room.owner_id == owner_id))
        if owned >= (self.limits.max_owned if max_owned is None else max_owned):
            raise RoomError("too_many")
```

(d) `_owned_room` 加关键字 `closed`:

```python
    async def _owned_room(self, s, room_id: str, owner_id: int, *, closed: bool = False) -> Room:
        room = await s.get(Room, room_id)
        if room is None or (room.status != "open" and not closed):
            raise RoomError("not_found")
        ...  # the rest is unchanged
```

(e) `close_by_owner` 之后加 `reopen`:

```python
    async def reopen(self, room_id: str, user_id: int | None, now: datetime, *, max_owned: int | None = None,
                     admin: bool = False) -> Room:
        """closed -> open (spec 2026-10-12 part 2). Owner path: the caller must be the room's active owner and the
        room must not have been closed by an operator; admin path (`user_id=None`): needs an owner_id. Both obey the
        site and per-owner caps (R-O7). Members are untouched, the invite link is dropped, a fresh code is drawn.
        Runs under the admission lock, so two parallel requests count once (the loser gets `not_closed`, R-O6)."""
        async with self._admission, self._sm() as s:
            if admin:
                room = await s.get(Room, room_id)
                if room is None:
                    raise RoomError("not_found")
                if room.owner_id is None:
                    raise RoomError("no_owner")
            else:
                room = await self._owned_room(s, room_id, user_id, closed=True)
            if room.status != "closed":
                raise RoomError("not_closed")
            if room.close_reason in REOPEN_ADMIN_ONLY and not admin:
                raise RoomError("admin_closed")
            await self._check_slots(s, room.owner_id, max_owned)
            for _ in range(CODE_ATTEMPTS):
                code = self._code_gen()
                if await s.scalar(select(Room.id).where(Room.code == code)):
                    continue
                room.status, room.code, room.last_code = "open", code, code
                room.closed_at = room.close_reason = None
                room.opened_at = room.last_active_at = now
                room.reopen_count = (room.reopen_count or 0) + 1
                room.invite_token = None
                try:
                    await s.commit()
                    return room
                except IntegrityError:  # the same code was taken between the check and the commit
                    await s.rollback()
                    room = await s.get(Room, room_id, populate_existing=True)
                    if room is None or room.status != "closed":
                        raise RoomError("not_closed") from None
            raise RoomError("capacity")
```

(f) 替换 `mine`,并在其后加 `ended / ended_count`:

```python
    async def mine(self, user_id: int, now: datetime) -> list[tuple[Room, str]]:
        """Open rooms only (spec 2026-10-12 §2.2); ended rooms are in `ended`. `now` is kept for callers."""
        async with self._sm() as s:
            rows = (await s.execute(select(Room, RoomMember.role).join(RoomMember, RoomMember.room_id == Room.id).where(
                RoomMember.user_id == user_id, *_ACTIVE, Room.status == "open")
                .order_by(Room.last_active_at.desc(), Room.id))).all()
        return [(r, role) for r, role in rows]

    async def ended_count(self, user_id: int) -> int:
        async with self._sm() as s:
            return int(await s.scalar(select(func.count()).select_from(Room).join(
                RoomMember, RoomMember.room_id == Room.id).where(RoomMember.user_id == user_id, *_ACTIVE,
                                                                 Room.status == "closed")) or 0)

    async def ended(self, user_id: int, after: tuple[datetime, str] | None, limit: int):
        """The user's ended rooms (active member, any age), newest end first, keyset-paged on
        (coalesce(closed_at, last_active_at), id). Returns (rows, next cursor key or None)."""
        ended_at = func.coalesce(Room.closed_at, Room.last_active_at)
        stmt = (select(Room, RoomMember.role, ended_at).join(RoomMember, RoomMember.room_id == Room.id)
                .where(RoomMember.user_id == user_id, *_ACTIVE, Room.status == "closed"))
        if after is not None:
            at, room_id = after
            stmt = stmt.where(or_(ended_at < at, and_(ended_at == at, Room.id < room_id)))
        async with self._sm() as s:
            rows = (await s.execute(stmt.order_by(ended_at.desc(), Room.id.desc()).limit(limit + 1))).all()
        more = len(rows) > limit
        rows = rows[:limit]
        nxt = (as_utc(rows[-1][2]), rows[-1][0].id) if more and rows else None
        return [(r, role) for r, role, _ in rows], nxt
```

(g) `sweep`:把 `if as_utc(room.created_at) <= now - timedelta(hours=self.limits.max_hours):` 改成 `if opened_anchor(room) <= now - timedelta(hours=self.limits.max_hours):`。

- [ ] **Step 5: 改旧测试**:`tests/test_rooms_store.py` 第 164–165 行换成

```python
    assert await store.mine(A, NOW + timedelta(days=6)) == []  # ended rooms moved to `ended` (spec 2026-10-12 §2.2)
    assert [r.id for r, _ in (await store.ended(A, None, 10))[0]] == [room.id]  # no age limit any more
```
- [ ] **Step 6: 运行**:`cd server && uv run pytest -q tests/test_rooms_reopen_store.py tests/test_rooms_store.py tests/test_rooms_store_v2.py tests/test_rooms_rules.py tests/test_architecture.py` → 全绿。
- [ ] **Step 7: Commit**:`feat(server): room store reopen, ended list and opened_at expiry anchor`。

---

### Task S3: 房间路由(`/mine` 增 `ended_count`、`GET /ended`、`POST /{id}/reopen`)与 `reopened` 事件

**Files:**
- Modify: `server/app/rooms/protocol.py`、`server/app/routers/rooms.py`
- Create: `server/tests/test_rooms_reopen_api.py`、`server/tests/test_rooms_reopen_ws.py`
- Modify(单点):`tests/test_rooms_api.py`(第 68 行附近)、`tests/test_rooms_ws.py`(第 225 行)、`tests/test_rooms_summary_api.py`(第 180 行附近)、`tests/test_rooms_protocol_v2.py`(增一行)

**Interfaces:**
- Produces:
  - `protocol.SERVER_EVENT_TYPES` 末尾 `"reopened"`;事件形状 `{"type": "reopened", "room": <room_out, my_role null>}`
  - `GET /api/rooms/mine` → `{"rooms": [...], "ended_count": int}`(开放房间行仍带 `summary_status: null`)
  - `GET /api/rooms/ended?cursor=&limit=` → `{"rooms": [room + summary_status], "next_cursor": str | null}`;非法游标 400 `{"error": "Invalid cursor"}`
  - `POST /api/rooms/{id}/reopen` → `{"room": ...}`;错误:403 `Only the owner can do that` / 403 `Closed by an administrator` / 404 `Room not found` / 409 `Room is not closed` / 429 `Too many rooms` / 503 `Room capacity reached` / 429 `Too many requests, please try again later`
  - `routers.rooms.announce_reopened(rt, room, key, meta)`;`RoomsRuntime.reopen_limiter`

- [ ] **Step 1: 写失败测试**。HTTP(`server/tests/test_rooms_reopen_api.py`):

```python
import logging

import pytest

from app.routers.rooms import runtime
from app.models import utcnow

pytestmark = pytest.mark.parametrize("settings_overrides", [{"rooms_enabled": True}], indirect=True)


async def register(client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, int(r.json()["id"])


async def _ended(client, headers):
    room = (await client.post("/api/rooms", json={"name": "美食角"}, headers=headers)).json()["room"]
    assert (await client.post(f"/api/rooms/{room['id']}/close", headers=headers)).status_code == 200
    await runtime(client._transport.app).hub.drain()  # the summary runner finishes before we look at it
    return room


async def test_mine_hides_ended_rooms_and_counts_them(client, auth_headers):
    ended = await _ended(client, auth_headers)
    live = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    mine = (await client.get("/api/rooms/mine", headers=auth_headers)).json()
    assert [r["id"] for r in mine["rooms"]] == [live["id"]] and mine["ended_count"] == 1
    page = (await client.get("/api/rooms/ended", headers=auth_headers)).json()
    assert [r["id"] for r in page["rooms"]] == [ended["id"]] and page["next_cursor"] is None
    row = page["rooms"][0]
    assert row["status"] == "closed" and row["close_reason"] == "owner" and row["summary_status"] == "none"
    assert row["code"] is None and row["my_role"] == "owner"


async def test_ended_pages_with_a_cursor_and_rejects_a_bad_one(client, auth_headers):
    ids = []
    for _ in range(3):
        ids.append((await _ended(client, auth_headers))["id"])
    first = (await client.get("/api/rooms/ended", params={"limit": 2}, headers=auth_headers)).json()
    assert len(first["rooms"]) == 2 and first["next_cursor"]
    second = (await client.get("/api/rooms/ended", params={"limit": 2, "cursor": first["next_cursor"]}, headers=auth_headers)).json()
    assert sorted(r["id"] for r in first["rooms"] + second["rooms"]) == sorted(ids) and second["next_cursor"] is None
    bad = await client.get("/api/rooms/ended", params={"cursor": "###"}, headers=auth_headers)
    assert bad.status_code == 400 and bad.json() == {"error": "Invalid cursor"}
    assert (await client.get("/api/rooms/ended", params={"limit": 51}, headers=auth_headers)).status_code == 422


async def test_owner_reopens_an_ended_room(client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    ended = await _ended(client, auth_headers)
    r = await client.post(f"/api/rooms/{ended['id']}/reopen", headers=auth_headers)
    assert r.status_code == 200
    room = r.json()["room"]
    assert room["status"] == "open" and len(room["code"]) == 6 and room["close_reason"] is None and room["closed_at"] is None
    assert room["my_role"] == "owner" and room["id"] == ended["id"]
    mine = (await client.get("/api/rooms/mine", headers=auth_headers)).json()
    assert [x["id"] for x in mine["rooms"]] == [ended["id"]] and mine["ended_count"] == 0
    msgs = (await client.get(f"/api/rooms/{ended['id']}/messages", params={"before_seq": 100}, headers=auth_headers)).json()["messages"]
    assert [(m["kind"], m["text"], m["meta"]) for m in msgs] == [("system", "reopened", {"name": "alice"})]
    ticket = await client.post(f"/api/rooms/{ended['id']}/ticket", headers=auth_headers)
    assert ticket.status_code == 200  # a socket can be opened again
    assert room["code"] not in caplog.text and "美食角" not in caplog.text and "alice" not in caplog.text.replace("alice@", "")
    assert ended["id"] in caplog.text  # ids are fine


async def test_reopen_errors(client, auth_headers):
    bob, _ = await register(client, "bob")
    ended = await _ended(client, auth_headers)
    assert (await client.post(f"/api/rooms/{ended['id']}/reopen", headers=bob)).json() == {"error": "Only the owner can do that"}
    assert (await client.post("/api/rooms/nope/reopen", headers=auth_headers)).status_code == 404
    assert (await client.post(f"/api/rooms/{ended['id']}/reopen", headers=auth_headers)).status_code == 200
    again = await client.post(f"/api/rooms/{ended['id']}/reopen", headers=auth_headers)
    assert again.status_code == 409 and again.json() == {"error": "Room is not closed"}  # R-O6: a double tap is harmless
    room = (await client.get(f"/api/rooms/{ended['id']}", headers=auth_headers)).json()["room"]
    assert room["status"] == "open"


async def test_admin_closed_rooms_cannot_be_reopened_by_the_owner(app, client, auth_headers):
    room = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    rt = runtime(app)
    await rt.store.close(room["id"], "admin", utcnow())
    r = await client.post(f"/api/rooms/{room['id']}/reopen", headers=auth_headers)
    assert r.status_code == 403 and r.json() == {"error": "Closed by an administrator"}


async def test_reopen_obeys_the_owner_room_cap_and_the_rate_limit(app, client, auth_headers):
    first = await _ended(client, auth_headers)
    for _ in range(3):  # rooms_max_owned defaults to 3
        assert (await client.post("/api/rooms", json={}, headers=auth_headers)).status_code == 200
    capped = await client.post(f"/api/rooms/{first['id']}/reopen", headers=auth_headers)
    assert capped.status_code == 429 and capped.json() == {"error": "Too many rooms"}
    runtime(app).reopen_limiter.limit = 1
    assert (await client.post(f"/api/rooms/{first['id']}/reopen", headers=auth_headers)).status_code == 429  # 1st call counted above
    limited = await client.post(f"/api/rooms/{first['id']}/reopen", headers=auth_headers)
    assert limited.json() == {"error": "Too many requests, please try again later"}
```
注:`test_reopen_obeys…` 第一次 `reopen`(`too_many`)会消耗限流计数;`limit=1` 之后第二次必 429——写测试时按实际 `RateLimiter.allow` 语义(窗口内第 `limit+1` 次拒绝)核对,必要时在设 `limit` 之前先 `reopen_limiter` 重新实例化(`RateLimiter(1, 60)`),断言以「超限返回该句文案」为准。

WS(`server/tests/test_rooms_reopen_ws.py`,同步风格,复用 `tests.test_rooms_ws` 的 `rooms_client / login / until`):

```python
import json
from pathlib import Path

from app.rooms.hub import Conn
from app.routers import rooms as rooms_router
from tests.test_rooms_ws import login, rooms_client, until  # noqa: F401  (rooms_client is a fixture)


class Recorder:
    """A hub connection that just records frames (nobody can be on a socket of an ended room, R-O3)."""

    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, data):
        self.sent.append(data)

    async def close(self, code):
        pass


def test_reopen_broadcasts_reopened_and_the_room_accepts_sockets_again(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    room = client.post("/api/rooms", json={"name": "美食角"}, headers=alice).json()["room"]
    assert client.post(f"/api/rooms/{room['id']}/close", headers=alice).status_code == 200
    rt = rooms_router.runtime(app)
    client.portal.call(rt.hub.drain)
    seen = Recorder()
    assert rt.hub.attach(room["id"], Conn(alice_id, seen))
    reopened = client.post(f"/api/rooms/{room['id']}/reopen", headers=alice).json()["room"]
    assert [e["type"] for e in seen.sent] == ["reopened", "message"]
    event = seen.sent[0]
    assert event["room"]["id"] == room["id"] and event["room"]["status"] == "open" and event["room"]["code"] == reopened["code"]
    assert event["room"]["my_role"] is None and seen.sent[1]["message"]["text"] == "reopened"
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as ws:
        ws.send_text('{"type":"hello","last_seq":0,"v":2}')
        welcome = until(ws, "welcome")[-1]
        assert welcome["room"]["status"] == "open" and welcome["room"]["code"] == reopened["code"]
```
- [ ] **Step 2: 运行确认失败**:`cd server && uv run pytest -q tests/test_rooms_reopen_api.py tests/test_rooms_reopen_ws.py` → FAIL。
- [ ] **Step 3: `protocol.py`**:`SERVER_EVENT_TYPES` 元组末尾追加 `"reopened"`(`"join_request_closed", "reopened",`);模块文档第二段末尾加一句 `; v2.1 adds the server event `reopened` (an ended room was reopened; spec 2026-10-12)`。`tests/test_rooms_protocol_v2.py` 第 48 行集合里加 `"reopened"`。
- [ ] **Step 4: `routers/rooms.py`**:

(a) `ROOM_ERRORS` 末尾加:

```python
    "not_closed": (409, "Room is not closed"), "admin_closed": (403, "Closed by an administrator"),
    "no_owner": (409, "Room has no owner"),
```
(b) `RoomsRuntime` 在 `react_limiter` 之后加 `reopen_limiter: RateLimiter | None = None  # reopen: 5/minute per user (R-O10)`;`reconfigure` 里在 `react_limiter` 判断之后加:

```python
        if self.reopen_limiter is not None:
            self.reopen_limiter.limit = limits.reopen_per_minute
```
`runtime()` 构造 `react_limiter=...` 之后加 `reopen_limiter=RateLimiter(limits.reopen_per_minute, 60)`(注意前一个参数括号后加逗号)。
(c) 导入 `from app.rooms.store import RoomError, RoomStore, decode_cursor, encode_cursor, message_out, room_out`。
(d) 替换 `/mine` 并在其后(`/{room_id}` 路由之前)加 `/ended`:

```python
@router.get("/mine")
async def my_rooms(request: Request, user: User = Depends(current_user), _: Settings = Depends(require_rooms)):
    """Open rooms only (spec 2026-10-12 §2.2); `ended_count` feeds the lobby's "Ended rooms (N)" entry."""
    rt = runtime(request.app)
    rows = await rt.store.mine(user.id, utcnow())
    return {"rooms": [{**await _room_json(rt, room, role), "summary_status": None} for room, role in rows],
            "ended_count": await rt.store.ended_count(user.id)}


@router.get("/ended")
async def ended_rooms(request: Request, cursor: str = Query("", max_length=160), limit: int = Query(20, ge=1, le=50),
                      user: User = Depends(current_user), _: Settings = Depends(require_rooms)):
    """Every ended room of the caller (active member), newest end first; keyset cursor (R-O12)."""
    rt = runtime(request.app)
    try:
        after = decode_cursor(cursor) if cursor else None
    except ValueError:
        return JSONResponse({"error": "Invalid cursor"}, status_code=400)
    rows, nxt = await rt.store.ended(user.id, after, limit)
    summaries = await rt.store.summary_statuses([room.id for room, _ in rows])
    return {"rooms": [{**await _room_json(rt, room, role), "summary_status": summaries.get(room.id, "none")}
                      for room, role in rows],
            "next_cursor": encode_cursor(*nxt) if nxt else None}
```
(e) 辅助与 `reopen` 路由(放在 `close_room` 之后):

```python
async def announce_reopened(rt: RoomsRuntime, room, key: str, meta: dict) -> None:
    """Tell the room an ended room is open again: the `reopened` event to live connections (usually none, R-O3), then
    one public system message (kept forever). Shared by the owner and the admin endpoint."""
    await rt.hub.broadcast(room.id, event("reopened", room=await _room_json(rt, room, None)))
    await system_message(rt, room.id, key, meta)


@router.post("/{room_id}/reopen")
async def reopen_room(room_id: str, request: Request, user: User = Depends(current_user),
                      _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    if rt.reopen_limiter is not None and not rt.reopen_limiter.allow(str(user.id)):
        raise HTTPException(429, "Too many requests, please try again later")
    room_id = room_id[:MAX_ID]
    async with request.app.state.sessionmaker() as s:
        max_owned = await effective(s, request.app, user.id, "rooms_max_owned")
    try:
        room = await rt.store.reopen(room_id, user.id, utcnow(), max_owned=max_owned)
    except RoomError as e:
        _raise(e)
    await announce_reopened(rt, room, "reopened", {"name": user.username})
    logger.info("rooms reopened room=%s count=%d", room.id, room.reopen_count)
    return {"room": await _room_json(rt, room, "owner")}
```
- [ ] **Step 5: 改旧测试**:`test_rooms_api.py` 约第 68 行:最后两行改为 `mine = …json()`,`assert mine["rooms"] == [] and mine["ended_count"] == 1`;`test_rooms_ws.py` 约第 225 行:改成 `assert client.get("/api/rooms/mine", headers=alice).json()["rooms"] == []` 并追加 `assert [r["status"] for r in client.get("/api/rooms/ended", headers=alice).json()["rooms"]] == ["closed"]`;`test_rooms_summary_api.py` 约第 180 行:把 `/mine` 改为 `/ended`(`rows = {…for r in …/api/rooms/ended…["rooms"]}`),`live` 的断言(`is None`)改为 `assert live["id"] not in rows`,并另取 `/mine` 断言 `summary_status is None`。
- [ ] **Step 6: 运行**:`cd server && uv run pytest -q tests/test_rooms_reopen_api.py tests/test_rooms_reopen_ws.py tests/test_rooms_api.py tests/test_rooms_ws.py tests/test_rooms_summary_api.py tests/test_rooms_protocol.py tests/test_rooms_protocol_v2.py tests/test_architecture.py` → 全绿(契约测试在 S6 重录前会因 `close_reason` 键失败,放到 S6 一起处理;本步先不跑它们)。
- [ ] **Step 7: Commit**:`feat(server): reopen ended rooms, ended-rooms list and the reopened event`。

---

### Task S4: 学习小结:重新开启后再次结束时重新生成,失败不丢旧小结

**Files:**
- Modify: `server/app/rooms/summary_store.py`、`server/app/routers/rooms_summary.py`
- Create: `server/tests/test_rooms_summary_reopen.py`

**Interfaces:**
- Produces:
  - `SummaryStore.start(room_id, now, max_attempts, *, resume=False, since: datetime | None = None) -> bool`(`since` 给出时,`created_at < since` 的 `done/skipped/failed` 行被认领为 `pending`、`attempts=1`、`created_at=now`,`data` 保留)
  - `SummaryStore.fail / skip`:行内 `data` 非空时改为 `status="done", reason="stale"`
  - `SummaryRunner.opened_of: Callable[[str], Awaitable[datetime | None]] | None = None`
  - `retry` 端点接受 `done + stale`

- [ ] **Step 1: 写失败测试** `server/tests/test_rooms_summary_reopen.py`(复用 `tests/test_rooms_summary_runner.py` 的 `GOOD`、`A`、夹具思路,这里自带最小夹具):

```python
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest

from app.models import User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore, opened_anchor
from app.rooms.summary_store import SummaryRunner, SummaryStore

T0 = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A = 11111111


def good(word):
    return json.dumps({"overview_zh": f"聊了{word}。", "words": [{"en": word, "zh": "词", "example": f"I like {word}."}], "fixes": []})


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=A, username="alice", password_hash="x"))
        await s.commit()
    rooms = RoomStore(app.state.sessionmaker, RoomLimits(max_owned=5))
    room = await rooms.create(A, "", T0)
    st = {"now": T0, "raw": good("noodles"), "fail": False, "quota": 99}

    async def complete(messages, max_tokens, temperature):
        if st["fail"]:
            raise RuntimeError("upstream")
        return st["raw"]

    async def consume(scope, subject, limit):
        st["quota"] -= 1
        return st["quota"] >= 0

    async def refund(scope, subject):
        st["quota"] += 1

    async def template(key):
        return None

    async def room_info(_id):
        return ("B1", "Free conversation.", "alice")

    async def opened_of(room_id):
        r = await rooms.room(room_id)
        return opened_anchor(r) if r.reopen_count else None

    store = SummaryStore(app.state.sessionmaker)
    runner = SummaryRunner(store=store, complete=complete, consume=consume, refund=refund, template=template,
                           room_info=room_info, limits=lambda: RoomLimits(summary_min_messages=2),
                           available=lambda: True, model=lambda: "m", clock=lambda: st["now"], opened_of=opened_of)
    return rooms, room, store, runner, st


async def say(rooms, room, n, at, prefix="I go"):
    for i in range(n):
        await rooms.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text=f"{prefix} {i}", now=at)


async def end_and_reopen(rooms, room, st, hours):
    await rooms.close(room.id, "owner", st["now"])
    st["now"] = st["now"] + timedelta(hours=hours)
    await rooms.reopen(room.id, A, st["now"])


async def test_second_close_regenerates_and_overwrites(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    assert await runner.run(room.id) == "done"
    first = await store.get(room.id)
    assert first.data["words"][0]["en"] == "noodles"
    await end_and_reopen(rooms, room, st, 1)
    await say(rooms, room, 3, st["now"], prefix="Then")
    await rooms.close(room.id, "owner", st["now"] + timedelta(minutes=5))
    st["now"] += timedelta(minutes=5)
    st["raw"] = good("coffee")
    assert await runner.run(room.id) == "done"
    row = await store.get(room.id)
    assert row.status == "done" and row.reason is None and row.data["words"][0]["en"] == "coffee"
    assert row.attempts == 1 and row.created_at > first.created_at


async def test_regeneration_failure_keeps_the_old_summary_readable(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    old = (await store.get(room.id)).data
    await end_and_reopen(rooms, room, st, 1)
    await rooms.close(room.id, "idle", st["now"])
    st["fail"] = True
    assert await runner.run(room.id) == "failed"  # the run reports what happened ...
    row = await store.get(room.id)
    assert (row.status, row.reason, row.data) == ("done", "stale", old)  # ... the stored summary is the old one (R-O5)
    assert "noodles" not in caplog.text and "I go" not in caplog.text and room.id in caplog.text


async def test_stale_summary_can_be_retried_while_attempts_remain(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    await end_and_reopen(rooms, room, st, 1)
    await rooms.close(room.id, "owner", st["now"])
    st["fail"] = True
    await runner.run(room.id)
    assert await store.start(room.id, st["now"], 2) is True  # attempts 1 < 2: the retry endpoint may claim it
    st["fail"] = False
    st["raw"] = good("tea")
    assert await runner.generate(room.id) == "done"
    row = await store.get(room.id)
    assert row.status == "done" and row.reason is None and row.data["words"][0]["en"] == "tea" and row.attempts == 2
    st["fail"] = True
    await store.start(room.id, st["now"], 2)  # no: attempts exhausted
    assert (await store.get(room.id)).attempts == 2


async def test_a_room_that_was_never_reopened_is_not_regenerated(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    st["raw"] = good("coffee")
    assert await runner.run(room.id) == "done"
    assert (await store.get(room.id)).data["words"][0]["en"] == "noodles"


async def test_a_skipped_first_summary_is_regenerated_after_a_busier_second_session(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 1, T0)  # too few messages
    assert await runner.run(room.id) == "skipped"
    await end_and_reopen(rooms, room, st, 1)
    await say(rooms, room, 4, st["now"], prefix="More")
    await rooms.close(room.id, "owner", st["now"])
    assert await runner.run(room.id) == "done"
    assert (await store.get(room.id)).data["words"][0]["en"] == "noodles"


async def test_regeneration_still_spends_the_daily_budget(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    spent = 99 - st["quota"]
    await end_and_reopen(rooms, room, st, 1)
    await rooms.close(room.id, "owner", st["now"])
    st["quota"] = 0
    await runner.run(room.id)
    row = await store.get(room.id)
    assert (row.status, row.reason) == ("done", "stale") and spent == 2  # owner + global counts; quota out -> old kept
```
- [ ] **Step 2: 运行确认失败**:`cd server && uv run pytest -q tests/test_rooms_summary_reopen.py` → FAIL(`opened_of` 不是字段)。
- [ ] **Step 3: `summary_store.py`**:

(a) 导入加 `and_`:`from sqlalchemy import and_, or_, select, update`。
(b) 用下面整段替换 `start`:

```python
    async def start(self, room_id: str, now: datetime, max_attempts: int, *, resume: bool = False,
                    since: datetime | None = None) -> bool:
        """Claim a generation: a new row becomes `pending` (attempts 1); a `failed` row (or a `done` row marked
        `stale`, see `fail`) with attempts left goes back to `pending` (attempts + 1). With `resume` (startup only) a
        `pending` row left by a restart with attempts left is claimed too. With `since` (the room's reopen time, R-O5):
        a row first claimed BEFORE it covers an earlier session, so a `done / skipped / failed` row is claimed for a
        fresh generation (attempts 1, created_at now) and its old `data` stays in place until `finish` overwrites it.
        Atomic, so a close listener and a retry cannot both generate."""
        if max_attempts <= 0:
            return False
        async with self._sm() as s:
            if await s.get(RoomSummary, room_id) is None:
                s.add(RoomSummary(room_id=room_id, status="pending", reason=None, attempts=1, created_at=now))
                try:
                    await s.commit()
                    return True
                except IntegrityError:  # someone else created it first
                    await s.rollback()
            if since is not None:
                result = await s.execute(
                    update(RoomSummary).where(RoomSummary.room_id == room_id,
                                              RoomSummary.status.in_(("done", "skipped", "failed")),
                                              RoomSummary.created_at < since)
                    .values(status="pending", reason=None, attempts=1, created_at=now, finished_at=None))
                await s.commit()
                if result.rowcount == 1:
                    return True
            states = ("failed", "pending") if resume else ("failed",)
            claimable = or_(RoomSummary.status.in_(states),
                            and_(RoomSummary.status == "done", RoomSummary.reason == "stale"))
            result = await s.execute(
                update(RoomSummary).where(RoomSummary.room_id == room_id, claimable,
                                          RoomSummary.attempts < max_attempts)
                .values(status="pending", reason=None, attempts=RoomSummary.attempts + 1, finished_at=None))
            await s.commit()
            return result.rowcount == 1
```
(c) 替换 `fail` / `skip`:

```python
    async def _end_row(self, room_id: str, status: str, reason: str, now: datetime) -> None:
        """`failed` / `skipped` for a first summary. A row that already holds a summary (`data` is set: a
        regeneration after a reopen) goes back to `done` with reason `stale`, so the previous summary stays
        readable (R-O5); `data` is never cleared."""
        async with self._sm() as s:
            row = await s.get(RoomSummary, room_id)
            if row is None:
                return
            if row.data is not None:
                row.status, row.reason = "done", "stale"
            else:
                row.status, row.reason = status, reason
            row.finished_at = now
            await s.commit()

    async def fail(self, room_id: str, reason: str, now: datetime) -> None:
        await self._end_row(room_id, "failed", reason, now)

    async def skip(self, room_id: str, reason: str, now: datetime) -> None:
        await self._end_row(room_id, "skipped", reason, now)
```
(d) `SummaryRunner` 字段末尾加 `opened_of: Callable[[str], Awaitable[datetime | None]] | None = None  # reopen time, only for reopened rooms`;`run` 里把 `if not await self.store.start(room_id, self.clock(), self.limits().summary_attempts, resume=resume):` 改为

```python
        since = await self.opened_of(room_id) if self.opened_of is not None else None
        if not await self.store.start(room_id, self.clock(), self.limits().summary_attempts, resume=resume,
                                      since=since):
```
(e) `rooms_summary.py`:导入 `from app.rooms.store import RoomError, opened_anchor`;`_runner` 里加

```python
    async def opened_of(room_id: str):
        room = await rt.store.room(room_id)
        return None if room is None or not room.reopen_count else opened_anchor(room)
```
并在 `SummaryRunner(...)` 末尾加 `opened_of=opened_of`;`retry_summary` 里把条件 `row.status != "failed"` 改为 `not (row.status == "failed" or (row.status == "done" and row.reason == "stale"))`(整行条件按下面写):

```python
    retryable = row is not None and (row.status == "failed" or (row.status == "done" and row.reason == "stale"))
    if room.status == "open" or not retryable \
            or not await runner.store.start(room.id, utcnow(), rt.limits.summary_attempts):
        raise HTTPException(409, "Cannot retry")
```
- [ ] **Step 4: 运行**:`cd server && uv run pytest -q tests/test_rooms_summary_reopen.py tests/test_rooms_summary_runner.py tests/test_rooms_summary_api.py tests/test_rooms_summary.py tests/test_architecture.py` → 全绿(现有测试里 `fail/skip` 的行 `data` 都是 None,行为不变)。
- [ ] **Step 5: 在 `server/app/rooms/CLAUDE.md` 的 summary 说明里补一句**(完整文案在 S6 一起写)。
- [ ] **Step 6: Commit**:`feat(server): regenerate the learning summary after a reopen and keep the old one on failure`。

---

### Task S5: 管理员重新开启端点(审计)

**Files:**
- Modify: `server/app/routers/admin_rooms.py`、`server/app/admin/rooms_admin.py`
- Create: `server/tests/test_admin_rooms_reopen.py`

**Interfaces:**
- Produces:`POST /api/admin/rooms/{room_id}/reopen`(`operator`,body `{reason}`)→ `{"ok": true, "reopen_count": int}`;审计 `room.reopen`(`target_type="room"`,`after={"reopen_count": n}`,`reason`);错误 404 `Room not found`、409 `Room is not closed` / `Room has no owner` / `Owner has too many open rooms` / `Room capacity reached`。管理员房间行多 `opened_at`、`reopen_count`。

- [ ] **Step 1: 写失败测试** `server/tests/test_admin_rooms_reopen.py`:

```python
import json
import logging

import pytest
from sqlalchemy import select

from app.models import AdminAudit, Room, utcnow
from app.routers.rooms import runtime
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "rooms_enabled": True, "data_dir": str(tmp_path / "data")}


async def _closed(app, client, headers, reason="admin"):
    room = (await client.post("/api/rooms", headers=headers, json={"topic": "美食"})).json()["room"]
    await runtime(app).store.close(room["id"], reason, utcnow())
    return room


async def _audits(app):
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).where(AdminAudit.action == "room.reopen"))).all())


async def test_operator_reopens_an_admin_closed_room_with_an_audit_row(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    _, ha = await register(client, "alice")
    room = await _closed(app, client, ha)
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=h, json={"reason": "误关闭,已和房主确认"})
    assert r.status_code == 200 and r.json() == {"ok": True, "reopen_count": 1}
    async with app.state.sessionmaker() as s:
        row = await s.get(Room, room["id"])
    assert row.status == "open" and len(row.code) == 6 and row.close_reason is None and row.reopen_count == 1
    audits = await _audits(app)
    assert len(audits) == 1 and audits[0].target_id == room["id"] and audits[0].reason == "误关闭,已和房主确认"
    assert json.loads(audits[0].after) == {"reopen_count": 1} if isinstance(audits[0].after, str) else audits[0].after == {"reopen_count": 1}
    assert row.code not in json.dumps(r.json()) and row.code not in caplog.text
    detail = (await client.get(f"/api/admin/rooms/{room['id']}", headers=h)).json()
    assert detail["reopen_count"] == 1 and detail["opened_at"] is not None and detail["status"] == "open"


async def test_reopen_requires_operator_a_reason_and_a_closed_room(app, client):
    _, ha = await register(client, "alice")
    room = await _closed(app, client, ha)
    hv = await login_as(app, client, "viewer")
    assert (await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=hv, json={"reason": "x"})).status_code == 403
    ho = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=ho, json={})).status_code == 422
    assert (await client.post("/api/admin/rooms/nope/reopen", headers=ho, json={"reason": "x"})).status_code == 404
    ok = await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=ho, json={"reason": "再开"})
    assert ok.status_code == 200
    again = await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=ho, json={"reason": "再开"})
    assert again.status_code == 409 and again.json() == {"error": "Room is not closed"}
    assert len(await _audits(app)) == 1  # the failed attempt wrote nothing


async def test_reopen_obeys_the_owner_quota_and_needs_an_owner(app, client):
    _, ha = await register(client, "alice")
    first = await _closed(app, client, ha, reason="owner")
    for _ in range(3):
        await client.post("/api/rooms", headers=ha, json={})
    ho = await login_as(app, client, "operator")
    capped = await client.post(f"/api/admin/rooms/{first['id']}/reopen", headers=ho, json={"reason": "x"})
    assert capped.status_code == 409 and capped.json() == {"error": "Owner has too many open rooms"}
    async with app.state.sessionmaker() as s:
        (await s.get(Room, first["id"])).owner_id = None
        await s.commit()
    nobody = await client.post(f"/api/admin/rooms/{first['id']}/reopen", headers=ho, json={"reason": "x"})
    assert nobody.status_code == 409 and nobody.json() == {"error": "Room has no owner"}
    assert await _audits(app) == []
```
注:`AdminAudit.after` 的存储类型以 `app/models.py` 为准(JSON 列则直接是 dict);写测试时按实际类型保留一条断言,删掉另一个分支。

- [ ] **Step 2: 运行确认失败**:`cd server && uv run pytest -q tests/test_admin_rooms_reopen.py` → FAIL。
- [ ] **Step 3: `rooms_admin.py`**:`_room_row` 返回字典末尾(`close_reason` 之后)加 `, "opened_at": _iso(room.opened_at or room.created_at), "reopen_count": int(room.reopen_count or 0)`。
- [ ] **Step 4: `routers/admin_rooms.py`**:导入 `from app.core.quotas import effective`;`from app.routers.rooms import (RoomsRuntime, after_close, announce_reopened, presence, runtime, settle_requests, system_message, _room_json)`;在 `close_room` 之后加:

```python
REOPEN_ERRORS = {"not_found": (404, "Room not found"), "not_closed": (409, "Room is not closed"),
                 "no_owner": (409, "Room has no owner"), "too_many": (409, "Owner has too many open rooms"),
                 "capacity": (409, "Room capacity reached")}


@router.post("/rooms/{room_id}/reopen")
async def reopen_room(room_id: RoomId, payload: ReasonIn, request: Request,
                      ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    """Reopens an ended room, including one an operator closed (R-O9). Same caps as the owner path, using the owner's
    effective quota (R-O7). Audited after the store applied it (`room.reopen`, count only)."""
    rt = runtime(request.app)
    before = await rt.store.room(room_id)
    if before is None:
        raise HTTPException(404, "Room not found")
    max_owned = None if before.owner_id is None else await effective(session, request.app, before.owner_id,
                                                                     "rooms_max_owned")
    try:
        room = await rt.store.reopen(room_id, None, utcnow(), max_owned=max_owned, admin=True)
    except RoomError as e:
        status, message = REOPEN_ERRORS.get(e.code, (409, "Cannot reopen"))
        raise HTTPException(status, message) from None
    await announce_reopened(rt, room, "reopened_admin", {})
    await rooms_admin.record(session, ctx.actor, "room.reopen", room_id, after={"reopen_count": room.reopen_count},
                             reason=payload.reason)
    return {"ok": True, "reopen_count": room.reopen_count}
```
- [ ] **Step 5: 运行**:`cd server && uv run pytest -q tests/test_admin_rooms_reopen.py tests/test_admin_rooms.py tests/test_admin_rooms_v2.py tests/test_admin_routes_guarded.py tests/test_architecture.py` → 全绿(`test_admin_routes_guarded` 确认新路由声明了角色)。
- [ ] **Step 6: Commit**:`feat(server): admin room reopen endpoint with audit`。

---

### Task S6: 契约夹具重录、服务端文档

**Files:**
- Create: `server/tests/fixtures/rooms_reopen_contract.json`(由测试写出)、`server/tests/test_rooms_reopen_contract.py`
- Modify: 重录 `server/tests/fixtures/rooms_contract.json`、`rooms_v2_core_contract.json`、`rooms_v2_voice_contract.json`、`rooms_v2_summary_contract.json`;`server/app/rooms/CLAUDE.md`、`server/app/routers/CLAUDE.md`

- [ ] **Step 1: 写契约测试** `server/tests/test_rooms_reopen_contract.py`(沿用 `test_rooms_v2_core_contract.py` 的 `collect / shape / CONTRACT_UPDATE` 套路;`reopened` 事件用 S3 的 Recorder 录制):

```python
"""Contract for the reopen endpoints and the `reopened` event (plan 2026-10-12-rooms-reopen S6).
web/src/features/rooms/rooms-reopen-contract.test.ts reads it. The new room code is a live value: stored as <redacted>."""
import json
import os
from pathlib import Path

from app.rooms.hub import Conn
from app.routers import rooms as rooms_router
from tests.test_rooms_reopen_ws import Recorder
from tests.test_rooms_ws import login, make_client
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_reopen_contract.json"


def collect(app, client) -> dict:
    alice, alice_id = login(client, "alice")
    room = client.post("/api/rooms", json={"name": "美食角"}, headers=alice).json()["room"]
    client.post(f"/api/rooms/{room['id']}/close", headers=alice)
    rt = rooms_router.runtime(app)
    client.portal.call(rt.hub.drain)
    http = {"ended": client.get("/api/rooms/ended", headers=alice).json()}
    recorder = Recorder()
    rt.hub.attach(room["id"], Conn(alice_id, recorder))
    http["reopen"] = client.post(f"/api/rooms/{room['id']}/reopen", headers=alice).json()
    http["mine"] = client.get("/api/rooms/mine", headers=alice).json()
    ws = {"reopened": recorder.sent[0], "message_system": recorder.sent[1]}
    for payload in (http["reopen"]["room"], ws["reopened"]["room"]):
        payload["code"] = "<redacted>"
    return {"http": http, "ws": ws}


def test_reopen_payloads_match_the_web_contract(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        actual = collect(app, client)
    finally:
        client.__exit__(None, None, None)
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(shape(actual), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert shape(actual) == json.loads(FIXTURE.read_text(encoding="utf-8"))
```
(`shape` 的签名以 `tests/test_web_contract.py` 为准:与 `test_rooms_v2_core_contract.py` 末尾的写法一致,实现时照抄那里的写入/比较两行。)

- [ ] **Step 2: 重录**:`cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_rooms_reopen_contract.py tests/test_web_contract.py tests/test_rooms_v2_core_contract.py tests/test_rooms_v2_voice_contract.py tests/test_rooms_summary_api.py`,再不带变量跑一遍确认全绿;`git diff server/tests/fixtures` 逐个核对:旧夹具只应多出 `close_reason` 键(R-O11),`rooms_contract.json` 的 `mine` 多 `ended_count`,**没有任何其它键变化**;新夹具含 `ended`、`reopen`、`mine`、`reopened`、`message_system`。
- [ ] **Step 3: 文档**。`server/app/rooms/CLAUDE.md`:`store.py` 条目补「reopen / ended / ended_count / opened_anchor,`mine` 只列开放房间」;`summary_store.py` 条目补「重新开启后按 `created_at < opened_at` 重新认领;`fail/skip` 在已有小结时恢复为 `done`+`stale`」;Pitfalls 追加(每条一行):

```
- 重新开启(spec 2026-10-12):`reopen` 在 `_admission` 锁内完成,第二个并发请求得到 `not_closed`;过期锚点用 `opened_anchor(room)`
  (= `coalesce(opened_at, created_at)`,`opened_at` 永远可空,R-O1),别直接读 `created_at`;已结束房间没有 WebSocket,
  `reopened` 事件通常没有接收者,网页靠轮询 `GET /api/rooms/{id}`(R-O3);`admin` 关闭的房间只有 `POST /api/admin/rooms/{id}/reopen` 能开;
  重新开启清空 `invite_token`、换新房间码,日志与审计不写房间码/名字。
- 小结行的 `data` 永不清空:重新生成失败时行回到 `done`+`stale`(旧小结可读),`stale` 在 `summary_attempts` 内可重试(R-O5)。
- `RoomLimits.mine_closed_days` 已不影响任何列表(R-O4),只剩默认值断言。
```
`server/app/routers/CLAUDE.md` 的 `rooms` 条目改为 `rooms` (/api/rooms/*, incl. `ended`, `{id}/reopen`; WS /api/rooms/ws),`admin_rooms` 条目补 reopen;`server/app/CLAUDE.md` 的 `rooms/` 行补 `reopen` 一词(迁移头已在 S1 改)。
- [ ] **Step 4: 运行**:`cd server && uv run pytest -q tests/test_rooms_*.py tests/test_web_contract.py tests/test_admin_rooms*.py tests/test_architecture.py tests/test_migrations.py`(分两批跑,避免超时)→ 全绿。
- [ ] **Step 5: Commit**:`test(server): reopen contract fixtures and room docs`。

---

## Lane web (W)

### Task W1: 协议镜像与房间状态机(`reopened`、`reset`、重连、只读轮询)

**Files:**
- Modify: `web/src/features/rooms/protocol.ts`、`room-state.ts`、`use-room.ts`、`room-fixtures.ts`
- Modify(测试):`protocol.test.ts`(无需改动逻辑,它读 `protocol.py` 的元组并要求与 TS 同序,S3 合并后即生效)、`room-state.test.ts`(追加)、`room-page.test.tsx`(追加)

**Interfaces:**
- Produces:`RoomEvent` 新成员 `{ type: "reopened"; room: RoomInfo }`;`RoomInfo.closeReason?: string | null`;`RoomState.reopenSignal: number`;`RoomAction` 新成员 `{ type: "reset" }`;`useRoom` 返回多一个 `reopened(room: RoomInfo): void`;导出 `REOPEN_POLL_MS = 20_000`。

- [ ] **Step 1: 写失败测试**。`room-state.test.ts` 追加:

```ts
describe("reopened rooms (R-O3)", () => {
  const closed = roomReducer(initialRoomState(), { type: "event", event: { type: "closed", reason: "owner" } });
  it("a reopened event updates the room and raises the reconnect signal once per event", () => {
    const room = { ...ROOM_INFO, status: "open" as const, code: "573920", closeReason: null };
    const next = roomReducer(closed, { type: "event", event: { type: "reopened", room } });
    expect(next.room?.code).toBe("573920");
    expect(next.reopenSignal).toBe(closed.reopenSignal + 1);
    expect(next.status).toBe("closed"); // the hook resets and reconnects; the reducer does not pretend to be live
  });
  it("reset returns to a fresh connecting state but keeps the signal counter (no reconnect loop)", () => {
    const signalled = roomReducer(closed, { type: "event", event: { type: "reopened", room: { ...ROOM_INFO, status: "open" } } });
    const reset = roomReducer(signalled, { type: "reset" });
    expect(reset.status).toBe("connecting");
    expect(reset.closeReason).toBeNull();
    expect(reset.messages).toEqual([]);
    expect(reset.lastSeq).toBe(0);
    expect(reset.reopenSignal).toBe(signalled.reopenSignal);
  });
});
```
(`ROOM_INFO` 用该文件里现有的 `RoomInfo` 样例;若没有,在测试顶部按 `RoomInfo` 类型写一份,含 `closeReason: null`。)

`room-page.test.tsx` 追加(用文件内已有的 `setup / live / FakeWebSocket`;计时器用 `vi.useFakeTimers({ shouldAdvanceTime: true })` 并在 `finally` 里 `vi.useRealTimers()`):

```tsx
  it("a read-only member goes live by itself when the room is reopened (polls the room, R-O3)", async () => {
    let opened = false;
    setup({
      "POST /api/rooms/r1/ticket": () => (opened ? json({ ticket: "t2", expires_in: 60 }) : json({ error: "Room not found" }, 404)),
      "GET /api/rooms/r1": () => json({ room: { ...ROOM, my_role: "member", ...(opened ? {} : { status: "closed", code: null, close_reason: "owner" }) }, members: MEMBERS }),
      "GET /api/rooms/r1/messages": () => json({ messages: [user(7, "See you!")] }),
    });
    expect(await screen.findByText("See you!")).toBeTruthy();
    expect(FakeWebSocket.count).toBe(0);
    opened = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    await waitFor(() => expect(FakeWebSocket.count).toBe(1));
  });
```
在该 `it` 之前用 `vi.useFakeTimers({ shouldAdvanceTime: true })`,`it` 末尾 `vi.useRealTimers()`(或放进 `try/finally`)。

- [ ] **Step 2: 运行确认失败**:`cd web && yarn vitest run src/features/rooms/room-state.test.ts src/features/rooms/room-page.test.tsx src/features/rooms/protocol.test.ts` → FAIL。
- [ ] **Step 3: `protocol.ts`**:
  - `ROOM_SERVER_EVENT_TYPES` 末尾 `"join_request_closed"` 之后追加 `"reopened"`(与 `protocol.py` 同序);
  - `RoomInfo` 末尾加 `/** 结束原因(owner / idle / expired / admin);开放房间为 null。管理员关闭的房间房主不能自己重新开启 */ closeReason?: string | null;`;
  - `RoomEvent` 末尾加 `| { type: "reopened"; room: RoomInfo };`(接在 `join_request_closed` 之后)。
- [ ] **Step 4: `room-state.ts`**:
  - `RoomState` 加 `/** 收到 reopened 事件的次数:use-room 据此重置并重连(轮询或房主本人触发时也走这条) */ reopenSignal: number;`,`initialRoomState` 里 `reopenSignal: 0`;
  - `RoomAction` 加 `/** 重新开启后重连:回到初始状态(保留 reopenSignal,否则会再次触发) */ | { type: "reset" }`;
  - `onEvent` 的 switch 里加:

```ts
    case "reopened":
      return { ...s, room: { ...e.room, myRole: e.room.myRole ?? s.room?.myRole ?? null }, reopenSignal: s.reopenSignal + 1 };
```
  - `roomReducer` 的 switch 里加 `case "reset": return { ...initialRoomState(), reopenSignal: s.reopenSignal };`。
- [ ] **Step 5: `use-room.ts`**:
  - 导入 `useState`;`export const REOPEN_POLL_MS = 20_000;`
  - 在组件里 `const [epoch, setEpoch] = useState(0);`,把连接 effect 的依赖数组改为 `[api, roomId, epoch]`;
  - 在 `needsHistory` effect 之后加:

```ts
  const restart = useCallback(() => { dispatch({ type: "reset" }); setEpoch((n) => n + 1); }, []);
  // 收到 reopened(轮询、房主本人或将来的推送)→ 重置状态并重新取票连接
  useEffect(() => { if (state.reopenSignal > 0) restart(); }, [state.reopenSignal, restart]);
  // 只读查看者没有 socket:每 20 秒(页面可见时)读一次房间,开放了就合成 reopened(R-O3)
  const watching = state.status === "closed" && state.room !== null && state.closeReason !== "kicked";
  useEffect(() => {
    if (!watching) return;
    const ctrl = new AbortController();
    const check = () => {
      getRoom(api, roomId, ctrl.signal).then(({ room }) => {
        if (room.status === "open") dispatch({ type: "event", event: { type: "reopened", room } });
      }, (): void => undefined); // 取不到就等下一轮
    };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") check(); }, REOPEN_POLL_MS);
    return () => { window.clearInterval(timer); ctrl.abort(); };
  }, [watching, api, roomId]);
```
  - 返回值加 `reopened`:`const reopened = useCallback((room: RoomInfo) => dispatch({ type: "event", event: { type: "reopened", room } }), []);` 并放进 `return { …, reopened }`。
- [ ] **Step 6: `room-fixtures.ts`**:`ROOM` 末尾加 `close_reason: null as string | null`(其余样例保持)。
- [ ] **Step 7: 运行**:`cd web && yarn vitest run src/features/rooms/room-state.test.ts src/features/rooms/room-page.test.tsx src/features/rooms/protocol.test.ts && yarn web:typecheck`(`protocol.test.ts` 在 S3 合并前会因元组不一致失败——W1 在 S3 之后 rebase 再跑;本地开发先让 S3 的 `protocol.py` 改动在工作树里)→ 全绿。
- [ ] **Step 8: Commit**:`feat(web): reopened event, reconnect after reopen and read-only polling`。

---

### Task W2: API 层(已结束分页、重新开启、大厅概览)与错误文案

**Files:**
- Modify: `web/src/features/rooms/rooms-api.ts`、`rooms-api.test.ts`
- Create: `web/src/features/rooms/ended/i18n/zh-CN.json`、`ended/i18n/en.json`

**Interfaces:**
- Produces(`rooms-api.ts`):
  - `ENDED_PAGE = 20`;`interface EndedPage { rooms: MyRoom[]; nextCursor: string | null }`
  - `endedRooms(api, cursor: string | null, signal?): Promise<EndedPage>`
  - `reopenRoom(api, id): Promise<RoomInfo>`
  - `myRoomsOverview(api, signal?): Promise<{ rooms: MyRoom[]; endedCount: number }>`(`myRooms` 保留,委托给它)
  - `ROOMS_SERVER_ERRORS` 追加 `"Room is not closed" → web.rooms.errors.notClosed`、`"Closed by an administrator" → web.rooms.errors.adminClosed`、`"Invalid cursor" → web.rooms.errors.generic`(若无 generic 键则映射到现有的通用失败键,实现时按 `web.rooms.errors` 现有键选)

- [ ] **Step 1: 写失败测试**(`rooms-api.test.ts` 追加,沿用文件里 `createFetchMock / ApiClient` 的写法):

```ts
describe("ended rooms and reopen", () => {
  it("pages the ended list with the cursor and camelCases it", async () => {
    const mock = createFetchMock({
      "GET /api/rooms/ended": (req) => json(req.url.searchParams.get("cursor")
        ? { rooms: [], next_cursor: null }
        : { rooms: [{ id: "r2", status: "closed", close_reason: "idle", summary_status: "done" }], next_cursor: "abc" }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const first = await endedRooms(api, null);
    expect(first.nextCursor).toBe("abc");
    expect(first.rooms[0]).toMatchObject({ id: "r2", closeReason: "idle", summaryStatus: "done" });
    expect(mock.calls[0].url.searchParams.get("limit")).toBe(String(ENDED_PAGE));
    expect((await endedRooms(api, "abc")).nextCursor).toBeNull();
    expect(mock.calls[1].url.searchParams.get("cursor")).toBe("abc");
  });
  it("reopens a room and returns it", async () => {
    const mock = createFetchMock({ "POST /api/rooms/r2/reopen": () => json({ room: { id: "r2", status: "open", code: "573920" } }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await reopenRoom(api, "r2")).code).toBe("573920");
  });
  it("reads the lobby overview with the ended count", async () => {
    const mock = createFetchMock({ "GET /api/rooms/mine": () => json({ rooms: [], ended_count: 4 }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await myRoomsOverview(api)).toEqual({ rooms: [], endedCount: 4 });
  });
  it("maps the new server errors to i18n keys", () => {
    expect(ROOMS_SERVER_ERRORS["Room is not closed"]).toBe("web.rooms.errors.notClosed");
    expect(ROOMS_SERVER_ERRORS["Closed by an administrator"]).toBe("web.rooms.errors.adminClosed");
  });
});
```
(`mock.calls[i].url` 是否为 `URL` 对象以 `~/test/fetch-mock` 为准——`rooms-lobby-page.test.tsx` 里用 `c.url.pathname`,所以是 `URL`。)

- [ ] **Step 2: 运行确认失败**:`cd web && yarn vitest run src/features/rooms/rooms-api.test.ts` → FAIL。
- [ ] **Step 3: 实现**(`rooms-api.ts`):

```ts
/** 已结束页每次取多少(服务端 limit 上限 50)。 */
export const ENDED_PAGE = 20;
export interface EndedPage { rooms: MyRoom[]; nextCursor: string | null }

export async function myRoomsOverview(api: ApiClient, signal?: AbortSignal): Promise<{ rooms: MyRoom[]; endedCount: number }> {
  const res = await api.request<{ rooms: MyRoom[]; endedCount?: number }>("GET", "/api/rooms/mine", { signal });
  return { rooms: res.rooms, endedCount: res.endedCount ?? 0 };
}
export async function myRooms(api: ApiClient, signal?: AbortSignal): Promise<MyRoom[]> {
  return (await myRoomsOverview(api, signal)).rooms;
}
/** 已结束的房间(全部,按结束时间倒序);cursor 是上一页的 nextCursor,首页传 null。 */
export function endedRooms(api: ApiClient, cursor: string | null, signal?: AbortSignal): Promise<EndedPage> {
  return api.request<EndedPage>("GET", "/api/rooms/ended", { query: cursor ? { limit: ENDED_PAGE, cursor } : { limit: ENDED_PAGE }, signal });
}
/** 房主重新开启已结束的房间:返回新的(开放)房间,带新房间号。 */
export async function reopenRoom(api: ApiClient, id: string): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("POST", `${rid(id)}/reopen`)).room;
}
```
(删除原来的 `myRooms` 定义;`ROOMS_SERVER_ERRORS` 追加两条与「Invalid cursor」。)

- [ ] **Step 4: i18n**。`ended/i18n/zh-CN.json`:

```json
{
  "web": {
    "rooms": {
      "ended": {
        "title": "已结束的房间",
        "entry": "已结束的房间({{count}})",
        "empty": "还没有已结束的房间。",
        "loadMore": "加载更多",
        "loading": "加载中…",
        "closedOn": "{{date}} 结束",
        "reasons": { "owner": "房主结束", "idle": "空闲结束", "expired": "到时结束", "admin": "管理员关闭", "disabled": "功能关闭" },
        "reopen": "重新开启",
        "reopening": "开启中…"
      },
      "reopen": {
        "title": "房间已结束",
        "hint": "重新开启会生成新的房间号,成员保持不变。",
        "action": "重新开启房间"
      },
      "errors": {
        "notClosed": "房间已经在进行中。",
        "adminClosed": "这个房间被管理员关闭,不能重新开启。"
      },
      "room": {
        "system": {
          "reopened": "{{name}} 重新开启了房间",
          "reopened_admin": "管理员重新开启了房间"
        }
      },
      "extras": {
        "summary": { "stale": "这是上一次的小结;新的小结暂时没能生成。" }
      }
    }
  }
}
```
`en.json`:

```json
{
  "web": {
    "rooms": {
      "ended": {
        "title": "Ended rooms",
        "entry": "Ended rooms ({{count}})",
        "empty": "No ended rooms yet.",
        "loadMore": "Load more",
        "loading": "Loading…",
        "closedOn": "Ended {{date}}",
        "reasons": { "owner": "Ended by the owner", "idle": "Ended: idle", "expired": "Ended: time limit", "admin": "Closed by an admin", "disabled": "Feature off" },
        "reopen": "Reopen",
        "reopening": "Reopening…"
      },
      "reopen": {
        "title": "This room has ended",
        "hint": "Reopening gives it a new room code; the members stay the same.",
        "action": "Reopen room"
      },
      "errors": {
        "notClosed": "The room is already live.",
        "adminClosed": "An admin closed this room, so it can't be reopened."
      },
      "room": {
        "system": {
          "reopened": "{{name}} reopened the room",
          "reopened_admin": "An admin reopened the room"
        }
      },
      "extras": {
        "summary": { "stale": "This is the previous recap; a new one couldn't be generated yet." }
      }
    }
  }
}
```
- [ ] **Step 5: 运行**:`cd web && yarn vitest run src/features/rooms/rooms-api.test.ts src/i18n` + `yarn web:typecheck` → 全绿(i18n 一致性测试要求中英同构)。
- [ ] **Step 6: Commit**:`feat(web): rooms API for ended list and reopen, ended strings`。

---

### Task W3: 大厅只列开放房间 + 底部入口 + 懒加载的「已结束的房间」页

**Files:**
- Modify: `web/src/features/rooms/rooms-lobby-page.tsx`、`rooms-lobby-page.test.tsx`、`index.ts`、`web/src/app.tsx`
- Create: `web/src/features/rooms/lazy-ended.tsx`、`ended/ended-rooms-page.tsx`、`ended/use-ended-rooms.ts`、`ended/ended-rooms-page.test.tsx`

**Interfaces:**
- Produces:路由 `/rooms/ended`;`RoomsEndedPage`(从 `~/features/rooms` 导出,懒加载);大厅 `data-testid="rooms-ended-link"`;已结束页 `data-testid`:`ended-room`(行,`data-status="closed"`)、`ended-reopen`(行内按钮)、`ended-more`(加载更多)。

- [ ] **Step 1: 写失败测试**。`ended/ended-rooms-page.test.tsx`(用 `renderWithProviders`、`createFetchMock`,与大厅测试同构;`beforeEach` 写 `localStorage["enjoy-web.settings"]={language:"zh-CN"}`,`afterEach` 删掉并切回 `en`):

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RoomsEndedPage } from "./ended-rooms-page";
import { ROOM } from "../room-fixtures";

const row = (id: string, over = {}) => ({ ...ROOM, id, code: null, status: "closed", name: `房间${id}`, closed_at: "2026-10-09T10:00:00+00:00",
  close_reason: "owner", my_role: "owner", summary_status: "none", ...over });

function setup(routes: Record<string, Handler>) {
  const mock = createFetchMock(routes);
  renderWithProviders(<RoomsEndedPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/ended", path: "/rooms/ended",
    user: { id: "11111111", name: "alice" } });
  return mock;
}

describe("RoomsEndedPage", () => {
  beforeEach(() => localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })));
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("lists ended rooms, shows the summary state and opens the history", async () => {
    setup({ "GET /api/rooms/ended": () => json({ rooms: [row("r2", { summary_status: "done" }), row("r3", { my_role: "member", close_reason: "idle" })], next_cursor: null }) });
    const rows = await screen.findAllByTestId("ended-room");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("href")).toBe("/rooms/r/r2/summary"); // a finished recap opens first
    expect(rows[0].textContent).toContain("房主结束");
    expect(rows[1].getAttribute("href")).toBe("/rooms/r/r3");
    expect(screen.getAllByTestId("ended-reopen")).toHaveLength(1); // owners only
  });

  it("pages with a cursor and appends without duplicates", async () => {
    const mock = setup({ "GET /api/rooms/ended": (req) => json(req.url.searchParams.get("cursor")
      ? { rooms: [row("r2"), row("r4")], next_cursor: null }
      : { rooms: [row("r2"), row("r3")], next_cursor: "c1" }) });
    await screen.findAllByTestId("ended-room");
    fireEvent.click(screen.getByTestId("ended-more"));
    await waitFor(() => expect(screen.getAllByTestId("ended-room")).toHaveLength(3));
    expect(mock.calls.at(-1)!.url.searchParams.get("cursor")).toBe("c1");
    expect(screen.queryByTestId("ended-more")).toBeNull();
  });

  it("an owner reopens a room from the list and lands in it", async () => {
    setup({
      "GET /api/rooms/ended": () => json({ rooms: [row("r2")], next_cursor: null }),
      "POST /api/rooms/r2/reopen": () => json({ room: { ...ROOM, id: "r2", status: "open", code: "573920" } }),
    });
    fireEvent.click(await screen.findByTestId("ended-reopen"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/rooms/r/r2"));
  });

  it("explains why a reopen failed and keeps the list", async () => {
    setup({
      "GET /api/rooms/ended": () => json({ rooms: [row("r2")], next_cursor: null }),
      "POST /api/rooms/r2/reopen": () => json({ error: "Too many rooms" }, 429),
    });
    fireEvent.click(await screen.findByTestId("ended-reopen"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getAllByTestId("ended-room")).toHaveLength(1);
  });

  it("shows the empty state", async () => {
    setup({ "GET /api/rooms/ended": () => json({ rooms: [], next_cursor: null }) });
    expect(await screen.findByText("还没有已结束的房间。")).toBeTruthy();
  });
});
```
大厅测试(`rooms-lobby-page.test.tsx`)改动:① 第 19 行的 mock 改成 `json({ rooms: [ROOM], ended_count: 2 })`;② 「lists my open and ended rooms …」用例改名为「lists my open rooms, offers the ended-rooms entry and creates a room …」,把 `expect(rows.map((r) => r.dataset.status)).toEqual(["open", "closed"])` 与后两行(`rows[1]` 的 href / 「已结束」)换成 `expect(rows.map((r) => r.dataset.status)).toEqual(["open"]); expect(screen.getByTestId("rooms-ended-link").getAttribute("href")).toBe("/rooms/ended"); expect(screen.getByTestId("rooms-ended-link").textContent).toContain("已结束的房间(2)");`;③ 删除用例「ended rows with a learning summary show it as the subtitle…」(它的内容已搬到已结束页测试);④ 新增:`ended_count: 0` 时 `queryByTestId("rooms-ended-link")` 为 null。

- [ ] **Step 2: 运行确认失败**:`cd web && yarn vitest run src/features/rooms/ended src/features/rooms/rooms-lobby-page.test.tsx` → FAIL。
- [ ] **Step 3: 实现 `ended/use-ended-rooms.ts`**:

```ts
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import type { GateState } from "~/components/feature-gate";
import { endedRooms, type MyRoom } from "../rooms-api";

/** 已结束页的数据:首页 + 游标分页(按 id 去重,翻页期间有房间被重新开启或退出也不会重复)。 */
export function useEndedRooms(api: ApiClient) {
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<GateState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    endedRooms(api, null, ctrl.signal)
      .then((page) => { setRooms(page.rooms); setCursor(page.nextCursor); setState("ready"); })
      .catch(() => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await endedRooms(api, cursor);
      setRooms((cur) => { const seen = new Set(cur.map((r) => r.id)); return [...cur, ...page.rooms.filter((r) => !seen.has(r.id))]; });
      setCursor(page.nextCursor);
    } catch {
      setState("error");
    } finally {
      setLoadingMore(false);
    }
  }, [api, cursor, loadingMore]);
  return { rooms, state, hasMore: cursor !== null, loadingMore, loadMore, reload: () => setAttempt((n) => n + 1) };
}
```
- [ ] **Step 4: `ended/ended-rooms-page.tsx`**(视觉沿用大厅的行样式;行主体是 `Link`,重新开启按钮在行外右侧,避免嵌套交互元素):

```tsx
import { ArchiveIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate } from "~/components/feature-gate";
import { SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { ROOMS_ALL_SERVER_ERRORS } from "../create/rooms-v2-api";
import { reopenRoom, type MyRoom } from "../rooms-api";
import { smallGhostButton } from "../ui";
import { useEndedRooms } from "./use-ended-rooms";

const SUMMARY_LINK = new Set(["done", "pending", "failed"]);

function endedDate(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** /rooms/ended:我作为有效成员的全部已结束房间(按结束时间倒序,游标分页)。房主可重新开启(管理员关闭的除外)。 */
export function RoomsEndedPage() {
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { rooms, state, hasMore, loadingMore, loadMore, reload } = useEndedRooms(api);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function reopen(room: MyRoom) {
    if (busyId) return;
    setBusyId(room.id);
    setError(null);
    try {
      const opened = await reopenRoom(api, room.id);
      navigate(`/rooms/r/${encodeURIComponent(opened.id)}`);
    } catch (err) {
      setError(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
      setBusyId(null);
    }
  }
  return (
    <>
      <PageHeader title={t("web.rooms.ended.title")} back="/rooms" />
      <FeatureGate state={state} disabledText={t("web.rooms.disabled")} onRetry={reload}>
        <div className="px-gutter pb-8">
          <p role="alert" className={cn("text-sub text-ink-2", error ? "mb-2" : "sr-only")}>{error}</p>
          {rooms.length === 0 ? (
            <p className="px-3.5 py-10 text-center text-sub text-ink-2">{t("web.rooms.ended.empty")}</p>
          ) : (
            <SectionGroup title={t("web.rooms.ended.title")}>
              {rooms.map((room) => {
                const summary = room.summaryStatus && SUMMARY_LINK.has(room.summaryStatus) ? room.summaryStatus : null;
                const canReopen = room.myRole === "owner" && room.closeReason !== "admin";
                const reason = room.closeReason ? t(`web.rooms.ended.reasons.${room.closeReason}`, { defaultValue: "" }) : "";
                return (
                  <div key={room.id} className="flex items-center">
                    <Link to={`/rooms/r/${encodeURIComponent(room.id)}${summary ? "/summary" : ""}`} data-testid="ended-room" data-status="closed"
                      className="flex min-h-row min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 pr-2 transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <span aria-hidden className="inline-flex size-[34px] flex-none items-center justify-center rounded-badge bg-surface-2 text-ink-2">
                        <ArchiveIcon className="size-[19px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium tracking-[-0.005em] text-ink">{room.name || room.topic || t("web.rooms.room.title")}</span>
                        <span className="mt-0.5 block truncate text-meta tabular-nums text-ink-2">
                          {[reason, endedDate(room.closedAt, i18n.language), summary ? t(`web.rooms.lobby.summary.${summary}`) : ""].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                    {canReopen && (
                      <button type="button" data-testid="ended-reopen" disabled={busyId !== null}
                        className={cn(smallGhostButton, "mr-3 flex-none whitespace-nowrap")} onClick={() => void reopen(room)}>
                        {busyId === room.id ? t("web.rooms.ended.reopening") : t("web.rooms.ended.reopen")}
                      </button>
                    )}
                  </div>
                );
              })}
            </SectionGroup>
          )}
          {hasMore && (
            <button type="button" data-testid="ended-more" disabled={loadingMore} onClick={() => void loadMore()}
              className={cn(smallGhostButton, "mx-auto mt-4 flex")}>
              {loadingMore ? t("web.rooms.ended.loading") : t("web.rooms.ended.loadMore")}
            </button>
          )}
        </div>
      </FeatureGate>
    </>
  );
}
```
(`SectionGroup`、`FeatureGate`、`PageHeader` 的属性以大厅用法为准——`PageHeader` 的 `back` 属性在小结页已用;`t("web.rooms.lobby.summary.*")` 复用大厅已有的三条文案,所以大厅里这三条 i18n 键保留。)

- [ ] **Step 5: `lazy-ended.tsx`**:

```tsx
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

/** 已结束页按路由懒加载(主包不增长:计划 2026-10-12-rooms-reopen,全局约束)。 */
const Page = lazy(async () => ({ default: (await import("./ended/ended-rooms-page")).RoomsEndedPage }));

function Loading() {
  const { t } = useTranslation();
  return <p role="status" className="px-gutter py-16 text-center text-sub text-ink-2">{t("web.common.loading")}</p>;
}

export function RoomsEndedPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Page />
    </Suspense>
  );
}
```
`index.ts` 追加 `export { RoomsEndedPage } from "./lazy-ended";`(不要静态导出 `ended-rooms-page`);测试里直接 import `./ended-rooms-page`(同 feature 内)。`app.tsx`:导入加 `RoomsEndedPage`,路由加 `<Route path="/rooms/ended" element={<RoomsEndedPage />} />`(放在 `/rooms` 之后、`/rooms/r/:roomId` 之前)。
- [ ] **Step 6: 大厅实现**(`rooms-lobby-page.tsx`):
  - 导入 `ArchiveIcon`,`myRoomsOverview` 替换 `myRooms`;状态 `const [endedCount, setEndedCount] = useState(0);`,effect 里 `const overview = await myRoomsOverview(api, ctrl.signal); setRooms(overview.rooms); setEndedCount(overview.endedCount);`;
  - 删除 `summary` 变量与已结束分支:行副标题固定 `t("web.rooms.lobby.open", { count: room.onlineCount })`,`Link` 的 `to` 固定 `/rooms/r/${id}`,`open` 变量与图标配色按「全部是开放」简化为 `bg-blue-tint text-blue`;`data-status` 保留 `room.status`;
  - `SectionGroup` 之后(`</SectionGroup>` 与 `</div>` 之间)加:

```tsx
          {endedCount > 0 && (
            <Link to="/rooms/ended" data-testid="rooms-ended-link"
              className="mt-3 flex min-h-row items-center gap-3 rounded-card bg-surface py-2.5 pl-3.5 pr-3 shadow-hair transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <ArchiveIcon aria-hidden className="size-[19px] flex-none text-ink-2" />
              <span className="min-w-0 flex-1 truncate text-body text-ink">{t("web.rooms.ended.entry", { count: endedCount })}</span>
              <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
            </Link>
          )}
```
  - 文件头注释里「7 天内已结束,只读」改为「进行中的房间;已结束的在 /rooms/ended」。
- [ ] **Step 7: 运行**:`cd web && yarn vitest run src/features/rooms src/architecture.test.ts && yarn web:typecheck && yarn web:build`(记录主 chunk gzip 前后对比;`web:build` 输出里应出现独立的 ended 块)→ 全绿。
- [ ] **Step 8: Commit**:`feat(web): ended rooms page (lazy), lobby lists live rooms only`。

---

### Task W4: 房主「重新开启」入口(插槽)与小结 stale 提示

**Files:**
- Create: `web/src/features/rooms/extras/reopen-bar.tsx`、`extras/reopen-bar.test.tsx`
- Modify: `web/src/features/rooms/room-page.tsx`(WR-1:一个导入 + 一行接线)、`extras/summary-page.tsx`、`extras/summary-page.test.tsx`、`room-page.test.tsx`

**Interfaces:**
- Produces:`canReopen(room: RoomInfo | null, closeReason: string | null, isOwner: boolean): boolean`;`ReopenBar({ roomId, onReopened })`,`data-testid="room-reopen"`。

- [ ] **Step 1: 写失败测试**。`extras/reopen-bar.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { RoomInfo } from "../protocol";
import { canReopen, ReopenBar } from "./reopen-bar";

const info = (over: Partial<RoomInfo> = {}) => ({ id: "r1", status: "closed", closeReason: "owner" } as RoomInfo & typeof over);

describe("canReopen", () => {
  it("is for the owner of a room that was not closed by an admin", () => {
    expect(canReopen(info(), null, true)).toBe(true);
    expect(canReopen(info({ closeReason: null }), "idle", true)).toBe(true); // just ended live: the close event carries the reason
    expect(canReopen(info({ closeReason: "admin" }), null, true)).toBe(false);
    expect(canReopen(info({ closeReason: null }), "admin", true)).toBe(false);
    expect(canReopen(info(), null, false)).toBe(false);
    expect(canReopen(null, "owner", true)).toBe(false);
    expect(canReopen(info({ closeReason: null }), "kicked", true)).toBe(false);
  });
});

describe("ReopenBar", () => {
  beforeEach(() => localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })));
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });
  const setup = (routes: Record<string, Handler>, onReopened = vi.fn()) => {
    const mock = createFetchMock(routes);
    renderWithProviders(<ReopenBar roomId="r1" onReopened={onReopened} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    return { mock, onReopened };
  };

  it("reopens and hands the new room to the page", async () => {
    const { onReopened } = setup({ "POST /api/rooms/r1/reopen": () => json({ room: { id: "r1", status: "open", code: "573920" } }) });
    fireEvent.click(screen.getByTestId("room-reopen"));
    await waitFor(() => expect(onReopened).toHaveBeenCalledWith(expect.objectContaining({ id: "r1", code: "573920" })));
  });
  it("treats 'already reopened' (409) as success after re-reading the room (R-O6)", async () => {
    const { onReopened } = setup({
      "POST /api/rooms/r1/reopen": () => json({ error: "Room is not closed" }, 409),
      "GET /api/rooms/r1": () => json({ room: { id: "r1", status: "open", code: "573920" }, members: [] }),
    });
    fireEvent.click(screen.getByTestId("room-reopen"));
    await waitFor(() => expect(onReopened).toHaveBeenCalled());
  });
  it("shows why it failed", async () => {
    const { onReopened } = setup({ "POST /api/rooms/r1/reopen": () => json({ error: "Too many rooms" }, 429) });
    fireEvent.click(screen.getByTestId("room-reopen"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onReopened).not.toHaveBeenCalled();
  });
});
```
(`info()` 的类型技巧改成直接 `({ id: "r1", status: "closed", closeReason: "owner", ...over }) as RoomInfo`。)

`room-page.test.tsx` 追加:

```tsx
  it("lets the owner reopen an ended room and reconnects (spec 2026-10-12)", async () => {
    let reopened = false;
    setup({
      "POST /api/rooms/r1/ticket": () => (reopened ? json({ ticket: "t2", expires_in: 60 }) : json({ error: "Room not found" }, 404)),
      "GET /api/rooms/r1": () => json({ room: { ...ROOM, status: "closed", code: null, my_role: "owner", close_reason: "owner" }, members: MEMBERS }),
      "GET /api/rooms/r1/messages": () => json({ messages: [user(7, "See you!")] }),
      "POST /api/rooms/r1/reopen": () => { reopened = true; return json({ room: { ...ROOM, code: "573920", my_role: "owner" } }); },
    });
    expect(await screen.findByText("See you!")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("room-reopen"));
    await waitFor(() => expect(FakeWebSocket.count).toBe(1));
    await live({ ...ROOM, code: "573920" });
    expect(await screen.findByTestId("room-code")).toBeTruthy();
    expect(screen.queryByTestId("room-reopen")).toBeNull();
  });

  it("does not offer reopen for an admin-closed room or to a member", async () => {
    setup({
      "POST /api/rooms/r1/ticket": () => json({ error: "Room not found" }, 404),
      "GET /api/rooms/r1": () => json({ room: { ...ROOM, status: "closed", code: null, my_role: "owner", close_reason: "admin" }, members: MEMBERS }),
      "GET /api/rooms/r1/messages": () => json({ messages: [user(7, "See you!")] }),
    });
    expect(await screen.findByText("See you!")).toBeTruthy();
    expect(screen.queryByTestId("room-reopen")).toBeNull();
  });
```
小结页测试(`extras/summary-page.test.tsx`)追加一个用例:`GET …/summary` 返回 `{summary:{status:"done", reason:"stale", overview_zh:"聊了面馆。", words:[], my_fixes:[], created_at:…, finished_at:…}}` 时页面含「这是上一次的小结;新的小结暂时没能生成。」,`reason:null` 时没有(沿用该文件里已有的渲染与路由辅助函数)。

- [ ] **Step 2: 运行确认失败**:`cd web && yarn vitest run src/features/rooms/extras/reopen-bar.test.tsx src/features/rooms/room-page.test.tsx src/features/rooms/extras/summary-page.test.tsx` → FAIL。
- [ ] **Step 3: `extras/reopen-bar.tsx`**:

```tsx
import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { cn } from "~/lib/cn";
import { ROOMS_ALL_SERVER_ERRORS } from "../create/rooms-v2-api";
import type { RoomInfo } from "../protocol";
import { getRoom, reopenRoom } from "../rooms-api";
import { primaryButton } from "../ui";

/** 房主且不是管理员关闭的(管理员关闭的只有后台能重新开启);刚在房间里结束时,原因来自 closed 事件(closeReason)。 */
export function canReopen(room: RoomInfo | null, closeReason: string | null, isOwner: boolean): boolean {
  const reason = room?.closeReason ?? closeReason;
  return !!room && isOwner && reason !== "admin" && reason !== "kicked" && reason !== "not_found";
}

/**
 * 已结束房间里的「重新开启房间」(插槽,spec 2026-10-12 §2.2):成功后把新房间交给页面,页面据此重连。
 * 409「Room is not closed」= 已经被开启(双击、另一个标签页):重读房间,开放了就当成功(R-O6)。
 */
export function ReopenBar({ roomId, onReopened }: { roomId: string; onReopened: (room: RoomInfo) => void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onReopened(await reopenRoom(api, roomId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const { room } = await getRoom(api, roomId);
          if (room.status === "open") return onReopened(room);
        } catch { /* 落到下面的提示 */ }
      }
      setError(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
      setBusy(false);
    }
  }
  return (
    <section aria-label={t("web.rooms.reopen.title")} className="my-3 rounded-card bg-surface p-3.5 shadow-hair">
      <p className="text-sub text-ink-2">{t("web.rooms.reopen.hint")}</p>
      <button type="button" data-testid="room-reopen" disabled={busy} className={cn(primaryButton, "mt-3")} onClick={() => void go()}>
        <RotateCcwIcon aria-hidden />{busy ? t("web.rooms.ended.reopening") : t("web.rooms.reopen.action")}
      </button>
      <p role="alert" className={cn("text-sub text-ink-2", error ? "mt-2" : "sr-only")}>{error}</p>
    </section>
  );
}
```
- [ ] **Step 4: `room-page.tsx`(WR-1,冻结页的一行接线)**:导入 `import { canReopen, ReopenBar } from "./extras/reopen-bar";`;在 `{ended && info && <SummaryCard roomId={roomId} justClosed={justClosed} />}` 之后加一行:

```tsx
        {ended && canReopen(info, state.closeReason, isOwner) && <ReopenBar roomId={roomId} onReopened={room.reopened} />}
```
- [ ] **Step 5: `extras/summary-page.tsx`**:`body` 计算处,`summary.status === "done"` 分支改为

```tsx
  else if (summary.status === "done") {
    body = (
      <>
        {summary.reason === "stale" && <p role="note" className="mb-3 text-sub text-ink-2">{t("web.rooms.extras.summary.stale")}</p>}
        <Done summary={summary} room={room} config={config} />
      </>
    );
  }
```
- [ ] **Step 6: 在 `web/src/features/rooms/CLAUDE.md` 的「Slots」一节**把 `SummaryCard`(已结束房间)后补 `ReopenBar`(已结束房间,房主),并写 Addendum 一句:「WR-1(2026-10-12):`room-page.tsx` 只增加 `ReopenBar` 一行接线,理由:重新开启入口只能出现在页面的结束态里;逻辑全在 `extras/reopen-bar.tsx` 与 `use-room.ts`。」(其余 CLAUDE.md 内容在 W5 一并更新。)
- [ ] **Step 7: 运行**:`cd web && yarn vitest run src/features/rooms && yarn web:typecheck` → 全绿。
- [ ] **Step 8: Commit**:`feat(web): owner reopen bar in ended rooms and stale-summary note`。

---

### Task W5: 契约测试、架构与文档

**Files:**
- Create: `web/src/features/rooms/rooms-reopen-contract.test.ts`
- Modify: `rooms-contract.test.ts`、`create/rooms-v2-contract.test.ts`、`extras/extras-contract.test.ts`(`RoomInfo` 键表)、`protocol.test.ts`(如需)、`web/src/features/rooms/CLAUDE.md`

- [ ] **Step 1: 更新键表**:`rooms-contract.test.ts` 的 `ROOM: Record<keyof RoomInfo, true>` 加 `closeReason: true`;`EVENTS` 加 `reopened: { type: true, room: true }`;「我的房间」断言处追加 `expect(Object.keys(camel(C.http.mine)).sort()).toEqual(["endedCount", "rooms"])`;另外两个 contract 测试里的 `ROOM_V2` 是 `Partial`,不必改,但它们对 `room` 的「键集合 = ROOM ∪ …」比较若存在,同步加 `closeReason`(用 `grep -n "keyof RoomInfo\|wireKeys(.*room" web/src/features/rooms/**/*contract.test.ts` 逐处核对)。
- [ ] **Step 2: 写新契约测试** `rooms-reopen-contract.test.ts`(读 `server/tests/fixtures/rooms_reopen_contract.json`,与 `extras-contract.test.ts` 同构):

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseRoomEvent, type RoomEvent, type RoomInfo } from "./protocol";
import { roomReducer, initialRoomState } from "./room-state";
import type { EndedPage } from "./rooms-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../server");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: { http: Record<string, any>; ws: Record<string, any> } = JSON.parse(readFileSync(path.join(root, "tests/fixtures/rooms_reopen_contract.json"), "utf8"));
const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const wireKeys = (v: unknown) => Object.keys(camel(v)).sort();

const ROOM: Record<keyof RoomInfo, true> = { id: true, code: true, topic: true, status: true, locked: true, aiPublic: true, aiMuted: true, ownerId: true,
  myRole: true, memberCount: true, onlineCount: true, createdAt: true, closedAt: true, closeReason: true,
  name: true, scenario: true, level: true, joinMode: true, maxMembers: true, allowVoice: true };
const ENDED_PAGE: Record<keyof EndedPage, true> = { rooms: true, nextCursor: true };

describe("reopen payloads (recorded from the real server) match the web types", () => {
  it("ended list rows and the page", () => {
    expect(wireKeys(C.http.ended)).toEqual(keys(ENDED_PAGE));
    for (const room of C.http.ended.rooms) expect(wireKeys(room)).toEqual([...keys(ROOM), "summaryStatus"].sort());
  });
  it("reopen response and the lobby overview", () => {
    expect(wireKeys(C.http.reopen.room)).toEqual(keys(ROOM));
    expect(wireKeys(C.http.mine)).toEqual(["endedCount", "rooms"]);
  });
  it("the reopened event parses and drives the reducer", () => {
    expect(wireKeys(C.ws.reopened)).toEqual(["room", "type"]);
    expect(wireKeys(C.ws.reopened.room)).toEqual(keys(ROOM));
    const event = parseRoomEvent(JSON.stringify(C.ws.reopened)) as Extract<RoomEvent, { type: "reopened" }>;
    expect(event.type).toBe("reopened");
    expect(roomReducer(initialRoomState(), { type: "event", event }).reopenSignal).toBe(1);
  });
  it("the system message that follows is the reopened key", () => {
    expect(C.ws.message_system.message.text).toBe("reopened");
  });
});
```
- [ ] **Step 3: 架构测试**:不改 `architecture.test.ts`(没有新的跨 feature 边;`lazy-ended.tsx` 与 `ended/` 只依赖 `~/components`、`~/layout`、`~/api`、`~/auth`、`~/lib`、`react-i18next`、feature 内文件)。运行它确认不变。
- [ ] **Step 4: 文档**。`web/src/features/rooms/CLAUDE.md`:What lives here 增 `ended/`(已结束页 + 数据 hook + 自带 i18n)、`lazy-ended.tsx`、`extras/reopen-bar.tsx`;Public surface 增 `RoomsEndedPage`(`/rooms/ended`,懒加载);契约测试一行加 `rooms-reopen-contract.test.ts`(`rooms_reopen_contract.json`);Pitfalls 追加:

```
- 已结束房间没有 WebSocket(票据 404):只读查看者靠 `use-room` 每 20 秒轮询 `GET /api/rooms/{id}` 感知重新开启(R-O3);
  `reopened`(轮询、房主本人、将来的推送)都经 reducer 的 `reopenSignal` 触发 `reset` + 重连,别在别处直接 `connect()`。
- 「已结束的房间」页是懒加载的(`lazy-ended.tsx`),不要从 `index.ts` 静态导出 `ended/ended-rooms-page`;大厅只列开放房间,`endedCount` 来自 `GET /mine`。
- 重新开启入口由 `closeReason` 决定:`admin` 关闭的不显示(只有管理后台能开);409「Room is not closed」按成功处理并重读房间。
```
- [ ] **Step 5: 运行**:`cd web && yarn vitest run src/features/rooms src/architecture.test.ts src/i18n && yarn web:typecheck && yarn web:build` → 全绿。
- [ ] **Step 6: Commit**:`test(web): reopen contract, architecture check and rooms docs`。

---

## Lane admin (A)

### Task A1: 管理后台房间详情「重新开启」

**Files:**
- Modify: `admin/src/features/rooms/api.ts`、`strings.ts`、`room-detail-page.tsx`、`test-fixtures.ts`、`room-detail-page.test.tsx`
- Create: `admin/src/features/rooms/CLAUDE.md`

**Interfaces:**
- Consumes:S5 的 `POST /api/admin/rooms/{id}/reopen`、房间行新增的 `opened_at / reopen_count`。
- Produces:`reopenRoom(id, reason): Promise<{ reopenCount: number }>`;`RoomRow.openedAt: string`、`RoomRow.reopenCount: number`。

- [ ] **Step 1: 写失败测试**(`room-detail-page.test.tsx` 追加,沿用文件里的 `renderPage / asRole / roomFixture`;`test-fixtures.ts` 的 `roomRow` 默认值先加 `openedAt: "2026-10-09T09:00:00Z", reopenCount: 0`):

```tsx
it("reopens a closed room with a reason and does not offer it on an open room", async () => {
  renderPage();
  await screen.findByRole("button", { name: "关闭房间" });
  expect(screen.queryByRole("button", { name: "重新开启" })).toBeNull();
  vi.mocked(api.getRoom).mockResolvedValue(roomFixture({ status: "closed", code: null, closedAt: "2026-10-09T10:00:00Z", closeReason: "admin", reopenCount: 2 }));
  vi.mocked(api.reopenRoom).mockResolvedValue({ reopenCount: 3 });
  const view = renderPage();
  expect(await screen.findAllByText("已重新开启 2 次")).not.toHaveLength(0);
  const button = (await screen.findAllByRole("button", { name: "重新开启" })).at(-1)!;
  await userEvent.click(button);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "确认" })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "误关闭,已和房主确认");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.reopenRoom).toHaveBeenCalledWith("r1", "误关闭,已和房主确认");
  view.unmount();
});

it("a viewer cannot reopen", async () => {
  asRole("viewer");
  vi.mocked(api.getRoom).mockResolvedValue(roomFixture({ status: "closed", code: null, closedAt: "2026-10-09T10:00:00Z", closeReason: "owner" }));
  renderPage();
  await screen.findByText("结束于", { exact: false });
  expect(screen.queryByRole("button", { name: "重新开启" })).toBeNull();
});
```
(第一个用例里为避免两次 `renderPage` 的干扰,实现时可拆成两个 `it`:一个断言开放房间没有按钮,一个断言关闭房间的整个流程。`roomFixture` 需允许覆盖 `reopenCount`,由 `RoomDetail extends RoomRow` 自动满足。)

- [ ] **Step 2: 运行确认失败**:`yarn workspace admin vitest run src/features/rooms/room-detail-page.test.tsx`(以 admin 包的实际测试命令为准,见 `admin/package.json`)→ FAIL。
- [ ] **Step 3: `api.ts`**:`RoomRow` 加 `openedAt: string; /** 管理员或房主重新开启的次数 */ reopenCount: number;`;文件里 `closeRoom` 之后加:

```ts
export async function reopenRoom(id: string, reason: string): Promise<{ reopenCount: number }> {
  return request(`/api/admin/rooms/${enc(id)}/reopen`, { method: "POST", json: { reason } });
}
```
(`request` 返回 camelCase,与同文件 `setRoomAi` 的 `{ aiMuted }` 一致。)
- [ ] **Step 4: `strings.ts`**(`detail` 里 `closeBody` 之后):

```ts
    reopen: "重新开启",
    reopenTitle: "重新开启房间",
    reopenBody: "房间会生成新的房间号并重新开放,成员保持不变(被移出的人仍然不能进);房主的开放房间数量上限仍然生效。操作写入审计日志。",
    reopenedTimes: (n: number) => `已重新开启 ${n} 次`,
```
- [ ] **Step 5: `room-detail-page.tsx`**:导入 `reopenRoom`;`Pending` 联合加 `| { kind: "reopen" }`;`confirmProps` 的 switch 加

```tsx
      case "reopen":
        return { title: D.reopenTitle, body: D.reopenBody, danger: false, run: (reason: string) => reopenRoom(id, reason) };
```
`actions` 里 `r.status === "open" && (…关闭房间…)` 之后加:

```tsx
            {r.status === "closed" && (
              <button type="button" className="btn-primary btn-sm" onClick={() => setPending({ kind: "reopen" })}>
                {D.reopen}
              </button>
            )}
```
状态条里在 `{r.aiMuted && …}` 之前加 `{r.reopenCount > 0 && <span className="num text-fg-2">{D.reopenedTimes(r.reopenCount)}</span>}`。确认成功后的刷新沿用现有 `ConfirmDialog` 成功回调里调用的 `refresh()`(与关闭房间一致)。
- [ ] **Step 6: `admin/src/features/rooms/CLAUDE.md`**(新建,短):用途(房间治理与举报页)、文件清单(`api.ts` 接口层、`rooms-page / room-detail-page / reports-page`、`room-timeline`、`resolve-dialog`、`strings.ts` 全部文案、`test-fixtures.ts`)、依赖(`../../api`、`../../components`、`../../hooks`、`../../lib`)、测试命令、陷阱(每个写操作必填理由并写审计;重新开启只对已结束房间显示;私聊时间线需确认并审计;不显示邀请 token 与房间码以外的敏感内容)。
- [ ] **Step 7: 运行**:admin 包的类型检查与 `rooms` 目录测试 → 全绿。
- [ ] **Step 8: Commit**:`feat(admin): reopen ended rooms from the room detail page`。

---

## Lane Z

### Task Z1: 终审与验证清单

- [ ] **Step 1: 全量测试**(分批,避免超时):`cd server && uv run pytest -q tests/test_rooms_*.py tests/test_admin_rooms*.py tests/test_web_contract.py tests/test_migrations.py tests/test_architecture.py`,再 `uv run pytest -q` 全量一次;`yarn web:typecheck && yarn web:test && yarn web:build`;admin 全量测试。
- [ ] **Step 2: 手工检查**(浏览器窗格 375×812,浅色 + 深色;结果写入本文件「验证结果」,没做的标「未验证」):
  1. 创建房间 → 结束 → 大厅没有它,底部出现「已结束的房间(1)」→ 进入 → 行显示结束原因 / 时间 / 小结状态 → 点行进入只读历史。
  2. 房主在已结束页点「重新开启」→ 进入房间在线,有新房间号与系统消息;旧邀请链接 404;被踢者用新房间码仍被拒绝。
  3. 房主在房间里点「结束房间」后,同页出现「重新开启房间」,点后重新在线。
  4. 第二个账号(成员)只读打开已结束房间,房主重新开启 → 约 20 秒内该成员页面自动上线。
  5. 管理员关闭的房间:房主页面无按钮;管理后台详情页有「重新开启」,填理由确认后审计日志出现 `room.reopen`。
  6. 重新开启后再次结束:小结重新生成;断掉 LLM(或用测试夹具)时仍显示上一次的小结并带「上一次的小结」提示。
  7. 键盘走一遍已结束页(Tab 顺序:返回 → 行 → 重新开启 → 加载更多),英文标签在 360 px 不溢出。
- [ ] **Step 3: 体积**:`yarn web:build` 记录主 chunk gzip(合并前 / 后),增量 ≤ 0.2 kB;ended 页是独立块。数字写进 PR 描述。
- [ ] **Step 4: 审计清单**:`security-review` 覆盖——权限(非房主、成员、管理员关闭、被踢者)、游标输入(`decode_cursor` 只接受自己编码的格式)、日志(`caplog` 已断言)、竞态(并行重新开启)、`reopened` 事件与系统消息不含新房间码。
- [ ] **Step 5: 勾选**:合并且测试通过后,把本文件各任务的 `- [ ]` 勾上,并在末尾追加「验证结果」小节(只写实际运行过的事;Postgres、真机、反向代理 WebSocket 标「未验证」)。
- [ ] **Step 6: Commit**:`docs: rooms reopen plan verification results`。

---

## 验证矩阵

| 需求 | 服务端测试 | 网页 / 管理端测试 | 人工 |
|---|---|---|---|
| 迁移 0014 往返、回填、可空、降级保留 FK/唯一约束 | `test_migrations.py::test_0014…` | — | Postgres 未验证 |
| `sweep` 以 `opened_at` 起算,旧行回退 `created_at` | `test_rooms_reopen_store.py::test_create_sets_opened_at…`、`…resets_the_expiry_clock` | — | — |
| `/mine` 只开放 + `ended_count`;`/ended` 分页 | `test_rooms_reopen_store.py::test_mine_lists…`、`test_rooms_reopen_api.py::test_mine_hides…`、`…pages_with_a_cursor…` | `ended-rooms-page.test.tsx`、`rooms-lobby-page.test.tsx` | Z1-2.1 |
| 房主重新开启:字段、新房间码、成员不变、旧链接失效 | `…::test_reopen_state_changes_and_members_stay`、`test_owner_reopens_an_ended_room` | `reopen-bar.test.tsx`、`room-page.test.tsx` | Z1-2.2、2.3 |
| 权限与条件(非房主 / admin 关闭 / 未结束 / 无房主) | `…::test_reopen_permissions_and_conditions`、`test_reopen_errors`、`test_admin_closed_rooms_cannot…` | `canReopen` 单测 | Z1-2.5 |
| `rooms_max_owned` / 站点容量 | `…::test_reopen_respects_max_owned_and_site_capacity`、`…obeys_the_owner_room_cap…` | 已结束页错误提示用例 | — |
| 并发 / 幂等 | `…::test_two_parallel_reopens_count_once` | 409 视为成功用例 | — |
| `reopened` 事件 + 契约 | `test_rooms_reopen_ws.py`、`test_rooms_reopen_contract.py`、`test_rooms_protocol_v2.py` | `rooms-reopen-contract.test.ts`、`protocol.test.ts`、`room-state.test.ts` | — |
| 只读查看者自动上线(轮询) | — | `room-page.test.tsx`(轮询用例) | Z1-2.4 |
| 小结重新生成 / 旧小结保留 / stale 重试 / 预算 | `test_rooms_summary_reopen.py` | `summary-page.test.tsx`(stale 提示) | Z1-2.6 |
| 管理员重新开启 + 审计 + 角色 | `test_admin_rooms_reopen.py`、`test_admin_routes_guarded.py` | `room-detail-page.test.tsx` | Z1-2.5 |
| 日志不含文本 / 房间码 / 名字 | 各 `caplog` 断言(API、管理端、小结) | — | — |
| 主包不增长 | — | `architecture.test.ts` + `yarn web:build` 对比 | Z1-3 |
| 消息与语音永久保留 | 既有 `test_purge_is_off_by_default`、`test_rooms_store.py` 保留断言(未改) | — | — |

## 不做

成员代为重新开启、重新开启后合并旧房间、自动重新开启(规格 §2.3);对已结束房间的 WebSocket 只读订阅(R-O3);「每房间重新开启总次数」上限(R-O10);已结束页搜索 / 筛选 / 批量操作;已结束页上「退出房间」「永久隐藏」;重新开启时改房间设置(用开启后的设置面板);重新开启后保留旧邀请链接(R-O8);把 `opened_at` 改成 NOT NULL(R-O1);改 `purge` 行为或任何设置项;给小结页加「重新生成」按钮(只有 `stale` 重试沿用已有的重试端点)。

## Cross-plan assumptions

- **迁移**:本计划占 `0014`(`down_revision = "0013"`)。agents-core 用 `0015`(`down_revision = "0014"`),agents-memory/tutor 并成 `0016`;它们各自要把 `tests/test_migrations.py` 里 `get_heads() == ["0014"]`(`test_0011…`、`test_0013…`、`test_0014…` 三处)顺延到自己的头,并更新 `server/app/CLAUDE.md` 的头号。若 W(已学词)计划意外增加迁移,以「合并时当前头 + 1」为准并通知本计划改号(R 的全部引用一起改)。
- **共享文件追加点**:`models.py` 的 `Room` 类本计划已改完,agents 不得再改 `Room`;`rooms/protocol.py` 的 `SERVER_EVENT_TYPES` 末尾是 `"reopened"`,A5 的新事件接在其后;`routers/rooms.py` 的 `ROOM_ERRORS`、`RoomsRuntime`(`reopen_limiter` 之后)、路由区(`/{room_id}/close` 之后)由 A5 追加;`web/src/features/rooms/protocol.ts` 与 `room-state.ts`(`reopenSignal`、`reset`)同理;`room-page.tsx` 在 WR-1 之后仍是冻结页,A5 的房间侧界面必须走插槽。
- **接口名(其它计划可依赖)**:`rooms.store.opened_anchor`、`RoomStore.reopen / ended / ended_count`、`routers.rooms.announce_reopened`、`RoomsRuntime.reopen_limiter`、`SummaryRunner.opened_of`、事件 `reopened{room}`、REST `POST /api/rooms/{id}/reopen`、`GET /api/rooms/ended`、`POST /api/admin/rooms/{id}/reopen`、`RoomInfo.closeReason`、`useRoom().reopened`。
- **agents 与重新开启的关系**:重新开启不改 `RoomMember` 与房间设置;A5 在房间上的任何设置(例如 `agents_enabled` 开关)若存放在 `rooms` 行或另表,重新开启时原样保留(本计划不会清空它们)。A5 的「房间接力 / 私有过程事件」只在 `status="open"` 的房间上工作;已结束房间无 socket,本计划的 `reopened` 事件通常没有接收者(R-O3),A5 不应依赖它推送状态。
- **测试夹具**:`rooms_*_contract.json` 在本计划重录(多 `close_reason`);A5 若再改 `room_out`,须在本计划之后重录并保持 `close_reason`。`tests/test_rooms_reopen_ws.py::Recorder` 可被其它计划的契约测试复用(attach 一个只记录帧的连接)。
- **i18n**:本计划新增 `web/src/features/rooms/ended/i18n/{zh-CN,en}.json`,键均在 `web.rooms.*` 下(`ended.*`、`reopen.*`、`errors.notClosed/adminClosed`、`room.system.reopened/reopened_admin`、`extras.summary.stale`);A5 不要重复定义这些键。
- **管理后台**:`admin/src/features/rooms/CLAUDE.md` 由本计划新建;A1 的「智能体」页是新页面,不改房间页。
