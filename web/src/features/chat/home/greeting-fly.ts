import type { GreetingExitTargets } from "./greeting-modal";
import { animate } from "./motion";

export interface Box { left: number; top: number; width: number; height: number }
export interface Flight { dx: number; dy: number; scale: number }

export const FLY_MS = 640;
export const FLY_STAGGER_MS = 70;
/** 飞到 72% 处就位,之后与气泡文字交叉淡化(演示页 closeGreeting)。 */
export const FLY_LAND_AT = 0.72;

/**
 * 一行从弹窗位置飞到对话里对应气泡文字的位置(FLIP):以左上角为变换原点,缩放 = 目标字号 / 源字号。
 * 纯函数,jsdom 里直接测;量尺寸的部分在 `playGreetingFlyIn`。
 */
export function flyTransform(from: Box, to: Box, fromFont: number, toFont: number): Flight {
  const scale = fromFont > 0 && toFont > 0 ? toFont / fromFont : 1;
  return { dx: to.left - from.left, dy: to.top - from.top, scale };
}

/** 能飞的前提:行数相等且至少一行、不是减弱动效。否则整体淡出。 */
export function canFly(lines: number, targets: number, reduced: boolean): boolean {
  return !reduced && lines > 0 && lines === targets;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const fontOf = (el: Element) => parseFloat(getComputedStyle(el).fontSize) || 0;

const done = (animation: Animation | null) => new Promise<void>((resolve) => {
  if (!animation) return resolve();
  animation.addEventListener("finish", () => resolve());
  animation.addEventListener("cancel", () => resolve());
});

/** 对话里问候气泡的落点:带 `data-greet-target` 序号的包装层里的正文(没有就用包装层本身)。 */
export function greetingTargets(root: ParentNode = document): HTMLElement[] {
  const wraps = Array.from(root.querySelectorAll<HTMLElement>("[data-greet-target]"))
    .sort((a, b) => Number(a.dataset.greetTarget) - Number(b.dataset.greetTarget));
  return wraps.map((w) => w.querySelector<HTMLElement>("[data-lookup-context]") ?? w);
}

/**
 * 弹窗关闭的退场(传给 `GreetingModal.playExit`):各行逐行飞向对话里对应的问候气泡(640 ms,行间 70 ms),
 * 日期与底部淡出,背景 520 ms 淡出。对话还没渲染好 / 行数不等 / 减弱动效 / 没有 Web Animations → 整体淡出。
 */
export function playGreetingFlyIn(t: GreetingExitTargets, targets: HTMLElement[] = greetingTargets()): Promise<void> {
  const fade = (el: Element, ms: number) => done(animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" }));
  if (!canFly(t.lines.length, targets.length, t.reduced) || typeof t.root.animate !== "function") {
    return fade(t.root, t.reduced ? 180 : 320);
  }
  const runs = t.lines.map((line, i) => {
    const { dx, dy, scale } = flyTransform(boxOf(line), boxOf(targets[i]), fontOf(line), fontOf(targets[i]));
    line.style.transformOrigin = "0 0";
    return done(animate(line, [
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) scale(${scale})`, opacity: 1, offset: FLY_LAND_AT },
      { transform: `translate(${dx}px,${dy}px) scale(${scale})`, opacity: 0 },
    ], { duration: FLY_MS, delay: i * FLY_STAGGER_MS, easing: "cubic-bezier(.2,0,0,1)", fill: "forwards" }));
  });
  runs.push(fade(t.date, 300), fade(t.bottom, 300), fade(t.bg, 520));
  return Promise.all(runs).then((): void => undefined);
}
