/*
 * 联机练习里的按钮样式(视觉稿 rank-rooms-v1 的 .btn):48 高、圆角 12、15px 半粗;主按钮钴蓝实底,次按钮 surface + 发丝线。
 * 小号(.btn.sm)44 高、13px,用于助手建议卡。不用 enjoy 的 Button(它带 capitalize 与 rounded-md)。
 */
const base = "inline-flex items-center justify-center gap-2 rounded-button font-semibold tracking-[-0.005em] transition-colors duration-fast "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5";
export const primaryButton = `${base} h-12 w-full bg-blue px-[18px] text-body text-on-blue active:bg-blue/90`;
export const ghostButton = `${base} h-12 w-full border-[0.5px] border-hair bg-surface px-[18px] text-body text-ink active:bg-surface-2`;
export const smallPrimaryButton = `${base} h-tap bg-blue px-3 text-sub text-on-blue active:bg-blue/90 [&_svg]:size-4`;
export const smallGhostButton = `${base} h-tap border-[0.5px] border-hair bg-surface px-3 text-sub text-ink active:bg-surface-2`;
/** 输入框:44 高、圆角 12、16px 字号(iOS 小于 16px 聚焦会放大页面)。 */
export const fieldInput = "h-tap min-w-0 rounded-button border-[0.5px] border-hair bg-surface px-3 text-base text-ink placeholder:text-ink-2 "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30 disabled:opacity-50";
