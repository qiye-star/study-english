import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Dialog } from "../../components/dialog";
import { resetPassword } from "./api";
import { S } from "./strings";

/** 一次性显示的机密(临时密码、邀请码):等宽大字 + 复制;只在组件状态里,关闭即丢弃。 */
export function OnceSecret({ value, copyLabel, copiedLabel }: { value: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false); // 非 HTTPS / 无权限:管理员手动选中复制
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-sunken px-3 py-2.5">
      <code className="num min-w-0 flex-1 select-all break-all text-md font-semibold tracking-wide">{value}</code>
      <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => void copy()}>
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}

/** 重置密码:确认 → 服务端生成临时密码 → 只显示一次。 */
export function ResetPasswordDialog({ open, userId, onClose }: { open: boolean; userId: string | number; onClose: () => void }) {
  const [password, setPassword] = useState<string | null>(null);

  const close = () => {
    setPassword(null);
    onClose();
  };

  if (password !== null) {
    return (
      <Dialog
        open
        title={S.reset.resultTitle}
        onClose={() => undefined}
        footer={
          <button type="button" className="btn-primary btn-sm" onClick={close}>
            {S.reset.close}
          </button>
        }
      >
        <p className="leading-relaxed text-fg-2">{S.reset.resultBody}</p>
        <OnceSecret value={password} copyLabel={S.reset.copy} copiedLabel={S.reset.copied} />
      </Dialog>
    );
  }
  return (
    <ConfirmDialog
      open={open}
      title={S.reset.title}
      body={S.reset.body}
      onClose={close}
      onConfirm={async () => setPassword(await resetPassword(userId))}
    />
  );
}
