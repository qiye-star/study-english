import type { JoinRequestInfo } from "../protocol";

/**
 * 房主在顶栏下方看到的「lily 想加入 · 同意 / 拒绝」条(spec §3.4)。决定后 onDecided(id)(房间页本地移除;
 * 实时事件 join_request_closed 也会移除)。车道 WC,任务 WC3 替换实现,签名不变。房间页只给房主渲染它。
 *
 * F5 桩:不渲染。
 */
export function JoinRequestBanner(_props: { roomId: string; requests: JoinRequestInfo[]; onDecided(id: string): void }): JSX.Element | null {
  return null;
}
