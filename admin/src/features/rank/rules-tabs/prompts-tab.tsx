import { isChanged, type TabProps } from "../fields";
import { EXAMINER_FIELDS, JUDGE_FIELDS, templateProblems } from "../rules-schema";
import { S } from "../strings";

function PromptBox({
  label,
  value,
  required,
  disabled,
  changed,
  onChange,
}: {
  label: string;
  value: string;
  required: string[];
  disabled: boolean;
  changed: boolean;
  onChange: (v: string) => void;
}) {
  const p = templateProblems(value, required);
  return (
    <section className="space-y-2">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{label}</span>
        <textarea
          className={`field-sm h-auto min-h-[260px] py-2 font-mono text-xs leading-relaxed ${changed ? "border-accent ring-1 ring-accent/40" : ""}`}
          value={value}
          maxLength={8000}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-fg-2">{S.promptsTab.required}</span>
        {required.map((f) => (
          <code key={f} className={`badge font-mono ${p.missing.includes(f) ? "bg-bad-soft text-bad" : "bg-sunken text-fg-2"}`}>{`{${f}}`}</code>
        ))}
      </div>
      {p.missing.length > 0 && <p className="text-xs text-bad">{S.promptsTab.missing(p.missing.map((f) => `{${f}}`).join(" "))}</p>}
      {p.extra.length > 0 && <p className="text-xs text-bad">{S.promptsTab.extra(p.extra.map((f) => `{${f}}`).join(" "))}</p>}
      <p className={`text-xs ${p.learner ? "text-fg-2" : "text-bad"}`}>{p.learner ? S.promptsTab.learner : S.promptsTab.learnerMissing}</p>
    </section>
  );
}

export function PromptsTab({ rules, base, edit, disabled }: TabProps) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-2">{S.promptsTab.braces}</p>
      <div className="grid grid-cols-2 gap-5">
        <PromptBox
          label={S.promptsTab.examiner}
          value={rules.match.examiner_prompt}
          required={EXAMINER_FIELDS}
          disabled={disabled}
          changed={isChanged(rules, base, "match.examiner_prompt")}
          onChange={(v) => edit((d) => void (d.match.examiner_prompt = v))}
        />
        <PromptBox
          label={S.promptsTab.judge}
          value={rules.match.judge_prompt}
          required={JUDGE_FIELDS}
          disabled={disabled}
          changed={isChanged(rules, base, "match.judge_prompt")}
          onChange={(v) => edit((d) => void (d.match.judge_prompt = v))}
        />
      </div>
    </div>
  );
}
