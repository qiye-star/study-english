import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { ToneBadge } from "~/components/tone-badge";
import { PageHeader } from "~/layout/page-header";
import { GoalsFields, applyPatch, valueOf, type GoalsValue } from "./goals-fields";
import { PageError, PageLoading, PageNote } from "./page-status";
import { GHOST, PRIMARY, bookTitle, fmt } from "./ui";
import { useReturnFocus } from "./use-return-focus";
import { useWordbookConfig } from "./use-wordbook-config";
import {
  WORDBOOK_SERVER_ERRORS, fetchBooks, fetchToday, limitsOf, saveEnrollment, type BookProgress, type Enrollment,
} from "./wordbook-api";

const MAX_LEVEL = 6;

/** 难度条:6 格,前 level 格青色(视觉稿 .lv)。 */
function LevelBar({ level }: { level: number }) {
  const { t } = useTranslation();
  return (
    <span role="img" aria-label={t("web.wordbook.books.level", { n: level, max: MAX_LEVEL })} className="mt-1.5 flex gap-[3px]">
      {Array.from({ length: MAX_LEVEL }, (_, i) => (
        <i key={i} className={cn("block h-1 w-3 rounded-[2px]", i < level ? "bg-teal liquid:bg-ink/85" : "bg-surface-2 liquid:bg-wash-2")} />
      ))}
    </span>
  );
}

/** 选书页(spec §11.2,视觉稿 02):两列书卡,点书打开每日设置。 */
export function WordbookBooksPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const config = useWordbookConfig();
  const [books, setBooks] = useState<BookProgress[] | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<BookProgress | null>(null);
  const [settings, setSettings] = useState<GoalsValue>({ dailyNew: 20, reviewCap: 100, orderMode: "shuffle" });
  const sheetFocus = useReturnFocus();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchBooks(api, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setBooks(value); },
      (err: unknown) => { if (!controller.signal.aborted) setError(err); },
    );
    // 当前设置只用来预填表单;拿不到就用服务端默认值
    fetchToday(api, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setEnrollment(value.enrollment); },
      (): void => undefined,
    );
    return () => controller.abort();
  }, [api, attempt]);

  const available = (id: string) => (config?.enabled ? config.books.find((b) => b.id === id)?.available !== false : true);

  const open = (book: BookProgress) => {
    // 当前设置原样预填(自定义值不再吸附到最近的分段;goals spec §12.1)
    setSettings(valueOf(enrollment ?? (config?.enabled ? config.defaults : { dailyNew: 20, reviewCap: 100 })));
    setSaveError(null);
    setPicked(book);
  };

  const start = async () => {
    if (!picked || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveEnrollment(api, {
        bookId: picked.id, dailyNew: settings.dailyNew, orderMode: settings.orderMode,
        ...(settings.reviewCap === null ? { reviewUnlimited: true as const } : { reviewCap: settings.reviewCap }),
      });
      navigate("/wordbook");
    } catch (err) {
      setSaveError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
      setSaving(false);
    }
  };

  let body;
  if (config?.enabled === false) body = <PageNote>{t("web.wordbook.errors.disabled")}</PageNote>;
  else if (error) body = <PageError message={translateServerError(t, error, WORDBOOK_SERVER_ERRORS)} onRetry={() => setAttempt((n) => n + 1)} />;
  else if (!books) body = <PageLoading />;
  else {
    body = (
      <>
        <p className="mx-0.5 mb-2.5 mt-1 text-meta leading-dialogue text-ink-2">{t("web.wordbook.books.levelNote")}</p>
        <ul className="grid grid-cols-2 gap-2">
          {books.map((book) => {
            const ok = available(book.id);
            const counts = [t("web.wordbook.books.words", { n: fmt(book.words) })];
            if (book.mastered > 0) counts.push(t("web.wordbook.books.mastered", { n: fmt(book.mastered) }));
            else if (book.learned > 0) counts.push(t("web.wordbook.books.learned", { n: fmt(book.learned) }));
            return (
              <li key={book.id}>
                <button type="button" disabled={!ok} onClick={() => open(book)} aria-current={book.active ? "true" : undefined}
                  data-testid={`wordbook-book-${book.id}`}
                  className={cn(
                    "relative flex min-h-[116px] w-full flex-col rounded-card border-[0.5px] border-hair bg-surface p-3 text-left transition-colors duration-fast",
                    "active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    book.active && "shadow-[inset_0_0_0_1.5px_rgb(var(--blue))]",
                  )}>
                  {book.active ? <ToneBadge tone="blue" className="absolute right-2.5 top-2.5">{t("web.wordbook.books.current")}</ToneBadge> : null}
                  <b className="text-title font-semibold">{bookTitle(book, i18n.language)}</b>
                  <LevelBar level={book.level} />
                  <span className="num mt-auto pt-3 text-meta text-ink-2">{ok ? counts.join(" · ") : t("web.wordbook.books.unavailable")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <div>
      {/* 还没选书时 /wordbook 会立刻跳回本页(home-page 的 Navigate),返回就成了死循环:回练习页(review web M5) */}
      <PageHeader title={t("web.wordbook.books.title")} back={enrollment ? "/wordbook" : "/practice"} />
      <div className="px-gutter liquid:px-frame pb-6">{body}</div>
      <BottomSheet open={picked !== null} onOpenChange={(o) => { if (!o && !saving) setPicked(null); }}>
        {picked ? (
          <BottomSheetContent className="max-h-[88vh] overflow-y-auto" {...sheetFocus}>
            <BottomSheetHeader title={t("web.wordbook.books.sheetTitle", { book: bookTitle(picked, i18n.language) })}
              description={picked.learned > 0 ? t("web.wordbook.books.sheetLearned", { n: fmt(picked.learned) }) : t("web.wordbook.books.sheetFresh", { n: fmt(picked.words) })} />
            <GoalsFields value={settings} limits={limitsOf(config)} remaining={Math.max(0, picked.words - picked.learned)}
              onChange={(p) => setSettings((v) => applyPatch(v, p))} />
            <p className="mt-3 text-meta leading-dialogue text-ink-2">{t("web.wordbook.books.keepProgress")}</p>
            {saveError ? <p role="alert" className="mt-2 text-sub text-ink">{saveError}</p> : null}
            <div className="mt-4 flex gap-2">
              <button type="button" className={cn(GHOST, "h-12 flex-1")} disabled={saving} onClick={() => setPicked(null)}>{t("web.common.cancel")}</button>
              <button type="button" className={cn(PRIMARY, "h-12 flex-1")} disabled={saving} onClick={() => void start()}>{t("web.wordbook.books.start")}</button>
            </div>
          </BottomSheetContent>
        ) : null}
      </BottomSheet>
    </div>
  );
}
