import type { QuoteInfo } from "../protocol";

/**
 * 引用(spec §6.4)。车道 WE,任务 WE1 替换实现,签名不变。
 * - QuoteBlock:气泡内的引用块(左侧 2px 发丝线、名字 + 摘要;text 为空 = 「引用的消息已被隐藏」),点按 onJump(seq)。
 * - QuoteBar:输入条之上的「回复 bob:What snacks…  ×」,× = onClear。
 *
 * F5 桩:都不渲染。
 */
export function QuoteBlock(_props: { quote: QuoteInfo; onJump(seq: number): void }): JSX.Element | null {
  return null;
}

export function QuoteBar(_props: { quote: QuoteInfo; onClear(): void }): JSX.Element | null {
  return null;
}
