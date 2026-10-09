import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import type { RoomInfo } from "./protocol";
import { createRoom, ROOMS_SERVER_ERRORS } from "./rooms-api";
import { primaryButton } from "./ui";

const TOPICS = ["travel", "food", "movies", "work", "campus", "free"] as const;

/** 创建房间:话题可选(6 个预设,再点一次取消)。 */
export function CreateRoomSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange(v: boolean): void; onCreated(room: RoomInfo): void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onCreated(await createRoom(api, topic));
    } catch (err) {
      setError(translateServerError(t, err, ROOMS_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent aria-describedby={undefined}>
        <BottomSheetHeader title={t("web.rooms.create.title")} />
        <p className="text-sub font-semibold text-ink-2">{t("web.rooms.create.topic")}</p>
        <div role="group" aria-label={t("web.rooms.create.topic")} className="mt-2 flex flex-wrap gap-2">
          {TOPICS.map((key) => {
            const label = t(`web.rooms.create.topics.${key}`);
            const on = topic === label;
            return (
              <button key={key} type="button" aria-pressed={on} onClick={() => setTopic(on ? "" : label)}
                className={cn("h-tap rounded-button px-4 text-sub font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-blue-tint text-blue" : "bg-surface-2 text-ink-2")}>{label}</button>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-3 text-sub text-ink-2">{error}</p>}
        <button type="button" data-testid="room-create-submit" className={cn(primaryButton, "mt-5")} disabled={busy} onClick={() => void submit()}>
          {t("web.rooms.create.submit")}
        </button>
      </BottomSheetContent>
    </BottomSheet>
  );
}
