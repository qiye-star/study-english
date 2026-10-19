import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { isEmailShape } from "~/auth/validation";
import { requestEmailCode } from "./account-api";

const LABEL = "text-[13px] font-medium text-ink-2";
const COOLDOWN_SECONDS = 60;

/**
 * 邮箱输入 + 发送验证码(60 秒冷却)。发码成功调用 `onSent`;失败调用 `onError` 给出固定文案(不回显输入)。
 * `onError(null)` 用来清除上一次的提示。
 */
export function EmailCodeField({ id, value, onChange, purpose, sent, onSent, onError }: {
  id: string;
  value: string;
  onChange(value: string): void;
  purpose: "register" | "reset";
  /** 已经发过码:按钮文案改为「重新发送」。 */
  sent: boolean;
  onSent(): void;
  onError(message: string | null): void;
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function send() {
    onError(null);
    if (!isEmailShape(value)) {
      onError(t("web.account.code.emailInvalid"));
      return;
    }
    setBusy(true);
    try {
      const receipt = await requestEmailCode(api, value, purpose);
      setCooldown(receipt.cooldownSeconds || COOLDOWN_SECONDS);
      onSent();
    } catch (err) {
      // 429 带 Retry-After 时按服务端给的时间倒计时
      if (err instanceof ApiError && err.status === 429) setCooldown(err.retryAfter ?? COOLDOWN_SECONDS);
      onError(translateServerError(t, err));
    } finally {
      setBusy(false);
    }
  }

  const label = cooldown > 0
    ? t("web.account.code.resendIn", { seconds: cooldown })
    : t(sent ? "web.account.code.resend" : "web.account.code.send");

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`block ${LABEL}`}>{t("web.account.code.email")}</label>
      <div className="flex items-stretch gap-2">
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded-button bg-surface-2 px-3.5 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || cooldown > 0}
          className="h-12 flex-none whitespace-nowrap rounded-button bg-blue px-3.5 text-body font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      </div>
    </div>
  );
}
