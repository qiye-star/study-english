import { RotateCwIcon, Volume2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SurfaceCard } from "~/components/surface-card";
import { RatingBadge } from "./recall-rating-bar";
import type { Rating } from "./session-machine";
import { ListenButton, WordCardView, type ListenProps } from "./word-card";
import type { Card, Question } from "./wordbook-api";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 翻面进场:减少动态时直接显示;否则下一帧从 rotateY(80deg) 转回 0(180ms,只动卡片自己,不动玻璃层)。 */
function useEntered() {
  const [entered, setEntered] = useState(prefersReducedMotion);
  useEffect(() => {
    if (entered) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [entered]);
  return entered;
}

function Back({ card, rating, showExample, listen }: {
  card: Card; rating: Rating | null; showExample: boolean; listen: ListenProps;
}) {
  const { t } = useTranslation();
  const entered = useEntered();
  return (
    <div data-testid="recall-back" style={{ transform: entered ? "none" : "perspective(800px) rotateY(80deg)", transition: "transform 180ms ease-out" }}
      className="motion-reduce:!transition-none">
      <WordCardView card={card} {...listen} showExample={showExample} eyebrow={t("web.wordbook.recall.kind")}
        badge={rating ? <RatingBadge rating={rating} /> : null} />
    </div>
  );
}

/**
 * 复习「快速回忆」(spec 2026-10-11-wordbook-recall §4.2,视觉稿 05 / 07):正面只有词头与音标(没有遮罩,复习不能偷看);
 * 背面 = 完整词卡 + 评级徽标。抽查题(视觉稿 06)由复习页用选择题渲染。
 */
export function RecallCard({ question, card, face, rating, showExample = true, onListen, listening, canListen }: ListenProps & {
  question: Question; card: Card | undefined; face: "front" | "back"; rating: Rating | null; showExample?: boolean;
}) {
  const { t } = useTranslation();
  const listen = { onListen, listening, canListen };
  if (face === "back" && card) return <Back card={card} rating={rating} showExample={showExample} listen={listen} />;
  const word = question.prompt.word ?? card?.word ?? "";
  const ipa = question.prompt.us || card?.us || card?.uk;
  return (
    <>
      <SurfaceCard data-testid="recall-card" className="flex min-h-[340px] flex-col items-center justify-center px-4 py-7 text-center">
        <p className="eyebrow">{t("web.wordbook.recall.kind")}</p>
        <h2 lang="en" data-testid="question-word" className="mt-3 max-w-full break-words text-[40px] font-semibold tracking-[-0.02em]"
          style={{ lineHeight: 1.1, overflowWrap: "anywhere" }}>{word}</h2>
        <ListenButton id={`${question.key}:recall`} text={word} label={t("web.wordbook.word.listen.word")} {...listen}
          className="mt-2.5 h-tap bg-surface-2 pl-1.5 pr-3 text-body text-ink">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-surface text-blue shadow-hair">
            <Volume2Icon className="h-[18px] w-[18px]" />
          </span>
          {ipa ? <span lang="en" className="font-[CharisSIL,ui-serif,serif]">{ipa}</span> : null}
        </ListenButton>
        <p className="mt-[22px] text-sub text-ink-2">{t("web.wordbook.recall.prompt")}</p>
      </SurfaceCard>
      <p className="mx-0.5 mt-2.5 flex items-center gap-1.5 text-meta text-ink-2">
        <RotateCwIcon aria-hidden className="h-[15px] w-[15px] flex-none" />{t("web.wordbook.recall.flipNote")}
      </p>
    </>
  );
}
