// 只被 web/src/plugins/ 导入(architecture.test.ts):沉睡词的「我的」一行与 /me/activation 路由(计划 L4 Task 15)。
// 核心贡献(不写 link / requiresLinks):激活不是联动,显示由组件自己读 /api/activation/config 决定。
// 页面懒加载;主包只有这个文件和 me-row。
import { createElement, lazy, Suspense } from "react";
import type { ApiClient } from "~/api/client";
import { contribute, contributePromptHint, contributeRoute } from "~/lib/extension-points";
import { fetchPromptHint } from "./activation-api";
import { ActivationMeRow } from "./me-row";

const LazyDormantPage = lazy(() => import("./dormant-page").then((m) => ({ default: m.DormantPage })));
const DormantRoute = () => createElement(Suspense, { fallback: null }, createElement(LazyDormantPage));

contribute({ point: "meRows", id: "activation.row", order: 85, component: ActivationMeRow });
contributeRoute({ id: "activation.page", path: "/me/activation", component: DormantRoute });

/** 本机的偏移(分钟,UTC+8 为 480),与服务端 `tz_offset_minutes` 同义,用来算本地日。 */
export function localOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset();
}

/** 对话提示词补充(计划 L4 Task 16):沉睡词的一段英文指令;开关关时接口 404,这里按没有处理。 */
export async function dormantPromptHint(api: ApiClient, signal: AbortSignal): Promise<string | null> {
  return (await fetchPromptHint(api, localOffsetMinutes(), signal)).block;
}

contributePromptHint({ id: "activation.dormant", load: dormantPromptHint });
