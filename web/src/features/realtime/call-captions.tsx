import { MicIcon, Volume2Icon } from "lucide-react";
import { LQ_TILE } from "~/components/liquid";
import { forwardRef, type ReactNode, type UIEvent } from "react";
import { useTranslation } from "react-i18next";
import { TONE_CLASS } from "~/components/tone";
import { scoreBadgeTone } from "~/components/score-tone";
import { ScoreDot } from "~/components/score-dot";
import type { ApiClient } from "~/api/client";
import type { Caption } from "./call-machine";
import { CallCaptionTranslation } from "./call-caption-translation";
import { cn } from "~/lib/cn";

/** 实时字幕末尾的闪烁光标(仅允许动效时闪) */
const CARET = "after:ml-0.5 after:inline-block after:h-[1em] after:w-0.5 after:bg-blue after:align-[-2px] after:content-[''] motion-safe:after:animate-caret";

function CaptionCard({ you, who, live, children, header }: {
  you: boolean;
  who: string;
  live?: boolean;
  /** 标题行右侧(分数徽标 / "译"按钮) */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-caption-role={you ? "user" : "assistant"} data-live={live ? "true" : undefined}
      className={`flex-none rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5 ${LQ_TILE}`}>
      <div className={cn("mb-1 flex min-h-[13px] items-center gap-1.5 text-label font-semibold uppercase tracking-[.06em]", you ? "text-blue liquid:text-ink" : "text-ink-2")}>
        {you ? <MicIcon className="h-[13px] w-[13px] flex-none" aria-hidden="true" /> : <Volume2Icon className="h-[13px] w-[13px] flex-none" aria-hidden="true" />}
        <span className="min-w-0 truncate">{who}</span>
        {header && <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">{header}</span>}
      </div>
      {children}
    </div>
  );
}

const EN = "break-words text-body leading-dialogue tracking-[-.005em] text-ink";

export interface CallCaptionsProps {
  captions: Caption[];
  partial: string;
  partnerName: string;
  translation?: { api: ApiClient; nativeLanguage: string };
  autoTranslate: boolean;
  /** 通话进行中:正在说的那句末尾显示光标(结束后不再显示) */
  live: boolean;
  onScroll(e: UIEvent<HTMLDivElement>): void;
}

/**
 * 字幕区:flex:1 + min-height:0 的滚动容器,内容底部锚定(最新一句贴着控制台上方),顶部 40px 渐隐。
 * 字幕卡为实底 surface + 发丝线(其后没有内容,不做模糊);"你"用蓝色,伙伴中性;英文 --ink,译文 --ink-2。
 */
export const CallCaptions = forwardRef<HTMLDivElement, CallCaptionsProps>(function CallCaptions(
  { captions, partial, partnerName, translation, autoTranslate, live, onScroll }, ref,
) {
  const { t } = useTranslation();
  const you = t("web.realtime.you");
  const last = captions[captions.length - 1];
  return (
    <div ref={ref} data-testid="call-captions" data-lookup-context="" aria-label={t("web.realtime.captions")} onScroll={onScroll}
      className="relative z-[1] mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-2.5 pt-4 [-webkit-mask-image:linear-gradient(to_bottom,transparent_0,#000_40px)] [mask-image:linear-gradient(to_bottom,transparent_0,#000_40px)]">
      <div className="mt-auto flex flex-col gap-2.5">
        {captions.map((c) => {
          const user = c.role === "user";
          const streaming = live && !user && c === last && c.messageId === undefined && !c.interrupted && !partial;
          const body = (
            <p className={cn(EN, streaming && CARET)}>
              {c.text}
              {c.interrupted && <span className="ml-1 text-meta text-ink-2">{t("web.realtime.interrupted")}</span>}
            </p>
          );
          if (user) {
            const score = typeof c.score === "number" ? (
              <span data-testid="call-score" data-score={c.score}
                className={cn("num inline-flex h-[22px] items-center whitespace-nowrap rounded-badge px-2 text-label font-semibold", TONE_CLASS[scoreBadgeTone(c.score)], "liquid:gap-1 liquid:rounded-full liquid:bg-wash liquid:text-ink-2")}>
                <ScoreDot score={c.score} />{t("web.chat.voice.score", { score: c.score })}
              </span>
            ) : undefined;
            return <CaptionCard key={c.key} you who={you} header={score}>{body}</CaptionCard>;
          }
          if (!translation) {
            return <CaptionCard key={c.key} you={false} who={partnerName} live={streaming}>{body}</CaptionCard>;
          }
          return (
            <CallCaptionTranslation key={c.key} api={translation.api} nativeLanguage={translation.nativeLanguage} captionKey={c.key} text={c.text}
              finished={c.messageId !== undefined && !c.interrupted} auto={autoTranslate}
              layout={(button, line) => (
                <CaptionCard you={false} who={partnerName} live={streaming} header={button}>
                  {body}
                  {line}
                </CaptionCard>
              )} />
          );
        })}
        {partial && (
          <CaptionCard you who={you} live>
            <p data-testid="call-partial" className={cn(EN, CARET)}>{partial}</p>
          </CaptionCard>
        )}
      </div>
    </div>
  );
});
