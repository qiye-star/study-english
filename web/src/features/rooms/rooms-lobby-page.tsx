import { ChevronRightIcon, PlusIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { CodeInput } from "./code-input";
import { CreateRoomSheet } from "./create-room-sheet";
import type { RoomInfo } from "./protocol";
import { fetchRoomsConfig, joinRoom, myRooms, normalizeCode, ROOMS_SERVER_ERRORS } from "./rooms-api";
import { ghostButton, primaryButton } from "./ui";

const formatCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** 联机大厅(视觉稿 M1):6 格房间号 + 加入、创建房间、我的房间(进行中 / 7 天内已结束,只读)。 */
export function RoomsLobbyPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<GateState>("loading");
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRoomsConfig(api, ctrl.signal)
      .then(async (c) => {
        if (!c.enabled) return setState("disabled");
        setRooms(await myRooms(api, ctrl.signal));
        setState("ready");
      })
      .catch(() => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  const valid = normalizeCode(code);
  async function join() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      navigate(`/rooms/r/${encodeURIComponent((await joinRoom(api, valid)).id)}`);
    } catch (err) {
      setError(translateServerError(t, err, ROOMS_SERVER_ERRORS));
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title={t("web.rooms.title")} />
      <FeatureGate state={state} disabledText={t("web.rooms.disabled")} onRetry={() => setAttempt((n) => n + 1)}>
        <div className="px-gutter pb-8">
          <section aria-labelledby="room-code-label" className="pt-1">
            <h2 id="room-code-label" className="mx-0.5 mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2">{t("web.rooms.lobby.codeLabel")}</h2>
            <CodeInput value={code} onChange={(v) => { setCode(v); setError(null); }} onSubmit={() => void join()} />
            <p role="alert" className={cn("text-sub text-ink-2", error ? "mt-2" : "sr-only")}>{error}</p>
            <button type="button" data-testid="room-join" className={cn(primaryButton, "mt-3")} disabled={!valid || busy} onClick={() => void join()}>
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
              const open = room.status === "open";
              return (
                <Link key={room.id} to={`/rooms/r/${encodeURIComponent(room.id)}`} data-testid="my-room" data-status={room.status}
                  className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span aria-hidden className={cn("inline-flex size-[34px] flex-none items-center justify-center rounded-badge",
                    open ? "bg-blue-tint text-blue" : "bg-surface-2 text-ink-2")}>
                    <UsersRoundIcon className="size-[19px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium tracking-[-0.005em] text-ink">
                      {room.topic || (room.code ? t("web.rooms.room.code", { code: formatCode(room.code) }) : t("web.rooms.room.title"))}
                    </span>
                    <span className="mt-0.5 block text-meta tabular-nums text-ink-2">
                      {open ? t("web.rooms.lobby.open", { count: room.onlineCount }) : t("web.rooms.lobby.closed")}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
                </Link>
              );
            })}
          </SectionGroup>
        </div>
      </FeatureGate>
      <CreateRoomSheet open={creating} onOpenChange={setCreating} onCreated={(room) => navigate(`/rooms/r/${encodeURIComponent(room.id)}`)} />
    </>
  );
}
