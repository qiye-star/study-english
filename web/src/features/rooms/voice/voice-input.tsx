import { useTranslation } from "react-i18next";
import { HoldToTalkBar } from "~/components/hold-to-talk-bar";
import { primeAudioElement, sharedAutoplayAudio } from "~/features/chat";
import { formatClock } from "~/lib/format-clock";
import type { RoomVoiceController } from "./use-room-voice";

/** 错误行里的文字键(重发 / 丢弃):44px 高 */
const linkKey = "inline-flex min-h-tap flex-none items-center rounded-inline px-2 text-meta font-semibold "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

/**
 * 输入条的语音模式(spec 2026-10-10 §4.1;车道 WV,任务 WV2):与对话页、通话同一个共享 `HoldToTalkBar`——
 * 按住录音,松手发送;上滑到左侧取消,到右侧「文」只转文字填进输入框。手势上限比录音上限早 250 ms(与对话页相同)。
 * 房间页在 composer 的 voice.mode === "voice" 时用它取代文本框。
 */
export function VoiceInput({ voice, disabled, maxMs }: { voice: RoomVoiceController; disabled: boolean; maxMs: number }): JSX.Element | null {
  const { t } = useTranslation();
  const { state } = voice;
  const busy = state === "sending" || state === "transcribing";
  const recording = state === "recording";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {(voice.error || voice.failed) && (
        <div className="flex min-w-0 items-center gap-1 px-1">
          {voice.error && <p data-testid="room-voice-error" role="alert" className="min-w-0 flex-1 truncate text-meta text-ink-2">{voice.error}</p>}
          {voice.failed && (
            <>
              <button type="button" data-testid="room-voice-resend" disabled={busy} onClick={() => voice.retryUpload?.()}
                className={`${linkKey} text-blue`}>{t("web.rooms.voice.resend")}</button>
              <button type="button" data-testid="room-voice-discard" disabled={busy} onClick={() => voice.discardFailed?.()}
                className={`${linkKey} text-ink-2`}>{t("web.rooms.voice.discard")}</button>
            </>
          )}
        </div>
      )}
      <div className="flex min-w-0">
        <HoldToTalkBar testId="room-mic" data={{ "data-state": state }} tone="neutral" allowToText
          disabled={disabled || busy} live={recording || state === "starting"}
          busy={busy} busyLabel={state === "sending" ? t("web.rooms.voice.sending") : t("web.rooms.voice.transcribing")}
          maxHoldMs={maxMs - 250}
          recordingStatus={recording ? (
            <div data-testid="room-voice-timer" className="flex items-center gap-2 text-sub">
              <span className="h-2 w-2 rounded-full bg-red-solid ring-1 ring-white motion-safe:animate-pulse" aria-hidden="true" />
              <span className="num font-medium">{formatClock(voice.elapsedMs)}</span>
            </div>
          ) : null}
          onStart={voice.start} onFinish={voice.finish} onDiscard={voice.discard}
          onRelease={() => {
            primeAudioElement(sharedAutoplayAudio()); // iOS:松手这一下在手势内解锁播放
            voice.release();
          }} />
      </div>
    </div>
  );
}
