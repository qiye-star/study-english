import type { ApiClient } from "./client";

/** 公开公告与维护状态(GET /api/announcements,无需登录,服务端缓存 60 秒)。 */

export type MaintenanceMode = "off" | "read_only" | "full";

export interface Announcement {
  id: number;
  level: "info" | "warning";
  textZh: string;
  textEn: string;
  dismissible: boolean;
  startsAt: string;
  endsAt: string | null;
}

export interface AnnouncementsState {
  announcements: Announcement[];
  maintenance: { mode: MaintenanceMode; messageZh: string; messageEn: string };
}

export async function fetchAnnouncements(api: ApiClient, signal?: AbortSignal): Promise<AnnouncementsState> {
  const raw = await api.request<Partial<AnnouncementsState>>("GET", "/api/announcements", { auth: false, signal, timeoutMs: 15_000 });
  const m = raw.maintenance;
  const mode: MaintenanceMode = m?.mode === "read_only" || m?.mode === "full" ? m.mode : "off";
  return {
    announcements: Array.isArray(raw.announcements) ? raw.announcements : [],
    maintenance: { mode, messageZh: m?.messageZh ?? "", messageEn: m?.messageEn ?? "" },
  };
}
