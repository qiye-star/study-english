import { S } from "../strings";
import { ApplyBadge, type Apply } from "./apply-badge";
import { LockIcon } from "./icons";

/** 密钥只以 `{set, fp}` 出现(服务端从不返回明文) */
export type SecretState = { set: boolean; fp: string };
export type DiffValue = string | number | boolean | null | SecretState;

export interface DiffRow {
  key: string;
  label: string;
  before: DiffValue;
  after: DiffValue;
  /** 危险说明(注册表 `danger`),显示在行下方 */
  danger?: string;
  apply?: Apply;
}

function isSecret(v: DiffValue): v is SecretState {
  return typeof v === "object" && v !== null && "set" in v;
}

export function formatDiffValue(v: DiffValue): string {
  if (isSecret(v)) return v.set ? `${S.diff.set} · ${v.fp}` : S.diff.unset;
  if (v === null || v === "") return S.diff.empty;
  if (typeof v === "boolean") return v ? S.diff.on : S.diff.off;
  return String(v);
}

function Cell({ value, changed }: { value: DiffValue; changed?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 break-all ${typeof value === "number" ? "num" : ""} ${changed ? "font-medium text-fg" : "text-fg-2"}`}>
      {isSecret(value) && <LockIcon width={13} height={13} className="shrink-0 text-fg-2" />}
      {formatDiffValue(value)}
    </span>
  );
}

/** 保存前差异(spec §3.8):旧 → 新;密钥行显示"已设置 · 指纹"。 */
export function DiffTable({ rows }: { rows: DiffRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-2xs text-fg-2">
          <th className="border-b border-line py-1.5 pr-3 font-medium">{S.diff.key}</th>
          <th className="border-b border-line py-1.5 pr-3 font-medium">{S.diff.before}</th>
          <th className="border-b border-line py-1.5 font-medium">{S.diff.after}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="align-top">
            <td className="border-b border-line py-2 pr-3">
              <div className="font-medium text-fg">{r.label}</div>
              <div className="font-mono text-2xs text-fg-2">{r.key.toUpperCase()}</div>
              {r.apply && (
                <div className="mt-1">
                  <ApplyBadge apply={r.apply} />
                </div>
              )}
              {r.danger && <p className="mt-1 text-xs text-bad">{r.danger}</p>}
            </td>
            <td className="border-b border-line py-2 pr-3">
              <Cell value={r.before} />
            </td>
            <td className="border-b border-line py-2">
              <Cell value={r.after} changed />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
