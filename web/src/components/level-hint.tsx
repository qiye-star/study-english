import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { levelMeaning } from "~/lib/levels";

export interface LevelHintProps {
  /** 级别代码(原样传入,如 "B1"、"B1+");未知 / 空 → 用 fallback */
  code?: string | null;
  /** 没有说明时显示的文字(如「不选时按你的段位自动定。」或 web.level.scale);不给就不渲染 */
  fallback?: string;
  /** 给 aria-describedby 用 */
  id?: string;
  testId?: string;
  className?: string;
}

/**
 * 「这个级别是什么意思」的一行说明(计划 2026-10-14-level-annotations R-LV4 c、R-LV6)。
 * 放在下拉 / 分段 / 芯片旁边,随选择变化;是 block 的 <span>,可以放进 <label>。无状态,不含自己的状态与交互。
 */
export function LevelHint({ code, fallback, id, testId = "level-hint", className }: LevelHintProps) {
  const { t } = useTranslation();
  const text = levelMeaning(t, code) ?? fallback;
  if (!text) return null;
  return (
    <span id={id} data-testid={testId} className={cn("block text-meta leading-[1.45] text-ink-2", className)}>
      {text}
    </span>
  );
}
