// 抽屉左滑关闭的手势判定(纯函数,FR7):横向位移 > 10 px 且 > 1.2 × 纵向才接管;
// 松手位移超过 min(80px, 25% 宽)关闭,否则回弹;接管后吞掉随后的 click。

export const TAKE_OVER_PX = 10;
export const TAKE_OVER_RATIO = 1.2;
export const CLOSE_MAX_PX = 80;
export const CLOSE_WIDTH_FRACTION = 0.25;

export interface SwipeState {
  startX: number;
  startY: number;
  width: number;
  /** null = 还没判定;true = 接管(横向);false = 放行(纵向滚动) */
  taking: boolean | null;
  /** 面板的向左位移(≤ 0,px),接管后才非 0 */
  offset: number;
}

export const swipeStart = (x: number, y: number, width: number): SwipeState => ({ startX: x, startY: y, width, taking: null, offset: 0 });

export function swipeMove(s: SwipeState, x: number, y: number): SwipeState {
  const dx = x - s.startX;
  const dy = y - s.startY;
  let taking = s.taking;
  if (taking === null) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax <= TAKE_OVER_PX && ay <= TAKE_OVER_PX) return s;
    taking = ax > TAKE_OVER_PX && ax > TAKE_OVER_RATIO * ay && dx < 0; // 只有向左(关闭方向)才接管
  }
  if (!taking) return s.taking === taking ? s : { ...s, taking };
  return { ...s, taking, offset: Math.max(-s.width, Math.min(0, dx)) };
}

export interface SwipeEnd {
  close: boolean;
  /** 接管过:调用方要吞掉紧随其后的 click */
  swallowClick: boolean;
}

export function swipeEnd(s: SwipeState): SwipeEnd {
  if (!s.taking) return { close: false, swallowClick: false };
  const threshold = Math.min(CLOSE_MAX_PX, s.width * CLOSE_WIDTH_FRACTION);
  return { close: -s.offset > threshold, swallowClick: true };
}
