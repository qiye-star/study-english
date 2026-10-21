# 联机并入对话(车道 L6)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 日期:2026-10-21 · 状态:只有文档,没有产品代码;未提交
- Spec:`docs/superpowers/specs/2026-10-21-chat-rooms-merge-design.md`(状态是**提案,等用户最终确认**;本计划照它写,偏离与待定项全部放在文末「Open questions」)
- 裁决来源:`docs/superpowers/plans/10.21-plans/2026-10-21-INDEX.md`(L6 行:仅网页;`web/src/pages/chat-hub.tsx`、`layout/bottom-nav.tsx`、
  `app.tsx` 中 `/chat`、`/rooms`、`/rooms/ended` 路由元素的包裹、相关测试与 README / CLAUDE 文案;**不改** `features/rooms/room-page.tsx` 与服务端)。
  合并顺序 **L6 先于 L4 Task 16**(INDEX §2)。
- 写计划前读过:根 `CLAUDE.md`、`docs/CLAUDE.md`、`web/CLAUDE.md`、`web/src/CLAUDE.md`、`web/src/layout/CLAUDE.md`、`web/src/pages/CLAUDE.md`、
  `web/src/features/CLAUDE.md`、`web/src/features/chat/CLAUDE.md`、`web/src/features/rooms/CLAUDE.md`、`web/e2e/CLAUDE.md`,以及下文每个引用的 文件:行号
  (2026-10-21 在 `feat/self-hosted-backend` 上读到的;实现前 Task 0 重新核对)。
- **写本计划时没有运行任何测试**,也没有改任何产品代码。

**Goal:** 底部导航从最多 5 个标签回到最多 4 个(练习 · 对话 · 跟读库 · 我的);「对话」页顶部在联机开启时多一个两段切换「AI 对话 | 联机」,
在 `/chat` 与 `/rooms` 两个现有页面之间跳转。URL 一条不改,邀请链接、服务端返回的邀请路径、E2E 路径都继续有效。

**Architecture:** 切换条只放在组合层 `web/src/pages/chat-hub.tsx`(`ChatHubLayout`),由 `app.tsx` 在三条路由的元素外面包一层(render prop),
把「标题 + 切换条」以一个普通属性 `embedded` 交给页面;`features/chat` 与 `features/rooms` 互相不知道对方(rooms→chat 这条已有的边不变,不新增边)。
`useRoomsEnabled()` 补一个「已解析值」的同步缓存,避免每次切换分区时切换条闪一帧。

**Tech Stack:** React 18 + react-router 6 + Vite + vitest + Testing Library;Playwright(只做类型检查,不跑)。

## Global Constraints

- 只改 `web/`;不改 `server/`、`enjoy/`、`admin/`。**不改** `features/rooms/room-page.tsx`(F5 后冻结)与 `room-settings-sheet.tsx`。
- `features/chat` 不得 import `~/features/rooms`;`features/rooms` 只保留已有的 `rooms->chat` 边;`CROSS_FEATURE_BASELINE` 大小仍是 19(`web/src/architecture.test.ts:67-71`、`:200`)。
- 文案只有中文、英文两种(INDEX §5 用户裁定:不做西语;`web/src/i18n/{en,zh-CN}.json:10` 里 `languages.es` 这个已有条目不动,也不新增任何 es 文案)。
- 每个任务只跑它列出的测试文件 + `yarn web:typecheck`;**不跑全量 `yarn web:test`、不跑 E2E、不重建容器**(用户要求时才做)。
- 一个逻辑改动一个提交,约定式前缀,提交后列出的测试保持绿;提交信息末尾按会话提示加 `Co-Authored-By` 行。
- 测试 id、URL、日志里不出现房间号、邀请 token、票据、用户 id(rooms CLAUDE.md Pitfalls 第 1 条)。

## 裁定(Rulings)

- **R1 组合位置。** 新文件 `web/src/pages/chat-hub.tsx`,导出 `ChatHubLayout`。`pages/` 只被 `app.tsx` / `main.tsx` 引入(`architecture.test.ts:104`),
  而 pages 可以经 `~/features/<name>` 用任何 feature,所以**不需要改层规则**;只在 `architecture.test.ts` 里追加几条钉住意图的断言(Task 4)。
- **R2 接线方式 = render prop。** `app.tsx` 里写 `<ChatHubLayout section="chat">{(embedded) => <ConversationsPage embedded={embedded} />}</ChatHubLayout>`。
  好处:`app.tsx` 仍然直接引入两个 feature 的页面(和今天一样),`chat-hub.tsx` 只需要 `~/features/rooms` 的 `useRoomsEnabled` 和共享组件,不 import `~/features/chat`;
  页面拿到的是一个显式属性,不靠 Context / Outlet context 之类的隐式通道,单测里直接传值即可。
- **R3 页面怎么让出大标题 = 可选属性 `embedded?: { title?: string; switcher: ReactNode }`。** 三个页面各自结构化声明这个类型(不新建共享类型文件,避免再碰 `layout/page-header.tsx`):
  - `embedded` 为 `undefined` → 页面与今天**逐字节相同**(联机关闭、尚未拿到配置、以及所有现有单测都走这条)。
  - `embedded.title` 有值 → 页面 `PageHeader` 的 `title` 换成它(两个根页面都用同一个「对话 / Chat」,切换分区时大标题不跳);分区名只出现在切换条里,不再重复。
  - `embedded.switcher` 紧跟在页面自己的 `<PageHeader …/>` 之后渲染(在内容之前)。页面自己的 `subtitle`、`actions`、`FeatureGate`、测试 id 全部保留——
    尤其是经典皮肤里顶栏的「新建」按钮 `conversation-new`(`features/chat/conversations-page.tsx:91-96`,`e2e/chat.spec.ts:43` 等在用)与液态皮肤的悬浮胶囊
    (`features/chat/conversation-list-liquid.tsx:88-89`)。
  - 为什么不是「hub 自己画一个顶栏、页面完全隐藏 PageHeader」:那样要把聊天页的副标题(`listCount`)和经典皮肤的「新建」动作搬进 hub,hub 就得知道 chat 的数据,违背 R1;
    为什么不是把切换条放在页面外面(页面上方):液态大标题(`layout/page-header.tsx:36-50`,`-mt-11` 与滚动 60px 后出现的胶囊)必须是滚动区里第一个块,外面插一行会破坏它。
