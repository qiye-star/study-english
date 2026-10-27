import { EyeIcon, LightbulbIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { lookupContext } from "~/lib/lookup-context";
import { LetterDiff } from "../letter-diff";
import { OutcomeBadge } from "../typing-question";
import { PRIMARY } from "../ui";
import type { Speaker } from "../use-speaker";
import { ListenButton } from "../word-card";
import { isOutcome, type AnswerResult, type FreeItem } from "../wordbook-api";
import { readPrefs, writePrefs, type WordSpellMode } from "./prefs";

/**
 * 单词拼写的一题(plan 2026-10-27 R-W6 / R-W7 / R-W8)。两种玩法:
 * - dictation(单词听写):只有朗读键,界面从不显示单词;没有偷看。
 * - meaning(看中文拼英文):中文释义 + 旁边的朗读键;想不起来时点输入框的边框或小眼睛按钮看单词,
 *   单词只显示到开始输入为止;偷看过的题提交时算「用过提示」(hinted)。
 * 正误只看服务端 /answers 的响应;结果出来后才显示徽标、逐字母差异与正确拼写(可查词)。
 */
export function WordSpellQuestion({ item, mode, result, busy, onSubmit, speaker }: {
  item: FreeItem; mode: WordSpellMode; result: AnswerResult | null; busy: boolean;
  onSubmit: (answer: { typed: string; hinted: boolean }) => void;
  speaker: Pick<Speaker, "available" | "listen" | "active">;
}) {
  const { t } = useTranslation();
  const word = item.card.word;
  const listenId = `${item.card.key}:q`;
  const dictation = mode === "dictation";
  // 重播必须换一个播放 id:TTS 播放器对同一个 id 的 play() 只会停止(见 features/chat/use-tts-player.ts),
  // 播完后同一个 id 再点就不发请求。
  const replaySeq = useRef(0);
  const [playId, setPlayId] = useState(listenId);
  const replay = () => {
    const id = `${listenId}:${++replaySeq.current}`;
    setPlayId(id);
    speaker.listen(id, word, "us");
  };
  const peekable = !dictation && result === null;
  const [value, setValue] = useState("");
  const [hinted, setHinted] = useState(false);
  const [peeked, setPeeked] = useState(false); // 锁存:看过单词,本题提交时算提示
  const [showing, setShowing] = useState(false); // 当前是否显示着单词牌子
  const [hintLine] = useState(() => !readPrefs().wordSpellPeekHintSeen); // 首次提示只在挂载时决定一次
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hintLine && !dictation) writePrefs({ wordSpellPeekHintSeen: true });
  }, [hintLine, dictation]);

  const peek = () => {
    if (!peekable) return;
    setPeeked(true);
    setShowing(true);
  };
  // 只有按在框本身上才算看单词;按在输入框里是正常输入
  const onFramePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) peek();
  };
  // 点框不收起键盘:阻止框本身的 mousedown 默认行为(输入框内的点击照常聚焦)
  const onFrameMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) e.preventDefault();
  };
  const onChange = (next: string) => {
    setValue(next);
    setShowing(false); // 开始输入(含删空)后收起;想再看要再点框线
  };

  const submit = () => {
    const typed = value.trim();
    if (!typed || result || busy) return;
    onSubmit({ typed, hinted: hinted || peeked });
  };
  const hint = () => {
    if (result) return;
    setHinted(true);
    const first = word.charAt(0);
    setValue((v) => (v.toLowerCase().startsWith(first.toLowerCase()) ? v : first + v));
    inputRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Safari 提交组合的 Enter 在 compositionend 之后到达:isComposing=false 但 keyCode=229
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <SurfaceCard data-testid="word-spell-question" className="px-4 py-[18px]">
      {dictation ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sub text-ink-2">{t("web.wordSpell.dictationHint")}</p>
          <ListenButton id={playId} text={word} accent="us" label={t("web.wordbook.word.listen.word")} onListen={replay}
            listening={speaker.active} canListen={speaker.available}
            className="h-20 w-20 flex-none justify-center rounded-full bg-blue-tint text-blue liquid:rounded-full liquid:bg-wash liquid:text-ink liquid:shadow-well" />
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p data-testid="word-spell-meaning" className="text-headline font-semibold leading-dialogue">{item.question?.prompt.meaning}</p>
            {item.question?.length ? <p className="mt-1 text-meta text-ink-2">{t("web.wordbook.quiz.length", { n: item.question.length })}</p> : null}
          </div>
          <ListenButton id={playId} text={word} accent="us" label={t("web.wordbook.word.listen.word")} onListen={replay}
            listening={speaker.active} canListen={speaker.available}
            className="h-tap w-tap flex-none justify-center rounded-full bg-blue-tint text-blue liquid:rounded-full liquid:bg-wash liquid:text-ink liquid:shadow-well" />
        </div>
      )}

      {peekable && showing ? (
        <p data-testid="word-spell-peek" aria-live="polite" lang="en" className="mt-3 text-title font-semibold tracking-[0.02em] text-ink">{word}</p>
      ) : null}

      <div data-testid="word-spell-frame" onPointerDown={onFramePointerDown} onMouseDown={onFrameMouseDown}
        className={cn("mt-3 flex min-h-tap items-center gap-2 rounded-button border border-dashed border-hair px-3 py-3", peekable && "cursor-pointer")}>
        <input ref={inputRef} type="text" value={value} readOnly={result !== null} onChange={(e) => onChange(e.target.value)}
          onCompositionStart={() => setShowing(false)} onKeyDown={onKeyDown}
          aria-label={t(dictation ? "web.wordbook.quiz.dictationPlaceholder" : "web.wordbook.quiz.spellInput")}
          placeholder={dictation ? t("web.wordbook.quiz.dictationPlaceholder") : undefined}
          autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" lang="en"
          className="h-tap min-w-0 flex-1 rounded-button bg-surface-2 px-3 text-title tracking-[0.02em] text-ink placeholder:text-body placeholder:tracking-normal placeholder:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:opacity-80" />
        {peekable ? (
          <button type="button" data-testid="word-spell-eye" aria-label={t("web.wordSpell.peekAria")} onClick={peek}
            className="inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <EyeIcon aria-hidden className="h-5 w-5" />
          </button>
        ) : null}
        {!result ? (
          <button type="button" onClick={hint} disabled={busy || hinted} aria-pressed={hinted}
            className="inline-flex h-tap flex-none items-center gap-1 rounded-button border-[0.5px] border-hair px-3 text-sub font-semibold text-amber liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:text-ink liquid:shadow-well focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            <LightbulbIcon aria-hidden className="h-4 w-4" />{t("web.wordbook.quiz.hint")}
          </button>
        ) : null}
      </div>

      {peekable ? (
        <button type="button" data-testid="word-spell-peek-btn" onClick={peek}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-button text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("web.wordSpell.peekButton")}
        </button>
      ) : null}
      {hintLine && !dictation && !result ? <p data-testid="word-spell-peek-hint" className="mt-2 text-meta text-ink-2">{t("web.wordSpell.peekHint")}</p> : null}

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
            <p data-testid="word-spell-expected" className="text-sub text-ink-2">
              {t("web.wordbook.quiz.expected")} <b lang="en" {...lookupContext} className="text-body font-semibold text-ink">{result.expected}</b>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {result.outcome !== "correct" ? (
              <button type="button" data-testid="word-spell-replay" onClick={replay}
                className="inline-flex h-11 items-center gap-1.5 rounded-button border-[0.5px] border-hair px-3 text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("web.wordbook.word.listen.word")}
              </button>
            ) : null}
            {peeked ? <span data-testid="word-spell-peeked" className="text-meta text-ink-2">{t("web.wordSpell.peeked")}</span> : null}
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
