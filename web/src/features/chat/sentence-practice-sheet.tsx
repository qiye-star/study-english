import { LoaderIcon, MicIcon, StarIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { MAX_PRACTICE_TEXT } from "~/features/practice/practice-items-api";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";
import { splitSentences } from "./sentences";
import { stripMarkdown } from "./tts";

/** 回复的"跟读"面板:只由已完成的助手消息打开,逐句练习或收藏。 */
export function SentencePracticeSheet({ text, onClose }: { text: string | null; onClose(): void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  // 关闭动画期间 text 已是 null:保留最后一次非空文本,避免列表被清空、闪出"没有可练的句子"
  const lastTextRef = useRef("");
  if (text) lastTextRef.current = text;
  const shownText = text ?? lastTextRef.current;
  const sentences = useMemo(() => (shownText ? splitSentences(stripMarkdown(shownText)) : []), [shownText]);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const savingRef = useRef(new Set<string>()); // 同步防连点:state 在同一帧内仍是旧值
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const save = async (sentence: string) => {
    if (savingRef.current.has(sentence)) return;
    savingRef.current.add(sentence);
    setSaving(new Set(savingRef.current));
    try {
      await savePracticeItem(api, t, sentence, "chat");
    } finally {
      savingRef.current.delete(sentence);
      if (mountedRef.current) setSaving(new Set(savingRef.current));
    }
  };

  return (
    <BottomSheet open={text !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BottomSheetContent data-testid="practice-sheet" className="max-h-[80dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="text-left">{t("web.chat.practicePanel.title")}</SheetTitle>
          <SheetDescription className="text-left">{t("web.chat.practicePanel.description")}</SheetDescription>
        </SheetHeader>
        {text !== null && !sentences.length && <p className="mt-4 text-sm text-muted-foreground">{t("web.chat.practicePanel.empty")}</p>}
        <ul className="mt-3 divide-y">
          {sentences.map((sentence, i) => {
            const tooLong = sentence.length > MAX_PRACTICE_TEXT;
            const isSaving = saving.has(sentence);
            return (
              <li key={`${i}-${sentence.slice(0, 40)}`} data-testid="practice-sentence" className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p data-lookup-context className="select-text break-words text-base">{tooLong ? `${sentence.slice(0, 120)}…` : sentence}</p>
                  {tooLong && <p className="text-xs text-muted-foreground">{t("web.chat.practicePanel.tooLong")}</p>}
                </div>
                <Button variant="ghost" size="icon" data-testid="practice-sentence-go" className="h-11 w-11 shrink-0"
                  disabled={tooLong} aria-label={t("web.chat.practicePanel.go")}
                  onClick={() => { onClose(); goPractice(navigate, sentence); }}>
                  <MicIcon className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" data-testid="practice-sentence-save" className="h-11 w-11 shrink-0"
                  disabled={tooLong || isSaving} aria-label={t("web.chat.practicePanel.save")}
                  onClick={() => void save(sentence)}>
                  {isSaving ? <LoaderIcon className="h-5 w-5 animate-spin" /> : <StarIcon className="h-5 w-5" />}
                </Button>
              </li>
            );
          })}
        </ul>
      </BottomSheetContent>
    </BottomSheet>
  );
}
