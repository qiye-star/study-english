import type { ComponentType, SVGProps } from "react";
import { cn } from "@renderer/lib/utils";
import { TONE_CLASS, type Tone } from "./tone";

/**
 * 列表行前的 34px 彩色图标片(装饰性,aria-hidden)。色调表示来源 / 类别:
 * blue 对话、amber 提示、teal 词汇、green 成绩、gray 中性设置。
 *   <IconChip tone="teal" icon={BookIcon} />
 */
export function IconChip({
  tone,
  icon: Icon,
  className,
}: {
  tone: Tone;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-badge", TONE_CLASS[tone], className)}
    >
      <Icon className="h-[19px] w-[19px]" />
    </span>
  );
}
