import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { DANGER, GHOST } from "./ui";

/**
 * 删除 / 清空的第二步确认(抽屉)。打开抽屉本身不发请求;只有红色确认按钮才调用 onConfirm。
 * 处理中不能关闭,避免请求飞行时丢失结果。
 */
export function ConfirmSheet({ open, title, description, confirmLabel, busy, onConfirm, onCancel }: {
  open: boolean; title: string; description: string; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      {open ? (
        <BottomSheetContent>
          <BottomSheetHeader title={title} description={description} />
          <div className="flex gap-2">
            <button type="button" className={`${GHOST} h-11 flex-1`} disabled={busy} onClick={onCancel}>
              {t("web.common.cancel")}
            </button>
            <button type="button" className={`${DANGER} h-11 flex-1`} disabled={busy} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </BottomSheetContent>
      ) : null}
    </BottomSheet>
  );
}
