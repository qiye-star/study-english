import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";

/**
 * 底部抽屉。enjoy 的 SheetContent 会把遮罩和内容都写成 absolute,在手机上与视口不一致;
 * 这里遮罩和内容都用 fixed,相对视口定位。
 *
 * Redesign v3:圆角 20 的实色 surface(不模糊:一屏最多三层玻璃,顶栏、输入条/底栏已占两层),
 * 顶部抓手、44px 关闭按钮、16px 页边距、底部 safe area。调用方通常只传 max-h 与 overflow-y-auto。
 */
export const BottomSheet = DialogPrimitive.Root;

export const BottomSheetContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(
  ({ className, children, ...props }, ref) => {
    const { t } = useTranslation();
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-testid="sheet-overlay"
          className="fixed inset-0 z-50 bg-[rgba(17,19,24,0.32)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 dark:bg-[rgba(0,0,0,0.55)]"
        />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-screen-sm rounded-t-sheet bg-surface px-gutter pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 text-ink",
            "shadow-[0_-0.5px_0_var(--hair),0_-12px_32px_-16px_rgba(17,19,24,0.28)] focus:outline-none",
            "transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            className,
          )}
          {...props}
        >
          <div aria-hidden className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-hair" />
          {children}
          <DialogPrimitive.Close
            className="absolute right-2 top-2 inline-flex h-tap w-tap items-center justify-center rounded-button text-ink-2 transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
          >
            <XIcon aria-hidden className="h-5 w-5" />
            <span className="sr-only">{t("web.chat.sheetClose")}</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
BottomSheetContent.displayName = "BottomSheetContent";

/**
 * 说明文字的类名不经 cn:默认 tailwind-merge 把 text-sub 当成文字颜色,会被 text-ink-2 挤掉。
 * 抽屉标题区:17px 标题 + 13px 次要说明,右侧给关闭按钮留位。放在 BottomSheetContent 里第一个。 */
export function BottomSheetHeader({ title, description, srOnlyDescription }: { title: string; description?: string; srOnlyDescription?: boolean }) {
  return (
    <div className="mb-3 pr-10">
      <DialogPrimitive.Title className="text-title font-semibold text-ink">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className={`mt-1 text-sub text-ink-2${srOnlyDescription ? " sr-only" : ""}`}>{description}</DialogPrimitive.Description>
      ) : null}
    </div>
  );
}
