import { useEffect, useState, type ReactNode } from "react";
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
import { cn } from "~/lib/cn";
import type { RoomInfo } from "./protocol";
import type { RoomState } from "./room-state";
import { closeRoom, kickMember, leaveRoom, ROOMS_SERVER_ERRORS, updateRoom } from "./rooms-api";
import { fieldInput } from "./ui";

interface Confirm { title: string; action: string; run(): Promise<void> }

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-section first:mt-0">
      <h3 className="mx-0.5 mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2">{title}</h3>
      <div className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">{children}</div>
    </section>
  );
}

function SwitchRow({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange(v: boolean): void }) {
  return (
    <div className="flex min-h-row items-center justify-between gap-3 px-3.5 py-2.5">
      <label htmlFor={id} className="min-w-0 text-body font-medium text-ink">{label}</label>
      <Switch id={id} data-testid={id} checked={checked} disabled={disabled} onCheckedChange={onChange}
        className="hit-expand h-[26px] w-11 data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
    </div>
  );
}

/**
 * 成员与设置:房主改话题、锁定、AI 公开回答、移出成员、结束房间(红字,二次确认);所有人可看成员、离开房间。
 * 房间结束后只剩成员列表。HTTP 返回的房间经 onChanged 立即生效(广播 room_update 也会到)。
 */
export function RoomSettingsSheet({ open, onOpenChange, state, onChanged }: {
  open: boolean; onOpenChange(v: boolean): void; state: RoomState; onChanged(room: RoomInfo): void;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const room = state.room;
  const live = state.status !== "closed" && room?.status !== "closed";
  const owner = state.me?.role === "owner" && live;
  const [topic, setTopic] = useState(room?.topic ?? "");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const currentTopic = room?.topic ?? "";
  useEffect(() => { if (open) setTopic(currentTopic); }, [open, currentTopic]);
  if (!room) return null;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOMS_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  const patch = (p: { topic?: string; locked?: boolean; aiPublic?: boolean }) => act(async () => { onChanged(await updateRoom(api, room.id, p)); });

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto">
          <BottomSheetHeader title={t("web.rooms.settings.title")} />
          {owner && (
            <Group title={t("web.rooms.settings.topic")}>
              <form className="flex items-center gap-2 px-3.5 py-2.5" onSubmit={(e) => { e.preventDefault(); void patch({ topic: topic.trim() }); }}>
                <input data-testid="room-topic" aria-label={t("web.rooms.settings.topic")} value={topic} maxLength={100}
                  onChange={(e) => setTopic(e.target.value)} className={cn(fieldInput, "flex-1")} />
                <button type="submit" disabled={busy || topic.trim() === room.topic}
                  className="tap-link !m-0 font-semibold text-blue disabled:opacity-40">{t("web.rooms.settings.save")}</button>
              </form>
            </Group>
          )}
          {owner && (
            <div className="mt-2 divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">
              <SwitchRow id="room-lock" label={t("web.rooms.settings.locked")} checked={room.locked} disabled={busy} onChange={(v) => void patch({ locked: v })} />
              <SwitchRow id="room-ai-public" label={t("web.rooms.settings.aiPublic")} checked={room.aiPublic} disabled={busy} onChange={(v) => void patch({ aiPublic: v })} />
            </div>
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
                    className="inline-flex h-tap flex-none items-center rounded-[9px] px-3 text-sub font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                    onClick={() => setConfirm({ title: t("web.rooms.settings.kickConfirm", { name: m.name }), action: t("web.rooms.settings.kick"),
                      run: () => act(() => kickMember(api, room.id, m.userId)) })}>
                    {t("web.rooms.settings.kick")}
                  </button>
                )}
              </div>
            ))}
          </Group>
          {live && (
            <div className="mt-section divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">
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
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">{t("web.rooms.settings.confirmHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="room-confirm" className="h-11 rounded-button bg-red-solid text-white hover:bg-red-solid/90"
              onClick={() => { const c = confirm; setConfirm(null); if (c) void c.run(); }}>{confirm?.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
