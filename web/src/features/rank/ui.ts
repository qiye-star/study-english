import { LQ_PANEL, LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";
import { cn } from "~/lib/cn";

/** 48px 按钮(设计稿 `.btn`):主按钮钴蓝实底,次按钮 surface + 发丝线。 */
const BASE = cn(
  "inline-flex h-12 w-full min-w-0 items-center justify-center gap-2 rounded-button px-4 text-body font-semibold tracking-[-0.005em]",
  "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5 [&_svg]:flex-none",
);
export const PRIMARY_BUTTON = cn(BASE, "bg-blue text-on-blue active:opacity-90", LQ_PRIMARY);
export const GHOST_BUTTON = cn(BASE, "border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2", LQ_SECONDARY);
/** 实底卡片(同 SurfaceCard) */
export const CARD = `rounded-card border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none ${LQ_PANEL}`;
/** 顶栏右侧 44px 图标链接,外观同 IconButton */
export const ICON_LINK = cn(
  "relative inline-flex size-tap flex-none items-center justify-center rounded-button text-ink transition-colors duration-fast liquid:rounded-full liquid:hover:bg-wash",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[22px]",
);
