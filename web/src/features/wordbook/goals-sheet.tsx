import { ChevronRightIcon, FlameIcon, PauseIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@renderer/lib/utils";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SegmentedControl } from "~/components/segmented-control";
import { GoalsConfirm } from "./goals-confirm";
import { GoalsFields, valueOf } from "./goals-fields";
import { GHOST, bookTitle, fmt } from "./ui";
import type { GoalsApi } from "./use-goals";
import { useReturnFocus } from "./use-return-focus";
import type { GoalLimits, Today } from "./wordbook-api";

const BONUS_SIZES = ["5", "10", "20"] as const;
type BonusSize = (typeof BONUS_SIZES)[number];
const ROW = cn(
  "flex min-h-[52px] w-full items-center gap-3 px-3.5 text-left text-body font-medium transition-colors duration-fast active:bg-surface-2",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&>svg]:h-5 [&>svg]:w-5 [&>svg]:flex-none",
);
const SECTION = "mt-5 text-sub font-semibold text-ink-2";

/** 重置确认:中文名、英文名或 id,去首尾空白,不区分大小写(与服务端 confirm_matches 一致)。 */
export const matchesBook = (text: string, book: { id: string; titleZh: string; titleEn: string }) => {
  const typed = text.trim().toLocaleLowerCase();
  return typed.length > 0 && [book.id, book.titleZh, book.titleEn].some((v) => v.toLocaleLowerCase() === typed);
};

/**
 * 每日目标面板(spec 2026-10-11 §2.2):字段即改即存(乐观更新)、今天加练、连续达标、换书/暂停/重置。
 * BottomSheet 与 GoalsConfirm 是同一份 Radix Dialog:焦点困在内部,Esc 关闭,关闭后焦点回到打开它的按钮(useReturnFocus)。
 */
