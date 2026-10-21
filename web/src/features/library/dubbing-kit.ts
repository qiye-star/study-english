// 配音(features/dubbing)专用的 library 工具包(计划 L5 R17/R18)。只做再导出:不得被 library 自己导入,不得放实现。
// 经 index.ts 的 loadDubbingKit() 懒加载,所以主包不含这些模块。
export { PlayerController, segmentIndexAt } from "./use-media-player";
export type { Frames, MediaLike } from "./use-media-player";
export { useMediaSource } from "./use-media-source";
export { LIBRARY_SERVER_ERRORS, getItem, isItemNotFound, listItems } from "./library-api";
export { tokenizeSentence } from "./word-tap";
export { usePosterUrl } from "./use-poster";
export { ScoreCard } from "./score-card";
