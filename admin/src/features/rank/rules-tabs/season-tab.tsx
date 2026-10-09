import { NumField, isChanged, type TabProps } from "../fields";
import { S } from "../strings";

export function SeasonTab({ rules, base, edit, disabled, started }: TabProps & { started: boolean }) {
  const locked = disabled || started;
  return (
    <div className="max-w-md space-y-4">
      <p className={`rounded-lg px-3 py-2 text-xs ${started ? "bg-warn-soft text-fg" : "text-fg-2"}`}>{started ? S.seasonTab.locked : S.seasonTab.open}</p>
      <label className="block space-y-1">
        <span className="block text-xs text-fg-2">{S.seasonTab.anchor}</span>
        <input
          type="date"
          className={`field-sm num h-8 ${isChanged(rules, base, "season.anchor") ? "border-accent ring-1 ring-accent/40" : ""}`}
          value={rules.season.anchor}
          disabled={locked}
          onChange={(e) => e.target.value && edit((d) => void (d.season.anchor = e.target.value))}
        />
      </label>
      <NumField
        label={S.seasonTab.weeks}
        value={rules.season.weeks}
        range="season_weeks"
        disabled={locked}
        changed={isChanged(rules, base, "season.weeks")}
        onChange={(v) => edit((d) => void (d.season.weeks = v))}
      />
    </div>
  );
}
