import { FileTextIcon, LanguagesIcon, LoaderIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import type { RoomMessage } from "../protocol";
import { useVoicePlayer } from "./use-voice-player";

/** 0:06 —— 语音时长(四舍五入到秒) */
export function formatVoiceDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 装饰性的声波条(不是真实电平):固定高度表,条数随时长变化 */
const WAVE = [8, 14, 10, 16, 6, 12, 9, 15, 7, 11, 5, 13, 8, 10];
const waveFor = (ms: number) => WAVE.slice(0, Math.min(WAVE.length, 5 + Math.floor(ms / 6000)));

const actionClass = "inline-flex min-h-tap items-center gap-1 rounded-inline px-1.5 text-meta font-semibold transition-colors duration-fast "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[15px]";

/**
 * 语音消息气泡的内容(视觉稿 rooms-v2 V8;spec 2026-10-10 §4.3–4.6;车道 WV,任务 WV3)。外层气泡、名字、引用块、回应由 room-message-list 渲染。
 * 播放键 + 装饰声波条 + 时长;下方「转文字」「翻译」两个 44px 文字键;展开区:转写(15px)与译文(13px 次要色,前缀「译」小标)。
 * 规则:自己发的默认展开转写;autoText(「我的 → 联机语音自动转文字」)时转写与译文默认展开,且转写完成而还没有译文时自动请求一次
 * (全房共享的那一份)。转写与译文都在消息里随 voice_update 下发,不按收听者重复调用。永不自动播放。
 */
export function VoiceBubble({ message, mine, roomId, autoText, onTranslate, onRetry }: {
  message: RoomMessage; mine: boolean; roomId: string; autoText: boolean;
  onTranslate(seq: number): void; onRetry(seq: number): void;
}): JSX.Element {
  const { t } = useTranslation();
  const voice = message.voice;
  const player = useVoicePlayer(roomId, message.id);
  const [textOpen, setTextOpen] = useState<boolean | null>(null); // null = 按默认规则
  const [trOpen, setTrOpen] = useState<boolean | null>(null);
  const showText = textOpen ?? (mine || autoText);
  const showTr = trOpen ?? autoText;
  const done = voice?.status === "done";
  const needTranslation = !!voice && done && voice.translation === null && voice.translationStatus === null;

  // 自动转文字:转写完成而没有译文时,自动请求一次(之后 translation_status 变为 pending/done/failed,不再重复)
  const asked = useRef(false);
  const ask = useRef(onTranslate);
  ask.current = onTranslate;
  useEffect(() => {
    if (!autoText || !needTranslation || asked.current || trOpen === false) return;
    asked.current = true;
    ask.current(message.seq);
  }, [autoText, needTranslation, trOpen, message.seq]);

  if (!voice) return <span className="whitespace-pre-wrap break-words">{message.text}</span>;

  const toggleTranslation = () => {
    if (showTr) return setTrOpen(false);
    setTrOpen(true);
    if (needTranslation && !asked.current) {
      asked.current = true;
      onTranslate(message.seq);
    } else if (voice.translationStatus === "failed") {
      onTranslate(message.seq);
    }
  };

  const status = voice.status === "pending" ? (
    <p className="mt-1.5 flex items-center gap-1.5 text-meta text-ink-2"><LoaderIcon aria-hidden className="size-3.5 animate-spin" />{t("web.rooms.voice.pending")}</p>
  ) : voice.status === "empty" ? (
    <p className="mt-1.5 text-meta text-ink-2">{t("web.rooms.voice.empty")}</p>
  ) : voice.status === "failed" ? (
    <p className="mt-1.5 flex items-center gap-1.5 text-meta text-ink-2">
      <span>{t("web.rooms.voice.failed")}</span>
      {mine && (
        <>
          <span aria-hidden>·</span>
          <button type="button" data-testid="room-voice-retry" onClick={() => onRetry(message.seq)}
            className="tap-link font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("web.rooms.voice.retry")}</button>
        </>
      )}
    </p>
  ) : null;

  const translation = voice.translation ? (
    <p className="mt-1 flex gap-1.5 text-sub text-ink-2">
      <span aria-hidden className={cn("mt-px inline-flex h-[18px] flex-none items-center rounded-[5px] px-[5px] text-label font-semibold text-ink-2", mine ? "bg-surface" : "bg-surface-2")}>
        {t("web.rooms.voice.trTag")}
      </span>
      <span className="sr-only">{t("web.rooms.voice.trTagLong")}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{voice.translation}</span>
    </p>
  ) : voice.translationStatus === "pending" || (needTranslation && asked.current) ? (
    <p className="mt-1 flex items-center gap-1.5 text-meta text-ink-2"><LoaderIcon aria-hidden className="size-3.5 animate-spin" />{t("web.rooms.voice.translating")}</p>
  ) : voice.translationStatus === "failed" ? (
    <p className="mt-1 text-meta text-ink-2">{t("web.rooms.voice.translateFailed")}</p>
  ) : null;

  const playing = player.state === "playing";
  const duration = formatVoiceDuration(voice.durationMs);
  return (
    <div data-testid="room-voice" data-status={voice.status} className="min-w-[176px]">
      <div className="flex items-center gap-1.5">
        <button type="button" data-testid="room-voice-play" data-state={player.state} disabled={!voice.audio || player.state === "loading"}
          aria-label={playing ? t("web.rooms.voice.pause") : t("web.rooms.voice.play")} onClick={player.toggle}
          className="-ml-[5px] flex size-tap flex-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <span className={cn("flex size-[34px] items-center justify-center rounded-full [&_svg]:size-[17px]", mine ? "bg-blue text-on-blue" : "bg-surface-2 text-ink")}>
            {player.state === "loading" ? <LoaderIcon aria-hidden className="animate-spin" />
              : playing ? <PauseIcon aria-hidden className="fill-current" /> : <PlayIcon aria-hidden className="fill-current" />}
          </span>
        </button>
        <span aria-hidden className={cn("flex h-5 flex-1 items-center gap-0.5", mine ? "text-blue" : "text-ink")}>
          {waveFor(voice.durationMs).map((h, i) => (
            <i key={i} className="block w-[3px] rounded-[2px] bg-current opacity-[.55]" style={{ height: h }} />
          ))}
        </span>
        <span className="num flex-none text-sub text-ink-2">
          {playing && player.positionMs > 0 ? `${formatVoiceDuration(player.positionMs)} / ${duration}` : duration}
        </span>
      </div>
      {!voice.audio && <p className="mt-0.5 text-meta text-ink-2">{t("web.rooms.voice.audioRemoved")}</p>}
      {player.state === "error" && player.error && <p role="alert" className="mt-0.5 text-meta text-red">{player.error}</p>}
      {showText && (done ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words border-t-[0.5px] border-hair-2 pt-[7px] text-body leading-dialogue">{voice.transcript}</p>
      ) : status)}
      {showTr && done && translation}
      <div className="-mx-1.5 -mb-1.5 mt-0.5 flex gap-0.5">
        <button type="button" data-testid="room-voice-text" aria-expanded={showText} onClick={() => setTextOpen(!showText)}
          className={cn(actionClass, showText ? "text-blue" : "text-ink-2")}>
          <FileTextIcon aria-hidden />{showText ? t("web.rooms.voice.hideText") : t("web.rooms.voice.toText")}
        </button>
        {done && (
          <button type="button" data-testid="room-voice-translate" aria-expanded={showTr} onClick={toggleTranslation}
            className={cn(actionClass, showTr ? "text-blue" : "text-ink-2")}>
            <LanguagesIcon aria-hidden />{showTr ? t("web.rooms.voice.hideTranslation") : t("web.rooms.voice.translate")}
          </button>
        )}
      </div>
    </div>
  );
}
