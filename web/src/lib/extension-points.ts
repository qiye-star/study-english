import type { ComponentType } from "react";

/**
 * 扩展点注册表(spec 2026-10-11-learning-links §8):消费方渲染插槽,提供方登记贡献,彼此不导入。
 * 纯 TS(只类型导入 React);旗标 = 服务端 /api/links/config 的每用户 effective,未加载前全关(ALL_OFF)。
 */
export const LINK_KEYS = ["word_actions", "daily_tasks", "mistakes", "pron_shadow", "chat_words", "rank_sources"] as const;
export type LinkKey = (typeof LINK_KEYS)[number];
export interface LinkFlags { enabled: boolean; links: Record<LinkKey, boolean> }
export const ALL_OFF: LinkFlags = Object.freeze({
  enabled: false,
  links: Object.freeze(Object.fromEntries(LINK_KEYS.map((k) => [k, false])) as Record<LinkKey, boolean>),
});

export function flagsFromConfig(config: { enabled: boolean; links: { key: string; effective: boolean }[] }): LinkFlags {
  const links = Object.fromEntries(LINK_KEYS.map((k) => [k, false])) as Record<LinkKey, boolean>;
  for (const l of config.links) if ((LINK_KEYS as readonly string[]).includes(l.key)) links[l.key as LinkKey] = l.effective === true;
  return { enabled: config.enabled === true, links };
}

export type WordSource = "lookup" | "recap" | "progress" | "manual";
/** 与 features/vocabulary 的 VocabularyInput 同形(由测试保持上限一致)。 */
export interface WordTarget { word: string; meaning?: string; example?: string; source: WordSource }
export const MAX_WORD_TARGET = { word: 100, meaning: 1000, example: 500 } as const;
export interface WordActionProps { target: WordTarget; testId: string; label?: string; variant: "icon" | "labeled" }
export interface TodayCounts { practiceToday: number; chatMessagesToday: number; conversationsToday: number }

type Empty = Record<string, never>;
export interface PointProps {
  wordActions: WordActionProps;
  wordActionsMenu: WordActionProps & { close: () => void };
  dailyTasks: { today: TodayCounts | null };
  practiceHome: Empty;
  learningSources: { pick: (text: string) => void };
  wordDetailSections: { word: string };
  notebookViews: Empty;
  meRows: Empty;
  appEffects: Empty;
}
export type PointName = keyof PointProps;
export const POINT_NAMES: readonly PointName[] = ["wordActions", "wordActionsMenu", "dailyTasks", "practiceHome",
  "learningSources", "wordDetailSections", "notebookViews", "meRows", "appEffects"];

interface Gated { id: string; link?: LinkKey; requiresLinks?: boolean }
export interface Contribution<N extends PointName> extends Gated { point: N; order?: number; component: ComponentType<PointProps[N]> }
export interface RouteContribution extends Gated { path: string; component: ComponentType }

/** 有联动键 → 总开关且该联动有效;requiresLinks → 总开关;都没有 = 核心贡献,永远可见。 */
export function visible(c: Gated, flags: LinkFlags): boolean {
  if (c.link) return flags.enabled && flags.links[c.link] === true;
  if (c.requiresLinks) return flags.enabled;
  return true;
}

export function createExtensionRegistry() {
  const byPoint = new Map<PointName, Contribution<PointName>[]>();
  const routes: RouteContribution[] = [];
  const listeners = new Set<() => void>();
  let flags: LinkFlags = ALL_OFF;
  return {
    contribute<N extends PointName>(c: Contribution<N>): void {
      const list = byPoint.get(c.point) ?? [];
      if (list.some((x) => x.id === c.id)) throw new Error(`duplicate contribution ${c.point}/${c.id}`);
      byPoint.set(c.point, [...list, c as unknown as Contribution<PointName>]);
    },
    contributeRoute(r: RouteContribution): void {
      if (routes.some((x) => x.id === r.id || x.path === r.path)) throw new Error(`duplicate route ${r.path}`);
      routes.push(r);
    },
    contributionsFor<N extends PointName>(point: N, f: LinkFlags = flags): Contribution<N>[] {
      return ((byPoint.get(point) ?? []) as unknown as Contribution<N>[])
        .filter((c) => visible(c, f))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    },
    routesFor(f: LinkFlags = flags): RouteContribution[] {
      return routes.filter((r) => visible(r, f));
    },
    /** 全部路由贡献(不按旗标过滤):app.tsx 用它挂路由,由 `LinkRoute` 按旗标决定渲染 / 等待 / 跳回。 */
    allRoutes(): RouteContribution[] {
      return [...routes];
    },
    getLinkFlags: (): LinkFlags => flags,
    setLinkFlags(next: LinkFlags): void {
      if (next === flags) return;
      flags = next;
      for (const l of [...listeners]) l();
    },
    subscribeLinkFlags(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

const registry = createExtensionRegistry();
export const {
  contribute, contributeRoute, contributionsFor, routesFor, allRoutes, getLinkFlags, setLinkFlags, subscribeLinkFlags,
} = registry;

let slotRenderer = false;
/** extension-points-react 求值时调用。test/setup.ts 据此只给「能渲染插槽」的测试文件加载核心贡献。 */
export function markSlotRendererLoaded(): void {
  slotRenderer = true;
}
export const slotRendererLoaded = (): boolean => slotRenderer;
