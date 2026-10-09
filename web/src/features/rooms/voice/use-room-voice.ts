import type { DiscardReason } from "~/lib/hold-gesture";
import type { ActivityState, RoomMessage } from "../protocol";

/**
 * 房间语音录制与发送(spec 2026-10-10 §4.1–4.2;车道 WV,任务 WV1 替换实现,签名不变,计划 P2-4)。
 * 手势与对话页相同:松手 finish("send") 上传语音;上滑「文」finish("fill") 只转文字填进输入框;
 * target="assist" 时松手 = 转文字后 onAssistDraft(R2-12)。录音期间 onActivity("recording"),结束 onActivity("idle")。
 *
 * F5 桩:始终 idle,start() 返回 false,其余无操作。
 */
export type RoomVoiceState = "idle" | "starting" | "recording" | "sending" | "transcribing";
export interface RoomVoiceController {
  state: RoomVoiceState; elapsedMs: number; error: string | null;
  start(): Promise<boolean>; finish(deliver: "send" | "fill"): void; discard(reason: DiscardReason): void; release(): void;
}
export interface UseRoomVoiceOptions {
  roomId: string; enabled: boolean; maxMs: number; target: "group" | "assist"; replyTo: number | null;
  onFill(text: string): void; onAssistDraft(text: string): void; onSent(message: RoomMessage): void; onActivity(state: ActivityState): void;
}

const IDLE: RoomVoiceController = {
  state: "idle", elapsedMs: 0, error: null,
  start: () => Promise.resolve(false), finish: () => undefined, discard: () => undefined, release: () => undefined,
};

export function useRoomVoice(_options: UseRoomVoiceOptions): RoomVoiceController {
  return IDLE;
}
