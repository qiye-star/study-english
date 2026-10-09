import type { TFunction } from "i18next";
import { toast } from "sonner";
import type { ApiClient } from "~/api/client";
import { fetchRankMe, type RankMe } from "./rank-api";

/**
 * GET /api/rank/me 解锁新成就并且只返回这一次:无论哪里先拉到(练习首页与「我的」的段位卡、段位页)都要提示,否则就永远看不到了。
 * 不传 AbortSignal:页面卸载(含 StrictMode 的试卸载)也让请求完成并提示,调用方自己决定是否还用返回的资料。
 */
export async function loadRankMe(api: ApiClient, t: TFunction): Promise<RankMe> {
  const me = await fetchRankMe(api);
  if (me.newAchievements.length) toast.success(t("web.rank.newAchievements", { count: me.newAchievements.length }));
  return me;
}
