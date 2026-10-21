import "./locales";
import { useEffect, useMemo, useRef } from "react";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import type { ClipSeg } from "./clip";
import { createComparePlayer } from "./compare-player";
import { ResultsView } from "./results-view";
import { DubStage } from "./stage";
import { createTakeFrames, createTakeScheduler, type TakeMedia, type TakeScheduler } from "./take-scheduler";
import type { TakeResult } from "./take-runner";

/**
 * 结果页的装配(计划 L5 W10):原声用视频舞台按句播放(createTakeScheduler,无窗口、不静音);
 * 我的用本次录音的 object URL;两者经 compare-player 互斥。卸载时停止一切。
 */
export function DubResults({
  itemId, segs, result, onRetry, onExit,
}: {
  itemId: string;
  segs: readonly (ClipSeg & { text: string })[];
  result: TakeResult;
  onRetry(): void;
  onExit(): void;
}) {
  // 播放器只创建一次:元素与句子经 ref 读取(segs 每次渲染都是新数组,不能作为依赖)。
  const elRef = useRef<HTMLVideoElement | null>(null);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const audio = useRef<HTMLAudioElement | null>(null);
  const sched = useRef<TakeScheduler | null>(null);

  const player = useMemo(() => createComparePlayer({
    claim: (stop) => claimAudio(stop),
    release: (stop) => releaseAudio(stop),
    playOriginal: (idx, onEnded) => {
      const s = segsRef.current[idx];
      const media = elRef.current;
      if (!media || !s) {
        onEnded();
        return;
      }
      sched.current?.destroy();
      const run = createTakeScheduler({
        media: media as unknown as TakeMedia,
        frames: createTakeFrames(),
        windows: [],
        clipStartMs: s.startMs,
        clipEndMs: s.endMs,
        leadMs: 0,
        tailMs: 0,
        onOpen: () => {},
        onClose: () => {},
        onEnd: () => { sched.current = null; onEnded(); },
        onInterrupted: () => { sched.current = null; onEnded(); },
      });
      sched.current = run;
      run.start();
    },
    stopOriginal: () => {
      sched.current?.destroy();
      sched.current = null;
      elRef.current?.pause();
    },
    playMine: (url, onEnded) => {
      const a = new Audio(url);
      audio.current = a;
      a.onended = onEnded;
      a.play().catch(onEnded);
    },
    stopMine: () => {
      audio.current?.pause();
      audio.current = null;
    },
  }), []);

  // 卸载时停止一切(只在卸载时执行)。
  useEffect(() => () => {
    player.stop();
    sched.current?.destroy();
    sched.current = null;
  }, [player]);

  const setElement = (el: HTMLVideoElement | null) => {
    elRef.current = el;
  };

  return (
    <ResultsView
      take={result.take}
      segs={segs}
      outcomes={result.outcomes}
      mineUrls={result.urls}
      player={player}
      stage={<DubStage itemId={itemId} onElement={setElement} subtitle={null} />}
      onRetry={onRetry}
      onExit={onExit}
    />
  );
}
