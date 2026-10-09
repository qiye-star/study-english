import type { ReactionInfo, ReactionKey } from "../protocol";

/**
 * 气泡下方的回应片「👍 2」(spec §6.4):自己点过的片 blue-tint,点击切换。空列表不渲染。
 * 车道 WE,任务 WE1 替换实现,签名不变(REACTION_GLYPHS 在 ../protocol)。
 *
 * F5 桩:不渲染。
 */
export function ReactionBar(_props: { reactions: ReactionInfo[]; meId: number | null; onToggle(key: ReactionKey, on: boolean): void }): JSX.Element | null {
  return null;
}
