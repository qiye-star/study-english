import { ArrowRightIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PAGE_NOTE } from "~/components/list-card";
import { ChoiceQuestion, correctOptionOf, type ChoiceResult } from "./choice-question";
import { PageError, PageLoading } from "./page-status";
import { RatingBadge, RecallRatingBar, SpotBar } from "./recall-rating-bar";
import { SessionHeader, StepBar } from "./session-header";
import {
  answerCurrent, cardReducer, isFinished, learnTally, planLearnQuiz, progressOf, ratingPayload, startCard, startSession,
  type QuizSlot, type RatedWord, type Rating, type SessionState,
} from "./session-machine";
import { SessionSummary, type SessionStats } from "./session-summary";
import { DOCK, GHOST_DOCK, GHOST, PRIMARY, bookTitle } from "./ui";
import { Dock } from "~/components/dock";
import { useRankEnabled } from "./use-rank-enabled";
import { useDefLangValue } from "./use-def-lang";
import { useSpeaker } from "./use-speaker";
import { useWordbookConfig } from "./use-wordbook-config";
import { WordCardView, WordRecap, meaningLine } from "./word-card";
import { WORDBOOK_SERVER_ERRORS, learnBatch, submitAnswer, type BookId, type Card, type Question } from "./wordbook-api";

type Batch = { bookId: BookId; cards: Card[]; quiz: Question[]; drill: Question[] };
type Phase = "loading" | "error" | "empty" | "cards" | "quiz" | "summary";

const now = () => performance.now();

/**
 * 学新词(spec 2026-10-11-wordbook-recall §3,视觉稿 01–04 / 08):一轮 5 张遮罩词卡 → 认识 / 模糊 / 不认识(盒子由服务端定)
 * → 翻开核对(认识可「记错了」)→ 本轮小测(模糊 → 不认识选释义 → 抽中的认识 → 不认识看释义选词;答错回到队尾,最多两次)→ 小结。
 */
