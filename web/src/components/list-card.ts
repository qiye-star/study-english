/**
 * 列表卡容器(与 SectionGroup 内的列表相同):surface 底、0.5px 发丝线、圆角 14、行间 0.5px 分隔线。
 * 用于没有分组标题、或需要自己渲染 <ul> 的列表:<ul className={LIST_CARD}>…</ul>
 * 液态皮肤:E1 面板(计划 2026-10-15-liquid-glass)。
 */
export const LIST_CARD = "divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface mat-surface liquid:rounded-panel";

/** 页面内的提示 / 空状态文字(居中、次要色) */
export const PAGE_NOTE = "px-6 py-10 text-center text-sub text-ink-2";
