import { useCallback, useState } from "react";
import { readJson, removeKey, writeJson } from "~/lib/storage";

/** 「译」开关按条目记在本机(spec §11.4):键里只有条目 id,值只有布尔,没有任何内容(隐私);存储不可用时本次不记。 */
export const translateKey = (itemId: string) => `enjoy-web.library.translate.${itemId}`;
const isBool = (value: unknown): value is boolean => typeof value === "boolean";

export function readTranslateOn(itemId: string): boolean {
  return readJson(translateKey(itemId), isBool) === true;
}

export function writeTranslateOn(itemId: string, on: boolean): void {
  if (on) writeJson(translateKey(itemId), true);
  else removeKey(translateKey(itemId));
}

export function useTranslateToggle(itemId: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readTranslateOn(itemId));
  const set = useCallback((next: boolean) => {
    setOn(next);
    writeTranslateOn(itemId, next);
  }, [itemId]);
  return [on, set];
}
