// 智能体记忆接口(spec 2026-10-12-agents §4.5、§8.4;计划 A2 S9)。
// 服务端响应 snake_case,ApiClient 自动转 camelCase;请求体的键自动转 snake_case(值不受影响)。
// 档案键都是单个英文单词(计划 R-M7):editedKeys 里的值不会被转换,与 profile 的键一一对应。
// 记忆文本只在内存里流转:永不进 URL(只有记忆 / 回顾 id、kind、cursor、limit)与日志。
import type { ApiClient } from "~/api/client";

export const MEMORY_KINDS = ["fact", "preference", "goal", "weakness", "progress"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const PROFILE_KEYS = ["level", "goals", "interests", "native", "correction", "schedule"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];
export const CORRECTIONS = ["gentle", "direct", "asked"] as const;
export type Correction = (typeof CORRECTIONS)[number];
export const EXPORT_FILENAME = "agent-memory.json";

export interface Profile { level?: Level; goals?: string[]; interests?: string[]; native?: string; correction?: Correction; schedule?: string }
/** null = 删除这个键(并记为「你改过」)。 */
export type ProfileValues = { [K in ProfileKey]?: Profile[K] | null };
export interface ProfileState { profile: Profile; editedKeys: ProfileKey[]; proposals: Profile; memoryEnabled: boolean; memoryAvailable: boolean }
/** name 为 null = 角色已删除(R-M14)。persona 为 null = 所有角色共享。 */
export interface PersonaRef { id: string; name: string | null }
export interface MemoryItem {
  id: string; kind: MemoryKind; text: string; importance: number; pinned: boolean; persona: PersonaRef | null;
  source: "chat" | "tutor" | "room"; createdAt: string; updatedAt: string;
}
export interface PersonaCount { persona: PersonaRef | null; count: number }
export interface ItemsPage { items: MemoryItem[]; nextCursor: string | null; personaCounts: PersonaCount[] }
export interface Recap { id: string; source: "conversation" | "tutor"; persona: PersonaRef | null; conversationId: string | null; text: string; createdAt: string }
export interface RecapsPage { recaps: Recap[]; nextCursor: string | null }
export interface ClearResult { scope: "all" | "persona"; deleted: { items: number; recaps: number; threads: number; profile: boolean } }

/** 服务端错误原文 → i18n key(传给 translateServerError 的 extra 表)。 */
export const MEMORY_SERVER_ERRORS: Record<string, string> = {
  "Agents are disabled": "web.agents.memory.errors.disabled",
  "Memory not found": "web.agents.memory.errors.notFound",
  "Recap not found": "web.agents.memory.errors.notFound",
  "Confirmation required": "web.agents.memory.errors.confirm",
  "Invalid profile value": "web.agents.memory.errors.invalidProfile",
  "Nothing to update": "web.agents.memory.errors.invalidProfile",
  "Invalid cursor": "web.agents.memory.errors.generic",
  "persona_id is required": "web.agents.memory.errors.generic",
};

const BASE = "/api/agents/memory";
const id = (value: string) => encodeURIComponent(value);

export const fetchProfile = (api: ApiClient, signal?: AbortSignal) =>
  api.request<ProfileState>("GET", `${BASE}/profile`, { signal });

export const patchProfile = (api: ApiClient, input: { values?: ProfileValues; dismiss?: ProfileKey[] }) =>
  api.request<ProfileState>("PATCH", `${BASE}/profile`, { json: { values: input.values ?? {}, dismiss: input.dismiss ?? [] } });

export const fetchItems = (
  api: ApiClient, opts: { kind?: MemoryKind; cursor?: string | null; limit?: number } = {}, signal?: AbortSignal,
) =>
  api.request<ItemsPage>("GET", `${BASE}/items`, {
    query: { ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.cursor ? { cursor: opts.cursor } : {}), limit: opts.limit ?? 30 },
    signal,
  });

export const deleteItem = (api: ApiClient, itemId: string) =>
  api.request<{ id: string }>("DELETE", `${BASE}/items/${id(itemId)}`);

export const pinItem = (api: ApiClient, itemId: string, pinned: boolean) =>
  api.request<MemoryItem>("POST", `${BASE}/items/${id(itemId)}/pin`, { json: { pinned } });

export const fetchRecaps = (api: ApiClient, cursor?: string | null, signal?: AbortSignal) =>
  api.request<RecapsPage>("GET", `${BASE}/recaps`, { query: cursor ? { cursor } : {}, signal });

export const deleteRecap = (api: ApiClient, recapId: string) =>
  api.request<{ id: string }>("DELETE", `${BASE}/recaps/${id(recapId)}`);

/** 原样下载(as: "blob",不做 camelCase 转换)。 */
export const exportMemory = (api: ApiClient) => api.request<Blob>("GET", `${BASE}/export`, { as: "blob" });

export const clearMemory = (api: ApiClient, scope: "all" | "persona", personaId?: string) =>
  api.request<ClearResult>("DELETE", BASE, { json: { confirm: true, scope, ...(scope === "persona" ? { personaId } : {}) } });

/** 暂停 / 恢复记忆:写 A1 的用户级智能体设置(spec §4.3 memory_enabled;计划 R-M6)。 */
export const setMemoryEnabled = (api: ApiClient, enabled: boolean) =>
  api.request<unknown>("PATCH", "/api/agents/settings", { json: { memoryEnabled: enabled } });
