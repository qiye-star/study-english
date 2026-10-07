import { useCallback, useEffect, useRef, useState } from "react";
import { INITIAL_CALL, type CallModel } from "./call-machine";
import { RealtimeCall, type CallEnding, type RealtimeCallOptions } from "./realtime-call";

/**
 * 通话开始后这么久之内变为 hidden 不立即挂断(calls v2 Task 2):iOS 的麦克风权限弹窗、
 * 系统音频会话切换都可能让页面短暂 hidden。之后(或权限弹窗关闭后)仍是 hidden 才按 R16 结束。
 */
export const BACKGROUND_GRACE_MS = 3000;
/** 宽限期内被推迟的 hidden:每隔这么久复查一次。 */
const RECHECK_MS = 500;

/**
 * 挂载即开始一次通话(选项只在开始时读取一次;换会话请重新挂载)。
 * 卸载 → 挂断;页面变为 hidden → 以 `web.realtime.endedInBackground` 结束(R16;开始后 3 s 内与权限弹窗期间除外)。
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
    let startedAt = 0;
    let recheck: number | undefined;
    const hidden = () => document.visibilityState === "hidden";
    /** hidden:宽限期内或权限弹窗开着时推迟复查,否则结束通话。 */
    const onHidden = () => {
      window.clearTimeout(recheck);
      recheck = undefined;
      if (!instance || !hidden()) return;
      const inGrace = Date.now() - startedAt < BACKGROUND_GRACE_MS;
      if (inGrace || instance.awaitingPermission) {
        recheck = window.setTimeout(onHidden, RECHECK_MS);
        return;
      }
      instance.end("web.realtime.endedInBackground");
    };
    // 推迟一拍:StrictMode 的"挂载-卸载-再挂载"只会真正启动第二次;上下文已在点击里解锁
    const timer = window.setTimeout(() => {
      instance = new RealtimeCall({
        ...opts.current,
        onChange: (m) => { if (live) setModel(m); }, // 卸载后不 setState
        onUserMessage: (...args) => opts.current.onUserMessage?.(...args),
      });
      instanceRef.current = instance;
      setCall(instance);
      // 计时器触发前页面已经切到后台(那次 visibilitychange 时还没有实例,也还没有权限弹窗):不开麦克风,直接按 R16 结束并说明
      if (hidden()) {
        instance.end("web.realtime.endedInBackground");
        return;
      }
      startedAt = Date.now();
      void instance.start();
    }, 0);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.clearTimeout(recheck);
      document.removeEventListener("visibilitychange", onHidden);
      instance?.hangup();
      if (!handedOff.current) instance?.ending().drop();
    };
  }, []);

  return { model, call, handOff };
}
