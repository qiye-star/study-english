/** 智能体管理接口(spec 2026-10-12-agents §10.2;服务端 routers/admin_agents.py)。wire 是 snake_case,这里转 camelCase。
 * 角色查询用 POST(搜索词不进 URL,计划 R-C26)。 */
import { request } from "../../api/client";

export interface AgentsProbe { ok: boolean; code: string; status: number; ms: number; at: string; model: string }
export interface AgentsOverview {
  switches: { enabled: boolean; tutor: boolean; memory: boolean; rooms: boolean };
  available: boolean;
  toolsMode: { configured: string; effective: string; probe: AgentsProbe | null };
  limits: { turnsGlobalDaily: number; turnsDailyPerUser: number; tutorDailyPerUser: number; memoryExtractDailyPerUser: number; personasMax: number };
  usage: {
    days: string[]; turns: number[]; tutor: number[]; memory: number[];
    today: { turns: number; calls: number; errors: number; tokensIn: number; tokensOut: number };
  };
  personas: { total: number; disabled: number; reportsOpen: number };
  usersWithSettings: number;
}
export interface AdminPersona {
  id: string; ownerId: number | null; owner: string | null; name: string; intro: string; prompt: string;
  level: string; style: string; tools: string[]; promptPublic: boolean; deepThink: boolean; disabled: boolean;
  disabledAt: string | null; createdAt: string; updatedAt: string; reportsOpen: number;
}
export interface PersonaPage { items: AdminPersona[]; page: number; next: number | null }
export interface PersonaReportRow {
  personaId: string; name: string; owner: string | null; count: number; reasons: Record<string, number>;
  firstAt: string; lastAt: string; disabled: boolean;
}
export type PersonaStatus = "all" | "active" | "disabled" | "reported";
export type PersonaEdit = { name?: string; intro?: string; prompt?: string };

/** snake_case → camelCase(深层;与 features/wordbook/api.ts 相同,不跨 feature 导入)。 */
const camelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export function camel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camel(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = camel(v);
    return out as T;
  }
  return value as T;
}

export const fetchAgentsOverview = async (): Promise<AgentsOverview> =>
  camel<AgentsOverview>(await request<unknown>("/api/admin/agents"));

export const fetchPersonas = async (q: string, status: PersonaStatus, page = 1): Promise<PersonaPage> =>
  camel<PersonaPage>(await request<unknown>("/api/admin/agents/personas/query", { method: "POST", json: { q: q || null, status, page } }));

export const fetchPersonaReports = async (): Promise<{ reports: PersonaReportRow[] }> =>
  camel<{ reports: PersonaReportRow[] }>(await request<unknown>("/api/admin/agents/reports"));

export const disablePersona = (id: string, reason: string) =>
  request<unknown>(`/api/admin/agents/personas/${id}/disable`, { method: "POST", json: { reason } });

export const restorePersona = (id: string, reason: string) =>
  request<unknown>(`/api/admin/agents/personas/${id}/restore`, { method: "POST", json: { reason } });

export const deletePersona = (id: string, reason: string) =>
  request<unknown>(`/api/admin/agents/personas/${id}/delete`, { method: "POST", json: { reason } });

export const editPersona = (id: string, changes: PersonaEdit, reason: string) =>
  request<unknown>(`/api/admin/agents/personas/${id}`, { method: "PATCH", json: { ...changes, reason } });

export const resolveReports = (personaId: string, action: "dismiss" | "disable", reason: string) =>
  request<unknown>(`/api/admin/agents/reports/${personaId}/resolve`, { method: "POST", json: { action, reason } });

export const runToolsProbe = async (): Promise<AgentsProbe> =>
  camel<AgentsProbe>(await request<unknown>("/api/admin/agents/probe-tools", { method: "POST" }));
