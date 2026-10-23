# 联机并入对话 — 设计提案(待用户确认)

状态:**示例页已确认(2026-10-21,`design/10.21-ui-v1/mockup.html` §A);实现计划见 plans/10.21-plans/L6,仍待用户说「开始写代码」**。只改网页,不改服务端;路由与邀请链接保持不变。
依据:2026-10-21 对 `web/` 的只读摸底(文件:行号为当时所见,实现前须重新核对)。

## 1. 要解决什么
底部导航现在有 5 个标签(练习 · 对话 · 联机 · 跟读库 · 我的),窄屏上很挤。联机(多人房间)和 AI 对话都是「开口聊」,
合并成一个入口:导航回到最多 4 个标签,「对话」下面再分「AI 对话 / 联机」两个分区。

## 2. 设计

**交互**
- 「对话」标签进入后,页面顶部是一个两段切换:**AI 对话**(默认)|**联机**。切换在两个现有页面之间跳转,不是新页面。
- 联机功能关闭(`useRoomsEnabled()` 为假)时:不显示切换,对话页与现在完全一样,导航也不多出标签。
- 点底部「对话」标签总是回到 AI 对话(可预期);联机分区、已结束房间页、房间页、总结页、邀请页上,「对话」标签保持高亮。
- 进入房间(`/rooms/r/:id`)后沿用现有整页体验;房间内的返回仍回到 `/rooms`(联机分区),**冻结的 `room-page.tsx` 与 `room-settings-sheet.tsx` 不用改**。

**路由:一条都不改**
- 保留 `/chat`、`/chat/:id`、`/rooms`、`/rooms/ended`、`/rooms/r/:id`、`/rooms/r/:id/summary`、`/rooms/invite/:token`。
  已分享出去的邀请链接、服务端返回的邀请路径(`routers/rooms.py:391-392`)、日志脱敏正则(`core/logging_setup.py:20-22`)、E2E 路径都不受影响。
- 「合并」只发生在导航与页面外壳上,不发生在 URL 上。

**减少耦合(关键)**
- `features/chat` 不得依赖 `features/rooms`(现有规则,且 `architecture.test.ts` 钉着 rooms→chat 的单向边)。
- 所以切换条不放进任何一个 feature,而放在**组合层**:新增 `web/src/pages/chat-hub.tsx`(`ChatHubLayout`),在 `app.tsx` 的路由里包住
  `/chat` 与 `/rooms`、`/rooms/ended` 三个元素;它是唯一同时知道「对话」与「联机」两边的地方,也是唯一读 `useRoomsEnabled()` 的新位置。
- 切换条本身是一个通用的、与业务无关的小组件(沿用现有 `SegmentedControl`),分区列表由 `ChatHubLayout` 传入。
- 两个页面各自的大标题与新建按钮:由实现计划决定最小改法(例如页面接受 `embedded` 属性隐藏自己的大标题,切换条代替);**不改 `room-page.tsx`**。

**导航**
- `bottom-nav.tsx`:去掉 `ROOMS` 项,`CHAT` 增加 `also: ["/rooms"]`(高亮覆盖整个联机子树);列数最多 4(`GlassTabBar columns` 已按长度取值)。
- 文案键 `web.nav.rooms` 与测试 id `nav-rooms` 随标签一起删除;切换条里的分区用新测试 id(如 `hub-tab-chat`、`hub-tab-rooms`)。

**不做(第二期)**
- 联机分区的未读红点(现在没有现成计数,要新增服务端或轮询,另议)。
- 记住上次停留的分区、AI 对话页顶部的「进行中房间」提示条。

## 3. 受影响的测试与文档(计划必须逐项处理)
- `layout/bottom-nav.test.tsx`(标签列表、5 列、标签长度循环、`/api/rooms/config` 调用次数)、`layout/feature-flags.test.tsx`(`nav-rooms` 的有无)、
  `e2e/admin-v2.spec.ts:41-80`(按联机开关数 `nav-rooms`)、`e2e/rooms*.spec.ts` / `e2e/accounts-admin.spec.ts:362`(直接 `goto("/rooms")`,应不变)、
  `e2e/chat.spec.ts`(点 `nav-chat`,应不变)、`architecture.test.ts` 的允许边(新增 `pages/chat-hub` → chat、rooms 的组合依赖)、
  `styles/glass-budget.test.ts` / `liquid-colour-guard.test.ts` 的路径清单。
- 文档:`web/README.md:77-84`、`src/layout/CLAUDE.md`(标签数量与标签长度规则)、`e2e/CLAUDE.md`、`features/chat|rooms/CLAUDE.md`(补一句「分区外壳在 pages/chat-hub」)。
- 毛玻璃预算:每屏最多 3 个模糊层;切换条用 `.well` / 不模糊的材质。

## 4. 风险与未验证
- 标题与按钮去重的具体改法没有实机看过;计划里需要一份真机截图清单(安卓 360 px 宽、浅 / 深色、联机开 / 关)。
- 联机关闭时的行为由 `useRoomsEnabled()`「默认 false,加载后才可能变 true」决定:首屏可能先无切换条、随后出现,需要避免版面跳动(计划里要定:占位或延迟渲染)。
- 与 L4 Task 16 同改 `features/chat/conversation-page.tsx`:L6 本身**不改**该文件,冲突面很小,但合并顺序仍定为 L6 先、L4-T16 后。
