import { CheckIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { selectWord } from "~/lib/select-word";
import { DEFAULT_DEF_LANG } from "./def-lang";
import { createTapTracker } from "./double-tap";
import { DoubleTapHint } from "./double-tap-hint";
import { infoFor, optionRowView, optionsCanPeek } from "./option-view";
import { ListenButton, type ListenProps } from "./word-card";
import type { AnswerResult, DefLang, OptionInfo, Question } from "./wordbook-api";
import "./locales";

/** 选择题作答结果:你选的项、是否正确、正确项文本(不知道时为 null)。 */
export interface ChoiceResult { choice: string; correct: boolean; correctOption: string | null }

/**
 * 答题后界面的开关(计划 2026-10-13-review-after-answer R-A7):只有复习页在答题后传它。传了(且不是 cloze)才把选项换成
 * 非禁用的普通容器 + 双击查词 + 一次性提示;没传(学新词页、抽查题)逐字节保持原来的禁用按钮。
 */
export interface AfterAnswer {
  /** `/answers` 的 optionInfo;老服务端 / 备忘取不到 / 非 meaning·word 题为 undefined */
  info?: OptionInfo[];
  defLang: DefLang;
  /** 「中」开关:本题临时显示中文(meaning 题,「仅英文」下才有意义);状态由复习页持有 */
  peek: boolean;
  onPeek: () => void;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const BLANK = "_____";
const now = () => performance.now();

/** 例句选词的题面:把 `_____` 画成下划线空(视觉稿 .mini .gap),读屏读「空」。 */
function ClozeSentence({ sentence }: { sentence: string }) {
  const { t } = useTranslation();
  const parts = sentence.split(BLANK);
  return (
    <p lang="en" className="mt-2 text-title font-medium leading-dialogue">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            <span role="img" aria-label={t("web.wordbook.quiz.blank")}
              className="mx-0.5 inline-block h-[1.1em] min-w-16 border-b-2 border-ink-3 align-[-3px]">
              <span className="sr-only">{BLANK}</span>
            </span>
          ) : null}
        </span>
      ))}
    </p>
  );
}

type OptionState = "idle" | "correct" | "wrong";

/**
 * 选择题(meaning / word / cloze;spec §6.4,视觉稿 05 / 05b):题面 + 4 个 ≥ 52px 选项。
 * 结果到达后:正确项绿底 + 勾,你选错的项中性删除线 + ×,其余不变;选项不再可点。
 * 复习页答题后传 `after`(spec 2026-10-13-review-after-answer §2.3):选项换成普通容器,显示英文单词(meaning 题中文默认藏起,
 * 「中」开关才看;word 题带小字中文与词性),双击 / 300 ms 内连点两次 → 程序化选中该选项的单词 → 全局选词操作条。
 */
