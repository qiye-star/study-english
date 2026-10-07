import type { ReactNode } from "react";
import { Switch } from "@renderer/components/ui/switch";
import { cn } from "./cn";

/*
 * 抽屉里的表单件(对话设置、场景选择、复盘):分组 = 13px 次要色标题 + 圆角 14 的发丝线列表,
 * 行内边距 14/12,输入控件 44 高、圆角 12、16px 字号(iOS 小于 16px 的输入框聚焦会放大页面)。
 */
export const fieldClass = "block space-y-1.5 px-3.5 py-3";
export const labelClass = "block text-sub font-semibold text-ink";
export const hintClass = "block text-meta text-ink-2";
export const selectClass = "h-11 w-full rounded-button border-[0.5px] border-hair bg-surface px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const textareaClass = "rounded-button border-[0.5px] border-hair bg-surface text-base text-ink placeholder:text-ink-2 focus-visible:ring-2 focus-visible:ring-blue/30 focus-visible:ring-offset-0";

export function Group({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="mx-0.5 mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2">{title}</h3>
      <div className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">{children}</div>
    </section>
  );
}

/** 开关行:标题 15px + 可选 12px 说明,右侧 44×26 开关;整行最小 56 高。 */
export function SwitchRow({ id, testId, title, hint, checked, onChange }: {
  id: string;
  testId: string;
  title: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="flex min-h-row items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="min-w-0">
        <label htmlFor={id} className="block text-body font-medium text-ink">{title}</label>
        {hint ? <span id={`${id}-hint`} className="mt-0.5 block text-meta text-ink-2">{hint}</span> : null}
      </span>
      <Switch id={id} aria-describedby={hint ? `${id}-hint` : undefined} data-testid={testId} checked={checked}
        className={cn("h-[26px] w-11 data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair",
          "[&>span]:h-[22px] [&>span]:w-[22px] [&>span]:bg-white [&>span]:shadow-[0_1px_2px_rgba(17,19,24,0.2)] [&>span]:data-[state=checked]:translate-x-[18px]")}
        onCheckedChange={onChange} />
    </div>
  );
}
