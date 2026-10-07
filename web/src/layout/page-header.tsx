import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GlassTopBar, useScrolled, useScrollRoot } from "~/components/glass-top-bar";
import { IconButton } from "~/components/icon-button";

/**
 * 页面顶栏:AppShell 的滚动区 scrollTop > 4 时变玻璃,否则透明。actions 放 IconButton。
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scrolled = useScrolled(useScrollRoot());
  return (
    <GlassTopBar
      title={title}
      subtitle={subtitle}
      scrolled={scrolled}
      actions={actions}
      leading={
        back ? (
          <IconButton label={t("web.common.back")} onClick={() => navigate(back)}>
            <ChevronLeftIcon />
          </IconButton>
        ) : undefined
      }
    />
  );
}
