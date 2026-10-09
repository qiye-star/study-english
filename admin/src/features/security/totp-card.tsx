import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { SpinnerIcon } from "../../components/icons";
import { StatusDot } from "../../components/status-dot";
import { errorText } from "../../hooks/use-async";
import { beginTotp, confirmTotp, disableTotp, type MySecurity, type TotpEnrolment } from "./api";
import { S } from "./strings";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      /* 剪贴板不可用:用户可手动选择文本 */
    }
  };
  return (
    <button type="button" className="btn-ghost btn-sm" onClick={copy}>
      {done ? S.copied : S.copy}
    </button>
  );
}

/** 两步验证(spec §4.6):开始绑定 → 密钥与 otpauth URI(v2 不渲染二维码)→ 验证码 → 8 个恢复码只显示一次。 */
export function TotpCard({ me, onChanged }: { me: MySecurity; onChanged: () => void }) {
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => setEnrolment(await beginTotp()));
  const confirm = () =>
    run(async () => {
      if (!enrolment) return;
      setCodes(await confirmTotp(enrolment.enrolment, code.trim()));
      setEnrolment(null);
      setCode("");
    });

  let body;
  if (codes) {
    body = (
      <div className="space-y-2">
        <p className="text-sm font-semibold">{S.recoveryTitle}</p>
        <p className="text-xs text-fg-2">{S.recoveryHint}</p>
        <ul aria-label={S.recoveryTitle} className="grid grid-cols-2 gap-1.5 rounded-lg bg-sunken p-3 font-mono text-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <CopyButton text={codes.join("\n")} />
          <button type="button" className="btn-primary btn-sm" onClick={() => { setCodes(null); onChanged(); }}>
            {S.saved}
          </button>
        </div>
      </div>
    );
  } else if (me.env) {
    body = (
      <p className="text-sm text-fg-2">
        <StatusDot tone={me.totpEnabled ? "good" : "neutral"} label={me.totpEnabled ? S.totpEnabled : S.totpDisabledState} /> · {S.envTotp}
      </p>
    );
  } else if (me.totpEnabled) {
    body = (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusDot tone="good" label={S.totpEnabled} />
        {me.recoveryCodesLeft !== null && <span className="num text-xs text-fg-2">{S.codesLeft(me.recoveryCodesLeft)}</span>}
        <span className="flex-1" />
        <button type="button" className="btn-danger btn-sm" onClick={() => setUnbinding(true)}>
          {S.unbind}
        </button>
      </div>
    );
  } else if (!me.encryption) {
    body = <p className="text-sm text-warn">{S.needEncryption}</p>;
  } else if (enrolment) {
    body = (
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-fg-2">{S.secretLabel}</p>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-sunken px-2 py-1 font-mono text-sm">{enrolment.secret}</code>
            <CopyButton text={enrolment.secret} />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-fg-2">{S.uriLabel}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-sunken px-2 py-1 font-mono text-xs">{enrolment.uri}</code>
            <CopyButton text={enrolment.uri} />
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.code}</span>
          <input
            className="field-sm num w-[160px]"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={8}
          />
        </label>
        <button type="button" className="btn-primary btn-sm" disabled={busy || code.trim().length < 6} onClick={confirm}>
          {busy && <SpinnerIcon width={14} height={14} />}
          {S.confirm}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="flex items-center gap-3 text-sm">
        <StatusDot tone={me.requireTotp ? "warn" : "neutral"} label={S.totpDisabledState} />
        {me.requireTotp && <span className="text-xs text-warn">{S.totpRequired}</span>}
        <span className="flex-1" />
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={start}>
          {S.begin}
        </button>
      </div>
    );
  }

  return (
    <section aria-label={S.totp} className="panel space-y-3 px-4 pb-4">
      <div className="panel-head px-0">
        <h2 className="text-md font-semibold">{S.totp}</h2>
      </div>
      {body}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={unbinding}
        title={S.unbindTitle}
        body={S.unbindBody}
        danger
        confirmText={S.unbind}
        onConfirm={async () => {
          await disableTotp();
          setUnbinding(false);
          onChanged();
        }}
        onClose={() => setUnbinding(false)}
      />
    </section>
  );
}
