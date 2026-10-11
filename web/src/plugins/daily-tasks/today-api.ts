import type { ApiClient } from "~/api/client";
import type { TodayCounts } from "~/lib/extension-points";

/** `GET /api/links/today`(spec §6.2):用户本地日的跟读 / 对话计数;offset = 本地时区相对 UTC 的分钟数。 */
export function fetchTodayCounts(api: ApiClient, offset = -new Date().getTimezoneOffset(), signal?: AbortSignal): Promise<TodayCounts> {
  return api.request<TodayCounts>("GET", "/api/links/today", { query: { offset }, signal });
}