- **R4 加载期间:延迟渲染,不放占位。** 规则:配置未知 = 不显示切换条(`embedded` 为 `undefined`)。理由:
  1. `ROOMS_ENABLED` 服务端默认关;放占位的话,默认部署在每个会话第一次进对话页时都会看到一块空白再收起,违背 spec「联机关闭时对话页与现在完全一样」;
  2. 联机开启时,切换条只会在**每个 ApiClient 第一次**进入对话页时出现一次;`/api/rooms/config` 只读库、很小,与会话列表请求在同一轮 effect 里发出,
     出现时页面通常还在「加载中…」,被推动的只是加载文字;
  3. 之后的每次挂载必须**同步**拿到已知值,否则每次在 `/chat` 与 `/rooms` 之间切换(两条路由 = 两次挂载)都会先渲染一帧「无切换条」再出现,
     这是真正的版面跳动来源。所以 Task 1 给 `useRoomsEnabled()` 补一个已解析值缓存,用它做 `useState` 的初值(`features/rooms/use-rooms-enabled.ts:6`、`:11`)。
     现在的 `useState(false)` + effect 里 `pending.then(...)` 一定会先画一帧 `false`。
- **R5 切换条 = 现有 `SegmentedControl`。** `components/segmented-control.tsx:19-36`(radiogroup,←/→ 循环,`testId` 写到每个选项上 `:9`、`:81`),
  按 `features/library/add-sheet.tsx:28` 的写法撑满一行(`className="flex w-full"`、`optionClassName="flex-1"`)。分区列表由 `ChatHubLayout` 内部常量给出:
  `[{ value: "chat", to: "/chat", testId: "hub-tab-chat" }, { value: "rooms", to: "/rooms", testId: "hub-tab-rooms" }]`;外层容器 `data-testid="chat-hub-switch"`。
  液态皮肤下 `SegmentedControl` 用的是 `bg-wash shadow-well`(不模糊的井材质),**不新增模糊层**。
- **R6 切换用 `navigate(to, { replace: true })`。** 分区像页签,不进返回栈:从「联机」按安卓返回键离开对话区,而不是弹回「AI 对话」。(待用户确认,见 Q2。)
- **R7 三条路由各自的 section。** `/chat` → `section="chat"`(标题 + 切换条);`/rooms` → `section="rooms"`(标题 + 切换条);
  `/rooms/ended` → `section="rooms-ended"`(**只有切换条,不换标题**:这是带返回键的二级页,`ended/ended-rooms-page.tsx:46` 的「已结束的房间」+ `back="/rooms"` 保留)。
  房间页、小结页、邀请页**不包**(`app.tsx:94-96` 不动),沿用整页体验;冻结的 `room-page.tsx:101`、`:320` 本来就回 `/rooms`,进入联机分区。
- **R8 导航。** `layout/bottom-nav.tsx`:删 `ROOMS`(`:19`)与 `UsersRoundIcon` import(`:1`)、删 `useRoomsEnabled` 调用与 import(`:6`、`:29`);
  `CHAT` 加 `also: ["/rooms"]`(`:18`;`under()` 在 `:24`,所以 `/roomsx` 不高亮);`items` 变成 `[PRACTICE, CHAT, ...(libraryOn ? [LIBRARY] : []), ME]`,最多 4 列
  (`columns={items.length}` 在 `:34` 不变,`GlassTabBar` 按它写 `gridTemplateColumns`,`components/glass-tab-bar.tsx:35`)。`also` 与联机开关无关:联机关闭时直接打开 `/rooms`
  (显示「未开启」)也高亮「对话」。删掉文案键 `web.nav.rooms`(`i18n/en.json:9`、`i18n/zh-CN.json:9`)与测试 id `nav-rooms`。
- **R9 副作用要写进文档:** 导航不再读联机配置,练习页、跟读库等页面加载时**不再**请求 `GET /api/rooms/config`;只有对话区(`/chat`、`/rooms`、`/rooms/ended`)与「我的」
  (`pages/me-page.tsx:138`,房间语音自动转文字一行)会请求。`web/README.md:77` 那句「页面加载时只多请求一次 … `/api/rooms/config`」要改。
- **R10 新文案放 `web/src/pages/i18n/{en,zh-CN}.json` 的 `web.chatHub.*`。** 四个键:`title`(对话 / Chat)、`label`(对话分区 / Chat sections,radiogroup 的 aria-label)、
  `chat`(AI 对话 / AI chat)、`rooms`(联机 / Rooms)。**不要**放进 `web.chat.*` 或 `web.rooms.*`:`i18n/index.ts` 按文件路径排序后深合并,同名键会静默覆盖 feature 自己的文案;
  rooms 的 `agents/locales.test.ts` 还会因为 `web.rooms.*` 与 `**/i18n/*.json` 重复而失败。`i18n/i18n.test.ts:44` 要求每个目录 en / zh-CN 键完全一致——两个文件一起改。
- **R11 标签长度规则保留 8 个英文字符 / 4 个汉字。** 4 列时每格更宽(按类名算:`inset-x-3` 两侧 12px + `p-[3px]`,(360 − 24 − 6) / 4 ≈ 82 px;原 5 列 ≈ 66 px,
  `layout/CLAUDE.md:21` 写的「约 72 px」是 360 / 5 的粗算),但不放宽:留余量,也没有标签需要更长。只改测试里的键列表与注释。真机宽度未量过。

## 文件结构(本车道触碰的全部文件)

