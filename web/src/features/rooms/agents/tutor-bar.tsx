import "./locales";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { ZhNoteFold } from "~/components/zh-note-fold";
import { cn } from "~/lib/cn";
import { ROOM_AGENTS, type RoomMessage, type RoomTutorInfo } from "../protocol";
import { smallGhostButton } from "../ui";
import { secondsLeft } from "./countdown";
import { resumeRoomTutor, ROOM_AGENTS_ALL_ERRORS, skipRoomTutor, stopRoomTutor } from "./room-agents-api";
import { maxSeq, turnVoice } from "./tutor-voice";

const NO_MESSAGES: readonly RoomMessage[] = [];

/** 等待作答时每秒刷新一次「现在」;不等待时不起计时器。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * 倒计时圆环:数字每秒更新;圆环的过渡只在 motion-safe 下(系统「减少动态效果」时不动画)。读屏只读 sr-only 的文字,不在 live 区里逐秒播报。
 * 最后 10 秒且轮到自己时圆环变红(红 = 即将被跳过;蓝 = 进行中)。
 */
function Countdown({ seconds, urgent }: { seconds: number; urgent: boolean }) {
  const { t } = useTranslation();
  const r = 9;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, seconds / ROOM_AGENTS.tutorTurnSeconds)));
  return (
    <span data-testid="room-tutor-countdown" className="relative flex size-7 flex-none items-center justify-center">
      <svg aria-hidden viewBox="0 0 22 22" className="absolute inset-0 -rotate-90">
        <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2" className="stroke-hair" />
        <circle data-testid="room-tutor-ring" cx="11" cy="11" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          className={cn(urgent && seconds <= 10 ? "stroke-red" : "stroke-blue liquid:stroke-ink",
            "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear")} />
      </svg>
      <span aria-hidden className="text-label tabular-nums text-ink">{seconds}</span>
      <span className="sr-only">{t("web.rooms.agents.tutor.secondsLeft", { count: seconds })}</span>
    </span>
  );
}

/**
 * 带练条(输入条上方):第几题、轮到谁(轮到自己时蓝色「轮到你了」)、倒计时;被点名的人和房主可「跳过」,房主可「结束」,
 * 暂停时房主可「继续」。只有「轮到谁 / 暂停原因」在 live 区里(轮次变化时播报一次)。窄屏(360 px)时按钮换到第二行。
 */
export function TutorBar({ tutor, receivedAt, meId, isOwner, roomId, disabled, messages = NO_MESSAGES, notice = null, voice = false }: {
  tutor: RoomTutorInfo | null; receivedAt: number; meId: number | null; isOwner: boolean; roomId: string; disabled: boolean;
  /** 房间消息(推出「识别中 / 没听清」);房间页传 state.messages */
  messages?: readonly RoomMessage[];
  /** 当前的 notice(voice_unclear 也算没听清) */
  notice?: string | null;
  /** 本房可发语音:轮到我时提示「直接说或打字回答」 */
  voice?: boolean;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const waiting = tutor?.phase === "await_answer";
  const now = useNow(waiting);
  const [busy, setBusy] = useState(false);
  const mine = waiting && tutor?.currentUserId === meId;
  // 轮到我的那一刻记下列表里最大的 seq:之后我发的语音才算这一题的回答(轮次键变化才重算)
  const turnKey = mine && tutor ? `${tutor.stepIndex}:${tutor.currentUserId}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sinceSeq = useMemo(() => maxSeq(messages), [turnKey]);
  if (!tutor) return null;
  const left = secondsLeft(tutor, receivedAt, now);
  const heard = mine ? turnVoice(messages, meId, sinceSeq, notice) : "none";
  const label = tutor.phase === "paused" ? t(`web.rooms.agents.tutor.paused.${tutor.pausedReason ?? "upstream"}`, { defaultValue: t("web.rooms.agents.tutor.paused.upstream") })
    : tutor.phase === "generating" ? t("web.rooms.agents.tutor.generating", { name: tutor.personaName })
    : mine ? (heard === "recognizing" ? t("web.rooms.agents.tutor.recognizing") : heard === "unclear" ? t("web.rooms.agents.tutor.unclear")
      : voice ? t("web.rooms.agents.tutor.yourTurnSpeak") : t("web.rooms.agents.tutor.yourTurnType")) : t("web.rooms.agents.tutor.theirTurn", { name: tutor.currentName ?? "?" });
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="room-tutor-bar" className={cn("mb-1.5 flex min-h-row flex-wrap items-center gap-x-2 gap-y-1 rounded-card border-[0.5px] px-3 py-1.5 text-sub plate liquid:rounded-tile",
      mine ? "border-blue bg-blue-tint liquid:border-[1.5px] liquid:border-ink" : "border-hair bg-surface")}>
      <span className="flex-none font-semibold text-ink">{t("web.rooms.agents.tutor.title")}</span>
      <span className="flex-none tabular-nums text-ink-2">{t("web.rooms.agents.tutor.progress", { step: tutor.stepIndex, total: tutor.stepsTotal })}</span>
      <span role="status" aria-live="polite" className={cn("min-w-0 flex-1 basis-28 break-words", mine ? "font-semibold text-blue liquid:text-ink" : "text-ink")}>
        {mine && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-blue align-middle motion-safe:animate-pulse" />}{label}
      </span>
      {left !== null && <Countdown seconds={left} urgent={mine} />}
      {waiting && (mine || isOwner) && (
        <button type="button" className={cn(smallGhostButton, "flex-none")} disabled={busy || disabled} onClick={() => void act(() => skipRoomTutor(api, roomId))}>
          {t("web.rooms.agents.tutor.skip")}
        </button>
      )}
      {isOwner && tutor.phase === "paused" && (
        <button type="button" className={cn(smallGhostButton, "flex-none")} disabled={busy || disabled} onClick={() => void act(() => resumeRoomTutor(api, roomId))}>
          {t("web.rooms.agents.tutor.resume")}
        </button>
      )}
      {isOwner && (
        <button type="button" className={cn(smallGhostButton, "flex-none text-red")} disabled={busy || disabled} onClick={() => void act(() => stopRoomTutor(api, roomId))}>
          {t("web.rooms.agents.tutor.stop")}
        </button>
      )}
      {tutor.hintZh ? (
        <ZhNoteFold text={tutor.hintZh} showLabel={t("web.rooms.agents.note.show")} hideLabel={t("web.rooms.agents.note.hide")}
          testId="room-tutor-hint-zh" className="basis-full" />
      ) : null}
    </div>
  );
}
