import type { LibrarySegment, TranslatedSegment } from "./library-api";

/**
 * W2 的接缝(spec §15「D8 增补的归属」W2 行;计划 R-L32)。W2 用真实实现替换本文件:按 E12 批量取译文
 * (锚点句前后各 10 句里还没有有效译文的句子〔`needsTranslation`〕,每次 ≤ 20 句〔`MAX_TRANSLATE_BATCH`〕,去重、取消、失败处理),
 * 取到后调 `onTranslated`(播放器用 `mergeTranslations` 合进句子表);额度满 → `notice: "limited"`,其他失败 → `notice: "failed"`
 * (固定文案,不逐句报错);取的过程中 `pending` 里是正在取的句序号(那些行画骨架)。`enabled` 为 false 时什么也不请求。
 * W1 的占位永远空闲。
 */
export interface UseTranslationsArgs {
  itemId: string;
  enabled: boolean;
  segments: readonly LibrarySegment[];
  /** 当前句序号:取它前后各 10 句(自动滚动保证当前句附近就是视野;W2 可以改用 IntersectionObserver 精确到视野) */
  anchorIdx: number;
  /** `nativeLanguageCode(language)` 的值(`zh-CN` / `es-ES`;英文界面不会 enabled) */
  native: string;
  onTranslated(items: TranslatedSegment[]): void;
}

export interface TranslationsState {
  pending: ReadonlySet<number>;
  notice: "limited" | "failed" | null;
  retry(): void;
}

const IDLE: TranslationsState = Object.freeze({ pending: new Set<number>(), notice: null, retry: () => {} });

export function useTranslations(_args: UseTranslationsArgs): TranslationsState {
  return IDLE;
}
