import { NumField, Section, isChanged, type TabProps } from "../fields";
import { S } from "../strings";

const SIMPLE = ["chat_turn", "vocab_review", "active_day", "streak_7", "stage_task"] as const;

/** 跟读分档 + 其他固定点数 + 每日上限 */
export function PointsTab({ rules, base, edit, disabled }: TabProps) {
  const bands = rules.points.assessment_bands;
  return (
    <div className="grid grid-cols-2 gap-6">
      <Section title={S.tiersTab.bands}>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {bands.map(([floor, pts], i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <NumField
                    hideLabel
                    label={S.tiersTab.bandFloor(i + 1)}
                    value={floor}
                    range="band_floor"
                    disabled={disabled}
                    changed={isChanged(rules, base, `points.assessment_bands.${i}.0`)}
                    onChange={(v) => edit((d) => void (d.points.assessment_bands[i][0] = v))}
                  />
                </td>
                <td className="px-1 text-xs text-fg-2">分及以上 →</td>
                <td className="py-1 pr-2">
                  <NumField
                    hideLabel
                    label={S.tiersTab.bandPoints(i + 1)}
                    value={pts}
                    range="band_points"
                    disabled={disabled}
                    changed={isChanged(rules, base, `points.assessment_bands.${i}.1`)}
                    onChange={(v) => edit((d) => void (d.points.assessment_bands[i][1] = v))}
                  />
                </td>
                <td className="text-xs text-fg-2">点</td>
                <td className="text-right">
                  {!disabled && bands.length > 1 && (
                    <button type="button" className="btn-quiet btn-sm" onClick={() => edit((d) => void d.points.assessment_bands.splice(i, 1))}>
                      {S.tiersTab.removeBand}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!disabled && bands.length < 6 && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => edit((d) => void d.points.assessment_bands.splice(Math.max(0, bands.length - 1), 0, [50, 2]))}
          >
            {S.tiersTab.addBand}
          </button>
        )}
      </Section>
      <Section title={S.tiersTab.points}>
        <div className="grid grid-cols-2 gap-3">
          {SIMPLE.map((k) => (
            <NumField
              key={k}
              label={S.tiersTab[k]}
              value={rules.points[k]}
              range="points"
              disabled={disabled}
              changed={isChanged(rules, base, `points.${k}`)}
              onChange={(v) => edit((d) => void (d.points[k] = v))}
            />
          ))}
          <NumField
            label={S.tiersTab.daily_cap}
            value={rules.points.daily_cap}
            range="daily_cap"
            disabled={disabled}
            changed={isChanged(rules, base, "points.daily_cap")}
            onChange={(v) => edit((d) => void (d.points.daily_cap = v))}
          />
        </div>
      </Section>
    </div>
  );
}
