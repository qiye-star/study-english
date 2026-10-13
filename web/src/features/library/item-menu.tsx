import { EllipsisIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { IconButton } from "~/components/icon-button";
import type { LibraryItem } from "./library-api";
import "./locales";

const ITEM = cn(
  "flex min-h-tap w-full items-center gap-3 rounded-button px-3 text-left text-body text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

/** 卡片的 ⋯ 菜单(裁定 R-W1):目前只有「重新识别」。先关闭面板,再把条目交给调用方(调用方弹确认,不嵌套在面板里)。 */
export function ItemMenu({ item, onReprocess }: { item: LibraryItem; onReprocess(item: LibraryItem): void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        label={t("web.library.card.more")} data-testid={`library-item-more-${item.id}`} aria-haspopup="dialog" aria-expanded={open}
        className="text-ink-2" onClick={() => setOpen(true)}
      >
        <EllipsisIcon aria-hidden />
      </IconButton>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent data-testid="library-item-menu">
          <BottomSheetHeader title={t("web.library.card.menuTitle")} description={t("web.library.card.menuDescription")} srOnlyDescription />
          <div className="space-y-1">
            <button
              type="button" data-testid="menu-reprocess" className={ITEM}
              onClick={() => {
                setOpen(false);
                onReprocess(item);
              }}
            >
              <RefreshCwIcon aria-hidden />
              <span className="min-w-0 flex-1">{t("web.library.card.reprocess")}</span>
            </button>
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
