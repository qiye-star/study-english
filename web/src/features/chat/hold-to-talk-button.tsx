import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HoldToTalkBar } from "~/components/hold-to-talk-bar";
import type { DiscardReason } from "~/lib/hold-gesture";
import { VOICE_MAX_MS, type VoiceTurnState } from "./use-voice-turn";

/** 按住上限比录音上限早一点结束,让最后一帧也能收进这条语音。 */
export const MAX_HOLD_MS = VOICE_MAX_MS - 250;

export interface HoldToTalkButtonProps {
  voiceState: VoiceTurnState;
  disabled: boolean;
  onStart(): Promise<boolean>;
  onFinish(deliver: "send" | "fill"): void;
  onDiscard(reason: DiscardReason): void;
  /** 松手/第二次按键的同步阶段调用(iOS:autoSpeak.prime()) */
  onRelease(): void;
  /** 录音中在浮层卡片里显示的状态(计时器) */
  recordingStatus?: ReactNode;
}

/**
 * 聊天的"按住 说话"长条:共享的 `HoldToTalkBar`(手势、浮层、落点、读屏播报都在那里)接上语音消息的状态。
 * 转文字(`fill`)把转写放进输入框。
 */
export function HoldToTalkButton({ voiceState, disabled, onStart, onFinish, onDiscard, onRelease, recordingStatus }: HoldToTalkButtonProps) {
  const { t } = useTranslation();
  return (
    <HoldToTalkBar testId="chat-mic" data={{ "data-state": voiceState }} disabled={disabled}
      live={voiceState === "recording" || voiceState === "starting"}
      busy={voiceState === "processing"} busyLabel={t("web.chat.transcribing")}
      maxHoldMs={MAX_HOLD_MS} onStart={onStart} onFinish={onFinish} onDiscard={onDiscard} onRelease={onRelease}
      recordingStatus={recordingStatus} />
  );
}
