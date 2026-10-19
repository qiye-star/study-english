import "../locales";
import { useEffect, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import type { MyInvite, MyInviteReason } from "~/api/types";
import { useAuth } from "~/auth/auth-context";
import { EMAIL_BINDING_PATH } from "~/auth/email-binding";
import { SectionGroup } from "~/components/section-group";
import { ACCOUNT_ERROR_KEYS, createMyInvite, fetchMyInvite, rotateMyInvite } from "../account-api";
import { inviteLink, shareInviteLink, type ShareOutcome } from "./invite-link";

const BUTTON = "h-10 flex-none whitespace-nowrap rounded-button bg-blue px-4 text-body font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const GHOST = "h-10 flex-none whitespace-nowrap rounded-button bg-surface-2 px-4 text-body font-medium text-ink transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const dateOf = (iso: string, language: string) =>
  new Date(iso).toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" });

/**
 * 服务端对生成 / 更换的拒绝(403 Not eligible、409 没有码 / 需先更换)只带 error 文案,原因要重新读取状态才拿得到,
 * 所以面板在这两种情况下重读 GET,以服务端当前状态为准。
 */
const isStateRefusal = (err: unknown) => err instanceof ApiError && (err.status === 403 || err.status === 409);

/**
 * 「我的邀请码」面板(W2 / W-fix)。形状与服务端 `user_invites.view` 一致。码只在本人页面显示,不写入任何存储;
 * 分享链接只用 `#` 片段(X27)。组件只经 account-api 与 ApiClient 通信,不直接 fetch。
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
      if (isStateRefusal(err)) {
        setConfirming(false);
        try {
          setStatus(await fetchMyInvite(api));
        } catch (readErr) {
          setError(readErr);
        }
      } else {
        setError(err);
      }
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

  const replaceProps = (uses: number, cap: number) => ({
    uses,
    cap,
    busy,
    confirming,
    onAsk: () => { setNote(null); setConfirming(true); },
    onCancel: () => setConfirming(false),
    onConfirm: () => run(() => rotateMyInvite(api), () => {
      setConfirming(false);
      setNote(t("web.account.invite.replaced"));
    }),
  });

  const errorText = error ? errorMessageFor(t, error) : null;
  const eligible = status?.eligible === true;

  return (
    <SectionGroup title={t("web.account.invite.title")} className="mt-4">
      <div className="space-y-3 px-3.5 py-2.5">
        {errorText ? <p role="alert" className="text-sub text-destructive">{errorText}</p> : null}
        {status === null && !errorText ? <p aria-busy="true" className="text-meta text-ink-2">{t("web.account.invite.loading")}</p> : null}
        {status !== null && !status.eligible ? <IneligibleNote reason={status.reason} availableAt={status.availableAt} /> : null}

        {status && eligible && status.reason === "rotate_required" ? (
          <div className="space-y-3">
            <p data-testid="my-invite-reason" className="text-sub text-ink-2">{t("web.account.invite.rotateRequired")}</p>
            <ReplaceControl {...replaceProps(status.uses, status.cap)} />
          </div>
        ) : null}

        {status && eligible && status.reason !== "rotate_required" && !status.code ? (
          <div className="space-y-2">
            <p className="text-meta text-ink-2">{t("web.account.invite.createHint")}</p>
            <button type="button" disabled={busy} onClick={() => run(() => createMyInvite(api))} className={BUTTON}>
              {t("web.account.invite.create")}
            </button>
          </div>
        ) : null}

        {status && eligible && status.code ? (
          <CodeBlock
            code={status.code}
            status={status}
            busy={busy}
            note={note}
            language={i18n.language}
            onCopy={() => copyLink(status.code as string)}
            onShare={() => share(status.code as string)}
            replace={replaceProps(status.uses, status.cap)}
          />
        ) : null}
      </div>
    </SectionGroup>
  );
}

/** 按服务端文案取提示;429 是每日操作预算用尽,单独说明。 */
function errorMessageFor(t: TFunction, err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return t("web.account.invite.rateLimited");
  return translateServerError(t, err, ACCOUNT_ERROR_KEYS);
}

function IneligibleNote({ reason, availableAt }: { reason: MyInviteReason | null; availableAt: string | null }) {
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

interface ReplaceProps {
  uses: number;
  cap: number;
  busy: boolean;
  confirming: boolean;
  onAsk(): void;
  onCancel(): void;
  onConfirm(): void;
}

/** 更换:先显示确认框(说明旧码立即失效、新码继承已用次数),确认后才发请求。 */
function ReplaceControl({ uses, cap, busy, confirming, onAsk, onCancel, onConfirm }: ReplaceProps) {
  const { t } = useTranslation();
  if (!confirming) {
    return <button type="button" onClick={onAsk} disabled={busy} className={GHOST}>{t("web.account.invite.replace")}</button>;
  }
  return (
    <div data-testid="my-invite-confirm" role="group" className="space-y-2 rounded-button bg-surface-2 p-3">
      <p className="text-sub text-ink">{t("web.account.invite.replaceConfirm", { uses, cap })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={GHOST}>{t("web.account.invite.cancel")}</button>
        <button type="button" onClick={onConfirm} disabled={busy} className={BUTTON}>{t("web.account.invite.replaceButton")}</button>
      </div>
    </div>
  );
}

function CodeBlock({ code, status, busy, note, language, onCopy, onShare, replace }: {
  code: string;
  status: MyInvite;
  busy: boolean;
  note: string | null;
  language: string;
  onCopy(): void;
  onShare(): void;
  replace: ReplaceProps;
}) {
  const { t } = useTranslation();
  const usedUp = status.uses >= status.cap;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-meta text-ink-2">{t("web.account.invite.yourCode")}</p>
        <p data-testid="my-invite-code" className="num select-all whitespace-nowrap font-mono text-title font-semibold tracking-wider text-ink">
          {code}
        </p>
        <p data-testid="my-invite-usage" className="text-meta text-ink-2">{t("web.account.invite.usage", { uses: status.uses, cap: status.cap })}</p>
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
        {status.invitees.length === 0 ? (
          <p className="text-meta text-ink-2">{t("web.account.invite.noInvitees")}</p>
        ) : (
          <ul data-testid="my-invite-invitees" className="mt-1 space-y-1">
            {status.invitees.map((invitee) => (
              <li key={`${invitee.displayName}-${invitee.joinedAt}`} className="flex items-baseline justify-between gap-3 text-sub text-ink">
                <span className="min-w-0 truncate">{invitee.displayName}</span>
                <span className="flex-none whitespace-nowrap text-meta text-ink-2">{dateOf(invitee.joinedAt, language)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ReplaceControl {...replace} />
    </div>
  );
}