| 文件 | 动作 | 任务 |
|---|---|---|
| `web/src/features/rooms/use-rooms-enabled.ts` + `.test.tsx` | 改:已解析值同步缓存 | 1 |
| `web/src/features/chat/conversations-page.tsx` + `.test.tsx` | 改:`embedded` 属性 | 2 |
| `web/src/features/rooms/rooms-lobby-page.tsx` + `.test.tsx` | 改:`embedded` 属性 | 3 |
| `web/src/features/rooms/ended/ended-rooms-page.tsx` + `.test.tsx`、`features/rooms/lazy-ended.tsx` | 改:`embedded` 属性与懒加载壳转发 | 3 |
| `web/src/pages/chat-hub.tsx`、`pages/chat-hub.test.tsx` | 新建 | 4 |
| `web/src/pages/i18n/{en,zh-CN}.json` | 加 `web.chatHub.*` | 4 |
| `web/src/architecture.test.ts` | 追加断言(共享文件,只在末尾追加) | 4、6 |
| `web/src/app.tsx` | 包三条路由元素 | 5 |
| `web/src/layout/bottom-nav.tsx`、`bottom-nav.test.tsx`、`feature-flags.test.tsx` | 改 | 6 |
| `web/src/i18n/{en,zh-CN}.json` | 删 `web.nav.rooms` | 6 |
| `web/e2e/admin-v2.spec.ts` | 改断言 | 7 |
| `web/README.md`、`README.md`(根,`:185` 一格)、`web/src/layout/CLAUDE.md`、`web/e2e/CLAUDE.md`、`web/src/features/chat/CLAUDE.md`、`web/src/features/rooms/CLAUDE.md`、`web/src/pages/CLAUDE.md` | 文档 | 8 |

不改:`features/rooms/room-page.tsx`、`room-settings-sheet.tsx`、`features/rooms/index.ts`、`features/chat/index.ts`(都不需要新导出)、
`styles/glass-budget.test.ts`、`styles/liquid-colour-guard.test.ts`(见 Task 4 第 6 步)、`layout/layout.test.tsx`(`:31-47` 只断言 `nav-practice` / `nav-chat` / `nav-me`,仍成立)、
`layout/app-height-coexist.test.tsx`(只 import `~/features/rooms/assist/use-soft-keyboard`,与导航无关)、服务端。

---

## Task 0:核对(不提交)

- [ ] **0.1** 在 L6 的 worktree 里(`node_modules` 按根 `CLAUDE.md` 联接),确认下列行号仍成立,不成立就以实际代码为准并在 PR 描述里记一句:
  `web/src/layout/bottom-nav.tsx:17-19、:29、:32、:34`;`web/src/app.tsx:9、:13、:85、:92-96`;`web/src/features/rooms/use-rooms-enabled.ts:6、:11、:22`;
  `web/src/features/chat/conversations-page.tsx:88-97`;`web/src/features/rooms/rooms-lobby-page.tsx:81-82`;`web/src/features/rooms/ended/ended-rooms-page.tsx:46`;
  `web/src/features/rooms/lazy-ended.tsx`(`RoomsEndedPage` 目前不收属性);`web/src/architecture.test.ts:67-71、:104、:116、:200`;`web/e2e/admin-v2.spec.ts:41、:45-80`。
- [ ] **0.2** 确认没有人在 L6 之前动了这些文件(`git log --oneline -5 -- <文件>`);尤其 L4 Task 16 只改 `features/chat/conversation-page.tsx`(单数),与本车道的 `conversations-page.tsx` 不是同一个文件。
- [ ] **0.3** 名字没被占用:`rg -n "chatHub|chat-hub|hub-tab-" web/src web/e2e` 应为空(2026-10-21 读时为空)。
- [ ] **0.4** 列出可能撞车的测试 id。结论(2026-10-21 读代码得出,实现时用 `rg -n 'data-testid' <文件>` 复核):
  - 对话列表(`conversations-page.tsx`、`conversation-list-liquid.tsx`、`scenario-sheet.tsx`):`conversation-new`、`conversation-item`、`conversation-delete`、`conversation-delete-confirm`、
    `conversation-continue`、`conversations-empty`、`scenario-*`。
  - 大厅(`rooms-lobby-page.tsx`、`code-input.tsx`、`create-room-sheet.tsx`、`components/feature-gate.tsx`):`room-code-input`、`code-cell`、`room-join`、`room-create`、`room-join-pending`、
    `room-join-cancel`、`room-join-outcome`、`my-room`、`rooms-ended-link`、`room-create-submit`、`feature-gate-loading`、`feature-gate-retry`。已结束页:`ended-room`、`ended-reopen`。
  - **没有重名**;而且两边是不同路由,**同一时刻只渲染一个页面**(hub 不同时挂两个页面),所以即使将来重名也不会在同一屏冲突。新增的 `chat-hub-switch`、`hub-tab-chat`、`hub-tab-rooms` 唯一。
  - 角色类选择器:hub 带来一个新的 `radiogroup`。E2E 里对 `radio` 的查询都已限定范围(`rooms-v2.spec.ts:41` 在 `room-join-mode` 内;`admin-v2.spec.ts:133`、`:151` 在管理端页面;
    `wordbook-goals.spec.ts:46-65` 在弹层内),不会误中切换条。`role="alert"` 两页各有一个(大厅 `:87` 常驻 sr-only),不同时渲染。
- [ ] **0.5** 跑一次基线,确认起点是绿的(只跑这些):
  `cd web && yarn vitest run src/layout/bottom-nav.test.tsx src/layout/feature-flags.test.tsx src/layout/layout.test.tsx src/architecture.test.ts src/features/rooms/use-rooms-enabled.test.tsx src/features/chat/conversations-page.test.tsx src/features/rooms/rooms-lobby-page.test.tsx src/features/rooms/ended/ended-rooms-page.test.tsx src/styles/glass-budget.test.ts src/styles/liquid-colour-guard.test.ts src/i18n/i18n.test.ts`,
  然后 `yarn web:typecheck`。

## Task 1:`useRoomsEnabled()` 从已解析值同步起步

