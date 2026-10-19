import { useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { RemoveAvatarDialog } from "./remove-avatar-dialog";
import { S } from "./strings";

/** 头像缩略图:同源 /api/avatars/<id>,不带 Referer;装饰性图片,alt 为空。 */
export function AvatarThumb({ url, size = 40 }: { url: string; size?: number }) {
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full border border-line object-cover"
    />
  );
}

/**
 * 用户详情页的头像卡片:没有头像时不渲染;有头像时显示缩略图,operator 可以移除(理由 + 二次验证)。
 * 移除成功后调用 onChanged,由页面重新读取用户。
 */
export function UserAvatarCard({ userId, username, avatarUrl, onChanged }: {
  userId: string | number;
  username: string;
  avatarUrl: string | null;
  onChanged: () => void;
}) {
  const session = useAdminSession();
  const operator = hasRole(session, "operator");
  const [removing, setRemoving] = useState(false);
  if (!avatarUrl) return null;

  return (
    <section className="panel flex items-center justify-between gap-4 px-4 py-3.5" aria-label={S.avatars.card.title}>
      <div className="flex min-w-0 items-center gap-3">
        <AvatarThumb url={avatarUrl} size={48} />
        <div className="min-w-0">
          <p className="eyebrow">{S.avatars.card.title}</p>
          <p className="mt-0.5 text-xs text-muted">{S.avatars.card.hint}</p>
        </div>
      </div>
      {operator && (
        <button type="button" className="btn-danger btn-sm shrink-0" onClick={() => setRemoving(true)}>
          {S.avatars.card.remove}
        </button>
      )}
      <RemoveAvatarDialog
        target={removing ? { userId: String(userId), username } : null}
        onClose={() => setRemoving(false)}
        onDone={() => {
          setRemoving(false);
          onChanged();
        }}
      />
    </section>
  );
}
