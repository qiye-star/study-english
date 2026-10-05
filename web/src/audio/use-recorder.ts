import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS } from "./convert";
import { RecorderError, startRecording, type RecorderEnv, type RecordingResult, type RecordingSession } from "./recorder";

export type RecorderState = "idle" | "starting" | "recording";

export interface UseRecorderOptions {
  maxDurationMs?: number;
  onAutoStop?: (result: RecordingResult) => void;
  env?: RecorderEnv;
}

const asRecorderError = (err: unknown) => (err instanceof RecorderError ? err : new RecorderError("failed", String(err)));

export function useRecorder({ maxDurationMs = MAX_RECORDING_MS, onAutoStop, env }: UseRecorderOptions = {}) {
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
      session.current = null; // 先清空,结果处理器的守卫才会跳过(不再 setState / onAutoStop)
      current?.cancel();
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
      const current = await startRecording({ maxDurationMs, env });
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
          if (session.current === current) session.current = null;
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
      if (stopping.current === current) stopping.current = null;
      if (mounted.current) setState("idle");
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
