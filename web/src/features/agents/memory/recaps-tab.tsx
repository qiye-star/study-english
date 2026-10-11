import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { ConfirmSheet } from "./confirm-sheet";
import { MEMORY_SERVER_ERRORS, deleteRecap, fetchRecaps } from "./memory-api";
import { Empty, ErrorNote, Loading } from "./status";
import { GHOST, NOTE, fmtDate, personaLabel } from "./ui";
import { useLoad } from "./use-load";

const M = "web.agents.memory";

export function RecapsTab() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const { data, setData, error, retry } = useLoad((signal) => fetchRecaps(api, null, signal), [api]);
  const [status, setStatus] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (err: unknown) => setStatus(translateServerError(t, err, MEMORY_SERVER_ERRORS));

  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await fetchRecaps(api, data.nextCursor);
      setData((d) => (d ? { ...next, recaps: [...d.recaps, ...next.recaps] } : next));
    } catch (err) {
      fail(err);
    } finally {
      setLoadingMore(false);
    }
  };
  const remove = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await deleteRecap(api, pending);
      setData((d) => (d ? { ...d, recaps: d.recaps.filter((r) => r.id !== pending) } : d));
      setStatus(t(`${M}.recaps.deleted`));
    } catch (err) {
      fail(err);
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  if (error) return <ErrorNote message={translateServerError(t, error, MEMORY_SERVER_ERRORS)} onRetry={retry} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-3">
      {data.recaps.length === 0 ? <Empty>{t(`${M}.recaps.empty`)}</Empty> : (
        <ul className="flex flex-col gap-2">
          {data.recaps.map((recap) => (
            <li key={recap.id} data-testid={`memory-recap-${recap.id}`}>
              <SurfaceCard className="flex items-start gap-1 py-3 pl-3.5 pr-1">
                <div className="min-w-0 flex-1">
                  <ToneBadge tone="gray">{t(`${M}.recaps.source.${recap.source}`)}</ToneBadge>
                  <p className="mt-1.5 break-words text-body text-ink">{recap.text}</p>
                  <p className="mt-1 break-words text-sub text-ink-3">{personaLabel(t, recap.persona)} · {fmtDate(recap.createdAt, i18n.language)}</p>
                </div>
                <IconButton label={t(`${M}.recaps.delete`)} onClick={() => setPending(recap.id)}>
                  <Trash2Icon />
                </IconButton>
              </SurfaceCard>
            </li>
          ))}
        </ul>
      )}
      {data.nextCursor ? (
        <button type="button" className={`${GHOST} h-11`} disabled={loadingMore} onClick={() => void loadMore()}>
          {t("web.common.loadMore")}
        </button>
      ) : null}
      <p role="status" aria-live="polite" className={NOTE}>{status ?? ""}</p>
      <ConfirmSheet open={pending !== null} busy={busy} title={t(`${M}.recaps.confirmTitle`)} description={t(`${M}.deleteBody`)}
        confirmLabel={t(`${M}.confirmDelete`)} onConfirm={() => void remove()} onCancel={() => setPending(null)} />
    </div>
  );
}
