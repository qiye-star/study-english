import { ArchiveIcon, ChevronRightIcon, HourglassIcon, PlusIcon, UsersRoundIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { CodeInput } from "./code-input";
import { joinRoomV2, ROOMS_ALL_SERVER_ERRORS } from "./create/rooms-v2-api";
import { useJoinRequest } from "./create/use-join-request";
import { CreateRoomSheet } from "./create-room-sheet";
import type { RoomInfo } from "./protocol";
import { fetchRoomsConfig, myRoomsOverview, normalizeCode, type MyRoom, type RoomsConfig } from "./rooms-api";
import { ghostButton, primaryButton, smallGhostButton } from "./ui";
import { LQ_ICON_WELL, LQ_PAGE, LQ_TILE } from "~/components/liquid";

const formatCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/**
 * 联机大厅(视觉稿 M1):6 格房间号 + 加入、创建房间、我的房间(进行中的房间;已结束的在 /rooms/ended)。
 * 需房主同意的房间:加入返回待审批请求,房间号下方显示等待卡片(可撤回),同意后自动进入(spec §3.4)。
 */
/** `embedded`:放在对话分区里时由 `pages/chat-hub.tsx` 传入(计划 L6 R3);不传 = 与原来相同。 */
export function RoomsLobbyPage({ embedded }: { embedded?: { title?: string; switcher: ReactNode } } = {}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<GateState>("loading");
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [endedCount, setEndedCount] = useState(0);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [config, setConfig] = useState<RoomsConfig | null>(null);
  const openRoom = useCallback((id: string) => navigate(`/rooms/r/${encodeURIComponent(id)}`), [navigate]);
  const waiting = useJoinRequest(api, openRoom);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRoomsConfig(api, ctrl.signal)
      .then(async (c) => {
        setConfig(c);
        if (!c.enabled) return setState("disabled");
        const overview = await myRoomsOverview(api, ctrl.signal);
        setRooms(overview.rooms);
        setEndedCount(overview.endedCount);
        setState("ready");
      })
      .catch(() => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  const valid = normalizeCode(code);
  async function join() {
    if (!valid || busy || waiting.request) return;
    setBusy(true);
    setError(null);
    try {
      const res = await joinRoomV2(api, valid);
      if (res.kind === "joined") return openRoom(res.room.id);
      waiting.start(res.request);
      setBusy(false);
    } catch (err) {
      setError(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
      setBusy(false);
    }
  }
  async function withdraw() {
    try {
      await waiting.cancel();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
    }
  }
  return (
    <>
      <PageHeader large title={embedded?.title ?? t("web.rooms.title")} />
      {embedded?.switcher}
      <FeatureGate state={state} disabledText={t("web.rooms.disabled")} onRetry={() => setAttempt((n) => n + 1)}>
        <div className={`px-gutter pb-8 ${LQ_PAGE}`}>
          <section aria-labelledby="room-code-label" className="pt-1">
            <h2 id="room-code-label" className="mx-0.5 mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2">{t("web.rooms.lobby.codeLabel")}</h2>
            <CodeInput value={code} onChange={(v) => { setCode(v); setError(null); }} onSubmit={() => void join()} />
            <p role="alert" className={cn("text-sub text-ink-2", error ? "mt-2" : "sr-only")}>{error}</p>
            <div role="status" aria-live="polite">
              {waiting.request && (
                <div data-testid="room-join-pending" className={`mt-3 flex items-center gap-3 rounded-card bg-surface py-1.5 pl-3.5 pr-1.5 shadow-hair ${LQ_TILE}`}>
                  <HourglassIcon aria-hidden className="size-[18px] flex-none text-ink-2" />
                  <span className="min-w-0 flex-1 text-sub text-ink">{t("web.rooms.v2.lobby.pending", { name: waiting.request.roomName })}</span>
                  <button type="button" data-testid="room-join-cancel" className={cn(smallGhostButton, "flex-none")} onClick={() => void withdraw()}>
                    {t("web.rooms.v2.lobby.cancel")}
                  </button>
                </div>
              )}
              {waiting.outcome && (
                <div data-testid="room-join-outcome" className={`mt-3 flex items-center gap-3 rounded-card bg-surface py-1.5 pl-3.5 pr-1.5 shadow-hair ${LQ_TILE}`}>
                  <span className="min-w-0 flex-1 text-sub text-ink">{t(`web.rooms.v2.lobby.${waiting.outcome}`)}</span>
                  <button type="button" className={cn(smallGhostButton, "flex-none")} onClick={waiting.dismiss}>{t("web.rooms.v2.lobby.dismiss")}</button>
                </div>
              )}
            </div>
            <button type="button" data-testid="room-join" className={cn(primaryButton, "mt-3")} disabled={!valid || busy || !!waiting.request}
              onClick={() => void join()}>
              {t("web.rooms.lobby.join")}
            </button>
            <button type="button" data-testid="room-create" className={cn(ghostButton, "mt-2")} onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden />{t("web.rooms.lobby.create")}
            </button>
            <p className="mt-2.5 text-meta text-ink-2">{t("web.rooms.lobby.rules")}</p>
          </section>
          <SectionGroup title={t("web.rooms.lobby.mine")}>
            {rooms.length === 0 && <p className="px-3.5 py-4 text-sub text-ink-2">{t("web.rooms.lobby.empty")}</p>}
            {rooms.map((room) => {
              return (
                <Link key={room.id} to={`/rooms/r/${encodeURIComponent(room.id)}`} data-testid="my-room" data-status={room.status}
                  className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring liquid:active:bg-wash liquid:px-4">
                  <span aria-hidden className={`inline-flex size-[34px] flex-none items-center justify-center rounded-badge bg-blue-tint text-blue ${LQ_ICON_WELL}`}>
                    <UsersRoundIcon className="size-[19px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium tracking-[-0.005em] text-ink">
                      {room.name || room.topic || (room.code ? t("web.rooms.room.code", { code: formatCode(room.code) }) : t("web.rooms.room.title"))}
                    </span>
                    <span className="mt-0.5 block text-meta tabular-nums text-ink-2">
                      {t("web.rooms.lobby.open", { count: room.onlineCount })}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
                </Link>
              );
            })}
          </SectionGroup>
          {endedCount > 0 && (
            <Link to="/rooms/ended" data-testid="rooms-ended-link"
              className={`mt-3 flex min-h-row items-center gap-3 rounded-card bg-surface py-2.5 pl-3.5 pr-3 shadow-hair transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${LQ_TILE} liquid:mt-4`}>
              <ArchiveIcon aria-hidden className="size-[19px] flex-none text-ink-2" />
              <span className="min-w-0 flex-1 truncate text-body text-ink">{t("web.rooms.ended.entry", { count: endedCount })}</span>
              <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
            </Link>
          )}
        </div>
      </FeatureGate>
      <CreateRoomSheet open={creating} onOpenChange={setCreating} config={config} onCreated={(room) => navigate(`/rooms/r/${encodeURIComponent(room.id)}`)} />
    </>
  );
}
