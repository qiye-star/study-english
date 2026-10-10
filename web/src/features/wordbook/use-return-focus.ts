import { useRef } from "react";

/**
 * 关闭后把焦点还给打开它的按钮(spec 2026-10-11 §12.3)。
 * Radix 的模态 Dialog / AlertDialog 关闭时只会聚焦自己的 `Trigger`;我们的面板与确认框由普通按钮用 `open` 打开、
 * 没有 Trigger,焦点会落到 body。在 onOpenAutoFocus 时(焦点还没移进去)记下当时的焦点元素,关闭时还回去。
 *   const back = useReturnFocus();
 *   <BottomSheetContent {...back}>…
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}