export function GoalsSheet({ open, onOpenChange, today, limits, goals, focus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: Today;
  limits: GoalLimits;
  goals: GoalsApi;
  focus?: "bonus";
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [size, setSize] = useState<BonusSize>("10");
  const [confirm, setConfirm] = useState<null | "pause" | "reset">(null);
  const [typed, setTyped] = useState("");
  // 中文输入法组字时不比对书名(拼音中间态),组字结束后按钮才可点(spec §12.3、真机清单 搜狗)
  const [composing, setComposing] = useState(false);
  const [saved, setSaved] = useState(0);
  const bonusRef = useRef<HTMLDivElement>(null);
  const sheetFocus = useReturnFocus();
  useEffect(() => {
    if (!open || focus !== "bonus") return;
    // jsdom 与少数旧 WebView 没有 scrollIntoView
    const frame = requestAnimationFrame(() => bonusRef.current?.scrollIntoView?.({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [open, focus]);

  const { enrollment, plan, book, progress } = today;
  if (!enrollment || !plan || !book || !progress) return null;
  const streak = today.streak ?? { current: 0, todayMet: false }; // 老版本服务端没有 streak
  const title = bookTitle(book, i18n.language);
  const bonusLeft = Math.max(0, limits.bonusMax - plan.bonus);
  const reason = limits.bonusMax <= 0 ? t("web.wordbook.goals.bonus.off")
    : plan.backlogGuard ? t("web.wordbook.goals.bonus.backlog")
    : plan.newLeft > 0 ? t("web.wordbook.goals.bonus.needGoal", { n: plan.newLeft })
    : progress.remaining <= 0 ? t("web.wordbook.goals.bonus.finished")
    : bonusLeft <= 0 ? t("web.wordbook.goals.bonus.limit", { max: limits.bonusMax })
    : null;
  const grant = Math.min(Number(size), Math.max(bonusLeft, 1));
  const metToday = streak.todayMet || plan.goalMet;
  const streakText = streak.current > 0
    ? t("web.wordbook.goals.streak.days", { n: streak.current, count: streak.current })
    : t("web.wordbook.goals.streak.none");
  const todayText = metToday ? t("web.wordbook.goals.streak.todayMet")
    : plan.newLeft > 0 ? t("web.wordbook.goals.streak.todayNew", { n: plan.newLeft })
    : t("web.wordbook.goals.streak.todayReviews", { n: plan.reviewLeft });

  // 确认框打开时错误写在框里(面板此时对读屏隐藏);失败时框不关,可以改了再试
  const confirmError = goals.error ? <p role="alert" className="mt-3 rounded-badge bg-surface-2 px-3 py-2.5 text-sub text-ink">{goals.error}</p> : null;

  const startBonus = async () => {
    if (await goals.bonus(Math.min(Number(size), bonusLeft))) {
      onOpenChange(false);
      navigate("/wordbook/learn");
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[88vh] overflow-y-auto" {...sheetFocus}>
        <BottomSheetHeader title={t("web.wordbook.goals.title")}
          description={t("web.wordbook.goals.subtitle", { book: title, n: fmt(progress.remaining) })} />
        {goals.error && confirm === null ? <p role="alert" className="mb-3 rounded-badge bg-surface-2 px-3 py-2.5 text-sub text-ink">{goals.error}</p> : null}
        <span key={saved} aria-live="polite" className="sr-only">{saved > 0 ? t("web.wordbook.goals.saved") : ""}</span>

        <GoalsFields value={valueOf(enrollment)} limits={limits} remaining={progress.remaining}
          today={{ newDone: plan.newDone, reviewDone: plan.reviewDone, reviewDue: plan.reviewDue, bonus: plan.bonus }}
          onChange={(p) => void goals.patch(p).then((ok) => { if (ok) setSaved((n) => n + 1); })} />

        <div ref={bonusRef}>
          <p className={SECTION}>{t("web.wordbook.goals.bonus.label")}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <SegmentedControl<BonusSize> label={t("web.wordbook.goals.bonus.sizes")} value={size} onChange={setSize} disabled={reason !== null}
              optionClassName="min-w-10" options={BONUS_SIZES.map((n) => ({ value: n, label: n }))} />
            <button type="button" className={cn(GHOST, "h-11 flex-1")} disabled={reason !== null || goals.busy === "bonus"}
              onClick={() => void startBonus()}>
              {t("web.wordbook.goals.bonus.action", { n: grant })}
            </button>
          </div>
          <p className="mt-1.5 text-meta text-ink-2">{reason ?? t("web.wordbook.goals.bonus.left", { n: bonusLeft })}</p>
        </div>

        <p className={SECTION}>{t("web.wordbook.goals.streak.label")}</p>
        <p data-testid="goals-streak" className="mt-1.5 flex items-center gap-1.5 text-body text-ink">
          <FlameIcon aria-hidden className="h-[18px] w-[18px] flex-none text-amber" />
          <span className="num">{streakText} · {todayText}</span>
        </p>
        <p className="mt-1 text-meta leading-dialogue text-ink-2">{t("web.wordbook.goals.streak.help")}</p>

        <div className="mt-5 divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface">
          <Link to="/wordbook/books" className={ROW} onClick={() => onOpenChange(false)}>
            <span className="flex-1">{t("web.wordbook.goals.rows.switch")}</span>
            <ChevronRightIcon aria-hidden className="text-ink-3" />
          </Link>
          <button type="button" className={ROW} onClick={() => setConfirm("pause")}>
            <PauseIcon aria-hidden className="text-ink-2" />
            <span className="flex-1">{t("web.wordbook.goals.rows.pause")}</span>
          </button>
          <button type="button" className={cn(ROW, "text-red")} onClick={() => { setTyped(""); setComposing(false); setConfirm("reset"); }}>
            <RotateCcwIcon aria-hidden />
            <span className="flex-1">{t("web.wordbook.goals.rows.reset")}</span>
          </button>
        </div>

        <GoalsConfirm open={confirm === "pause"} onOpenChange={(v) => { if (!v) setConfirm(null); }}
          title={t("web.wordbook.goals.pause.title", { book: title })} body={<p>{t("web.wordbook.goals.pause.body")}</p>}
          confirmLabel={t("web.wordbook.goals.pause.confirm")} confirmDisabled={goals.busy === "pause"}
          onConfirm={() => void goals.pause().then((r) => { if (r) { setConfirm(null); onOpenChange(false); } })}>
          {confirmError}
        </GoalsConfirm>

        <GoalsConfirm open={confirm === "reset"} onOpenChange={(v) => { if (!v) setConfirm(null); }} danger
          title={t("web.wordbook.goals.reset.title", { book: title })}
          body={<>
            <p>{t("web.wordbook.goals.reset.clears")}</p>
            <p>{t("web.wordbook.goals.reset.keeps")}</p>
            <p className="num text-ink">{t("web.wordbook.goals.reset.learned", { n: fmt(progress.learned), count: progress.learned })}</p>
          </>}
          confirmLabel={t("web.wordbook.goals.reset.confirm")}
          confirmDisabled={composing || !matchesBook(typed, book) || goals.busy === "reset"}
          onConfirm={() => void goals.reset(book.id, typed.trim()).then((r) => {
            if (!r) return;
            toast.success(t("web.wordbook.goals.reset.done", { book: title }));
            setConfirm(null);
            onOpenChange(false);
          })}>
          <label className="mt-3.5 block text-sub font-semibold text-ink">
            {t("web.wordbook.goals.reset.input", { book: title })}
            <input value={typed} onChange={(e) => setTyped(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(e) => { setComposing(false); setTyped(e.currentTarget.value); }}
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"
              className="mt-1.5 h-tap w-full rounded-button border-[0.5px] border-hair bg-surface-2 px-3 text-body font-normal text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          {confirmError}
        </GoalsConfirm>
      </BottomSheetContent>
    </BottomSheet>
  );
}
