import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { type AvatarReportReason, reportAvatar, ROOMS_SERVER_ERRORS } from "./rooms-api";

const REASONS: readonly AvatarReportReason[] = ["inappropriate", "impersonation", "other"];

/**
 * 举报别人的头像:三选一原因,不收自由文本。提交成功提示「已收到」并关闭;重复举报同一张照片服务端同样返回成功。
 * 只从成员列表打开(房间设置里,对有头像的他人)。
 */
export function AvatarReportSheet({ open, onOpenChange, userId, name }: {
  open: boolean; onOpenChange(v: boolean): void; userId: number; name: string;
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [reason, setReason] = useState<AvatarReportReason | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await reportAvatar(api, userId, reason);
      toast.success(t("web.rooms.avatarReport.sent"));
      onOpenChange(false);
    } catch (err) {
      toast.error(translateServerError(t, err, ROOMS_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent aria-describedby={undefined}>
        <BottomSheetHeader title={t("web.rooms.avatarReport.title", { name })} />
        <div role="radiogroup" aria-label={t("web.rooms.avatarReport.reasonLabel")} className="mt-2 divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface well liquid:rounded-inset liquid:border-0">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className="flex min-h-row w-full items-center justify-between px-3.5 text-left text-body text-ink"
            >
              <span>{t(`web.rooms.avatarReport.reasons.${r}`)}</span>
              <span aria-hidden className={reason === r ? "text-blue" : "text-ink-2"}>{reason === r ? "●" : "○"}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!reason || busy}
          onClick={() => void submit()}
          className="mt-section h-11 w-full rounded-button bg-blue text-body font-semibold text-white disabled:opacity-40"
        >
          {t("web.rooms.avatarReport.submit")}
        </button>
      </BottomSheetContent>
    </BottomSheet>
  );
}
