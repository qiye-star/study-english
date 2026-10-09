import { useEffect, useState } from "react";
import { keyboardOpen } from "./dock-snap";

const isTextField = (el: Element | null): boolean => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable === true;
};

const coarse = (): boolean => {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches === true;
  } catch {
    return false;
  }
};

/**
 * 软键盘是否弹出(spec §5.1):visualViewport.height 比本页记录的最大值小 25% 以上;
 * 不支持 visualViewport 时以「触屏设备且输入框聚焦」代替(判定逻辑见 dock-snap.ts::keyboardOpen)。
 * 最大值按方向记录:视口宽度变了(旋转)就从当前高度重新记。
 * 高度按 height × scale 计:双指放大(iOS 不理 user-scalable=no)按倍数缩小可视视口,不是键盘(review m4)。
 */
export function useSoftKeyboard(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport ?? null;
    const unzoomed = (v: VisualViewport) => v.height * (v.scale > 0 ? v.scale : 1);
    const zoomed = (v: VisualViewport) => v.scale > 1.01;
    let maxHeight = vv ? unzoomed(vv) : 0;
    let width = vv ? vv.width * (vv.scale > 0 ? vv.scale : 1) : window.innerWidth;
    let focused = isTextField(document.activeElement);
    const pointer = coarse();
    const update = () => {
      if (vv) {
        const w = vv.width * (vv.scale > 0 ? vv.scale : 1);
        if (w !== width && !zoomed(vv)) {
          width = w;
          maxHeight = unzoomed(vv);
        }
        maxHeight = Math.max(maxHeight, unzoomed(vv));
      }
      setOpen(keyboardOpen({ layoutHeight: window.innerHeight, visualHeight: vv ? unzoomed(vv) : null, maxVisualHeight: maxHeight,
        inputFocused: focused, coarsePointer: pointer }));
    };
    const onFocusIn = (e: FocusEvent) => { focused = isTextField(e.target as Element | null); update(); };
    const onFocusOut = (e: FocusEvent) => { focused = isTextField(e.relatedTarget as Element | null); update(); };
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    update();
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return open;
}
