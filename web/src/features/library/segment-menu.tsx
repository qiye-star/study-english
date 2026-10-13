import { CopyIcon, EllipsisIcon, SlidersHorizontalIcon, SparklesIcon, StarIcon } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@renderer/lib/utils";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { IconButton } from "~/components/icon-button";
import "./locales";
import type { SaveSentenceState } from "./save-sentence";
import { ClickSpark } from "./shadow-fx";

/** 加入练习清单成功后,面板再停留这么久(ms)让 ClickSpark 的火花播完。 */
export const SPARK_MS = 600;

/**
 * 复制句子(spec §11.4:只在网页端):优先 navigator.clipboard;不可用或被拒时回退为选中句子文字
 * (SegmentText 的 <p> 带 data-segment-text="<idx>");都做不到返回 "failed"。
 */
export async function copySentence(text: string, idx: number): Promise<"copied" | "selected" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    /* 被拒(权限 / 非安全上下文):回退为选中文字 */
  }
  const el = document.querySelector<HTMLElement>(`[data-segment-text="${idx}"]`);
  const selection = document.getSelection();
  if (el && selection) {
    selection.removeAllRanges();
    selection.selectAllChildren(el);
    return "selected";
  }
  return "failed";
}

export interface SegmentMenuProps {
  idx: number;
  text: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** config.ai(spec §5.2):关闭时不显示「AI 分析」 */
  aiEnabled: boolean;
  /** 分析卡是否已打开(文字变为「收起」) */
  analysisOpen: boolean;
  /** 录音 / 评分中:分析与微调禁用 */
  busy: boolean;
  save: SaveSentenceState;
  onAnalysis(): void;
  onEdit(): void;
}

const ITEM = cn(
  "flex min-h-tap w-full items-center gap-3 rounded-button px-3 text-left text-body text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

function Item({ icon, children, ...rest }: { icon: ReactNode; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={ITEM} {...rest}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** ⋯ 动作面板(R-SH26):复制句子 · AI 分析 · 加入练习清单 · 微调。 */
export function SegmentMenu({ idx, text, open, onOpenChange, aiEnabled, analysisOpen, busy, save, onAnalysis, onEdit }: SegmentMenuProps) {
  const { t } = useTranslation();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const copy = () => {
    const pending = copySentence(text, idx); // 同步发起:仍在点按的手势里
    onOpenChange(false);
    void pending.then((how) => {
      if (how === "copied") toast.success(t("web.library.shadow.menu.copied"));
      else if (how === "selected") toast.info(t("web.library.shadow.menu.copySelected"));
      else toast.error(t("web.library.shadow.menu.copyFailed"));
    });
  };

  const saveAndClose = async () => {
    const ok = await save.save();
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => onOpenChange(false), ok ? SPARK_MS : 0);
  };

  const saved = save.state === "saved";
  return (
    <>
      <IconButton
        label={t("web.library.shadow.more")} data-testid="shadow-more" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        <EllipsisIcon aria-hidden />
      </IconButton>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent data-testid="segment-menu">
          <BottomSheetHeader title={t("web.library.shadow.menu.title")} description={t("web.library.shadow.menu.description")} srOnlyDescription />
          <div className="space-y-1">
            <Item data-testid="menu-copy" icon={<CopyIcon aria-hidden />} onClick={copy}>
              {t("web.library.shadow.menu.copy")}
            </Item>
            {aiEnabled && (
              <Item
                data-testid="menu-analysis" icon={<SparklesIcon aria-hidden />} disabled={busy}
                onClick={() => {
                  onOpenChange(false);
                  onAnalysis();
                }}
              >
                {t(analysisOpen ? "web.library.shadow.menu.analysisClose" : "web.library.shadow.menu.analysis")}
              </Item>
            )}
            <ClickSpark className="block w-full">
              <Item
                data-testid="menu-save" data-state={save.state} disabled={save.state === "saving"}
                icon={<StarIcon aria-hidden className={cn(saved && "fill-current text-amber")} />}
                onClick={() => void saveAndClose()}
              >
                {t(saved ? "web.library.shadow.saved" : "web.library.shadow.save")}
              </Item>
            </ClickSpark>
            <Item
              data-testid="menu-edit" icon={<SlidersHorizontalIcon aria-hidden />} disabled={busy}
              onClick={() => {
                onOpenChange(false);
                onEdit();
              }}
            >
              {t("web.library.shadow.menu.edit")}
            </Item>
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
