import { ClockIcon, SparklesIcon, TargetIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * 实时预览(设计稿 .pv):真正的页面背景(page-bg)+ 一张 E1 卡片 + 一条 E2 悬浮条(真实模糊);纵向 flex 排布,不叠放文字。
 * 悬浮条只有图标(规则 4)。这一条是本页唯一自己的模糊层(INDEX §7)。
 */
export function PreviewCard() {
  const { t } = useTranslation();
  return (
    <div className="page-bg relative flex min-h-[196px] flex-col gap-2.5 overflow-hidden rounded-inset p-2.5" data-testid="appearance-preview">
      <p aria-hidden className="text-sub leading-[1.55] text-ink-2">{t("web.appearance.previewText")}</p>
      <div className="mat-surface flex items-center gap-2.5 rounded-tile px-3.5 py-2.5 text-sub">
        <span aria-hidden className="well flex size-[34px] flex-none items-center justify-center rounded-full"><TargetIcon className="size-5" /></span>
        <span className="min-w-0 flex-1 truncate text-ink">{t("web.appearance.previewCard")}</span>
        <span className="flex-none text-ink-2">{t("web.appearance.previewValue")}</span>
        <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
      </div>
      <div aria-hidden className="mat-chrome-bar mt-auto flex h-12 flex-none items-center gap-1 rounded-full px-1.5">
        <span className="flex size-10 items-center justify-center text-ink"><ClockIcon className="size-5" /></span>
        <span className="flex size-10 items-center justify-center text-ink"><SparklesIcon className="size-5" /></span>
        <span className="flex-1" />
        <span className="flex size-9 items-center justify-center rounded-full bg-blue text-on-blue shadow-accent"><SparklesIcon className="size-[18px]" /></span>
      </div>
    </div>
  );
}