文件:`web/src/features/rooms/use-rooms-enabled.ts`、`web/src/features/rooms/use-rooms-enabled.test.tsx`

- [ ] **1.1 先写失败测试**(`use-rooms-enabled.test.tsx` 追加):同一个 `ApiClient`,第一次挂载等到 `"true"` 后卸载;第二次挂载后**不经 `waitFor`、立即**断言
  `screen.getByTestId("rooms-enabled").textContent === "true"`,且 `/api/rooms/config` 总共只请求 1 次。再加一条:配置失败(502)后第二次挂载的首帧仍是 `"false"`(失败不进已解析缓存,原有重试用例不变)。
- [ ] **1.2 实现:** 模块级 `const resolved = new WeakMap<ApiClient, boolean>()`;成功时 `resolved.set(api, value)`(失败分支照旧 `cache.delete(api)`,不写 `resolved`);
  `useState(() => resolved.get(api) ?? false)`;effect 不变(值相同时 `setEnabled` 不触发重渲染)。注释改成「拿到配置前为 false;同一 ApiClient 再次挂载时同步给出已知值(计划 L6 R4)」。
  公共接口不变(`features/rooms/index.ts` 不动),`bottom-nav` / `me-page` 只是更早拿到真值。
- [ ] **1.3 验证:** `cd web && yarn vitest run src/features/rooms/use-rooms-enabled.test.tsx src/layout/bottom-nav.test.tsx src/layout/feature-flags.test.tsx`;`yarn web:typecheck`。
- [ ] **1.4 提交:** `fix(web): useRoomsEnabled starts from the resolved value on remount`

## Task 2:对话列表接受 `embedded`

文件:`web/src/features/chat/conversations-page.tsx`、`web/src/features/chat/conversations-page.test.tsx`

- [ ] **2.1 先写失败测试**(新 `describe("embedded in the chat hub (plan L6 R3)")`,经典与液态各一遍,液态用 `~/test/glass` 的 `setLiquid(true)` / `afterEach(setLiquid(false))`):
  - 传 `embedded={{ title: "对话", switcher: <div data-testid="probe-switch" /> }}`:`probe-switch` 出现且在 DOM 顺序上位于页面 `header` 之后、列表 / 空状态之前
    (`compareDocumentPosition`);`conversation-new` 仍然存在(经典在顶栏,液态是悬浮胶囊);标题文字是传入的 `title`。
  - 只传 `switcher` 不传 `title`:标题仍是 `web.chat.title`。
  - 不传 `embedded`:现有用例全部不改、照旧通过(这是「与今天相同」的保证)。
- [ ] **2.2 实现:** `export function ConversationsPage({ embedded }: { embedded?: { title?: string; switcher: ReactNode } } = {})`;
  两处 `PageHeader` 的 `title` 用 `embedded?.title ?? t("web.chat.title")`;在 `PageHeader` 三元表达式之后插入 `{embedded?.switcher}`。别的不动。
  `features/chat/index.ts` 不需要改(`ConversationsPage` 已导出)。
- [ ] **2.3 验证:** `cd web && yarn vitest run src/features/chat/conversations-page.test.tsx`;`yarn web:typecheck`。
- [ ] **2.4 提交:** `feat(web): the chat list can sit under a hub header`

## Task 3:大厅与已结束页接受 `embedded`

文件:`web/src/features/rooms/rooms-lobby-page.tsx`、`rooms-lobby-page.test.tsx`、`web/src/features/rooms/ended/ended-rooms-page.tsx`、`ended/ended-rooms-page.test.tsx`、`web/src/features/rooms/lazy-ended.tsx`

- [ ] **3.1 先写失败测试**(按 rooms CLAUDE.md 的约定,`beforeEach` 设 `zh-CN`、`afterEach` 切回 `en`):
  - 大厅:传 `embedded={{ title: "对话", switcher: <div data-testid="probe-switch" /> }}` → 大标题是「对话」而不是「联机练习」,`probe-switch` 在 `header` 之后、`room-code-input` 之前;
    联机关闭(`enabled:false`)时仍显示「联机练习未开启。」(`rooms-lobby-page.test.tsx:104` 那条不改);不传 `embedded` 的现有用例不改。
  - 已结束页:只传 `switcher` → 标题仍是「已结束的房间」,返回键仍去 `/rooms`,`probe-switch` 在 `header` 之后。
  - 懒加载壳:`RoomsEndedPage`(`lazy-ended.tsx`)把属性原样传给懒加载的页面——在已结束页测试里经 `~/features/rooms` 的 `RoomsEndedPage` 渲染一次,`findByTestId("probe-switch")`。
- [ ] **3.2 实现:**
  - `RoomsLobbyPage({ embedded }: { embedded?: { title?: string; switcher: ReactNode } } = {})`:`:81` 的 `title` 用 `embedded?.title ?? t("web.rooms.title")`,其后插入 `{embedded?.switcher}`(在 `FeatureGate` 之前)。
  - `ended-rooms-page.tsx` 的 `RoomsEndedPage` 同样收 `embedded`,`:46` 之后插入 `{embedded?.switcher}`;`title` 也按 `embedded?.title ?? …` 写(hub 在这里不传 title,R7)。
  - `lazy-ended.tsx`:`export function RoomsEndedPage(props: ComponentProps<typeof Page>)` → `<Page {...props} />`;**仍不从 `index.ts` 静态导出 `ended/ended-rooms-page`**(rooms CLAUDE.md Pitfalls)。
  - `room-page.tsx` 不碰。
- [ ] **3.3 验证:** `cd web && yarn vitest run src/features/rooms/rooms-lobby-page.test.tsx src/features/rooms/ended/ended-rooms-page.test.tsx`;`yarn web:typecheck`。
- [ ] **3.4 提交:** `feat(web): the rooms lobby and ended page can sit under a hub header`

## Task 4:`pages/chat-hub.tsx`(`ChatHubLayout`)

文件:新建 `web/src/pages/chat-hub.tsx`、`web/src/pages/chat-hub.test.tsx`;改 `web/src/pages/i18n/en.json`、`web/src/pages/i18n/zh-CN.json`、`web/src/architecture.test.ts`(末尾追加)

