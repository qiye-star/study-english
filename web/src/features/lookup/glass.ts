/** 查词抽屉里的「小井」控件:半透明、发丝描边、圆胶囊,自身不模糊(计划 2026-10-15 R-G4;令牌在 styles/theme.css)。 */
export const LOOKUP_WELL = "rounded-full border-[color:var(--glass-well-bd)] bg-[color:var(--glass-well)] shadow-none";
/** 「显示中文释义」揭开按钮(`ZhDefsCover` 的 className):块状、同一套井令牌,不带 rounded-full、不模糊(计划 2026-10-23 R-A5)。 */
export const LOOKUP_ZH_COVER = "border-[color:var(--glass-well-bd)] bg-[color:var(--glass-well)]";
/** 来源小标签(词典 / AI) */
export const LOOKUP_SOURCE_CHIP =
  "inline-flex h-[22px] items-center rounded-full border-[0.5px] border-[color:var(--glass-well-bd)] bg-[color:var(--glass-well)] px-2.5 text-xs font-semibold text-muted-foreground";
