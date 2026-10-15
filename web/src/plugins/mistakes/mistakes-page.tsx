import { InfoIcon, KeyboardIcon, LoaderIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { LIST_CARD, PAGE_NOTE } from "~/components/list-card";
import { PageHeader } from "~/layout/page-header";
import { MAX_WORD_TARGET } from "~/lib/extension-points";
import { WordActions } from "~/lib/extension-points-react";
import { lookupContext } from "~/lib/lookup-context";
import { LINKS_SERVER_ERRORS } from "../links/links-api";
import { dismissMistake, fetchMistakes, type MistakeItem } from "./mistakes-api";

const BOXES = 6;
const DAY = 864e5;

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: MistakeItem[]; next: number | null; total: number };

/** 「今天 / 昨天 / n 天前」:按本地日历日计算,文字交给 Intl.RelativeTimeFormat。 */
function ago(iso: string, lang: string): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((start(new Date()) - start(new Date(iso))) / DAY));
  // 今天 / 昨天用词语,两天起用数字(视觉稿「2 天前」而不是「前天」)
  return new Intl.RelativeTimeFormat(lang, { numeric: days <= 1 ? "auto" : "always" }).format(-days, "day");
}

function BoxDots({ box, label }: { box: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-[3px]">
      {Array.from({ length: BOXES }, (_, i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i <= box ? "bg-teal" : "bg-hair")} />
      ))}
    </span>
  );
}

/** `/links/mistakes`(spec §6.3):按错次数排序的虚拟视图;「移出」乐观更新,失败回滚并提示。 */
export function MistakesPage() {
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const pending = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchMistakes(api, 1, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ status: "ready", ...data }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => { alive.current = false; controller.abort(); };
  }, [api, attempt]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ready" || state.next === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchMistakes(api, state.next);
      if (!alive.current) return;
      setState((s) => {
        if (s.status !== "ready") return s;
        const seen = new Set(s.items.map((i) => i.word));
        return { status: "ready", items: [...s.items, ...data.items.filter((i) => !seen.has(i.word))], next: data.next, total: data.total };
      });
    } catch (err) {
      if (alive.current) toast.error(translateServerError(t, err, LINKS_SERVER_ERRORS));
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }, [api, loadingMore, state, t]);

  const dismiss = useCallback(async (item: MistakeItem) => {
    if (pending.current.has(item.word)) return;
    pending.current.add(item.word);
    setState((s) => (s.status === "ready"
      ? { ...s, items: s.items.filter((i) => i.word !== item.word), total: Math.max(0, s.total - 1) } : s));
    try {
      await dismissMistake(api, item.word);
    } catch (err) {
      if (alive.current) {
        setState((s) => {
          if (s.status !== "ready" || s.items.some((i) => i.word === item.word)) return s;
          const items = [...s.items, item].sort((a, b) => b.wrongCount - a.wrongCount
            || b.lastWrongAt.localeCompare(a.lastWrongAt) || a.word.localeCompare(b.word));
          return { ...s, items, total: s.total + 1 };
        });
        toast.error(t("web.links.mistakes.dismissFailed"), { description: translateServerError(t, err, LINKS_SERVER_ERRORS) });
      }
    } finally {
      pending.current.delete(item.word);
    }
  }, [api, t]);

  const lang = i18n.resolvedLanguage ?? i18n.language ?? "en";

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.links.mistakes.title")} back="/vocabulary"
        subtitle={state.status === "ready" && state.total > 0 ? t("web.links.mistakes.total", { count: state.total }) : undefined} />
      <div className="space-y-3 px-gutter pb-6 pt-1">
        <p className="flex items-start gap-2 px-0.5 text-sub text-ink-2">
          <InfoIcon aria-hidden className="mt-0.5 size-4 flex-none" />
          <span>{t("web.links.mistakes.lede")}</span>
        </p>
        {state.status === "loading" && (
          <div data-testid="mistakes-loading" className="flex justify-center py-16 text-ink-2">
            <LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} />
          </div>
        )}
        {state.status === "error" && (
          <div role="alert" className="flex flex-col items-center gap-2 py-16 text-sub text-ink-2">
            <p>{t("web.common.loadFailed")}</p>
            <button type="button" data-testid="mistakes-retry" onClick={() => setAttempt((n) => n + 1)}
              className="min-h-11 px-4 font-semibold text-blue">{t("web.common.retry")}</button>
          </div>
        )}
        {state.status === "ready" && state.items.length === 0 && (
          <p data-testid="mistakes-empty" className={PAGE_NOTE}>{t("web.links.mistakes.empty")}</p>
        )}
        {state.status === "ready" && state.items.length > 0 && (
          <ul className={LIST_CARD}>
            {state.items.map((item) => (
              <li key={item.word} data-testid={`mistake-${item.word}`} className="flex min-h-row items-center gap-1 pl-3.5 pr-1">
                <div className="min-w-0 flex-1 py-2.5">
                  <p {...lookupContext} lang="en" className="truncate text-body font-semibold tracking-[-0.005em] text-ink">{item.word}</p>
                  {item.meaning ? <p className="mt-0.5 truncate text-sub text-ink-2">{item.meaning}</p> : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-2">
                    <span className="tabular-nums">
                      {t("web.links.mistakes.count", { count: item.wrongCount })} · {ago(item.lastWrongAt, lang)}
                    </span>
                    {item.box === null ? null : <BoxDots box={item.box} label={t("web.links.mistakes.box", { value: item.box })} />}
                  </p>
                </div>
                <WordActions testId={`mistake-${item.word}-vocab`} variant="icon"
                  target={{ word: item.word, meaning: item.meaning ? item.meaning.slice(0, MAX_WORD_TARGET.meaning) : undefined, source: "manual" }} />
                <IconButton label={t("web.links.mistakes.dismiss", { word: item.word })} data-testid={`mistake-${item.word}-dismiss`}
                  className="text-ink-2" onClick={() => void dismiss(item)}>
                  <XIcon />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {state.status === "ready" && state.next !== null && (
          <Button variant="ghost" data-testid="mistakes-more" className="h-tap w-full text-blue" disabled={loadingMore}
            onClick={() => void loadMore()}>{t("web.links.mistakes.more")}</Button>
        )}
        {state.status === "ready" && (
          <Button asChild data-testid="mistakes-spell" className="h-tap w-full rounded-button font-semibold">
            <Link to="/wordbook/spell"><KeyboardIcon aria-hidden className="size-4" />{t("web.links.mistakes.spell")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