export function ChoiceQuestion({ question, onAnswer, result, busy = false, onListen, listening, canListen, after }: ListenProps & {
  question: Question; onAnswer: (choice: string) => void; result: ChoiceResult | null; busy?: boolean; after?: AfterAnswer;
}) {
  const { t } = useTranslation();
  const { prompt, qtype } = question;
  const [tracker] = useState(() => createTapTracker());
  const answered = result !== null && after !== undefined && qtype !== "cloze";
  const defLang = after?.defLang ?? DEFAULT_DEF_LANG;
  const peek = after?.peek ?? false;
  const canPeek = answered && optionsCanPeek(qtype, defLang, after?.info);
  const tappable = answered && (qtype === "word" || (after?.info?.length ?? 0) > 0);

  const lookUp = (row: HTMLElement) => {
    const el = row.querySelector<HTMLElement>("[data-option-word]");
    if (el) selectWord(el);
  };
  // detail === 0:键盘 / 读屏「激活」产生的合成点击,一次就查;真实点按的 detail ≥ 1
  const onRowClick = (e: MouseEvent<HTMLElement>, id: string) => {
    if (e.detail === 0 || tracker.tap(id, now())) lookUp(e.currentTarget);
  };
  const onRowDoubleClick = (e: MouseEvent<HTMLElement>) => {
    if (tracker.dblclick(now())) lookUp(e.currentTarget);
  };
  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    lookUp(e.currentTarget);
  };

  const eyebrow = <p className="text-meta font-semibold tracking-eyebrow text-ink-2">{t(`web.wordbook.quiz.kind.${qtype}`)}</p>;
  return (
    <SurfaceCard data-testid="choice-question" className="px-4 py-[18px]">
      {canPeek ? (
        <div className="flex min-h-[22px] items-center justify-between gap-2">
          {eyebrow}
          <button type="button" data-testid="option-peek" aria-pressed={peek} aria-label={t("web.wordbookDefs.peek.label")}
            onClick={() => after?.onPeek()}
            className={cn(
              "-my-2.5 -mr-2 inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-body font-semibold transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              peek ? "bg-surface-2 text-ink" : "text-ink-2",
            )}>
            <span aria-hidden>中</span>
          </button>
        </div>
      ) : eyebrow}
      {qtype === "meaning" ? (
        <>
          <div className="mt-2 flex items-center gap-2.5">
            {/* min-w-0 + overflow-wrap:anywhere:长词(SAT/TOEFL)能折行,不把 375px 屏撑出横向滚动(review m6) */}
            <span data-testid="question-word" lang="en"
              className={cn("min-w-0 font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]", (prompt.word ?? "").length > 14 ? "text-[26px]" : "text-[30px]")}>
              {prompt.word}
            </span>
            <ListenButton id={`${question.key}:q`} text={prompt.word ?? ""} label={t("web.wordbook.word.listen.word")}
              onListen={onListen} listening={listening} canListen={canListen}
              className="h-tap w-tap flex-none justify-center rounded-full bg-blue-tint text-blue" />
          </div>
          {prompt.us ? <p lang="en" className="mt-0.5 text-sub text-ink-2">{prompt.us}</p> : null}
        </>
      ) : qtype === "word" ? (
        <p data-testid="question-meaning" className="mt-2 text-title font-medium leading-dialogue">{prompt.meaning}</p>
      ) : (
        <>
          <ClozeSentence sentence={prompt.sentence ?? ""} />
          {prompt.zh ? <p className="mt-1 text-sub text-ink-2">{prompt.zh}</p> : null}
        </>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {(question.options ?? []).map((option, i) => {
          const state: OptionState = !result ? "idle"
            : option === result.correctOption || (result.correct && option === result.choice) ? "correct"
            : option === result.choice ? "wrong" : "idle";
          const badge = (
            <span aria-hidden className={cn(
              "flex h-6 w-6 flex-none items-center justify-center rounded-[7px] text-meta font-semibold",
              state === "correct" ? "bg-green text-on-blue" : "bg-surface-2 text-ink-2",
            )}>
              {state === "correct" ? <CheckIcon className="h-[15px] w-[15px]" strokeWidth={3} /> : LETTERS[i]}
            </span>
          );
          const icon = state === "correct" ? <CircleCheckIcon aria-hidden className="h-5 w-5 flex-none" />
            : state === "wrong" ? <XIcon aria-hidden className="h-5 w-5 flex-none text-ink-2" /> : null;
          if (answered) {
            const row = optionRowView(qtype, option, infoFor(after?.info, option), defLang, peek);
            const lookupProps = row.word ? {
              role: "button" as const, tabIndex: 0,
              onClick: (e: MouseEvent<HTMLElement>) => onRowClick(e, String(i)), onDoubleClick: onRowDoubleClick, onKeyDown: onRowKeyDown,
            } : {};
            return (
              <li key={`${i}:${option}`}>
                <div data-testid="choice-option" data-state={state} {...lookupProps}
                  className={cn(
                    "flex min-h-[52px] w-full touch-manipulation items-center gap-2.5 rounded-button border-[0.5px] px-3.5 text-left text-body transition-colors duration-fast",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    state === "correct" ? "border-transparent bg-green-tint font-semibold text-green"
                      : state === "wrong" ? "border-hair bg-surface text-ink-2" : "border-hair bg-surface text-ink",
                    row.word && "cursor-pointer",
                  )}>
                  {badge}
                  <span className="min-w-0 flex-1 py-2">
                    {row.word ? (
                      <>
                        <span data-testid="option-word" data-option-word="" data-lookup-context lang="en"
                          className="select-text break-words font-semibold">{row.word}</span>
                        {row.sub ? <small className="mt-0.5 block select-text break-words text-sub font-normal text-ink-2">{row.sub}</small> : null}
                      </>
                    ) : state === "wrong" ? <s className="decoration-[1.5px]">{option}</s> : option}
                    {state !== "idle" ? (
                      <span className="sr-only">{" "}{t(state === "correct" ? "web.wordbookDefs.after.correct" : "web.wordbookDefs.after.yours")}</span>
                    ) : null}
                  </span>
                  {icon}
                </div>
              </li>
            );
          }
          return (
            <li key={`${i}:${option}`}>
              <button type="button" data-state={state} disabled={busy || result !== null} onClick={() => onAnswer(option)}
                lang={qtype === "meaning" ? undefined : "en"}
                className={cn(
                  "flex min-h-[52px] w-full items-center gap-2.5 rounded-button border-[0.5px] px-3.5 text-left text-body transition-colors duration-fast",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  state === "correct" ? "border-transparent bg-green-tint font-semibold text-green"
                    : state === "wrong" ? "border-hair bg-surface text-ink-2" : "border-hair bg-surface text-ink active:bg-surface-2",
                )}>
                {badge}
                <span className="min-w-0 flex-1 py-2">{state === "wrong" ? <s className="decoration-[1.5px]">{option}</s> : option}</span>
                {icon}
              </button>
            </li>
          );
        })}
      </ul>
      {tappable ? <DoubleTapHint /> : null}
    </SurfaceCard>
  );
}

/**
 * 选择题的正确项 = 服务端 `/answers` 的 `correct_option`(Ruling Z-e:与题目 options 里那一项逐字相同)。
 * 不在选项里或为 null 时返回 null:只标出用户选错的那项,不在客户端猜。
 */
export function correctOptionOf(question: Question, result: Pick<AnswerResult, "correctOption">): string | null {
  const option = result.correctOption;
  return option !== null && (question.options ?? []).includes(option) ? option : null;
}
