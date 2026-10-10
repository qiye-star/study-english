import { EyeIcon } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

/**
 * 新词卡的释义遮罩(spec 2026-10-11-wordbook-recall §3.1,视觉稿 01 / 09):真正的按钮(Enter / Space 可用),高 120px(≥ 96px);
 * 遮罩时释义、例句、短语不在 DOM 里(不靠模糊或透明度);两条灰条只是占位形状。点开后整块被释义区替换,
 * 所以 `aria-expanded` 恒为 false;`aria-controls` 指向释义区的 id。
 */
export function RecallCover({ controls, onReveal }: { controls: string; onReveal: () => void }) {
  const { t } = useTranslation();
  const hint = useId();
  // 名称只取「显示释义」,副文字作描述:读屏读「显示释义,已折叠」再读提示,而不是把整块文字当名称
  return (
    <button type="button" data-testid="recall-cover" aria-expanded={false} aria-controls={controls} onClick={onReveal}
      aria-label={t("web.wordbook.learn.reveal")} aria-describedby={hint}
      className="mt-3.5 flex min-h-[120px] w-full flex-col items-center justify-center gap-1 rounded-badge bg-surface-2 px-4 py-4 text-center text-ink transition-colors duration-fast active:bg-hair-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span aria-hidden className="mb-2.5 flex w-[62%] flex-col items-center gap-1.5">
        <i className="block h-2 w-full rounded-[4px] bg-hair-2" />
        <i className="block h-2 w-[72%] self-start rounded-[4px] bg-hair-2" />
      </span>
      <span className="inline-flex items-center gap-1.5 text-body font-semibold">
        <EyeIcon aria-hidden className="h-5 w-5" />{t("web.wordbook.learn.reveal")}
      </span>
      <span id={hint} className="text-sub text-ink-2">{t("web.wordbook.learn.revealHint")}</span>
    </button>
  );
}
