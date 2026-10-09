import { AtSignIcon, KeyboardIcon, MicIcon, SendIcon, XIcon } from "lucide-react";
import { forwardRef, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "~/components/icon-button";
import { cn } from "~/lib/cn";
import { mentionsAi, ROOM_LIMITS } from "./protocol";

const keyClass = "flex size-tap flex-none items-center justify-center rounded-button transition-colors duration-fast "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[21px]";
/** 视觉小于 44px 的键:::before 向四周扩到 44px 命中区 */
const smallKey = "relative before:absolute before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface RoomComposerProps {
  disabled: boolean; offline?: boolean; value: string; ai: boolean; banner?: ReactNode; onDismiss?(): void;
  onChange(v: string): void; onSend(): void;
  /** 左侧圆形助手入口(AssistEntry) */
  leading?: ReactNode;
  /** 发送目标:assist 时输入框左侧显示「问助手 ×」胶囊 */
  target: "group" | "assist"; onClearTarget(): void;
  /** 语音:available=false 时不显示切换键;mode=voice 时用 input 取代文本框 */
  voice: { available: boolean; mode: "text" | "voice"; onToggle(): void; input: ReactNode };
  /** 输入行之上的内容(引用条、正在输入行) */
  above?: ReactNode;
}

/**
 * 房间输入条 v2(视觉稿 rooms-v2 V2–V5 的 .composer,玻璃 + 顶部发丝线):
 * [助手入口 44 圆] [话筒/键盘 44] [输入框 44(目标为助手时左内侧「问助手 ×」胶囊、蓝色描边;空且可 @ai 时右内侧 @ 小键)/ 语音长条] [发送 44]。
 * 语音模式时长条占满,发送键隐藏。banner 是连接状态 / 提示 / 已结束,在输入行之上;above(引用条、正在输入)在 banner 之下。
 * 停靠面板(z-29)在输入条(z-30)之下、贴着输入条上沿。WA 车道在 F5 之后独占本文件。
 */
export const RoomComposer = forwardRef<HTMLDivElement, RoomComposerProps>(function RoomComposer(
  { disabled, offline = false, value, ai, banner, onDismiss, onChange, onSend, leading, target, onClearTarget, voice, above }, ref) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const mention = mentionsAi(value).ai || /^@ai\s/i.test(value);
  const assist = target === "assist";
  const voiceMode = voice.available && voice.mode === "voice";
  const placeholder = assist ? t("web.rooms.assist.placeholder") : t("web.rooms.room.placeholder");
  return (
    <div ref={ref} data-testid="room-composer" className="glass glass-edge-t absolute inset-x-0 bottom-0 z-30 px-2 pb-2 pt-2">
      {banner && (
        <div role="status" className="mx-1 mb-2 flex min-h-8 items-center gap-1 rounded-badge bg-surface-2 pl-3 text-sub text-ink">
          <span className="min-w-0 flex-1 py-1.5">{banner}</span>
          {onDismiss && (
            <IconButton label={t("web.rooms.room.dismiss")} className="h-8 text-ink-2 hit-expand [&_svg]:size-4" onClick={onDismiss}><XIcon /></IconButton>
          )}
        </div>
      )}
      {above}
      <div data-testid="room-composer-row" className="flex items-center gap-1.5">
        {leading}
        {voice.available && (
          <button type="button" data-testid="room-voice-toggle" disabled={disabled} onClick={voice.onToggle}
            aria-pressed={voiceMode} aria-label={voiceMode ? t("web.chat.composer.toKeyboard") : t("web.chat.composer.toVoice")}
            className={cn(keyClass, "text-ink-2 hover:bg-surface-2")}>{voiceMode ? <KeyboardIcon aria-hidden /> : <MicIcon aria-hidden />}</button>
        )}
        {voiceMode ? (
          <div data-testid="room-voice-box" className="min-w-0 flex-1">{voice.input}</div>
        ) : (
          <div data-testid="room-input-box"
            className={cn("relative flex h-tap min-w-0 flex-1 items-center rounded-button bg-surface pr-1.5 transition-shadow duration-fast",
              assist ? "border border-blue/40 pl-1.5" : "border-[0.5px] border-hair pl-3",
              "focus-within:border-blue focus-within:ring-[3px] focus-within:ring-blue/15")}>
            {assist && (
              <span data-testid="room-target-assist"
                className="mr-2 inline-flex h-[26px] flex-none items-center gap-px rounded-[8px] bg-blue-tint pl-2 pr-0.5 text-meta font-semibold text-blue">
                {t("web.rooms.room.askAssist")}
                <button type="button" data-testid="room-target-clear" aria-label={t("web.rooms.room.backToGroup")}
                  onClick={() => { onClearTarget(); inputRef.current?.focus(); }}
                  className={cn(smallKey, "flex size-[22px] items-center justify-center rounded-full before:-inset-[11px] [&_svg]:size-3.5")}>
                  <XIcon aria-hidden />
                </button>
              </span>
            )}
            <input ref={inputRef} data-testid="room-input" disabled={disabled} value={value} maxLength={ROOM_LIMITS.text} enterKeyHint="send"
              aria-label={placeholder} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (!offline) onSend(); } }}
              className="h-full min-w-0 flex-1 truncate bg-transparent text-base text-ink placeholder:text-ink-2 focus-visible:outline-none disabled:opacity-60" />
            {ai && !assist && !value && (
              <button type="button" data-testid="room-at-ai" aria-label="@ai" aria-pressed={mention} disabled={disabled}
                onClick={() => { onChange(/^@ai\b/i.test(value) ? value : `@ai ${value}`); inputRef.current?.focus(); }}
                className={cn(smallKey, "flex size-8 flex-none items-center justify-center rounded-[8px] text-ink-3 before:-inset-1.5 hover:bg-surface-2 disabled:opacity-40 [&_svg]:size-[18px]")}>
                <AtSignIcon aria-hidden />
              </button>
            )}
          </div>
        )}
        {!voiceMode && (
          <button type="button" data-testid="room-send" aria-label={t("web.rooms.room.send")} disabled={disabled || offline || !value.trim()} onClick={onSend}
            className={cn(keyClass, "bg-blue text-on-blue active:bg-blue/90")}><SendIcon aria-hidden /></button>
        )}
      </div>
    </div>
  );
});
