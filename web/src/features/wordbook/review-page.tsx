import { RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PAGE_NOTE } from "~/components/list-card";
import { SurfaceCard } from "~/components/surface-card";
import { ChoiceQuestion, correctOptionOf, type ChoiceResult } from "./choice-question";
import { PageError, PageLoading } from "./page-status";
import { RecallCard } from "./recall-card";
import { RecallRatingBar, SpotBar } from "./recall-rating-bar";
import { SessionHeader, StepBar } from "./session-header";
import { answerCurrent, isFinished, progressOf, startSession, type Rating, type SessionState } from "./session-machine";
import { SessionSummary, type SessionStats } from "./session-summary";
import { TypingQuestion } from "./typing-question";
import { DOCK, GHOST, PRIMARY } from "./ui";
import { useRankEnabled } from "./use-rank-enabled";
import { useSpeaker } from "./use-speaker";
import { useWordbookToday } from "./use-today";
import { useWordbookConfig } from "./use-wordbook-config";
import { meaningLine } from "./word-card";
import { WORDBOOK_SERVER_ERRORS, reviewBatch, submitAnswer, type AnswerResult, type BookId, type Card, type Question } from "./wordbook-api";

type Batch = { bookId: BookId; questions: Question[]; cards: Record<string, Card> };
type Phase = "intro" | "loading" | "error" | "empty" | "quiz" | "summary";

const CHOICE = new Set(["meaning", "word", "cloze"]);
const now = () => performance.now();
type AnswerInputPart = { choice?: string; typed?: string; hinted?: boolean; rating?: Rating; revealedBefore?: boolean; elapsedMs?: number };
/** 进入「已掌握」:第一次作答把盒子从 3 升到 4(good 且已写入)。 */
const enteredMastered = (r: AnswerResult) => r.applied && r.grade === "good" && r.item?.box === 4;

/** 快速回忆题的评级分布(按每个词第一次的结果;「记错了」已改写为不认识)。本轮没有快速回忆题时为 undefined(小结不显示评级行)。 */
function recallRatings(results: AnswerResult[]): Record<Rating, number> | undefined {
  const rated = results.filter((r) => r.rating);
  if (!rated.length) return undefined;
  const out: Record<Rating, number> = { know: 0, fuzzy: 0, unknown: 0 };
  for (const r of rated) if (r.rating) out[r.rating] += 1;
  return out;
}

/** TTS 未配置时听写换成看释义拼写(spec §11.4),题面从词卡补齐。 */
function effectiveQuestion(q: Question, card: Card | undefined, tts: boolean): Question {
  if (q.qtype !== "dictation" || tts) return q;
  return { ...q, qtype: "spell", prompt: { meaning: card ? meaningLine(card.senses, 40) : "", us: card?.us || card?.uk || undefined } };
}

/**
 * 复习(spec §6.4 / §11.2,视觉稿 05/05b/10):进入页点「开始复习 n」(在这次点击里解锁 iOS 音频)→ 到期词混合题型 →
 * 每题结果后「继续」;答错 / 接近的词回到队尾再练(服务端只认第一次作答)→ 小结。
 * 快速回忆(spec 2026-10-11-wordbook-recall §4,视觉稿 05–07):正面三档自评 → 「认识」可能先出一道抽查题(`outcome:"pending"`)
 * → 翻面(词卡 + 徽标);认识之后可「记错了」(再交一次 unknown,服务端走 apply_lapse)。
 */
