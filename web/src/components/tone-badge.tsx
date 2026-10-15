import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { TONE_CLASS, type Tone } from "./tone";

const DOT = { green: "bg-green", amber: "bg-amber", red: "bg-red", accent: "bg-blue" } as const;

/**
 * 22px 高的色调徽标(不换行),如连续天数、等级、分数、待复习数。分数用 scoreBadgeTone(score) 选色。
 * 液态皮肤(计划 2026-10-15-liquid-glass,设计稿 .chip):中性井胶囊、次要色文字;语义只用 dot(6px 圆点)表达。
 *   <ToneBadge tone="amber"><FlameIcon />12 天</ToneBadge> · <ToneBadge tone="green" dot="green">92</ToneBadge>
 */
export function ToneBadge({ tone, dot, className, children }: {
  tone: Tone; dot?: keyof typeof DOT; className?: string; children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-meta font-semibold tracking-[0.01em] [&_svg]:h-3.5 [&_svg]:w-3.5",
        TONE_CLASS[tone],
        "liquid:rounded-full liquid:bg-wash liquid:px-2.5 liquid:font-medium liquid:text-ink-2",
        className,
      )}
    >
      {dot ? <i aria-hidden className={cn("hidden size-1.5 flex-none rounded-full liquid:inline-block", DOT[dot])} /> : null}
      {children}
    </span>
  );
}
