import { LoaderIcon, MicIcon, StarIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { IconButton } from "~/components/icon-button";
import { MAX_PRACTICE_TEXT, savePracticeItem, useShadowSheet } from "~/features/practice";
import { splitSentences } from "./sentences";
import { stripMarkdown } from "./tts";

/** 回复的"跟读"面板:只由已完成的助手消息打开,逐句练习或收藏。 */
export function SentencePracticeSheet({ text, onClose }: { text: string | null; onClose(): void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { open: openShadow } = useShadowSheet();
  // 关闭动画期间 text 已是 null:保留最后一次非空文本,避免列表被清空、闪出"没有可练的句子"
  const lastTextRef = useRef("");
  if (text) lastTextRef.current = text;
  const shownText = text ?? lastTextRef.current;
  const sentences = useMemo(() => (shownText ? splitSentences(stripMarkdown(shownText)) : []), [shownText]);
  /** 弹窗里的「上一句 / 下一句」只走能练的句子:超长的整句不会被截断后当参考句(R-S18) */
  const practicable = useMemo(() => sentences.filter((s) => s.length <= MAX_PRACTICE_TEXT), [sentences]);
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
      <BottomSheetContent data-testid="practice-sheet" className="max-h-[80dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.chat.practicePanel.title")} description={t("web.chat.practicePanel.description")} />
        {text !== null && !sentences.length && <p className="rounded-card bg-surface-2 px-3.5 py-3 text-sub text-ink-2">{t("web.chat.practicePanel.empty")}</p>}
        <ul className={sentences.length ? "divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface" : undefined}>
          {sentences.map((sentence, i) => {
            const tooLong = sentence.length > MAX_PRACTICE_TEXT;
            const isSaving = saving.has(sentence);
            return (
              <li key={`${i}-${sentence.slice(0, 40)}`} data-testid="practice-sentence" className="flex min-h-row items-center gap-1 py-1.5 pl-3.5 pr-1.5">
                <div className="min-w-0 flex-1">
                  <p data-lookup-context className="select-text break-words text-body leading-dialogue text-ink">{tooLong ? `${sentence.slice(0, 120)}…` : sentence}</p>
                  {tooLong && <p className="mt-0.5 text-meta text-ink-2">{t("web.chat.practicePanel.tooLong")}</p>}
                </div>
                <IconButton tone="blue" data-testid="practice-sentence-go"
                  disabled={tooLong} label={t("web.chat.practicePanel.go")}
                  onClick={() => {
                    onClose(); // 先关自己的面板,再打开弹窗(不叠两层)
                    openShadow({
                      text: sentence,
                      list: practicable,
                      index: sentences.slice(0, i).filter((s) => s.length <= MAX_PRACTICE_TEXT).length,
                      source: "chat",
                    });
                  }}>
                  <MicIcon />
                </IconButton>
                <IconButton data-testid="practice-sentence-save" className="text-ink-2"
                  disabled={tooLong || isSaving} label={t("web.chat.practicePanel.save")}
                  onClick={() => void save(sentence)}>
                  {isSaving ? <LoaderIcon className="animate-spin" /> : <StarIcon />}
                </IconButton>
              </li>
            );
          })}
        </ul>
      </BottomSheetContent>
    </BottomSheet>
  );
}
