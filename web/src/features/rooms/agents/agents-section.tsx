import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PersonaPicker, type Persona } from "~/features/agents";
import { ROOM_AGENTS, type RoomInfo } from "../protocol";
import { PersonaSheet } from "./persona-sheet";
import { ROOM_AGENTS_ALL_ERRORS, updateRoomAgents, type RoomAgent } from "./room-agents-api";
import { useRoomAgents } from "./use-room-agents";

/**
 * 房间设置里的「智能体」(spec §9.2):房主最多选 ROOM_AGENTS.max 个角色(PersonaPicker 来自 ~/features/agents,只能选内置与自己的),
 * 每次改动即时保存(PATCH agents),失败 toast;成员只看名单,点名字看角色信息。没有角色的房间对成员不显示本区。
 */
export function RoomAgentsSection({ room, owner, live, onChanged }: {
  room: RoomInfo; owner: boolean; live: boolean; onChanged(room: RoomInfo): void;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const ids = room.agentIds ?? [];
  const editable = owner && live;
  const { info, refresh } = useRoomAgents(api, room.id, ids, editable || ids.length > 0);
  const [picking, setPicking] = useState<number | null>(null);
  const [open, setOpen] = useState<RoomAgent | null>(null);
  const [busy, setBusy] = useState(false);
  if ((!editable && ids.length === 0) || (!owner && info?.available === false)) return null;
  const byId = new Map((info?.agents ?? []).map((a) => [a.id, a]));

  async function save(next: string[]) {
    setBusy(true);
    try {
      onChanged(await updateRoomAgents(api, room.id, next));
      refresh();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  function pick(slot: number, persona: Persona) {
    setPicking(null);
    if (ids.some((id, i) => id === persona.id && i !== slot)) {
      toast.error(t("web.rooms.agents.section.duplicate"));
      return;
    }
    const next = [...ids];
    next[slot] = persona.id;
    void save(next.filter(Boolean).slice(0, ROOM_AGENTS.max));
  }
  const slots = editable ? Array.from({ length: ROOM_AGENTS.max }, (_, i) => i) : ids.map((_, i) => i);

  return (
    <section data-testid="room-agents-section" className="mt-section">
      <h3 className="mx-0.5 mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2">{t("web.rooms.agents.section.title")}</h3>
      <div className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">
        {slots.map((slot) => {
          const id = ids[slot];
          if (!id) {
            return (
              <button key={`add-${slot}`} type="button" data-testid={`room-agent-add-${slot}`} disabled={busy || info?.available === false}
                className="flex min-h-row w-full items-center gap-2 px-3.5 text-body font-medium text-blue disabled:opacity-40"
                onClick={() => setPicking(slot)}>
                <PlusIcon aria-hidden className="size-4" />{t("web.rooms.agents.section.add")}
              </button>
            );
          }
          const agent = byId.get(id);
          return (
            <div key={id} className="flex min-h-row items-center gap-3 py-2 pl-3.5 pr-2">
              <button type="button" className="min-h-tap min-w-0 flex-1 text-left" disabled={!agent} onClick={() => agent && setOpen(agent)}>
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-body font-medium text-ink">{agent?.name ?? "…"}</span>
                  {agent?.disabled && <span className="flex-none rounded-full bg-surface-2 px-1.5 text-label text-ink-2">{t("web.rooms.agents.sheet.disabled")}</span>}
                </span>
                {agent?.intro && <span className="mt-0.5 block truncate text-meta text-ink-2">{agent.intro}</span>}
              </button>
              {editable && (
                <button type="button" data-testid={`room-agent-remove-${slot}`} aria-label={t("web.rooms.agents.section.remove")} disabled={busy}
                  className="inline-flex h-tap min-w-tap flex-none items-center justify-center rounded-[9px] px-2.5 text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                  onClick={() => void save(ids.filter((x) => x !== id))}>
                  <XIcon aria-hidden className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mx-0.5 mt-1.5 text-meta text-ink-2">
        {t("web.rooms.agents.section.hint")}{!room.aiPublic && ` ${t("web.rooms.agents.section.aiOff")}`}
      </p>
      {editable && (
        <PersonaPicker open={picking !== null} onOpenChange={(v: boolean) => { if (!v) setPicking(null); }}
          selectedId={picking !== null ? ids[picking] ?? null : null} onSelect={(p: Persona | null) => { if (p && picking !== null) pick(picking, p); }} />
      )}
      <PersonaSheet open={open !== null} onOpenChange={(v) => { if (!v) setOpen(null); }} roomId={room.id} agent={open} canAsk={false} onAsk={() => {}} />
    </section>
  );
}
