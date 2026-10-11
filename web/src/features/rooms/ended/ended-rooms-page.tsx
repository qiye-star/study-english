import { ArchiveIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate } from "~/components/feature-gate";
import { SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { ROOMS_ALL_SERVER_ERRORS } from "../create/rooms-v2-api";
import { reopenRoom, type MyRoom } from "../rooms-api";
import { smallGhostButton } from "../ui";
import { useEndedRooms } from "./use-ended-rooms";

const SUMMARY_LINK = new Set(["done", "pending", "failed"]);

function endedDate(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** /rooms/ended:我作为有效成员的全部已结束房间(按结束时间倒序,游标分页)。房主可重新开启(管理员关闭的除外)。 */
export function RoomsEndedPage() {
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { rooms, state, hasMore, loadingMore, loadMore, reload } = useEndedRooms(api);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function reopen(room: MyRoom) {
    if (busyId) return;
    setBusyId(room.id);
    setError(null);
    try {
      const opened = await reopenRoom(api, room.id);
      navigate(`/rooms/r/${encodeURIComponent(opened.id)}`);
    } catch (err) {
      setError(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
      setBusyId(null);
    }
  }
  return (
    <>
      <PageHeader title={t("web.rooms.ended.title")} back="/rooms" />
      <FeatureGate state={state} disabledText={t("web.rooms.disabled")} onRetry={reload}>
        <div className="px-gutter pb-8">
          <p role="alert" className={cn("text-sub text-ink-2", error ? "mb-2" : "sr-only")}>{error}</p>
          {rooms.length === 0 ? (
            <p className="px-3.5 py-10 text-center text-sub text-ink-2">{t("web.rooms.ended.empty")}</p>
          ) : (
            <SectionGroup title={t("web.rooms.ended.title")}>
              {rooms.map((room) => {
                const summary = room.summaryStatus && SUMMARY_LINK.has(room.summaryStatus) ? room.summaryStatus : null;
                const canReopen = room.myRole === "owner" && room.closeReason !== "admin";
                const reason = room.closeReason ? t(`web.rooms.ended.reasons.${room.closeReason}`, { defaultValue: "" }) : "";
                return (
                  <div key={room.id} className="flex items-center">
                    <Link to={`/rooms/r/${encodeURIComponent(room.id)}${summary ? "/summary" : ""}`} data-testid="ended-room" data-status="closed"
                      className="flex min-h-row min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 pr-2 transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <span aria-hidden className="inline-flex size-[34px] flex-none items-center justify-center rounded-badge bg-surface-2 text-ink-2">
                        <ArchiveIcon className="size-[19px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium tracking-[-0.005em] text-ink">{room.name || room.topic || t("web.rooms.room.title")}</span>
                        <span className="mt-0.5 block truncate text-meta tabular-nums text-ink-2">
                          {[reason, endedDate(room.closedAt, i18n.language), summary ? t(`web.rooms.lobby.summary.${summary}`) : ""].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                    {canReopen && (
                      <button type="button" data-testid="ended-reopen" disabled={busyId !== null}
                        className={cn(smallGhostButton, "mr-3 flex-none whitespace-nowrap")} onClick={() => void reopen(room)}>
                        {busyId === room.id ? t("web.rooms.ended.reopening") : t("web.rooms.ended.reopen")}
                      </button>
                    )}
                  </div>
                );
              })}
            </SectionGroup>
          )}
          {hasMore && (
            <button type="button" data-testid="ended-more" disabled={loadingMore} onClick={() => void loadMore()}
              className={cn(smallGhostButton, "mx-auto mt-4 flex")}>
              {loadingMore ? t("web.rooms.ended.loading") : t("web.rooms.ended.loadMore")}
            </button>
          )}
        </div>
      </FeatureGate>
    </>
  );
}
