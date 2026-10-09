import type { RoomMessage } from "../protocol";

/**
 * 语音消息气泡的内容(播放键、时长、「转文字」「翻译」、转写/译文状态;spec §4.3–4.6)。
 * 车道 WV,任务 WV3 替换实现,签名不变。外层气泡(头像、名字、引用块、回应)由 room-message-list 渲染。
 * autoText:「我的 → 联机语音自动转文字」(useRoomVoiceAutoText);onTranslate / onRetry 发 WS voice_translate / voice_retry。
 *
 * F5 桩:只显示正文(转写完成后 text = 转写)。
 */
export function VoiceBubble({ message }: {
  message: RoomMessage; mine: boolean; roomId: string; autoText: boolean;
  onTranslate(seq: number): void; onRetry(seq: number): void;
}): JSX.Element {
  return <span className="whitespace-pre-wrap break-words">{message.text}</span>;
}
