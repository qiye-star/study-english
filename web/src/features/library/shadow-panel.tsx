import type { ReactElement } from "react";
import type { LibrarySegment } from "./library-api";
import type { PlayerHandle } from "./use-media-player";

/**
 * W2(跟读与评测)的接缝(spec §15;计划 R-L16)。W1 只放占位:`ShadowPanel` 不渲染任何东西,`SegmentText` 渲染纯文本。
 * **本文件之后归 W2**:W2 替换实现,但保持导出名与 props 不变(segment-list.tsx 依赖它们)。
 * - `ShadowPanel`:每句下方的跟读区(麦克风 / ⋯ 菜单 / 加入练习清单 / 微调 / 成绩 / 分析卡);`active` = 当前句。
 * - `SegmentText`:句子文字(W2 改为逐词 span + data-lookup-context;词的点击应 stopPropagation,否则会触发跳播)。
 * - 微调保存后调 `onSegmentSaved(next)`;`prevEndMs` / `nextStartMs` 是相邻句的边界(不允许重叠)。
 * - 行容器对非当前句启用 `content-visibility: auto`(paint containment):行内的弹出层要走 portal(R-L16、R-L17)。
 */
export interface ShadowPanelProps {
  itemId: string;
  segment: LibrarySegment;
  active: boolean;
  durationMs: number;
  prevEndMs: number | null;
  nextStartMs: number | null;
  player: PlayerHandle | null;
  onSegmentSaved(next: LibrarySegment): void;
}

export function ShadowPanel(_props: ShadowPanelProps): ReactElement | null {
  return null;
}

export interface SegmentTextProps {
  segment: LibrarySegment;
  active: boolean;
}

export function SegmentText({ segment }: SegmentTextProps): ReactElement {
  return <>{segment.text}</>;
}
