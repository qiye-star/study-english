import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * 模态框外壳:遮罩 + 居中面板,Esc 与点遮罩关闭,打开时把焦点放进面板。
 * jsdom 不支持 <dialog>.showModal,所以用 role="dialog" 的普通元素。
 */
export function Dialog({
  open,
  title,
  children,
  footer,
  onClose,
  width = 520,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const first = panel.current?.querySelector<HTMLElement>("input, textarea, select, button");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-fg/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fade-in relative flex max-h-[85vh] w-full flex-col rounded-2xl bg-surface shadow-card ring-1 ring-line"
        style={{ maxWidth: width }}
      >
        <h2 id={titleId} className="px-5 pb-2 pt-5 text-md font-semibold tracking-tight">
          {title}
        </h2>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4 text-sm">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
