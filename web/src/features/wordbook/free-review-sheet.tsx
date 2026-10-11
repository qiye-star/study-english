import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SegmentedControl } from "~/components/segmented-control";
import { FREE_PATH } from "./free-batch";
import { PRIMARY, bookTitle } from "./ui";
import { useReturnFocus } from "./use-return-focus";
import { useWordbookConfig } from "./use-wordbook-config";
import {
  WORDBOOK_SERVER_ERRORS, startFree, type BookId, type FreeCount, type FreeMode, type FreeScope, type LearnedSummary, type Tier,
} from "./wordbook-api";

const SCOPES: FreeScope[] = ["yesterday", "last7", "book", "tier", "weak", "all"];
const MODES: FreeMode[] = ["browse", "recall", "choice", "spell"];
const COUNTS: FreeCount[] = [10, 20, 50];
const TIERS: Tier[] = ["learning", "growing", "mastered"];

/** 这个范围里有没有词(没有就置灰):昨天 / 7 天 / 易错看汇总,书 / 熟练度看分布。 */
export function scopeCount(summary: LearnedSummary, scope: FreeScope): number {
  switch (scope) {
    case "yesterday": return summary.yesterday;
    case "last7": return summary.last7;
    case "weak": return summary.weak;
    case "book": return summary.byBook.length;
    case "tier": return TIERS.filter((t) => summary.byTier[t] > 0).length;
    default: return summary.total;
  }
}

/**
 * 自由复习面板(规格 §1.2):范围 × 方式 × 数量。点「开始」由服务端抽词出题(客户端不能指定词),
 * 成功后进入复习页的 `?source=free`。不计段位点、不占每日复习上限(面板里一句话说明)。
 */
export function FreeReviewSheet({ open, onOpenChange, summary }: { open: boolean; onOpenChange: (open: boolean) => void; summary: LearnedSummary }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const config = useWordbookConfig();
  const back = useReturnFocus();
  const [scope, setScope] = useState<FreeScope>("all");
  const [mode, setMode] = useState<FreeMode>("choice");
  const [count, setCount] = useState<FreeCount>(10);
  const [book, setBook] = useState<BookId | "">("");
  const [tier, setTier] = useState<Tier | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bookChoices = summary.byBook.map((b) => b.bookId);
  const effectiveBook = (book || bookChoices[0]) as BookId | undefined;
  const effectiveTier = (tier || TIERS.find((x) => summary.byTier[x] > 0)) as Tier | undefined;
  const bookName = (id: BookId) => {
    const found = config?.enabled ? config.books.find((b) => b.id === id) : undefined;
    return found ? bookTitle(found, i18n.language) : id;
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const set = await startFree(api, {
        scope, mode, count, ...(scope === "book" && effectiveBook ? { book: effectiveBook } : {}), ...(scope === "tier" && effectiveTier ? { tier: effectiveTier } : {}),
      });
      navigate(FREE_PATH, { state: { free: set } });
    } catch (err) {
      setError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[88vh] overflow-y-auto" {...back}>
        <BottomSheetHeader title={t("web.wordbook.learned.free.title")} description={t("web.wordbook.learned.free.note")} />
        <p className="text-meta font-semibold text-ink-2">{t("web.wordbook.learned.free.scope.label")}</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {SCOPES.map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} disabled={scopeCount(summary, s) === 0} onClick={() => setScope(s)}
              className={cn("min-h-tap rounded-button border-[0.5px] px-3 text-body font-medium transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                scope === s ? "border-blue bg-blue-tint text-blue" : "border-hair bg-surface text-ink active:bg-surface-2")}>
              {t(`web.wordbook.learned.free.scope.${s}`)}
            </button>
          ))}
        </div>
        {scope === "book" ? (
          <select aria-label={t("web.wordbook.learned.free.pickBook")} value={effectiveBook ?? ""} onChange={(e) => setBook(e.target.value as BookId)}
            className="mt-2 h-11 w-full rounded-button border-[0.5px] border-hair bg-surface px-3 text-body">
            {bookChoices.map((id) => <option key={id} value={id}>{bookName(id)}</option>)}
          </select>
        ) : null}
        {scope === "tier" ? (
          <SegmentedControl<Tier> className="mt-2" label={t("web.wordbook.learned.free.pickTier")} value={(effectiveTier ?? "learning") as Tier} onChange={setTier}
            options={TIERS.filter((x) => summary.byTier[x] > 0).map((x) => ({ value: x, label: t(`web.wordbook.learned.box.${x}`) }))} />
        ) : null}
        <p className="mt-4 text-meta font-semibold text-ink-2">{t("web.wordbook.learned.free.mode.label")}</p>
        <SegmentedControl<FreeMode> className="mt-1.5" label={t("web.wordbook.learned.free.mode.label")} value={mode} onChange={setMode}
          options={MODES.map((m) => ({ value: m, label: t(`web.wordbook.learned.free.mode.${m}`) }))} />
        <p className="mt-4 text-meta font-semibold text-ink-2">{t("web.wordbook.learned.free.count.label")}</p>
        <SegmentedControl className="mt-1.5" label={t("web.wordbook.learned.free.count.label")} value={String(count) as "10" | "20" | "50"}
          onChange={(v) => setCount(Number(v) as FreeCount)}
          options={COUNTS.map((n) => ({ value: String(n) as "10" | "20" | "50", label: t("web.wordbook.learned.free.count.n", { n }) }))} />
        {error ? <p role="alert" className="mt-3 text-sub text-ink">{error}</p> : null}
        <button type="button" disabled={busy} onClick={() => void start()} className={cn(PRIMARY, "mt-4 h-12 w-full")}>
          {busy ? t("web.wordbook.learned.free.starting") : t("web.wordbook.learned.free.start")}
        </button>
      </BottomSheetContent>
    </BottomSheet>
  );
}
