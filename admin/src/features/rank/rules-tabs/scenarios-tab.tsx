import { useCallback, useState } from "react";
import { Dialog } from "../../../components/dialog";
import type { ScenarioRule } from "../api";
import { isChanged, type TabProps } from "../fields";
import { S, tierName } from "../strings";

type Field = "key" | "title_zh" | "title_en" | "brief_zh" | "role" | "setting" | "opener";
const TEXT_FIELDS: Field[] = ["key", "title_zh", "title_en", "brief_zh", "role", "setting"];

function ScenarioEditor({
  scenario,
  disabled,
  onChange,
  onRemove,
  onClose,
}: {
  scenario: ScenarioRule;
  disabled: boolean;
  onChange: (s: ScenarioRule) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      title={S.scenariosTab.editTitle}
      onClose={onClose}
      width={640}
      footer={
        <>
          {!disabled && (
            <button type="button" className="btn-danger btn-sm mr-auto" onClick={onRemove}>
              {S.scenariosTab.remove}
            </button>
          )}
          <button type="button" className="btn-primary btn-sm" onClick={onClose}>
            {S.scenariosTab.done}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {TEXT_FIELDS.map((f) => (
          <label key={f} className={`block space-y-1 ${f === "brief_zh" ? "col-span-2" : ""}`}>
            <span className="text-xs text-fg-2">{S.scenariosTab.fields[f]}</span>
            <input
              className="field-sm"
              value={scenario[f]}
              disabled={disabled}
              maxLength={f === "brief_zh" ? 300 : f === "key" ? 64 : 200}
              onChange={(e) => onChange({ ...scenario, [f]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-fg-2">{S.scenariosTab.fields.functions}</span>
        <textarea
          className="field-sm h-auto min-h-[88px] py-2"
          value={scenario.functions.join("\n")}
          disabled={disabled}
          onChange={(e) => onChange({ ...scenario, functions: e.target.value.split("\n") })}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-fg-2">{S.scenariosTab.fields.opener}</span>
        <textarea
          className="field-sm h-auto min-h-[64px] py-2"
          value={scenario.opener}
          maxLength={300}
          disabled={disabled}
          onChange={(e) => onChange({ ...scenario, opener: e.target.value })}
        />
      </label>
    </Dialog>
  );
}

/** 情景池:按目标段位分组的卡片;每组启用数 < 2 标红。 */
export function ScenariosTab({ rules, base, edit, disabled }: TabProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const close = useCallback(() => setEditing(null), []);
  const indexed = rules.scenarios.map((s, i) => ({ s, i }));
  const addTo = (tier: number) => {
    const key = `custom-${rules.tiers[tier]?.key ?? tier}-${Date.now().toString(36)}`;
    edit((d) =>
      void d.scenarios.push({ key, target_tier: tier, title_zh: "", title_en: "", brief_zh: "", role: "", setting: "", functions: ["", "", ""], opener: "", enabled: false }),
    );
    setEditing(rules.scenarios.length);
  };
  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-2">{S.scenariosTab.disabledNote}</p>
      {[1, 2, 3, 4, 5, 6].map((tier) => {
        const group = indexed.filter(({ s }) => s.target_tier === tier);
        const enabled = group.filter(({ s }) => s.enabled).length;
        const short = enabled < 2;
        return (
          <section key={tier} className="space-y-2" data-testid={`pool-${tier}`}>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">{tierName(tier)}</h3>
              <span className={`badge num ${short ? "bg-bad-soft text-bad" : "bg-sunken text-fg-2"}`}>{S.scenariosTab.enabledCount(enabled)}</span>
              {short && <span className="text-xs text-bad">{S.scenariosTab.needTwo}</span>}
              <span className="flex-1" />
              {!disabled && (
                <button type="button" className="btn-quiet btn-sm" onClick={() => addTo(tier)}>
                  {S.scenariosTab.add}
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {group.map(({ s, i }) => (
                <div
                  key={`${s.key}-${i}`}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${isChanged(rules, base, `scenarios.${i}`) ? "border-accent" : "border-line"} ${s.enabled ? "" : "opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={s.enabled}
                    disabled={disabled}
                    aria-label={S.scenariosTab.enable(s.title_zh || s.key)}
                    onChange={(e) => edit((d) => void (d.scenarios[i].enabled = e.target.checked))}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.title_zh || s.key}</p>
                    <p className="truncate text-2xs text-fg-2">{s.title_en || s.key}</p>
                  </div>
                  <button type="button" className="btn-quiet btn-sm min-h-[28px] px-2" onClick={() => setEditing(i)}>
                    {S.scenariosTab.edit}
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {editing !== null && rules.scenarios[editing] && (
        <ScenarioEditor
          scenario={rules.scenarios[editing]}
          disabled={disabled}
          onChange={(next) => edit((d) => void (d.scenarios[editing] = next))}
          onRemove={() => {
            const at = editing;
            setEditing(null);
            edit((d) => void d.scenarios.splice(at, 1));
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
