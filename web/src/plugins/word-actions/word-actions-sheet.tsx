import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import type { WordActionProps } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";

/**
 * 「单词操作」底部面板(视觉稿帧 02):标题 + 词;每一行由一个模块在 wordActionsMenu 插槽登记
 * (vocabulary.add / wordbook.adopt / practice.shadow / wordbook.card)。关闭后焦点回到「更多」按钮。
 */
export function WordActionsSheet({ open, onOpenChange, returnFocus, ...props }: WordActionProps & {
  open: boolean; onOpenChange: (open: boolean) => void; returnFocus: () => void;
}) {
  const { t } = useTranslation();
  const close = () => onOpenChange(false);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid={`${props.testId}-sheet`} className="max-h-[85dvh] overflow-y-auto"
        onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus(); }}>
        <BottomSheetHeader title={t("web.links.wordActions.title")} description={props.target.word} />
        <div className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface">
          <Slot point="wordActionsMenu" props={{ ...props, close }} />
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
