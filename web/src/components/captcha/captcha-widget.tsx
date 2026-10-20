/**
 * ALTCHA 组件本体(spec 2026-10-20-captcha-altcha §10,计划 W2)。
 * 只由 captcha-field.tsx 懒加载(`React.lazy`),主包不含本文件、不含 altcha 与 hash-wasm。
 * 挑战由组件按 `challenge` 属性的同源 URL 自取(这是 ApiClient 之外唯一的请求,不带任何用户数据)。
 * 载荷只通过 onPayload 交给调用方,不写 DOM 文本、不写存储、不进日志。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "altcha"; // 必须先于语言包:语言包在求值时写入 globalThis.$altcha
import "altcha/i18n/en";
import "altcha/i18n/zh-cn";
import "./locales";

/** 同源挑战端点(服务端 GET /api/captcha/challenge,spec §6.2)。 */
export const CHALLENGE_URL = "/api/captcha/challenge";

export interface CaptchaHandle {
  /** 清空当前载荷;`again: true` 时接着在后台重新求解(下一步要用新载荷)。 */
  reset(opts?: { again?: boolean }): void;
}

export interface CaptchaWidgetProps {
  /** 求解完成时给出载荷字符串;过期、失败或重置时给 null。 */
  onPayload: (payload: string | null) => void;
}

/** 组件实例上我们用到的方法(altcha 3.x 的自定义元素导出)。 */
interface AltchaElement extends HTMLElement {
  configure(options: { hideFooter?: boolean }): void;
  /** 注意:altcha 的 reset 第一个参数是状态名,不接受选项对象。 */
  reset(): void;
  verify(): Promise<unknown>;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "altcha-widget": React.DetailedHTMLProps<React.HTMLAttributes<AltchaElement>, AltchaElement> & {
        challenge?: string;
        auto?: "off" | "onfocus" | "onload" | "onsubmit";
        language?: string;
      };
    }
  }
}

export const CaptchaWidget = forwardRef<CaptchaHandle, CaptchaWidgetProps>(function CaptchaWidget({ onPayload }, ref) {
  const { t, i18n } = useTranslation();
  const elRef = useRef<AltchaElement>(null);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      reset({ again = false } = {}) {
        const el = elRef.current;
        if (!el) return;
        setFailed(false);
        el.reset();
        // 失败会经 statechange 报告;这里不重复处理。
        if (again) {
          el.verify().catch(() => {
            /* 失败已由 statechange 报告 */
          });
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const hide = () => el.configure({ hideFooter: true });
    hide();
    el.addEventListener("load", hide);
    return () => el.removeEventListener("load", hide);
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const give = (payload: unknown) => onPayload(typeof payload === "string" && payload ? payload : null);
    const onVerified = (e: Event) => {
      setFailed(false);
      give((e as CustomEvent<{ payload?: unknown }>).detail?.payload);
    };
    const onExpired = () => give(null);
    const onState = (e: Event) => {
      const state = (e as CustomEvent<{ state?: string }>).detail?.state;
      if (state === "error") {
        setFailed(true);
        give(null);
      } else if (state === "verifying" || state === "unverified") {
        setFailed(false);
        give(null);
      }
    };
    el.addEventListener("verified", onVerified);
    el.addEventListener("expired", onExpired);
    el.addEventListener("statechange", onState);
    return () => {
      el.removeEventListener("verified", onVerified);
      el.removeEventListener("expired", onExpired);
      el.removeEventListener("statechange", onState);
    };
  }, [onPayload]);

  // altcha 只认 zh-cn / en;其它语言(包括 es)回退为英文。
  const language = i18n.resolvedLanguage === "zh-CN" ? "zh-cn" : "en";

  return (
    <div className="flex flex-col gap-2">
      <altcha-widget ref={elRef} challenge={CHALLENGE_URL} auto="off" language={language} />
      {failed ? (
        <p role="alert" className="break-words text-sm text-red">
          {t("web.captcha.failed")}
        </p>
      ) : null}
    </div>
  );
});
