/**
 * 助手停靠面板的吸附与软键盘判定(spec 2026-10-10 rooms-v2 §5.1),纯函数,便于单测。
 * 三档:row = 52px(标题行 + 最新一条建议的摘要)、mid = 视口 28%、max = 视口 40%(上限)。
 */
export type DockSnap = "row" | "mid" | "max";

export const DOCK_ROW_PX = 52;
export const DOCK_MID = 0.28;
export const DOCK_MAX = 0.4;
/** 软键盘判定:visualViewport 比本页记录的最大值小 25% 以上 */
export const KEYBOARD_SHRINK = 0.25;

const ORDER: readonly DockSnap[] = ["row", "mid", "max"];

export function snapHeights(viewport: number): Record<DockSnap, number> {
  const mid = Math.max(DOCK_ROW_PX, Math.round(viewport * DOCK_MID));
  return { row: DOCK_ROW_PX, mid, max: Math.max(mid, Math.round(viewport * DOCK_MAX)) };
}

export function nearestSnap(height: number, viewport: number): DockSnap {
  const heights = snapHeights(viewport);
  return ORDER.reduce((best, snap) => (Math.abs(heights[snap] - height) < Math.abs(heights[best] - height) ? snap : best), ORDER[0]);
}

/** 拖动抓手:dy 为指针纵向位移(向上为负),结果夹在 [row, max] 之间 */
export function dragHeight(startHeight: number, dy: number, viewport: number): number {
  const { row, max } = snapHeights(viewport);
  return Math.min(max, Math.max(row, Math.round(startHeight - dy)));
}

/** ↑/↓ 键在三档间移动一档 */
export function stepSnap(snap: DockSnap, dir: 1 | -1): DockSnap {
  const i = ORDER.indexOf(snap) + dir;
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, i))];
}

export interface KeyboardSample {
  layoutHeight: number;
  /** visualViewport.height;不支持 visualViewport 时为 null */
  visualHeight: number | null;
  /** 本页(当前方向)记录到的最大 visualViewport 高度 */
  maxVisualHeight: number;
  inputFocused: boolean;
  coarsePointer: boolean;
}

export function keyboardOpen(sample: KeyboardSample): boolean {
  if (sample.visualHeight !== null) {
    const max = Math.max(sample.maxVisualHeight, sample.visualHeight);
    return max - sample.visualHeight > KEYBOARD_SHRINK * max;
  }
  return sample.coarsePointer && sample.inputFocused;
}
