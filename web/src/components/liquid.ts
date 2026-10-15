/**
 * 液态玻璃的共享类名词汇(计划 2026-10-15-liquid-glass INDEX §5.4,FROZEN)。全部只在 html[data-glass="v2"] 下生效:
 * liquid:* 是 Tailwind 变体,mat-* / well / plate 是 index.css 里自带作用域的材质类。经典类名一律保留,这里的串只「追加」。
 * 设计稿对照:.m1 / .m1.strong / .half / .wl.well / .chip / .chip.ol / .pill.acc|.gh|.pl|.red / .iw / .inp / .field / .dialog。
 */
export const LQ_PAGE = "liquid:px-frame";
export const LQ_PANEL = "mat-surface liquid:rounded-panel";
export const LQ_PANEL_STRONG = "mat-surface-strong liquid:rounded-panel";
export const LQ_TILE = "mat-surface liquid:rounded-tile";
export const LQ_WELL = "well liquid:rounded-inset";
export const LQ_CHIP = "liquid:h-7 liquid:rounded-full liquid:bg-wash liquid:text-ink-2 liquid:shadow-none";
export const LQ_CHIP_OUTLINE = "liquid:rounded-full liquid:bg-transparent liquid:text-ink-2 liquid:shadow-[inset_0_0_0_1px_var(--hair)]";
export const LQ_CHIP_ON = "liquid:border-transparent liquid:bg-graphite liquid:text-on-graphite liquid:shadow-none";
export const LQ_PRIMARY = "liquid:rounded-full liquid:shadow-accent";
export const LQ_SECONDARY = "liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:text-ink liquid:shadow-well liquid:active:bg-wash-2";
export const LQ_ON_BLUR = "plate liquid:rounded-full liquid:border-0";
export const LQ_DANGER_TEXT = "liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:text-red liquid:shadow-well";
export const LQ_DANGER_SOLID = "liquid:rounded-full";
export const LQ_ICON_WELL = "liquid:rounded-full liquid:bg-wash liquid:text-ink liquid:shadow-well";
export const LQ_FIELD = "liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:shadow-well liquid:focus-visible:ring-blue/35";
export const LQ_FIELD_MULTI = "liquid:rounded-field liquid:border-0 liquid:bg-wash liquid:shadow-well";
export const LQ_NOTE = "liquid:rounded-inset liquid:bg-wash liquid:text-ink liquid:shadow-well";
/** 目标词 / 弱读词:不用填充,600 字重 + 1.5px ink-2 下划线(spec §2.4) */
export const LQ_MARK = "liquid:bg-transparent liquid:px-0 liquid:font-semibold liquid:text-ink liquid:underline liquid:decoration-ink-2 liquid:decoration-[1.5px] liquid:underline-offset-[3px]";
export const LQ_INK = "liquid:text-ink";
export const LQ_INK2 = "liquid:text-ink-2";
export const LQ_BAR_TRACK = "liquid:bg-wash-2";
export const LQ_BAR_FILL = "liquid:bg-blue";
export const LQ_BAR_INK = "liquid:bg-ink/85";
export const LQ_DIALOG = "mat-sheet liquid:rounded-dialog liquid:w-[min(340px,calc(100%-32px))] liquid:max-w-none liquid:gap-3 liquid:p-4";
export const LQ_SEP = "liquid:divide-hair-2";
