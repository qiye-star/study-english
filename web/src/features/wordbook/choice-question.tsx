import { CheckIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { ListenButton, meaningLine, type ListenProps } from "./word-card";
import type { Card, Question } from "./wordbook-api";

/** 选择题作答结果:你选的项、是否正确、正确项文本(不知道时为 null)。 */
export interface ChoiceResult { choice: string; correct: boolean; correctOption: string | null }

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

/**
 * 选择题(meaning / word / cloze;spec §6.4,视觉稿 05 / 05b):题面 + 4 个 ≥ 52px 选项。
 * 结果到达后:正确项绿底 + 勾,你选错的项中性删除线 + ×,其余不变;选项不再可点。
 */
export function ChoiceQuestion({ question, onAnswer, result, busy = false, onListen, listening, canListen }: ListenProps & {
  question: Question; onAnswer: (choice: string) => void; result: ChoiceResult | null; busy?: boolean;
}) {
  const { t } = useTranslation();
  const { prompt, qtype } = question;
  return (
    <SurfaceCard data-testid="choice-question" className="px-4 py-[18px]">
      <p className="text-meta font-semibold tracking-eyebrow text-ink-2">{t(`web.wordbook.quiz.kind.${qtype}`)}</p>
      {qtype === "meaning" ? (
        <>
          <div className="mt-2 flex items-center gap-2.5">
            <span data-testid="question-word" lang="en" className="break-words text-[30px] font-semibold tracking-[-0.02em]">{prompt.word}</span>
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
          const state = !result ? "idle"
            : option === result.correctOption || (result.correct && option === result.choice) ? "correct"
            : option === result.choice ? "wrong" : "idle";
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
                <span aria-hidden className={cn(
                  "flex h-6 w-6 flex-none items-center justify-center rounded-[7px] text-meta font-semibold",
                  state === "correct" ? "bg-green text-on-blue" : "bg-surface-2 text-ink-2",
                )}>
                  {state === "correct" ? <CheckIcon className="h-[15px] w-[15px]" strokeWidth={3} /> : LETTERS[i]}
                </span>
                <span className="min-w-0 flex-1 py-2">{state === "wrong" ? <s className="decoration-[1.5px]">{option}</s> : option}</span>
                {state === "correct" ? <CircleCheckIcon aria-hidden className="h-5 w-5 flex-none" /> : null}
                {state === "wrong" ? <XIcon aria-hidden className="h-5 w-5 flex-none text-ink-2" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </SurfaceCard>
  );
}

/** 选择题的正确项:先按服务端 `expected` 找(选词题即词头),释义题按与服务端相同的释义行找。 */
export function correctOptionOf(question: Question, expected: string, card: Card | undefined): string | null {
  const options = question.options ?? [];
  const exact = options.find((o) => o === expected) ?? options.find((o) => o.toLowerCase() === expected.toLowerCase());
  if (exact) return exact;
  if (question.qtype === "meaning" && card) {
    const line = meaningLine(card.senses);
    return options.find((o) => o === line) ?? null;
  }
  return null;
}
