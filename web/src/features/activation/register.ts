// 只被 web/src/plugins/ 导入(architecture.test.ts):沉睡词的「我的」一行与 /me/activation 路由(计划 L4 Task 15)。
// 核心贡献(不写 link / requiresLinks):激活不是联动,显示由组件自己读 /api/activation/config 决定。
// 页面懒加载;主包只有这个文件和 me-row。
import { createElement, lazy, Suspense } from "react";
import { contribute, contributeRoute } from "~/lib/extension-points";
import { ActivationMeRow } from "./me-row";

const LazyDormantPage = lazy(() => import("./dormant-page").then((m) => ({ default: m.DormantPage })));
const DormantRoute = () => createElement(Suspense, { fallback: null }, createElement(LazyDormantPage));

contribute({ point: "meRows", id: "activation.row", order: 85, component: ActivationMeRow });
contributeRoute({ id: "activation.page", path: "/me/activation", component: DormantRoute });
