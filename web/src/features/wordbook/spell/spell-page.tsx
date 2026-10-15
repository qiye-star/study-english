import { KeyboardIcon, LanguagesIcon, LightbulbIcon, RulerIcon, Settings2Icon, Volume2Icon } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { Dock } from "~/components/dock";
import { IconButton } from "~/components/icon-button";
import { IconChip } from "~/components/icon-chip";
import { LQ_CHIP_ON, LQ_ON_BLUR, LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import {
  type BookId,
  type ClozeLine,
  type ClozeSet,
  reportSentence,
  type Segment,
  spellSets,
  type SpellResult,
  submitSpell,
  WORDBOOK_SERVER_ERRORS,
} from "../wordbook-api";
import { SessionSummary, type SessionStats } from "../session-summary";
import { useRankEnabled } from "../use-rank-enabled";
import { meaningLine } from "../word-card";
import { ClozeBoard } from "./cloze-board";
import { clozeReducer, initCloze } from "./cloze-engine";
import { ExplainSheet } from "./explain-sheet";
import { readPrefs, writePrefs } from "./prefs";
import { outcomeNote, SpellResults } from "./spell-results";
import { useClozeInput } from "./use-cloze-input";
import { useRevealBlank } from "./use-reveal-blank";

type Phase = "loading" | "error" | "empty" | "typing" | "results" | "summary";
type ReportReason = "wrong" | "offensive" | "other";
type Blank = Extract<Segment, { t: "blank" }>;

const BTN = cn(
  "inline-flex h-12 w-full min-w-0 items-center justify-center gap-2 rounded-button px-4 text-body font-semibold tracking-[-0.005em]",
  "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5",
);
const PRIMARY = cn(BTN, "bg-blue text-on-blue active:opacity-90", LQ_PRIMARY);
const GHOST = cn(BTN, "border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2", LQ_SECONDARY);
/** 规则 4:模糊底栏上的次要按钮是托板胶囊 */
const GHOST_DOCK = cn(GHOST, LQ_ON_BLUR);
/** 工具行(视觉稿 .tools):32px 视觉 / 44px 命中 */
const TOOL = cn(
  "relative inline-flex h-8 items-center gap-[5px] rounded-[9px] bg-surface-2 px-2.5 text-sub font-semibold text-ink-2",
  "before:absolute before:inset-x-0 before:inset-y-[-6px] before:content-['']",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4",
);
const TOOL_ON = `bg-blue-tint text-blue ${LQ_CHIP_ON}`;
const ROW = cn(
  "flex min-h-row w-full items-center gap-3 rounded-[10px] px-3 text-left text-body text-ink",
  "transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
);

const blanksOf = (line: ClozeLine): Blank[] => line.segments.filter((s): s is Blank => s.t === "blank");
const blankCount = (set: ClozeSet) => set.lines.reduce((n, line) => Math.max(n, ...blanksOf(line).map((b) => b.i + 1)), 0);
const lineOf = (set: ClozeSet, i: number) => set.lines.find((line) => blanksOf(line).some((b) => b.i === i));

/** 某个空在句中的实际词形(服务端 `form`,如 go → went)。 */
const formOf = (line: ClozeLine, i: number) => blanksOf(line).find((b) => b.i === i)?.form ?? "";

/** 首字母提示:句中实际词形的首字母(该空得分减半)。 */
const firstLetter = (line: ClozeLine, i: number) => formOf(line, i).match(/[A-Za-zÀ-ÖØ-öø-ÿ]/)?.[0]?.toLowerCase() ?? "";

/** 「听这句」朗读的文本:文本段 + 各空的实际词形。 */
const sentenceText = (line: ClozeLine) =>
  line.segments.map((s) => (s.t === "text" ? s.v : s.form)).join("").replace(/\s+/g, " ").trim();

interface Tally { words: number; correct: number; counted: number; missed: SessionStats["missed"] }
const EMPTY_TALLY: Tally = { words: 0, correct: 0, counted: 0, missed: [] };
/** 每组 credit ≥ 60 计一次 spelling_set,默认 2 段位点(rank POINTS["spelling_set"];小结里只作估算)。 */
const SPELLING_SET_POINTS = 2;

function addToTally(prev: Tally, res: SpellResult): Tally {
  const missed = res.words
    .filter((w) => w.outcome !== "correct" && !prev.missed.some((m) => m.key === w.key))
    .map((w) => ({ key: w.key, word: w.card.word || w.key, meaning: meaningLine(w.card.senses, 40) }));
  return {
    words: prev.words + res.words.length,
    correct: prev.correct + res.words.filter((w) => w.outcome === "correct").length,
    counted: prev.counted + (res.counted ? 1 : 0),
    missed: [...prev.missed, ...missed],
  };
}

const summaryStats = (tally: Tally, rankEnabled: boolean): SessionStats => ({
  kind: "spell", total: tally.words, firstTry: tally.correct, missed: tally.missed,
  points: rankEnabled ? tally.counted * SPELLING_SET_POINTS : null,
});

/** 按句拼写页(spec §6.6 / §11.5,视觉稿 06–09):组 → 提交 → 结果与讲解 → 下一组 → 小结。 */
export function WordbookSpellPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const { api } = useAuth();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [bookId, setBookId] = useState<BookId | null>(null);
  const [sets, setSets] = useState<ClozeSet[]>([]);
  const [index, setIndex] = useState(0);
  const [cloze, dispatch] = useReducer(clozeReducer, initCloze(0));
  const [result, setResult] = useState<SpellResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState("");
  const [stale, setStale] = useState(false);
  const [showZh, setShowZh] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [whyKey, setWhyKey] = useState<string | null>(null);
  const [reportKey, setReportKey] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const rankEnabled = useRankEnabled();
  const [ai, setAi] = useState<ServerAiConfig | null>(null);

  const tts = useTtsPlayer(api, { onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)) });
  const stopTts = tts.stop;
  useEffect(() => stopTts, [stopTts]);

  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => undefined);
    return () => { alive = false; };
  }, [api]);

  const set = sets[index] as ClozeSet | undefined;

  // 已计入小结的组:「再练一遍」重交同一组不再累加(服务端同组同日也只计一次 spelling_set;review web M4)
  const tallied = useRef(new Set<string>());

  const start = useCallback((next: ClozeSet, { retry = false }: { retry?: boolean } = {}) => {
    dispatch({ type: "reset", count: blankCount(next) });
    setResult(null);
    setShowZh(false);
    if (!retry) setReported(new Set()); // 重练同一组时保留「已举报」,不能再举报一次
    setSubmitError("");
    setStale(false);
    setPhase("typing");
  }, []);

  const load = useCallback(() => {
    let alive = true;
    setPhase("loading");
    setLoadError("");
    spellSets(api, { count: 2, size: 5 }).then(
      (res) => {
        if (!alive) return;
        setBookId(res.bookId);
        setSets(res.sets);
        setIndex(0);
        setTally(EMPTY_TALLY);
        tallied.current = new Set();
        if (res.sets.length === 0) setPhase("empty");
        else start(res.sets[0]);
      },
      (err: unknown) => {
        if (!alive) return;
        setLoadError(translateServerError(tRef.current, err, WORDBOOK_SERVER_ERRORS));
        setPhase("error");
      },
    );
    return () => { alive = false; };
  }, [api, start]);

  useEffect(() => load(), [load]);

  const submit = async () => {
    if (phase !== "typing" || !set || !bookId || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await submitSpell(api, {
        bookId,
        setId: set.setId,
        lines: set.lines.map((line) => ({
          key: line.key,
          sentenceId: line.sentenceId,
          answers: blanksOf(line).map((b) => ({ typed: cloze.values[b.i] ?? "", hinted: cloze.hinted[b.i] ?? false })),
        })),
      });
      setResult(res);
      if (!tallied.current.has(set.setId)) {
        tallied.current.add(set.setId);
        setTally((prev) => addToTally(prev, res));
      }
      setPhase("results");
      inputRef.current?.blur(); // 收起键盘,结果从顶部读起
    } catch (err) {
      setSubmitError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
      // 例句在作答时被管理员屏蔽 / 数据更新:这组每次提交都会 422,给一条出路(review m8)
      setStale(err instanceof ApiError && err.message === "Sentence changed");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const { inputRef, inputProps, formProps, focusBlank, focused } = useClozeInput({ state: cloze, dispatch, onSubmit: () => void submit() });

  // 当前空滚到可见区(键盘弹起时 AppShell 的高度跟随 visualViewport,见 useAppHeight;键盘动画后再滚一次)
  const reveal = useRevealBlank({ active: cloze.active, enabled: phase === "typing", input: () => inputRef.current });
  const onFocusBlank = useCallback((i: number) => {
    focusBlank(i);
    reveal();
  }, [focusBlank, reveal]);

  const currentLine = set ? lineOf(set, cloze.active) : undefined;
  const canListen = !!ai?.defaultTts.model;
  const keepFocus = (e: { preventDefault(): void }) => e.preventDefault(); // 点工具不收起键盘

  const hint = () => {
    if (!currentLine) return;
    const letter = firstLetter(currentLine, cloze.active);
    if (letter) dispatch({ type: "hint", index: cloze.active, letter });
    focusBlank(cloze.active);
  };

  const listenLine = () => {
    if (!currentLine || !ai) return;
    void tts.play(`spell-line-${currentLine.sentenceId}`, sentenceText(currentLine), ai.defaultTts.model, ai.defaultTts.voice);
  };

  const listenWord = (key: string, word: string) => {
    if (!ai) return;
    void tts.play(`spell-word-${key}`, word, ai.defaultTts.model, ai.defaultTts.voice);
  };

  const toggleLength = () => {
    const next = { showLength: !prefs.showLength };
    setPrefs(next);
    writePrefs(next);
  };

  const next = () => {
    if (index + 1 < sets.length) {
      setIndex(index + 1);
      start(sets[index + 1]);
    } else {
      setPhase("summary");
    }
  };

  const sendReport = async (reason: ReportReason) => {
    const key = reportKey;
    const line = set?.lines.find((l) => l.key === key);
    if (!key || !line || !bookId || reporting) return;
    setReporting(true);
    setReportError("");
    try {
      await reportSentence(api, { bookId, key, sentenceId: line.sentenceId, reason });
      setReported((prev) => new Set(prev).add(key));
      setReportKey(null);
    } catch (err) {
      setReportError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
    } finally {
      setReporting(false);
    }
  };

  const whyWord = result?.words.find((w) => w.key === whyKey);
  const subtitle = set && (phase === "typing" || phase === "results") && sets.length > 1
    ? t("web.wordbookSpell.setProgress", { n: index + 1, total: sets.length })
    : undefined;
  const words = set?.lines.length ?? 0;
  const resultBlanks = result?.words.flatMap((w) => w.blanks);

  return (
    // data-testid 沿用 F4 桩的标识:F4 的 use-wordbook-config.test.tsx 与 E2E 以它定位本页(Ruling WS3-6)
    <div data-testid="wordbook-spell-page" className="flex flex-1 flex-col">
      <PageHeader
        title={phase === "results" ? t("web.wordbookSpell.resultsTitle") : t("web.wordbookSpell.title")}
        subtitle={subtitle}
        back="/wordbook"
        actions={
          <IconButton label={t("web.wordbookSpell.settings")} onClick={() => setSettingsOpen(true)}>
            <Settings2Icon />
          </IconButton>
        }
      />
      <div className="flex-1 px-gutter liquid:px-frame pb-6 pt-1">
        {phase === "loading" ? (
          <p className="py-10 text-center text-sub text-ink-2">{t("web.wordbookSpell.loading")}</p>
        ) : null}

        {phase === "error" ? (
          <SurfaceCard className="space-y-3 p-4 text-center">
            <p role="alert" className="text-sub text-ink">{loadError}</p>
            <button type="button" className={GHOST} onClick={() => load()}>{t("web.wordbookSpell.retry")}</button>
          </SurfaceCard>
        ) : null}

        {phase === "empty" ? (
          <SurfaceCard className="flex flex-col items-center gap-2 p-5 text-center">
            <IconChip tone="teal" icon={KeyboardIcon} />
            <p className="mt-1 text-body font-semibold text-ink">{t("web.wordbookSpell.empty")}</p>
            <p className="text-sub text-ink-2">{t("web.wordbookSpell.emptyNote")}</p>
            <button type="button" className={cn(PRIMARY, "mt-2")} onClick={() => navigate("/wordbook/learn")}>
              {t("web.wordbookSpell.emptyAction")}
            </button>
          </SurfaceCard>
        ) : null}

        {phase === "typing" && set ? (
          <>
            <div className="mx-0.5 mb-2 mt-0.5 flex items-center justify-between gap-2">
              <b className="text-sub font-semibold text-ink-2">
                {t("web.wordbookSpell.setHead", { n: index + 1, total: sets.length, words, count: words })}
              </b>
              <ToneBadge tone="gray">{t("web.wordbookSpell.fromDictionary")}</ToneBadge>
            </div>
            <ClozeBoard set={set} state={cloze} showLength={prefs.showLength} showZh={showZh} onFocusBlank={onFocusBlank} focused={focused} />
            <div className="-mx-1 mt-1.5 flex flex-wrap gap-1">
              <button type="button" className={cn(TOOL, "bg-amber-tint text-amber", LQ_SECONDARY)} onMouseDown={keepFocus} onClick={hint}>
                <LightbulbIcon aria-hidden />{t("web.wordbookSpell.hint")}
              </button>
              <button type="button" className={TOOL} onMouseDown={keepFocus} onClick={listenLine} disabled={!canListen}
                title={canListen ? undefined : t("web.wordbookSpell.ttsUnavailable")}>
                <Volume2Icon aria-hidden />{t("web.wordbookSpell.listen")}
              </button>
              <button type="button" className={cn(TOOL, showZh && TOOL_ON)} aria-pressed={showZh} onMouseDown={keepFocus} onClick={() => setShowZh((v) => !v)}>
                <LanguagesIcon aria-hidden />{t("web.wordbookSpell.showZh")}
              </button>
              <button type="button" className={cn(TOOL, prefs.showLength && TOOL_ON)} aria-pressed={prefs.showLength} onMouseDown={keepFocus} onClick={toggleLength}>
                <RulerIcon aria-hidden />{t("web.wordbookSpell.lengthShort")}
              </button>
            </div>
            <p className="mt-3 text-meta leading-[1.5] text-ink-2">{t("web.wordbookSpell.tip")}</p>
            {submitError ? <p role="alert" className="mt-3 text-sub text-ink">{submitError}</p> : null}
            {stale ? (
              <button type="button" className={cn(GHOST, "mt-2")} onClick={() => load()}>{t("web.wordbookSpell.newSet")}</button>
            ) : null}
            <form {...formProps}>
              <input {...inputProps} />
            </form>
          </>
        ) : null}

        {phase === "results" && set && result ? (
          <>
            <SpellResults
              result={result}
              onWhy={setWhyKey}
              onReport={(key) => { setReportError(""); setReportKey(key); }}
              onListen={listenWord}
              canListen={canListen}
              reported={reported}
            />
            <div className="mt-2">
              <ClozeBoard set={set} state={cloze} showLength={false} showZh={showZh} onFocusBlank={() => undefined} results={resultBlanks} />
            </div>
          </>
        ) : null}

      </div>

      {phase === "summary" ? (
        <SessionSummary
          stats={summaryStats(tally, rankEnabled)}
          onHome={() => navigate("/wordbook")}
          onAgain={() => load()}
          onListen={(id, text) => { if (ai) void tts.play(id, text, ai.defaultTts.model, ai.defaultTts.voice); }}
          canListen={canListen}
        />
      ) : null}

      {phase === "typing" ? (
        <Dock className="glass glass-edge-t sticky bottom-0 z-30 px-gutter py-2.5 mat-chrome-bar liquid:mx-2 liquid:mb-2 liquid:rounded-float liquid:p-2">
          <button type="button" className={PRIMARY} disabled={submitting} onMouseDown={keepFocus} onClick={() => void submit()}>
            {submitting ? t("web.wordbookSpell.submitting") : t("web.wordbookSpell.submit")}
          </button>
        </Dock>
      ) : null}
      {phase === "results" ? (
        <Dock className="glass glass-edge-t sticky bottom-0 z-30 flex gap-2 px-gutter py-2.5 mat-chrome-bar liquid:mx-2 liquid:mb-2 liquid:rounded-float liquid:p-2">
          <button type="button" className={GHOST_DOCK} onClick={() => set && start(set, { retry: true })}>{t("web.wordbookSpell.again")}</button>
          <button type="button" className={PRIMARY} onClick={next}>
            {index + 1 < sets.length ? t("web.wordbookSpell.next") : t("web.wordbookSpell.finish")}
          </button>
        </Dock>
      ) : null}

      {whyKey ? (
        <ExplainSheet
          wordKey={whyKey}
          open
          onClose={() => setWhyKey(null)}
          card={whyWord?.card}
          note={whyWord ? outcomeNote(t, whyWord) : undefined}
        />
      ) : null}

      <BottomSheet open={reportKey !== null} onOpenChange={(o) => { if (!o) setReportKey(null); }}>
        <BottomSheetContent>
          <BottomSheetHeader title={t("web.wordbookSpell.reportTitle")} description={t("web.wordbookSpell.reportNote")} />
          <div className="-mx-3 flex flex-col">
            {(["wrong", "offensive", "other"] as const).map((reason) => (
              <button key={reason} type="button" className={ROW} disabled={reporting} onClick={() => void sendReport(reason)}>
                {t(`web.wordbookSpell.reportReason.${reason}`)}
              </button>
            ))}
          </div>
          {reportError ? <p role="alert" className="mt-2 text-sub text-ink">{reportError}</p> : null}
        </BottomSheetContent>
      </BottomSheet>

      <BottomSheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <BottomSheetContent>
          <BottomSheetHeader title={t("web.wordbookSpell.settings")} />
          <button type="button" role="switch" aria-checked={prefs.showLength} className={cn(ROW, "-mx-3 w-[calc(100%+1.5rem)] justify-between")} onClick={toggleLength}>
            <span>
              <span className="block font-medium">{t("web.wordbookSpell.showLength")}</span>
              <span className="mt-0.5 block text-meta text-ink-2">{t("web.wordbookSpell.showLengthNote")}</span>
            </span>
            <span aria-hidden className={cn("relative h-[26px] w-11 flex-none rounded-full transition-colors duration-fast", prefs.showLength ? "bg-blue" : "bg-surface-2 shadow-hair liquid:bg-wash-2")}>
              {/* 关时的圆钮也用白色 + 发丝线阴影:深色模式下 bg-surface 圆钮在 surface-2 轨道上看不见(review m9) */}
              <span data-testid="switch-knob" className={cn("absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow-hair transition-[left] duration-fast",
                prefs.showLength ? "left-[20px]" : "left-0.5")} />
            </span>
          </button>
        </BottomSheetContent>
      </BottomSheet>
    </div>
  );
}
