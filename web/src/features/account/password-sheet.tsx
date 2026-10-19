import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";

/** 改密弹层:本地校验 8–128 位;成功后由 auth-context 换掉本机 token(其他设备被登出)。 */
export function PasswordSheet({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const currentId = useId();
  const nextId = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8 || next.length > 128) {
      setError(t("web.account.password.tooShort"));
      return;
    }
    if (!current || !changePassword) {
      setError(t("web.account.errors.unknown"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(translateServerError(t, err, { "Wrong password": "web.account.password.wrong" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[90vh] overflow-y-auto">
        <BottomSheetHeader title={t("web.account.password.title")} description={t("web.account.password.hint")} />
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label htmlFor={currentId} className="block text-meta text-ink-2">{t("web.account.password.current")}</label>
            <input id={currentId} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password"
              className="mt-1 h-11 w-full rounded-button bg-surface-2 px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <div>
            <label htmlFor={nextId} className="block text-meta text-ink-2">{t("web.account.password.new")}</label>
            <input id={nextId} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password"
              className="mt-1 h-11 w-full rounded-button bg-surface-2 px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          {error ? <p role="alert" data-testid="account-password-error" className="text-meta text-red">{error}</p> : null}
          <button type="submit" disabled={busy}
            className="h-11 whitespace-nowrap rounded-button bg-blue text-body font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.account.password.submit")}
          </button>
        </form>
      </BottomSheetContent>
    </BottomSheet>
  );
}
