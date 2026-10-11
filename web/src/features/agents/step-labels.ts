import type { TFunction } from "i18next";
import type { AgentStep } from "./types";

/**
 * 步骤名按 key 取文案:服务端的 `agents.step.<key>` 对应 `web.agents.step.<key>`(INDEX X11);
 * 服务端新增的 key 显示通用「步骤」(`web.agents.step.unknown`),不显示原始键。
 */
export const stepLabel = (t: TFunction, step: Pick<AgentStep, "key">): string =>
  t(`web.agents.step.${step.key}`, { defaultValue: t("web.agents.step.unknown") });

/** 「查词 · abandon」:参数里只有词本身(spec §4.4)。 */
export function stepTitle(t: TFunction, step: AgentStep): string {
  const word = step.params?.word;
  return typeof word === "string" && word ? `${stepLabel(t, step)} · ${word}` : stepLabel(t, step);
}

export function stepSub(t: TFunction, step: AgentStep): string {
  const count = step.params?.count;
  return typeof count === "number" ? t("web.agents.process.count", { count }) : "";
}

export function formatParams(params: AgentStep["params"]): string {
  const entries = Object.entries(params ?? {});
  return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "—";
}
