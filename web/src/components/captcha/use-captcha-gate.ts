import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import type { CaptchaMode } from "~/api/types";
import type { CaptchaHandle } from "./captcha-widget";

/** 与服务端 R-C17 的作用域同名。 */
export type CaptchaScope = "register" | "email_code" | "reset" | "login";

/**
 * 按模式判断某个作用域是否要先验证(与 spec §3 的端点策略一致)。
 * adaptive 下登录只有在服务端回了 428 之后才要求(`serverRequired`),这里返回 false。
 */
export function modeRequires(mode: CaptchaMode | null, scope: CaptchaScope): boolean {
  if (mode === "always") return true;
  if (mode === "adaptive") return scope !== "login";
  return false;
}

/**
 * 页面用的人机验证门(计划 W3,spec R-C12/R-C23):
 * - 挂载时读一次 `GET /api/captcha/config`(取不到就按 off 处理,服务端仍会用 428 兜底);
 * - `onServerError`:收到 428 时打开组件并清空载荷;
 * - `consumed`:每次带载荷的请求返回后调用,载荷只用一次,并让组件为下一次提交重新求解。
 * 载荷只放在内存里(state),不进存储、不进 URL。
 */
export function useCaptchaGate(api: ApiClient, scope: CaptchaScope) {
  const [mode, setMode] = useState<CaptchaMode | null>(null);
  const [serverRequired, setServerRequired] = useState(false);
  const [payload, setState] = useState<string | null>(null);
  // 同步的真值:同一次事件里连续两次 take() 也只能拿到一次(state 要等下一次渲染才变)。
  const held = useRef<string | null>(null);
  const handleRef = useRef<CaptchaHandle>(null);
  // identity 必须稳定:调用方可能把它放进 effect 依赖;setState 与 held 本身都是稳定的。
  const setPayload = useCallback((next: string | null) => {
    held.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.captchaConfig().then(
      (config) => {
        if (!cancelled) setMode(config.mode);
      },
      () => {
        if (!cancelled) setMode("off");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const needed = serverRequired || modeRequires(mode, scope);
  const ready = !needed || payload !== null;

  // 普通函数即可:两者都不是 effect 的依赖,每次渲染重建的成本可忽略。
  const onServerError = (err: unknown): boolean => {
    if (!(err instanceof ApiError) || err.status !== 428) return false;
    setServerRequired(true);
    setPayload(null);
    return true;
  };

  // 载荷在请求开始时交出(take),之后这里是 null,直到组件再次求解。
  const take = (): string | null => {
    const current = held.current;
    setPayload(null);
    return current;
  };

  // again 默认跟随 needed;请求成功后调用方传 false(页面马上卸载,不必再求解)。元素可能还不可用,故 try。
  const consumed = (again: boolean = needed) => {
    setPayload(null);
    try {
      handleRef.current?.reset({ again });
    } catch {
      /* 元素尚未升级或已卸载:下一次请求会重新要求验证 */
    }
  };

  return { needed, ready, payload, setPayload, take, handleRef, onServerError, consumed };
}
