import { useCallback, useEffect, useRef, useState } from "react";
import { decideCapture, type CaptureDecision } from "./capture";
import { MAX_RECORDING_MS } from "./convert";
import { startPcmRecording } from "./pcm-recording";
import { RecorderError, startRecording, type RecorderEnv, type RecordingResult, type RecordingSession } from "./recorder";

export type RecorderState = "idle" | "starting" | "recording";

export interface UseRecorderOptions {
  maxDurationMs?: number;
  onAutoStop?: (result: RecordingResult) => void;
  env?: RecorderEnv;
  /** 自定义录音启动器(测试或其他采集方式);优先于 env。 */
  starter?: RecordingStarter;
}

export type RecordingStarter = (opts: { maxDurationMs?: number }) => Promise<RecordingSession>;

interface StarterDeps {
  decide(): CaptureDecision;
  pcm: typeof startPcmRecording;
  legacy: typeof startRecording;
}

const browserStarterDeps: StarterDeps = { decide: () => decideCapture(), pcm: startPcmRecording, legacy: startRecording };

/**
 * 默认启动器(R9/R31):注入了 MediaRecorder 环境(测试)一律走旧路径;否则在按下的同步阶段 decideCapture():
 * 页面级 AudioContext 已 running → PCM 采集(借用该上下文);未解锁/不支持 → 旧 MediaRecorder 路径(不得录出静音)。
 */
export function defaultRecordingStarter(env?: RecorderEnv, deps: StarterDeps = browserStarterDeps): RecordingStarter {
  if (env) return (o) => deps.legacy({ ...o, env });
  return (o) => {
    const decision = deps.decide();
    if (decision.mode !== "pcm") return deps.legacy(o);
    // R9:AudioContext 路径失败 → MediaRecorder 路径。用户/系统层面的拒绝换路径也没用,原样上报(review W1 I-4)。
    return deps.pcm({ ...o, context: decision.context }).catch((err: unknown) => {
      if (err instanceof RecorderError && FINAL_START_ERRORS.has(err.code)) throw err;
      return deps.legacy(o);
    });
  };
}

const FINAL_START_ERRORS = new Set<RecorderError["code"]>(["permission_denied", "mic_busy", "insecure_context"]);

const asRecorderError = (err: unknown) => (err instanceof RecorderError ? err : new RecorderError("failed", String(err)));

export function useRecorder({ maxDurationMs = MAX_RECORDING_MS, onAutoStop, env, starter }: UseRecorderOptions = {}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const session = useRef<RecordingSession | null>(null);
  const mounted = useRef(true);
  const starting = useRef(false);
  const cancelRequested = useRef(false); // cancel() 在 starting 期间被调用
  const stopping = useRef<RecordingSession | null>(null);
  const startedAt = useRef(0);
  const autoStop = useRef(onAutoStop);
  autoStop.current = onAutoStop;
  const starterRef = useRef(starter);
  starterRef.current = starter;

  useEffect(() => {
    if (state !== "recording") return;
    const now = env?.now ?? Date.now;
    const id = window.setInterval(() => setElapsedMs(now() - startedAt.current), 250);
    return () => window.clearInterval(id);
  }, [state, env]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = session.current;
      const pendingStop = stopping.current;
      session.current = null; // 先清空,结果处理器的守卫才会跳过(不再 setState / onAutoStop)
      stopping.current = null;
      current?.cancel();
      pendingStop?.cancel(); // 停止中卸载:即使 stop 永不完成也要释放麦克风
    };
  }, []);

  const start = useCallback(async () => {
    if (session.current || starting.current) return false;
    starting.current = true;
    cancelRequested.current = false;
    setError(null);
    setElapsedMs(0);
    setState("starting");
    try {
      const current = await (starterRef.current ?? defaultRecordingStarter(env))({ maxDurationMs });
      if (!mounted.current || cancelRequested.current) {
        current.cancel(); // 启动期间已卸载/已取消:立刻释放麦克风
        return false;
      }
      session.current = current;
      startedAt.current = current.startedAt;
      setState("recording");
      current.result.then(
        (result) => {
          if (session.current !== current) return; // 用户主动 stop() 已处理
          session.current = null;
          setState("idle");
          autoStop.current?.(result);
        },
        (err) => {
          if (session.current !== current) return; // 已被 stop/cancel 接管
          session.current = null;
          setState("idle");
          setError(asRecorderError(err));
        },
      );
      return true;
    } catch (err) {
      if (mounted.current && !cancelRequested.current) {
        setState("idle");
        setError(asRecorderError(err));
      }
      return false;
    } finally {
      starting.current = false;
    }
  }, [maxDurationMs, env]);

  const stop = useCallback(async () => {
    const current = session.current;
    if (!current) return null;
    session.current = null;
    stopping.current = current;
    try {
      const result = await current.stop();
      return stopping.current === current ? result : null; // 停止期间被 cancel:丢弃结果
    } catch (err) {
      if (stopping.current === current && mounted.current) setError(asRecorderError(err));
      return null;
    } finally {
      // 只有仍拥有该会话时才改状态;被 cancel 后新的 start() 可能已进入 recording
      if (stopping.current === current) {
        stopping.current = null;
        if (mounted.current) setState("idle");
      }
    }
  }, []);

  /** 丢弃正在进行的录音(starting / recording / stopping 均可,幂等):释放麦克风,不产出结果、不触发 onAutoStop、不报错。 */
  const cancel = useCallback(() => {
    const current = session.current ?? stopping.current;
    session.current = null; // 先清空,结果处理器的守卫才会跳过
    stopping.current = null;
    if (starting.current) cancelRequested.current = true; // 麦克风还在申请中:到手后立刻释放
    if (!current && !starting.current) return;
    current?.cancel();
    setState("idle");
    setElapsedMs(0);
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { state, elapsedMs, error, start, stop, cancel, clearError };
}
