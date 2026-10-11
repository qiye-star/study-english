import type { AgentTrace } from "~/features/agents";

/** 服务端对 messages.agent_trace 的上限是 4096 字节(spec §4.4);留出键名 snake_case 化多出的字节。 */
const MAX_BYTES = 3800;
const sizeOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * 随助手消息保存的过程必须放得进服务端上限:超限时整条消息对会被 422 拒绝,回复就丢了。
 * 逐级收缩:去掉思路文字 → 去掉步骤参数 → 截断步骤 → 不保存。
 */
export function traceForSave(trace: AgentTrace | null): AgentTrace | null {
  if (!trace) return null;
  let t = trace;
  if (sizeOf(t) <= MAX_BYTES) return t;
  t = { ...t, thought: null };
  if (sizeOf(t) <= MAX_BYTES) return t;
  t = { ...t, steps: t.steps.map(({ params: _params, ...rest }) => rest) };
  if (sizeOf(t) <= MAX_BYTES) return t;
  t = { ...t, steps: t.steps.slice(0, 8) };
  return sizeOf(t) <= MAX_BYTES ? t : null;
}
