import "./locales";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { displayNameOf } from "~/api/types";
import { useAuth } from "~/auth/auth-context";
import { Avatar } from "~/components/avatar";
import { removeAvatar, uploadAvatar } from "./account-api";
import { AvatarPickError, prepareAvatar } from "./resize-image";

/** 服务端在 AVATAR_UPLOAD_ENABLED 关闭时的固定错误原文(只用来比对,不显示)。 */
const UPLOADS_OFF = "Avatar upload is disabled";
const PICK_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

/** 上传失败 → 固定文案(按状态码判断,从不回显服务端或文件内容)。 */
function uploadFailure(err: unknown): { key: string; off: boolean } {
  if (err instanceof AvatarPickError) return { key: "web.account.avatar.errors.unsupported", off: false };
  if (err instanceof ApiError) {
    if (err.status === 403 && err.message === UPLOADS_OFF) return { key: "web.account.avatar.errors.disabled", off: true };
    if (err.status === 413) return { key: "web.account.avatar.errors.tooLarge", off: false };
    if (err.status === 422) return { key: "web.account.avatar.errors.invalid", off: false };
    if (err.status === 429) return { key: "web.account.avatar.errors.tooMany", off: false };
  }
  return { key: "web.account.errors.unknown", off: false };
}

/** 「我的」账号区的头像:选图(浏览器里缩到 ≤1024 再上传)、移除(二次确认)。头像来自 AuthProvider 的 avatarUrl。 */
export function AvatarPicker() {
  const { t } = useTranslation();
  const { api, user, avatarUrl, refreshProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploadsOff, setUploadsOff] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    await refreshProfile?.().catch((): void => undefined);
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setConfirming(false);
    setStatus(null);
    try {
      await uploadAvatar(api, await prepareAvatar(file));
      await refresh();
      setStatus({ ok: true, text: t("web.account.avatar.updated") });
    } catch (err) {
      const failure = uploadFailure(err);
      if (failure.off) setUploadsOff(true);
      setStatus({ ok: false, text: t(failure.key) });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setStatus(null);
    try {
      await removeAvatar(api);
      setConfirming(false);
      await refresh();
      setStatus({ ok: true, text: t("web.account.avatar.removed") });
    } catch {
      setStatus({ ok: false, text: t("web.account.errors.unknown") });
    } finally {
      setBusy(false);
    }
  }

  const btn = "h-10 flex-none whitespace-nowrap rounded-button px-4 text-body font-semibold transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="px-3.5 py-2.5">
      <p className="text-body font-medium text-ink">{t("web.account.avatar.title")}</p>
      <div className="mt-1.5 flex items-center gap-3">
        <Avatar name={user ? displayNameOf(user) : ""} size="md" tone="blue" src={avatarUrl ?? null} className="text-blue [font-size:22px] liquid:text-ink" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {!uploadsOff && (
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={`${btn} bg-blue text-white`}>
              {t("web.account.avatar.change")}
            </button>
          )}
          {avatarUrl && !confirming && (
            <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={`${btn} bg-surface-2 text-ink`}>
              {t("web.account.avatar.remove")}
            </button>
          )}
          {confirming && (
            <>
              <button type="button" disabled={busy} onClick={onRemove} className={`${btn} bg-red-solid text-white`}>
                {t("web.account.avatar.confirmRemove")}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={`${btn} bg-surface-2 text-ink`}>
                {t("web.common.cancel")}
              </button>
            </>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PICK_ACCEPT}
        data-testid="avatar-file"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <p className="mt-1 text-meta text-ink-2">{t("web.account.avatar.hint")}</p>
      {status ? (
        <p role="status" data-testid="account-avatar-status" className={`mt-1 text-meta ${status.ok ? "text-green" : "text-red"}`}>
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
