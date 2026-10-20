/**
 * 人机验证的懒加载外壳(计划 W2,spec R-C12/R-C13)。
 * 外壳本身很小;组件分块(altcha、hash-wasm、语言包)只在真正渲染时才 import。
 * 非安全上下文(非 HTTPS、非 localhost)不加载组件分块,只显示提示(R-C13)。
 */
import { forwardRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { CaptchaHandle } from "./captcha-widget";
import { CaptchaLoadFailed } from "./load-failed";
import { loadCaptchaWidget } from "./loaders";
import "./locales";

// 组件分块加载失败(404 / 断网)时显示提示与重新加载,而不是让整页因被拒绝的 import 空白。
const CaptchaWidget = lazy(() => loadCaptchaWidget().catch(() => ({ default: CaptchaLoadFailed })));

export interface CaptchaFieldProps {
  /** 求解完成时给出载荷;过期、失败或重置时给 null。调用方负责把载荷放进 X-Captcha 请求头。 */
  onPayload: (payload: string | null) => void;
}

export const CaptchaField = forwardRef<CaptchaHandle, CaptchaFieldProps>(function CaptchaField({ onPayload }, ref) {
  const { t } = useTranslation();
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return (
      <p role="alert" className="break-words text-sm text-red">
        {t("web.captcha.insecureContext")}
      </p>
    );
  }
  return (
    <div role="group" aria-label={t("web.captcha.label")} className="rounded-xl border border-border p-3">
      <Suspense
        fallback={
          <div aria-busy="true" className="min-h-[56px] break-words text-sm text-ink-2">
            {t("web.captcha.loading")}
          </div>
        }
      >
        <CaptchaWidget ref={ref} onPayload={onPayload} />
      </Suspense>
    </div>
  );
});
