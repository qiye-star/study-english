import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ActivityState } from "../protocol";

/** 同一状态最多每 3 秒发一次(spec §6.5);收方 6 秒未刷新即消失,所以持续输入时每 3 秒续一次。 */
export const TYPING_RESEND_MS = 3_000;
/** 停止按键 5 秒 → idle。 */
export const TYPING_IDLE_MS = 5_000;

/**
 * 发「正在输入」(spec §6.5):输入框有内容且最近有按键 → typing(同状态最多每 3 秒一次);清空 / 发送 / 停止输入 5 秒 / 卸载 → idle
 * (只在上次发出去的是 typing 时)。send 是 useRoom().typing,没连上时返回 false:这一帧不算发出,下一次按键再试。
 * 「正在说话」由语音输入直接调 room.typing("recording"),不经过这里。
 */
export function useTypingEmitter(send: (state: ActivityState) => boolean): { onDraft(text: string): void; onSent(): void } {
  const sendRef = useRef(send);
  sendRef.current = send;
  const last = useRef<ActivityState>("idle");
  const typingAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const idle = useCallback(() => {
    clearTimer();
    if (last.current !== "typing") return;
    last.current = "idle";
    sendRef.current("idle");
  }, []);

  useEffect(() => idle, [idle]);

  return useMemo(() => ({
    onDraft(text: string) {
      if (!text.trim()) {
        idle();
        return;
      }
      const now = Date.now();
      if (last.current !== "typing" || now - typingAt.current >= TYPING_RESEND_MS) {
        if (sendRef.current("typing")) {
          last.current = "typing";
          typingAt.current = now;
        }
      }
      clearTimer();
      if (last.current === "typing") timer.current = setTimeout(idle, TYPING_IDLE_MS);
    },
    onSent: idle,
  }), [idle]);
}
