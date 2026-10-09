import { useEffect } from "react";
import { AssistTray } from "../assist-tray";
import type { AssistEntry } from "../room-state";

/**
 * 助手停靠面板(spec 2026-10-10 §5):输入条之上、实色、不遮挡也不吞触摸;三档吸附 row(52px)/ mid(28vh)/ max(40vh);
 * 软键盘弹出时收成一行;面板高度经 onHeight 报给房间页(列表底部内边距)。车道 WA,任务 WA2 替换实现,签名不变。
 * 「发送」后面板保持打开(R2-11);「改一改」= onEdit(房间页把目标切回群聊、收成一行)。
 *
 * F5 桩:沿用 v1 的底部弹层 AssistTray(发送或编辑后关闭,同 v1),onHeight(0)。
 */
export type DockSnap = "row" | "mid" | "max";
export interface AssistDockProps {
  open: boolean; snap: DockSnap; keyboardOpen: boolean; entries: AssistEntry[]; disabled: boolean; offline: boolean;
  onSnap(snap: DockSnap): void; onClose(): void; onAsk(text: string): boolean;
  onSend(text: string, assistId: string): void; onEdit(text: string): void; onHeight(px: number): void;
}

export function AssistDock({ open, entries, disabled, offline, onClose, onAsk, onSend, onEdit, onHeight }: AssistDockProps): JSX.Element | null {
  useEffect(() => { onHeight(0); }, [onHeight]);
  return (
    <AssistTray open={open} onOpenChange={(v) => { if (!v) onClose(); }} entries={entries} disabled={disabled} offline={offline}
      onAsk={onAsk}
      onSend={(text, assistId) => { onSend(text, assistId); onClose(); }}
      onEdit={(text) => { onEdit(text); onClose(); }} />
  );
}
