import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import { assessPronunciation } from "~/features/practice";
import { createTakeFrames, createTakeScheduler, type TakeMedia } from "./take-scheduler";
import { browserCaptureDeps, startTakeCapture } from "./take-capture";
import { createTakeRunner, type TakeRunner, type TakeResult, type TakeState, type TakeRunnerDeps } from "./take-runner";
import { createTake, finishTake, postLine, type RoleKey } from "./dubbing-api";
import type { LineOutcome, QueueItem } from "./line-queue";
import type { LineWindow } from "./windows";

/**
 * 录制的 React 入口(计划 L5 W6):把真实依赖注入 take-runner。手势里调用 start();卸载时 dispose。
 * 票据与录音 URL 不打印;句子文字只作为评测的 reference 发给服务端。
 */

export interface UseDubTakeInput {
  itemId: string;
  segFrom: number;
  segTo: number;
  role: RoleKey;
  /** 视频元素(由页面提供;为 null 时 start() 什么也不做) */
  media: TakeMedia | null;
  windows: readonly LineWindow[];
  clipStartMs: number;
  clipEndMs: number;
  /** 句子的原文,只用于 reference 字段(不进 URL 或日志) */
  textOf(idx: number): string;
}

export interface UseDubTake {
  state: TakeState;
  result: TakeResult | null;
  /** 录制中已经给出结果的句子(每 500 ms 刷新一次) */
  outcomes: LineOutcome[];
  start(): void;
  stop(): void;
}

export function useDubTake(input: UseDubTakeInput): UseDubTake {
  const { api } = useAuth();
  const [state, setState] = useState<TakeState>("idle");
  const [result, setResult] = useState<TakeResult | null>(null);
  const [outcomes, setOutcomes] = useState<LineOutcome[]>([]);
  const runnerRef = useRef<TakeRunner | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => () => {
    runnerRef.current?.dispose();
    runnerRef.current = null;
  }, []);

  useEffect(() => {
    if (state !== "recording" && state !== "finishing") return;
    const id = setInterval(() => {
      const r = runnerRef.current;
      if (r) setOutcomes(r.outcomes());
    }, 500);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(() => {
    const cur = inputRef.current;
    if (!cur.media) return;
    runnerRef.current?.dispose();
    const runner = createTakeRunner({
      windows: cur.windows, clipStartMs: cur.clipStartMs, clipEndMs: cur.clipEndMs,
      deps: makeDeps(api, cur, cur.media),
    });
    runnerRef.current = runner;
    runner.subscribe((s) => {
      setState(s);
      if (s === "done") setResult(runner.result());
    });
    setResult(null);
    setOutcomes([]);
    runner.start();
  }, [api]);

  const stop = useCallback(() => {
    runnerRef.current?.stop();
  }, []);

  return { state, result, outcomes, start, stop };
}

/** 真实依赖:只在这里接触 API、音频与媒体元素。 */
export function makeDeps(api: ApiClient, input: UseDubTakeInput, media: TakeMedia): TakeRunnerDeps {
  return {
    startCapture: (startMediaMs, onInterrupted) => startTakeCapture(browserCaptureDeps(), startMediaMs, onInterrupted),
    createScheduler: (cb) => createTakeScheduler({
      media,
      frames: createTakeFrames(),
      windows: cb.windows,
      clipStartMs: cb.clipStartMs,
      clipEndMs: cb.clipEndMs,
      onOpen: cb.onOpen,
      onClose: cb.onClose,
      onEnd: cb.onEnd,
      onInterrupted: cb.onInterrupted,
    }),
    createTake: () => createTake(api, input.itemId, { segFrom: input.segFrom, segTo: input.segTo, role: input.role }),
    finishTake: (dubId) => finishTake(api, dubId),
    assess: async (item: QueueItem, signal) => {
      if (!item.wav) throw new ApiError(400, "Audio must be a 16 kHz mono 16-bit WAV");
      const res = await assessPronunciation(api, {
        wav: item.wav, reference: input.textOf(item.idx), language: "en-US", save: true, source: "library", signal,
      });
      if (!res.assessmentId) throw new ApiError(500, "Could not save the recording");
      return { assessmentId: res.assessmentId };
    },
    post: (dubId, item, assessmentId, signal) => postLine(api, dubId, {
      segIdx: item.idx, assessmentId, recStartMs: item.recStartMs, voicedMs: item.voicedMs, capture: item.capture,
    }, signal),
    claim: (stop) => claimAudio(stop),
    release: (stop) => releaseAudio(stop),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    now: () => media.currentTime * 1000,
  };
}
