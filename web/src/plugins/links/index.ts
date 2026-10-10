import { createElement, lazy, Suspense } from "react";
import { contribute, contributeRoute } from "~/lib/extension-points";
import { LinksConfigLoader } from "./links-config";
import { LinksMeRow } from "./links-me-row";

// 设置页懒加载(主包增长有验收上限,spec §17);加载中不渲染任何东西。
const LazySettingsPage = lazy(() => import("./links-settings-page").then((m) => ({ default: m.LinksSettingsPage })));
const LinksSettingsRoute = () => createElement(Suspense, { fallback: null }, createElement(LazySettingsPage));

contribute({ point: "appEffects", id: "links.config", component: LinksConfigLoader });
contribute({ point: "meRows", id: "links.row", order: 90, requiresLinks: true, component: LinksMeRow });
contributeRoute({ id: "links.settings", path: "/me/links", requiresLinks: true, component: LinksSettingsRoute });
