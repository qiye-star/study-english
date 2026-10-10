import { createElement, lazy, Suspense } from "react";
import { contribute, contributeRoute } from "~/lib/extension-points";
import { MistakesRow } from "./mistakes-row";

// 联动插件 3 易错词(spec §6.3):生词本入口 + /links/mistakes 页(懒加载;加载中不渲染)。
const LazyMistakesPage = lazy(() => import("./mistakes-page").then((m) => ({ default: m.MistakesPage })));
const MistakesRoute = () => createElement(Suspense, { fallback: null }, createElement(LazyMistakesPage));

contribute({ point: "notebookViews", id: "mistakes.row", order: 10, link: "mistakes", component: MistakesRow });
contributeRoute({ id: "mistakes.page", path: "/links/mistakes", link: "mistakes", component: MistakesRoute });
