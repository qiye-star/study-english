import { ArrowUpRightIcon, ChevronRightIcon, LightbulbIcon, LoaderIcon, PlayIcon, RotateCcwIcon, ScanTextIcon, SparklesIcon, SquareIcon, StarIcon, Volume2Icon } from "lucide-react";
import { Fragment, useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { scoreTone } from "~/components/score-tone";
import { cn } from "~/lib/cn";
import type { AssessmentScores, AssessmentWordBrief } from "../assessment-api";
import "./shadow-locales";
import { ClickSpark, useCountUp } from "./shadow-fx";
import { lowWords, selectWord, tipFor, tokenizeSentence, wordTones } from "./word-tap";

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
const rise = (n: number) => ({ "--d": n }) as CSSProperties;

/** 评分环:两个半圆各转一个角度(不重绘渐变);数字用 CountUp 滚动,终值放在 sr-only 里给读屏与测试。 */
export function ScoreRing({ score, caption, animate }: { score: number; caption: string; animate?: boolean }) {
  const value = useCountUp(score, { enabled: animate });
  const tone = scoreTone(score);
  const deg = (360 * value) / 100;
  return (
    <div className="shs-ring" data-testid="shadow-ring" data-score={Math.round(score)} data-tone={tone}>
      <div className="shs-ring-trk" />
      <div className="shs-ring-half shs-ring-half--r"><i style={{ transform: `rotate(${Math.min(deg, 180)}deg)` }} /></div>
      <div className="shs-ring-half shs-ring-half--l"><i style={{ transform: `rotate(${Math.max(0, deg - 180)}deg)` }} /></div>
      <b className={cn("shs-ring-num num", tone === "good" && "shs-gt")} aria-hidden>{Math.round(value)}</b>
      <span className="sr-only">{Math.round(score)}</span>
      <small aria-hidden>{caption}</small>
    </div>
  );
}

export interface ShadowResultProps {
  reference: string;
  scores: AssessmentScores;
  words: AssessmentWordBrief[];
  /** 本次评测的 WAV(blob URL);没有时「我的录音」不可用 */
  mineUrl: string | null;
  playingMine: boolean;
  /** 「标准发音」(与「听范读」同一个 TTS 键) */
  listenState: "idle" | "loading" | "playing" | "error";
  canListen: boolean;
  faved: boolean;
  favBusy: boolean;
  /** 单句入口 / 最后一句 = done;还有下一句 = next */
  nextKind: "next" | "done";
  onToggleMine(): void;
  onListen(): void;
  onFav(): void;
  onAgain(): void;
  onContinue(): void;
  onDetails(): void;
}

/**
 * 弹窗里的简化结果(spec §3.1、D3):评分环 + 三条分数条 + 行内逐词着色(点词查词,不带波形)+ 一句话提示 +
 * 我的录音 / 标准发音 / 收藏 + 再练一次 / 下一句(完成)+ 查看完整详情。评分色沿用 score-tone(≥85 绿 / 70–84 琥珀 / <70 灰)。
 * 每次评分由调用方以 assessmentId 作 key 重新挂载,所以入场动画每次都重放。
 */
export function ShadowResult({
  reference, scores, words, mineUrl, playingMine, listenState, canListen, faved, favBusy, nextKind,
  onToggleMine, onListen, onFav, onAgain, onContinue, onDetails,
}: ShadowResultProps) {
  const { t } = useTranslation();
  const main = clamp(scores.pronunciationScore);
  const tokens = useMemo(() => tokenizeSentence(reference), [reference]);
  const tones = useMemo(() => wordTones(tokens, words), [tokens, words]);
  const tip = tipFor(main, lowWords(tokens, tones));
  const stats = [
    ["accuracyScore", scores.accuracyScore],
    ["fluencyScore", scores.fluencyScore],
    ["completenessScore", scores.completenessScore],
  ] as const;
  const TipIcon = tip.kind === "good" ? SparklesIcon : LightbulbIcon;

  return (
    <div data-testid="shadow-result">
      <div className="shs-score shs-tint shs-rise" style={rise(0)}>
        <ScoreRing score={main} caption={t("web.practice.shadow.total")} />
        <div className="shs-bars">
          {stats.map(([key, value], i) => {
            const v = clamp(value);
            return (
              <div key={key} className="shs-bar" data-testid="shadow-bar" data-tone={scoreTone(v)}>
                <div className="shs-bar-l"><span>{t(`models.pronunciationAssessment.${key}`)}</span><b className="num">{Math.round(v)}</b></div>
                <div className="shs-bar-t"><b style={{ "--v": v / 100, "--d": i } as CSSProperties} /></div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="shs-words shs-tint shs-rise" style={rise(1)}>
        <div className="shs-eyebrow"><ScanTextIcon aria-hidden />{t("web.practice.shadow.wordsTitle")}</div>
        <p data-testid="shadow-words" data-lookup-context className="shs-sel">
          {tokens.map((tok, i) =>
            tok.word < 0 ? (
              <Fragment key={i}>{tok.text}</Fragment>
            ) : (
              <span key={i} data-word={tok.word} data-tone={tones[tok.word] ?? "none"} className="shs-wd"
                style={{ "--d": tok.word } as CSSProperties} onClick={(e) => selectWord(e.currentTarget)}>
                {tok.text}
              </span>
            ),
          )}
        </p>
      </div>

      <div className="shs-tip shs-rise" data-testid="shadow-tip" data-kind={tip.kind} style={rise(2)}>
        <TipIcon aria-hidden />
        <div>{t(`web.practice.shadow.tip.${tip.kind}`, { words: tip.words.join(", ") })}</div>
      </div>

      <div className="shs-mini shs-rise" style={rise(3)}>
        <button type="button" data-testid="shadow-mine" data-state={playingMine ? "playing" : "idle"}
          className="shs-chip shs-chip--blue" disabled={!mineUrl} onClick={onToggleMine}>
          {playingMine ? <SquareIcon aria-hidden /> : <PlayIcon aria-hidden />}
          {playingMine ? t("web.practice.shadow.stopMine") : t("web.practice.shadow.mine")}
        </button>
        <button type="button" data-testid="shadow-standard" data-state={listenState} className="shs-chip shs-tint"
          disabled={!canListen && listenState !== "playing"} onClick={onListen}>
          {listenState === "loading" ? <LoaderIcon aria-hidden className="shs-spin" /> : listenState === "playing" ? <SquareIcon aria-hidden /> : <Volume2Icon aria-hidden />}
          {t("web.practice.shadow.standard")}
        </button>
        <ClickSpark disabled={faved || favBusy}>
          <button type="button" data-testid="shadow-fav" className={cn("shs-chip shs-tint", faved && "shs-chip--faved")}
            disabled={faved || favBusy} onClick={onFav}>
            <StarIcon aria-hidden className={faved ? "fill-current" : undefined} />
            {faved ? t("web.practice.shadow.faved") : t("web.practice.shadow.fav")}
          </button>
        </ClickSpark>
      </div>

      <div className="shs-foot shs-rise" style={rise(4)}>
        <button type="button" data-testid="shadow-again" className="shs-btn shs-btn--ghost shs-tint" onClick={onAgain}>
          <RotateCcwIcon aria-hidden />{t("web.practice.shadow.again")}
        </button>
        <button type="button" data-testid="shadow-continue" data-kind={nextKind} className="shs-btn shs-btn--primary" onClick={onContinue}>
          {nextKind === "next" ? t("web.practice.shadow.nextSentence") : t("web.practice.shadow.done")}
          <ChevronRightIcon aria-hidden />
        </button>
      </div>

      <button type="button" data-testid="shadow-details" className="shs-link shs-rise" style={rise(5)} onClick={onDetails}>
        {t("web.practice.shadow.details")}<ArrowUpRightIcon aria-hidden />
      </button>
    </div>
  );
}
