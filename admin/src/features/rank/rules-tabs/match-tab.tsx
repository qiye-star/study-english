import { NumField, PctField, Section, isChanged, type TabProps } from "../fields";
import { MATCH_TIERS, WEIGHT_KEYS, pct, weightsTotal } from "../rules-schema";
import { DIMENSIONS, S, tierName } from "../strings";

function WeightRow({ label, ratio, onRatio, disabled, changed }: { label: string; ratio: number; onRatio: (r: number) => void; disabled: boolean; changed: boolean }) {
  const width = Number.isFinite(ratio) ? Math.max(0, Math.min(100, pct(ratio))) : 0;
  return (
    <div className="grid grid-cols-[88px_1fr_88px] items-center gap-3">
      <span className="text-sm">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      <PctField hideLabel label={S.matchTab.weightLabel(label)} ratio={ratio} onRatio={onRatio} range="weight_pct" disabled={disabled} changed={changed} />
    </div>
  );
}

export function MatchTab({ rules, base, edit, disabled }: TabProps) {
  const m = rules.match;
  const total = weightsTotal(rules);
  const field = <K extends "borderline" | "gate_task_min" | "min_seconds" | "max_seconds" | "daily_attempts" | "cooldown_minutes" | "match_minutes">(
    key: K,
  ) => (
    <NumField
      label={S.matchTab[key]}
      value={m[key]}
      range={key}
      disabled={disabled}
      changed={isChanged(rules, base, `match.${key}`)}
      onChange={(v) => edit((d) => void (d.match[key] = v))}
    />
  );
  return (
    <div className="space-y-6">
      <Section title={S.matchTab.table} hint={S.matchTab.tableHint}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-2xs text-fg-2">
              <th className="border-b border-line py-1.5 pr-3 font-medium">{S.matchTab.targetTier}</th>
              {MATCH_TIERS.map((t) => (
                <th key={t} className="border-b border-line px-2 py-1.5 font-medium">
                  {tierName(Number(t))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["turns", "thresholds"] as const).map((row) => (
              <tr key={row}>
                <td className="py-1.5 pr-3 text-fg-2">{row === "turns" ? S.matchTab.turns : S.matchTab.threshold}</td>
                {MATCH_TIERS.map((t) => (
                  <td key={t} className="px-2 py-1.5">
                    <NumField
                      hideLabel
                      label={row === "turns" ? S.matchTab.turnsOf(tierName(Number(t))) : S.matchTab.thresholdOf(tierName(Number(t)))}
                      value={m[row][t]}
                      range={row === "turns" ? "turns" : "threshold"}
                      disabled={disabled}
                      changed={isChanged(rules, base, `match.${row}.${t}`)}
                      onChange={(v) => edit((d) => void (d.match[row][t] = v))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <div className="grid grid-cols-2 gap-6">
        <Section
          title={S.matchTab.weights}
          hint={
            total === 100 ? (
              <span className="num text-fg">{S.weightsOk(total)}</span>
            ) : (
              <span role="alert" className="num font-medium text-bad">
                {S.weightsTotal(total)}
              </span>
            )
          }
        >
          <div className="space-y-2">
            {WEIGHT_KEYS.map((k) => (
              <WeightRow
                key={k}
                label={DIMENSIONS[k]}
                ratio={m.llm_weights[k]}
                disabled={disabled}
                changed={isChanged(rules, base, `match.llm_weights.${k}`)}
                onRatio={(r) => edit((d) => void (d.match.llm_weights[k] = r))}
              />
            ))}
            <WeightRow
              label={DIMENSIONS.speech}
              ratio={m.speech_weight}
              disabled={disabled}
              changed={isChanged(rules, base, "match.speech_weight")}
              onRatio={(r) => edit((d) => void (d.match.speech_weight = r))}
            />
          </div>
        </Section>
        <Section title={S.matchTab.gates}>
          <div className="grid grid-cols-2 gap-3">
            {field("gate_task_min")}
            <PctField
              label={S.matchTab.gate_english_ratio}
              ratio={m.gate_english_ratio}
              range="gate_english_pct"
              disabled={disabled}
              changed={isChanged(rules, base, "match.gate_english_ratio")}
              onRatio={(r) => edit((d) => void (d.match.gate_english_ratio = r))}
            />
            {field("min_seconds")}
            {field("max_seconds")}
            {field("borderline")}
          </div>
        </Section>
      </div>
      <Section title={S.matchTab.limits}>
        <div className="grid grid-cols-4 gap-3">
          {field("daily_attempts")}
          {field("cooldown_minutes")}
          {field("match_minutes")}
          <PctField
            label={S.matchTab.fail_keep}
            ratio={m.fail_keep}
            range="fail_keep_pct"
            disabled={disabled}
            changed={isChanged(rules, base, "match.fail_keep")}
            onRatio={(r) => edit((d) => void (d.match.fail_keep = r))}
          />
        </div>
        <p className="text-xs text-fg-2">{S.matchTab.note}</p>
      </Section>
    </div>
  );
}
