import { Fragment } from "react";
import { DiffTable, type DiffRow, type DiffValue } from "../../components/diff-table";
import { formatDateTime } from "../../lib/format";
import { S as Shell } from "../../strings";
import type { AuditItem } from "./api";
import { S } from "./strings";

const RESULT_TONE: Record<string, string> = {
  ok: "bg-sunken text-fg-2 ring-1 ring-inset ring-line",
  denied: "bg-warn-soft text-warn",
  error: "bg-bad-soft text-bad",
};

function asDiffValue(v: unknown): DiffValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object" && "set" in (v as object) && "fp" in (v as object)) {
    const s = v as { set: unknown; fp: unknown };
    return { set: !!s.set, fp: String(s.fp ?? "") }; // 密钥只有指纹
  }
  return JSON.stringify(v);
}

/** before/after(已脱敏)→ 差异行;非对象的 before/after 作为单行显示。 */
export function diffRows(before: unknown, after: unknown): DiffRow[] {
  const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !("set" in (v as object) && "fp" in (v as object));
  if (before === null && after === null) return [];
  if ((before === null || isMap(before)) && (after === null || isMap(after))) {
    const b = (before ?? {}) as Record<string, unknown>;
    const a = (after ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
    return keys.map((k) => ({ key: k, label: k, before: asDiffValue(b[k]), after: asDiffValue(a[k]) }));
  }
  return [{ key: "value", label: "value", before: asDiffValue(before), after: asDiffValue(after) }];
}

/** 一条审计:时间、操作人+角色、动作、对象、摘要、结果徽标;展开显示 before → after 与理由。 */
export function AuditRow({ item, open, onToggle }: { item: AuditItem; open: boolean; onToggle: () => void }) {
  const rows = open ? diffRows(item.before, item.after) : [];
  return (
    <Fragment>
      <tr data-testid={`audit-${item.id}`} className="cursor-pointer hover:bg-sunken" onClick={onToggle}>
        <td className="num whitespace-nowrap border-b border-line px-3 py-2.5 text-fg-2">{formatDateTime(item.at)}</td>
        <td className="border-b border-line px-3 py-2.5">
          <span className="font-mono">{item.actor}</span>
          <span className="ml-1.5 text-2xs text-fg-2">{Shell.shell.roles[item.role] ?? item.role}</span>
        </td>
        <td className="border-b border-line px-3 py-2.5 font-mono text-xs">{item.action}</td>
        <td className="max-w-[200px] truncate border-b border-line px-3 py-2.5 text-xs text-fg-2">
          {[item.targetType, item.targetId].filter(Boolean).join(" · ")}
        </td>
        <td className="max-w-[260px] truncate border-b border-line px-3 py-2.5 text-xs">{item.summary}</td>
        <td className="border-b border-line px-3 py-2.5">
          <span className={`badge ${RESULT_TONE[item.result] ?? RESULT_TONE.ok}`}>{S.result[item.result] ?? item.result}</span>
        </td>
        <td className="border-b border-line px-3 py-2.5 text-right">
          <button
            type="button"
            className="btn-quiet btn-sm"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {open ? S.collapse : S.expand}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="border-b border-line bg-sunken/50 px-5 py-3">
            <div className="space-y-2 text-xs">
              {rows.length > 0 ? <DiffTable rows={rows} /> : <p className="text-fg-2">{S.noDiff}</p>}
              {item.reason && (
                <p>
                  <span className="text-fg-2">{S.reason}:</span>
                  {item.reason}
                </p>
              )}
              <p className="text-fg-2">
                {S.ip} <span className="num">{item.ip}</span> · #{item.id}
              </p>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
