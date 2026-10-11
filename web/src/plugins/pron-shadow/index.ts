// 联动插件 4 发音弱词 ↔ 跟读(spec §6.4):跟读来源条两片、生词本入口、弱词页(懒加载)。
import { createElement, lazy, Suspense } from "react";
import { contribute, contributeRoute } from "~/lib/extension-points";
import { TodayWordsChip, WeakWordsChip } from "./sources-strip";
import { WeakWordsRow } from "./weak-words-row";

const LazyWeakWordsPage = lazy(() => import("./weak-words-page").then((m) => ({ default: m.WeakWordsPage })));
const WeakWordsRoute = () => createElement(Suspense, { fallback: null }, createElement(LazyWeakWordsPage));

contribute({ point: "learningSources", id: "pron.weak", order: 10, link: "pron_shadow", component: WeakWordsChip });
contribute({ point: "learningSources", id: "pron.today", order: 20, link: "pron_shadow", component: TodayWordsChip });
contribute({ point: "notebookViews", id: "pron.row", order: 20, link: "pron_shadow", component: WeakWordsRow });
contributeRoute({ id: "pron.weak-words", path: "/links/weak-words", link: "pron_shadow", component: WeakWordsRoute });
