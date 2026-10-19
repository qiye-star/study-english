import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { Avatar } from "~/components/avatar";
import type { JoinRequestInfo } from "../protocol";
import { decideJoinRequest, ROOMS_ALL_SERVER_ERRORS } from "./rooms-v2-api";
import { LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";

/** 视觉稿 `.sbtn`:视觉 34–36 高、圆角 10、13px 半粗;命中区扩到 ≥44。 */
const sbtn = "hit-expand inline-flex h-[34px] flex-none items-center justify-center rounded-badge px-3 text-sub font-semibold transition-colors duration-fast "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const sbtnPrimary = `${sbtn} bg-blue text-on-blue active:bg-blue/90 ${LQ_PRIMARY}`;
const sbtnGhost = `${sbtn} bg-surface text-ink shadow-hair active:bg-surface-2 ${LQ_SECONDARY}`;

/**
 * 房主同意 / 拒绝一条加入请求。成功 → onDecided(id);请求已不存在(别处已处理、已过期)也算处理完。
 * 同意时人数已满(409 Room is full)保留该请求:房主可以先调高人数上限。
 */
export function useDecideJoinRequest(roomId: string, onDecided: (id: string) => void) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  async function decide(request: JoinRequestInfo, approve: boolean) {
    if (busy.has(request.id)) return;
    setBusy((cur) => new Set(cur).add(request.id));
    try {
      await decideJoinRequest(api, roomId, request.id, approve);
      onDecided(request.id);
    } catch (err) {
      toast.error(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
      if (err instanceof ApiError && err.status === 404) onDecided(request.id);
    } finally {
      setBusy((cur) => {
        const next = new Set(cur);
        next.delete(request.id);
        return next;
      });
    }
  }
  return { busy, decide };
}

/** 请求列表的行:头像 + 名字 + 同意 / 拒绝(设置面板与展开的提示条共用)。 */
export function JoinRequestRows({ roomId, requests, onDecided }: { roomId: string; requests: JoinRequestInfo[]; onDecided(id: string): void }) {
  const { t } = useTranslation();
  const { busy, decide } = useDecideJoinRequest(roomId, onDecided);
  return (
    <>
      {requests.map((r) => (
        <div key={r.id} data-testid="room-join-request" className="flex min-h-row items-center gap-3 py-2 pl-3.5 pr-2.5">
          <Avatar name={r.name} size="sm" tone="neutral" src={r.avatarUrl} />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{r.name}</span>
          <button type="button" className={sbtnGhost} disabled={busy.has(r.id)} aria-label={t("web.rooms.v2.requests.denyName", { name: r.name })}
            onClick={() => void decide(r, false)}>{t("web.rooms.v2.requests.deny")}</button>
          <button type="button" className={sbtnPrimary} disabled={busy.has(r.id)} aria-label={t("web.rooms.v2.requests.approveName", { name: r.name })}
            onClick={() => void decide(r, true)}>{t("web.rooms.v2.requests.approve")}</button>
        </div>
      ))}
    </>
  );
}

/**
 * 房主在顶栏下方看到的提示条(spec §3.4;视觉稿 `.banner`):实色 surface、圆角 12、发丝线 + 轻投影。
 * 1 条:「lily 想加入 · 拒绝 · 同意」;多条:「lily 等 3 人想加入 · 查看」,展开为逐行同意 / 拒绝。
 * 决定后 onDecided(id)(房间页本地移除;实时事件 join_request_closed 也会移除)。房间页只给房主渲染它。
 */
export function JoinRequestBanner({ roomId, requests, onDecided }: { roomId: string; requests: JoinRequestInfo[]; onDecided(id: string): void }): JSX.Element | null {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { busy, decide } = useDecideJoinRequest(roomId, onDecided);
  const first = requests[0];
  if (!first) return null;
  const many = requests.length > 1;
  return (
    <div role="status" data-testid="room-join-banner"
      className="overflow-hidden rounded-button bg-surface text-sub text-ink shadow-[inset_0_0_0_0.5px_var(--hair),0_6px_18px_-10px_rgba(17,19,24,0.3)] mat-float liquid:rounded-tile">
      <div className="flex min-h-[46px] items-center gap-2 py-1.5 pl-3 pr-1.5">
        <span className="min-w-0 flex-1 truncate">
          {many ? t("web.rooms.v2.requests.many", { name: first.name, count: requests.length, others: requests.length - 1 })
            : t("web.rooms.v2.requests.one", { name: first.name })}
        </span>
        {many ? (
          <button type="button" className={sbtnGhost} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {t(expanded ? "web.rooms.v2.requests.hide" : "web.rooms.v2.requests.view")}
          </button>
        ) : (
          <>
            <button type="button" className={sbtnGhost} disabled={busy.has(first.id)} onClick={() => void decide(first, false)}>
              {t("web.rooms.v2.requests.deny")}
            </button>
            <button type="button" className={sbtnPrimary} disabled={busy.has(first.id)} onClick={() => void decide(first, true)}>
              {t("web.rooms.v2.requests.approve")}
            </button>
          </>
        )}
      </div>
      {many && expanded && (
        <div className="max-h-[40dvh] divide-y-[0.5px] divide-hair-2 overflow-y-auto border-t-[0.5px] border-hair-2">
          <JoinRequestRows roomId={roomId} requests={requests} onDecided={onDecided} />
        </div>
      )}
    </div>
  );
}
