import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Dialog } from "../../components/dialog";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { errorText as apiErrorText, useAsync } from "../../hooks/use-async";
import {
  ACTIVE, cancel, deleteItem, deletePhrase, fetchCatalogItem, mediaUrl, patchMeta, patchSegment, posterUrl, publish,
  purgeItem, purgePhrase, retry, translateMissing, unpublish, type CatalogRow, type CatalogSegment,
} from "./api";
import { levelLong } from "../../lib/levels";
import { ReplaceMedia } from "./replace-media";
import { S, errorText } from "./strings";

const clock = (ms: number) => {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  return `${String(m).padStart(2, "0")}:${(total - m * 60).toFixed(1).padStart(4, "0")}`;
};

interface SegDraft { text: string; zh: string; startMs: string; endMs: string }

function SentenceRow({ seg, row, locked, onSaved, onError }: {
  seg: CatalogSegment; row: CatalogRow; locked: boolean; onSaved: (s: CatalogSegment) => void; onError: (m: string | null) => void;
}) {
  const own = seg.zhLang === row.aiLang ? seg.zh : null;
  const [draft, setDraft] = useState<SegDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const open = () => setDraft({ text: seg.text, zh: own ?? "", startMs: String(seg.startMs), endMs: String(seg.endMs) });
  const save = async () => {
    if (!draft) return;
    const patch: { text?: string; zh?: string; startMs?: number; endMs?: number } = {};
    if (draft.text !== seg.text) patch.text = draft.text;
    if (draft.zh !== (own ?? "")) patch.zh = draft.zh;
    if (Number(draft.startMs) !== seg.startMs) patch.startMs = Number(draft.startMs);
    if (Number(draft.endMs) !== seg.endMs) patch.endMs = Number(draft.endMs);
    if (Object.keys(patch).length === 0) {
      setDraft(null);
      return;
    }
    setBusy(true);
    onError(null);
    try {
      onSaved(await patchSegment(row.id, seg.idx, patch));
      setDraft(null);
    } catch (e) {
      onError(errorText(apiErrorText(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-2 border-t border-line py-2 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className="num w-8 shrink-0 text-2xs text-muted">{seg.idx + 1}</span>
        <span className="num w-28 shrink-0 text-2xs text-fg-2">{`${clock(seg.startMs)} – ${clock(seg.endMs)}`}</span>
        <span className="min-w-0 flex-1">
          <span className="block">{seg.text}</span>
          {own ? <span className="block text-fg-2">{own}</span> : <span className="block text-2xs text-warn">{S.badges.partial}</span>}
          {seg.flags.length > 0 && seg.flags.map((f) => <span key={f} className="badge mr-1 bg-warn-soft text-warn">{f}</span>)}
        </span>
        {!locked && !draft && (
          <RoleGate min="operator">
            <button type="button" className="btn-ghost btn-sm" onClick={open}>{S.detail.edit}</button>
          </RoleGate>
        )}
      </div>
      {draft && (
        <div className="space-y-2 rounded-lg bg-sunken p-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-2">{S.detail.text}</span>
            <textarea className="field-sm h-auto min-h-[56px] py-2" value={draft.text} maxLength={2000} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-2">{S.detail.zh}</span>
            <textarea aria-label={S.detail.zh} className="field-sm h-auto min-h-[56px] py-2" value={draft.zh} maxLength={2400} onChange={(e) => setDraft({ ...draft, zh: e.target.value })} />
          </label>
          <div className="flex gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-fg-2">{S.detail.startMs}</span>
              <input type="number" min={0} className="field-sm" value={draft.startMs} onChange={(e) => setDraft({ ...draft, startMs: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-fg-2">{S.detail.endMs}</span>
              <input type="number" min={0} className="field-sm" value={draft.endMs} onChange={(e) => setDraft({ ...draft, endMs: e.target.value })} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setDraft(null)}>{S.form.cancel}</button>
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>{S.detail.save}</button>
          </div>
        </div>
      )}
    </li>
  );
}

function MetaForm({ row, onSaved, onError }: { row: CatalogRow; onSaved: () => void; onError: (m: string | null) => void }) {
  const [title, setTitle] = useState(row.title);
  const [level, setLevel] = useState(row.level ?? "");
  const [tags, setTags] = useState(row.tags.join(", "));
  const [license, setLicense] = useState(row.licenseNote ?? "");
  const [busy, setBusy] = useState(false);
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const changes = {
    ...(title.trim() !== row.title ? { title: title.trim() } : {}),
    ...(level !== (row.level ?? "") ? { level: level || null } : {}),
    ...(tagList.join(",") !== row.tags.join(",") ? { tags: tagList } : {}),
    ...(license.trim() !== (row.licenseNote ?? "") ? { licenseNote: license.trim() || null } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  const save = async () => {
    setBusy(true);
    onError(null);
    try {
      await patchMeta(row.id, changes);
      onSaved();
    } catch (e) {
      onError(errorText(apiErrorText(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{S.detail.meta}</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.form.title}</span>
          <input className="field-sm" value={title} maxLength={400} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.form.level}</span>
          <select className="field-sm" value={level} disabled={busy} onChange={(e) => setLevel(e.target.value)}>
            <option value="">{S.form.noLevel}</option>
            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l} value={l}>{levelLong(l)}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.form.tags}</span>
          <input className="field-sm" value={tags} disabled={busy} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.form.license}</span>
          <input className="field-sm" value={license} maxLength={300} disabled={busy} onChange={(e) => setLicense(e.target.value)} />
        </label>
      </div>
      {dirty && (
        <RoleGate min="operator">
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>{S.detail.saveMeta}</button>
        </RoleGate>
      )}
    </section>
  );
}

/** 详情抽屉:试听、元数据、动作、句子编辑、删除 / 强制删除(spec §11;R-AU4 / R-AU5)。 */
export function CatalogDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const data = useAsync(() => fetchCatalogItem(id), [id]);
  const [segments, setSegments] = useState<Record<number, CatalogSegment>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "purge" | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setSegments({});
    data.reload();
    onChanged();
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(errorText(apiErrorText(e)));
    } finally {
      setBusy(false);
    }
  };

  const item = data.data?.item;
  const active = !!item && ACTIVE.includes(item.status);
  const missing = !!item && item.status === "ready" && item.translated < item.segCount;

  return (
    <>
      <Dialog open title={item?.title ?? S.title} width={880} onClose={onClose}
        footer={<button type="button" className="btn-ghost btn-sm" onClick={onClose}>{S.detail.close}</button>}>
        {data.error && !data.data ? (
          <ErrorState message={data.error} onRetry={data.reload} />
        ) : !item ? (
          <Skeleton rows={3} />
        ) : (
          <>
            <div className="flex items-start gap-4">
              {item.hasPoster && <img src={posterUrl(id)} alt="" className="h-20 w-20 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {item.retired && <span className="badge bg-warn-soft text-warn">{S.badges.retired}</span>}
                  {item.mediaMissing && <span className="badge bg-warn-soft text-warn">{S.badges.mediaMissing}</span>}
                  {missing && <span className="badge bg-warn-soft text-warn">{S.badges.partial}</span>}
                  {item.lowConfidence && <span className="badge bg-warn-soft text-warn">{S.badges.lowConfidence}</span>}
                </div>
                {item.status === "failed" && item.errorKind && <p className="text-bad">{S.errorKinds[item.errorKind] ?? item.errorKind}</p>}
                {item.status === "ready" && item.errorKind && item.errorKind !== "upstream" && (
                  <p className="text-warn">{S.detail.replaceFailed(S.errorKinds[item.errorKind] ?? item.errorKind)}</p>
                )}
                {!item.mediaMissing && (item.kind === "video" ? (
                  <video controls preload="none" src={mediaUrl(id)} poster={item.hasPoster ? posterUrl(id) : undefined}
                    className="max-h-64 w-full rounded-lg bg-black" aria-label={S.detail.listen} />
                ) : (
                  <audio controls preload="none" src={mediaUrl(id)} className="w-full" aria-label={S.detail.listen} />
                ))}
              </div>
            </div>

            <RoleGate min="operator">
              <div className="flex flex-wrap gap-2">
                {item.status === "failed" && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run(() => retry(id))}>{S.detail.retry}</button>}
                {active && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run(() => cancel(id))}>{S.detail.cancelJob}</button>}
                {missing && !item.published && (
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run(() => translateMissing(id))}>{S.detail.translate}</button>
                )}
                {item.status === "ready" && !item.published && !item.retired && item.segCount > 0 && !item.mediaMissing && (
                  <ReplaceMedia id={id} disabled={busy} onDone={refresh} onError={(e) => setError(errorText(apiErrorText(e)))} />
                )}
                {item.published && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run(() => unpublish(id))}>{S.detail.unpublish}</button>}
                {!item.published && item.status === "ready" && !item.retired && !item.mediaMissing && (
                  <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => run(() => publish(id))}>{S.detail.publish}</button>
                )}
                <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => setConfirm("delete")}>{S.detail.del}</button>
                <RoleGate min="superadmin">
                  <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => setConfirm("purge")}>{S.detail.purge}</button>
                </RoleGate>
              </div>
            </RoleGate>
            {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{error}</p>}

            <MetaForm key={item.updatedAt + item.title} row={item} onSaved={refresh} onError={setError} />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{S.detail.sentences}</h3>
              {item.published && <p className="text-xs text-fg-2">{S.detail.editLocked}</p>}
              <ul>
                {data.data!.segments.map((s) => (
                  <SentenceRow key={s.idx} seg={segments[s.idx] ?? s} row={item} locked={item.published || item.status !== "ready"}
                    onSaved={(seg) => setSegments((m) => ({ ...m, [seg.idx]: seg }))} onError={setError} />
                ))}
              </ul>
            </section>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirm === "delete" && !!item}
        title={S.confirm.deleteTitle}
        body={S.confirm.deleteBody(item?.refs ?? 0)}
        requireTyping={deletePhrase(id)}
        reasonRequired
        danger
        onConfirm={async (reason) => {
          const out = await deleteItem(id, reason, deletePhrase(id));
          setConfirm(null);
          onChanged();
          if (out.outcome === "deleted") onClose();
          else data.reload();
        }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "purge" && !!item}
        title={S.confirm.purgeTitle}
        body={S.confirm.purgeBody(item?.refs ?? 0)}
        requireTyping={purgePhrase(id)}
        reasonRequired
        danger
        onConfirm={async (reason) => {
          await purgeItem(id, reason, purgePhrase(id));
          setConfirm(null);
          onChanged();
          onClose();
        }}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
