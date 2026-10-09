import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { deleteUser } from "./api";
import { S } from "./strings";

/** 删除用户(超级管理员 + 二次验证):必须原样输入用户名并填写理由;成功后回到用户列表。 */
export function DeleteUserDialog({ open, userId, username, onClose }: { open: boolean; userId: string | number; username: string; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <ConfirmDialog
      open={open}
      danger
      title={S.remove.title}
      body={S.remove.body(username)}
      confirmText={S.remove.confirm}
      requireTyping={username}
      reasonRequired
      onClose={onClose}
      onConfirm={async (reason) => {
        await deleteUser(userId, username, reason);
        onClose();
        navigate("/users", { replace: true });
      }}
    />
  );
}
