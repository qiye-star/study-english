import { XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QuoteInfo } from "../protocol";

/** 摘要为空时的说明:语音还没有转写(或转写失败)→「语音消息」;其他类型的空摘要 = 原消息被隐藏(review m2) */
const emptyKey = (quote: QuoteInfo) => (quote.kind === "voice" ? "web.rooms.extras.quoteVoice" : "web.rooms.extras.quoteHidden");

/**
 * 引用(spec §6.4,视觉稿 V12 .qb / .qbar)。
 * - QuoteBlock:气泡内的引用块(左侧 2px 发丝线、名字 12px 600 + 摘要 12px 次要色单行省略);text 为空 = 「引用的消息已被隐藏」;
 *   点按 onJump(seq)(列表滚动到已加载的原消息)。命中区上下扩到约 44px(hit-expand)。
 * - QuoteBar:输入条之上的「回复 bob:What snacks…」+ ×(× = onClear,视觉 32px、命中 44px)。
 */
export function QuoteBlock({ quote, onJump }: { quote: QuoteInfo; onJump(seq: number): void }): JSX.Element | null {
  const { t } = useTranslation();
  const name = quote.kind === "ai_answer" || quote.name === null ? t("web.rooms.room.aiName") : quote.name;
  return (
    <button type="button" data-testid="quote-block" onClick={() => onJump(quote.seq)}
      className="hit-expand mb-1.5 mt-0.5 block w-full max-w-[240px] truncate border-l-2 border-hair py-px pl-2 text-left text-meta leading-[1.45] text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <b className="mr-1 font-semibold text-ink">{name}</b>
      {quote.text ? quote.text : <i>{t(emptyKey(quote))}</i>}
    </button>
  );
}

export function QuoteBar({ quote, onClear }: { quote: QuoteInfo; onClear(): void }): JSX.Element | null {
  const { t } = useTranslation();
  const name = quote.kind === "ai_answer" || quote.name === null ? t("web.rooms.room.aiName") : quote.name;
  return (
    <div data-testid="quote-bar" className="mx-0.5 mb-2 flex items-center gap-2 rounded-[10px] bg-surface-2 py-1 pl-2.5 pr-1 text-meta text-ink-2 plate liquid:rounded-full">
      <span className="min-w-0 flex-1 truncate">
        {t("web.rooms.extras.replyTo")} <b className="font-semibold text-ink">{name}</b>{t("web.rooms.extras.replySep")}{quote.text || t(emptyKey(quote))}
      </span>
      <button type="button" aria-label={t("web.rooms.extras.clearQuote")} onClick={onClear}
        className="relative inline-flex size-8 flex-none items-center justify-center rounded-button text-ink-2 before:absolute before:-inset-1.5 before:content-[''] hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <XIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}
