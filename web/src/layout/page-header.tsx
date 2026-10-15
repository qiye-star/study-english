import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GlassTopBar, useScrolled, useScrollRoot } from "~/components/glass-top-bar";
import { IconButton } from "~/components/icon-button";
import { useLiquid } from "~/lib/glass-flag";

/**
 * 页面顶栏:AppShell 的滚动区 scrollTop > 4 时变玻璃,否则透明。actions 放 IconButton。
 * 液态皮肤(计划 2026-10-15-liquid-glass R-L2-3):large(根页面)= E0 上的大标题 30/700 + 13px 副标题,滚动 60px 后出现标题胶囊;
 * 返回键与 actions 只渲染一份:静止时在大标题行,出现胶囊后进胶囊。非 large:胶囊常驻,副标题是胶囊下方的一行(不放在模糊层上)。
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  large = false,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string;
  actions?: ReactNode;
  large?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const liquid = useLiquid();
  const scrolled = useScrolled(useScrollRoot(), liquid && large ? 60 : 4);
  const leading = back ? (
    <IconButton label={t("web.common.back")} onClick={() => navigate(back)}>
      <ChevronLeftIcon />
    </IconButton>
  ) : undefined;
  if (liquid && large) {
    return (
      <>
        <GlassTopBar title={title} scrolled={scrolled} floating="scrolled"
          leading={scrolled ? leading : undefined} actions={scrolled ? actions : undefined} />
        <div className="-mt-11 flex items-end gap-2.5 px-5 pb-[18px] pt-3.5">
          {!scrolled && leading ? <span className="-ml-3 self-start">{leading}</span> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-large text-ink">{title}</h1>
            {subtitle ? <p className="mt-1 truncate text-sub text-ink-2">{subtitle}</p> : null}
          </div>
          {!scrolled && actions ? <div className="flex flex-none items-center gap-1">{actions}</div> : null}
        </div>
      </>
    );
  }
  if (liquid) {
    return (
      <>
        <GlassTopBar title={title} scrolled={scrolled} actions={actions} leading={leading} />
        {subtitle ? <p className="truncate px-5 pt-1 text-sub text-ink-2">{subtitle}</p> : null}
      </>
    );
  }
  return (
    <GlassTopBar
      title={title}
      subtitle={subtitle}
      scrolled={scrolled}
      actions={actions}
      leading={leading}
    />
  );
}
