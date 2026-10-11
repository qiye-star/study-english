import { ApiError, type ApiClient } from "~/api/client";
import { AGENTS_DISABLED, type AgentSettings, type AgentSettingsPatch, type AgentsConfig, type AgentsConfigWire, type Persona, type PersonaDraft } from "./types";

/** 服务端只接受 reason(spec §4.5 / A1 ReportIn extra=forbid):没有备注字段。 */
export type ReportReason = "unsafe" | "offensive" | "spam" | "other";

const personaPath = (id: string) => `/api/agents/personas/${encodeURIComponent(id)}`;

/** 线上配置 → 前端扁平形状;关闭(只有 enabled:false)得到 AGENTS_DISABLED。 */
export function normalizeConfig(wire: AgentsConfigWire): AgentsConfig {
  if (!wire.enabled) return AGENTS_DISABLED;
  return {
    enabled: true,
    available: wire.available !== false,
    tutorEnabled: wire.tutor === true,
    memoryEnabled: wire.memory === true,
    roomsEnabled: wire.rooms === true,
    promptMaxChars: wire.limits?.promptMaxChars ?? AGENTS_DISABLED.promptMaxChars,
    personasMax: wire.limits?.personasMax ?? AGENTS_DISABLED.personasMax,
    historyMax: wire.limits?.historyMax ?? AGENTS_DISABLED.historyMax,
    textMaxChars: wire.limits?.textMaxChars ?? AGENTS_DISABLED.textMaxChars,
  };
}

/** spec §4.5 的 REST(登录用户)。`config` 与 `try` 两个端点由 A1 提供(R-W8、R-W9)。 */
export const agentsApi = {
  config: (api: ApiClient, signal?: AbortSignal) =>
    api.request<AgentsConfigWire>("GET", "/api/agents/config", { signal }).then(normalizeConfig),
  personas: (api: ApiClient) => api.request<{ personas: Persona[] }>("GET", "/api/agents/personas"),
  persona: (api: ApiClient, id: string) => api.request<Persona>("GET", personaPath(id)),
  createPersona: (api: ApiClient, draft: PersonaDraft) => api.request<Persona>("POST", "/api/agents/personas", { json: draft }),
  updatePersona: (api: ApiClient, id: string, patch: Partial<PersonaDraft>) => api.request<Persona>("PATCH", personaPath(id), { json: patch }),
  deletePersona: (api: ApiClient, id: string) => api.request<{ id: string }>("DELETE", personaPath(id)),
  reportPersona: (api: ApiClient, id: string, report: { reason: ReportReason }) =>
    api.request<{ ok: boolean }>("POST", `${personaPath(id)}/report`, { json: report }),
  tryPersona: (api: ApiClient, draft: PersonaDraft, text: string) =>
    api.request<{ text: string }>("POST", "/api/agents/personas/try", { json: { persona: draft, text }, timeoutMs: 30_000 }),
  settings: (api: ApiClient) => api.request<AgentSettings>("GET", "/api/agents/settings"),
  patchSettings: (api: ApiClient, patch: AgentSettingsPatch) => api.request<AgentSettings>("PATCH", "/api/agents/settings", { json: patch }),
};

/** 角色写操作的错误 → 文案键。按状态码判断:服务端的英文文案不是契约。 */
export function personaErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409 || err.status === 429) return "web.agents.editor.errors.limit";
    if (err.status === 400 || err.status === 422) return "web.agents.editor.errors.invalid";
    if (err.status === 403 || err.status === 404) return "web.agents.errors.disabled";
  }
  return "web.agents.editor.errors.failed";
}
