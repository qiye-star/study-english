import "./locales";
import { BookOpenIcon, BookmarkIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StepSheet } from "./step-sheet";
import { stepLabel } from "./step-labels";
import { sourcesOf } from "./trace";
import type { AgentStep, AgentTrace } from "./types";
import { useAgentSettings } from "./use-agents-data";

export interface SourceChipsProps {
  trace: AgentTrace | null | undefined;
}

/** 回复下方的来源标签(视觉稿 2 屏,青色);点开看原步骤。show_process 关闭时不显示(R-W14)。 */
export function SourceChips({ trace }: SourceChipsProps) {
  const { t } = useTranslation();
  const { settings } = useAgentSettings();
  const [detail, setDetail] = useState<AgentStep | null>(null);
  const items = trace ? sourcesOf(trace.steps) : [];
  if (!items.length || settings?.showProcess === false) return null;
  return (
    <>
      <div data-testid="agent-sources" className="flex flex-wrap gap-1.5">
        {items.map((s) => {
          const word = s.params?.word;
          const Icon = s.key === "word_lookup" ? BookOpenIcon : BookmarkIcon;
          return (
            <button key={s.id} type="button" data-testid="agent-source" onClick={() => setDetail(s)}
              className="hit-expand inline-flex h-7 items-center gap-1 rounded-full bg-teal-tint px-2.5 text-meta font-medium text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {s.key === "word_lookup" && typeof word === "string" ? t("web.agents.sources.lookup", { word }) : stepLabel(t, s)}
            </button>
          );
        })}
      </div>
      <StepSheet step={detail} onClose={() => setDetail(null)} />
    </>
  );
}
