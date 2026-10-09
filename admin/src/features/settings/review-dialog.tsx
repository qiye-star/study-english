import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { DiffTable, type DiffRow } from "../../components/diff-table";
import { Dialog } from "../../components/dialog";
import { MIN_REASON } from "../../components/confirm-dialog";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { saveSettings, type SaveResult, type SettingItem } from "./api";
import { confirmPhrase, dangerOf, diffValues, managedErrorText, type Draft } from "./model";
import { S } from "./strings";

/**
 * 保存前检查(spec §3.8、视觉稿第 2 屏):差异表是唯一的保存入口。危险项要理由(≥ 4 字)+ 输入确认短语;
 * 改主机未带新密钥时服务端回 409,这里出现必须勾选的"我确认把现有密钥发送到 {host}"。
 * 403 Step-up required 由 API 客户端弹出二次验证并重放。
 */
export function ReviewDialog({
  items,
  draft,
  onSaved,
  onClose,
}: {
  items: SettingItem[];
  draft: Draft;
  onSaved: (result: SaveResult) => void;
  onClose: () => void;
}) {
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const entries = Object.entries(draft).filter(([k]) => byKey.has(k));
  const dangerKeys = entries.filter(([k, v]) => dangerOf(byKey.get(k)!, v)).map(([k]) => k);
  const [serverPhrase, setServerPhrase] = useState<string | null>(null);
  const phrase = serverPhrase ?? (dangerKeys.length ? confirmPhrase([...dangerKeys].sort()) : null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [pairs, setPairs] = useState<{ key: string; host: string }[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows: DiffRow[] = entries.map(([key, value]) => {
    const item = byKey.get(key)!;
    const { before, after } = diffValues(item, value);
    return { key, label: item.label, before, after, danger: dangerOf(item, value) ?? undefined, apply: item.apply };
  });

  const needsReason = phrase !== null;
  const canSave =
    !busy &&
    entries.length > 0 &&
    (!needsReason || reason.trim().length >= MIN_REASON) &&
    (!phrase || typed.trim() === phrase) &&
    pairs.every((p) => checked[p.key]);

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setFields(null);
    try {
      const result = await saveSettings({
        changes: Object.fromEntries(entries),
        reason: reason.trim(),
        confirm: phrase ? typed.trim() : null,
        confirmPairs: pairs.filter((p) => checked[p.key]).map((p) => p.key),
      });
      onSaved(result);
    } catch (e) {
      const details = e instanceof ApiError ? e.details : undefined;
      const managed = managedErrorText(e);
      if (managed) {
        setError(managed);
      } else if (e instanceof ApiError && e.status === 409 && details && Array.isArray(details.pairs)) {
        const hosts = (details.hosts ?? {}) as Record<string, string>;
        setPairs((details.pairs as string[]).map((key) => ({ key, host: hosts[key] ?? "" })));
      } else if (e instanceof ApiError && e.status === 409 && details && typeof details.confirm === "string") {
        setServerPhrase(details.confirm);
        setError(S.dangerTitle);
      } else if (e instanceof ApiError && e.fields) {
        setFields(e.fields);
        setError(e.message);
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={S.reviewTitle}
      width={820}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {S.back}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={save} disabled={!canSave}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {S.save}
          </button>
        </>
      }
    >
      <p className="text-xs text-fg-2">{S.reviewSubtitle(entries.length)}</p>
      <DiffTable rows={rows} />
      {dangerKeys.length > 0 && (
        <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
          <b className="font-semibold">{S.dangerTitle}</b> · {S.stepUpNote}
        </p>
      )}
      {pairs.length > 0 && (
        <div className="space-y-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs">
          <p className="text-warn">{S.pairTitle}</p>
          {pairs.map((p) => (
            <label key={p.key} className="flex items-center gap-2 text-fg">
              <input type="checkbox" checked={!!checked[p.key]} onChange={(e) => setChecked((c) => ({ ...c, [p.key]: e.target.checked }))} />
              <span>{S.pairConfirm(p.host)}</span>
            </label>
          ))}
        </div>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{needsReason ? Shell.dialogs.reason : S.reasonOptional}</span>
        <textarea
          className="field-sm h-auto min-h-[56px] py-2"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder={Shell.dialogs.reasonHint}
        />
      </label>
      {phrase && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{Shell.dialogs.typeToConfirm(phrase)}</span>
          <input className="field-sm font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
          <p>{error}</p>
          {fields && (
            <ul className="mt-1 list-disc pl-4">
              {Object.entries(fields).map(([k, msg]) => (
                <li key={k}>
                  <span className="font-mono">{k === "_" ? "" : k.toUpperCase()}</span> {msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
