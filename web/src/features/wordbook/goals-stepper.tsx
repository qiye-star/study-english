import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { clamp, parseCount } from "./goals-math";

export const STEP_DEBOUNCE_MS = 600;

const KEY = cn(
  "inline-flex h-tap w-tap flex-none items-center justify-center rounded-button border-[0.5px] border-hair bg-surface text-ink dark:bg-surface-2",
  "transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5",
);

/**
 * 步进器(spec 2026-10-11 §2.2、§12.3):− / 数字输入 / +。点按 600 ms 后提交一次;失焦或回车立即提交;
 * 越界夹到范围;非数字恢复为已保存的值。输入框 inputmode=numeric,接受全角数字。
 * Ruling GW3-a:面板在去抖期间关闭(卸载)时立即提交那次点按,不丢改动;挂载本身从不提交(StrictMode 双挂载安全)。
 */
export function GoalsStepper({ label, value, min, max, step = 1, onCommit, testId }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  /** 去抖中、还没提交的值 */
  const pending = useRef<number | null>(null);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next !== null && next !== latest.current.value) latest.current.onCommit(next);
  }, []);

  const commit = (n: number) => {
    clearTimeout(timer.current);
    pending.current = null;
    const next = clamp(n, min, max);
    setDraft(String(next));
    if (next !== latest.current.value) latest.current.onCommit(next);
  };
  const nudge = (delta: number) => {
    const next = clamp((parseCount(draft) ?? value) + delta, min, max);
    setDraft(String(next));
    clearTimeout(timer.current);
    pending.current = next;
    timer.current = setTimeout(() => commit(next), STEP_DEBOUNCE_MS);
  };
  const current = parseCount(draft) ?? value;

  return (
    <div role="group" aria-labelledby={`${id}-label`} data-testid={testId} className="flex items-center gap-2">
      <span id={`${id}-label`} className="sr-only">{label}</span>
      <button type="button" className={KEY} disabled={current <= min} aria-label={t("web.wordbook.goals.stepper.less", { label })}
        onClick={() => nudge(-step)}>
        <MinusIcon aria-hidden />
      </button>
      <input type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" autoComplete="off" maxLength={4}
        aria-label={label} aria-describedby={`${id}-range`} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const n = parseCount(draft); if (n === null) setDraft(String(value)); else commit(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className="num h-tap w-[76px] rounded-button border-[0.5px] border-hair bg-surface-2 text-center text-title font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <button type="button" className={KEY} disabled={current >= max} aria-label={t("web.wordbook.goals.stepper.more", { label })}
        onClick={() => nudge(step)}>
        <PlusIcon aria-hidden />
      </button>
      <span id={`${id}-range`} className="num ml-1 text-meta text-ink-2">{t("web.wordbook.goals.stepper.range", { min, max })}</span>
    </div>
  );
}
