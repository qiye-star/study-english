import { AtSignIcon, LanguagesIcon, SendIcon, XIcon } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "~/components/icon-button";
import { cn } from "~/lib/cn";
import { mentionsAi, ROOM_LIMITS } from "./protocol";

const keyClass = "flex size-tap flex-none items-center justify-center rounded-button transition-colors duration-fast "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[21px]";

/**
 * 房间输入条(视觉稿 M2,玻璃 + 顶部发丝线):@ai 快捷键、文本框、助手(language 图标)、发送(钴蓝实底)。
 * banner 是连接状态 / 提示 / 已结束,放在玻璃里输入行之上;onDismiss 给可关闭的提示。
 */
export const RoomComposer = forwardRef<HTMLDivElement, {
  disabled: boolean; value: string; ai: boolean; banner?: ReactNode; onDismiss?(): void;
  /** 没连上:可以继续输入,不能发送 */
  offline?: boolean;
  onChange(v: string): void; onSend(): void; onOpenAssist(): void;
}>(function RoomComposer({ disabled, offline = false, value, ai, banner, onDismiss, onChange, onSend, onOpenAssist }, ref) {
  const { t } = useTranslation();
  const mention = mentionsAi(value).ai || /^@ai\s/i.test(value);
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
      <div className="flex items-center gap-1.5">
        {ai && (
          <button type="button" data-testid="room-at-ai" aria-label="@ai" aria-pressed={mention} disabled={disabled}
            onClick={() => onChange(/^@ai\b/i.test(value) ? value : `@ai ${value}`)}
            className={cn(keyClass, mention ? "bg-blue-tint text-blue" : "text-ink-2 hover:bg-surface-2")}><AtSignIcon aria-hidden /></button>
        )}
        <input data-testid="room-input" disabled={disabled} value={value} maxLength={ROOM_LIMITS.text} enterKeyHint="send"
          aria-label={t("web.rooms.room.placeholder")} placeholder={t("web.rooms.room.placeholder")} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (!offline) onSend(); } }}
          className="h-tap min-w-0 flex-1 rounded-button border-[0.5px] border-hair bg-surface px-3 text-base text-ink placeholder:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30 disabled:opacity-60" />
        {ai && (
          <button type="button" data-testid="room-assist-open" aria-label={t("web.rooms.assist.open")} disabled={disabled} onClick={onOpenAssist}
            className={cn(keyClass, "text-ink-2 hover:bg-surface-2")}><LanguagesIcon aria-hidden /></button>
        )}
        <button type="button" data-testid="room-send" aria-label={t("web.rooms.room.send")} disabled={disabled || offline || !value.trim()} onClick={onSend}
          className={cn(keyClass, "bg-blue text-on-blue")}><SendIcon aria-hidden /></button>
      </div>
    </div>
  );
});
