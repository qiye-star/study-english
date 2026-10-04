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
  const autoStop = useRef(onAutoStop);
  autoStop.current = onAutoStop;

  useEffect(() => {
    if (state !== "recording") return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - started), 250);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => () => session.current?.cancel(), []);

  const start = useCallback(async () => {
    if (session.current) return false;
    setError(null);
    setElapsedMs(0);
    setState("starting");
    try {
      const current = await startRecording({ maxDurationMs, env });
      session.current = current;
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
      setState("idle");
      setError(asRecorderError(err));
      return false;
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
