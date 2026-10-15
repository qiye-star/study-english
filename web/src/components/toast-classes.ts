/**
 * Sonner 吐司的类名(经典外观与改动前 app.tsx 里的逐字相同)+ 液态皮肤:托板填充的胶囊、E2 阴影、不模糊(规则 4,设计稿 .toast.plate)。
 */
export const TOAST_CLASSNAMES = {
  toast: "!rounded-card !border-0 !bg-surface/90 !text-ink !shadow-hair backdrop-blur-xl backdrop-saturate-150 "
    + "liquid:!rounded-full liquid:!bg-plate liquid:!shadow-[inset_0_0_0_.5px_var(--hair-2),var(--mat-sh-2)] liquid:backdrop-filter-none",
  description: "!text-ink-2",
  closeButton: "!border-0 !bg-surface-2 !text-ink-2 !shadow-hair liquid:!bg-wash",
  success: "[&_[data-icon]]:!text-green",
  error: "[&_[data-icon]]:!text-red",
  warning: "[&_[data-icon]]:!text-amber",
  info: "[&_[data-icon]]:!text-blue",
} as const;
