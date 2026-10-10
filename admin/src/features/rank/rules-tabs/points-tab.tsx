import { NumField, Section, isChanged, type TabProps } from "../fields";
import { POINT_KINDS, pointValue, sourcesDailyCap } from "../rules-schema";
import { S } from "../strings";

/** 跟读分档 + 其他固定点数 + 每日上限 + 学习联动来源(spec 2026-10-11 §5.3) */
export function PointsTab({ rules, base, edit, disabled }: TabProps) {
  const bands = rules.points.assessment_bands;
  const sources = Object.entries(rules.points.sources ?? {});
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
          {POINT_KINDS.map((k) => (
            <NumField
              key={k}
              label={S.tiersTab[k]}
              value={pointValue(rules.points, k)}
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
      <div className="col-span-2">
        <Section title={S.tiersTab.sources} hint={S.tiersTab.sourcesNote}>
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label={S.tiersTab.sourcesDailyCap}
              value={sourcesDailyCap(rules.points)}
              range="sources_daily_cap"
              disabled={disabled}
              changed={isChanged(rules, base, "points.sources_daily_cap")}
              onChange={(v) => edit((d) => void (d.points = { ...d.points, sources_daily_cap: v }))}
            />
          </div>
          {sources.length === 0 ? (
            <p className="text-xs text-fg-2">{S.tiersTab.sourcesEmpty}</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <tbody>
                {sources.map(([kind, pts]) => (
                  <tr key={kind}>
                    <td className="num py-1 pr-2 text-xs">{kind}</td>
                    <td className="py-1 pr-2">
                      <NumField
                        hideLabel
                        label={S.tiersTab.sourcePoints(kind)}
                        value={pts}
                        range="points"
                        disabled={disabled}
                        changed={isChanged(rules, base, `points.sources.${kind}`)}
                        onChange={(v) => edit((d) => void (d.points = { ...d.points, sources: { ...d.points.sources, [kind]: v } }))}
                      />
                    </td>
                    <td className="text-xs text-fg-2">点</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}
