import "./locales";
import { LQ_CHIP } from "~/components/liquid";
import { ChevronRightIcon, LoaderIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProcessCard } from "./process-card";
import { StepSheet } from "./step-sheet";
import { liveAsTrace, summarize } from "./trace";
import type { AgentStep, AgentTrace, LiveTrace } from "./types";
import { useAgentSettings } from "./use-agents-data";

export interface ProcessCapsuleProps {
  /** 生成中的过程 */
  live?: LiveTrace | null;
  /** 已存的压缩过程(刷新后,messages.agent_trace) */
  trace?: AgentTrace | null;
  generating: boolean;
  /** 覆盖用户设置 show_process(房间等调用方) */
  showProcess?: boolean;
  /** 失败行的「重试」与详情里的「重新生成」:只给最新一条回复(R-W13) */
  onRegenerate?: () => void;
  /** 折叠时整行文字的替代(联机:「Emma 已回答 · 对 Lin」) */
  label?: string;
  testId?: string;
}

/** 生成中每 100 ms 刷新一次用时;不生成时不计时。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const quietClass = `inline-flex items-center gap-1.5 self-start rounded-full bg-blue-tint px-2.5 py-1 text-meta font-medium text-blue ${LQ_CHIP} liquid:h-auto`;

/** 过程胶囊(spec §5、D1):生成中强制展开,结束后折叠成一行;点开看「上下文 → 工具 → 思路」。 */
export function ProcessCapsule({ live = null, trace = null, generating, showProcess, onRegenerate, label, testId = "agent-capsule" }: ProcessCapsuleProps) {
  const { t } = useTranslation();
  const { settings } = useAgentSettings(showProcess === undefined);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AgentStep | null>(null);
  const now = useNow(generating);
  useEffect(() => {
    if (!generating) setOpen(false);
  }, [generating]);

  const show = showProcess ?? settings?.showProcess ?? true;
  if (!show) {
    return generating ? <span data-testid="agent-process-quiet" role="status" className={quietClass}>{t("web.agents.process.replying")}</span> : null;
  }
  const view: AgentTrace | null = live && (generating || !trace) ? liveAsTrace(live, now) : trace;
  if (!view) {
    return generating ? (
      <span data-testid="agent-process-quiet" role="status" className={quietClass}>
        <LoaderIcon aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{t("web.agents.process.preparing")}
      </span>
    ) : null;
  }
  if (generating || open) {
    return (
      <>
        <ProcessCard view={view} generating={generating} onCollapse={generating ? undefined : () => setOpen(false)}
          onOpenStep={setDetail} onRegenerate={generating ? undefined : onRegenerate} />
        <StepSheet step={detail} onClose={() => setDetail(null)} onRegenerate={generating ? undefined : onRegenerate} />
      </>
    );
  }
  const { seconds, tools } = summarize(view);
  return (
    <button type="button" data-testid={testId} aria-expanded={false} aria-label={label ? `${label}. ${t("web.agents.process.expand")}` : t("web.agents.process.expand")}
      onClick={() => setOpen(true)}
      className="inline-flex min-h-tap items-center self-start rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-2 pr-2.5 text-meta text-ink-2">
        <SparklesIcon aria-hidden className="h-3.5 w-3.5" />
        {label ?? (
          <span>
            <b className="font-medium text-ink">{t("web.agents.process.summary", { seconds })}</b>
            {tools > 0 && <> · {t("web.agents.process.toolsUsed", { count: tools })}</>}
          </span>
        )}
        <ChevronRightIcon aria-hidden className="h-3 w-3 text-ink-3" />
      </span>
    </button>
  );
}
