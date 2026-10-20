/**
 * ALTCHA 组件本体(spec 2026-10-20-captcha-altcha §10,计划 W2)。
 * 只由 captcha-field.tsx 懒加载(`React.lazy`),主包不含本文件、不含 altcha 与 hash-wasm。
 * 挑战由组件按 `challenge` 属性的同源 URL 自取(这是 ApiClient 之外唯一的请求,不带任何用户数据)。
 * 载荷只通过 onPayload 交给调用方,不写 DOM 文本、不写存储、不进日志。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import "altcha"; // 必须先于语言包:语言包在求值时写入 globalThis.$altcha
import "altcha/i18n/en";
import "altcha/i18n/zh-cn";
import "./locales";

/** 同源挑战端点(服务端 GET /api/captcha/challenge,spec §6.2)。 */
export const CHALLENGE_URL = "/api/captcha/challenge";
/** 故意不存在的表单 id:隐藏字段借此脱离外层 <form>(见下方组件内注释)。 */
const DETACHED_FORM_ID = "captcha-payload-detached";

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
  // 方法在元素升级(connectedCallback 之后的微任务)之前是 undefined,所以全部可选、按需调用。
  configure?(options: { hideFooter?: boolean }): void;
  /** 注意:altcha 的 reset 第一个参数是状态名,不接受选项对象。 */
  reset?(): void;
  verify?(): Promise<unknown>;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "altcha-widget": React.DetailedHTMLProps<React.HTMLAttributes<AltchaElement>, AltchaElement> & {
        challenge?: string;
        auto?: "off" | "onfocus" | "onload" | "onsubmit";
        language?: string;
        name?: string;
        form?: string;
      };
    }
  }
}

export const CaptchaWidget = forwardRef<CaptchaHandle, CaptchaWidgetProps>(function CaptchaWidget({ onPayload }, ref) {
  const { i18n } = useTranslation();
  const elRef = useRef<AltchaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      reset({ again = false } = {}) {
        const el = elRef.current;
        if (!el) return;
        el.reset?.();
        // 失败会经 statechange 报告;这里不重复处理。
        if (again) {
          el.verify?.()?.catch(() => {
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
    // 元素未升级时 configure 可能还不存在:这里先尝试一次,之后由 load 事件(升级完成)再设置。
    const hide = () => el.configure?.({ hideFooter: true });
    hide();
    el.addEventListener("load", hide);
    return () => el.removeEventListener("load", hide);
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const give = (payload: unknown) => onPayload(typeof payload === "string" && payload ? payload : null);
    const onVerified = (e: Event) => {
      give((e as CustomEvent<{ payload?: unknown }>).detail?.payload);
    };
    const onExpired = () => give(null);
    // 失败时 altcha 自己的界面已经给出错误文字,这里不再重复显示。
    const onState = (e: Event) => {
      const state = (e as CustomEvent<{ state?: string }>).detail?.state;
      if (state === "error" || state === "verifying" || state === "unverified") give(null);
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
      {/*
        altcha 在组件内渲染 <input type="hidden" name form value=载荷>(它不用 shadow DOM,字段在 light DOM 里)。
        name="" 让它不进表单数据;form 指向一个不存在的 id,让它不属于外层表单(没有 form owner)。
        这样载荷不会被原生表单提交、自动填充或表单扩展读到。
      */}
      <altcha-widget
        ref={elRef}
        challenge={CHALLENGE_URL}
        auto="off"
        language={language}
        name=""
        form={DETACHED_FORM_ID}
      />
    </div>
  );
});
