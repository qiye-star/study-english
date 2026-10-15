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
 * 点击不抢焦点(pointerdown/mousedown 的 preventDefault;不拦 touchstart,否则 click 不会触发)。按下期间经 onPress/onRelease 锁住选区(见 useTextSelection)。
沿用原触发按钮的位置与 data-testid="lookup-trigger"。
 */
export function LookupBar({ selection, suggested, entry, onOpen, onPress, onRelease }: {
  selection: TextSelectionInfo;
  suggested: LookupMode;
  entry: DictEntry | null | undefined;
  onOpen: (info: TextSelectionInfo) => void;
  /** 手指按下 / 抬起(含取消):Android 会在按下时收起原生选区,调用方据此在这段时间里保住选区。 */
  onPress?: () => void;
  onRelease?: () => void;
}) {
  const { t } = useTranslation();
  const target = useMemo(
    () => wordTargetFromLookup(entry ? dictToLookup({ ...entry, word: normalizeSelection(selection.text) }) : bareLookup(normalizeSelection(selection.text)), selection),
    [entry, selection],
  );
  return (
    <div role="toolbar" aria-label={t("web.lookup.barLabel")} data-testid="lookup-bar"
      className="glass-pop pop-halo absolute bottom-[calc(var(--tab-bar-space)+var(--dock-space,0px)+0.5rem)] left-1/2 z-40 flex h-[54px] max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-[27px] p-1 select-none"
      onPointerDown={(e) => { onPress?.(); keep(e); }} onMouseDown={keep}
      onTouchStart={() => onPress?.()}
      onPointerUp={() => onRelease?.()} onPointerCancel={() => onRelease?.()}
      onTouchEnd={() => onRelease?.()} onTouchCancel={() => onRelease?.()}>
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
