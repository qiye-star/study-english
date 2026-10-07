import { useCallback, useEffect, useRef, useState } from "react";
import { INITIAL_CALL, type CallModel } from "./call-machine";
import { RealtimeCall, type CallEnding, type RealtimeCallOptions } from "./realtime-call";

/**
 * 挂载即开始一次通话(选项只在开始时读取一次;换会话请重新挂载)。
 * 卸载 → 挂断;页面变为 hidden → 以 `web.realtime.endedInBackground` 结束(R16)。
 * 挂断后套接字留给服务端关闭(review F4 I-1):`handOff()` 把它交给调用方(页面等关闭再重新加载);
 * 没有交出就卸载(切换会话、离开页面)时立即关闭,不再等。
 */
export function useRealtimeCall(options: Omit<RealtimeCallOptions, "onChange">): {
  model: CallModel; call: RealtimeCall | null; handOff(): CallEnding | null;
} {
  const [model, setModel] = useState<CallModel>(INITIAL_CALL);
  const [call, setCall] = useState<RealtimeCall | null>(null);
  const opts = useRef(options);
  opts.current = options;
  const instanceRef = useRef<RealtimeCall | null>(null);
  const handedOff = useRef(false);
  const handOff = useCallback((): CallEnding | null => {
    const instance = instanceRef.current;
    if (!instance) return null;
    handedOff.current = true;
    return instance.ending();
  }, []);

  useEffect(() => {
    let live = true;
    let instance: RealtimeCall | null = null;
    // 推迟一拍:StrictMode 的"挂载-卸载-再挂载"只会真正启动第二次;上下文已在点击里解锁
    const timer = window.setTimeout(() => {
      instance = new RealtimeCall({
        ...opts.current,
        onChange: (m) => { if (live) setModel(m); }, // 卸载后不 setState
        onUserMessage: (...args) => opts.current.onUserMessage?.(...args),
      });
      instanceRef.current = instance;
      setCall(instance);
      // 计时器触发前页面已经切到后台(那次 visibilitychange 时还没有实例):不开麦克风,直接按 R16 结束并说明
      if (document.visibilityState === "hidden") instance.end("web.realtime.endedInBackground");
      else void instance.start();
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
      if (!handedOff.current) instance?.ending().drop();
    };
  }, []);

  return { model, call, handOff };
}
