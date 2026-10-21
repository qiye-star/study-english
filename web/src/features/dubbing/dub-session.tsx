import "./locales";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ClipSeg } from "./clip";
import type { RoleKey } from "./dubbing-api";
import { estimateWordTimes, wordStates } from "./karaoke";
import { RecordingView } from "./recording-view";
import { RehearsalView, type RehearsalLine } from "./rehearsal-view";
import { DubStage } from "./stage";
import { createTakeFrames, createTakeScheduler, type TakeMedia, type TakeScheduler } from "./take-scheduler";
import type { TakeResult } from "./take-runner";
import { useDubTake } from "./use-dub-take";
import { countdownAt, lineWindows, muteAt } from "./windows";

/**
 * 彩排与录制的一次会话(计划 L5 W9):一个视频舞台、彩排与录制两个画面。
 * 录制按钮在点按的同一个事件里启动采集与视频(手势保留)。结束后把结果交给 onDone(结果页在 W10)。
 */

export interface DubSessionProps {
  itemId: string;
  segs: readonly (ClipSeg & { text: string })[];
  from: number;
  to: number;
  role: RoleKey;
  roleName: string;
  beforeMs: number;
  afterMs: number;
  onExit(): void;
  onDone(result: TakeResult): void;
}

const reducedMotion = () => {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
};

/** 媒体时间 → 句子下标(落在哪一句的时间里),没有为 -1。 */
const sentenceAt = (segs: readonly { startMs: number; endMs: number }[], ms: number) =>
  segs.findIndex((s) => ms >= s.startMs && ms < s.endMs);

export function DubSession(props: DubSessionProps) {
  const { t } = useTranslation();
  const { itemId, segs, from, to, role, roleName, beforeMs, afterMs, onExit, onDone } = props;
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<"rehearse" | "record">("rehearse");
  const [ms, setMs] = useState(0);
  const rehearsal = useRef<TakeScheduler | null>(null);

  const windows = useMemo(
    () => lineWindows(segs, from, to, role, { before: beforeMs, after: afterMs }),
    [segs, from, to, role, beforeMs, afterMs],
  );
  const clipStartMs = segs[from]?.startMs ?? 0;
  const clipEndMs = segs[to]?.endMs ?? 0;
  const expected = useMemo(() => {
    const out: number[] = [];
    for (let i = from; i <= to; i++) if (segs[i]?.speaker === role) out.push(i);
    return out;
  }, [segs, from, to, role]);

  const dub = useDubTake({
    itemId,
    segFrom: from,
    segTo: to,
    role,
    media: el as unknown as TakeMedia | null,
    windows,
    clipStartMs,
    clipEndMs,
    textOf: (idx) => segs[idx]?.text ?? "",
  });

  // 播放中的媒体时间(约 10 次/秒),用于字幕高亮与倒计时。
  useEffect(() => {
    if (!el) return;
    let id = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 100) {
        last = now;
        setMs(el.currentTime * 1000);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [el]);

  // 录制结束:把结果交给上层。
  useEffect(() => {
    if (dub.state === "done" && dub.result) onDone(dub.result);
  }, [dub.state, dub.result, onDone]);

  // 离开时停掉彩排的播放。
  useEffect(() => () => {
    rehearsal.current?.destroy();
    rehearsal.current = null;
  }, []);

  const countdown = phase === "record" ? countdownAt(windows, ms) : null;
  const yourTurn = phase === "record" && muteAt(windows, ms);
  const current = sentenceAt(segs, ms);
  const currentSeg = current >= 0 ? segs[current] : null;
  const subtitle = currentSeg ? (
    <Subtitle text={currentSeg.text} ms={ms} startMs={currentSeg.startMs} endMs={currentSeg.endMs} mine={currentSeg.speaker === role} />
  ) : (
    <span className="opacity-60">{t("web.dubbing.stage.waiting")}</span>
  );

  const rehearseLines: RehearsalLine[] = segs.slice(from, to + 1).map((s) => ({ idx: s.idx, text: s.text, mine: s.speaker === role }));

  const playRehearsal = () => {
    if (!el) return;
    rehearsal.current?.destroy();
    const sched = createTakeScheduler({
      media: el as unknown as TakeMedia,
      frames: createTakeFrames(),
      windows: [],
      clipStartMs,
      clipEndMs,
      onOpen: () => {},
      onClose: () => {},
      onEnd: () => { rehearsal.current = null; },
      onInterrupted: () => { rehearsal.current = null; },
    });
    rehearsal.current = sched;
    sched.start();
  };

  const startRecording = () => {
    // 同一个点按事件里:停掉彩排、切到录制、开麦并放视频(手势保留)。
    rehearsal.current?.destroy();
    rehearsal.current = null;
    setPhase("record");
    dub.start();
  };

  const abandon = () => {
    dub.stop();
    setPhase("rehearse");
  };

  return (
    <div className="space-y-4">
      <DubStage
        itemId={itemId}
        onElement={setEl}
        overlay={countdown !== null ? <span className="rounded-full bg-black/60 px-3 py-1 text-[20px] font-bold text-white">{countdown}</span> : null}
        subtitle={subtitle}
      />
      {phase === "rehearse" ? (
        <>
          <RehearsalView roleName={roleName} lines={rehearseLines} onRehearse={playRehearsal} onStart={startRecording} onBack={onExit} />
        </>
      ) : (
        <RecordingView
          countdown={countdown}
          yourTurn={yourTurn}
          expected={expected}
          outcomes={dub.outcomes}
          onAbandon={abandon}
        />
      )}
      {dub.state === "error" ? <p role="alert" className="text-[13px]">{t("web.dubbing.errors.unknown")}</p> : null}
      {dub.state === "interrupted" ? <p role="alert" className="text-[13px]">{t("web.dubbing.recording.interrupted")}</p> : null}
    </div>
  );
}

/** 字幕:当前句子的词按估计时间高亮(自己的句子加强显示)。 */
function Subtitle({ text, ms, startMs, endMs, mine }: { text: string; ms: number; startMs: number; endMs: number; mine: boolean }) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const spans = useMemo(() => estimateWordTimes(words, startMs, endMs), [words, startMs, endMs]);
  const states = wordStates(spans, ms, reducedMotion());
  return (
    <p>
      {words.map((w, i) => (
        <span key={i} className={states[i] === "active" && mine ? "font-semibold text-white" : states[i] === "future" ? "opacity-60" : ""}>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}
