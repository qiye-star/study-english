import { RefreshCwIcon } from "lucide-react";
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
import { SessionHeader, StepBar } from "./session-header";
import { answerCurrent, isFinished, progressOf, startSession, type SessionState } from "./session-machine";
import { SessionSummary, type SessionStats } from "./session-summary";
import { TypingQuestion } from "./typing-question";
import { DOCK, PRIMARY } from "./ui";
import { useRankEnabled } from "./use-rank-enabled";
import { useSpeaker } from "./use-speaker";
import { useWordbookToday } from "./use-today";
import { meaningLine } from "./word-card";
import { WORDBOOK_SERVER_ERRORS, reviewBatch, submitAnswer, type AnswerResult, type BookId, type Card, type Question } from "./wordbook-api";

type Batch = { bookId: BookId; questions: Question[]; cards: Record<string, Card> };
type Phase = "intro" | "loading" | "error" | "empty" | "quiz" | "summary";

const CHOICE = new Set(["meaning", "word", "cloze"]);
/** 进入「已掌握」:第一次作答把盒子从 3 升到 4(good 且已写入)。 */
const enteredMastered = (r: AnswerResult) => r.applied && r.grade === "good" && r.item?.box === 4;

/** TTS 未配置时听写换成看释义拼写(spec §11.4),题面从词卡补齐。 */
function effectiveQuestion(q: Question, card: Card | undefined, tts: boolean): Question {
  if (q.qtype !== "dictation" || tts) return q;
  return { ...q, qtype: "spell", prompt: { meaning: card ? meaningLine(card.senses, 40) : "", us: card?.us || card?.uk || undefined } };
}

/**
 * 复习(spec §6.4 / §11.2,视觉稿 05/05b/10):进入页点「开始复习 n」(在这次点击里解锁 iOS 音频)→ 到期词混合题型 →
 * 每题结果后「继续」;答错 / 接近的词回到队尾再练(服务端只认第一次作答)→ 小结。
 */
export function WordbookReviewPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const speaker = useSpeaker();
  const rankEnabled = useRankEnabled();
  const { today } = useWordbookToday(true);
  const [phase, setPhase] = useState<Phase>("intro");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [session, setSession] = useState<SessionState>(() => startSession([]));
  const [answer, setAnswer] = useState<{ result: AnswerResult; choice?: string } | null>(null);
  const [first, setFirst] = useState<Record<string, AnswerResult>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  // 作答后选项被禁用、输入框只读:焦点移到「继续」,键盘与读屏不丢位置(review m7)
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (answer) continueRef.current?.focus({ preventScroll: true });
  }, [answer]);
  useEffect(() => {
    mounted.current = true; // StrictMode 会先卸载再挂载一次
    return () => { mounted.current = false; };
  }, []);
  const errorText = (err: unknown) => translateServerError(t, err, WORDBOOK_SERVER_ERRORS);

  const start = async () => {
    speaker.prime(); // 点击的同步阶段解锁 iOS 音频,之后听写题才能自动播放
    setPhase("loading");
    try {
      const b = await reviewBatch(api);
      if (!mounted.current) return;
      const keys = b.questions.map((q) => q.key).filter((k, i, all) => all.indexOf(k) === i);
      setBatch(b);
      setSession(startSession(keys));
      setFirst({});
      setAnswer(null);
      setPhase(keys.length ? "quiz" : "empty");
    } catch (err) {
      if (!mounted.current) return;
      setError(err);
      setPhase("error");
    }
  };

  const raw = batch?.questions.find((q) => q.key === session.current) ?? null;
  const question = raw && batch ? effectiveQuestion(raw, batch.cards[raw.key], speaker.available) : null;

  const send = async (input: { choice?: string; typed?: string; hinted?: boolean }) => {
    if (!batch || !question || busy || answer) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "review", qtype: question.qtype, ...input });
      if (!mounted.current) return;
      setAnswer({ result, choice: input.choice });
      setFirst((f) => (question.key in f ? f : { ...f, [question.key]: result }));
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const proceed = () => {
    if (!answer) return;
    const next = answerCurrent(session, answer.result.correct);
    setSession(next);
    setAnswer(null);
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
            <p className="mt-3 text-title font-semibold">{today?.plan ? t("web.wordbook.review.due", { n: due }) : t("web.wordbook.review.title")}</p>
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
  const attempt = question ? session.requeued[question.key] ?? 0 : 0;
  const choiceResult: ChoiceResult | null = answer && question
    ? { choice: answer.choice ?? "", correct: answer.result.correct, correctOption: correctOptionOf(question, answer.result) }
    : null;
  return (
    <div className="flex flex-1 flex-col">
      <SessionHeader title={t("web.wordbook.review.title")}
        subtitle={t("web.wordbook.session.count", { n: Math.min(progress.done + 1, progress.total), total: progress.total })} />
      <div className="px-gutter pb-4">
        <StepBar done={progress.done} total={progress.total} />
        {question && CHOICE.has(question.qtype) ? (
          <ChoiceQuestion key={`${question.key}:${attempt}`} question={question} result={choiceResult} busy={busy}
            onAnswer={(choice) => void send({ choice })} {...listen} />
        ) : question ? (
          <TypingQuestion key={`${question.key}:${attempt}`} question={question} result={answer?.result ?? null} busy={busy}
            onSubmit={(a) => void send(a)} {...listen} />
        ) : null}
        {/* 键入题的结果已有徽标,播报文字只给读屏;选择题沿用视觉稿 05 的结果行 */}
        <p role="status" aria-live="polite"
          className={cn("mt-3 text-sub font-semibold", answer?.result.correct ? "text-green" : "text-ink-2", question && !CHOICE.has(question.qtype) && "sr-only")}>
          {answer && question && CHOICE.has(question.qtype)
            ? answer.result.correct ? t("web.wordbook.quiz.correct")
              : choiceResult?.correctOption ? t("web.wordbook.quiz.wrong", { answer: choiceResult.correctOption }) : t("web.wordbook.quiz.wrongPlain")
            : answer ? t(`web.wordbook.outcome.${answer.result.outcome}`) : ""}
        </p>
        {actionError ? <p role="alert" className="mt-2 text-sub text-ink">{actionError}</p> : null}
      </div>
      {answer ? (
        <div className={DOCK}>
          <button ref={continueRef} type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={proceed}>{t("web.wordbook.quiz.continue")}</button>
        </div>
      ) : null}
    </div>
  );
}
