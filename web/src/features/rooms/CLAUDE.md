# web/src/features/rooms/

联机练习:大厅(房间号加入、创建)、房间群聊、助手私聊面板(组句一键发送)、`@ai` 公开回答、房主设置。
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §5, §7.3, §10.

## What lives here
- `protocol.ts`(对应 `server/app/rooms/protocol.py`,测试直接读服务端文件)、`rooms-api.ts`、`use-rooms-enabled.ts`
- `room-state.ts`(纯 reducer)、`room-socket.ts`(票据、重连、补发)、`use-room.ts`
- `rooms-lobby-page.tsx`、`code-input.tsx`、`create-room-sheet.tsx`
- `room-page.tsx`、`room-message-list.tsx`、`room-composer.tsx`、`assist-tray.tsx`、`room-settings-sheet.tsx`
- `ui.ts`(视觉稿 .btn / 输入框的类名)、`room-fixtures.ts`(测试用的线上 JSON 样例,不放进 *.test.ts 以免被重复执行)

## Public surface
`RoomsLobbyPage`、`RoomPage`、`fetchRoomsConfig`、`useRoomsEnabled`。

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`settings/`、`@renderer/*`、其他 feature 的 `index.ts`。

## Test
`cd web && yarn vitest run src/features/rooms`
页面测试断言中文文案:`beforeEach` 写 `localStorage["enjoy-web.settings"] = {language:"zh-CN"}`,`afterEach` 删掉并切回 `en`。

## Pitfalls
- 票据在 WS 地址里,是机密:不记录、不放进错误信息。
- 契约:`rooms-contract.test.ts` 把 `protocol.ts` / `rooms-api.ts` 的类型逐键绑定到 `server/tests/fixtures/rooms_contract.json`(服务端 `test_web_contract.py` 对真实应用录制);改字段时两边一起改。
- 路由用房间 id,不用房间号(号码关闭后会复用)。
- 私聊面板的内容只属于本人;不要把 assist 事件放进公共消息列表。
- 管理员隐藏的消息(`hidden: true`,或收到 `message_hidden{seq}`)保留位置、正文为空,显示 `room.hidden` 占位;管理员关闭房间 `closed{reason:"admin"}` → `errors.closed_admin`。
- 房间消息永久保存:票据 404(房间已结束)时 `use-room` 改走 HTTP(`GET /api/rooms/{id}` + `/messages?before_seq=2147483647`)只读回看;`before_seq` 用 int32 上限,别用 MAX_SAFE_INTEGER。
- 页面与对话页同构:顶栏、输入条 absolute 浮在自己滚动的列表上(不用 fixed,底部导航仍在)。一屏最多三层模糊:助手面板用实色 BottomSheet。
