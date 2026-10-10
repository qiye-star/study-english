import { cn } from "@renderer/lib/utils";

// 背单词页面共用的按钮类(视觉稿 .btn:12px 圆角、15px 半粗;主按钮蓝、次按钮 surface + 发丝线)。
// 用模板字符串拼颜色:cn 会把 text-body 当颜色类与 text-ink 合并掉。
const BASE = cn(
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-button px-4 text-body font-semibold tracking-[-0.005em]",
  "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

/** 主按钮(蓝底);高度由调用方给(h-11 卡内、h-12 底部操作条) */
export const PRIMARY = `${BASE} bg-blue text-on-blue active:bg-blue/90`;
/** 次按钮(surface + 发丝线) */
export const GHOST = `${BASE} border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2`;
/** 会话页底部操作条(贴在 Tab 栏之上的玻璃条;视觉稿 .dock2) */
export const DOCK = "glass glass-edge-t sticky bottom-0 z-30 mt-auto flex gap-2 px-gutter pb-2.5 pt-2.5";
/** 44px 朗读键(视觉稿 .play) */
export const PLAY = cn(
  "inline-flex h-tap w-tap flex-none items-center justify-center rounded-full bg-blue-tint text-blue transition-colors duration-fast",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5",
);
/** 顶栏右侧 44px 图标链接,外观同 IconButton */
export const ICON_LINK = cn(
  "relative inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-[22px] [&_svg]:w-[22px]",
);

/** 书名(随界面语言) */
export const bookTitle = (book: { titleZh: string; titleEn: string }, language: string) =>
  language.startsWith("zh") ? book.titleZh : book.titleEn;

const NF = new Intl.NumberFormat("en-US");
/** 千分位数字(4,544) */
export const fmt = (n: number) => NF.format(n);