形状(落地时可微调,行为以测试为准):

```tsx
type Section = "chat" | "rooms" | "rooms-ended";
export interface HubEmbed { title?: string; switcher: ReactNode }
export function ChatHubLayout({ section, children }: { section: Section; children: (embedded: HubEmbed | undefined) => ReactNode }) {
  // roomsOn = useRoomsEnabled()(R4:未知 = false = 不显示);关 → children(undefined)
  // 开 → children({ title: section === "rooms-ended" ? undefined : t("web.chatHub.title"), switcher: <div data-testid="chat-hub-switch" …><SegmentedControl …/></div> })
  // onChange(value) → navigate(value === "chat" ? "/chat" : "/rooms", { replace: true })(R6)
}
```

- [ ] **4.1 先写失败测试**(`pages/chat-hub.test.tsx`;`renderWithProviders(…, { route, path, api })` + 一个读 `useLocation()` 的探针;`createFetchMock` 的 `GET /api/rooms/config`):
  1. 联机开、`section="chat"`:`chat-hub-switch` 出现;`hub-tab-chat` 的 `aria-checked="true"`、`hub-tab-rooms` 为 `"false"`;children 收到的 `title` 是「对话 / Chat」。
  2. 点 `hub-tab-rooms` → 路径变成 `/rooms`;`MemoryRouter` 初始栈 `["/practice", "/chat"]`,点击后 `navigate(-1)` 回到 `/practice`(证明是 replace,R6)。
  3. 键盘:在 `hub-tab-chat` 上按 `ArrowRight` → `/rooms`(沿用 `SegmentedControl` 的键盘行为)。
  4. `section="rooms"` 选中 `hub-tab-rooms`;`section="rooms-ended"` 选中 `hub-tab-rooms` 且 children 收到的 `title` 为 `undefined`。
  5. 联机关(`enabled:false`)与配置失败(502):children 收到 `undefined`,没有任何 `hub-tab-*`、没有 `chat-hub-switch`。
  6. 同一个 `ApiClient` 第二次挂载:**首帧**就有 `chat-hub-switch`(不用 `waitFor`;依赖 Task 1),`/api/rooms/config` 共 1 次。
  7. 液态皮肤(`setLiquid(true)`):`blurLayers(screen.getByTestId("chat-hub-switch"))` 为空(`~/test/glass`),切换条不贡献模糊层;
     中英两种语言下 `hub-tab-chat` / `hub-tab-rooms` 的文字分别是「AI 对话 / 联机」「AI chat / Rooms」。
- [ ] **4.2 架构断言(先写,`architecture.test.ts` 末尾追加一个 `it`,不改已有规则与基线):**
  - `violationsOf("features/chat/x.tsx", 'import { useRoomsEnabled } from "~/features/rooms";')` 长度为 1(chat 不得知道 rooms);
  - `violationsOf("pages/chat-hub.tsx", 'import { useRoomsEnabled } from "~/features/rooms";')` 为 `[]`;
  - `violationsOf("layout/x.tsx", 'import { ChatHubLayout } from "~/pages/chat-hub";')` 长度为 1(只有 `app.tsx` 组合 hub);
  - `sourceOf("pages/chat-hub.tsx")` 不含 `~/features/chat`(R2:hub 只认识 rooms 的开关,页面由 `app.tsx` 交进来);
  - `CROSS_FEATURE_BASELINE.size` 仍为 19(`:200` 已有,不改)。
- [ ] **4.3 文案:** `pages/i18n/en.json` 与 `zh-CN.json` 的 `web` 下各加 `"chatHub": { "title", "label", "chat", "rooms" }`(R10 的值),两边键完全一致。
- [ ] **4.4 实现** `chat-hub.tsx`:只 import `react`、`react-i18next`、`react-router-dom`、`~/components/segmented-control`、`~/features/rooms`(`useRoomsEnabled`)、`~/components/liquid`(如需 `LQ_PAGE` 对齐边距)。
  容器类:`px-gutter pb-2 liquid:px-frame`(与大厅的 `LQ_PAGE` 对齐);不使用任何 `mat-chrome*` / `mat-sheet` / `glass*` / `backdrop-blur-*` / `*-tint` / `teal` 类。
- [ ] **4.5 验证:** `cd web && yarn vitest run src/pages/chat-hub.test.tsx src/architecture.test.ts src/i18n/i18n.test.ts src/features/rooms/agents/locales.test.ts src/styles/glass-budget.test.ts src/styles/liquid-colour-guard.test.ts`;`yarn web:typecheck`。
- [ ] **4.6 毛玻璃 / 颜色守卫清单:预期不改。** `glass-budget.test.ts` 的 `BLUR_OWNERS` 只登记用了模糊材质的文件,hub 不用,所以**不加条目**;`liquid-colour-guard.test.ts:13-17` 的 `IN_SCOPE`
  已含 `"pages"`,新文件自动在扫描范围内;`:18-21` 的 `SKIP` 里 `layout/bottom-nav.tsx` 保持。若这两个测试要求改清单,说明 hub 用了不该用的类——改 hub,不改清单。
- [ ] **4.7 提交:** `feat(web): add the chat hub section switch (AI 对话 | 联机)`

## Task 5:`app.tsx` 包住三条路由元素

文件:`web/src/app.tsx`、`web/src/pages/chat-hub.test.tsx`(追加路由级用例)