export function WordbookReviewPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const speaker = useSpeaker();
  const rankEnabled = useRankEnabled();
  const { today } = useWordbookToday(true);
  const config = useWordbookConfig();
  // 旧服务端(还没有 learn 设置)按默认值处理
  const prefs = config?.enabled ? config.learn : undefined;
  const autoplay = prefs?.autoplay ?? true;
  const showExample = prefs?.showExample ?? true;
  const [phase, setPhase] = useState<Phase>("intro");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [session, setSession] = useState<SessionState>(() => startSession([]));
  const [answer, setAnswer] = useState<{ result: AnswerResult; choice?: string; check?: Question } | null>(null);
  // 快速回忆「认识」被抽中时服务端给的选释义题(先答它才写盒子)
  const [check, setCheck] = useState<Question | null>(null);
  const [first, setFirst] = useState<Record<string, AnswerResult>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  // 同步的「请求进行中」:连点两次时第二次点击还看不到 busy state
  const inflight = useRef(false);
  // 当前题出现的时刻(快速回忆的 elapsed_ms)
  const shownAt = useRef(0);
  const checkRef = useRef<HTMLDivElement>(null);
  // 作答后选项被禁用、输入框只读:焦点移到「继续」,键盘与读屏不丢位置(review m7)
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (answer) continueRef.current?.focus({ preventScroll: true });
  }, [answer]);
  // 抽查题替换了自评键:焦点移到抽查说明,不掉到 <body>
  useEffect(() => {
    if (check) checkRef.current?.focus({ preventScroll: true });
  }, [check]);
  useEffect(() => {
    mounted.current = true; // StrictMode 会先卸载再挂载一次
    return () => { mounted.current = false; };
  }, []);
  const errorText = (err: unknown) => translateServerError(t, err, WORDBOOK_SERVER_ERRORS);

  const start = async () => {
    speaker.prime(); // 点击的同步阶段解锁 iOS 音频,之后听写题才能自动播放
    setPhase("loading");
    try {
      const b = await reviewBatch(api, 20, { recall: true }); // 声明支持快速回忆(spec recall §4.1)
      if (!mounted.current) return;
      const keys = b.questions.map((q) => q.key).filter((k, i, all) => all.indexOf(k) === i);
      setBatch(b);
      setSession(startSession(keys));
      setFirst({});
      setAnswer(null);
      setCheck(null);
      setPhase(keys.length ? "quiz" : "empty");
    } catch (err) {
      if (!mounted.current) return;
      setError(err);
      setPhase("error");
    }
  };

  const raw = batch?.questions.find((q) => q.key === session.current) ?? null;
  const question = raw && batch ? effectiveQuestion(raw, batch.cards[raw.key], speaker.available) : null;

  const attempt = question ? session.requeued[question.key] ?? 0 : 0;
  useEffect(() => {
    shownAt.current = now();
  }, [session.current, attempt]);

  const send = async (input: AnswerInputPart) => {
    if (!batch || !question || inflight.current || answer) return;
    const asked = check;
    inflight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const result = await submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "review", qtype: question.qtype, ...input });
      if (!mounted.current) return;
      // 抽查:先答这道题,还没写盒子(plan P-R3)
      if (result.outcome === "pending" && result.check) { setCheck(result.check); return; }
      setCheck(null);
      setAnswer({ result, choice: input.choice, check: asked ?? undefined });
      setFirst((f) => (question.key in f ? f : { ...f, [question.key]: result }));
      // 快速回忆翻面后朗读一次(在处理函数里而不是 effect 里:StrictMode 下不会读两次)
      if (question.qtype === "recall" && autoplay && speaker.available) speaker.listen(`${question.key}:flip`, question.prompt.word ?? question.key, "us");
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const rateRecall = (rating: Rating): void => {
    void send({ rating, revealedBefore: false, elapsedMs: Math.max(0, Math.round(now() - shownAt.current)) });
  };

  // 「记错了」:对刚复习过(已不到期)的词再交一次 unknown;小结按改正后的结果算
  const iWasWrong = async () => {
    if (!batch || !question || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const result = await submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "review", qtype: "recall", rating: "unknown" });
      if (!mounted.current) return;
      setAnswer({ result });
      setFirst((f) => ({ ...f, [question.key]: result }));
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const proceed = () => {
    if (!answer) return;
    const next = answerCurrent(session, answer.result.correct);
    setSession(next);
    setAnswer(null);
    setCheck(null);
    if (isFinished(next)) setPhase("summary");
  };

  const listen = { onListen: speaker.listen, listening: speaker.active, canListen: speaker.available };
  const due = today?.plan?.reviewLeft ?? 0;
  const newLeft = today?.plan?.newLeft ?? 0;

  if (phase === "intro") {
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.review.title")} />
        <div className="px-gutter pb-4">
          <SurfaceCard className="mt-2 flex flex-col items-center px-4 py-6 text-center">
            <span aria-hidden className="flex h-tap w-tap items-center justify-center rounded-button bg-blue-tint text-blue">
              <RefreshCwIcon className="h-6 w-6" />
            </span>
            <p className="mt-3 text-title font-semibold">{today?.plan ? t("web.wordbook.review.due", { n: due, count: due }) : t("web.wordbook.review.title")}</p>
            <p className="mt-1 text-sub text-ink-2">{t("web.wordbook.review.intro")}</p>
          </SurfaceCard>
        </div>
        <div className={DOCK}>
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} disabled={speaker.loading} onClick={() => void start()}>
            {due > 0 ? t("web.wordbook.card.review", { n: due }) : t("web.wordbook.review.start")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "loading" || phase === "error" || phase === "empty") {
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.review.title")} />
        {phase === "loading" ? <PageLoading /> : phase === "error" ? (
          <PageError message={errorText(error)} onRetry={() => void start()} />
        ) : (
          <div className={PAGE_NOTE}>
            <p className="text-body text-ink">{t("web.wordbook.review.empty")}</p>
            <Link to="/wordbook/learn" className={cn(PRIMARY, "mt-4 h-11 w-full")}>{t("web.wordbook.home.learn")}</Link>
          </div>
        )}
      </div>
    );
  }

  if (phase === "summary" && batch) {
    const keys = Object.keys(first);
    const firstTry = keys.filter((k) => first[k].correct).length;
    const missed = keys.filter((k) => !first[k].correct).map((key) => {
      const card = batch.cards[key];
      return { key, word: card?.word ?? first[key].expected, meaning: card ? meaningLine(card.senses, 40) : "" };
    });
    const stats: SessionStats = {
      kind: "review", total: keys.length, firstTry, mastered: keys.filter((k) => enteredMastered(first[k])).length,
      points: rankEnabled ? keys.filter((k) => first[k].applied).length : null, missed,
      ratings: recallRatings(keys.map((k) => first[k])),
    };
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.summary.title")} />
        <SessionSummary stats={stats} onHome={() => navigate("/wordbook")} {...listen}
          onAgain={newLeft > 0 ? () => navigate("/wordbook/learn") : undefined}
          againLabel={t("web.wordbook.card.learn", { n: newLeft })} />
      </div>
    );
  }

  const progress = progressOf(session);
  const recall = question?.qtype === "recall";
  // 抽查答错:说出正确释义(只用服务端给的、确实在选项里的那一项)
  const checkOption = answer?.check && !answer.result.correct ? correctOptionOf(answer.check, answer.result) : null;
  const checkWrong = answer?.check && !answer.result.correct
    ? checkOption ? t("web.wordbook.quiz.wrong", { answer: checkOption }) : t("web.wordbook.quiz.wrongPlain")
    : null;
  const choiceResult: ChoiceResult | null = answer && question
    ? { choice: answer.choice ?? "", correct: answer.result.correct, correctOption: correctOptionOf(question, answer.result) }
    : null;
  return (
    <div className="flex flex-1 flex-col">
      <SessionHeader title={t("web.wordbook.review.title")}
        subtitle={t("web.wordbook.session.count", { n: Math.min(progress.done + 1, progress.total), total: progress.total })} />
      <div className="px-gutter pb-4">
        <StepBar done={progress.done} total={progress.total} />
        {question && recall ? (
          check ? (
            <div ref={checkRef} tabIndex={-1} className="outline-none">
              <SpotBar title={t("web.wordbook.recall.checkTitle")} hint={t("web.wordbook.recall.checkHint")} />
              <ChoiceQuestion key={`${question.key}:${attempt}:check`} question={check} result={null} busy={busy}
                onAnswer={(choice) => void send({ rating: "know", choice })} {...listen} />
            </div>
          ) : (
            <RecallCard key={`${question.key}:${attempt}`} question={question} card={batch?.cards[question.key]}
              face={answer ? "back" : "front"} rating={answer?.result.rating ?? null} showExample={showExample} {...listen} />
          )
        ) : question && CHOICE.has(question.qtype) ? (
          <ChoiceQuestion key={`${question.key}:${attempt}`} question={question} result={choiceResult} busy={busy}
            onAnswer={(choice) => void send({ choice })} {...listen} />
        ) : question ? (
          <TypingQuestion key={`${question.key}:${attempt}`} question={question} result={answer?.result ?? null} busy={busy}
            onSubmit={(a) => void send(a)} {...listen} />
        ) : null}
        {/* 键入题的结果已有徽标,播报文字只给读屏;选择题沿用视觉稿 05 的结果行 */}
        <p role="status" aria-live="polite"
          className={cn("mt-3 text-sub font-semibold", answer?.result.correct ? "text-green" : "text-ink-2", question && !recall && !CHOICE.has(question.qtype) && "sr-only")}>
          {answer && recall
            ? [answer.result.rating ? t(`web.wordbook.learn.rated.${answer.result.rating}`) : "", checkWrong ?? ""].filter(Boolean).join(" · ")
            : answer && question && CHOICE.has(question.qtype)
            ? answer.result.correct ? t("web.wordbook.quiz.correct")
              : choiceResult?.correctOption ? t("web.wordbook.quiz.wrong", { answer: choiceResult.correctOption }) : t("web.wordbook.quiz.wrongPlain")
            : answer ? t(`web.wordbook.outcome.${answer.result.outcome}`) : ""}
        </p>
        {actionError ? <p role="alert" className="mt-2 text-sub text-ink">{actionError}</p> : null}
      </div>
      {recall && !answer && !check ? <RecallRatingBar busy={busy} onRate={rateRecall} /> : null}
      {answer ? (
        <div className={DOCK}>
          {recall && answer.result.rating === "know" ? (
            <button type="button" className={cn(GHOST, "h-12 flex-1")} disabled={busy} onClick={() => void iWasWrong()}>
              <RotateCcwIcon aria-hidden />{t("web.wordbook.learn.iWasWrong")}
            </button>
          ) : null}
          <button ref={continueRef} disabled={busy} type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={proceed}>{t("web.wordbook.quiz.continue")}</button>
        </div>
      ) : null}
    </div>
  );
}
