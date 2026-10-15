/**
 * 长按判定(计划 2026-10-14-review-bilingual-longpress R-L2 / R-L3;2026-10-15 移到 lib/,全站长按查词也用它):纯状态机,不碰计时器与 DOM。
 * 计时器由 use-long-press.ts 负责:到点时调 fire(),这里只回答「这次按压是否还有效」;时间只用于吞点击窗口(调用方传入)。
 */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP_PX = 8;
/** 长按触发并松手后,这段时间内的第一个 click 是同一手势的尾巴,吞掉。 */
export const CLICK_SWALLOW_MS = 400;

export interface Point { x: number; y: number }

export const movedTooFar = (from: Point, x: number, y: number, slop = LONG_PRESS_SLOP_PX): boolean =>
  Math.hypot(x - from.x, y - from.y) > slop;

export function createLongPress(slop = LONG_PRESS_SLOP_PX, swallowMs = CLICK_SWALLOW_MS) {
  let press: (Point & { id: string }) | null = null;
  let fired = false;
  let swallowUntil: number | null = null;
  return {
    /** 按下:开始一次新的按压(忘掉上一次的吞点击窗口) */
    down(id: string, x: number, y: number): void {
      press = { id, x, y };
      fired = false;
      swallowUntil = null;
    },
    /** 移动;超出 slop 就作废这次按压并返回 true(调用方清计时器)。已触发后不再理会移动。 */
    move(x: number, y: number): boolean {
      if (press === null || fired || !movedTooFar(press, x, y, slop)) return false;
      press = null;
      return true;
    },
    /** 计时器到点:按压仍有效就返回它的 id(只触发一次),否则 null。 */
    fire(): string | null {
      if (press === null || fired) return null;
      fired = true;
      return press.id;
    },
    /** 松手:这次按压已触发的话,打开吞点击窗口。 */
    up(at: number): void {
      if (press !== null && fired) swallowUntil = at + swallowMs;
      press = null;
      fired = false;
    },
    /** pointercancel / 滚动:作废,不吞点击(取消后浏览器不会再发 click)。 */
    cancel(): void {
      press = null;
      fired = false;
    },
    /** click 到达:在窗口内就吞(返回 true),只吞一次。 */
    swallowClick(at: number): boolean {
      const hit = swallowUntil !== null && at <= swallowUntil;
      swallowUntil = null;
      return hit;
    },
    /** 正在按着且还没触发 */
    pressing(): boolean {
      return press !== null && !fired;
    },
  };
}
