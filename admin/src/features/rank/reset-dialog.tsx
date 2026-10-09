import { useEffect, useState } from "react";
import { MIN_REASON } from "../../components/confirm-dialog";
import { Dialog } from "../../components/dialog";
import { LockIcon, SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { S, TIER_KEYS, divisionLabel, tierName } from "./strings";

const DEFAULT_RP = [100, 100, 120, 140, 160, 200, 200];
const MASTER = 6;

export interface ResetBody {
  tier: number;
  division: number;
  rp: number;
  reason: string;
}

/** 重置段位 / 定级(operator + 二次验证;二次验证由客户端在 403 时自动弹出)。默认青铜 III 0 点。 */
export function ResetDialog({
  open,
  current,
  divisionRps,
  onSubmit,
  onClose,
}: {
  open: boolean;
  current: string;
  divisionRps?: number[];
  onSubmit: (body: ResetBody) => Promise<void>;
  onClose: () => void;
}) {
  const [tier, setTier] = useState(0);
  const [division, setDivision] = useState(3);
  const [rp, setRp] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTier(0);
      setDivision(3);
      setRp("0");
      setReason("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const size = (divisionRps ?? DEFAULT_RP)[tier] ?? 100;
  const max = tier === MASTER ? size - 1 : division === 1 ? size : size - 1;
  const points = Number(rp);
  const rpOk = rp.trim() !== "" && Number.isInteger(points) && points >= 0 && points <= max;
  const ok = rpOk && reason.trim().length >= MIN_REASON && !busy;

  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ tier, division: tier === MASTER ? 0 : division, rp: points, reason: reason.trim() });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={S.reset.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={!ok} onClick={submit}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {Shell.dialogs.confirm}
          </button>
        </>
      }
    >
      <p className="text-xs text-fg-2">{current}</p>
      <div className="grid grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.reset.tier}</span>
          <select className="field-sm" value={TIER_KEYS[tier]} onChange={(e) => setTier(TIER_KEYS.indexOf(e.target.value as (typeof TIER_KEYS)[number]))}>
            {TIER_KEYS.map((k) => (
              <option key={k} value={k}>
                {tierName(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.reset.division}</span>
          <select className="field-sm" value={tier === MASTER ? 0 : division} disabled={tier === MASTER} onChange={(e) => setDivision(Number(e.target.value))}>
            {tier === MASTER ? (
              <option value={0}>—</option>
            ) : (
              [3, 2, 1].map((d) => (
                <option key={d} value={d}>
                  {divisionLabel(d)}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.reset.rp(max)}</span>
          <input type="number" className={`field-sm num ${rpOk ? "" : "border-bad"}`} value={rp} min={0} max={max} onChange={(e) => setRp(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{Shell.dialogs.reason}</span>
        <textarea
          className="field-sm h-auto min-h-[64px] py-2"
          value={reason}
          maxLength={200}
          placeholder={Shell.dialogs.reasonHint}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="text-xs text-fg-2">{S.reset.snapshot}</p>
      <p className="flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg">
        <LockIcon width={14} height={14} className="shrink-0 text-fg-2" />
        {S.reset.stepUp}
      </p>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
