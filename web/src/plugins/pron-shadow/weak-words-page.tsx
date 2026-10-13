import { InfoIcon, LoaderIcon, MicIcon, PlayIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { useShadowSheet } from "~/features/practice";
import { IconButton } from "~/components/icon-button";
import { LIST_CARD, PAGE_NOTE } from "~/components/list-card";
import { scoreToneClass } from "~/components/score-tone";
import { PageHeader } from "~/layout/page-header";
import { LINKS_SERVER_ERRORS } from "~/plugins/links/links-api";
import { dismissWeakWord, fetchWeakWords, type WeakWordItem } from "./pron-api";

const DRILL = 5;
type State = { status: "loading" } | { status: "error" } | { status: "ready"; items: WeakWordItem[]; total: number };

/**
 * `/links/weak-words`(spec §6.4,视觉稿帧 04):跟读里读得不准的词。「跟读」把例句(没有就是单词)在原地打开跟读弹窗,
 * 「连读这 5 个」把前 5 个词连成一句;都走现有评测接口与配额,本页不发评测请求。
 */
export function WeakWordsPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { open: openShadow } = useShadowSheet();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchWeakWords(api, controller.signal).then(
      (page) => { if (!controller.signal.aborted) setState({ status: "ready", items: page.items, total: page.total }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [api, attempt]);

  const shadow = (reference: string) => openShadow({ text: reference, source: "manual" });

  const dismiss = useCallback(async (item: WeakWordItem) => {
    if (state.status !== "ready") return;
    const before = state;
    setState({ ...before, items: before.items.filter((i) => i.word !== item.word), total: Math.max(0, before.total - 1) });
    try {
      await dismissWeakWord(api, item.word);
    } catch (err) {
      setState((now) => (now.status === "ready" ? before : now));
      toast.error(t("web.links.pron.dismissFailed"), { description: translateServerError(t, err, LINKS_SERVER_ERRORS) });
    }
  }, [api, state, t]);

  const top = state.status === "ready" ? state.items.slice(0, DRILL).map((i) => i.word) : [];
  return (
    <div>
      <PageHeader title={t("web.links.pron.title")} back="/practice"
        subtitle={state.status === "ready" && state.total > 0 ? t("web.links.pron.count", { count: state.total }) : undefined} />
      <div className="px-gutter pb-6">
        <p className="flex items-start gap-2 px-0.5 pt-1 text-sub text-ink-2">
          <InfoIcon aria-hidden className="mt-0.5 h-4 w-4 flex-none" />
          <span>{t("web.links.pron.lede")}</span>
        </p>
        {state.status === "loading" && (
          <div data-testid="weak-words-loading" className="flex justify-center py-16 text-ink-2">
            <LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} />
          </div>
        )}
        {state.status === "error" && (
          <div role="alert" className="flex flex-col items-center gap-2 py-16 text-sub text-ink-2">
            <p>{t("web.common.loadFailed")}</p>
            <button type="button" data-testid="weak-words-retry" onClick={() => setAttempt((n) => n + 1)}
              className="min-h-11 px-4 font-semibold text-blue">{t("web.common.retry")}</button>
          </div>
        )}
        {state.status === "ready" && !state.items.length && (
          <p data-testid="weak-words-empty" className={PAGE_NOTE}>{t("web.links.pron.empty")}</p>
        )}
        {state.status === "ready" && state.items.length > 0 && (
          <>
            <Button data-testid="weak-words-drill" className="mt-3 h-tap w-full rounded-button font-semibold"
              onClick={() => shadow(top.join(", "))}>
              <PlayIcon aria-hidden className="mr-1.5 h-4 w-4" />
              {t("web.links.pron.drillTop", { count: top.length })}
            </Button>
            <ul className={cn(LIST_CARD, "mt-3")}>
              {state.items.map((item) => (
                <li key={item.word} data-testid={`weak-${item.word}`} className="flex min-h-row items-center gap-1 py-1.5 pl-3.5 pr-1.5">
                  <span className="min-w-0 flex-1">
                    <b lang="en" className="block truncate text-body font-semibold text-ink">{item.word}</b>
                    <span className="num mt-0.5 block text-meta text-ink-2">
                      {item.lastScore === null
                        ? <span>{t("web.links.pron.unscored")}</span>
                        : <span className={scoreToneClass(item.lastScore)}>{t("web.links.pron.score", { score: item.lastScore })}</span>}
                      {" · "}
                      {t("web.links.pron.hits", { hits: item.hits })}
                    </span>
                  </span>
                  <IconButton label={t("web.links.pron.shadowWord", { word: item.word })} tone="blue"
                    data-testid={`weak-${item.word}-shadow`} onClick={() => shadow(item.example ?? item.word)}>
                    <MicIcon />
                  </IconButton>
                  <IconButton label={t("web.links.pron.dismiss", { word: item.word })} className="text-ink-2"
                    data-testid={`weak-${item.word}-dismiss`} onClick={() => void dismiss(item)}>
                    <XIcon />
                  </IconButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
