# 已学词自由复习 + 已结束房间隐藏 / 重新开启 · 设计

- 日期:2026-10-12 · 状态:用户已按推荐方案确认(「按你的建议」)
- 与智能体设计(`2026-10-12-agents-design.md`)并列;迁移号 `0014` 归本文第二部分。

## 第一部分:背单词「已学词」与随时复习

### 1.1 现状
只能复习「到期」的词。学完的新词没有总览入口,也不能主动复习。用户状态在 `vocabulary_items(source='wordbook:<book>')`(6 盒子、到期日),作答流水在 `wordbook_events`。

### 1.2 设计
**入口:** 背单词首页新增一行「已学 N 词」,进入「已学词」页。

**已学词页**
- 顶部熟练度分布条(盒子 1–2 新学 / 3–4 巩固中 / 5–6 熟练),点击分段即筛选。
- 筛选:词书、熟练度、易错、学习日期范围;**按英文前缀搜索**(中文释义不搜,避免逐条扫描词典文件)。
- 列表分页(游标,每页 50),点一行打开现有词卡;空状态给出「去学新词」。

**随时复习(自由复习)**
- 范围:昨天学的 / 最近 7 天 / 某一本书 / 某个熟练度 / 易错词 / 全部随机抽 N 个(10、20、50)。
- 方式:翻卡浏览(不判分)、快速回忆、选择题、拼写(复用现有题型,不新写题型)。

### 1.3 规则(与现有「防刷分」裁决一致)
| 情形 | 盒子 | 到期 | 段位点 | 每日复习上限 | 连续达标 |
|---|---|---|---|---|---|
| 自由复习答对 | 不变 | 不变 | **不加** | 不占用 | 不计入 |
| 自由复习答错 | 不变 | 改为**今天到期**(进入正式复习队列) | 不加 | 不占用 | 不计入 |
| 翻卡浏览 | 不变 | 不变 | 不加 | 不占用 | 不计入 |

- 事件 `kind` 使用现有的 `practice`,**不新增表**;`WordAnswered` 照常发布一次(联动层自己决定怎么处理 `practice`)。
- 抽取使用私有种子(沿用背单词的抽查种子做法),客户端不能指定具体词来刷。
- 每人每 UTC 日自由复习提交上限沿用现有作答上限(3,000 次),不新增上限设置。

### 1.4 接口(计划里可调整字段名,但语义不变)
- `GET /api/wordbook/learned?book=&box=&weak=&since=&until=&q=&cursor=&limit=` → `{items:[{book_id,key,word,box,learned_at,due_at,weak}], next_cursor}`
- `GET /api/wordbook/learned/summary` → `{total, by_box:{1..6}, by_book:{...}, yesterday, last7}`
- `POST /api/wordbook/free/start` `{scope, mode, count, book?, box?}` → `{set_id, cards:[...]}`(卡片形状与现有复习一致)
- 作答走现有 `POST /api/wordbook/answers`,新增 `mode="free"`;服务端按 §1.3 处理。

### 1.5 前端
`features/wordbook/` 内新增:`learned-page.tsx`、`free-review-sheet.tsx`、`box-bar.tsx`、`use-learned.ts`;复习页复用,加 `source=free` 参数;浏览模式是一个只翻面的轻量卡片页。字符串前缀 `web.wordbook.learned.*`。**不得增加主包体积**:新页面走已有的 `lazy-pages.tsx`。

### 1.6 不做
中文释义搜索、导出已学词、给已学词打自定义标签、自由复习的段位点。

## 第二部分:联机 · 已结束房间隐藏 + 重新开启

### 2.1 现状
`RoomStore.mine()` 把关闭后 `mine_closed_days` 天内的房间继续列出;关闭时 `code` 置空、`closed_at/close_reason` 写入;过期按 `created_at + max_hours` 计算,闲置按 `last_active_at` 计算。消息、语音、学习小结永久保留。

### 2.2 设计
- **我的房间默认只列开放中的房间。** 列表底部加入口「已结束的房间(N)」,进入单独页面:该用户作为有效成员的**全部**已关闭房间,按 `closed_at` 倒序,游标分页(不再受 `mine_closed_days` 限制;该设置继续只管「默认列表是否保留最近结束的房间」的旧行为,计划里要处理:默认列表不再包含它们,设置项保留但标记不再影响列表)。
- 已结束页的每个房间:查看历史(只读)、学习小结状态、房主有「重新开启」。
- **重新开启**:`POST /api/rooms/{id}/reopen`(房主)。条件:
  - 房间 `status=closed`,且 `close_reason ∈ {owner, idle, expired}`;`disabled`(功能关闭)在功能重新开启后也允许;`admin`(管理员关闭)只允许管理员通过 `POST /api/admin/rooms/{id}/reopen`(写审计)。
  - 受 `rooms_max_owned` 约束(房主同时拥有的开放房间数);不满足返回明确错误码。
  - 成员保持不变:已退出、被踢出的人仍然不能进;生成新房间码;`status=open`,清除 `closed_at/close_reason`,`opened_at=now`、`last_active_at=now`、`reopen_count += 1`。
  - 过期 / 闲置的计时锚点改为 `opened_at`(迁移 `0014` 增加列并回填为 `created_at`)。
- **学习小结:** 重新开启后再次结束时重新生成,覆盖整个房间内容;仍受「每房主每天」与全局上限约束;旧小结在新小结生成成功前保留可读(计划里要核对 `room_summaries` 主键是 `room_id`,采用「覆盖更新」并保证失败时不丢旧数据)。
- **WS(协议只增不改):** 新增 `reopened` 事件;正在以只读方式查看已关闭房间的成员收到后切换为在线;`protocol.ts` 与 `protocol.py` 同步,契约夹具重录。

### 2.3 不做
成员代为重新开启、重新开启后合并旧房间、自动重新开启。

### 2.4 迁移 `0014`
`rooms.opened_at`(DateTime tz,可空→回填→非空前先保持可空并在代码里 `coalesce(opened_at, created_at)`,避免 Postgres 大表锁表;计划里给出最终方案)、`rooms.reopen_count`(Integer,默认 0)。需要 SQLite batch 路径、Postgres 路径与往返测试。

## 规范(与智能体设计 §11 相同)
每个新目录 `CLAUDE.md`、架构测试、契约夹具、i18n、日志不含文本、约定式提交、未验证项如实标注。
