import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { TONE_CLASS, type Tone } from "./tone";

/**
 * 22px 高的色调徽标(不换行),如连续天数、等级、分数、待复习数。分数用 scoreBadgeTone(score) 选色。
 *   <ToneBadge tone="amber"><FlameIcon />12 天</ToneBadge>
 */
export function ToneBadge({ tone, className, children }: { tone: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-meta font-semibold tracking-[0.01em] [&_svg]:h-3.5 [&_svg]:w-3.5",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
