import type { PromptSpec } from "./api";
import type { PromptCheck } from "./placeholders";
import { S } from "./strings";

const OTHER_ERRORS: Record<string, string> = {
  empty: S.empty,
  too_long: S.tooLong,
  invalid_json: S.invalidJson,
  invalid_templates: S.invalidTemplates,
};

/** 右侧检查栏:必需占位符与边界标签逐项打勾,缺失/未知项红字(实时)。 */
export function PlaceholderChecklist({ spec, check }: { spec: PromptSpec; check: PromptCheck }) {
  const formatted = spec.kind === "text" && spec.formatted !== false;
  // empty or over-long bodies stop the server checks early, so nothing below is known yet
  const checked = !check.errors.includes("empty") && !check.errors.includes("too_long");
  const fieldsKnown = formatted && checked && !check.invalidBraces;
  const others = check.errors.filter((e) => e in OTHER_ERRORS);
  return (
    <section className="panel" aria-label={S.checksTitle}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold">{S.checksTitle}</h2>
        {check.errors.length === 0 && <span className="badge bg-good-soft text-good">{S.allGood}</span>}
      </div>
      <div className="space-y-3 px-4 pb-4 pt-1 text-sm">
        {others.map((e) => (
          <p key={e} className="text-bad">{OTHER_ERRORS[e]}</p>
        ))}
        {check.invalidBraces && <p className="text-bad">{S.invalidBraces}</p>}
        {fieldsKnown && check.missing.length > 0 && <p className="text-bad">{S.missingFields(check.missing)}</p>}
        {fieldsKnown && check.unknown.length > 0 && <p className="text-bad">{S.unknownFields(check.unknown)}</p>}
        {check.missingBoundaries.length > 0 && <p className="text-bad">{S.missingBoundaries(check.missingBoundaries)}</p>}

        {spec.kind === "text" && spec.formatted === false && <p className="text-fg-2">{S.grammarNote}</p>}
        {spec.key === "chat.daily_greeting" && <p className="text-fg-2">{S.fixedPartsNote}</p>}

        {formatted && spec.required.length > 0 && (
          <div>
            <h3 className="eyebrow mb-1">{S.required}</h3>
            <ul className="space-y-1">
              {spec.required.map((name) => {
                const ok = fieldsKnown && !check.missing.includes(name);
                return (
                  <li key={name} className="flex items-center gap-2">
                    <span aria-hidden="true" className={ok ? "text-good" : "text-bad"}>{ok ? "✓" : "✗"}</span>
                    <code className="font-mono text-[13px]">{`{${name}}`}</code>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {spec.boundaries.length > 0 && (
          <div>
            <h3 className="eyebrow mb-1">{S.boundaries}</h3>
            <ul className="space-y-1">
              {spec.boundaries.map((tag) => {
                const ok = checked && !check.missingBoundaries.includes(tag);
                return (
                  <li key={tag} className="flex items-center gap-2">
                    <span aria-hidden="true" className={ok ? "text-good" : "text-bad"}>{ok ? "✓" : "✗"}</span>
                    <code className="font-mono text-[13px]">{tag}</code>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-fg-2">{S.boundaryNote}</p>
          </div>
        )}
      </div>
    </section>
  );
}
