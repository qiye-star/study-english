import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import { createRoomV2, ROOMS_ALL_SERVER_ERRORS, type RoomSettingsInput } from "./create/rooms-v2-api";
import { SettingsFields } from "./create/settings-fields";
import type { RoomInfo } from "./protocol";
import type { RoomsConfig } from "./rooms-api";
import { primaryButton } from "./ui";

/** 表单默认值(spec §3.1):空名 = 服务端填「{用户名}的房间」;level 不传 = 服务端按段位定。 */
function defaults(config: RoomsConfig): RoomSettingsInput {
  return { name: "", scenario: "free", joinMode: "code", maxMembers: config.defaultMaxMembers || 4, aiPublic: true, allowVoice: true };
}

/** 创建房间(视觉稿 V1):7 项设置 + 创建。config 未就绪时不渲染表单。 */
export function CreateRoomSheet({ open, onOpenChange, onCreated, config }: {
  open: boolean; onOpenChange(v: boolean): void; onCreated(room: RoomInfo): void; config: RoomsConfig | null;
}) {
  const { api, user } = useAuth();
  const { t } = useTranslation();
  const [value, setValue] = useState<RoomSettingsInput>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && config) {
      setValue(defaults(config));
      setError(null);
    }
  }, [open, config]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createRoomV2(api, value));
    } catch (err) {
      setError(translateServerError(t, err, ROOMS_ALL_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent aria-describedby={undefined} className="max-h-[92dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.rooms.create.title")} />
        {config && (
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <SettingsFields value={value} onChange={setValue} config={config} mode="create" minMembers={2} disabled={busy}
              namePlaceholder={t("web.rooms.v2.create.defaultName", { name: user?.name ?? "" })} />
            {error && <p role="alert" className="mt-3 text-sub text-ink-2">{error}</p>}
            <button type="submit" data-testid="room-create-submit" className={cn(primaryButton, "mt-3.5")} disabled={busy}>
              {t("web.rooms.create.submit")}
            </button>
          </form>
        )}
      </BottomSheetContent>
    </BottomSheet>
  );
}
