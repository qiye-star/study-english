import { ArrowLeftRightIcon, CheckIcon, LightbulbIcon, PencilIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { LetterDiff } from "./letter-diff";
import { PRIMARY } from "./ui";
import { ListenButton, type ListenProps } from "./word-card";
import { isOutcome, type AnswerResult, type Outcome, type Question } from "./wordbook-api";

const OUTCOME_STYLE: Record<Outcome, { cls: string; Icon: typeof CheckIcon }> = {
  correct: { cls: "bg-green-tint text-green", Icon: CheckIcon },
  typo: { cls: "bg-amber-tint text-amber", Icon: PencilIcon },
  inflection: { cls: "bg-amber-tint text-amber", Icon: ArrowLeftRightIcon },
  wrong: { cls: "bg-surface-2 text-ink-2", Icon: XIcon },
};

/** 结果徽标(视觉稿 .ob):图标 + 文字,不只靠颜色。正确绿、小笔误 / 词形不对琥珀、错误中性。 */
export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  const { cls, Icon } = OUTCOME_STYLE[outcome];
  return (
    <span data-testid="outcome-badge" data-outcome={outcome}
      className={cn("inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-[7px] text-meta font-semibold", cls)}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {t(`web.wordbook.outcome.${outcome}`)}
    </span>
  );
}

/**
 * 键入题(spell / dictation;spec §6.4,视觉稿 05b):spell 显示释义与音标;dictation 只有 44px 朗读键,首次出现时自动播放一次,
 * 界面从不显示单词。一个关闭了自动大写 / 纠错 / 拼写检查的 <input>;「首字母」提示(得分减半)把首字母填入;回车提交。
 * 结果到达后输入框只读,显示结果徽标、逐字母差异与正确拼写。
 */
export function TypingQuestion({ question, onSubmit, result, busy = false, onListen, listening, canListen }: ListenProps & {
  question: Question; onSubmit: (answer: { typed: string; hinted: boolean }) => void; result: AnswerResult | null; busy?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [hinted, setHinted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const word = question.prompt.word ?? question.key;
  const dictation = question.qtype === "dictation";
  const listenRef = useRef(onListen);
  listenRef.current = onListen;
  const listenId = `${question.key}:q`;

  // 听写:首次出现时播放一次(音频已在「开始复习」的点击里解锁)
  useEffect(() => {
    if (dictation) listenRef.current?.(listenId, word);
  }, [dictation, listenId, word]);

  const submit = () => {
    const typed = value.trim();
    if (!typed || result || busy) return;
    onSubmit({ typed, hinted });
  };
  const hint = () => {
    if (result) return;
    setHinted(true);
    const first = word.charAt(0);
    setValue((v) => (v.toLowerCase().startsWith(first.toLowerCase()) ? v : first + v));
    inputRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Safari 提交组合的 Enter 在 compositionend 之后到达:isComposing=false 但 keyCode=229(review m5)
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <SurfaceCard data-testid="typing-question" className="px-4 py-[18px]">
      <p className="text-meta font-semibold tracking-eyebrow text-ink-2">{t(`web.wordbook.quiz.kind.${question.qtype}`)}</p>
      {dictation ? (
        <p className="mt-2 text-sub text-ink-2">{t("web.wordbook.quiz.dictationHint")}</p>
      ) : (
        <p className="mt-2 text-title font-medium leading-dialogue">
          {question.prompt.meaning}
          {question.prompt.us ? <span lang="en" className="ml-2 text-sub font-normal text-ink-2">{question.prompt.us}</span> : null}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {dictation ? (
          <ListenButton id={listenId} text={word} label={t("web.wordbook.word.listen.word")} onListen={onListen} listening={listening}
            canListen={canListen} className="h-tap w-tap flex-none justify-center rounded-full bg-blue-tint text-blue" />
        ) : null}
        <input ref={inputRef} type="text" value={value} readOnly={result !== null} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown}
          aria-label={t(dictation ? "web.wordbook.quiz.dictationInput" : "web.wordbook.quiz.spellInput")}
          placeholder={dictation ? t("web.wordbook.quiz.dictationPlaceholder") : undefined}
          autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" lang="en"
          className="h-tap min-w-0 flex-1 rounded-button bg-surface-2 px-3 text-title tracking-[0.02em] text-ink placeholder:text-body placeholder:tracking-normal placeholder:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:opacity-80" />
        {!result ? (
          <button type="button" onClick={hint} disabled={busy || hinted} aria-pressed={hinted}
            className="inline-flex h-tap flex-none items-center gap-1 rounded-button border-[0.5px] border-hair px-3 text-sub font-semibold text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            <LightbulbIcon aria-hidden className="h-4 w-4" />{t("web.wordbook.quiz.hint")}
          </button>
        ) : null}
      </div>
      {question.length && !dictation ? <p className="mt-1.5 text-meta text-ink-2">{t("web.wordbook.quiz.length", { n: question.length })}</p> : null}
      {!result ? (
        <button type="button" onClick={submit} disabled={busy || !value.trim()} className={cn(PRIMARY, "mt-3 h-11 w-full")}>
          {t("web.wordbook.quiz.submit")}
        </button>
      ) : (
        <div className="mt-3 space-y-1.5">
          {isOutcome(result.outcome) ? <OutcomeBadge outcome={result.outcome} /> : null}
          {result.diff && result.outcome !== "correct" ? (
            <p className="flex flex-wrap items-center gap-2 text-sub text-ink-2">
              {t("web.wordbook.quiz.yours")}<LetterDiff diff={result.diff} expected={result.expected} />
            </p>
          ) : null}
          {result.outcome !== "correct" ? (
            <p data-testid="typing-expected" className="text-sub text-ink-2">
              {t("web.wordbook.quiz.expected")} <b lang="en" className="text-body font-semibold text-ink">{result.expected}</b>
            </p>
          ) : null}
        </div>
      )}
    </SurfaceCard>
  );
}