export function WordbookLearnPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const config = useWordbookConfig();
  const speaker = useSpeaker();
  const rankEnabled = useRankEnabled();
  // 旧服务端(还没有 learn 设置)按默认值处理
  const prefs = config?.enabled ? config.learn : undefined;
  const autoplay = prefs?.autoplay ?? true;
  const showExample = prefs?.showExample ?? true;
  const defLang = useDefLangValue();
  const [phase, setPhase] = useState<Phase>("loading");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [index, setIndex] = useState(0);
  const [card, dispatch] = useReducer(cardReducer, 0, startCard);
  const [rated, setRated] = useState<RatedWord[]>([]);
  const [slots, setSlots] = useState<QuizSlot[]>([]);
  const [status, setStatus] = useState("");
  const [session, setSession] = useState<SessionState>(() => startSession([]));
  const [result, setResult] = useState<ChoiceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const mounted = useRef(true);
  // 同步的「请求进行中」:busy 是 state,连点两次时第二次点击还看不到它
  const inflight = useRef(false);
  // iOS:声音要在用户手势里解锁;第一次点击之前不自动朗读(spec recall §8.3)
  const gestured = useRef(false);
  // 已自动朗读过的卡(StrictMode 下 effect 会跑两次,同一 id 再 play 一次会变成「停止」)
  const autoplayed = useRef<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // 作答后选项都被禁用,焦点会掉到 <body>:移到「继续」(review m7)
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result) continueRef.current?.focus({ preventScroll: true });
  }, [result]);
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
        setBatch({ ...b, drill: b.drill ?? [] });
        setIndex(0);
        dispatch({ type: "reset", at: now() });
        setRated([]);
        setSlots([]);
        setStatus("");
        setResult(null);
        setActionError(null);
        setPhase(b.cards.length ? "cards" : "empty");
      },
      (err: unknown) => { if (alive) { setError(err); setPhase("error"); } },
    );
    return () => { alive = false; };
  }, [api, round]);

  const current = phase === "cards" ? batch?.cards[index] : undefined;
  const currentKey = current?.key;
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  // 换卡后自动朗读一次(第一次点击之后;计时在换卡的点击里归零,见 nextCard)
  useEffect(() => {
    if (!current) return;
    const sp = speakerRef.current;
    if (autoplay && gestured.current && sp.available && autoplayed.current !== current.key) {
      autoplayed.current = current.key;
      sp.listen(`${current.key}:auto`, current.word, "us");
    }
    // 只在换卡(或一轮重新开始)时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, round]);

  // 自评之后焦点移到「下一个 / 开始小测」(spec recall §8.2)
  useEffect(() => {
    if (card.rating) nextRef.current?.focus({ preventScroll: true });
  }, [card.rating]);

  const cardOf = useCallback((key: string) => batch?.cards.find((c) => c.key === key), [batch]);
  const errorText = (err: unknown) => translateServerError(t, err, WORDBOOK_SERVER_ERRORS);

  const gesture = () => {
    if (gestured.current) return;
    gestured.current = true;
    speaker.prime(); // 手势内解锁 iOS 音频(只第一次:prime 会打断正在读的词)
  };

  const reveal = () => {
    gesture();
    dispatch({ type: "reveal" });
    requestAnimationFrame(() => regionRef.current?.focus({ preventScroll: true }));
  };

  const sendRating = async (rating: Rating, corrected = false) => {
    if (!batch || !current || inflight.current) return;
    const word = current;
    gesture();
    // 「不认识」总是朗读(手势内,立即发声);认识 / 模糊在自动朗读开、且这张卡还没自动读过时读一次
    if (!corrected && speaker.available && (rating === "unknown" || (autoplay && autoplayed.current !== word.key))) {
      autoplayed.current = word.key;
      speaker.listen(`${word.key}:rated`, word.word, "us");
    }
    inflight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const payload = corrected ? { rating, revealedBefore: true, elapsedMs: 0 } : ratingPayload(card, rating, now());
      const res = await submitAnswer(api, { bookId: batch.bookId, key: word.key, mode: "learn", qtype: "recall", ...payload });
      if (!mounted.current) return;
      const eff = res.rating ?? rating;
      dispatch(corrected ? { type: "corrected" } : { type: "rated", rating: eff });
      setRated((list) => [...list.filter((w) => w.key !== word.key), { key: word.key, rating: corrected ? "unknown" : eff, spotCheck: !corrected && res.spotCheck }]);
      setStatus(t(rating === "fuzzy" && eff === "unknown" ? "web.wordbook.learn.rated.streak" : `web.wordbook.learn.rated.${corrected ? "unknown" : eff}`));
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const questionFor = (slot: QuizSlot | undefined): Question | null =>
    slot && batch ? (slot.qtype === "word" ? batch.drill : batch.quiz).find((q) => q.key === slot.key && q.qtype === slot.qtype) ?? null : null;

  const startQuiz = () => {
    // 题目缺失(例如旧服务端没有 drill)时跳过那一格
    const planned = planLearnQuiz(rated).filter((s) => questionFor(s));
    setSlots(planned);
    setSession(startSession(planned.map((s) => s.id)));
    setResult(null);
    setPhase(planned.length ? "quiz" : "summary");
  };

  const nextCard = () => {
    if (!batch) return;
    gesture();
    setActionError(null);
    setStatus("");
    if (index + 1 < batch.cards.length) {
      // 在点击里同步重置卡片状态:放到 effect 里会先画一帧带着上一张卡评级的新卡
      dispatch({ type: "reset", at: now() });
      setIndex(index + 1);
    }
    else startQuiz();
  };

  const slot = slots.find((s) => s.id === session.current);
  const question = questionFor(slot);

  const choose = async (choice: string) => {
    if (!batch || !question || inflight.current || result) return;
    inflight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const res = await submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "learn", qtype: question.qtype, choice });
      if (!mounted.current) return;
      setResult({ choice, correct: res.correct, correctOption: correctOptionOf(question, res) });
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      inflight.current = false;
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

  const again = () => {
    autoplayed.current = null;
    setRound((n) => n + 1);
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
    const tally = learnTally(rated, session.firstTry);
    const missed = tally.missed.map((key) => {
      const c = cardOf(key);
      return { key, word: c?.word ?? key, meaning: c ? meaningLine(c.senses, 40) : "" };
    });
    const stats: SessionStats = {
      kind: "learn", total: rated.length, firstTry: tally.firstTry, points: rankEnabled ? rated.length : null, missed,
      ratings: tally.ratings, checks: tally.checks,
    };
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.summary.title")} />
        <SessionSummary stats={stats} onHome={() => navigate("/wordbook")} onAgain={again} {...listen} />
      </div>
    );
  }

  if (phase === "cards" && batch && current) {
    const last = index + 1 >= batch.cards.length;
    const spot = rated.find((w) => w.key === current.key)?.spotCheck ?? false;
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.learn.title")} />
        <div className="px-gutter liquid:px-frame pb-4">
          <StepBar done={index} total={batch.cards.length} />
          <WordCardView key={current.key} card={current} defLang={defLang} phrasesOpen="auto" {...listen} covered={!card.revealed} onReveal={reveal} regionRef={regionRef}
            showExample={showExample} badge={card.rating ? <RatingBadge rating={card.rating} check={spot} /> : null}
            eyebrow={t("web.wordbook.learn.eyebrow", { n: index + 1, total: batch.cards.length, book: book ? bookTitle(book, i18n.language) : "" })} />
          <p role="status" aria-live="polite" className="sr-only">{status}</p>
          {actionError ? <p role="alert" className="mt-3 text-sub text-ink">{actionError}</p> : null}
        </div>
        {card.rating ? (
          <Dock className={DOCK}>
            {card.rating === "know" ? (
              <button type="button" className={cn(GHOST_DOCK, "h-12 flex-1")} disabled={busy} onClick={() => void sendRating("unknown", true)}>
                <RotateCcwIcon aria-hidden />{t("web.wordbook.learn.iWasWrong")}
              </button>
            ) : null}
            <button ref={nextRef} type="button" className={cn(PRIMARY, "h-12 flex-1")} disabled={busy} onClick={nextCard}>
              {last ? t("web.wordbook.learn.startQuiz") : t("web.wordbook.learn.next")}
              <ArrowRightIcon aria-hidden />
            </button>
          </Dock>
        ) : (
          <RecallRatingBar busy={busy} peeked={card.peeked} onRate={(r) => void sendRating(r)} />
        )}
      </div>
    );
  }

  // 本轮小测
  const progress = progressOf(session);
  const recap = result && !result.correct && question ? cardOf(question.key) : undefined;
  const spotSlot = slot?.qtype === "meaning" && rated.some((w) => w.key === slot.key && w.rating === "know" && w.spotCheck);
  return (
    <div className="flex flex-1 flex-col">
      <SessionHeader title={t("web.wordbook.learn.quiz")} subtitle={t("web.wordbook.session.count", { n: Math.min(progress.done + 1, progress.total), total: progress.total })} />
      <div className="px-gutter liquid:px-frame pb-4">
        <StepBar done={progress.done} total={progress.total} />
        {spotSlot ? <SpotBar title={t("web.wordbook.learn.spotEyebrow")} hint={t("web.wordbook.learn.spotHint")} /> : null}
        {slot?.qtype === "word" ? <p className="eyebrow mb-2 px-1">{t("web.wordbook.learn.drillEyebrow")}</p> : null}
        {question && slot ? (
          <ChoiceQuestion key={`${slot.id}:${session.requeued[slot.id] ?? 0}`} question={question} result={result} busy={busy}
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
        <Dock className={DOCK}>
          <button ref={continueRef} type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={proceed}>{t("web.wordbook.quiz.continue")}</button>
        </Dock>
      ) : null}
    </div>
  );
}
