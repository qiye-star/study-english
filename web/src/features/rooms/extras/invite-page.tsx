import { LinkIcon, LoaderIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { levelLabel } from "~/lib/levels";
import { fetchRoomsConfig, ROOMS_SERVER_ERRORS, type RoomsConfig } from "../rooms-api";
import { ghostButton, primaryButton } from "../ui";
import { joinByInvite, previewInvite, type InvitePreview } from "./invite-api";

type Load = { status: "loading" } | { status: "ready"; invite: InvitePreview } | { status: "expired" } | { status: "error"; error: string };

const badge = "inline-flex h-5 items-center rounded-[7px] px-[7px] text-label font-semibold whitespace-nowrap";

/**
 * 邀请落地页 /rooms/invite/:token(spec §3.4、§6.3):预览卡片(房间名、场景、水平、人数)+「加入房间」;已是成员 →「进入房间」。
 * 邀请链接 = 房主预先同意(R2-4),所以审批房间也直接加入。链接失效(房间已结束 / 已重置)→「邀请链接已失效」。
 * 未登录由 RequireAuth 处理:登录后回到本路由。token 只出现在请求路径里,不显示、不记录。
 */
export function RoomInvitePage() {
  const { token = "" } = useParams();
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [config, setConfig] = useState<RoomsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ status: "loading" });
    previewInvite(api, token, ctrl.signal).then(
      (invite) => setLoad({ status: "ready", invite }),
      (err) => {
        if (ctrl.signal.aborted) return;
        setLoad(err instanceof ApiError && err.status === 404 ? { status: "expired" } : { status: "error", error: translateServerError(t, err, ROOMS_SERVER_ERRORS) });
      },
    );
    // 场景的中文名只在 config 里;取不到时退回显示 key
    fetchRoomsConfig(api, ctrl.signal).then(setConfig, (): void => undefined);
    return () => ctrl.abort();
  }, [api, token, attempt, t]);

  const go = (roomId: string) => navigate(`/rooms/r/${encodeURIComponent(roomId)}`, { replace: true });
  async function join(invite: InvitePreview) {
    if (invite.joined) return go(invite.roomId);
    if (busy) return;
    setBusy(true);
    setJoinError(null);
    try {
      go((await joinByInvite(api, token)).id);
    } catch (err) {
      setJoinError(err instanceof ApiError && err.status === 404 ? t("web.rooms.extras.invite.expired") : translateServerError(t, err, ROOMS_SERVER_ERRORS));
      setBusy(false);
    }
  }

  const scenarioName = (key: string) => {
    const s = config?.scenarios?.find((x) => x.key === key);
    return s ? (i18n.language.startsWith("zh") ? s.titleZh : s.titleEn) : key;
  };

  return (
    <>
      <PageHeader title={t("web.rooms.extras.invite.pageTitle")} back="/rooms" />
      <div className="px-gutter pb-8 pt-1">
        {load.status === "loading" && (
          <p role="status" className="flex items-center justify-center gap-2 py-16 text-sub text-ink-2">
            <LoaderIcon aria-hidden className="size-4 animate-spin" />{t("web.common.loading")}
          </p>
        )}
        {(load.status === "expired" || load.status === "error") && (
          <div className="flex flex-col items-center py-12 text-center">
            <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-card bg-surface-2 text-ink-2"><LinkIcon className="size-6" /></span>
            <p role="alert" className="mt-3 text-title font-semibold text-ink">
              {load.status === "expired" ? t("web.rooms.extras.invite.expired") : load.error}
            </p>
            {load.status === "expired" && <p className="mt-1 text-sub text-ink-2">{t("web.rooms.extras.invite.expiredHint")}</p>}
            {load.status === "error" && (
              <button type="button" className={cn(ghostButton, "mt-5")} onClick={() => setAttempt((n) => n + 1)}>{t("web.common.retry")}</button>
            )}
            <button type="button" className={cn(ghostButton, "mt-2")} onClick={() => navigate("/rooms")}>{t("web.rooms.extras.invite.toLobby")}</button>
          </div>
        )}
        {load.status === "ready" && (
          <>
            <section className="rounded-card bg-surface p-4 shadow-hair">
              <div className="flex items-center gap-3">
                <span aria-hidden className="inline-flex size-[42px] flex-none items-center justify-center rounded-badge bg-blue-tint text-blue">
                  <UsersRoundIcon className="size-[22px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-title font-semibold text-ink">{load.invite.name || t("web.rooms.room.title")}</h2>
                  <p className="mt-0.5 text-meta text-ink-2">{t("web.rooms.extras.invite.invitedYou")}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className={cn(badge, "bg-blue-tint text-blue")}>{scenarioName(load.invite.scenario)}</span>
                <span className={cn(badge, "bg-surface-2 text-ink-2")}>{t("web.rooms.extras.invite.level", { level: levelLabel(t, load.invite.level) })}</span>
                <span className={cn(badge, "bg-surface-2 tabular-nums text-ink-2")}>
                  {t("web.rooms.extras.invite.members", { count: load.invite.memberCount, max: load.invite.maxMembers })}
                </span>
              </div>
            </section>
            <p role="alert" className={cn("text-sub text-ink-2", joinError ? "mt-3" : "sr-only")}>{joinError}</p>
            <button type="button" data-testid="invite-join" disabled={busy} className={cn(primaryButton, "mt-4")} onClick={() => void join(load.invite)}>
              {load.invite.joined ? t("web.rooms.extras.invite.enter") : t("web.rooms.extras.invite.join")}
            </button>
            <p className="mt-2.5 text-center text-meta text-ink-2">{t("web.rooms.extras.invite.joinHint")}</p>
          </>
        )}
      </div>
    </>
  );
}
