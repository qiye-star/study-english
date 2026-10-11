import { PlayIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { PageHeader } from "~/layout/page-header";
import { BoxBar } from "./box-bar";
import { FreeReviewSheet } from "./free-review-sheet";
import { PageError, PageLoading, PageNote } from "./page-status";
import { DOCK, GHOST, PRIMARY, bookTitle } from "./ui";
import { useDebounced, useLearnedList, useLearnedSummary } from "./use-learned";
import { useReturnFocus } from "./use-return-focus";
import { useSpeaker } from "./use-speaker";
import { useWordbookConfig } from "./use-wordbook-config";
import { WordCardView } from "./word-card";
import { WORDBOOK_SERVER_ERRORS, fetchLearnedCard, type BookId, type Card, type LearnedItem, type Tier } from "./wordbook-api";

const FIELD = "h-11 w-full rounded-button border-[0.5px] border-hair bg-surface px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// 一色一义:新学 = 琥珀,巩固中 = 中性,熟练 = 青(与 BoxBar 同)
const TIER_TONE: Record<Tier, "amber" | "teal" | "gray"> = { learning: "amber", growing: "gray", mastered: "teal" };

/** 点一行打开的词卡:`POST /learned/card`(词在体里,不在 URL),内容复用现有 WordCardView。 */
function CardSheet({ item, onClose }: { item: LearnedItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const speaker = useSpeaker();
  const back = useReturnFocus();
  const [card, setCard] = useState<Card | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    setCard(null);
    setFailed(false);
    fetchLearnedCard(api, item.bookId, item.key, controller.signal).then(
      (c) => { if (!controller.signal.aborted) setCard(c); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [api, item]);
  const config = useWordbookConfig();
  const showExample = config?.enabled ? config.learn.showExample : true;
  return (
    <BottomSheet open={item !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <BottomSheetContent className="max-h-[88vh] overflow-y-auto" {...back}>
        <BottomSheetHeader title={item?.word ?? ""} description={t("web.wordbook.learned.title")} srOnlyDescription />
        {card ? (
          <WordCardView card={card} showExample={showExample} onListen={speaker.listen} listening={speaker.active} canListen={speaker.available} />
        ) : failed ? <PageNote>{t("web.wordbook.learned.card.unavailable")}</PageNote> : <PageLoading />}
      </BottomSheetContent>
    </BottomSheet>
  );
}

function Row({ item, language, onOpen }: { item: LearnedItem; language: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(language, { month: "short", day: "numeric" });
  const due = new Date(item.dueAt).getTime() <= Date.now();
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="min-w-0 flex-1">
          <span lang="en" className="block truncate text-body font-medium">{item.word}</span>
          <span className="mt-0.5 block truncate text-meta text-ink-2">
            {t("web.wordbook.learned.list.learnedOn", { date: fmtDate(item.learnedAt) })} · {due ? t("web.wordbook.learned.list.dueNow") : t("web.wordbook.learned.list.dueOn", { date: fmtDate(item.dueAt) })}
          </span>
        </span>
        {item.weak ? <ToneBadge tone="amber">{t("web.wordbook.learned.list.weak")}</ToneBadge> : null}
        <ToneBadge tone={TIER_TONE[item.tier]}>{t(`web.wordbook.learned.box.${item.tier}`)}</ToneBadge>
      </button>
    </li>
  );
}

/**
 * 已学词(规格 §1.2):熟练度分布条(点分段筛选)、词书 / 易错 / 学习日期 / 英文前缀搜索、游标分页、点一行打开词卡;
 * 底部「自由复习」(free-review-sheet)。词与前缀只在 POST 体里发出(R-L4)。
 */
export function WordbookLearnedPage() {
  const { t, i18n } = useTranslation();
  const config = useWordbookConfig();
  const enabled = config?.enabled !== false;
  const { summary, error: summaryError, reload: reloadSummary } = useLearnedSummary(enabled);
  const [tier, setTier] = useState<Tier | null>(null);
  const [book, setBook] = useState<BookId | "">("");
  const [weak, setWeak] = useState(false);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const query = useMemo(() => ({
    ...(book ? { book } : {}), ...(tier ? { tier } : {}), ...(weak ? { weak: true } : {}),
    ...(since ? { since } : {}), ...(until ? { until } : {}), ...(q ? { q } : {}),
  }), [book, tier, weak, since, until, q]);
  const list = useLearnedList(query);
  const [opened, setOpened] = useState<LearnedItem | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const filtered = Object.keys(query).length > 0 || text.trim() !== "";
  const clear = () => { setTier(null); setBook(""); setWeak(false); setSince(""); setUntil(""); setText(""); };
  const books = config?.enabled ? config.books.filter((b) => summary?.byBook.some((x) => x.bookId === b.id)) : [];
  const header = <PageHeader title={t("web.wordbook.learned.title")} back="/wordbook" />;

  if (config?.enabled === false) return <div>{header}<PageNote>{t("web.wordbook.errors.disabled")}</PageNote></div>;
  if (summaryError) return <div>{header}<PageError message={translateServerError(t, summaryError, WORDBOOK_SERVER_ERRORS)} onRetry={reloadSummary} /></div>;
  if (!summary) return <div>{header}<PageLoading /></div>;
  const library = summary.total > 0;
  return (
    <div className="flex flex-1 flex-col">
      {header}
      <div className="px-gutter pb-4">
        {library ? (
          <>
            <div className="mt-2"><BoxBar by={summary.byTier} value={tier} onChange={setTier} /></div>
            <label className="relative mt-3 block">
              <span className="sr-only">{t("web.wordbook.learned.search.label")}</span>
              <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" />
              <input type="search" role="searchbox" value={text} onChange={(e) => setText(e.target.value)} maxLength={30}
                inputMode="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} lang="en"
                aria-label={t("web.wordbook.learned.search.label")} placeholder={t("web.wordbook.learned.search.placeholder")}
                className={cn(FIELD, "pl-9")} />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select aria-label={t("web.wordbook.learned.filters.book")} value={book} onChange={(e) => setBook(e.target.value as BookId | "")} className={FIELD}>
                <option value="">{t("web.wordbook.learned.filters.allBooks")}</option>
                {books.map((b) => <option key={b.id} value={b.id}>{bookTitle(b, i18n.language)}</option>)}
              </select>
              <button type="button" aria-pressed={weak} onClick={() => setWeak((w) => !w)}
                className={cn(GHOST, "h-11", weak && "border-blue bg-blue-tint")}>
                {t("web.wordbook.learned.filters.weak")}
              </button>
              <label className="text-meta text-ink-2">{t("web.wordbook.learned.filters.since")}
                <input type="date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} className={cn(FIELD, "mt-1")} />
              </label>
              <label className="text-meta text-ink-2">{t("web.wordbook.learned.filters.until")}
                <input type="date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} className={cn(FIELD, "mt-1")} />
              </label>
            </div>
            {filtered ? <button type="button" onClick={clear} className="mt-2 min-h-tap rounded-button px-1 text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("web.wordbook.learned.filters.clear")}</button> : null}
          </>
        ) : null}
        {list.status === "error" ? (
          <PageError message={translateServerError(t, list.error, WORDBOOK_SERVER_ERRORS)} onRetry={list.reload} />
        ) : list.status === "loading" ? <PageLoading /> : list.items.length > 0 ? (
          <>
            <SurfaceCard className="mt-3 overflow-hidden p-0">
              <ul aria-label={t("web.wordbook.learned.title")} className="divide-y-[0.5px] divide-hair-2">
                {list.items.map((item) => <Row key={`${item.bookId}:${item.key}`} item={item} language={i18n.language} onOpen={() => setOpened(item)} />)}
              </ul>
            </SurfaceCard>
            {list.hasMore ? (
              <button type="button" disabled={list.status !== "idle"} onClick={() => void list.loadMore()} className={cn(GHOST, "mt-3 h-11 w-full")}>
                {t("web.wordbook.learned.list.more")}
              </button>
            ) : null}
          </>
        ) : library ? (
          <div className="mt-6 text-center">
            <PageNote>{t("web.wordbook.learned.empty.filtered")}</PageNote>
            <button type="button" onClick={clear} className={cn(GHOST, "mt-3 h-11")}>{t("web.wordbook.learned.filters.clear")}</button>
          </div>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-title font-semibold">{t("web.wordbook.learned.empty.title")}</p>
            <p className="mt-1 text-sub text-ink-2">{t("web.wordbook.learned.empty.body")}</p>
            <Link to="/wordbook/learn" className={cn(PRIMARY, "mt-4 h-11 w-full")}>{t("web.wordbook.learned.empty.cta")}</Link>
          </div>
        )}
      </div>
      {library ? (
        <div className={DOCK}>
          <button type="button" onClick={() => setFreeOpen(true)} className={cn(PRIMARY, "h-12 flex-1")}><PlayIcon aria-hidden />{t("web.wordbook.learned.free.title")}</button>
        </div>
      ) : null}
      <CardSheet item={opened} onClose={() => setOpened(null)} />
      {library ? <FreeReviewSheet open={freeOpen} onOpenChange={setFreeOpen} summary={summary} /> : null}
    </div>
  );
}
