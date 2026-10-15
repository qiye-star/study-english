import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, EyeIcon, SearchCheckIcon } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { Rating } from "./session-machine";
import { DOCK, GHOST_DOCK, GHOST, PRIMARY } from "./ui";
import { Dock } from "~/components/dock";

/**
 * 三档自评操作条(学新词与快速回忆共用;spec recall §3.1 / §8.2,视觉稿 01 / 02 / 05):
 * 不认识(中性)/ 模糊(琥珀图标)/ 认识(蓝主按钮),各 48px 高、等宽,完整文字标签。
 * 偷看过时条上方一行说明,通过 `aria-describedby` 关联到「认识」。
 */
export function RecallRatingBar({ onRate, busy, peeked = false }: { onRate: (rating: Rating) => void; busy: boolean; peeked?: boolean }) {
  const { t } = useTranslation();
  const note = useId();
  return (
    <Dock className={cn(DOCK, "flex-col")}>
      {peeked ? (
        <p id={note} className="flex items-center gap-1.5 px-0.5 text-meta text-ink-2 plate liquid:rounded-full liquid:px-3 liquid:py-1">
          <EyeIcon aria-hidden className="h-[15px] w-[15px] flex-none text-amber" />{t("web.wordbook.learn.peekedNote")}
        </p>
      ) : null}
      <div role="group" aria-label={t("web.wordbook.learn.rate.group")} className="flex gap-2">
        <button type="button" className={cn(GHOST_DOCK, "h-12 flex-1 px-2")} disabled={busy} onClick={() => onRate("unknown")}>
          <CircleXIcon aria-hidden className="text-ink-2" />{t("web.wordbook.learn.rate.unknown")}
        </button>
        <button type="button" className={cn(GHOST_DOCK, "h-12 flex-1 px-2")} disabled={busy} onClick={() => onRate("fuzzy")}>
          <CircleHelpIcon aria-hidden className="text-amber" />{t("web.wordbook.learn.rate.fuzzy")}
        </button>
        <button type="button" className={cn(PRIMARY, "h-12 flex-1 px-2")} disabled={busy} onClick={() => onRate("know")}
          aria-describedby={peeked ? note : undefined}>
          <CircleCheckIcon aria-hidden />{t("web.wordbook.learn.rate.know")}
        </button>
      </div>
    </Dock>
  );
}

/** 抽查说明条(视觉稿 04 / 06 .spotbar):蓝色浅底 + 图标、标题、一行说明。学新词的本轮抽查与复习抽查共用。 */
export function SpotBar({ title, hint }: { title: string; hint: string }) {
  return (
    <div data-testid="spot-bar" className="mb-2 flex items-start gap-2.5 rounded-card bg-blue-tint px-3.5 py-3 plate liquid:rounded-tile">
      <SearchCheckIcon aria-hidden className="mt-px h-5 w-5 flex-none text-blue" />
      <div className="min-w-0">
        <p className="text-body font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-sub text-ink-2">{hint}</p>
      </div>
    </div>
  );
}

const BADGE ="inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-meta font-semibold";
const TONE: Record<Rating, string> = { know: "bg-green-tint text-green", fuzzy: "bg-amber-tint text-amber", unknown: "bg-surface-2 text-ink-2" };
// 液态:徽标是 well 胶囊,颜色只留在图标与文字上之外一律回到墨色(R-LG10)
const TONE_LQ = " liquid:rounded-full liquid:bg-wash liquid:text-ink";
const ICON = { know: CircleCheckIcon, fuzzy: CircleHelpIcon, unknown: CircleXIcon } as const;

/** 自评结果徽标(视觉稿 .rb:文字 + 底色 + 图标,不只靠颜色)。`check` = 本轮抽查中的「认识」。 */
export function RatingBadge({ rating, check = false }: { rating: Rating; check?: boolean }) {
  const { t } = useTranslation();
  const Icon = ICON[rating];
  return (
    <span data-testid="rating-badge" data-rating={rating} className={cn(BADGE, TONE[rating], TONE_LQ)}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {t(check && rating === "know" ? "web.wordbook.learn.badge.knowCheck" : `web.wordbook.learn.badge.${rating}`)}
    </span>
  );
}
