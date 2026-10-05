import { BookCheckIcon, BookPlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { useAuth } from "~/auth/auth-context";
import { saveVocabularyItem } from "./save-vocabulary-item";
import type { VocabularyInput } from "./vocabulary-api";

/**
 * 各处"加入词汇本"的同一个按钮:同步防连点,卸载后不 setState。
 * 加入成功(含服务端去重返回已有词条)后显示"已在词汇本中"并禁用;换了词就恢复可点。
 */
export function AddVocabularyButton({ testId, input, withLabel = false, label }: {
  testId: string;
  input: VocabularyInput;
  withLabel?: boolean;
  /** 无障碍名(默认"加入词汇本");列表里带上词本身以便区分 */
  label?: string;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [savedWord, setSavedWord] = useState<string | null>(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const saved = savedWord === input.word;
  const save = async () => {
    if (savingRef.current || saved) return;
    savingRef.current = true;
    setSaving(true);
    const word = input.word;
    try {
      const ok = await saveVocabularyItem(api, t, input);
      if (ok && mounted.current) setSavedWord(word);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const text = saved ? t("web.vocabulary.inVocabulary") : t("web.vocabulary.add");
  const Icon = saved ? BookCheckIcon : BookPlusIcon;
  return (
    <Button variant={withLabel ? "outline" : "ghost"} size="sm" data-testid={testId} data-state={saved ? "saved" : saving ? "saving" : "idle"}
      className={withLabel ? "h-11 min-w-11 flex-1" : "h-11 min-w-11 px-2"}
      aria-label={saved ? t("web.vocabulary.inVocabularyWord", { word: input.word }) : (label ?? text)} disabled={saving || saved} onClick={() => void save()}>
      <Icon className={withLabel ? "mr-2 h-4 w-4" : "h-4 w-4"} aria-hidden="true" />{withLabel ? text : null}
    </Button>
  );
}
