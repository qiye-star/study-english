import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 跟读卡(评分卡、分析卡、菜单)用到的 5 个效果组件的唯一接缝(plan 2026-10-13-video-import-web-shadow R-SH25)。
 * ClickSpark / CountUp / GradientText / BlurText 由 W1 的 ./fx 提供(spec §11.4a:自写、不引入新依赖、只放在 features/library/ 内)。
 * GlassSurface 用本地版本:W1 的 `.lib-glass` 带 backdrop-filter,而列表里的卡片不得再加模糊层(spec §11.4a:一屏 ≤ 3,
 * W1 的 library-css.test.ts 守着),并且 W2 的卡片需要 `tint`。W2 其余文件只从这里取,不直接导入 ./fx。
 */
export { BlurText, ClickSpark, CountUp, GradientText } from "./fx";

/**
 * 列表内的玻璃面:半透明填充 + 发丝高光边,**不带 backdrop-filter**。颜色只用令牌,深浅色自动跟随(D12)。
 * `strong` = 更不透明;`tint` = 蓝色提示底(AI 分析卡)。
 */
export function GlassSurface({
  as: Tag = "div", strong = false, tint = false, className, ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType; strong?: boolean; tint?: boolean }) {
  return (
    <Tag
      className={cn("rounded-card shadow-hair", tint ? "bg-blue-tint" : strong ? "bg-surface-2" : "bg-surface-2/70", className)}
      {...rest}
    />
  );
}
