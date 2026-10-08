import { LoaderIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { START_LIMITS } from "./protocol";

/**
 * 通话里"转文字"的草稿:transcribing = 正在转写;ready = 可编辑;empty = 没听到话;failed = 转写失败;
 * unsent = 发送时通话未连接(草稿保留)。后三种都可以直接输入再发送。
 */
export type CallTextDraftState = { status: "transcribing" | "ready" | "empty" | "failed" | "unsent"; text: string };

const BUTTON = "inline-flex min-h-11 min-w-11 flex-1 items-center justify-center gap-1.5 rounded-button border-[0.5px] px-3 text-body font-semibold transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4";

/**
 * 控制台上方的小玻璃面板(此时屏幕上的第三层玻璃:顶栏、控制台、它):转写结果放进可编辑的文本框,
 * 「发送」作为用户这一轮发给对方(`user_text`),「丢弃」关掉。Escape 由通话对话框处理(先丢弃草稿)。
 */
export function CallTextDraft({ draft, onChange, onSend, onDiscard }: {
  draft: CallTextDraftState;
  onChange(text: string): void;
  onSend(): void;
  onDiscard(): void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = draft.status === "transcribing";
  // 转写完成后把焦点放进文本框(键盘与读屏用户可以直接编辑)
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);
  const status = busy ? t("web.realtime.textDraft.transcribing")
    : draft.status === "empty" ? t("web.realtime.textDraft.empty")
      : draft.status === "failed" ? t("web.realtime.textDraft.failed")
        : draft.status === "unsent" ? t("web.realtime.textDraft.unsent")
          : "";
  const canSend = !busy && draft.text.trim().length > 0;
  return (
    <div data-testid="call-text-draft" role="group" aria-labelledby={titleId} data-status={draft.status}
      className="glass relative z-30 mx-4 mb-2 flex flex-none flex-col gap-2 rounded-sheet border-[0.5px] border-hair p-3">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <p id={titleId} className="text-sub font-semibold text-ink">{t("web.realtime.textDraft.title")}</p>
        <p data-testid="call-text-draft-status" role="status"
          className={cn("flex items-center gap-1 text-meta", draft.status === "failed" || draft.status === "unsent" ? "text-red" : "text-ink-2")}>
          {busy && <LoaderIcon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {status}
        </p>
      </div>
      <textarea ref={inputRef} data-testid="call-text-draft-input" rows={2} value={draft.text} disabled={busy}
        maxLength={START_LIMITS.userText} aria-label={t("web.realtime.textDraft.input")} placeholder={t("web.realtime.textDraft.placeholder")}
        className="min-h-11 w-full resize-none rounded-button border-[0.5px] border-hair bg-surface px-3 py-2 text-body leading-[1.4] text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter 发送,Shift+Enter 换行(输入法组字时不算)
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }} />
      <div className="flex gap-2">
        <button type="button" data-testid="call-text-draft-discard" className={cn(BUTTON, "border-hair bg-surface text-ink")} onClick={onDiscard}>
          <Trash2Icon aria-hidden="true" />{t("web.realtime.textDraft.discard")}
        </button>
        <button type="button" data-testid="call-text-draft-send" disabled={!canSend}
          className={cn(BUTTON, "border-transparent bg-blue text-on-blue active:opacity-80")} onClick={onSend}>
          <SendIcon aria-hidden="true" />{t("web.realtime.textDraft.send")}
        </button>
      </div>
    </div>
  );
}
