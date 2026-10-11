import {
  AlertTriangleIcon, BookOpenIcon, BookmarkIcon, BrainIcon, CalendarClockIcon, CheckIcon, ChevronDownIcon, CircleCheckIcon, FlameIcon,
  LightbulbIcon, LoaderIcon, MinusIcon, type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { stepLabel, stepSub, stepTitle } from "./step-labels";
import type { AgentStep, AgentThought, AgentTrace } from "./types";

const TOOL_ICON: Record<string, LucideIcon> = {
  word_lookup: BookOpenIcon, learned_words: BookmarkIcon, weak_words: FlameIcon, due_words: CalendarClockIcon, memory: BrainIcon,
};
const sectionClass = "px-3 pb-1 pt-2 text-label font-semibold tracking-eyebrow text-ink-2";
const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function StatusIcon({ status }: { status: AgentStep["status"] }) {
  const base = "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full";
  if (status === "done") return <span aria-hidden className={cn(base, "bg-green-tint text-green")}><CheckIcon className="h-3 w-3" /></span>;
  if (status === "run") return <span aria-hidden className={cn(base, "bg-blue-tint text-blue")}><LoaderIcon className="h-3 w-3 animate-spin motion-reduce:animate-none" /></span>;
  if (status === "fail") return <span aria-hidden className={cn(base, "bg-red-tint text-red")}><AlertTriangleIcon className="h-3 w-3" /></span>;
  return <span aria-hidden className={cn(base, "bg-surface-2 text-ink-2")}><MinusIcon className="h-3 w-3" /></span>;
}

function ContextRow({ step }: { step: AgentStep }) {
  const { t } = useTranslation();
  const sub = step.status === "skip" ? t("web.agents.process.skippedNote") : stepSub(t, step);
  return (
    <div data-testid="agent-context-row" data-status={step.status} className="flex items-center gap-2 px-3 py-1.5 text-sub">
      <StatusIcon status={step.status} />
      <span className="min-w-0 flex-1">
        <span className="block text-ink">{stepTitle(t, step)}</span>
        {sub && <span className="block text-meta text-ink-2">{sub}</span>}
      </span>
      {typeof step.ms === "number" && <span className="num flex-none text-meta text-ink-2">{(step.ms / 1000).toFixed(1)}s</span>}
    </div>
  );
}

function StatusPill({ step, onRetry }: { step: AgentStep; onRetry?: () => void }) {
  const { t } = useTranslation();
  const pill = "inline-flex h-6 flex-none items-center whitespace-nowrap rounded-full px-2 text-meta font-medium";
  if (step.status === "fail" && onRetry) {
    return (
      <button type="button" data-testid="agent-tool-retry" onClick={onRetry} className={cn(pill, "hit-expand bg-surface text-red", focusClass)}>
        {t("web.agents.process.retry")}
      </button>
    );
  }
  if (step.status === "run") return <span className={cn(pill, "bg-blue-tint text-blue")}>{t("web.agents.process.status.run")}</span>;
  if (step.status === "done") {
    return <span className={cn(pill, "bg-green-tint text-green")}>{typeof step.ms === "number" ? t("web.agents.process.doneMs", { ms: step.ms }) : t("web.agents.process.status.done")}</span>;
  }
  if (step.status === "fail") return <span className={cn(pill, "bg-surface text-red")}>{t("web.agents.process.status.fail")}</span>;
  return <span className={cn(pill, "border-[0.5px] border-hair bg-surface text-ink-2")}>{t("web.agents.process.status.skip")}</span>;
}

function ToolRow({ step, onOpen, onRetry }: { step: AgentStep; onOpen(): void; onRetry?: () => void }) {
  const { t } = useTranslation();
  const failed = step.status === "fail";
  const Icon = TOOL_ICON[step.key] ?? BookOpenIcon;
  const personal = step.key !== "word_lookup"; // 读个人数据的工具 = 琥珀;查词 = 青(一色一义)
  const note = failed ? t("web.agents.process.failedNote") : step.status === "skip" ? t("web.agents.process.skippedNote") : stepSub(t, step);
  return (
    <div className={cn("flex items-center gap-2 rounded-[10px] pr-2.5", failed ? "bg-red-tint" : "bg-surface-2")}>
      <button type="button" data-testid="agent-tool-row" data-status={step.status} onClick={onOpen}
        className={cn("flex min-h-tap min-w-0 flex-1 items-center gap-2.5 rounded-[10px] py-1.5 pl-2.5 text-left", focusClass)}>
        <span aria-hidden className={cn("flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg",
          failed ? "bg-surface text-red" : personal ? "bg-amber-tint text-amber" : "bg-teal-tint text-teal")}>
          {failed ? <AlertTriangleIcon className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sub font-medium", failed ? "text-red" : "text-ink")}>
            {failed ? t("web.agents.process.failed", { name: stepLabel(t, step) }) : stepTitle(t, step)}
          </span>
          {note && <span className={cn("block truncate text-meta", failed ? "text-red" : "text-ink-2")}>{note}</span>}
        </span>
      </button>
      <StatusPill step={step} onRetry={onRetry} />
    </div>
  );
}

function ThoughtBlock({ thought }: { thought: AgentThought }) {
  const { t } = useTranslation();
  return (
    <div data-testid="agent-thought" data-source={thought.source} className="mx-2 mb-2 rounded-[10px] bg-surface-2 px-3 py-2">
      <p className="mb-0.5 flex items-center gap-1 text-label text-ink-2">
        <LightbulbIcon aria-hidden className="h-3.5 w-3.5" />
        {t("web.agents.process.thought")} · {t(thought.source === "summary" ? "web.agents.process.thoughtSummary" : "web.agents.process.thoughtReasoning")}
      </p>
      <p className="whitespace-pre-wrap break-words text-sub leading-body text-ink">{thought.text}</p>
    </div>
  );
}

/** 展开的过程卡(视觉稿 1、2 屏)。完成后上下文合成一行,工具一行一个,思路单独一块并标明来源。 */
export function ProcessCard({ view, generating, onCollapse, onOpenStep, onRegenerate }: {
  view: AgentTrace;
  generating: boolean;
  onCollapse?: () => void;
  onOpenStep(step: AgentStep): void;
  onRegenerate?: () => void;
}) {
  const { t } = useTranslation();
  const context = view.steps.filter((s) => s.group === "context");
  const tools = view.steps.filter((s) => s.group === "tool");
  const doneContext = context.filter((s) => s.status === "done");
  return (
    <div data-testid="agent-process-card" data-state={generating ? "running" : "done"}
      className="overflow-hidden rounded-card border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none">
      <div className="flex items-center gap-2 border-b-[0.5px] border-hair-2 px-3 py-2 text-meta text-ink-2">
        {generating
          ? <LoaderIcon aria-hidden className="h-4 w-4 animate-spin text-blue motion-reduce:animate-none" />
          : <CircleCheckIcon aria-hidden className="h-4 w-4 text-green" />}
        <b role={generating ? "status" : undefined} className="text-sub font-semibold text-ink">
          {t(generating ? "web.agents.process.preparing" : "web.agents.process.done")}
        </b>
        <span className="num ml-auto">{t("web.agents.process.elapsed", { seconds: (view.ms / 1000).toFixed(1) })}</span>
        {onCollapse && (
          <button type="button" data-testid="agent-process-collapse" aria-label={t("web.agents.process.collapse")} onClick={onCollapse}
            className={cn("hit-expand -mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3", focusClass)}>
            <ChevronDownIcon aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
      {context.length > 0 && (
        <>
          <p className={sectionClass}>{generating ? t("web.agents.process.context") : t("web.agents.process.contextCount", { count: context.length })}</p>
          {generating ? context.map((s) => <ContextRow key={s.id} step={s} />) : (
            <>
              {doneContext.length > 0 && (
                <div data-testid="agent-context-summary" className="flex items-center gap-2 px-3 py-1.5 text-sub text-ink">
                  <StatusIcon status="done" />
                  <span className="min-w-0 flex-1">{doneContext.map((s) => [stepTitle(t, s), stepSub(t, s)].filter(Boolean).join(" ")).join(" · ")}</span>
                </div>
              )}
              {context.filter((s) => s.status !== "done").map((s) => <ContextRow key={s.id} step={s} />)}
            </>
          )}
        </>
      )}
      {tools.length > 0 && (
        <>
          <p className={sectionClass}>{generating ? t("web.agents.process.toolsTitle") : t("web.agents.process.toolsCount", { count: tools.length })}</p>
          <ul className="space-y-1 px-2 pb-2">
            {tools.map((s) => <li key={s.id}><ToolRow step={s} onOpen={() => onOpenStep(s)} onRetry={onRegenerate} /></li>)}
          </ul>
        </>
      )}
      {view.thought && <ThoughtBlock thought={view.thought} />}
    </div>
  );
}