- [ ] **5.1 先写失败测试**(追加到 `pages/chat-hub.test.tsx`,参照 `components/maintenance-screen.test.tsx:23-40` 的 `renderApp`:`AuthContext` + `SettingsProvider` + `MemoryRouter` + `AppRoutes`,
  但 `fetchImpl` 用 `createFetchMock` 并让 `/api/rooms/config` 返回 `enabled:true`,其余请求按页面需要给最小回包或 404):
  - `/chat`、`/rooms`、`/rooms/ended` 三条路由都出现 `chat-hub-switch`,选中项分别是 chat / rooms / rooms;
  - `/rooms/r/abc` 与 `/rooms/invite/x`(房间页、邀请页)**没有** `chat-hub-switch`(R7);
  - 路由路径本身不变:`/chat/:id`、`/rooms/r/:roomId`、`/rooms/r/:roomId/summary`、`/rooms/invite/:token` 仍能匹配(各渲染一次不落到 `*` → `/practice`)。
  - 若 `AppRoutes` 整树在 jsdom 里太重(懒加载、其他 feature 的请求),退而求其次:用 `readFileSync` 读 `app.tsx`,断言 `/chat`、`/rooms`、`/rooms/ended` 三行的 `element` 含 `ChatHubLayout`,
    并在用例注释里写明原因;两种做法二选一,**不要**两种都留。
- [ ] **5.2 实现:** `app.tsx` 加 `import { ChatHubLayout } from "~/pages/chat-hub";`,把 `:85`、`:92`、`:93` 三个 `element` 改为
  `<ChatHubLayout section="chat">{(e) => <ConversationsPage embedded={e} />}</ChatHubLayout>`、`section="rooms"` → `RoomsLobbyPage`、`section="rooms-ended"` → `RoomsEndedPage`。
  `path` 一个字都不改;`:86`、`:94-96` 不动。
- [ ] **5.3 验证:** `cd web && yarn vitest run src/pages/chat-hub.test.tsx src/architecture.test.ts src/components/maintenance-screen.test.tsx`;`yarn web:typecheck`。
- [ ] **5.4 提交:** `feat(web): wrap /chat, /rooms and /rooms/ended in the chat hub`

> 顺序要求:Task 5 必须在 Task 6 之前合并。否则中间那个提交里,联机开启的用户既没有「联机」标签、也没有切换条,进不了大厅(只能手输 URL)。

## Task 6:底部导航去掉「联机」

文件:`web/src/layout/bottom-nav.tsx`、`web/src/layout/bottom-nav.test.tsx`、`web/src/layout/feature-flags.test.tsx`、`web/src/i18n/en.json`、`web/src/i18n/zh-CN.json`、`web/src/architecture.test.ts`(追加一行断言)

- [ ] **6.1 先改测试(让它们先失败):**
  - `bottom-nav.test.tsx`:`mount()`(`:15-22`)不再等 `/api/rooms/config`,改为断言导航**从不**请求它(`callsTo(mock, "/api/rooms/config")` 长度 0,R9);`rooms()` 回包仍注册,用来证明「开了也不出现」。
    用例改为:联机开 + 跟读库关 → `["/practice", "/chat", "/me"]`;联机关 + 跟读库开 → `["/practice", "/chat", "/library", "/me"]`;两者都开 → 同上 4 项,且 `nav-library` 的断言(`:38-39`)保留;
    两者都关 → 3 项;任何情况下 `nav-rooms` 都不存在;`gridTemplateColumns` 最大是 `"repeat(4, minmax(0, 1fr))"`(替换 `:51` 的 5 列);
    标签长度循环(`:53-56`)键列表改成 `["practice", "chat", "library", "me"]`,注释改成「4 列,每格约 82 px;仍按 ≤ 8 个英文字符 / ≤ 4 个汉字(R11)」,并加一句 `i18n.exists("web.nav.rooms")` 为假。
    新增高亮用例:`/chat`、`/chat/c1`、`/rooms`、`/rooms/ended`、`/rooms/r/r1`、`/rooms/r/r1/summary`、`/rooms/invite/t` 上 `nav-chat` 都是 `aria-current="page"`,
    联机开关两种取值都测;`/roomsx` 上不高亮。现有 `/library*`、`/wordbook*` 高亮用例不改。
  - `feature-flags.test.tsx`(`:29-49`):关闭用例的等待条件里去掉 `called(mock, "/api/rooms/config")`(练习页上已不会请求;「我的」页仍会,用例对 `me` 额外断言 `called` 为真);
    仍是 3 个导航项、无 `nav-rooms`、`linksTo("/rooms")` 为空。开启用例从「5 tabs」改成「4 tabs」:`["nav-practice", "nav-chat", "nav-library", "nav-me"]`,且 `nav-rooms` 不存在;用例标题同步改。
  - `architecture.test.ts` 追加:`files` 中 `layout/` 下的非测试文件都不含 `"~/features/rooms"`(导航不再认识联机)。
- [ ] **6.2 实现:** 按 R8 改 `bottom-nav.tsx`;更新 `:31` 的注释为「练习 · 对话 · 跟读库 · 我的(跟读库关闭时少一个;最多 4 个;联机在「对话」里的切换条,计划 L6)」。
  删 `i18n/en.json:9` 与 `i18n/zh-CN.json:9` 的 `"rooms"` 一项(`label` / `practice` / `chat` / `me` 不动,`web.nav.library` 在 `features/library/i18n` 里,不动)。
- [ ] **6.3 验证:** `cd web && yarn vitest run src/layout/bottom-nav.test.tsx src/layout/feature-flags.test.tsx src/layout/layout.test.tsx src/architecture.test.ts src/i18n/i18n.test.ts src/styles/liquid-colour-guard.test.ts src/pages/me-page.test.tsx`;`yarn web:typecheck`。
- [ ] **6.4 提交:** `feat(web): fold the rooms tab into 对话 (at most 4 tabs)`

## Task 7:E2E 规格同步(只做类型检查,不运行)

文件:`web/e2e/admin-v2.spec.ts`

- [ ] **7.1 改 `admin-v2.spec.ts:41-80`:** `roomsTab` 换成 `const roomsSection = (web: Page) => web.getByTestId("hub-tab-rooms");`;用例标题改成
  `"hot toggle ROOMS_ENABLED off, the chat hub switch follows, revert brings it back"`。三处断言前都先 `await web.goto("/chat")`(`signIn` 之后与两次 `web.reload()` 之后;
  reload 改为 `goto("/chat")` 或保留 reload 但确认当前就在 `/chat`):开 → `roomsSection` 数量 1;关 → `await expect(web.getByTestId("nav-chat")).toBeVisible()` 后 `roomsSection` 数量 0;
  撤销 → 数量 1。每个阶段另加 `await expect(web.getByTestId("nav-rooms")).toHaveCount(0)`(标签已删除)。管理端部分(`:47-78` 的开关、理由、二次验证)不改。
