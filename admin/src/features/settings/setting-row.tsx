import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApplyBadge } from "../../components/apply-badge";
import { SecretField } from "../../components/secret-field";
import type { Scalar, SettingItem } from "./api";
import { dangerOf, formatValue, parseInput } from "./model";
import { S } from "./strings";

/** undefined = 从草稿中移除(恢复原状) */
export type OnDraft = (key: string, value: Scalar | undefined) => void;

function SourceBadge({ item }: { item: SettingItem }) {
  const text = item.envOnly ? S.source.envOnly : S.source[item.source];
  const tone = item.source === "override" ? "bg-accent-soft text-accent-strong" : "bg-sunken text-fg-2 ring-1 ring-inset ring-line";
  return <span className={`badge ${tone}`}>{text}</span>;
}

function Control({ item, value, onDraft, disabled }: { item: SettingItem; value: Scalar; onDraft: OnDraft; disabled: boolean }) {
  const set = (next: Scalar) => onDraft(item.key, next === item.effective ? undefined : next);
  const common = { "aria-label": item.label, disabled };
  switch (item.kind) {
    case "bool":
      return (
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" role="switch" checked={value === true} onChange={(e) => set(e.target.checked)} {...common} />
          <span>{value ? S.on : S.off}</span>
        </label>
      );
    case "enum":
      return (
        <select className="field-sm w-auto min-w-[160px]" value={String(value ?? "")} onChange={(e) => set(item.key === "realtime_tts_sample_rate" ? Number(e.target.value) : e.target.value)} {...common}>
          {(item.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    case "int":
    case "float":
      return (
        <input
          className="field-sm num w-[160px]"
          type="number"
          inputMode="decimal"
          step={item.kind === "float" ? "any" : 1}
          min={item.min ?? undefined}
          max={item.max ?? undefined}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => set(parseInput(item, e.target.value))}
          {...common}
        />
      );
    case "text":
    case "json":
      return (
        <textarea
          className={`field-sm h-auto min-h-[72px] py-2 ${item.kind === "json" ? "font-mono" : ""}`}
          value={String(value ?? "")}
          maxLength={item.max ?? undefined}
          onChange={(e) => set(e.target.value)}
          spellCheck={false}
          {...common}
        />
      );
    case "date":
      return <input className="field-sm num w-[180px]" type="date" value={String(value ?? "")} onChange={(e) => set(e.target.value)} {...common} />;
    default:
      return (
        <input
          className={`field-sm ${item.kind === "url" || item.kind === "csv" ? "font-mono" : ""}`}
          type="text"
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          {...common}
        />
      );
  }
}

function SecretControl({ item, draft, onDraft, disabled, encryption }: { item: SettingItem; draft: Scalar | undefined; onDraft: OnDraft; disabled: boolean; encryption: boolean }) {
  const state = item.effectiveState ?? { set: false, source: "none" as const, fp: "" };
  const env = item.envState;
  if (!encryption && !item.envOnly) {
    return (
      <div className="space-y-1 text-sm">
        <div className="field-sm flex items-center bg-sunken text-fg-2">
          <span className="num">{state.set ? S.secretSet(state.fp) : S.secretUnset}</span>
        </div>
        <p className="text-2xs text-warn">{S.noEncryption}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <SecretField
        state={state}
        value={typeof draft === "string" ? draft : ""}
        onChange={(v) => onDraft(item.key, v === "" ? undefined : v)}
        disabled={disabled || draft === null}
        label={S.secretNew}
      />
      {state.source === "override" && env?.set && <p className="text-2xs text-fg-2">{S.secretEnvAlso(env.fp)}</p>}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          {draft !== undefined && (
            <button type="button" className="btn-quiet btn-sm" onClick={() => onDraft(item.key, undefined)}>
              {S.undo}
            </button>
          )}
          {item.overrideState?.set && draft !== null && (
            <button type="button" className="btn-quiet btn-sm" onClick={() => onDraft(item.key, null)}>
              {S.secretClear}
            </button>
          )}
        </div>
      )}
      {draft === null && <p className="text-2xs text-accent-strong">{S.secretWillClear}</p>}
    </div>
  );
}

/** 一行设置:标签 + env 名 + 说明 + 控件 + 来源 + 生效方式(spec §18、视觉稿第 1 屏)。改动只进草稿。 */
export function SettingRow({
  item,
  draft,
  onDraft,
  readOnly,
  encryption = true,
  probe,
}: {
  item: SettingItem;
  draft: Scalar | undefined;
  onDraft: OnDraft;
  readOnly: boolean;
  encryption?: boolean;
  probe?: ReactNode;
}) {
  const edited = draft !== undefined;
  const danger = edited && !item.secret ? dangerOf(item, draft) : null;
  const value: Scalar = draft === undefined ? (item.effective ?? null) : draft === null ? (item.envValue ?? null) : draft;
  const range = item.kind === "int" || item.kind === "float" ? S.range(item.min, item.max) : "";

  let control: ReactNode;
  if (item.envOnly) {
    const text = item.secret ? (item.envState?.set ? S.secretSet(item.envState.fp) : S.secretUnset) : formatValue(item.envValue);
    control = (
      <div className="space-y-1">
        <div className="field-sm flex items-center bg-sunken text-fg-2">
          <span className="truncate font-mono">{text}</span>
        </div>
        <p className="text-2xs text-fg-2">{S.envOnly}</p>
      </div>
    );
  } else if (item.managed) {
    control = (
      <div className="space-y-1">
        <div className="field-sm flex items-center bg-sunken text-fg-2">
          <span className="num">{formatValue(item.effective)}</span>
        </div>
        <p className="text-2xs text-fg-2">
          {S.managed} · <Link to="/rank/rules" className="text-accent-strong underline-offset-2 hover:underline">{S.managedLink}</Link>
        </p>
      </div>
    );
  } else if (item.secret) {
    control = <SecretControl item={item} draft={draft} onDraft={onDraft} disabled={readOnly} encryption={encryption} />;
  } else {
    control = (
      <div className="space-y-1.5">
        <Control item={item} value={value} onDraft={onDraft} disabled={readOnly || draft === null} />
        {!readOnly && (edited || item.source === "override") && (
          <div className="flex flex-wrap gap-2">
            {edited && (
              <button type="button" className="btn-quiet btn-sm" onClick={() => onDraft(item.key, undefined)}>
                {S.undo}
              </button>
            )}
            {item.source === "override" && draft !== null && (
              <button type="button" className="btn-quiet btn-sm" onClick={() => onDraft(item.key, null)}>
                {S.resetToEnv}
              </button>
            )}
          </div>
        )}
        {draft === null && <p className="text-2xs text-accent-strong">{S.willReset}</p>}
        {danger && <p className="text-xs text-bad">{danger}</p>}
      </div>
    );
  }

  return (
    <div
      data-testid={`setting-${item.key}`}
      className={`grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)_auto] gap-5 border-b border-line px-4 py-3.5 last:border-b-0 ${edited ? "bg-accent-soft/40 shadow-[inset_3px_0_0_rgb(var(--accent))]" : ""}`}
    >
      <div className="min-w-0">
        <div className={`text-sm font-medium ${item.envOnly ? "text-fg-2" : "text-fg"}`}>{item.label}</div>
        <div className="font-mono text-xs text-fg-2">{item.env}</div>
        {(item.help || range) && <p className="mt-1 text-xs text-fg-2">{[item.help, range].filter(Boolean).join(" · ")}</p>}
      </div>
      <div className="min-w-0 space-y-1.5">
        {control}
        {probe}
      </div>
      <div className="flex min-w-[96px] flex-col items-end gap-1">
        <SourceBadge item={item} />
        {(item.apply !== "hot" || item.restartPending) && !item.envOnly && <ApplyBadge apply={item.apply} pending={item.restartPending} />}
        {item.drift && (
          <span className="badge bg-warn-soft text-warn" title={S.driftHint}>
            {S.drift}
          </span>
        )}
        {item.invalid && <span className="badge bg-bad-soft text-bad">{S.invalidReason[item.invalid] ?? S.invalid}</span>}
        {item.outOfRange && <span className="badge bg-warn-soft text-warn">{S.outOfRange}</span>}
      </div>
    </div>
  );
}
