/** 点两下:同一行、间隔 ≤ 300 ms(计划 2026-10-13-review-after-answer R-A9)。纯函数 + 一个小状态机,时间由调用方传入(`performance.now()`)。 */
export const DOUBLE_TAP_MS = 300;
/** 识别过双击后,这段时间内的原生 dblclick 视为同一次手势(去重)。 */
const DBLCLICK_DEDUP_MS = 600;

export interface TapMark { id: string; at: number }

export function isDoubleTap(prev: TapMark | null, id: string, at: number, windowMs = DOUBLE_TAP_MS): boolean {
  return prev !== null && prev.id === id && at - prev.at >= 0 && at - prev.at <= windowMs;
}

export function createTapTracker(windowMs = DOUBLE_TAP_MS) {
  let last: TapMark | null = null;
  let firedAt: number | null = null;
  return {
    /** 记一次点按;这一下让它成了双击就返回 true(并清掉标记:第三下重新数)。 */
    tap(id: string, at: number): boolean {
      if (isDoubleTap(last, id, at, windowMs)) {
        last = null;
        firedAt = at;
        return true;
      }
      last = { id, at };
      return false;
    },
    /** 原生 dblclick 兜底(系统双击间隔 > 窗口的用户):识别过双击之后紧跟的那一个去重。 */
    dblclick(at: number): boolean {
      const duplicate = firedAt !== null && at - firedAt < DBLCLICK_DEDUP_MS;
      firedAt = at;
      return !duplicate;
    },
    reset(): void {
      last = null;
      firedAt = null;
    },
  };
}
