import { useCallback, useState } from "react";
import { readJson, writeJson } from "~/lib/storage";

/** D8:「译」默认开启(设计者的假设,用户未明确回复;改回默认关只需把它改成 false)。 */
export const DEFAULT_TRANSLATE_ON = true;

/** 「译」开关按条目记在本机(spec §11.4):键里只有条目 id,值只有布尔,没有任何内容(隐私);存储不可用时本次不记。 */
export const translateKey = (itemId: string) => `enjoy-web.library.translate.${itemId}`;
const isBool = (value: unknown): value is boolean => typeof value === "boolean";

/** 没有键(或值损坏)= 默认;显式的 `true` / `false` 都记下来(以前只记 true,所以关掉过的人会看到一次「开」,裁定 R-W2)。 */
export function readTranslateOn(itemId: string): boolean {
  return readJson(translateKey(itemId), isBool) ?? DEFAULT_TRANSLATE_ON;
}

export function writeTranslateOn(itemId: string, on: boolean): void {
  writeJson(translateKey(itemId), on);
}

export function useTranslateToggle(itemId: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readTranslateOn(itemId));
  const set = useCallback((next: boolean) => {
    setOn(next);
    writeTranslateOn(itemId, next);
  }, [itemId]);
  return [on, set];
}
