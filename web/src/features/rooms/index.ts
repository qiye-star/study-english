// rooms 的公共接口:其他目录只能从这里引入 rooms(由 src/architecture.test.ts 约束)。
export { RoomsLobbyPage } from "./rooms-lobby-page";
export { RoomPage } from "./room-page";
export { fetchRoomsConfig, type RoomsConfig } from "./rooms-api";
export { useRoomsEnabled } from "./use-rooms-enabled";
