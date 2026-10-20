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
  const [payload, setPayload] = useState<string | null>(null);
  const handleRef = useRef<CaptchaHandle>(null);

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

  const onServerError = useCallback((err: unknown): boolean => {
    if (!(err instanceof ApiError) || err.status !== 428) return false;
    setServerRequired(true);
    setPayload(null);
    return true;
  }, []);

  const consumed = useCallback(() => {
    setPayload(null);
    handleRef.current?.reset({ again: needed });
  }, [needed]);

  return { needed, ready, payload, setPayload, handleRef, onServerError, consumed };
}