- [ ] **7.2 不改、只核对的规格(写进 PR 描述:「读代码核对,未运行」):**
  - `rooms.spec.ts:18`、`:26`,`rooms-v2.spec.ts:38`、`:53`:直接 `goto("/rooms")`,之后用 `room-create`、`room-scenario-*`、`room-join-mode`(限定范围的 radio)、`room-code-input`、`room-join`、`room-code`——
    这些都在大厅或房间页,L6 只在大厅标题下多插一行切换条,id 与 URL 不变。
  - `accounts-admin.spec.ts:362`:`goto("/rooms")` 被挡到 `/account/email`,与导航无关。
  - `chat.spec.ts:42` 等、`grammar-prompt.spec.ts:30`、`progress.spec.ts:7`、`scenario-spot-check.spec.ts:34`:点 `nav-chat` 后点 `conversation-new`——两者都保留(R3)。
  - `login.spec.ts:39`、`:48`:`nav-chat` 高亮、三个导航目标 ≥ 44 px——4 列只会更宽。`login.spec.ts:52-53` 的「无横向溢出」同样受益。
  - `support/upstream-guard.ts:16`:`/api/rooms/config` 已在放行清单,不需要新增路径;L6 没有新的服务端接口。
- [ ] **7.3 验证:** `yarn web:typecheck`(E2E 规格包含在 `tsconfig.json` 里,只做类型检查)。**不运行** Playwright(需要 E2E 栈与 `E2E_ADMIN_PASSWORD`,用户要求时才跑)。
- [ ] **7.4 提交:** `test(web): admin-v2 follows the chat hub switch instead of nav-rooms`

## Task 8:文档

文件:`web/README.md`、`README.md`(根)、`web/src/layout/CLAUDE.md`、`web/e2e/CLAUDE.md`、`web/src/features/chat/CLAUDE.md`、`web/src/features/rooms/CLAUDE.md`、`web/src/pages/CLAUDE.md`

- [ ] **8.1 `web/README.md:77`:** 「关闭时 … 底部导航 3 个标签」保留,但把「页面加载时只多请求一次 `GET /api/rank/config` 与 `GET /api/rooms/config`」改为:练习页只多请求 `GET /api/rank/config`;
  `GET /api/rooms/config` 只在进入对话区(`/chat`、`/rooms`、`/rooms/ended`)与「我的」时请求一次(按 ApiClient 缓存);直接打开 `/rooms` 仍显示「未开启」。
- [ ] **8.2 `web/README.md:80`:** 「底部第 3 个标签「联机」」改为「「对话」标签里的「AI 对话 | 联机」切换(联机关闭时没有切换条;URL 仍是 `/rooms…`,邀请链接不变;切换条在 `src/pages/chat-hub.tsx`)」。
  `:84` 的「未在真机验证」清单末尾加一句指向本计划的设备清单。
- [ ] **8.3 根 `README.md:185`**(`ROOMS_ENABLED` 一行的「效果」格):「底部导航出现「联机」」改为「「对话」页顶部出现「AI 对话 / 联机」切换」。(不在 spec §3 的清单里,但不改就过时;见 Q3。)
- [ ] **8.4 `web/src/layout/CLAUDE.md`:** `:7` 改为「`bottom-nav.tsx`(练习 · 对话 · 跟读库 · 我的;跟读库由 `useLibraryEnabled()` 控制,最多 4 个;`对话` 的 `also: ["/rooms"]` 覆盖整个联机子树;导航不读联机配置)」;
  `:21` 改为「4 tabs at 360 px are about 82 px each (class math, not measured on a device): labels stay at most 8 English characters / 4 Chinese characters (`bottom-nav.test.tsx` guards it) …」。
- [ ] **8.5 `web/e2e/CLAUDE.md:6`:** `admin-v2` 括号里补一句「the web side checks the chat hub switch `hub-tab-rooms` (there is no `nav-rooms` any more)」;Pitfalls 加一条「联机没有底部标签:进大厅用 `goto("/rooms")` 或在 `/chat` 点 `hub-tab-rooms`」。
- [ ] **8.6 一句话说明:** `features/chat/CLAUDE.md` 的 Pages 行后加「列表页收 `embedded`(标题 + 切换条),分区外壳在 `pages/chat-hub.tsx`;chat 不 import rooms」;
  `features/rooms/CLAUDE.md` 的 Public surface 段加「`RoomsLobbyPage` / `RoomsEndedPage` 收 `embedded`;分区外壳在 `pages/chat-hub.tsx`;`useRoomsEnabled` 再次挂载时同步给出已知值」;
  `pages/CLAUDE.md` 第一行文件清单加 `chat-hub.tsx`(对话区分区外壳,`app.tsx` 用 render prop 包住三条路由)。
- [ ] **8.7 验证:** `yarn web:typecheck`(文档任务不改代码;顺手确认没有残留 `nav-rooms`:`rg -n "nav-rooms|web\.nav\.rooms" web` 只应剩历史计划 / 结果文档里的旧记录)。
- [ ] **8.8 提交:** `docs(web): document the chat hub and the 4-tab bottom nav`

更新日志不由本车道写:INDEX §8 规定由控制者在合并并经用户验证后写草稿。

---

## 顺序

**Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**。2 与 3 互不依赖,可以对调;4 依赖 1(用例 6)与 2、3 的属性类型;5 依赖 4;**6 必须在 5 之后**;7 依赖 6;8 最后。
整条车道合并在 L4 Task 16 之前(INDEX §2)。

## 风险与未验证项

