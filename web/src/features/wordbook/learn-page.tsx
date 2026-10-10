import { ArrowRightIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PAGE_NOTE } from "~/components/list-card";
import { ChoiceQuestion, correctOptionOf, type ChoiceResult } from "./choice-question";
import { PageError, PageLoading } from "./page-status";
import { SessionHeader, StepBar } from "./session-header";
import { answerCurrent, isFinished, progressOf, startSession, type SessionState } from "./session-machine";
import { SessionSummary, type SessionStats } from "./session-summary";
import { DOCK, GHOST, PRIMARY, bookTitle } from "./ui";
import { useRankEnabled } from "./use-rank-enabled";
import { useSpeaker } from "./use-speaker";
import { useWordbookConfig } from "./use-wordbook-config";
import { WordCardView, WordRecap, meaningLine } from "./word-card";
import { WORDBOOK_SERVER_ERRORS, learnBatch, submitAnswer, type BookId, type Card, type Question } from "./wordbook-api";

type Batch = { bookId: BookId; cards: Card[]; quiz: Question[] };
type Phase = "loading" | "error" | "empty" | "cards" | "quiz" | "summary";

/**
 * 学新词(spec §6.3,视觉稿 04/05/10):一轮 5 张词卡 → 对没点「我认识」的词做选释义小测 →
 * 答错的词显示词卡摘要并回到队尾再测(最多两次)→ 小结,可再来一轮。
 */
