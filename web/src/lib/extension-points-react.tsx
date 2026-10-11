import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from "react";
import { Navigate } from "react-router-dom";
import {
  ALL_OFF, contributionsFor, getLinkFlags, markSlotRendererLoaded, subscribeLinkFlags, visible, type Contribution,
  type LinkFlags, type PointName, type PointProps, type RouteContribution, type WordActionProps,
} from "./extension-points";

markSlotRendererLoaded();

export function useLinkFlags(): LinkFlags {
  return useSyncExternalStore(subscribeLinkFlags, getLinkFlags, getLinkFlags);
}

export function useContributions<N extends PointName>(point: N): Contribution<N>[] {
  return contributionsFor(point, useLinkFlags());
}

/** 一个贡献出错只让它自己消失;不打印 props(可能含词)。 */
class SlotBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { console.warn(`[slot] ${this.props.name} failed`); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function Slot<N extends PointName>({ point, props }: { point: N; props: PointProps[N] }) {
  const items = useContributions(point);
  return (
    <>
      {items.map((c) => {
        const C = c.component as ComponentType<PointProps[N]>;
        return <SlotBoundary key={c.id} name={`${point}/${c.id}`}><C {...props} /></SlotBoundary>;
      })}
    </>
  );
}

/** 「加入生词本」等单词动作的插槽(spec §6.1);全关时只有 vocabulary 的核心按钮。 */
export function WordActions(props: WordActionProps) {
  return <Slot point="wordActions" props={props} />;
}

/**
 * 路由贡献的守卫:旗标允许 → 渲染页面;旗标还没加载(仍是 ALL_OFF 本身)→ 先什么都不渲染,
 * 这样刷新或直达 `/me/links` 不会在旗标到达前被兜底路由送回练习页;加载后不允许 → 回练习页(= 今天的兜底行为)。
 */
export function LinkRoute({ route, fallback = "/practice" }: { route: RouteContribution; fallback?: string }) {
  const flags = useLinkFlags();
  if (visible(route, flags)) {
    const C = route.component;
    return <C />;
  }
  return flags === ALL_OFF ? null : <Navigate to={fallback} replace />;
}
