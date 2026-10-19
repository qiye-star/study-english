import { useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { ClearEmailDialog } from "./clear-email-dialog";
import { S } from "./strings";

/**
 * 用户详情页的邮箱卡片:只显示脱敏地址与验证状态;清除邮箱需要 operator。
 * 清除成功后调用 onChanged,由页面重新读取用户(刷新这一行)。
 */
export function UserEmailCard({ userId, emailMasked, emailVerified, onChanged }: {
  userId: string | number;
  emailMasked: string | null;
  emailVerified: boolean;
  onChanged: () => void;
}) {
  const session = useAdminSession();
  const operator = hasRole(session, "operator");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const bound = !!emailMasked;

  return (
    <section className="panel flex items-center justify-between gap-4 px-4 py-3.5" aria-label={S.email.card.title}>
      <div className="min-w-0">
        <p className="eyebrow">{S.email.card.title}</p>
        {bound ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="num min-w-0 break-all">{emailMasked}</span>
            <span className={`badge ${emailVerified ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>
              {emailVerified ? S.email.verified : S.email.unverified}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-base font-semibold text-muted">{S.email.unbound}</p>
        )}
        <p className="mt-0.5 text-xs text-muted">{S.email.card.hint}</p>
        {message && (
          <p role="status" className="mt-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
            {message}
          </p>
        )}
      </div>
      {operator && bound && (
        <button type="button" className="btn-danger btn-sm shrink-0" onClick={() => setOpen(true)}>
          {S.email.card.clear}
        </button>
      )}
      <ClearEmailDialog
        open={open}
        userId={userId}
        onClose={() => setOpen(false)}
        onCleared={() => {
          setOpen(false);
          setMessage(S.email.card.cleared);
          onChanged();
        }}
      />
    </section>
  );
}
