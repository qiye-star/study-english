import { CheckIcon, CircleCheckIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { selectWord } from "~/lib/select-word";
import { LongPressHint } from "./long-press-hint";
import { infoFor, optionRowView } from "./option-view";
import { useLongPress } from "./use-long-press";
import { ListenButton, type ListenProps } from "./word-card";
import type { AnswerResult, OptionInfo, Question } from "./wordbook-api";
import "./locales";

/** 选择题作答结果:你选的项、是否正确、正确项文本(不知道时为 null)。 */
export interface ChoiceResult { choice: string; correct: boolean; correctOption: string | null }

/**
 * 答题后界面的开关(计划 2026-10-13-review-after-answer R-A7):只有复习页在答题后传它。传了(cloze 还须有选项信息)才把选项换成
 * 非禁用的普通容器 + 长按查词 + 一次性提示;没传(学新词页、抽查题)逐字节保持原来的禁用按钮。
 * 选项行本身就是双语的(计划 2026-10-14-review-bilingual-longpress R-Z1),「中文」按钮在「学习内容」区,不在这里。
 */
export interface AfterAnswer {
  /** `/answers` 的 optionInfo;老服务端 / 备忘取不到 / 非 meaning·word 题为 undefined */
  info?: OptionInfo[];
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const BLANK = "_____";

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
 * 复习页答题后传 `after`:选项换成普通容器;meaning 题 = 中文原文 + 小字英文单词,word 题 = 英文单词 + 小字词性与中文(R-Z1);
 * 长按 450 ms → 程序化选中该行的英文单词 → 全局选词操作条(R-L1–R-L5,只在答题后)。
 */
export function ChoiceQuestion({ question, onAnswer, result, busy = false, onListen, listening, canListen, after }: ListenProps & {
  question: Question; onAnswer: (choice: string) => void; result: ChoiceResult | null; busy?: boolean; after?: AfterAnswer;
}) {
  const { t } = useTranslation();
  const { prompt, qtype } = question;
  const hasInfo = (after?.info?.length ?? 0) > 0;
  // cloze 没有选项信息(老服务端 / 备忘取不到)时保持原样:禁用的按钮
  const answered = result !== null && after !== undefined && (qtype !== "cloze" || hasInfo);
  const tappable = answered && (qtype === "word" || qtype === "cloze" || hasInfo);

  const lookUp = (row: HTMLElement) => {
    const el = row.querySelector<HTMLElement>("[data-option-word]");
    if (el) selectWord(el);
  };
  // 长按查词:hook 无条件调用,处理器只展开到答题后有单词的行上(R-L1)
  const press = useLongPress(lookUp);
  // detail === 0:键盘 / 读屏「激活」产生的合成点击,一次就查;真实点按(detail ≥ 1)什么也不做(R-L5)
  const onRowClick = (e: MouseEvent<HTMLElement>) => {
    if (e.detail === 0) lookUp(e.currentTarget);
  };
  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    lookUp(e.currentTarget);
  };

  return (
    <SurfaceCard data-testid="choice-question" className="px-4 py-[18px]">
      <p className="text-meta font-semibold tracking-eyebrow text-ink-2">{t(`web.wordbook.quiz.kind.${qtype}`)}</p>
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
            const row = optionRowView(qtype, option, infoFor(after?.info, option));
            const lookupProps = row.word ? {
              role: "button" as const, tabIndex: 0, ...press(String(i)), onClick: onRowClick, onKeyDown: onRowKeyDown,
            } : {};
            const wordSpan = row.word ? (
              <span data-testid="option-word" data-option-word="" data-lookup-context lang="en" className="select-text break-words">{row.word}</span>
            ) : null;
            return (
              <li key={`${i}:${option}`}>
                <div data-testid="choice-option" data-state={state} {...lookupProps}
                  className={cn(
                    "flex min-h-[52px] w-full touch-manipulation items-center gap-2.5 rounded-button border-[0.5px] px-3.5 text-left text-body transition-colors duration-fast",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    state === "correct" ? "border-transparent bg-green-tint font-semibold text-green"
                      : state === "wrong" ? "border-hair bg-surface text-ink-2" : "border-hair bg-surface text-ink",
                    row.word && "cursor-pointer select-none [-webkit-touch-callout:none]",
                  )}>
                  {badge}
                  <span className="min-w-0 flex-1 py-2">
                    {row.wordLine === "main" ? (
                      <>
                        <span className="block font-semibold">{wordSpan}</span>
                        {row.sub ? <small className="mt-0.5 block break-words text-sub font-normal text-ink-2">{row.sub}</small> : null}
                      </>
                    ) : row.wordLine === "sub" ? (
                      <>
                        <span data-testid="option-main" className="block break-words">{row.main}</span>
                        <small className="mt-0.5 block text-sub font-medium text-ink-2">{wordSpan}</small>
                      </>
                    ) : state === "wrong" ? <s className="decoration-[1.5px]">{row.main}</s> : row.main}
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
      {tappable ? <LongPressHint /> : null}
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
