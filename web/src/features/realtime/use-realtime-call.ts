import { useEffect, useRef, useState } from "react";
import { INITIAL_CALL, type CallModel } from "./call-machine";
import { RealtimeCall, type RealtimeCallOptions } from "./realtime-call";

/**
 * 挂载即开始一次通话(选项只在开始时读取一次;换会话请重新挂载)。
 * 卸载 → 挂断;页面变为 hidden → 以 `web.realtime.endedInBackground` 结束(R16)。
 */
export function useRealtimeCall(options: Omit<RealtimeCallOptions, "onChange">): { model: CallModel; call: RealtimeCall | null } {
  const [model, setModel] = useState<CallModel>(INITIAL_CALL);
  const [call, setCall] = useState<RealtimeCall | null>(null);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    let live = true;
    let instance: RealtimeCall | null = null;
    // 推迟一拍:StrictMode 的"挂载-卸载-再挂载"只会真正启动第二次;上下文已在点击里解锁
    const timer = window.setTimeout(() => {
      instance = new RealtimeCall({
        ...opts.current,
        onChange: (m) => { if (live) setModel(m); }, // 卸载后不 setState
        onUserMessage: (id, text) => opts.current.onUserMessage?.(id, text),
      });
      setCall(instance);
      void instance.start();
    }, 0);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") instance?.end("web.realtime.endedInBackground");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      instance?.hangup();
    };
  }, []);

  return { model, call };
}
