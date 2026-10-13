import type { LibrarySegment, TranslatedSegment } from "./library-api";

/**
 * 显示用的译文(spec E11):有文字,且(没记语言,或与当前母语一致)才算有效;用户改了母语后旧译文视为失效,
 * 由 `translate` 端点按语言重新生成。`native` 是 `nativeLanguageCode(language)` 的值(`en-US` / `zh-CN` / `es-ES`)。
 */
export function zhFor(seg: Pick<LibrarySegment, "zh" | "zhLang">, native: string): string | null {
  if (!seg.zh) return null;
  return seg.zhLang && seg.zhLang !== native ? null : seg.zh;
}

/** 这一句需要(重新)取译文。 */
export const needsTranslation = (seg: Pick<LibrarySegment, "zh" | "zhLang">, native: string): boolean => zhFor(seg, native) === null;

/** 把 `translate` 回包按 idx 合进句子表;没有变化时原样返回同一个数组(给 setState 省一次渲染)。 */
export function mergeTranslations(segments: LibrarySegment[], items: readonly TranslatedSegment[], native: string): LibrarySegment[] {
  if (items.length === 0) return segments;
  const byIdx = new Map(items.map((i) => [i.idx, i.zh]));
  let changed = false;
  const next = segments.map((s) => {
    const zh = byIdx.get(s.idx);
    if (zh === undefined || (s.zh === zh && s.zhLang === native)) return s;
    changed = true;
    return { ...s, zh, zhLang: native };
  });
  return changed ? next : segments;
}
