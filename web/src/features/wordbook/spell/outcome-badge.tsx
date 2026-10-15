import { ArrowLeftRightIcon, CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { Outcome } from "../wordbook-api";

/** 结果色(spec §11.3):正确 绿、小笔误 / 词形不对 琥珀、错误 中性(不用红)。 */
export const OUTCOME_TEXT: Record<Outcome, string> = {
  correct: "text-green",
  typo: "text-amber",
  inflection: "text-amber",
  wrong: "text-ink-2",
};

const BADGE: Record<Outcome, string> = {
  correct: "bg-green-tint text-green liquid:rounded-full liquid:bg-wash",
  typo: "bg-amber-tint text-amber liquid:rounded-full liquid:bg-wash",
  inflection: "bg-amber-tint text-amber liquid:rounded-full liquid:bg-wash",
  wrong: "bg-surface-2 text-ink-2",
};

const ICON = { correct: CheckIcon, typo: PencilIcon, inflection: ArrowLeftRightIcon, wrong: XIcon } as const;

/** 22px 结果徽标:图标 + 文字,不只靠颜色(深色下也能区分)。 */
export function OutcomeBadge({ outcome, className }: { outcome: Outcome; className?: string }) {
  const { t } = useTranslation();
  const Icon = ICON[outcome];
  return (
    <span
      data-outcome={outcome}
      className={cn(
        "inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-[7px] align-middle text-meta font-semibold leading-none",
        BADGE[outcome],
        className,
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />
      {t(`web.wordbookSpell.outcome.${outcome}`)}
    </span>
  );
}
