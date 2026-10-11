# web/src/features/rooms/

联机练习:大厅(房间号加入、创建、「我的房间」)、房间群聊、助手停靠面板(组句一键发送)、`@ai` 公开回答、房主设置;
v2 加了 7 项设置、审批加入与邀请链接、语音消息、引用与表情回应、正在输入、房间结束后的学习小结。
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §5, §7.3, §10(v1);
`docs/superpowers/specs/2026-10-10-rooms-v2-design.md`(v2)。计划:`docs/superpowers/plans/2026-10-10-rooms-v2.md`。

## What lives here
- `protocol.ts`(对应 `server/app/rooms/protocol.py`,测试直接读服务端文件)、`rooms-api.ts`、`use-rooms-enabled.ts`
- `room-state.ts`(纯 reducer)、`room-socket.ts`(票据、重连、补发)、`use-room.ts`
- `rooms-lobby-page.tsx`、`code-input.tsx`、`create-room-sheet.tsx`、`room-settings-sheet.tsx`
- `room-page.tsx`(壳与插槽接线)、`room-message-list.tsx`(消息与 v2 插槽)、`room-composer.tsx`(输入条:目标切换、语音/文字)
- `create/` 7 项设置表单、情景选择、审批横幅与申请状态、设置变更系统消息的文案(`settings-message.ts`)、v2 接口与错误表(`rooms-v2-api.ts`)
- `voice/` 按住说话(复用对话页手势)、上传、语音气泡(播放、转文字、翻译、重试)、自动转文字设置(`auto-text.ts`)
- `assist/` 助手停靠面板(三档 `dock-snap.ts`、软键盘收成一行 `use-soft-keyboard.ts`)、圆形入口按钮(琥珀未读点)、建议卡
- `extras/` 引用、表情回应、消息操作菜单、文本「译」「朗读」、正在输入、邀请面板与二维码(本地生成)、邀请落地页、学习小结卡与小结页
- `ended/` 已结束页(`ended-rooms-page.tsx`、数据 hook `use-ended-rooms.ts`、自带 i18n);`lazy-ended.tsx` 懒加载壳;`extras/reopen-bar.tsx` 房主重新开启入口
- 各目录自带 `i18n/{zh-CN,en}.json`(`web/src/i18n/index.ts` 的 glob 自动深合并;可以往 `web.rooms.notice` / `web.rooms.errors` 里补键)
- `ui.ts`(视觉稿 .btn / 输入框的类名)、`room-fixtures.ts`(测试用的线上 JSON 样例,不放进 *.test.ts 以免被重复执行)

## Slots(插槽)与 room-page 冻结
`room-page.tsx` 在 F5 之后冻结:只接线,不放功能逻辑。各子目录通过固定签名的插槽接入——
`AssistDock` / `AssistEntry`(composer 的 `leading`)、`VoiceInput`(composer 的语音输入)、`QuoteBar` + `ActivityLine`(输入条上方)、
`JoinRequestBanner`、`SummaryCard`(已结束房间)、`ReopenBar`(已结束房间,房主)、`InviteSheet`;消息列表里是 `VoiceBubble`、`QuoteBlock`、`ReactionBar`、`MessageActions`、`TextTranslation`。
冻结的理由:四条并行车道(create / voice / assist / extras)都要接进同一页面,只改插槽实现、不改页面,才能互不冲突、单独测试。
确实要改页面时在计划里写 Addendum 说明理由(参见计划的 WA-1、WE-1、WV-1)。
WR-1(2026-10-12):`room-page.tsx` 只增加 `ReopenBar` 一行接线,理由:重新开启入口只能出现在页面的结束态里;逻辑全在 `extras/reopen-bar.tsx` 与 `use-room.ts`。

## Public surface
`RoomsLobbyPage`、`RoomPage`、`RoomInvitePage`(`/rooms/invite/:token`)、`RoomSummaryPage`(`/rooms/r/:roomId/summary`)、`RoomsEndedPage`(`/rooms/ended`,懒加载)、`fetchRoomsConfig`、`useRoomsEnabled`。

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`settings/`、`@renderer/*`、其他 feature 的 `index.ts`(例如 `~/features/chat` 的朗读与翻译)。

