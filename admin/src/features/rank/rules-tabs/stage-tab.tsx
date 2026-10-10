import type { StageKind, StageTaskRule } from "../api";
import { NumField, Section, isChanged, type TabProps } from "../fields";
import { STAGE_KIND_LIST as KINDS, hasMinScore } from "../rules-schema";
import { STAGE_KINDS, S, tierName } from "../strings";

/** 种类改变时 key 跟着换(key 是完成记录 `{tier}:{key}` 的一部分,同段位内唯一) */
function keyFor(kind: StageKind, others: StageTaskRule[]): string {
  if (!others.some((t) => t.key === kind)) return kind;
  let n = 2;
  while (others.some((t) => t.key === `${kind}_${n}`)) n += 1;
  return `${kind}_${n}`;
}

export function StageTab({ rules, base, edit, disabled }: TabProps) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-2">{S.stageTab.note}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        {[0, 1, 2, 3, 4, 5].map((tier) => {
          const tasks = rules.stage_tasks[String(tier)] ?? [];
          const name = tierName(tier);
          return (
            <Section key={tier} title={S.stageTab.title(name)}>
              <div className="space-y-1.5">
                {tasks.map((t, i) => {
                  const path = `stage_tasks.${tier}.${i}`;
                  return (
                    <div key={i} className="grid grid-cols-[1fr_88px_88px_auto] items-center gap-2">
                      <select
                        className={`field-sm h-8 ${isChanged(rules, base, `${path}.kind`) ? "border-accent ring-1 ring-accent/40" : ""}`}
                        aria-label={S.stageTab.kind(name, i + 1)}
                        value={t.kind}
                        disabled={disabled}
                        onChange={(e) =>
                          edit((d) => {
                            const list = d.stage_tasks[String(tier)];
                            const kind = e.target.value as StageKind;
                            list[i] = { ...list[i], kind, key: keyFor(kind, list.filter((_, j) => j !== i)), min_score: hasMinScore(kind) ? list[i].min_score : null };
                          })
                        }
                      >
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {STAGE_KINDS[k]}
                          </option>
                        ))}
                      </select>
                      <NumField
                        hideLabel
                        label={S.stageTab.target(name, i + 1)}
                        value={t.target}
                        range="stage_target"
                        disabled={disabled}
                        changed={isChanged(rules, base, `${path}.target`)}
                        onChange={(v) => edit((d) => void (d.stage_tasks[String(tier)][i].target = v))}
                      />
                      {hasMinScore(t.kind) ? (
                        <NumField
                          hideLabel
                          label={S.stageTab.minScore(name, i + 1)}
                          value={t.min_score ?? 0}
                          range="stage_min_score"
                          disabled={disabled}
                          changed={isChanged(rules, base, `${path}.min_score`)}
                          onChange={(v) => edit((d) => void (d.stage_tasks[String(tier)][i].min_score = v === 0 ? null : v))}
                        />
                      ) : (
                        <span />
                      )}
                      {!disabled && tasks.length > 1 ? (
                        <button type="button" className="btn-quiet btn-sm" onClick={() => edit((d) => void d.stage_tasks[String(tier)].splice(i, 1))}>
                          {S.stageTab.remove}
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
                {!disabled && tasks.length < 4 && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      edit((d) => {
                        const list = (d.stage_tasks[String(tier)] ??= []);
                        const kind = KINDS.find((k) => !list.some((x) => x.kind === k)) ?? "chat_turns";
                        list.push({ key: keyFor(kind, list), kind, target: 10, min_score: null });
                      })
                    }
                  >
                    {S.stageTab.add}
                  </button>
                )}
              </div>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
