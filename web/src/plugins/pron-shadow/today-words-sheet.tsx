import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { LQ_INK } from "~/components/liquid";
import type { TodayWord } from "./pron-api";

/** 「今日新词例句」面板:每行 = 词 + 例句(英)+ 中文小字;没有例句的词禁用。懒加载。 */
export function TodayWordsSheet({ items, open, onOpenChange, onPick }: {
  items: TodayWord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[80dvh] overflow-y-auto" data-testid="today-words-sheet">
        <BottomSheetHeader title={t("web.links.pron.todayTitle")} description={t("web.links.pron.todayLede")} />
        <ul className="divide-y-[0.5px] divide-hair-2">
          {items.map((item) => {
            const example = item.example;
            return (
              <li key={item.key}>
                <button type="button" data-testid={`today-word-${item.key}`} disabled={!example}
                  onClick={() => example && onPick(example.en)}
                  className="flex min-h-tap w-full flex-col items-start gap-0.5 py-2.5 text-left transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed">
                  <span lang="en" className={`text-body font-semibold text-teal ${LQ_INK}`}>{item.word}</span>
                  {example ? (
                    <>
                      <span lang="en" className="text-body text-ink">{example.en}</span>
                      {example.zh ? <span className="text-meta text-ink-2">{example.zh}</span> : null}
                    </>
                  ) : (
                    <span className="text-meta text-ink-3">{t("web.links.pron.noExample")}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheetContent>
    </BottomSheet>
  );
}
