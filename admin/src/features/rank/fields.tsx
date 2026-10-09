import type { ReactNode } from "react";
import type { RankRules } from "./api";
import { RANGES, getPath, inRange, type RangeKey } from "./rules-schema";

/** 页签共用的属性:rules = 本地草稿;base = 当前生效版本(标出改动);edit 以拷贝修改草稿 */
export interface TabProps {
  rules: RankRules;
  base: RankRules;
  edit: (mutate: (draft: RankRules) => void) => void;
  disabled: boolean;
}

export function isChanged(rules: RankRules, base: RankRules, path: string): boolean {
  return JSON.stringify(getPath(rules, path)) !== JSON.stringify(getPath(base, path));
}

function parse(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** 数字输入:越界红框,本次修改蓝框(蓝 = 本次修改);label 不可见时用 aria-label。 */
export function NumField({
  label,
  value,
  onChange,
  range,
  disabled,
  changed,
  step,
  hideLabel = false,
  suffix,
  className = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  range: RangeKey;
  disabled?: boolean;
  changed?: boolean;
  step?: number;
  hideLabel?: boolean;
  suffix?: string;
  className?: string;
}) {
  const [lo, hi] = RANGES[range];
  const bad = !inRange(range, value);
  const input = (
    <span className="relative flex items-center">
      <input
        type="number"
        className={`field-sm num h-8 pr-2 text-right ${bad ? "border-bad ring-1 ring-bad/40" : changed ? "border-accent ring-1 ring-accent/40" : ""} ${className}`}
        value={Number.isFinite(value) ? value : ""}
        min={lo}
        max={hi}
        step={step ?? (Number.isInteger(lo) && Number.isInteger(hi) ? 1 : 0.1)}
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        aria-invalid={bad || undefined}
        onChange={(e) => onChange(parse(e.target.value))}
      />
      {suffix && <span className="pointer-events-none ml-1 text-xs text-fg-2">{suffix}</span>}
    </span>
  );
  if (hideLabel) return input;
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-fg-2">{label}</span>
      {input}
    </label>
  );
}

/** 0–1 的比例以整数百分比编辑 */
export function PctField(props: Omit<Parameters<typeof NumField>[0], "value" | "onChange" | "step"> & { ratio: number; onRatio: (r: number) => void }) {
  const { ratio, onRatio, ...rest } = props;
  return <NumField {...rest} value={Number.isFinite(ratio) ? Math.round(ratio * 100) : Number.NaN} onChange={(v) => onRatio(v / 100)} step={1} />;
}

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium text-fg-2">{title}</h3>
        {hint && <span className="text-2xs text-fg-2">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function ErrorList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul role="list" className="space-y-1 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
      {items.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  );
}
