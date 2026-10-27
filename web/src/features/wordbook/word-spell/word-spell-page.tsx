import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@renderer/lib/utils";
import { useAuth } from "~/auth/auth-context";
import { SurfaceCard } from "~/components/surface-card";
import { PageHeader } from "~/layout/page-header";
import { PageError } from "../page-status";
import { SessionSummary, type SessionStats } from "../session-summary";
import { PRIMARY } from "../ui";
import { useSpeaker } from "../use-speaker";
import { WORDBOOK_SERVER_ERRORS, submitAnswer, type AnswerResult, type FreeItem } from "../wordbook-api";
import { translateServerError } from "~/api/error-messages";
import { readPrefs, writePrefs, type WordSpellMode } from "./prefs";
import { WordSpellQuestion } from "./word-spell-question";
import { startWordSpell, type WordSpellCount } from "./word-spell-api";

type Phase = "start" | "run" | "done";
const COUNTS: WordSpellCount[] = [10, 20];

/** 单词拼写页(plan 2026-10-27 R-W5):开始卡 → 一题一屏 → 答后结果与「下一个」→ 小结。路由 /wordbook/spell/words。 */
export function WordbookWordSpellPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const speaker = useSpeaker();
  const [chosen, setChosen] = useState<WordSpellMode>(() => readPrefs().wordSpellMode);
  const [count, setCount] = useState<WordSpellCount>(10);
  const [phase, setPhase] = useState<Phase>("start");
  const [items, setItems] = useState<FreeItem[]>([]);
  const [index, setIndex] = useState(0);
  const [shownMode, setShownMode] = useState<WordSpellMode>("meaning");
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstTry = useRef(0);

  // 没有配置朗读时只能看中文拼英文(plan R-W5);配置还在加载时先按选择显示
  const mode: WordSpellMode = !speaker.loading && !speaker.available ? "meaning" : chosen;
  const current = items[index];
  const speakCurrent = (item: FreeItem | undefined) => {
    if (item) speaker.listen(`${item.card.key}:q`, item.card.word, "us");
  };

  const start = async () => {
    speaker.prime(); // iOS 需要在这次点击里解锁音频
    setBusy(true);
    setError(null);
    try {
      const set = await startWordSpell(api, count);
      setItems(set.items);
      setIndex(0);
      setResult(null);
      firstTry.current = 0;
      setShownMode(mode);
      setPhase("run");
      if (mode === "dictation") speakCurrent(set.items[0]);
    } catch (err) {
      setError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  const submit = async ({ typed, hinted }: { typed: string; hinted: boolean }) => {
    if (!current) return;
    setBusy(true);
    try {
      const res = await submitAnswer(api, {
        bookId: current.bookId, key: current.card.key, mode: "free",
        qtype: shownMode === "dictation" ? "dictation" : "spell", typed, hinted,
      });
      if (res.correct && !hinted) firstTry.current += 1;
      setResult(res);
    } catch (err) {
      toast.error(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const n = index + 1;
    setResult(null);
    if (n >= items.length) {
      setPhase("done");
      return;
    }
    setIndex(n);
    setShownMode(mode);
    if (mode === "dictation") speakCurrent(items[n]);
  };

  // 切换玩法:答题中途切换只清当前题的输入与偷看(换 key 重挂),题目不变、不提交;答完的题切换只影响下一题
  const pick = (m: WordSpellMode) => {
    if (m === "dictation" && !speaker.available) return;
    setChosen(m);
    writePrefs({ wordSpellMode: m });
    if (phase === "run" && result === null) {
      setShownMode(m);
      if (m === "dictation") speakCurrent(current);
    }
  };

  const stats: SessionStats = { kind: "spell", total: items.length, firstTry: firstTry.current, points: null, missed: [] };

  return (
    <div data-testid="word-spell-page" className="flex flex-1 flex-col">
      <PageHeader title={t("web.wordSpell.title")} back="/wordbook/spell" />
      <div className="px-4 pb-8">
        {phase === "start" ? (
          <SurfaceCard data-testid="word-spell-start" className="mt-2 space-y-3 px-4 py-[18px]">
            <div role="radiogroup" aria-label={t("web.wordSpell.modeLabel")} data-testid="word-spell-mode"
              className="grid grid-cols-2 gap-2">
              {(["dictation", "meaning"] as const).map((m) => {
                const off = m === "dictation" && !speaker.available && !speaker.loading;
                return (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} aria-disabled={off}
                    data-testid={`word-spell-mode-${m}`} onClick={() => pick(m)}
                    className={cn("h-11 rounded-button border-[0.5px] border-hair px-3 text-sub font-semibold", mode === m ? "bg-blue-tint text-blue" : "text-ink-2", off && "opacity-50")}>
                    {t(`web.wordSpell.modes.${m}`)}
                  </button>
                );
              })}
            </div>
            {!speaker.loading && !speaker.available ? <p className="text-meta text-ink-2">{t("web.wordSpell.dictationOff")}</p> : null}
            <div role="radiogroup" aria-label={t("web.wordSpell.countLabel")} className="flex gap-2">
              {COUNTS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)}
                  className={cn("h-11 flex-1 rounded-button border-[0.5px] border-hair text-sub font-semibold", count === n ? "bg-surface-2 text-ink" : "text-ink-2")}>
                  {t("web.wordSpell.count", { n })}
                </button>
              ))}
            </div>
            <p className="text-meta text-ink-2">{t("web.wordSpell.startHint", { n: count })}</p>
            <button type="button" onClick={start} disabled={busy} className={cn(PRIMARY, "h-11 w-full")}>{t("web.wordSpell.start")}</button>
            {error ? <PageError message={error} onRetry={start} /> : null}
          </SurfaceCard>
        ) : null}

        {phase === "run" && current ? (
          <div className="mt-2 space-y-3">
            <p className="text-meta text-ink-2">{t("web.wordSpell.progress", { n: index + 1, total: items.length })}</p>
            <WordSpellQuestion key={`${index}-${shownMode}`} item={current} mode={shownMode} result={result} busy={busy}
              onSubmit={submit} speaker={speaker} />
            {result ? (
              <button type="button" onClick={next} className={cn(PRIMARY, "h-12 w-full")}>
                {index + 1 >= items.length ? t("web.wordSpell.finish") : t("web.wordSpell.next")}
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="mt-2">
            <SessionSummary stats={stats} onAgain={() => setPhase("start")} againLabel={t("web.wordSpell.again")}
              onHome={() => navigate("/wordbook/spell")} homeLabel={t("web.wordSpell.home")}
              onListen={speaker.listen} listening={speaker.active} canListen={speaker.available} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
