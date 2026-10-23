import { parseEmphasis } from "./emphasis";

/** 一个可动画的片段:英文按词(带标点)、中文按字(标点并入前一个字);空白单独成段、不动画。 */
export interface GreetingToken {
  text: string;
  space: boolean;
  em: boolean;
}

// 空白 | 英文词(+ 尾随标点)| 汉字(+ 尾随标点)| 其他单个字符
const TOKEN = /(\s+)|([“"‘(（]*[A-Za-z0-9'’\-/]+[^\sA-Za-z0-9一-鿿“"‘(（]*)|([“"‘(（]*[一-鿿][^\sA-Za-z0-9一-鿿“"‘(（]*)|(\S)/gu;

export function tokenizeGreeting(line: string): GreetingToken[] {
  const out: GreetingToken[] = [];
  for (const part of parseEmphasis(line)) {
    for (const m of part.text.matchAll(TOKEN)) out.push({ text: m[0], space: m[1] !== undefined, em: part.em });
  }
  return out;
}

/** 逐词错开时间:词数 × stagger 超过 maxSpan 时压缩,保证单行铺开不超过 maxSpan。 */
export function staggerFor(words: number, stagger: number, maxSpan = 0): number {
  return maxSpan > 0 && words * stagger > maxSpan ? maxSpan / words : stagger;
}

export interface GreetingTimeline {
  /** 每行开始出现的时刻(ms,相对弹窗出现)。 */
  starts: number[];
  /** 底部数据淡入 + 计数开始。 */
  statsAt: number;
  /** 倒计时开始 = 最后一行开始出现。 */
  countdownAt: number;
}

/*
 * 时间轴(演示页 buildGreeting):350 第 1 行 → 1350 第 2 行 → 2250 第 3 行;第 2 行开始后 500 ms 底部数据出现。
 * 减弱动效:没有逐词铺开,每行淡入(≤ 600 ms 内全部开始),倒计时同样从最后一行出现时算起。
 */
export function greetingTimeline(lineCount: number, reduced: boolean): GreetingTimeline {
  const starts: number[] = [];
  let t = 350;
  for (let i = 0; i < lineCount; i += 1) {
    starts.push(reduced ? Math.min(t, 600) : t);
    t += i === 0 ? 1000 : 900;
  }
  const second = starts[Math.min(1, starts.length - 1)] ?? 0;
  return { starts, statsAt: second + 500, countdownAt: starts[starts.length - 1] ?? 0 };
}
