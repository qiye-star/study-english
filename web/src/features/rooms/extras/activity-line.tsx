import type { RoomMemberInfo } from "../protocol";
import type { RoomState } from "../room-state";

/**
 * 输入条之上一行 12px 次要色「lily 正在输入…」/「bob 正在说话…」(spec §6.5):最多 2 个名字,其余「等 3 人」;不含自己。
 * 过期(6 秒)由 reducer 的 activity_expire 处理。车道 WE,任务 WE2 替换实现,签名不变。
 *
 * F5 桩:不渲染。
 */
export function ActivityLine(_props: { activity: RoomState["activity"]; members: RoomMemberInfo[]; meId: number | null }): JSX.Element | null {
  return null;
}
