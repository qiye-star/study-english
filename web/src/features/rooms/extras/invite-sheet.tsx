/**
 * 邀请面板(spec §3.4、§6.3;玻璃底部弹层):链接(可复制)、本地生成的二维码、系统分享、房主「重置链接」。
 * 审批房间只有房主能取链接(isOwner=false 时说明原因)。车道 WE,任务 WE3 替换实现,签名不变。
 *
 * F5 桩:不渲染。
 */
export function InviteSheet(_props: {
  open: boolean; onOpenChange(v: boolean): void; roomId: string; isOwner: boolean; joinMode: "code" | "approval";
}): JSX.Element | null {
  return null;
}
