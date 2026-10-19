import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../../components/dialog";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { createInviteBatch, type Invite } from "./api";
import { buildInviteCsv, downloadCsv } from "./csv";
import { S } from "./strings";

const F = S.invites.batchForm;
const R = S.invites.batchResult;
const MAX_COUNT = 100;
// 稳定的空回调:Dialog 的焦点副作用依赖 onClose 的identity,每次渲染都换新函数会把焦点拉回第一个输入框。
const noop = () => undefined;

/**
 * 批量新建一次性邀请码(R-I10)。明文码只放在这个组件的状态里:关闭即清空,不写入存储、不进 URL、不打日志。
 * CSV(code,label,expires_at)在浏览器里生成并下载;服务端从不导出码。
 */
export function BatchInviteDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (invites: Invite[]) => void;
}) {
  const [count, setCount] = useState("10");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ codes: string[]; invites: Invite[] } | null>(null);

  useEffect(() => {
    if (open) {
      setCount("10");
      setLabel("");
      setExpires("");
      setError(null);
      setBusy(false);
      setResult(null);
    }
  }, [open]);

  const close = useCallback(() => {
    setResult(null); // 明文码离开内存
    onClose();
  }, [onClose]);

  const submit = async () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
      setError(F.invalidCount);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await createInviteBatch({ count: n, label: label.trim(), expiresAt: expires ? new Date(expires).toISOString() : null });
      setResult({ codes: r.codes, invites: r.invites });
      onCreated(r.invites);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const rows = result.codes.map((code, i) => ({ code, label: result.invites[i]?.label ?? "", expiresAt: result.invites[i]?.expiresAt ?? null }));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadCsv(`invite-codes-${stamp}.csv`, buildInviteCsv(rows));
  };

  if (!open) return null;
  if (result !== null) {
    return (
      <Dialog
        open
        title={R.title(result.codes.length)}
        onClose={noop}
        footer={
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={download}>{R.download}</button>
            <button type="button" className="btn-primary btn-sm" onClick={close}>{R.close}</button>
          </>
        }
      >
        <p className="leading-relaxed text-fg-2">{R.once}</p>
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line bg-sunken px-3 py-2">
          {result.codes.map((code) => (
            <li key={code}>
              <code className="num select-all text-md font-semibold tracking-wide">{code}</code>
            </li>
          ))}
        </ul>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      title={F.title}
      onClose={busy ? noop : close}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={close} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={busy}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {F.submit}
          </button>
        </>
      }
    >
      <p className="text-sm text-fg-2">{F.hint}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{F.count}</span>
        <input className="field-sm num" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{F.label}</span>
        <input className="field-sm" maxLength={64} value={label} placeholder={F.labelHint} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{F.expires}</span>
        <input className="field-sm" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
