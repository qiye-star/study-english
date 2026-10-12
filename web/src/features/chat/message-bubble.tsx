import { LoaderIcon, MicIcon, SendIcon, Trash2Icon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { Avatar } from "~/components/avatar";
import { MarkdownText } from "~/components/markdown";
import { isVoiceMessage, type UiMessage } from "./ui-message";
import { VoicePlayButton, formatDuration } from "./voice-play-button";
import { VoiceTranscript } from "./voice-transcript";

export type { UiMessage } from "./ui-message";

/** 语音气泡里的静态波形(装饰;12 根,高度取自设计稿) */
const WAVE = [6, 12, 16, 9, 14, 7, 11, 15, 8, 5, 10, 13];

/**
 * 气泡下方的动作(朗读 / 翻译 / 跟读):44px 命中,12px 文字 + 17px 图标;on = 进行中/已打开(蓝)。
 * 有可见文字时它就是无障碍名称;只有图标时请传 aria-label。
 */
export const BubbleAction = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }>(
  function BubbleAction({ on = false, className, type = "button", ...rest }, ref) {
    return (
      <button ref={ref} type={type}
        className={cn(
          "inline-flex h-tap min-w-tap items-center justify-center gap-1 rounded-[9px] px-2 text-meta font-medium transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-[17px] [&_svg]:w-[17px]",
          on ? "bg-blue-tint text-blue" : "text-ink-2 hover:bg-surface-2",
          className,
        )}
        {...rest} />
    );
  },
);

/** 气泡动作行:贴着气泡内边距向外扩(设计稿 margin 4px -8px -6px)。 */
export function BubbleActions({ children }: { children: ReactNode }) {
  return <div className="-mx-2 -mb-1.5 mt-1 flex flex-wrap gap-1">{children}</div>;
}

export function MessageBubble({ message, onRetry, actions, translation, footer, voiceDraft, playbackDisabled, partnerName, before, after, note }: {
  message: UiMessage;
  onRetry?: () => void;
  actions?: ReactNode;
  translation?: ReactNode;
  footer?: ReactNode;
  voiceDraft?: { onRetry(): void; onDiscard(): void };
  /** 录音进行中:不允许开始播放(否则会和麦克风抢音频) */
  playbackDisabled?: boolean;
  /** 对话伙伴的名字:助手气泡左侧的中性头像取它的首字母 */
  partnerName?: string;
  /** 助手气泡上方(过程胶囊)与下方(来源标签)的插槽;不传时 DOM 与原来相同 */
  before?: ReactNode;
  after?: ReactNode;
  /** 助手气泡正文下方的「中文」折叠(智能体回复的 note_zh;只在完成后显示,不朗读) */
  note?: ReactNode;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const voice = isVoiceMessage(message);
  const phase = message.voice?.phase ?? (voice ? "sent" : undefined);
  const draft = phase === "transcribing" || phase === "failed" || phase === "kept";
  const error = message.status === "error";
  const bubble = (
    <div className={cn(
      "min-w-0 rounded-card px-3 pb-2 pt-2.5 text-body leading-dialogue tracking-[-0.005em] text-ink",
      isUser ? "rounded-tr-[6px] bg-blue-tint" : "rounded-tl-[6px] border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none",
      error && "border-[0.5px] border-red/40 bg-surface text-red",
    )}>
      {voice && (
        <div className="flex min-h-7 items-center gap-2.5 text-blue">
          {draft ? <MicIcon aria-hidden className="h-[18px] w-[18px]" /> : (
            <span className="-my-2 -ml-3 -mr-1.5"><VoicePlayButton audioUrl={message.voice?.audioUrl} assessmentId={message.assessmentId} disabled={playbackDisabled} /></span>
          )}
          <span aria-hidden className="flex h-4 items-center gap-0.5">
            {WAVE.map((h, i) => <i key={i} className="block w-[3px] rounded-sm bg-current opacity-90" style={{ height: h }} />)}
          </span>
          <span className="num text-sub font-semibold">{formatDuration(message.voice?.durationMs ?? 0)}</span>
        </div>
      )}
      {phase === "transcribing" && (
        <p data-testid="voice-transcribing" className="mt-1.5 flex items-center gap-2 text-sub text-ink-2">
          <LoaderIcon aria-hidden className="h-4 w-4 animate-spin" />{t("web.chat.transcribing")}
        </p>
      )}
      {(phase === "failed" || phase === "kept") && (
        <div className="mt-1.5 space-y-1">
          <p role={phase === "failed" ? "alert" : undefined} data-testid="voice-error" className="text-sub">{message.voice?.note}</p>
          {voiceDraft && (
            <BubbleActions>
              {phase === "failed" ? (
                <BubbleAction data-testid="voice-retry-transcribe" className="text-blue" onClick={voiceDraft.onRetry}>
                  {t("web.chat.voice.retryTranscribe")}
                </BubbleAction>
              ) : (
                <BubbleAction data-testid="voice-send-kept" className="text-blue" onClick={voiceDraft.onRetry}>
                  <SendIcon aria-hidden />{t("web.chat.voice.sendKept")}
                </BubbleAction>
              )}
              <BubbleAction data-testid="voice-discard" onClick={voiceDraft.onDiscard}>
                <Trash2Icon aria-hidden />{t("web.chat.voice.discard")}
              </BubbleAction>
            </BubbleActions>
          )}
        </div>
      )}
      {!draft && (
        <div data-lookup-context className={cn("select-text", voice && "mt-1.5")}>
          {voice ? (
            <VoiceTranscript text={message.content} words={message.assessment?.words} />
          ) : isUser || error ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <MarkdownText content={message.content || "…"} />
          )}
        </div>
      )}
      {isUser && message.status === "done" && footer}
      {!isUser && message.status === "done" && note}
      {!isUser && message.status === "done" && translation}
      {!isUser && message.status === "done" && actions}
      {error && onRetry && (
        <button type="button" data-testid="message-retry"
          className="-mb-1.5 -ml-2 mt-0.5 inline-flex min-h-tap items-center rounded-button px-2 text-sub font-medium text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRetry}>
          {t("web.common.retry")}
        </button>
      )}
    </div>
  );
  return (
    <div data-testid={isUser ? "message-user" : "message-assistant"} data-status={message.status} data-voice={phase}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex min-w-0 max-w-[88%] gap-2", isUser && "flex-row-reverse")}>
        {!isUser && (
          <span aria-hidden className="mt-0.5 flex-none">
            <Avatar name={partnerName || "AI"} size="sm" />
          </span>
        )}
        {!isUser && (before || after) ? (
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            {before}
            {bubble}
            {after}
          </div>
        ) : bubble}
      </div>
    </div>
  );
}
