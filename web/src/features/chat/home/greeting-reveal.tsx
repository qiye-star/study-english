import { useLayoutEffect, useMemo, useRef } from "react";
import { animate } from "./motion";
import { staggerFor, tokenizeGreeting } from "./greeting-tokens";
import { stripEmphasis } from "./emphasis";

/* 关键帧取自演示页 FX(BlurText / SplitText,y 位移收小,更安静)。 */
const FX = {
  blur: {
    keyframes: [
      { filter: "blur(12px)", opacity: 0, transform: "translateY(-0.35em)" },
      { filter: "blur(4px)", opacity: 0.6, transform: "translateY(0.04em)", offset: 0.55 },
      { filter: "blur(0px)", opacity: 1, transform: "translateY(0)" },
    ] as Keyframe[],
    duration: 820,
    easing: "cubic-bezier(.2,0,0,1)",
  },
  split: {
    keyframes: [
      { opacity: 0, transform: "translateY(0.6em)" },
      { opacity: 1, transform: "translateY(0)" },
    ] as Keyframe[],
    duration: 560,
    easing: "cubic-bezier(.215,.61,.355,1)",
  },
};

/** 一行铺开结束的时刻(ms):副句据此在主句结束前 400 ms 出现。 */
export function revealEnd(text: string, fx: keyof typeof FX, delay: number, stagger: number, maxSpan = 0): number {
  const words = tokenizeGreeting(text).filter((t) => !t.space).length;
  return delay + Math.max(0, words - 1) * staggerFor(words, stagger, maxSpan) + FX[fx].duration;
}

export interface RevealProps {
  text: string;
  fx: keyof typeof FX;
  /** 开始时刻(ms)。 */
  delay: number;
  stagger: number;
  /** 单行铺开的上限(ms),词多时压缩 stagger。 */
  maxSpan?: number;
  reduced: boolean;
  className?: string;
}

/**
 * 逐词(英文)/ 逐字(中文)模糊落下或上浮。逐字 span 一律 aria-hidden,另放一份 sr-only 全文(无 `*`)。
 * 减弱动效:不拆动画,整段 240 ms 淡入(delay ≤ 600)。强调片段包进 nowrap 容器,避免 "have / gone" 断行。
 */
export function RevealText({ text, fx, delay, stagger, maxSpan = 0, reduced, className }: RevealProps) {
  const root = useRef<HTMLSpanElement>(null);
  const tokens = useMemo(() => tokenizeGreeting(text), [text]);
  const words = tokens.filter((t) => !t.space).length;
  const step = staggerFor(words, stagger, maxSpan);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const anims: Animation[] = [];
    if (reduced) {
      const a = animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: Math.min(delay, 600), fill: "backwards" });
      if (a) anims.push(a);
    } else {
      el.querySelectorAll<HTMLElement>("[data-tk]").forEach((tk, i) => {
        const a = animate(tk, FX[fx].keyframes, { duration: FX[fx].duration, delay: delay + i * step, easing: FX[fx].easing, fill: "backwards" });
        if (a) anims.push(a);
      });
    }
    return () => anims.forEach((a) => a.cancel());
  }, [text, fx, delay, step, reduced]);

  // 把强调词的 token 聚成一个 nowrap 容器
  const nodes: JSX.Element[] = [];
  let run: JSX.Element[] | null = null;
  let k = 0;
  const flush = () => {
    if (run) nodes.push(<span key={`r${k++}`} className="greet-em-run">{run}</span>);
    run = null;
  };
  tokens.forEach((tk, i) => {
    const node = tk.space ? (
      <span key={i} className="greet-sp">{tk.text}</span>
    ) : tk.em ? (
      <em key={i} data-tk className="greet-tk greet-em">{tk.text}</em>
    ) : (
      <span key={i} data-tk className="greet-tk">{tk.text}</span>
    );
    if (tk.em) (run ??= []).push(node);
    else {
      flush();
      nodes.push(node);
    }
  });
  flush();

  return (
    <>
      <span ref={root} aria-hidden="true" className={className}>{nodes}</span>
      <span className="sr-only">{stripEmphasis(text)}</span>
    </>
  );
}
