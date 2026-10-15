import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { LQ_CHIP, LQ_CHIP_ON } from "~/components/liquid";
import { fmt } from "./ui";
import type { Tier } from "./wordbook-api";

// 一色一义:新学 = 琥珀,巩固中 = 青浅底,熟练 = 青(与首页书卡「已掌握 / 已学」同色系)
const SEGMENTS: { tier: Tier; swatch: string }[] = [
  { tier: "learning", swatch: "bg-amber liquid:bg-wash" },
  { tier: "growing", swatch: "bg-teal-tint shadow-[inset_0_0_0_0.5px_rgb(var(--teal)/0.35)] liquid:bg-wash-2" },
  { tier: "mastered", swatch: "bg-teal liquid:bg-ink/85" },
];

/**
 * 熟练度分布条(规格 §1.2):上面是比例条(装饰),下面三个 ≥ 44px 的分段按钮;点分段即筛选,再点取消。
 * 盒子 0–1 / 2–3 / 4–5(R-L1)。
 */
export function BoxBar({ by, value, onChange }: { by: Record<Tier, number>; value: Tier | null; onChange: (tier: Tier | null) => void }) {
  const { t } = useTranslation();
  const total = by.learning + by.growing + by.mastered;
  return (
    <div data-testid="box-bar">
      <div aria-hidden className="flex h-2.5 gap-px overflow-hidden rounded-[5px] bg-surface-2">
        {SEGMENTS.map(({ tier, swatch }) => (
          <i key={tier} className={cn("block h-full", swatch)} style={{ flex: total > 0 ? by[tier] : 0 }} />
        ))}
      </div>
      <div role="group" aria-label={t("web.wordbook.learned.box.label")} className="mt-2.5 grid grid-cols-3 gap-2">
        {SEGMENTS.map(({ tier, swatch }) => {
          const active = value === tier;
          const label = t(`web.wordbook.learned.box.${tier}`);
          return (
            <button key={tier} type="button" aria-pressed={active} aria-label={t("web.wordbook.learned.box.segment", { label, n: by[tier] })}
              onClick={() => onChange(active ? null : tier)}
              className={cn(
                "min-h-tap rounded-button border-[0.5px] px-2.5 py-1.5 text-left transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? cn("border-blue bg-blue-tint", LQ_CHIP_ON) : cn("border-hair bg-surface active:bg-surface-2", LQ_CHIP),
              )}>
              <span className="flex items-center text-meta text-ink-2">
                <i aria-hidden className={cn("mr-1 inline-block h-2 w-2 flex-none rounded-[2px]", swatch)} />
                <span className="truncate">{label}</span>
              </span>
              <b aria-hidden className="num block text-headline font-semibold text-ink">{fmt(by[tier])}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
