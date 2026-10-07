import type { ApiClient } from "~/api/client";

export interface RealtimeConfig {
  enabled: boolean;
  maxMinutes: number;
  idleTimeoutSeconds: number;
  asrMode: "stream" | "buffered";
  sampleRateIn: number;
  sampleRateOut: number;
}

export const REALTIME_SERVER_ERRORS: Record<string, string> = {
  "Realtime is not enabled": "web.realtime.errors.disabled",
};

export function fetchRealtimeConfig(api: ApiClient, signal?: AbortSignal): Promise<RealtimeConfig> {
  return api.request("GET", "/api/realtime/config", { signal });
}

export function createRealtimeTicket(api: ApiClient, conversationId: string, signal?: AbortSignal): Promise<{ ticket: string; expiresIn: number }> {
  return api.request("POST", "/api/realtime/ticket", { json: { conversationId }, signal });
}

/** 一次性票据放在查询串里(60 s、只能用一次);登录令牌从不进 URL(设计文档 §3.5)。 */
export function realtimeUrl(ticket: string, loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/realtime?ticket=${encodeURIComponent(ticket)}`;
}
