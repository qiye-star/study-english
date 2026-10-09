import { useState, type FormEvent } from "react";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { changePassword, type MySecurity } from "./api";
import { MIN_PASSWORD } from "./create-account-dialog";
import { S } from "./strings";

/** 修改本人密码:成功后服务端撤销本账号的其他会话。应急账号只能改 .env。 */
export function PasswordCard({ me }: { me: MySecurity }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mismatch = repeat !== "" && repeat !== next;
  const ok = current !== "" && next.length >= MIN_PASSWORD && next === repeat && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={S.changePassword} className="panel space-y-3 px-4 pb-4">
      <div className="panel-head px-0">
        <h2 className="text-md font-semibold">{S.changePassword}</h2>
      </div>
      {me.env ? (
        <p className="text-sm text-fg-2">{S.envPassword}</p>
      ) : (
        <form className="grid max-w-[420px] gap-3" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-2">{S.currentPassword}</span>
            <input className="field-sm" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-2">{S.nextPassword}</span>
            <input className="field-sm" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-2">{S.repeatPassword}</span>
            <input className="field-sm" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </label>
          {mismatch && <p className="-mt-2 text-2xs text-bad">{S.mismatch}</p>}
          <div>
            <button type="submit" className="btn-primary btn-sm" disabled={!ok}>
              {busy && <SpinnerIcon width={14} height={14} />}
              {S.submitPassword}
            </button>
          </div>
          {done && <p role="status" className="text-sm text-good">{S.passwordChanged}</p>}
          {error && (
            <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
