import { ArrowLeftRightIcon, LockIcon, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeTrace, ProcessCapsule, type AgentStep, type LiveTrace } from "~/features/agents";
import { cn } from "~/lib/cn";
import type { AgentStepWire } from "../protocol";
import type { AgentRun } from "../room-state";
import type { AgentRef } from "./agent-meta";

/** 智能体回复卡片头部:角色名(点按看角色信息)+ 统一的中性「智能体」标签(R-RA12,spec 没有职称字段;青色留给词汇)。 */
export function AgentName({ agent, onOpen }: { agent: AgentRef; onOpen?(personaId: string): void }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <button type="button" data-testid="room-agent-name" disabled={!onOpen} onClick={() => onOpen?.(agent.personaId)}
        className="min-w-0 truncate text-label font-semibold text-ink enabled:hover:underline">{agent.name}</button>
      <span className="flex-none rounded-full bg-surface-2 px-1.5 text-label text-ink-2">{t("web.rooms.agents.tag")}</span>
    </span>
  );
}

/** 接力提示(视觉稿第 4 屏 .handoff):A → B。 */
export function HandoffLine({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  return (
    <p data-testid="room-agent-handoff" className="mb-1 flex items-center gap-1 self-start text-meta text-ink-2">
      <ArrowLeftRightIcon aria-hidden className="size-3.5 flex-none" /><span className="min-w-0 break-words">{t("web.rooms.agents.handoff", { from, to })}</span>
    </p>
  );
}

/** 给其他成员看的一行:「Emma 已回答 · 对 Lin」(不含提问者的个人数据,spec §5)。 */
export function AnsweredFor({ name, asker }: { name: string; asker: string }) {
  const { t } = useTranslation();
  return (
    <span data-testid="room-agent-answered" className="mt-0.5 flex items-center gap-1 text-label text-ink-2">
      <SparklesIcon aria-hidden className="size-3 flex-none" /><span className="min-w-0 break-words">{t("web.rooms.agents.answeredFor", { name, asker })}</span>
    </span>
  );
}

const toStep = (s: AgentStepWire): AgentStep => ({
  id: s.id, group: s.group, key: s.key, status: s.status, labelKey: s.labelKey, private: s.private,
  ...(s.params ? { params: s.params as Record<string, string | number> } : {}), ...(typeof s.ms === "number" ? { ms: s.ms } : {}),
});

/**
 * 只有提问者看得到的过程胶囊(琥珀色「仅你可见」);生成中展开、结束后折叠由 ProcessCapsule 负责(spec D1)。
 * 实时过程来自 agentRuns(服务端只发给提问者),刷新后来自私有 agent_trace 行(trace)。showProcess 不传:沿用用户的「显示过程」设置。
 */
export function PrivateProcess({ name, run, trace, generating, align }: {
  name: string; run?: AgentRun; trace?: Record<string, unknown>; generating: boolean; align: "start" | "end";
}) {
  const { t } = useTranslation();
  const [startedAt] = useState(() => Date.now());
  const live = useMemo<LiveTrace | null>(() => (run ? {
    turnId: run.turnId, startedAt, steps: run.steps.map(toStep), thought: run.thought, meta: null, phase: generating ? "prep" : "done",
  } : null), [run, startedAt, generating]);
  const stored = useMemo(() => (trace ? normalizeTrace(trace) : null), [trace]);
  return (
    <div data-testid="room-agent-process" className={cn("mt-1 max-w-[92%]", align === "end" ? "self-end" : "self-start")}>
      <span className="mb-0.5 flex items-center gap-1 text-label font-semibold text-amber">
        <LockIcon aria-hidden className="size-3 flex-none" />{t("web.rooms.agents.privateOnly")}
      </span>
      <ProcessCapsule live={live} trace={stored} generating={generating}
        label={name ? t("web.rooms.agents.processLabel", { name }) : undefined} />
    </div>
  );
}
