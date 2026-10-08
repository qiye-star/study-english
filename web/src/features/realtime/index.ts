// realtime 的公共接口:其他目录只能从这里引入 realtime(由 src/architecture.test.ts 约束)。
export { fetchRealtimeConfig, type RealtimeConfig } from "./realtime-api";
export type { CallEnding, RealtimeEnv } from "./realtime-call";
export { RealtimeCallDialog, prepareCallAudio } from "./realtime-call-screen";
