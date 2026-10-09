import type { RoomVoiceController } from "./use-room-voice";

/**
 * 输入条的语音模式:`~/components/hold-to-talk-bar` 驱动 RoomVoiceController(车道 WV,任务 WV2 替换实现,签名不变)。
 * 房间页在 composer 的 voice.mode === "voice" 时用它取代文本框。
 *
 * F5 桩:不渲染。
 */
export function VoiceInput(_props: { voice: RoomVoiceController; disabled: boolean; maxMs: number }): JSX.Element | null {
  return null;
}
