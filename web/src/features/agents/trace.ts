import camelcaseKeys from "camelcase-keys";
import type { AgentStep, AgentThought, AgentTrace, LiveTrace, TurnEvent } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const STATUSES = ["run", "done", "fail", "skip"];

/** 一步(已 camelCase):SSE 的 step 事件带 id + labelKey,存储的压缩过程带 label、没有 id。 */
export function toStep(d: Obj, fallbackId?: string): AgentStep | null {
  const id = typeof d.id === "string" ? d.id : fallbackId;
  if (!id || (d.group !== "context" && d.group !== "tool") || !STATUSES.includes(String(d.status))) return null;
  const label = typeof d.labelKey === "string" ? d.labelKey : typeof d.label === "string" ? d.label : "";
  return {
    id,
    group: d.group,
    key: typeof d.key === "string" ? d.key : "",
    status: d.status as AgentStep["status"],
    labelKey: label,
    ...(isObj(d.params) ? { params: d.params as Record<string, string | number> } : {}),
    ...(typeof d.ms === "number" ? { ms: d.ms } : {}),
    private: d.private === true,
  };
}

export function toThought(d: unknown): AgentThought | null {
  if (!isObj(d) || (d.source !== "summary" && d.source !== "reasoning") || typeof d.text !== "string") return null;
  return { source: d.source, text: d.text };
}

/**
 * 服务端压缩过程(SSE done.trace 与 messages.agent_trace,spec §5)→ 界面形状。
 * 容忍:snake_case 或 camelCase 键、`ms` 为对象 {ctx,ttft,total}(取 total)或数字、缩到只剩 {v,tools}(无 steps)、
 * thought 带 chars 字段。不是对象 → null。
 */
export function normalizeTrace(raw: unknown): AgentTrace | null {
  if (!isObj(raw)) return null;
  const d = camelcaseKeys(raw, { deep: true }) as Obj;
  const steps = (Array.isArray(d.steps) ? d.steps : [])
    .map((s, i) => (isObj(s) ? toStep(s, `${String(s.key ?? "step")}-${i}`) : null))
    .filter((s): s is AgentStep => !!s);
  const ms = isObj(d.ms) ? d.ms.total : d.ms;
  return { v: typeof d.v === "number" ? d.v : 1, ms: typeof ms === "number" ? ms : 0, steps, thought: toThought(d.thought) };
}

export function startLive(now: number): LiveTrace {
  return { turnId: null, startedAt: now, steps: [], thought: null, meta: null, phase: "prep" };
}

/** 回合事件 → 新的生成中过程。streaming 阶段的 delta 返回同一个对象,调用方据此跳过重绘。 */
export function reduceLive(live: LiveTrace, event: TurnEvent): LiveTrace {
  switch (event.type) {
    case "start":
      return { ...live, turnId: event.turnId };
    case "step": {
      const at = live.steps.findIndex((s) => s.id === event.step.id);
      const steps = at < 0 ? [...live.steps, event.step] : live.steps.map((s, i) => (i === at ? { ...s, ...event.step } : s));
      return { ...live, steps };
    }
    case "thought":
      return { ...live, thought: event.thought };
    case "delta":
      return live.phase === "streaming" ? live : { ...live, phase: "streaming" };
    case "meta":
      return { ...live, meta: event.meta };
    case "done":
      return { ...live, phase: "done" };
    case "error":
      return { ...live, phase: "error" };
  }
}

/** 生成中的过程用存储形状展示:界面只认 AgentTrace 一种形状。 */
export function liveAsTrace(live: LiveTrace, now: number): AgentTrace {
  return { v: 1, ms: Math.max(0, now - live.startedAt), steps: live.steps, thought: live.thought };
}

/** 折叠胶囊一行的两个数:整秒(至少 1)与成功的工具数。 */
export function summarize(view: Pick<AgentTrace, "ms" | "steps">): { seconds: number; tools: number } {
  return {
    seconds: Math.max(1, Math.round(view.ms / 1000)),
    tools: view.steps.filter((s) => s.group === "tool" && s.status === "done").length,
  };
}

/** 回复下方的来源标签:成功的工具步骤,同一 key + 词只出一个。 */
export function sourcesOf(steps: AgentStep[]): AgentStep[] {
  const seen = new Set<string>();
  return steps.filter((s) => {
    if (s.group !== "tool" || s.status !== "done") return false;
    const id = `${s.key}:${String(s.params?.word ?? "")}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
