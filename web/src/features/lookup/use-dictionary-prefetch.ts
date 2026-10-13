import { useEffect, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { classifySelection, normalizeSelection } from "./lookup";
import { lookupDictionary, type DictEntry } from "./dictionary";
import type { TextSelectionInfo } from "./use-text-selection";

/**
 * 选中单词 / 短语(防抖后稳定)就问一次本地词典,让操作条里的「加入生词本」带上中文释义(R-L6)。
 * undefined = 还没结果;null = 未命中或失败(静默);只保存在组件状态里,不跨选区缓存。
 */
export function useDictionaryPrefetch(selection: TextSelectionInfo | null): DictEntry | null | undefined {
  const { api } = useAuth();
  const [state, setState] = useState<{ text: string; entry: DictEntry | null } | null>(null);
  const text = selection && classifySelection(selection.text) === "lookup" ? normalizeSelection(selection.text) : null;
  useEffect(() => {
    if (!text) { setState(null); return; }
    const ctl = new AbortController();
    lookupDictionary(api, text, ctl.signal).then(
      (entry) => { if (!ctl.signal.aborted) setState({ text, entry }); },
      () => { if (!ctl.signal.aborted) setState({ text, entry: null }); },
    );
    return () => ctl.abort();
  }, [api, text]);
  return state && state.text === text ? state.entry : undefined;
}
