# web/src/features/rooms/

联机练习:大厅(房间号加入、创建)、房间群聊、助手私聊面板(组句一键发送)、`@ai` 公开回答、房主设置。
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §5, §7.3, §10.

## What lives here
- `protocol.ts`(对应 `server/app/rooms/protocol.py`,测试直接读服务端文件)、`rooms-api.ts`、`use-rooms-enabled.ts`
- `room-state.ts`(纯 reducer)、`room-socket.ts`(票据、重连、补发)、`use-room.ts`
- `rooms-lobby-page.tsx`、`code-input.tsx`、`create-room-sheet.tsx`
- `room-page.tsx`、`room-message-list.tsx`、`room-composer.tsx`、`assist-tray.tsx`、`room-settings-sheet.tsx`

## Public surface
`RoomsLobbyPage`、`RoomPage`、`fetchRoomsConfig`、`useRoomsEnabled`。

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`settings/`、`@renderer/*`、其他 feature 的 `index.ts`。

## Test
`cd web && yarn vitest run src/features/rooms`

## Pitfalls
- 票据在 WS 地址里,是机密:不记录、不放进错误信息。
- 路由用房间 id,不用房间号(号码关闭后会复用)。
- 私聊面板的内容只属于本人;不要把 assist 事件放进公共消息列表。
