import { cn } from "@renderer/lib/utils";
import { SPECULAR_CLASS } from "./fx/specular-button";

// 跟读库共用的按钮 / 输入框类(12px 圆角、15px 半粗;蓝 = 操作)。主按钮是玻璃光带按钮(.lib-spec,library.css,D11)。
// 用模板字符串拼颜色:cn 会把 text-body 当颜色类与 text-ink 合并掉。
const BASE = cn(
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-button px-4 text-body font-semibold tracking-[-0.005em]",
  "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

/** 主按钮:渐变底 + 内高光 + 光带扫过(`.lib-spec` 自带底色、白字与胶囊圆角,只在 `.library-root` 内生效);高度由调用方给。 */
export const PRIMARY = `${BASE} ${SPECULAR_CLASS}`;
/** 次按钮(surface + 发丝线)。 */
export const GHOST = `${BASE} border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2`;
/** 卡片里的文字按钮(蓝字,44px 命中高)。 */
export const TEXT_BUTTON = cn(
  "inline-flex min-h-tap items-center gap-1.5 rounded-button px-3 text-sub font-semibold text-blue transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4",
);
/** 播放器控制条的 44px 按钮(W2 的面板也可用;播放页自己的控制胶囊用 `.lib-ctrl-btn`)。 */
export const CONTROL = cn(
  "inline-flex h-tap min-w-[44px] items-center justify-center gap-1 rounded-button px-2 text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
  "aria-pressed:text-blue [&_svg]:h-[22px] [&_svg]:w-[22px]",
);
/** 输入框:16px 字号防 iOS 缩放;`lib-field` 在 `.library-root`(含玻璃弹层)里换成半透明底(library.css)。 */
export const FIELD = cn(
  "lib-field h-11 w-full rounded-button border-0 bg-surface-2 px-3 text-[16px] text-ink placeholder:text-ink-3",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);
