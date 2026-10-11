import "./locales";
import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "~/components/avatar";
import { cn } from "~/lib/cn";
import type { Persona } from "./types";

export interface PersonaChipProps {
  persona: Persona | null;
  /** 会话里记着的角色 id(列表还没取到时用于测试与 data 属性) */
  pendingId?: string | null;
  disabled?: boolean;
  onClick(): void;
}

/** 顶栏角色 chip(R-W15):中性首字头像 + 名字 + 下拉;无角色时星光图标 +「角色」。 */
export function PersonaChip({ persona, pendingId = null, disabled = false, onClick }: PersonaChipProps) {
  const { t } = useTranslation();
  const name = persona?.name ?? null;
  const label = name ? t("web.agents.chip.label", { name }) : t("web.agents.chip.choose");
  return (
    <button type="button" data-testid="agent-persona-chip" data-persona={persona?.id ?? pendingId ?? ""} aria-label={label} title={label}
      disabled={disabled} onClick={onClick}
      className="hit-expand inline-flex h-8 max-w-[132px] flex-none items-center gap-1.5 rounded-full bg-surface-2 pl-1 pr-2 text-sub font-medium text-ink transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {name ? (
        <span aria-hidden className="flex-none"><Avatar name={name} className="h-6 w-6 text-label" /></span>
      ) : (
        <span aria-hidden className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface text-ink-2">
          <SparklesIcon className="h-3.5 w-3.5" />
        </span>
      )}
      <span className={cn("truncate whitespace-nowrap", persona?.disabled && "line-through")}>{name ?? t("web.agents.chip.choose")}</span>
      <ChevronDownIcon aria-hidden className="h-3.5 w-3.5 flex-none text-ink-3" />
    </button>
  );
}
