import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import { ROOM_LIMITS, type AssistMeta } from "./protocol";
import type { AssistEntry } from "./room-state";
import { fieldInput, smallGhostButton, smallPrimaryButton } from "./ui";

/** 助手回复的 meta 来自服务端 JSON:只取形状对的部分。 */
function assistMeta(meta: Record<string, unknown> | null | undefined): AssistMeta | null {
  if (!meta) return null;
  const list = <T,>(v: unknown, ok: (x: Record<string, unknown>) => boolean) =>
    (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && ok(x as Record<string, unknown>)) : []) as T[];
  return {
    replyZh: typeof meta.replyZh === "string" ? meta.replyZh : "",
    suggestions: list<AssistMeta["suggestions"][number]>(meta.suggestions, (x) => typeof x.en === "string" && x.en.trim() !== ""),
    glossary: list<AssistMeta["glossary"][number]>(meta.glossary, (x) => typeof x.src === "string" && typeof x.en === "string"),
  };
}

/**
 * 助手私聊面板(spec §5.4,视觉稿 M3):只有本人可见;对话式——自己的草稿(blue-tint)→ 中文说明 + 术语片 + 2–3 条建议。
 * 建议句「发送到群聊」直接进公共通道(带「助手润色」),「编辑」填回输入框再改。
 */
export function AssistTray({ open, onOpenChange, entries, disabled = false, onAsk, onSend, onEdit }: {
  open: boolean; onOpenChange(v: boolean): void; entries: AssistEntry[]; disabled?: boolean;
  onAsk(text: string): void; onSend(text: string, assistId: string): void; onEdit(text: string): void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const ask = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onAsk(text);
    setDraft("");
  };
  const last = entries.at(-1);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, entries.length, last?.status]);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid="assist-tray" className="flex max-h-[85dvh] flex-col">
        <BottomSheetHeader title={t("web.rooms.assist.title")} description={t("web.rooms.assist.subtitle")} />
        <div ref={listRef} className="-mx-gutter min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter">
          {entries.length === 0 && <p className="py-3 text-sub leading-dialogue text-ink-2">{t("web.rooms.assist.empty")}</p>}
          {entries.map((entry, i) => {
            const meta = assistMeta(entry.reply?.meta);
            const replyId = entry.reply?.id;
            return (
              <div key={entry.requestId ?? replyId ?? `h${i}`} className="pb-3">
                {entry.request && (
                  <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-card rounded-tr-inline bg-blue-tint px-3 py-2 text-body">{entry.request}</p>
                )}
                {entry.status === "waiting" && <p role="status" className="mt-2.5 text-meta text-ink-2">{t("web.rooms.assist.waiting")}</p>}
                {entry.status === "failed" && (
                  <p role="alert" className="mt-2.5 text-meta text-ink-2">{t(`web.rooms.errors.assist_${entry.error ?? "upstream"}`)}</p>
                )}
                {meta && (
                  <div className="mt-2.5 rounded-card border-[0.5px] border-hair bg-surface p-3">
                    {meta.replyZh && <p className="text-sub leading-dialogue">{meta.replyZh}</p>}
                    {meta.glossary.length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-1.5">
                        {meta.glossary.map((g) => (
                          <span key={`${g.src}-${g.en}`} className="rounded-inline bg-surface-2 px-2 py-[3px] text-meta">{`${g.src} → ${g.en}`}</span>
                        ))}
                      </p>
                    )}
                    {meta.suggestions.map((s, j) => (
                      <div key={`${j}-${s.en}`} data-testid="assist-suggestion" className="mt-2.5 border-t-[0.5px] border-hair-2 pt-2.5">
                        <p className="text-body font-medium leading-[1.45]">{s.en}</p>
                        {s.noteZh && <p className="mt-px text-meta text-ink-2">{s.noteZh}</p>}
                        <div className="mt-2 flex gap-2">
                          <button type="button" data-testid="assist-send" disabled={disabled || !replyId} className={cn(smallPrimaryButton, "flex-1")}
                            onClick={() => replyId && onSend(s.en, replyId)}><SendIcon aria-hidden />{t("web.rooms.assist.send")}</button>
                          <button type="button" data-testid="assist-edit" disabled={disabled} className={cn(smallGhostButton, "w-[72px] flex-none")}
                            onClick={() => onEdit(s.en)}>{t("web.rooms.assist.edit")}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <form className="flex gap-2 pt-3" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <input data-testid="assist-input" value={draft} maxLength={ROOM_LIMITS.assistText} disabled={disabled} enterKeyHint="send"
            aria-label={t("web.rooms.assist.placeholder")} placeholder={t("web.rooms.assist.placeholder")}
            onChange={(e) => setDraft(e.target.value)} className={cn(fieldInput, "flex-1")} />
          <button type="submit" data-testid="assist-ask" disabled={disabled || !draft.trim()} className={cn(smallPrimaryButton, "px-4 text-body")}>
            {t("web.rooms.assist.ask")}
          </button>
        </form>
      </BottomSheetContent>
    </BottomSheet>
  );
}