- **全部 E2E 未运行**(本计划不跑):`admin-v2.spec.ts` 的新断言只做了类型检查;`rooms*.spec.ts`、`accounts-admin.spec.ts`、`chat.spec.ts`、`login.spec.ts` 等「应不变」的结论来自读代码(Task 7.2),**UNVERIFIED**。
- **真机未验证**:切换条的高度与触控、液态大标题与切换条的间距、4 列导航每格约 82 px 都是按类名推算的,没有在安卓 / iOS 上看过。
- **首帧出现**:联机开启的部署里,每个会话第一次进对话区时切换条会在配置返回后出现一次(R4 的取舍);在慢网络下是否明显,**UNVERIFIED**。
- **冷启动直达 `/rooms`**(刷新或外部深链):配置返回前大标题是「联机练习」,之后变成「对话」(只发生一次)。`start_url` 是 `/practice`(`web/public/manifest.webmanifest:4`),正常启动不经过这里。
- **滚动位置**:`AppShell` 的 `<main>` 是唯一滚动区,换路由时不自动回顶(今天切底部标签也是如此)。从滚到底的 AI 对话列表切到联机,大厅可能不是从顶部开始——与现状一致,**不在本车道修**,真机清单里看一眼。
- **radiogroup 语义**:`SegmentedControl` 是单选组,不是页签;读屏会读「单选按钮」。沿用 spec 的选择,见 Q4。
- **共享文件冲突**:`app.tsx`、`architecture.test.ts` 是共享文件(INDEX §6「只加一行锚点」);L6 只改 `app.tsx:85、:92、:93` 三行与一行 import,`architecture.test.ts` 只在末尾追加。冲突写进 PR 描述。
- **超出 INDEX §6 L6 行的文件**(见 Q3):`conversations-page.tsx`、`rooms-lobby-page.tsx`、`ended-rooms-page.tsx`、`lazy-ended.tsx`、`use-rooms-enabled.ts`、`pages/i18n/*.json`、根 `README.md`。
  其他车道都不拥有它们,冲突面小,但需要控制者在 INDEX §6 补记。

## 真机检查清单(用户执行;全部 **UNVERIFIED**)

在安卓 Chrome(视口 360 px 宽)上,浅色 / 深色各一遍,液态与经典皮肤各看一次;结果记进 `docs/superpowers/plans/e2e-results.md` 新的「L6 对话 / 联机合并」小节:

- [ ] 联机**开**:底部 4 个标签(跟读库开时)/ 3 个(跟读库关时),标签文字不截断;「对话」页顶部有「AI 对话 | 联机」,默认选中 AI 对话;
- [ ] 联机**关**:没有切换条,对话页与改动前一致(截图对比);直接打开 `/rooms` 显示「联机练习未开启。」,底部高亮「对话」;
- [ ] 两段之间来回切换 5 次:切换条不闪、不跳;大标题始终是「对话」;
- [ ] 在联机分区点进一个房间,再点底部「对话」标签 → 回到 **AI 对话**;
- [ ] 在房间里点左上角返回、以及按安卓系统返回键 → 回到**联机分区**(切换条选中「联机」);在联机分区按系统返回键 → 离开对话区(不回到 AI 对话,R6);
- [ ] 已结束页(`/rooms/ended`):有返回键、有切换条,两者都能用;
- [ ] 大厅房间号输入框弹出软键盘:切换条与输入框不被顶出屏幕、页面不横向滚动、收起键盘后版面复位;
- [ ] 毛玻璃预算:对话列表、大厅、已结束页每屏常驻模糊层 ≤ 3(顶栏胶囊、底部导航;切换条与悬浮「新对话」胶囊都不模糊);
- [ ] 邀请链接(`/rooms/invite/:token`)从别的应用打开:能进房,底部高亮「对话」,没有切换条;
- [ ] 读屏(TalkBack)能读出切换条的名称「对话分区」与两个选项。

## Open questions(等用户确认;未确认前按括号里的默认做)

- **Q1 已结束页要不要切换条?**(默认:要,只有切换条、不换标题,R7。备选:hub 在 `rooms-ended` 时不给切换条,只保留返回键。)
- **Q2 切换是否进返回栈?**(默认:`replace`,R6。备选:`push`,则安卓返回键会在两段之间来回。)
- **Q3 文件归属补记。** INDEX §6 的 L6 行没有列出 `features/chat/conversations-page.tsx`、`features/rooms/rooms-lobby-page.tsx`、`ended/ended-rooms-page.tsx`、`lazy-ended.tsx`、
  `use-rooms-enabled.ts`、`pages/i18n/*.json` 与根 `README.md:185`;spec §2 允许「页面接受 `embedded` 属性」,R4 需要改 hook。(默认:L6 修改这些文件,控制者在 INDEX §6 补一行;本计划不改 INDEX。)
- **Q4 无障碍语义。** 沿用 `SegmentedControl`(radiogroup)还是另做 `role="tablist"` 的导航型分段?(默认:沿用,spec 指定;tablist 留到以后。)
- **Q5 英文文案。** 标题用「Chat」(与底部标签一致)、分区「AI chat / Rooms」可以吗?(默认:是。)大厅的大标题从「联机练习」变成「对话」可以吗?(默认:是,spec「切换条代替大标题」。)
- **Q6 标签长度规则。** 4 列后是否放宽到 10 个英文字符 / 5 个汉字?(默认:不放宽,R11。)
- **Q7 spec 状态。** spec 仍标「提案,未批准」;用户确认后由用户或控制者改 spec 状态,本计划不改 spec。

## 不做(第二期,spec §2「不做」)

- 联机分区的未读红点(没有现成计数,需要服务端或轮询,另议);
- 记住上次停留的分区(底部「对话」总是回 AI 对话);
- AI 对话页顶部的「进行中房间」提示条;
- 任何路由、服务端邀请路径(`server/app/routers/rooms.py:391-392`)、日志脱敏正则(`server/app/core/logging_setup.py:20-22`)的改动(这两处行号取自 spec,本车道没有打开核对,也不需要改)。
