import { useId } from "react";
import { formatBytes, formatDuration } from "../../lib/format";
import type { Mode, PlanRow } from "./package-model";
import { S } from "./strings";

/** 预览:总数 / 总大小 / 各类别计数、「已存在」的跳过 / 覆盖选择、逐条列表(勾选框)。 */
export function PackagePreview({
  rows, mode, onMode, selected, onToggle, disabled,
}: {
  rows: PlanRow[];
  mode: Mode;
  onMode: (m: Mode) => void;
  selected: Set<string>;
  onToggle: (md5: string, on: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  const counts: Record<string, number> = { new: 0, exists: 0, published: 0, resumable: 0, busy: 0, skip_local: 0 };
  let bytes = 0;
  for (const r of rows) {
    counts[r.category]++;
    bytes += r.item.mediaBytes;
  }
  const staleFailed = rows.some((r) => r.category === "new" && r.staleFailed);
  return (
    <div className="space-y-3">
      <p className="num text-sm text-fg">{S.package.summary(rows.length, formatBytes(bytes))}</p>
      <p className="num text-xs text-fg-2">{S.package.counts(counts)}</p>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-fg-2">{S.package.modeLegend}</legend>
        <div role="radiogroup" aria-label={S.package.modeLegend} data-testid="package-existing-mode" className="flex gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name={`${id}-mode`} value="skip" checked={mode === "skip"} disabled={disabled} onChange={() => onMode("skip")} />
            {S.package.modeSkip}
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name={`${id}-mode`} value="overwrite" checked={mode === "overwrite"} disabled={disabled} onChange={() => onMode("overwrite")} />
            {S.package.modeOverwrite}
          </label>
        </div>
      </fieldset>
      {mode === "overwrite" && <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-fg-2">{S.package.overwriteNote}</p>}
      {staleFailed && <p className="text-xs text-warn">{S.package.staleFailed}</p>}
      <div className="max-h-[40vh] overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-fg-2">
            <tr>
              <th className="px-2 py-1.5 font-medium">{S.package.cols.pick}</th>
              <th className="px-2 py-1.5 font-medium">{S.package.cols.title}</th>
              <th className="px-2 py-1.5 font-medium">{S.package.cols.language}</th>
              <th className="px-2 py-1.5 text-right font-medium">{S.package.cols.duration}</th>
              <th className="px-2 py-1.5 text-right font-medium">{S.package.cols.size}</th>
              <th className="px-2 py-1.5 font-medium">{S.package.cols.category}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const md5 = r.item.sourceMd5;
              const label = r.item.title || md5;
              return (
                <tr key={md5} className="border-t border-line align-top">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={selected.has(md5)}
                      disabled={disabled || !r.importable}
                      onChange={(e) => onToggle(md5, e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block font-medium">{label}</span>
                    {r.item.nonEnglish && <span className="badge bg-warn-soft text-warn">{S.package.nonEnglish}</span>}
                  </td>
                  <td className="num px-2 py-1.5 text-fg-2">{r.item.language ?? "—"}</td>
                  <td className="num px-2 py-1.5 text-right">{r.item.durationMs === null ? "—" : formatDuration(r.item.durationMs)}</td>
                  <td className="num px-2 py-1.5 text-right">{formatBytes(r.item.mediaBytes)}</td>
                  <td className="px-2 py-1.5">
                    <span>{S.package.categories[r.category]}</span>
                    {r.reason && <span className="block text-2xs text-muted">{reasonText(r)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function reasonText(r: PlanRow): string {
  if (r.category === "skip_local" && r.item.skip) return S.package.itemSkip[r.item.skip] ?? r.item.skip;
  return r.reason ?? "";
}
