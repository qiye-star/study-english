import { MicIcon, SparklesIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { useAuth } from "~/auth/auth-context";
import type { PointProps } from "~/lib/extension-points";
import { fetchTodayWords, fetchWeakWords, type TodayWord } from "./pron-api";

const LazyTodayWordsSheet = lazy(() => import("./today-words-sheet").then((m) => ({ default: m.TodayWordsSheet })));

/** 32px 可视 / 44px 命中区(hit-expand)的来源片;每片自带外边距,不需要共同父元素。 */
const CHIP = "hit-expand mb-2 mr-2 inline-flex h-8 items-center gap-1.5 rounded-[9px] pl-2 pr-2.5 text-sub font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** learningSources 贡献:琥珀「发音弱词 n」片,进 `/links/weak-words`;没有弱词或请求失败时不渲染。 */
export function WeakWordsChip() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchWeakWords(api, controller.signal).then(
      (page) => { if (!controller.signal.aborted) setTotal(page.total); },
      (): void => undefined,
    );
    return () => controller.abort();
  }, [api]);
  if (total <= 0) return null;
  return (
    <Link to="/links/weak-words" data-testid="source-chip-weak" className={cn(CHIP, "bg-amber-tint text-amber")}>
      <MicIcon aria-hidden className="h-4 w-4" />
      <span className="num">{t("web.links.pron.weakChip", { total })}</span>
    </Link>
  );
}

/** learningSources 贡献:青「今日新词 n」片,打开例句面板;点例句经 `pick` 填进跟读参考文本(仍走现有评测与配额)。 */
export function TodayWordsChip({ pick }: PointProps["learningSources"]) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<TodayWord[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchTodayWords(api, controller.signal).then(
      (body) => { if (!controller.signal.aborted) setItems(body.items); },
      (): void => undefined,
    );
    return () => controller.abort();
  }, [api]);
  if (!items.length) return null;
  return (
    <>
      <button type="button" data-testid="source-chip-today" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className={cn(CHIP, "bg-teal-tint text-teal")}>
        <SparklesIcon aria-hidden className="h-4 w-4" />
        <span className="num">{t("web.links.pron.todayChip", { count: items.length })}</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <LazyTodayWordsSheet items={items} open={open} onOpenChange={setOpen}
            onPick={(text) => { pick(text); setOpen(false); }} />
        </Suspense>
      )}
    </>
  );
}
