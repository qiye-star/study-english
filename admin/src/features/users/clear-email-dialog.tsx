import { ConfirmDialog } from "../../components/confirm-dialog";
import { clearUserEmail } from "./api";
import { S } from "./strings";

/** 清除邮箱(operator + 二次验证 + 理由):只解绑邮箱,不撤销登录令牌。成功后回调,由调用方刷新。 */
export function ClearEmailDialog({ open, userId, onClose, onCleared }: {
  open: boolean;
  userId: string | number;
  onClose: () => void;
  onCleared: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      danger
      title={S.email.clear.title}
      body={S.email.clear.body}
      confirmText={S.email.clear.confirm}
      reasonRequired
      onClose={onClose}
      onConfirm={async (reason) => {
        await clearUserEmail(userId, reason);
        onCleared();
      }}
    />
  );
}
