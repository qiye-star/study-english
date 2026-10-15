import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GlassTopBar, useScrolled, useScrollRoot } from "~/components/glass-top-bar";
import { IconButton } from "~/components/icon-button";
import { cn } from "@renderer/lib/utils";

/** 会话页顶栏(视觉稿 04/05/10):左侧 × 回到背单词首页,标题 + 进度副标题。 */
export function SessionHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scrolled = useScrolled(useScrollRoot());
  return (
    <GlassTopBar title={title} subtitle={subtitle} scrolled={scrolled}
      leading={<IconButton label={t("web.wordbook.session.close")} onClick={() => navigate("/wordbook")}><XIcon /></IconButton>} />
  );
}

/** 会话进度条(视觉稿 .step):已完成青色、当前蓝色、其余 surface-2。 */
export function StepBar({ done, total, current = true }: { done: number; total: number; current?: boolean }) {
  const { t } = useTranslation();
  if (total <= 0) return null;
  return (
    <div role="progressbar" aria-label={t("web.wordbook.session.progress")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
      className="flex gap-1 pb-2.5 pt-1">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={cn("block h-1 flex-1 rounded-sm", i < done ? "bg-teal liquid:bg-ink/85" : i === done && current ? "bg-blue" : "bg-surface-2")} />
      ))}
    </div>
  );
}
