import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { SpinnerIcon } from "../../components/icons";
import { ErrorState } from "../../components/states";
import { errorText } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { listRevisions, revertRevision, type Revision, type RevisionSide, type SaveResult } from "./api";
import { formatValue, managedErrorText } from "./model";
import { S } from "./strings";

function side(v: RevisionSide): string {
  if (v.secret) return v.source === "override" ? S.secretChanged : S.sourceEnv;
  return v.source === "override" ? formatValue(v.value ?? null) : S.sourceEnv;
}

/** 修改历史(spec §3.7):按修订列出;超级管理员可"撤销此修订"(冲突键需再次确认)。 */
export function RevisionsDrawer({ canRevert, onClose, onReverted }: { canRevert: boolean; onClose: () => void; onReverted: (r: SaveResult) => void }) {
  const [items, setItems] = useState<Revision[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Revision | null>(null);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [phrase, setPhrase] = useState<string | undefined>(undefined);

  const load = useCallback(async (before?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listRevisions(before);
      setItems((old) => (before ? [...old, ...page.items] : page.items));
      setNext(page.nextBeforeId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !target && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, target]);

  const revert = async (reason: string) => {
    if (!target) return;
    try {
      const result = await revertRevision(target.id, { reason, confirm: phrase ?? null, acknowledgeConflicts: conflicts !== null });
      setTarget(null);
      setConflicts(null);
      setPhrase(undefined);
      onReverted(result);
      void load();
    } catch (e) {
      const details = e instanceof ApiError ? e.details : undefined;
      if (e instanceof ApiError && e.status === 409 && details && Array.isArray(details.conflicts)) {
        setConflicts(details.conflicts as string[]);
        throw new Error(S.revertConflicts((details.conflicts as string[]).map((k) => k.toUpperCase()).join("、")));
      }
      if (e instanceof ApiError && e.status === 409 && details && typeof details.confirm === "string") {
        setPhrase(details.confirm);
        throw new Error(S.revertConfirmNeeded);
      }
      const managed = managedErrorText(e);
      if (managed) throw new Error(managed);
      throw e;
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-fg/30" aria-hidden="true" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={S.revisionsTitle} className="fade-in relative flex h-full w-[560px] flex-col bg-surface shadow-card ring-1 ring-line">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-md font-semibold">{S.revisionsTitle}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {S.close}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {error && <ErrorState message={error} onRetry={() => load()} />}
          {!loading && !error && items.length === 0 && <p className="text-sm text-fg-2">{S.revisionsEmpty}</p>}
          {items.map((r) => (
            <article key={r.id} className="rounded-xl border border-line p-3 text-sm">
              <header className="flex items-center gap-2">
                <span className="badge bg-sunken text-fg-2 ring-1 ring-inset ring-line">#{r.id}</span>
                <span className="num text-xs text-fg-2">{formatDateTime(r.at)}</span>
                <span className="text-xs">{r.actor}</span>
                <span className="flex-1" />
                {r.revertedBy !== null ? (
                  <span className="text-2xs text-fg-2">{S.reverted(r.revertedBy)}</span>
                ) : (
                  canRevert && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => { setConflicts(null); setPhrase(undefined); setTarget(r); }}>
                      {S.revertThis}
                    </button>
                  )
                )}
              </header>
              {r.reason && <p className="mt-1 text-xs text-fg-2">{r.reason}</p>}
              <ul className="mt-2 space-y-1">
                {r.changes.map((c) => (
                  <li key={c.key} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    <span className="font-mono">{c.env}</span>
                    <span className="text-fg-2">{side(c.old)}</span>
                    <span aria-hidden="true" className="text-fg-2">→</span>
                    <span className="font-medium">{c.op === "reset" ? S.opReset : side(c.new)}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {loading && <SpinnerIcon width={16} height={16} />}
          {next !== null && !loading && (
            <button type="button" className="btn-ghost btn-sm w-full" onClick={() => load(next)}>
              {S.loadMore}
            </button>
          )}
        </div>
      </aside>
      <ConfirmDialog
        open={target !== null}
        title={target ? S.revertTitle(target.id) : ""}
        body={S.revertBody}
        reasonRequired
        requireTyping={phrase}
        confirmText={S.revertThis}
        danger
        onConfirm={revert}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
