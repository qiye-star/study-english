import type { ApiClient } from "~/api/client";

/** 房间学习小结(spec §6.1 / §8)。「可以说得更好」只含本人的条目(R2-13),原句由服务端按 seq 从库里取。 */
export interface RoomSummaryView {
  status: "none" | "pending" | "done" | "failed" | "skipped"; reason: string | null; overviewZh: string;
  words: { en: string; zh: string; example: string }[]; myFixes: { seq: number; original: string; better: string; noteZh: string }[];
  createdAt: string | null; finishedAt: string | null;
}

/** 服务端错误原文 → i18n key(translateServerError 的 extra 表)。 */
export const SUMMARY_SERVER_ERRORS: Record<string, string> = {
  "Room is still open": "web.rooms.extras.summary.errors.open",
  "Cannot retry": "web.rooms.extras.summary.errors.cannotRetry",
  "Room not found": "web.rooms.errors.notFound",
};

const STATUSES = new Set<RoomSummaryView["status"]>(["none", "pending", "done", "failed", "skipped"]);

/** `{status:"none"}` 等缺字段的形状补成完整视图;未知状态按 none 处理(新服务端加的状态不会让页面崩)。 */
export function normalizeSummary(raw: Partial<RoomSummaryView> | null | undefined): RoomSummaryView {
  const status = raw?.status && STATUSES.has(raw.status) ? raw.status : "none";
  return {
    status, reason: raw?.reason ?? null, overviewZh: raw?.overviewZh ?? "",
    words: Array.isArray(raw?.words) ? raw.words : [], myFixes: Array.isArray(raw?.myFixes) ? raw.myFixes : [],
    createdAt: raw?.createdAt ?? null, finishedAt: raw?.finishedAt ?? null,
  };
}

const sid = (roomId: string) => `/api/rooms/${encodeURIComponent(roomId)}/summary`;

export async function getRoomSummary(api: ApiClient, roomId: string, signal?: AbortSignal): Promise<RoomSummaryView> {
  return normalizeSummary((await api.request<{ summary: Partial<RoomSummaryView> }>("GET", sid(roomId), { signal })).summary);
}

export async function retryRoomSummary(api: ApiClient, roomId: string): Promise<RoomSummaryView> {
  return normalizeSummary((await api.request<{ summary: Partial<RoomSummaryView> }>("POST", `${sid(roomId)}/retry`)).summary);
}
