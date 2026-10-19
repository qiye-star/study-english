import "../locales";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import type { MyInvite } from "~/api/types";
import { useAuth } from "~/auth/auth-context";
import { EMAIL_BINDING_PATH } from "~/auth/email-binding";
import { SectionGroup } from "~/components/section-group";
import { ACCOUNT_ERROR_KEYS, createMyInvite, fetchMyInvite, rotateMyInvite } from "../account-api";
import { inviteLink, shareInviteLink, type ShareOutcome } from "./invite-link";

type Eligible = Extract<MyInvite, { eligible: true }>;

const BUTTON = "h-10 flex-none whitespace-nowrap rounded-button bg-blue px-4 text-body font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const GHOST = "h-10 flex-none whitespace-nowrap rounded-button bg-surface-2 px-4 text-body font-medium text-ink transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const dateOf = (iso: string, language: string) =>
  new Date(iso).toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" });

/**
 * 「我的邀请码」面板(W2)。码只在本人页面显示,不写入任何存储;分享链接只用 `#` 片段(X27)。
 * 组件只经 account-api 与 ApiClient 通信,不直接 fetch。
 */
export function MyInvitePanel() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [status, setStatus] = useState<MyInvite | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMyInvite(api)
      .then((s) => { if (alive) setStatus(s); })
      .catch((err: unknown) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, [api]);

  async function run(action: () => Promise<MyInvite>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setStatus(await action());
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(code: string) {
    const outcome = await shareInviteLink(inviteLink(window.location.origin, code), { clipboard: navigator.clipboard });
    setNote(noteFor(outcome));
  }

  async function share(code: string) {
    const outcome = await shareInviteLink(inviteLink(window.location.origin, code));
    setNote(noteFor(outcome));
  }

  function noteFor(outcome: ShareOutcome): string | null {
    if (outcome === "copied") return t("web.account.invite.copied");
    if (outcome === "failed") return t("web.account.invite.copyFailed");
    return null; // shared / cancelled:不另外提示
  }

  const errorText = error ? translateServerError(t, error, ACCOUNT_ERROR_KEYS) : null;

  return (
    <SectionGroup title={t("web.account.invite.title")} className="mt-4">
      <div className="space-y-3 px-3.5 py-2.5">
        {errorText ? <p role="alert" className="text-sub text-destructive">{errorText}</p> : null}
        {status === null && !errorText ? <p aria-busy="true" className="text-meta text-ink-2">{t("web.account.invite.loading")}</p> : null}
        {status !== null && status.eligible === false ? <IneligibleNote reason={status.reason} availableAt={status.availableAt} /> : null}
        {status?.eligible && !status.code ? (
          <div className="space-y-2">
            <p className="text-meta text-ink-2">{t("web.account.invite.createHint")}</p>
            <button type="button" disabled={busy} onClick={() => run(() => createMyInvite(api))} className={BUTTON}>
              {t("web.account.invite.create")}
            </button>
          </div>
        ) : null}
        {status?.eligible && status.code ? (
          <CodeBlock
            eligible={status as Eligible & { code: string }}
            busy={busy}
            confirming={confirming}
            note={note}
            language={i18n.language}
            onCopy={() => copyLink(status.code as string)}
            onShare={() => share(status.code as string)}
            onAskReplace={() => { setNote(null); setConfirming(true); }}
            onCancelReplace={() => setConfirming(false)}
            onConfirmReplace={() => run(() => rotateMyInvite(api), () => {
              setConfirming(false);
              setNote(t("web.account.invite.replaced"));
            })}
          />
        ) : null}
      </div>
    </SectionGroup>
  );
}

function IneligibleNote({ reason, availableAt }: { reason: Extract<MyInvite, { eligible: false }>["reason"]; availableAt: string | null }) {
  const { t, i18n } = useTranslation();
  let body: ReactNode;
  if (reason === "too_new") {
    body = availableAt
      ? t("web.account.invite.tooNew", { date: dateOf(availableAt, i18n.language) })
      : t("web.account.invite.tooNewUnknown");
  } else if (reason === "email_unverified") {
    body = (
      <>
        {t("web.account.invite.emailUnverified")}{" "}
        <Link to={EMAIL_BINDING_PATH} className="tap-link whitespace-nowrap font-medium text-blue">{t("web.account.invite.bindLink")}</Link>
      </>
    );
  } else if (reason === "invites_disabled") {
    body = t("web.account.invite.withdrawn");
  } else {
    body = t("web.account.invite.disabled");
  }
  return <p data-testid="my-invite-reason" className="text-sub text-ink-2">{body}</p>;
}

function CodeBlock({ eligible, busy, confirming, note, language, onCopy, onShare, onAskReplace, onCancelReplace, onConfirmReplace }: {
  eligible: Eligible & { code: string };
  busy: boolean;
  confirming: boolean;
  note: string | null;
  language: string;
  onCopy(): void;
  onShare(): void;
  onAskReplace(): void;
  onCancelReplace(): void;
  onConfirmReplace(): void;
}) {
  const { t } = useTranslation();
  const usedUp = eligible.uses >= eligible.cap;
  const counts = { uses: eligible.uses, cap: eligible.cap };
  return (
    <div className="space-y-3">
      <div>
        <p className="text-meta text-ink-2">{t("web.account.invite.yourCode")}</p>
        <p data-testid="my-invite-code" className="num select-all whitespace-nowrap font-mono text-title font-semibold tracking-wider text-ink">
          {eligible.code}
        </p>
        <p data-testid="my-invite-usage" className="text-meta text-ink-2">{t("web.account.invite.usage", counts)}</p>
      </div>

      {usedUp ? (
        <p data-testid="my-invite-used-up" className="text-sub text-ink-2">{t("web.account.invite.usedUp")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCopy} disabled={busy} className={GHOST}>{t("web.account.invite.copyLink")}</button>
          <button type="button" onClick={onShare} disabled={busy} className={GHOST}>{t("web.account.invite.share")}</button>
        </div>
      )}
      {note ? <p role="status" data-testid="my-invite-note" className="text-meta text-ink-2">{note}</p> : null}

      <div>
        <p className="text-meta font-medium text-ink-2">{t("web.account.invite.invitees")}</p>
        {eligible.invitees.length === 0 ? (
          <p className="text-meta text-ink-2">{t("web.account.invite.noInvitees")}</p>
        ) : (
          <ul data-testid="my-invite-invitees" className="mt-1 space-y-1">
            {eligible.invitees.map((invitee) => (
              <li key={`${invitee.displayName}-${invitee.joinedAt}`} className="flex items-baseline justify-between gap-3 text-sub text-ink">
                <span className="min-w-0 truncate">{invitee.displayName}</span>
                <span className="flex-none whitespace-nowrap text-meta text-ink-2">{dateOf(invitee.joinedAt, language)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirming ? (
        <div data-testid="my-invite-confirm" role="group" className="space-y-2 rounded-button bg-surface-2 p-3">
          <p className="text-sub text-ink">{t("web.account.invite.replaceConfirm", counts)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onCancelReplace} disabled={busy} className={GHOST}>{t("web.account.invite.cancel")}</button>
            <button type="button" onClick={onConfirmReplace} disabled={busy} className={BUTTON}>{t("web.account.invite.replaceButton")}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onAskReplace} disabled={busy} className={GHOST}>{t("web.account.invite.replace")}</button>
      )}
    </div>
  );
}
