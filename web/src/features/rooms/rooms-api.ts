import type { ApiClient } from "~/api/client";

export interface RoomsConfig { enabled: boolean; aiAvailable: boolean; maxMembers: number; maxText: number }

export function fetchRoomsConfig(api: ApiClient, signal?: AbortSignal): Promise<RoomsConfig> {
  return api.request<RoomsConfig>("GET", "/api/rooms/config", { signal });
}
