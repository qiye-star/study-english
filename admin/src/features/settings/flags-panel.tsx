import { StatusDot } from "../../components/status-dot";
import type { Finding, Scalar, SettingItem } from "./api";
import type { OnDraft } from "./setting-row";
import { S } from "./strings";

/** 功能开关 → 诊断里表示"开着但不可用"的 code */
export const FLAG_FINDINGS: Record<string, string> = {
  realtime_enabled: "realtime_unavailable",
  rank_enabled: "rank_match_unavailable",
  rooms_enabled: "rooms_ai_unavailable",
};

/** features 分组顶部的三张开关卡:开关、可用/不可用(原因来自诊断 keys)、关闭影响。 */
export function FlagsPanel({
  items,
  draft = {},
  findings = [],
  onDraft,
  readOnly = false,
}: {
  items: SettingItem[];
  draft?: Record<string, Scalar>;
  findings?: Finding[];
  onDraft: OnDraft;
  readOnly?: boolean;
}) {
  const flags = Object.keys(FLAG_FINDINGS)
    .map((key) => items.find((i) => i.key === key))
    .filter((i): i is SettingItem => !!i);
  if (flags.length === 0) return null;
  return (
    <section aria-label={S.flagsTitle} className="grid grid-cols-3 gap-3 border-b border-line p-4">
      {flags.map((item) => {
        const on = (item.key in draft ? draft[item.key] : item.effective) === true;
        const finding = findings.find((f) => f.code === FLAG_FINDINGS[item.key]);
        const tone = !on ? "neutral" : finding ? "bad" : "good";
        const state = !on ? S.flagState.off : finding ? S.flagState.unavailable : S.flagState.available;
        return (
          <div key={item.key} data-testid={`flag-${item.key}`} className={`rounded-xl border p-3 ${item.key in draft ? "border-accent" : "border-line"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{item.label}</span>
              <input
                type="checkbox"
                role="switch"
                aria-label={item.label}
                checked={on}
                disabled={readOnly || item.envOnly}
                onChange={(e) => onDraft(item.key, e.target.checked === item.effective ? undefined : e.target.checked)}
              />
            </div>
            <div className="mt-1 font-mono text-2xs text-fg-2">{item.env}</div>
            <div className="mt-2 text-xs">
              <StatusDot tone={tone} label={state} />
            </div>
            {on && finding && <p className="mt-1 text-xs text-bad">{S.missing(finding.keys.map((k) => k.toUpperCase()).join("、"))}</p>}
            <p className="mt-2 text-2xs text-fg-2">{S.flagOffImpact[item.key]}</p>
          </div>
        );
      })}
    </section>
  );
}
