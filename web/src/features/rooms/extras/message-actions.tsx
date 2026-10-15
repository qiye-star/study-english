import { FlagIcon, LanguagesIcon, LoaderIcon, ReplyIcon, Volume2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { REACTION_GLYPHS, REACTION_KEYS, type ReactionKey, type RoomMessage } from "../protocol";

const tool = "inline-flex min-h-tap flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-2 text-meta font-semibold text-ink "
  + "transition-colors duration-fast hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring "
  + "aria-pressed:bg-blue-tint aria-pressed:text-blue [&_svg]:size-4 [&_svg]:text-ink-2 aria-pressed:[&_svg]:text-blue liquid:aria-pressed:bg-wash";

function Tool({ testId, label, pressed, onClick, children }: { testId: string; label: string; pressed?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={pressed} className={tool} onClick={onClick}>
      {children}{label}
    </button>
  );
}

/**
 * 点(或长按)一条公共消息后气泡下方的操作行(spec §6.4,视觉稿 V12 .actpop):6 个表情(唯一用 emoji 的地方)+「引用」「译」「朗读」「举报」;
 * 各 44px 命中区。房间页只在消息被选中时渲染它;canReport=false 表示不显示举报(自己的消息)。
 *
 * 「译」「朗读」由列表决定是否提供(只有文本消息与 @ai 回答、且不是母语时才有「译」):onTranslate / onSpeak 缺省时不渲染。
 * (Ruling WE1-1:F5 的签名没有这两个回调;只追加可选 props,已有调用方不受影响。)
 */
export function MessageActions({
  message, meId, canReport, reported, onReact, onQuote, onReport, onTranslate, translateOpen = false, onSpeak, speakState = "idle",
}: {
  message: RoomMessage; mine: boolean; meId: number | null; canReport: boolean; reported: boolean;
  onReact(key: ReactionKey, on: boolean): void; onQuote(): void; onReport(): void;
  onTranslate?(): void; translateOpen?: boolean;
  onSpeak?(): void; speakState?: "idle" | "loading" | "playing" | "error";
}): JSX.Element {
  const { t } = useTranslation();
  const mineOn = (key: ReactionKey) => meId !== null && !!message.reactions?.find((r) => r.key === key)?.userIds.includes(meId);
  return (
    <div role="group" aria-label={t("web.rooms.extras.actions")} data-testid="msg-actions"
      className="flex max-w-full flex-col gap-0.5 rounded-card bg-surface p-1 shadow-[inset_0_0_0_0.5px_var(--hair),0_10px_24px_-14px_rgba(17,19,24,0.35)] dark:shadow-[inset_0_0_0_0.5px_var(--hair),0_10px_24px_-12px_rgba(0,0,0,0.7)]">
      <div className="flex gap-0.5">
        {REACTION_KEYS.map((key) => {
          const on = mineOn(key);
          return (
            <button key={key} type="button" data-testid={`react-${key}`} aria-pressed={on} aria-label={t(`web.rooms.extras.reactionNames.${key}`)}
              onClick={() => onReact(key, !on)}
              className={cn("flex h-tap w-tap flex-none items-center justify-center rounded-[10px] text-[21px] leading-none transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-blue-tint liquid:bg-wash" : "hover:bg-surface-2 active:bg-surface-2")}>
              <span aria-hidden>{REACTION_GLYPHS[key]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-0.5 border-t-[0.5px] border-hair-2 pt-0.5">
        <Tool testId="msg-quote" label={t("web.rooms.extras.quote")} onClick={onQuote}><ReplyIcon aria-hidden /></Tool>
        {onTranslate && (
          <Tool testId="msg-translate" label={t("web.rooms.extras.translate")} pressed={translateOpen} onClick={onTranslate}><LanguagesIcon aria-hidden /></Tool>
        )}
        {onSpeak && (
          <Tool testId="msg-speak" label={t("web.rooms.extras.speak")} pressed={speakState === "playing" || speakState === "loading"} onClick={onSpeak}>
            {speakState === "loading" ? <LoaderIcon aria-hidden className="animate-spin" /> : <Volume2Icon aria-hidden />}
          </Tool>
        )}
        {canReport && (reported ? (
          <span className="inline-flex min-h-tap flex-1 items-center justify-center whitespace-nowrap px-2 text-meta font-medium text-ink-2">{t("web.rooms.room.reported")}</span>
        ) : (
          <Tool testId="room-report" label={t("web.rooms.room.report")} onClick={onReport}><FlagIcon aria-hidden /></Tool>
        ))}
      </div>
    </div>
  );
}
