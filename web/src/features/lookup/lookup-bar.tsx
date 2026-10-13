import { LanguagesIcon, SearchIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Slot, WordActions } from "~/lib/extension-points-react";
import { bareLookup, dictToLookup, type DictEntry } from "./dictionary";
import { normalizeSelection, type LookupMode } from "./lookup";
import type { TextSelectionInfo } from "./use-text-selection";
import { wordTargetFromLookup } from "./word-target";

const keep = (e: { preventDefault: () => void }) => e.preventDefault(); // 点按钮不能让系统选区消失

/**
 * 选中后的底部操作条(spec D6):查词(长句为「翻译」)· 朗读(扩展点 selectionActions)· 加入生词本(<WordActions>,只对单词 / 短语)。
 * 点击不抢焦点(preventDefault),沿用原触发按钮的位置与 data-testid="lookup-trigger"。
 */
export function LookupBar({ selection, suggested, entry, onOpen }: {
  selection: TextSelectionInfo;
  suggested: LookupMode;
  entry: DictEntry | null | undefined;
  onOpen: (info: TextSelectionInfo) => void;
}) {
  const { t } = useTranslation();
  const target = useMemo(
    () => wordTargetFromLookup(entry ? dictToLookup({ ...entry, word: normalizeSelection(selection.text) }) : bareLookup(normalizeSelection(selection.text)), selection),
    [entry, selection],
  );
  return (
    <div role="toolbar" aria-label={t("web.lookup.barLabel")} data-testid="lookup-bar"
      className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lg"
      onPointerDown={keep} onMouseDown={keep}>
      <Button data-testid="lookup-trigger" className="h-11 rounded-full px-4" onClick={() => onOpen(selection)}>
        {suggested === "lookup" ? <SearchIcon className="mr-1.5 h-4 w-4" /> : <LanguagesIcon className="mr-1.5 h-4 w-4" />}
        {suggested === "lookup" ? t("web.lookup.lookup") : t("web.lookup.translate")}
      </Button>
      <Slot point="selectionActions" props={{ text: selection.text, testId: "lookup-read" }} />
      {suggested === "lookup" && (
        <WordActions key={`${selection.text}\n${selection.context}`} testId="lookup-bar-vocab" variant="icon" target={target} />
      )}
    </div>
  );
}
