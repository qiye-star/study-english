import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Switch } from "@renderer/components/ui/switch";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { Avatar } from "~/components/avatar";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { RoomAgentsSection } from "./agents/agents-section";
import { JoinRequestRows } from "./create/join-requests";
import { listJoinRequests, ROOMS_ALL_SERVER_ERRORS, updateRoomSettings, type RoomSettingsInput } from "./create/rooms-v2-api";
import { SettingsFields } from "./create/settings-fields";
import type { JoinRequestInfo, RoomInfo } from "./protocol";
import type { RoomState } from "./room-state";
import { closeRoom, fetchRoomsConfig, kickMember, leaveRoom, type RoomsConfig } from "./rooms-api";
import { LQ_DANGER_TEXT, LQ_DIALOG, LQ_SECONDARY } from "~/components/liquid";

interface Confirm { title: string; action: string; run(): Promise<void> }
type SettingKey = keyof RoomSettingsInput;

function Group({ title, children, bare = false }: { title: string; children: ReactNode; bare?: boolean }) {
  return (
    <section className="mt-section first:mt-0">
      <h3 className="mx-0.5 mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2">{title}</h3>
      {bare ? children : <div className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface well liquid:rounded-inset liquid:border-0">{children}</div>}
    </section>
  );
}

/** 房间当前的设置(v1 服务端不下发 v2 字段时退回默认值)。 */
function settingsOf(room: RoomInfo, config: RoomsConfig | null): RoomSettingsInput {
  return {
    name: room.name || room.topic || "", scenario: room.scenario ?? "free", level: room.level, joinMode: room.joinMode ?? "code",
    maxMembers: room.maxMembers ?? config?.defaultMaxMembers ?? 4, aiPublic: room.aiPublic, allowVoice: room.allowVoice ?? true, locked: room.locked,
  };
}

/**
 * 成员与设置:房主改 7 项设置(与创建表单同一组控件,mode="edit",人数上限不低于当前成员数)+ 锁定;改动即时保存,
 * 失败 toast 并回滚该项。房主还看到「加入请求」(HTTP 列表 + 实时 state.joinRequests)。移出成员、结束房间(红字,二次确认);
 * 所有人可看成员、离开房间。房间结束后只剩成员列表。HTTP 返回的房间经 onChanged 立即生效(广播 room_update 也会到)。
 * 房间页(冻结)不传 config,这里打开时自己取一次 /api/rooms/config。
 */
export function RoomSettingsSheet({ open, onOpenChange, state, onChanged }: {
  open: boolean; onOpenChange(v: boolean): void; state: RoomState; onChanged(room: RoomInfo): void;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const room = state.room;
  const roomId = room?.id ?? "";
  const live = state.status !== "closed" && room?.status !== "closed";
  const owner = state.me?.role === "owner" && live;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [config, setConfig] = useState<RoomsConfig | null>(null);
  /** 正在保存的改动(乐观显示);成功后由服务端返回的房间接替,失败时删掉即回滚 */
  const [pending, setPending] = useState<RoomSettingsInput>({});
  const [fetched, setFetched] = useState<JoinRequestInfo[]>([]);
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!open || !owner || config) return;
    const ctrl = new AbortController();
    fetchRoomsConfig(api, ctrl.signal).then(setConfig, () => { /* 取不到就不显示设置项,锁定与成员照常 */ });
    return () => ctrl.abort();
  }, [open, owner, config, api]);
  // 连着时以实时列表为准(welcome 带全量,join_request 增、join_request_closed 删);没连上(重连中)时用 HTTP 取一次
  const connected = state.status === "live";
  useEffect(() => {
    if (!open || !owner || !roomId || connected) return;
    const ctrl = new AbortController();
    listJoinRequests(api, roomId, ctrl.signal).then(setFetched, () => { /* 取不到就只显示实时列表 */ });
    return () => ctrl.abort();
  }, [open, owner, roomId, connected, api]);

  const requests = useMemo(
    () => (connected ? state.joinRequests : fetched).filter((r) => r.status === "pending" && !decided.has(r.id)),
    [connected, state.joinRequests, fetched, decided],
  );

  if (!room) return null;
  const value: RoomSettingsInput = { ...settingsOf(room, config), ...pending };
  const memberCount = Math.max(2, state.members.length || room.memberCount || 0);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  /** 只保存变了的项;每项独立保存、独立回滚。 */
  function save(next: RoomSettingsInput) {
    const current = { ...settingsOf(room!, config), ...pending };
    const changed = (Object.keys(next) as SettingKey[]).filter((k) => next[k] !== undefined && next[k] !== current[k]);
    if (!changed.length) return;
    const patch: RoomSettingsInput = {};
    for (const k of changed) Object.assign(patch, { [k]: next[k] });
    setPending((cur) => ({ ...cur, ...patch }));
    const drop = () => setPending((cur) => {
      const rest = { ...cur };
      for (const k of changed) if (rest[k] === patch[k]) delete rest[k];
      return rest;
    });
    updateRoomSettings(api, room!.id, patch).then((updated) => {
      onChanged(updated);
      drop();
    }, (err) => {
      toast.error(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
      drop();
    });
  }

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto">
          <BottomSheetHeader title={t("web.rooms.settings.title")} />
          {owner && config && (
            <Group title={t("web.rooms.v2.settings.group")} bare>
              <SettingsFields value={value} onChange={save} config={config} mode="edit" namePlaceholder="" minMembers={memberCount} />
            </Group>
          )}
          {config?.agentsAvailable !== false && (
            <RoomAgentsSection room={room} owner={owner} live={live} tutorAvailable={!!config?.agentTutorAvailable} onChanged={onChanged} />
          )}
          {owner && (
            <div className="mt-2 divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface well liquid:rounded-inset liquid:border-0">
              <div className="flex min-h-row items-center justify-between gap-3 px-3.5 py-2.5">
                <label htmlFor="room-lock" className="min-w-0 text-body font-medium text-ink">{t("web.rooms.settings.locked")}</label>
                <Switch id="room-lock" data-testid="room-lock" checked={!!value.locked} onCheckedChange={(locked) => save({ locked })}
                  className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair liquid:data-[state=unchecked]:bg-wash-2" />
              </div>
            </div>
          )}
          {owner && (value.joinMode === "approval" || requests.length > 0) && (
            <Group title={t("web.rooms.v2.settings.requests")}>
              {requests.length === 0
                ? <p className="px-3.5 py-4 text-sub text-ink-2">{t("web.rooms.v2.settings.requestsEmpty")}</p>
                : <JoinRequestRows roomId={room.id} requests={requests} onDecided={(id) => setDecided((cur) => new Set(cur).add(id))} />}
            </Group>
          )}
          <Group title={t("web.rooms.settings.members")}>
            {state.members.map((m) => (
              <div key={m.userId} data-testid="room-member" className="flex min-h-row items-center gap-3 py-2 pl-3.5 pr-2">
                <Avatar name={m.name} size="sm" tone={m.userId === state.me?.userId ? "blue" : "neutral"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{m.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-meta text-ink-2">
                    {m.role === "owner" && <span>{t("web.rooms.settings.owner")}</span>}
                    {m.online && live && (
                      <span className="inline-flex items-center gap-1"><span aria-hidden className="size-1.5 rounded-full bg-green" />{t("web.rooms.settings.online")}</span>
                    )}
                  </span>
                </span>
                {owner && m.userId !== state.me?.userId && (
                  <button type="button" data-testid={`room-kick-${m.userId}`} disabled={busy}
                    className="inline-flex h-tap flex-none items-center rounded-[9px] px-3 text-sub font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-40 liquid:rounded-full liquid:hover:bg-wash"
                    onClick={() => setConfirm({ title: t("web.rooms.settings.kickConfirm", { name: m.name }), action: t("web.rooms.settings.kick"),
                      run: () => act(() => kickMember(api, room.id, m.userId)) })}>
                    {t("web.rooms.settings.kick")}
                  </button>
                )}
              </div>
            ))}
          </Group>
          {live && (
            <div className="mt-section divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface well liquid:rounded-inset liquid:border-0">
              <button type="button" data-testid="room-leave" disabled={busy} className="flex min-h-row w-full items-center justify-center text-body font-medium text-ink"
                onClick={() => setConfirm({ title: t("web.rooms.settings.leaveConfirm"), action: t("web.rooms.settings.leave"),
                  run: () => act(async () => { await leaveRoom(api, room.id); navigate("/rooms"); }) })}>
                {t("web.rooms.settings.leave")}
              </button>
              {owner && (
                <button type="button" data-testid="room-close" disabled={busy} className="flex min-h-row w-full items-center justify-center text-body font-medium text-red"
                  onClick={() => setConfirm({ title: t("web.rooms.settings.closeConfirm"), action: t("web.rooms.settings.close"),
                    run: () => act(async () => { onChanged(await closeRoom(api, room.id)); onOpenChange(false); }) })}>
                  {t("web.rooms.settings.close")}
                </button>
              )}
            </div>
          )}
        </BottomSheetContent>
      </BottomSheet>
      <AlertDialog open={!!confirm} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <AlertDialogContent className={`rounded-sheet border-[0.5px] border-hair bg-surface ${LQ_DIALOG}`}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">{t("web.rooms.settings.confirmHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={`h-11 rounded-button ${LQ_SECONDARY}`}>{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="room-confirm" className={`h-11 rounded-button bg-red-solid text-white hover:bg-red-solid/90 ${LQ_DANGER_TEXT}`}
              onClick={() => { const c = confirm; setConfirm(null); if (c) void c.run(); }}>{confirm?.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
