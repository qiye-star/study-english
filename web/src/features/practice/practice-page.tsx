import { HistoryIcon, ListChecksIcon, MicIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { IconChip } from "~/components/icon-chip";
import { LQ_PAGE, LQ_PRIMARY } from "~/components/liquid";
import { ListRow, SectionGroup } from "~/components/section-group";
import { SurfaceCard } from "~/components/surface-card";
import { RankMiniCard } from "~/features/rank";
import { WordbookMiniCard } from "~/features/wordbook";
import { PageHeader } from "~/layout/page-header";
import { useLiquid } from "~/lib/glass-flag";
import { Slot } from "~/lib/extension-points-react";
import { PRACTICE_DRAFT_KEY as DRAFT_KEY, readJson } from "~/lib/storage";
import { cn } from "~/lib/cn";
import { RecentScores } from "./recent-scores";

const isString = (v: unknown): v is string => typeof v === "string";

/** 顶栏右侧 44px 图标链接,外观同 IconButton */
const ICON_LINK = cn(
  "relative inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-[22px] [&_svg]:w-[22px]",
  "well liquid:rounded-full",
);

/** 顶栏副标题:今天的日期(随界面语言) */
function useToday(language: string): string {
  const [now] = useState(() => new Date());
  try {
    return now.toLocaleDateString(language, { weekday: "short", month: "long", day: "numeric" });
  } catch {
    return now.toLocaleDateString();
  }
}

/**
 * 跟读大卡:只负责进入跟读页(/practice/shadow)。卡片文字与麦克风按钮都只是导航,不在这里录音。
 * 预览读的是同一个草稿键(PRACTICE_DRAFT_KEY);挂载时读一次,返回本页会重新挂载。
 */
function ShadowEntry() {
  const { t } = useTranslation();
  const [draft] = useState(() => readJson(DRAFT_KEY, isString)?.trim() ?? "");
  return (
    <SurfaceCard strong className="flex items-center gap-3 p-4" data-testid="practice-shadow-card">
      <Link to="/practice/shadow" data-testid="practice-shadow-open"
        className="min-w-0 flex-1 rounded-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="block text-body font-semibold tracking-heading text-ink">{t("web.practice.home.shadowing")}</span>
        <span data-testid="practice-shadow-preview" className={cn("mt-1 block truncate text-meta", draft ? "text-ink-2" : "text-ink-3")}>
          {draft ? `${t("web.practice.home.draftLabel")}${draft}` : t("web.practice.home.shadowHint")}
        </span>
      </Link>
      <Link to="/practice/shadow" data-testid="practice-shadow-mic" aria-label={t("web.practice.home.shadowStart")}
        className={cn(
          "flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-blue text-on-blue transition-colors duration-fast active:bg-blue/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-6 [&_svg]:w-6",
          LQ_PRIMARY,
        )}>
        <MicIcon aria-hidden />
      </Link>
    </SurfaceCard>
  );
}

/** 练习首页(小卡入口):跟读大卡 → 段位 / 生词本两张小卡 → 最近评分 → 历史。 */
export function PracticePage() {
  const { t, i18n } = useTranslation();
  const today = useToday(i18n.language);
  const liquid = useLiquid();
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        large
        title={t("web.practice.home.title")}
        subtitle={today}
        actions={
          <>
            <span data-testid="practice-header-slot" className="contents liquid:[&_[data-testid=changelog-dot]]:bg-blue"><Slot point="practiceHeaderActions" props={{}} /></span>
            <Link to="/practice/list" data-testid="practice-list" aria-label={t("web.practice.list.title")} className={ICON_LINK}>
              <ListChecksIcon aria-hidden />
            </Link>
          </>
        }
      />
      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>
        <div className="mt-2">
          <ShadowEntry />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <RankMiniCard />
          <WordbookMiniCard />
        </div>
        <Slot point="practiceHome" props={{}} />
        {liquid && <RecentScores />}
        <SectionGroup title={t("web.practice.home.more")}>
          <ListRow icon={<IconChip tone="gray" icon={HistoryIcon} />} title={t("web.practice.historyTitle")} to="/practice/history" testId="practice-history" />
        </SectionGroup>
      </div>
    </div>
  );
}
