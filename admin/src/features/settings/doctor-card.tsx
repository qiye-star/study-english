import { useState } from "react";
import { StatusDot } from "../../components/status-dot";
import type { Finding } from "./api";
import { S } from "./strings";

/** 配置诊断(spec §3.10):error/warn 计数,第一条摘要;可展开全部。 */
export function DoctorCard({ findings, error }: { findings: Finding[] | null; error?: string | null }) {
  const [open, setOpen] = useState(false);
  const errors = findings?.filter((f) => f.level === "error").length ?? 0;
  const warns = findings?.filter((f) => f.level === "warn").length ?? 0;
  const first = findings?.find((f) => f.level !== "info") ?? findings?.[0];
  const tone = errors ? "bad" : warns ? "warn" : "good";
  return (
    <section aria-label={S.doctorTitle} className="panel flex-1 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="pt-1">
          <StatusDot tone={findings ? tone : "neutral"} />
        </div>
        <div className="min-w-0 flex-1">
          <b className="text-sm font-semibold">
            {S.doctorTitle} · {findings ? S.doctorSummary(errors, warns) : error ?? "…"}
          </b>
          {!open && first && <p className="mt-0.5 truncate text-xs text-fg-2">{first.message}</p>}
        </div>
        {findings && findings.length > 0 && (
          <button type="button" className="btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? S.doctorCollapse : S.doctorExpand}
          </button>
        )}
      </div>
      {open && findings && (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {findings.map((f) => (
            <li key={f.code} className="flex items-start gap-2 text-xs">
              <StatusDot tone={f.level === "error" ? "bad" : f.level === "warn" ? "warn" : "neutral"} label={S.doctorLevel[f.level]} />
              <span className="flex-1">
                {f.message}
                {f.keys.length > 0 && <span className="ml-1 font-mono text-fg-2">{f.keys.map((k) => k.toUpperCase()).join(", ")}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