## Test
`cd web && yarn vitest run src/features/rooms`
页面测试断言中文文案:`beforeEach` 写 `localStorage["enjoy-web.settings"] = {language:"zh-CN"}`,`afterEach` 删掉并切回 `en`。

## Pitfalls
- 票据在 WS 地址里,邀请 token 在邀请链接里,两者都是机密:不记录、不放进错误信息(错误一律经 `translateServerError` 映射成固定文案)。
- 契约测试逐键绑定服务端录制的样例(`server/tests/fixtures/`,`CONTRACT_UPDATE=1` 在服务端重录),改字段时两边一起改:
  `rooms-contract.test.ts`(`rooms_contract.json`)、`create/rooms-v2-contract.test.ts`(`rooms_v2_core_contract.json`)、
  `extras/extras-contract.test.ts`(core + `rooms_v2_summary_contract.json`)、`rooms-reopen-contract.test.ts`(`rooms_reopen_contract.json`)、`voice/voice-contract.test.ts`(`rooms_v2_voice_contract.json`,
  还核对服务端的语音错误原文与每个 WS `notice`/`error` code 都有中英文案)。
- `camelcase-keys` 会改写对象的键:表情回应在线上是 `[{key, user_ids}]` 列表,不是以表情 key 为键的对象。
- 路由用房间 id,不用房间号(号码关闭后会复用)。
- 助手面板的内容只属于本人;不要把 assist 事件放进公共消息列表。面板在输入条之上、不遮挡聊天(E2E 断言最后一条消息底边 < 面板顶边),用实色(一屏最多三层模糊)。
- 语音:别人的语音默认只显示语音条,「转文字」「翻译」手动展开(或打开自动转文字);音频带鉴权取 Blob,只在点播放时请求;410 = 管理员已清理。
  语音配额是每人**每天** 200 MB + 100 条(产品负责人确认的默认值),文案要说「今天」。
- 自动转文字的翻译只为进入视野的语音请求,经 `voice/translate-queue.ts` 限速(12 次/分钟、在途 2 条,低于服务端 20 次/分钟);
  15 秒没有 voice_update 就显示「翻译没有完成 · 重试」,不自动重发。重连后列表里仍在转写/翻译中的语音用 HTTP 重新读一次(`voice_sync`)。
- 自己 HTTP 上传的语音用 `local_message` 并入列表,不推进 `lastSeq`(补发游标只随 WS 的 message 前进)。
- 管理员隐藏的消息(`hidden: true`,或收到 `message_hidden{seq}`)保留位置、正文为空,显示 `room.hidden` 占位,引用它的摘要也清空;管理员关闭房间 `closed{reason:"admin"}` → `errors.closed_admin`。
- 房间消息永久保存:票据 404(房间已结束)时 `use-room` 改走 HTTP(`GET /api/rooms/{id}` + `/messages?before_seq=2147483647`)只读回看;`before_seq` 用 int32 上限,别用 MAX_SAFE_INTEGER。
- 页面与对话页同构:顶栏、输入条 absolute 浮在自己滚动的列表上(不用 fixed,底部导航仍在)。v1 的底部弹层助手(`assist-tray.tsx`)已删除。
- 已结束房间没有 WebSocket(票据 404):只读查看者靠 `use-room` 每 20 秒轮询 `GET /api/rooms/{id}` 感知重新开启(R-O3);
  `reopened`(轮询、房主本人、将来的推送)都经 reducer 的 `reopenSignal` 触发 `reset` + 重连,别在别处直接 `connect()`。
- 「已结束的房间」页是懒加载的(`lazy-ended.tsx`),不要从 `index.ts` 静态导出 `ended/ended-rooms-page`;大厅只列开放房间,`endedCount` 来自 `GET /mine`。
- 重新开启入口由 `closeReason` 决定:`admin` 关闭的不显示(只有管理后台能开);409「Room is not closed」按成功处理并重读房间。
