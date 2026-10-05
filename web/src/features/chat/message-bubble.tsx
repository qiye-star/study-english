import { LoaderIcon, MicIcon, SendIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { MarkdownText } from "~/components/markdown";
import { isVoiceMessage, type UiMessage } from "./ui-message";
import { VoicePlayButton, formatDuration } from "./voice-play-button";
import { VoiceTranscript } from "./voice-transcript";

export type { UiMessage } from "./ui-message";

export function MessageBubble({ message, onRetry, actions, translation, footer, voiceDraft, playbackDisabled }: {
  message: UiMessage;
  onRetry?: () => void;
  actions?: ReactNode;
  translation?: ReactNode;
  footer?: ReactNode;
  voiceDraft?: { onRetry(): void; onDiscard(): void };
  /** 录音进行中:不允许开始播放(否则会和麦克风抢音频) */
  playbackDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const voice = isVoiceMessage(message);
  const phase = message.voice?.phase ?? (voice ? "sent" : undefined);
  const draft = phase === "transcribing" || phase === "failed" || phase === "kept";
  return (
    <div data-testid={isUser ? "message-user" : "message-assistant"} data-status={message.status} data-voice={phase}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-3 py-2 text-base",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        message.status === "error" && "border border-destructive bg-background text-destructive",
      )}>
        {voice && (
          <div className="-ml-2 flex items-center gap-1">
            {draft ? <MicIcon className="mx-3 h-5 w-5" /> : <VoicePlayButton audioUrl={message.voice?.audioUrl} assessmentId={message.assessmentId} disabled={playbackDisabled} />}
            <span className="text-xs opacity-80">{formatDuration(message.voice?.durationMs ?? 0)}</span>
          </div>
        )}
        {phase === "transcribing" && (
          <p data-testid="voice-transcribing" className="flex items-center gap-2 text-sm opacity-80">
            <LoaderIcon className="h-4 w-4 animate-spin" />{t("web.chat.transcribing")}
          </p>
        )}
        {(phase === "failed" || phase === "kept") && (
          <div className="space-y-1">
            <p role={phase === "failed" ? "alert" : undefined} data-testid="voice-error" className="text-sm">{message.voice?.note}</p>
            {voiceDraft && (
              <div className="flex flex-wrap gap-2">
                {phase === "failed" ? (
                  <Button size="sm" variant="outline" data-testid="voice-retry-transcribe" className="h-11" onClick={voiceDraft.onRetry}>
                    {t("web.chat.voice.retryTranscribe")}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" data-testid="voice-send-kept" className="h-11" onClick={voiceDraft.onRetry}>
                    <SendIcon className="mr-1 h-4 w-4" />{t("web.chat.voice.sendKept")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" data-testid="voice-discard" className="h-11" onClick={voiceDraft.onDiscard}>
                  <Trash2Icon className="mr-1 h-4 w-4" />{t("web.chat.voice.discard")}
                </Button>
              </div>
            )}
          </div>
        )}
        {!draft && (
          <div data-lookup-context className="select-text">
            {voice ? (
              <VoiceTranscript text={message.content} words={message.assessment?.words} />
            ) : isUser || message.status === "error" ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <MarkdownText content={message.content || "…"} />
            )}
          </div>
        )}
        {isUser && message.status === "done" && footer}
        {!isUser && message.status === "done" && translation}
        {!isUser && message.status === "done" && actions}
        {message.status === "error" && onRetry && (
          <Button variant="link" data-testid="message-retry" className="h-11 px-0" onClick={onRetry}>{t("web.common.retry")}</Button>
        )}
      </div>
    </div>
  );
}
