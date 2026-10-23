import { useId, type ReactNode } from "react";
import { SegmentedControl, type SegmentedOption } from "~/components/segmented-control";

/**
 * 设置面板的一节分段设置:标题 + 分段(radiogroup,方向键切换,每段命中 44 px)+ 说明行。
 * 复用 `~/components/segmented-control`;这里只负责整行铺满与标题 / 说明的关联。
 */
export function SettingSegment<T extends string>({ title, value, options, onChange, disabled, hint }: {
  title: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange(value: T): void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const hintId = useId();
  return (
    <div className="py-2">
      <p className="pb-1.5 text-body font-medium text-ink">{title}</p>
      <SegmentedControl<T> label={title} value={value} options={options} onChange={onChange} disabled={disabled}
        className="flex w-full" optionClassName="min-w-0 flex-1 px-1.5 text-center" />
      {hint ? <p id={hintId} className="mt-1.5 text-meta text-ink-2">{hint}</p> : null}
    </div>
  );
}
