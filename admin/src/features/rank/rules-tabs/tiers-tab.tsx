import { NumField, Section, isChanged, type TabProps } from "../fields";
import { S, tierName } from "../strings";
import { PointsTab } from "./points-tab";

/** 「段位与点数」:每小段点数(结构不可改,只改数字)+ 点数规则 */
export function TiersTab(props: TabProps) {
  const { rules, base, edit, disabled } = props;
  return (
    <div className="space-y-6">
      <Section title={S.tiersTab.title}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-2xs text-fg-2">
              {rules.tiers.map((t) => (
                <th key={t.key} className="border-b border-line px-2 py-1.5 font-medium">
                  {tierName(t.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {rules.tiers.map((t, i) => (
                <td key={t.key} className="px-2 py-2">
                  <NumField
                    hideLabel
                    label={S.tiersTab.divisionRp(tierName(t.key))}
                    value={t.division_rp}
                    range="division_rp"
                    disabled={disabled}
                    changed={isChanged(rules, base, `tiers.${i}.division_rp`)}
                    onChange={(v) => edit((d) => void (d.tiers[i].division_rp = v))}
                  />
                </td>
              ))}
            </tr>
            <tr className="text-2xs text-fg-2">
              {rules.tiers.map((t, i) => (
                <td key={t.key} className="num px-2 pb-2 text-right">
                  {i === rules.tiers.length - 1 ? S.tiersTab.masterNote : `${S.tiersTab.total} ${3 * t.division_rp}`}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-fg-2">{S.tiersTab.note}</p>
      </Section>
      <PointsTab {...props} />
    </div>
  );
}
