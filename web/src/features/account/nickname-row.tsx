import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { saveNickname } from "./account-api";

/** 昵称编辑:输入框 + 保存;422 显示固定的本地化文案,不回显输入。 */
export function NicknameRow({ nickname, onSaved }: { nickname?: string; onSaved: (nickname?: string) => void }) {
  const { t } = useTranslation();
  const { api, updateDisplayName } = useAuth();
  const inputId = useId();
  const [value, setValue] = useState(nickname ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setValue(nickname ?? "");
  }, [nickname]);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const updated = await saveNickname(api, value);
      onSaved(updated.nickname ?? undefined);
      updateDisplayName?.(updated.displayName || undefined);
      setStatus({ ok: true, text: t("web.account.nickname.saved") });
    } catch (err) {
      const text = err instanceof ApiError && err.status === 422
        ? t("web.account.errors.nicknameInvalid")
        : translateServerError(t, err);
      setStatus({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3.5 py-2.5">
      <label htmlFor={inputId} className="block text-body font-medium text-ink">{t("web.account.nickname.label")}</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="nickname"
          className="h-10 min-w-0 flex-1 rounded-button bg-surface-2 px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="h-10 flex-none whitespace-nowrap rounded-button bg-blue px-4 text-body font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("web.account.nickname.save")}
        </button>
      </div>
      <p className="mt-1 text-meta text-ink-2">{t("web.account.nickname.hint")}</p>
      {status ? (
        <p role="status" data-testid="account-nickname-status" className={`mt-1 text-meta ${status.ok ? "text-green" : "text-red"}`}>
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
