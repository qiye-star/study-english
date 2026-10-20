import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import type { CaptchaHandle } from "./captcha-widget";

/**
 * 人机验证组件分块加载失败时的替代界面(部署后 hash 变了、网络断开)。
 * 只给一句提示和一个重新加载按钮;不进存储、不进 URL。文案用 defaultValue,即使懒加载的语言包没到也能显示。
 */
export const CaptchaLoadFailed = forwardRef<CaptchaHandle, { onPayload?: (payload: string | null) => void }>(
  function CaptchaLoadFailed(_props, _ref) {
    const { t } = useTranslation();
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="break-words text-sm text-red">
          {t("web.captcha.failed", { defaultValue: "Verification failed. Please try again." })}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm font-medium text-blue underline-offset-2 hover:underline"
        >
          {t("web.captcha.reload", { defaultValue: "Reload page" })}
        </button>
      </div>
    );
  },
);