export function WordbookLearnPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const config = useWordbookConfig();
  const speaker = useSpeaker();
  const rankEnabled = useRankEnabled();
  const [phase, setPhase] = useState<Phase>("loading");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [index, setIndex] = useState(0);
  const [known, setKnown] = useState<string[]>([]);
  const [session, setSession] = useState<SessionState>(() => startSession([]));
  const [result, setResult] = useState<ChoiceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // StrictMode 会先卸载再挂载一次
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    learnBatch(api).then(
      (b) => {
        if (!alive) return;
        setBatch(b);
        setIndex(0);
        setKnown([]);
        setResult(null);
        setActionError(null);
        setPhase(b.cards.length ? "cards" : "empty");
      },
      (err: unknown) => { if (alive) { setError(err); setPhase("error"); } },
    );
    return () => { alive = false; };
  }, [api, round]);

  const cardOf = useCallback((key: string) => batch?.cards.find((c) => c.key === key), [batch]);
  const errorText = (err: unknown) => translateServerError(t, err, WORDBOOK_SERVER_ERRORS);

  const startQuiz = (knownKeys: string[]) => {
    const keys = (batch?.quiz ?? []).map((q) => q.key).filter((k, i, all) => !knownKeys.includes(k) && all.indexOf(k) === i);
    setSession(startSession(keys));
    setResult(null);
    setPhase(keys.length ? "quiz" : "summary");
  };

  const nextCard = (knownKeys = known) => {
    if (!batch) return;
    setActionError(null);
    if (index + 1 < batch.cards.length) setIndex(index + 1);
    else startQuiz(knownKeys);
  };

  const markKnown = async () => {
    if (!batch || busy) return;
    const card = batch.cards[index];
    setBusy(true);
    setActionError(null);
    try {
      await submitAnswer(api, { bookId: batch.bookId, key: card.key, mode: "learn", qtype: "meaning", known: true });
      if (!mounted.current) return;
      const next = [...known, card.key];
      setKnown(next);
      nextCard(next);
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const question = batch?.quiz.find((q) => q.key === session.current) ?? null;

  const choose = async (choice: string) => {
    if (!batch || !question || busy || result) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "learn", qtype: question.qtype, choice });
      if (!mounted.current) return;
      setResult({ choice, correct: res.correct, correctOption: correctOptionOf(question, res) });
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const proceed = () => {
    if (!result) return;
    const next = answerCurrent(session, result.correct);
    setSession(next);
    setResult(null);
    if (isFinished(next)) setPhase("summary");
  };

  const book = config?.enabled && batch ? config.books.find((b) => b.id === batch.bookId) : undefined;
  const listen = { onListen: speaker.listen, listening: speaker.active, canListen: speaker.available };

  if (phase === "loading" || phase === "error" || phase === "empty") {
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.learn.title")} />
        {phase === "loading" ? <PageLoading /> : phase === "error" ? (
          <PageError message={errorText(error)} onRetry={() => setRound((n) => n + 1)} />
        ) : (
          <div className={PAGE_NOTE}>
            <p className="text-body text-ink">{t("web.wordbook.learn.empty")}</p>
            <p className="mt-1">{t("web.wordbook.learn.emptyHint")}</p>
            <Link to="/wordbook" className={cn(PRIMARY, "mt-4 h-11 w-full")}>{t("web.wordbook.summary.home")}</Link>
          </div>
        )}
      </div>
    );
  }

  if (phase === "summary" && batch) {
    const firstTry = Object.values(session.firstTry).filter(Boolean).length;
    const missed = Object.entries(session.firstTry).filter(([, ok]) => !ok).map(([key]) => {
      const card = cardOf(key);
      return { key, word: card?.word ?? key, meaning: card ? meaningLine(card.senses, 40) : "" };
    });
    const stats: SessionStats = { kind: "learn", total: batch.cards.length, firstTry, points: rankEnabled ? batch.cards.length : null, missed };
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.summary.title")} />
        <SessionSummary stats={stats} onHome={() => navigate("/wordbook")} onAgain={() => setRound((n) => n + 1)} {...listen} />
      </div>
    );
  }

  if (phase === "cards" && batch) {
    const card = batch.cards[index];
    const last = index + 1 >= batch.cards.length;
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.learn.title")} />
        <div className="px-gutter pb-4">
          <StepBar done={index} total={batch.cards.length} />
          <WordCardView key={card.key} card={card} {...listen}
            eyebrow={t("web.wordbook.learn.eyebrow", { n: index + 1, total: batch.cards.length, book: book ? bookTitle(book, i18n.language) : "" })} />
          {actionError ? <p role="alert" className="mt-3 text-sub text-ink">{actionError}</p> : null}
        </div>
        <div className={DOCK}>
          <button type="button" className={cn(GHOST, "h-12 flex-1")} disabled={busy} onClick={() => void markKnown()}>{t("web.wordbook.learn.known")}</button>
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} disabled={busy} onClick={() => nextCard()}>
            {last ? t("web.wordbook.learn.startQuiz") : t("web.wordbook.learn.next")}
            <ArrowRightIcon aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  // 小测
  const progress = progressOf(session);
  const recap = result && !result.correct && question ? cardOf(question.key) : undefined;
  return (
    <div className="flex flex-1 flex-col">
      <SessionHeader title={t("web.wordbook.learn.quiz")} subtitle={t("web.wordbook.session.count", { n: Math.min(progress.done + 1, progress.total), total: progress.total })} />
      <div className="px-gutter pb-4">
        <StepBar done={progress.done} total={progress.total} />
        {question ? (
          <ChoiceQuestion key={`${question.key}:${session.requeued[question.key] ?? 0}`} question={question} result={result} busy={busy}
            onAnswer={(c) => void choose(c)} {...listen} />
        ) : null}
        <p role="status" aria-live="polite" className={cn("mt-3 flex items-center gap-1.5 text-sub font-semibold", result?.correct ? "text-green" : "text-ink-2")}>
          {result ? (result.correct ? t("web.wordbook.quiz.correct")
            : result.correctOption ? t("web.wordbook.quiz.wrong", { answer: result.correctOption }) : t("web.wordbook.quiz.wrongPlain")) : ""}
        </p>
        {recap ? <WordRecap card={recap} /> : null}
        {actionError ? <p role="alert" className="mt-3 text-sub text-ink">{actionError}</p> : null}
      </div>
      {result ? (
        <div className={DOCK}>
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={proceed}>{t("web.wordbook.quiz.continue")}</button>
        </div>
      ) : null}
    </div>
  );
}
