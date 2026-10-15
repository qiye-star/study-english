import { forwardRef, useCallback, type HTMLAttributes } from "react";
import { useDockSpace } from "./use-dock-space";

/** 底部 dock 容器:一个普通 <div>,多做一件事——把自己占的空间登记到 `--dock-space`(见 use-dock-space.ts)。 */
export const Dock = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Dock(props, ref) {
  const dockRef = useDockSpace();
  const set = useCallback((el: HTMLDivElement | null) => {
    dockRef(el);
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  }, [dockRef, ref]);
  return <div ref={set} {...props} />;
});
