import { MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { cn } from "~/lib/cn";
import { smallGhostButton, smallPrimaryButton } from "../ui";
import { ROOM_AGENTS_ALL_ERRORS, startRoomTutor, type RoomAgent } from "./room-agents-api";
import { LQ_CHIP, LQ_CHIP_ON } from "~/components/liquid";

/** 与服务端 tutor_rotation.MIN_STEPS / MAX_STEPS / DEFAULT_STEPS 相同(测试读服务端文件核对)。 */
export const TUTOR_STEPS = { min: 3, max: 12, initial: 8 } as const;

/** 房主开启「带练」(spec §7.5):选带练角色(两个时)和题数,开始后由服务端点名在线成员。 */
export function TutorStart({ roomId, agents, onStarted }: { roomId: string; agents: RoomAgent[]; onStarted(): void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const usable = agents.filter((a) => !a.disabled);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [steps, setSteps] = useState<number>(TUTOR_STEPS.initial);
  const [busy, setBusy] = useState(false);
  if (!usable.length) return null;
  const chosen = usable.some((a) => a.id === personaId) ? personaId! : usable[0].id;
  async function start() {
    setBusy(true);
    try {
      await startRoomTutor(api, roomId, chosen, steps);
      onStarted();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="room-tutor-start" className="mt-2 rounded-card border-[0.5px] border-hair bg-surface px-3.5 py-3">
      <p className="text-body font-medium text-ink">{t("web.rooms.agents.tutor.title")}</p>
      <p className="mt-0.5 text-meta text-ink-2">{t("web.rooms.agents.tutor.hint")}</p>
      {usable.length > 1 && (
        <div role="radiogroup" aria-label={t("web.rooms.agents.tutor.persona")} className="mt-2 flex flex-wrap gap-1.5">
          {usable.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={a.id === chosen} onClick={() => setPersonaId(a.id)}
              className={cn("min-h-tap max-w-full truncate rounded-full px-3 text-sub", a.id === chosen ? `bg-blue text-on-blue ${LQ_CHIP_ON}` : `bg-surface-2 text-ink ${LQ_CHIP}`)}>{a.name}</button>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" className={cn(smallGhostButton, "min-w-tap flex-none px-0")} aria-label={t("web.rooms.agents.tutor.fewer")} disabled={steps <= TUTOR_STEPS.min}
          onClick={() => setSteps((n) => n - 1)}><MinusIcon aria-hidden /></button>
        <span data-testid="room-tutor-steps" className="min-w-[3.5rem] text-center text-sub tabular-nums text-ink">{t("web.rooms.agents.tutor.steps", { count: steps })}</span>
        <button type="button" className={cn(smallGhostButton, "min-w-tap flex-none px-0")} aria-label={t("web.rooms.agents.tutor.more")} disabled={steps >= TUTOR_STEPS.max}
          onClick={() => setSteps((n) => n + 1)}><PlusIcon aria-hidden /></button>
        <button type="button" className={cn(smallPrimaryButton, "ml-auto flex-none")} disabled={busy} onClick={() => void start()}>
          {t("web.rooms.agents.tutor.start")}
        </button>
      </div>
    </div>
  );
}
