import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { cn } from "~/lib/cn";
import { ROOMS_ALL_SERVER_ERRORS } from "../create/rooms-v2-api";
import type { RoomInfo } from "../protocol";
import { getRoom, reopenRoom } from "../rooms-api";
import { primaryButton } from "../ui";
import { LQ_PANEL } from "~/components/liquid";

/** 房主且不是管理员关闭的(管理员关闭的只有后台能重新开启);刚在房间里结束时,原因来自 closed 事件(closeReason)。 */
export function canReopen(room: RoomInfo | null, closeReason: string | null, isOwner: boolean): boolean {
  const reason = room?.closeReason ?? closeReason;
  return !!room && isOwner && reason !== "admin" && reason !== "kicked" && reason !== "not_found";
}

/**
 * 已结束房间里的「重新开启房间」(插槽,spec 2026-10-12 §2.2):成功后把新房间交给页面,页面据此重连。
 * 409「Room is not closed」= 已经被开启(双击、另一个标签页):重读房间,开放了就当成功(R-O6)。
 */
export function ReopenBar({ roomId, onReopened }: { roomId: string; onReopened: (room: RoomInfo) => void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onReopened(await reopenRoom(api, roomId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const { room } = await getRoom(api, roomId);
          if (room.status === "open") return onReopened(room);
        } catch { /* 落到下面的提示 */ }
      }
      setError(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
      setBusy(false);
    }
  }
  return (
    <section aria-label={t("web.rooms.reopen.title")} className={`my-3 rounded-card bg-surface p-3.5 shadow-hair ${LQ_PANEL}`}>
      <p className="text-sub text-ink-2">{t("web.rooms.reopen.hint")}</p>
      <button type="button" data-testid="room-reopen" disabled={busy} className={cn(primaryButton, "mt-3")} onClick={() => void go()}>
        <RotateCcwIcon aria-hidden />{busy ? t("web.rooms.ended.reopening") : t("web.rooms.reopen.action")}
      </button>
      <p role="alert" className={cn("text-sub text-ink-2", error ? "mt-2" : "sr-only")}>{error}</p>
    </section>
  );
}
