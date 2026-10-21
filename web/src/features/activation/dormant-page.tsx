import { MoonIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { EmptyState } from "~/components/empty-state";
import { SegmentedControl, type SegmentedOption } from "~/components/segmented-control";
import { PageHeader } from "~/layout/page-header";
import { ACTIVATION_STATES, fetchWords, type ActivationState, type ActivationWord, type ActivationWords } from "./activation-api";
import { useActivationConfig } from "./use-activation-config";

/** 沉睡词页(/me/activation,懒加载)。关闭时跳回练习页;配置还没到时什么都不渲染。 */
export function DormantPage() {
  const config = useActivationConfig();
  if (config === null) return null;
  if (!config.enabled) return <Navigate to="/practice" replace />;
  return <DormantList />;
}

const EMPTY_COUNTS: ActivationWords["counts"] = { dormant: 0, sprouting: 0, active: 0 };

function DormantList() {
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<ActivationState>("dormant");
  const [counts, setCounts] = useState<ActivationWords["counts"]>(EMPTY_COUNTS);
  const [items, setItems] = useState<ActivationWord[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [moreFailed, setMoreFailed] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    setStatus("loading");
    setItems([]);
    setNext(null);
    fetchWords(api, state, 0, ctl.signal).then(
      (page) => {
        setCounts(page.counts);
        setItems(page.items);
        setNext(page.next);
        setStatus("ready");
      },
      () => { if (!ctl.signal.aborted) setStatus("error"); },
    );
    return () => ctl.abort();
  }, [api, state]);

  const loadMore = () => {
    if (next === null) return;
    setMoreFailed(false);
    fetchWords(api, state, next).then(
      (page) => {
        setCounts(page.counts);
        setItems((prev) => [...prev, ...page.items]);
        setNext(page.next);
      },
      () => setMoreFailed(true),
    );
  };

  const options: SegmentedOption<ActivationState>[] = ACTIVATION_STATES.map((value) => ({
    value,
    label: `${t(`web.activation.state.${value}`)} ${counts[value]}`,
    testId: `activation-tab-${value}`,
  }));

  return (
    <div data-testid="activation-page" className="pb-8">
      <PageHeader title={t("web.activation.title")} back="/me" />
      <p className="mb-3 px-1 text-sub text-ink-2">{t(`web.activation.hint.${state}`)}</p>
      <SegmentedControl<ActivationState> label={t("web.activation.segmentLabel")} value={state}
        onChange={(next) => setState(next)} options={options} />
      {status === "error" ? (
        <p role="alert" data-testid="activation-error" className="mt-4 px-1 text-sub text-ink-2">{t("web.activation.loadFailed")}</p>
      ) : null}
      {status === "ready" && items.length === 0 ? (
        <div className="mt-4">
          <EmptyState icon={MoonIcon} title={t("web.activation.empty.title")} body={t("web.activation.empty.body")}
            testId="activation-empty" />
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="mt-4 space-y-2" data-testid="activation-list">
          {items.map((w) => (
            <li key={`${w.bookId}:${w.word}`} data-testid="activation-word"
              className="rounded-card border-[0.5px] border-hair bg-surface px-3.5 py-3">
              <p className="text-body font-semibold text-ink">{w.word}</p>
              <p className="mt-0.5 text-sub text-ink-2">
                {w.useCount > 0 ? t("web.activation.usedTimes", { count: w.useCount }) : t("web.activation.neverUsed")}
                {w.lastUsedAt ? ` · ${t("web.activation.lastUsed", { date: formatDate(w.lastUsedAt, i18n.language) })}` : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {next !== null ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <button type="button" data-testid="activation-more" onClick={loadMore}
            className="min-h-tap rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.activation.more")}
          </button>
          {moreFailed ? <p role="alert" className="text-sub text-ink-2">{t("web.activation.loadFailed")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale);
}
