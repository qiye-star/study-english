import { useTranslation } from "react-i18next";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import "./locales";

/** 删除确认:「我的素材」里的删除与「精选」卡片的「取消入库」共用(R-C3);副本(`copy`)用自己的正文 `deleteCopyBody`。 */
export function DeleteItemDialog({ open, copy, onCancel, onConfirm }: {
  open: boolean; copy: boolean; onCancel(): void; onConfirm(): void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmDelete.title")}</AlertDialogTitle>
          <AlertDialogDescription className="text-sub text-ink-2">
            {t(copy ? "web.library.catalog.deleteCopyBody" : "web.library.confirmDelete.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
          <AlertDialogAction className="h-11 rounded-button" onClick={onConfirm}>{t("web.library.confirmDelete.confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
