import type { ActivityState } from "../protocol";

/**
 * 发「正在输入」(spec §6.5):输入框有内容且最近 3 秒有按键 → typing(同状态最多每 3 秒一次);清空 / 发送 → idle。
 * send 是 useRoom().typing(没连上时返回 false)。车道 WE,任务 WE2 替换实现,签名不变。
 *
 * F5 桩:无操作。
 */
const NOOP = { onDraft: (_text: string): void => undefined, onSent: (): void => undefined };

export function useTypingEmitter(_send: (state: ActivityState) => boolean): { onDraft(text: string): void; onSent(): void } {
  return NOOP;
}
