import { CheckIcon, FlagIcon, HelpCircleIcon, Volume2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "~/components/icon-button";
import { scoreToneClass } from "~/components/score-tone";
import { SurfaceCard } from "~/components/surface-card";
import { cn } from "~/lib/cn";
import type { BlankResult, Outcome, SpellResult, SpellWordResult } from "../wordbook-api";
import { LetterDiff } from "./letter-diff-standin";
import { OutcomeBadge } from "./outcome-badge";

const ACT = "inline-flex min-h-tap items-center gap-1 px-2 text-sub font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-button disabled:opacity-40 [&_svg]:h-[17px] [&_svg]:w-[17px]";

/** 词的错误类型说明(数据讲解,无 AI)。 */
export function outcomeNote(t: (k: string, o?: Record<string, unknown>) => string, word: SpellWordResult): string {
  if (word.outcome === "correct") return "";
  if (word.outcome === "inflection") {
    const expected = word.blanks.map((b) => b.expected).join(" ");
    return t("web.wordbookSpell.why.inflection", { expected });
  }
  return t(`web.wordbookSpell.why.${word.outcome}`);
}

function Yours({ blank }: { blank: BlankResult }) {
  const { t } = useTranslation();
  if (blank.outcome === "typo" && blank.diff.length > 0) return <LetterDiff diff={blank.diff} expected={blank.expected} />;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      {blank.typed ? (
        <s className="font-mono text-[17px] tracking-[0.02em] text-ink-2">{blank.typed}</s>
      ) : (
        <span className="text-ink-2">{t("web.wordbookSpell.notFilled")}</span>
      )}
      <span aria-hidden className="text-ink-2">→</span>
      <b className="font-mono text-[17px] font-semibold tracking-[0.02em] text-ink" aria-label={t("web.wordbookSpell.diffLabel", { word: blank.expected })}>
        {blank.expected}
      </b>
    </span>
  );
}

/**
 * 一组的结果(视觉稿 08):得分卡(role=status,提交后只播报一次)+ 每词一行:结果徽标、你写的(笔误按字母标差异)、
 * 正确拼写与朗读、词性释义、错误类型说明、「为什么?」与「举报例句」。
 */
export function SpellResults({ result, onWhy, onReport, onListen, canListen, reported }: {
  result: SpellResult;
  onWhy: (key: string) => void;
  onReport: (key: string) => void;
  onListen: (key: string, word: string) => void;
  canListen: boolean;
  reported: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const counts: Record<Outcome, number> = { correct: 0, typo: 0, inflection: 0, wrong: 0 };
  for (const w of result.words) counts[w.outcome] += 1;
  return (
    <>
      <SurfaceCard className="flex items-center gap-3.5 p-3.5" role="status" aria-live="polite">
        <div className={cn("text-hero font-semibold tabular-nums", scoreToneClass(result.credit))}>{result.credit}</div>
        <div className="min-w-0 flex-1">
          <b className="block text-body font-semibold text-ink">
            {t("web.wordbookSpell.score", { n: result.credit })}
            {result.counted ? ` · ${t("web.wordbookSpell.counted")}` : ""}
          </b>
          <span className="mt-0.5 block text-meta text-ink-2">{t("web.wordbookSpell.counts", counts)}</span>
        </div>
      </SurfaceCard>
      <SurfaceCard className="mt-2">
        <ul>
          {result.words.map((w) => {
            const note = outcomeNote(t, w);
            const sense = w.card.senses[0];
            const phonetic = w.card.us || w.card.uk;
            return (
              <li key={w.key} data-testid={`spell-result-${w.key}`} className="border-t-[0.5px] border-hair-2 px-3.5 py-3 first:border-t-0">
                <div className="flex items-center gap-2">
                  <span className="text-title font-semibold text-ink">{w.card.word || w.key}</span>
                  {phonetic ? <span className="text-meta text-ink-2">{phonetic}</span> : null}
                  <OutcomeBadge outcome={w.outcome} />
                  <IconButton
                    label={t("web.wordbookSpell.listenWord", { word: w.card.word || w.key })}
                    tone="blue"
                    className="-my-2.5 -mr-2.5 ml-auto"
                    disabled={!canListen}
                    title={canListen ? undefined : t("web.wordbookSpell.ttsUnavailable")}
                    onClick={() => onListen(w.key, w.card.word || w.key)}
                  >
                    <Volume2Icon />
                  </IconButton>
                </div>
                {w.outcome !== "correct" ? (
                  <>
                    {w.blanks.filter((b) => b.outcome !== "correct").map((b) => (
                      <div key={b.i} className="mt-1.5 flex flex-wrap items-center gap-2 text-sub text-ink-2">
                        <span>{t("web.wordbookSpell.yours")}</span>
                        <Yours blank={b} />
                      </div>
                    ))}
                    <p className="mt-1.5 text-sub leading-[1.5] text-ink">
                      {note}
                      {sense ? <em className="ml-1 not-italic text-ink-2">{`${sense.pos}. ${sense.text}`}</em> : null}
                    </p>
                  </>
                ) : null}
                <div className="-mx-2 -mb-2 mt-1 flex gap-1">
                  <button type="button" className={cn(ACT, "text-blue")} onClick={() => onWhy(w.key)}>
                    <HelpCircleIcon aria-hidden />
                    {t("web.wordbookSpell.whyButton")}
                  </button>
                  {reported.has(w.key) ? (
                    <span className={cn(ACT, "font-medium text-ink-2")}>
                      <CheckIcon aria-hidden />
                      {t("web.wordbookSpell.reported")}
                    </span>
                  ) : (
                    <button type="button" className={cn(ACT, "font-medium text-ink-2")} onClick={() => onReport(w.key)}>
                      <FlagIcon aria-hidden />
                      {t("web.wordbookSpell.report")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </SurfaceCard>
    </>
  );
}
