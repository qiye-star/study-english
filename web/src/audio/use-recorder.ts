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
    setError(null);
    setElapsedMs(0);
    setState("starting");
    try {
      const current = await startRecording({ maxDurationMs, env });
      if (!mounted.current) {
        current.cancel(); // 启动期间已卸载:立刻释放麦克风
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
      if (mounted.current) {
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
    try {
      return await current.stop();
    } catch (err) {
      setError(asRecorderError(err));
      return null;
    } finally {
      setState("idle");
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { state, elapsedMs, error, start, stop, clearError };
}
