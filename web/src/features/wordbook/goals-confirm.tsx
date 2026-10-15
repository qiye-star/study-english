import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { LQ_DIALOG } from "~/components/liquid";
import { DANGER, GHOST, PRIMARY } from "./ui";
import { useReturnFocus } from "./use-return-focus";

/**
 * 面板里的确认框(暂停 / 重置,视觉稿 07、08):role="alertdialog",焦点困在框内,Esc 取消,点遮罩不关,
 * 关闭后焦点回到打开它的那一行。
 *
 * Ruling GW4-a:不用 enjoy 的 AlertDialog。它带的是另一份 @radix-ui/react-focus-scope(1.1.2,BottomSheet 的
 * react-dialog 用 1.1.16),两份焦点栈互不知道对方,叠在面板上时会互相抢焦点、无限递归(测试里栈溢出,
 * 真机会卡死页面)。这里与 BottomSheet 用同一个 @radix-ui/react-dialog,嵌套时外层焦点范围会自动暂停。
 */
export function GoalsConfirm({ open, onOpenChange, title, body, children, confirmLabel, danger = false, confirmDisabled = false, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const back = useReturnFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(17,19,24,0.45)] dark:bg-[rgba(0,0,0,0.6)]" />
        <DialogPrimitive.Content role="alertdialog" {...back}
          onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-40px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-sheet border-[0.5px] border-hair bg-surface p-5 text-ink",
            "shadow-[0_16px_40px_-12px_rgba(17,19,24,0.35)] focus:outline-none",
            LQ_DIALOG,
          )}>
          <DialogPrimitive.Title className="text-title font-semibold text-ink">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description asChild>
            <div className="mt-2 space-y-2 text-sub leading-dialogue text-ink-2">{body}</div>
          </DialogPrimitive.Description>
          {children}
          <div className="mt-[18px] flex gap-2">
            <DialogPrimitive.Close className={cn(GHOST, "h-11 flex-1")}>{t("web.common.cancel")}</DialogPrimitive.Close>
            <button type="button" disabled={confirmDisabled} onClick={onConfirm}
              className={cn(danger ? DANGER : PRIMARY, "h-11 flex-1")}>
              {confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
