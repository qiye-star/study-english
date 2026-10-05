import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "~/api/client";
import { cachedHints, type Hint, type HintsInput } from "./hints";

export type HintsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; hints: Hint[] }
  | { status: "error"; error: unknown };

/** 点击触发;新的请求、reset、卸载都会中止上一个;卸载后不 setState(StrictMode 安全)。 */
export function useHints(api: ApiClient) {
  const [state, setState] = useState<HintsState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const lastRef = useRef<HintsInput | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const request = useCallback((input: HintsInput) => {
    const previous = controllerRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    lastRef.current = input;
    setState({ status: "loading" });
    cachedHints(api, input, controller.signal).then(
      (hints) => { if (mountedRef.current && !controller.signal.aborted) setState({ status: "done", hints }); },
      (error: unknown) => { if (mountedRef.current && !controller.signal.aborted) setState({ status: "error", error }); },
    );
    // 先登记新的等待者再中止旧的:同一键(重新打开、重试)时共享的请求不会被中止后重发
    previous?.abort();
  }, [api]);

  const retry = useCallback(() => {
    if (lastRef.current) request(lastRef.current);
  }, [request]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    lastRef.current = null;
    if (mountedRef.current) setState({ status: "idle" });
  }, []);

  return { state, request, retry, reset };
}
