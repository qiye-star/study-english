/**
 * 语义色调(每种色相一种含义):blue 操作/激活/用户、teal 词汇、amber 连续/提示/目标词、
 * green 高分/在线、gray 中性。tint 背景 + 同色相文字/图标。
 */
export type Tone = "blue" | "teal" | "amber" | "green" | "gray";

export const TONE_CLASS: Record<Tone, string> = {
  blue: "bg-blue-tint text-blue",
  teal: "bg-teal-tint text-teal",
  amber: "bg-amber-tint text-amber",
  green: "bg-green-tint text-green",
  gray: "bg-surface-2 text-ink-2",
};
