import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE, MAX_HOLD_MS, holdReducer, type DiscardReason, type HoldEvent, type HoldModel } from "./hold-to-talk";

export interface UseHoldToTalkOptions {
  /** 开始采集麦克风(在手势内同步调用);resolve(false) = 未能开始 */
  start(): Promise<boolean>;
  finish(deliver: "send" | "fill"): void;
  discard(reason: DiscardReason): void;
}

const active = (m: HoldModel) => m.state === "recording" || m.state === "armed-cancel" || m.state === "armed-text" || (m.state === "keyboard" && m.micReady);

export function useHoldToTalk(options: UseHoldToTalkOptions) {
  const opts = useRef(options);
  opts.current = options;
  const modelRef = useRef<HoldModel>(IDLE);
  const [model, setModel] = useState<HoldModel>(IDLE);
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  const dispatch = useCallback((event: HoldEvent) => {
    const before = modelRef.current;
    const { model: next, effects } = holdReducer(before, event);
    modelRef.current = next;
    if (mounted.current) setModel(next);
    if (next.state === "idle" && before.state !== "idle") generation.current += 1;
    if (active(next) && !active(before)) timer.current = window.setTimeout(() => dispatch({ type: "max" }), MAX_HOLD_MS);
    if (!active(next) && timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    for (const effect of effects) {
      if (effect.type === "start") {
        const gen = generation.current;
        opts.current.start().then(
          (ok) => { if (gen === generation.current) dispatch(ok ? { type: "mic-ready" } : { type: "mic-failed" }); },
          () => { if (gen === generation.current) dispatch({ type: "mic-failed" }); },
        );
      } else if (effect.type === "finish") {
        opts.current.finish(effect.deliver);
      } else {
        opts.current.discard(effect.reason);
      }
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && modelRef.current.state !== "idle") dispatch({ type: "cancel" });
    };
    document.addEventListener("visibilitychange", onVisibility);
    mounted.current = true;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      mounted.current = false;
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
      }
      if (modelRef.current.state !== "idle") {
        modelRef.current = IDLE;
        generation.current += 1;
        opts.current.discard("cancel");
      }
    };
  }, [dispatch]);

  return { model, dispatch };
}
