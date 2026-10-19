import { ConfirmDialog } from "../../components/confirm-dialog";
import { removeUserAvatar } from "./api";
import { S } from "./strings";

/**
 * 移除头像(operator + 二次验证 + 理由):理由必填并写入审计;二次验证由 request 客户端在 403 时弹出并重放。
 * 成功后回调 onDone(标记的举报数),由调用方关闭并刷新。target 为 null 时不渲染。
 */
export function RemoveAvatarDialog({ target, onClose, onDone }: {
  target: { userId: string; username: string } | null;
  onClose: () => void;
  onDone: (reportsResolved: number) => void;
}) {
  if (!target) return null;
  const copy = S.avatars.removeDialog;
  return (
    <ConfirmDialog
      open
      danger
      title={copy.title}
      body={copy.body(target.username)}
      confirmText={copy.confirm}
      reasonRequired
      onClose={onClose}
      onConfirm={async (reason) => {
        const r = await removeUserAvatar(target.userId, reason);
        onDone(r.reportsResolved);
      }}
    />
  );
}
