import { useCallback, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { hasRole, useAdminSession } from "../../api/session";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { errorText, useAsync } from "../../hooks/use-async";
import { exportSettings, getDoctor, listSettings, type SaveResult, type Scalar, type SettingItem } from "./api";
import { DoctorCard } from "./doctor-card";
import { FLAG_FINDINGS, FlagsPanel } from "./flags-panel";
import { ImportDialog } from "./import-dialog";
import { dangerOf, formatValue, type Draft } from "./model";
import { PROBE_FOR, ProbeButton } from "./probe-button";
import { ReviewDialog } from "./review-dialog";
import { RevisionsDrawer } from "./revisions-drawer";
import { SaveBar } from "./save-bar";
import { SettingRow } from "./setting-row";
import { S } from "./strings";

function probeValues(item: SettingItem, draft: Draft): Record<string, Scalar> {
  const keys = [item.key, ...(item.pair ? [item.pair] : [])];
  const out: Record<string, Scalar> = {};
  for (const k of keys) if (k in draft && draft[k] !== null) out[k] = draft[k];
  return out;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 运行时设置(spec §3、视觉稿第 1 屏):左列分组、右列设置行;修改先进草稿,统一经"保存前检查"保存。 */
export function SettingsPage() {
  const params = useParams();
  const session = useAdminSession();
  const canEdit = hasRole(session, "superadmin");
  const [tick, setTick] = useState(0);
  const settings = useAsync(listSettings, [tick]);
  const doctor = useAsync(getDoctor, [tick]);
  const [draft, setDraft] = useState<Draft>({});
  const [reviewing, setReviewing] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const list = settings.data;
  const groups = list?.groups ?? [];
  const current = groups.some(([k]) => k === params.group) ? params.group! : groups[0]?.[0];
  const findings = doctor.data?.findings ?? [];

  const onDraft = useCallback((key: string, value: Scalar | undefined) => {
    setDraft((d) => {
      const next = { ...d };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  const byGroup = useMemo(() => {
    const map = new Map<string, SettingItem[]>();
    for (const item of list?.items ?? []) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return map;
  }, [list]);

  const itemByKey = useMemo(() => new Map((list?.items ?? []).map((i) => [i.key, i])), [list]);
  const draftCount = Object.keys(draft).length;
  const dangerCount = Object.entries(draft).filter(([k, v]) => itemByKey.has(k) && dangerOf(itemByKey.get(k)!, v)).length;

  const afterSave = (result: SaveResult, keepDraft = false) => {
    if (!keepDraft) setDraft({});
    setReviewing(false);
    setImporting(false);
    const pending = result.pendingRestart.map((k) => k.toUpperCase()).join("、");
    setNotice([S.saved(result.revision), pending && S.savedPending(pending)].filter(Boolean).join(" · "));
    setTick((t) => t + 1);
  };

  const doExport = async () => {
    setActionError(null);
    try {
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      download(await exportSettings(), `enjoy-settings-${day}.json`);
      setNotice(S.exported);
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  if (settings.error && !list) {
    return (
      <Page title={S.settingsPage}>
        <ErrorState message={settings.error} onRetry={settings.reload} />
      </Page>
    );
  }
  if (!list) {
    return (
      <Page title={S.settingsPage}>
        <Skeleton rows={6} />
      </Page>
    );
  }

  const rows = (byGroup.get(current ?? "") ?? []).filter((i) => !(current === "features" && i.key in FLAG_FINDINGS));
  const groupLabel = groups.find(([k]) => k === current)?.[1] ?? "";
  const pendingItems = list.items.filter((i) => i.restartPending);

  return (
    <Page title={S.settingsPage} actions={<span className="badge bg-sunken text-fg-2 ring-1 ring-inset ring-line">{S.revision(list.revision)}</span>}>
      <div className="flex items-stretch gap-3">
        <DoctorCard findings={doctor.data?.findings ?? null} error={doctor.error} />
        <button type="button" className="btn-ghost btn-sm self-center" onClick={() => setDrawer(true)}>
          {S.history}
        </button>
        {canEdit && (
          <>
            <button type="button" className="btn-ghost btn-sm self-center" onClick={doExport}>
              {S.export}
            </button>
            <button type="button" className="btn-ghost btn-sm self-center" onClick={() => setImporting(true)}>
              {S.import}
            </button>
          </>
        )}
      </div>

      {list.safeMode && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{S.safeMode}</p>}
      {list.applyErrors.length > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
          {S.applyErrors} <span className="font-mono">{list.applyErrors.join(", ")}</span>
        </p>
      )}
      {pendingItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
          <b className="font-semibold">{S.restartBar(pendingItems.length)}</b>
          {pendingItems.map((i) => (
            <span key={i.key} className="text-xs">
              <span className="font-mono">{i.env}</span>{" "}
              {!i.secret && S.restartNow(formatValue(i.effective), formatValue(i.pending))}
            </span>
          ))}
          <span className="flex-1" />
          <span className="text-xs">
            {S.restartHint} <span className="font-mono">{S.restartCmd}</span>
          </span>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-sm text-good">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
          {actionError}
        </p>
      )}
      {!canEdit && <p className="text-xs text-fg-2">{S.readOnlyNote}</p>}

      <div className="grid grid-cols-[208px_minmax(0,1fr)] items-start gap-4">
        <nav aria-label={S.groupsNav} className="panel sticky top-4 py-1.5">
          {groups.map(([key, label]) => {
            const items = byGroup.get(key) ?? [];
            const edits = items.filter((i) => i.key in draft).length;
            const pending = items.some((i) => i.restartPending);
            const down = key === "realtime" && findings.some((f) => f.code === "realtime_unavailable");
            return (
              <NavLink
                key={key}
                to={`/settings/${key}`}
                className={() =>
                  `flex min-h-[34px] items-center gap-1.5 px-3 text-sm ${key === current ? "bg-accent-soft font-medium text-accent-strong" : "text-fg-2 hover:bg-sunken"} ${key === "system" ? "mt-1 border-t border-line" : ""}`
                }
              >
                <span className="flex-1">{label}</span>
                {edits > 0 && <span className="badge bg-accent-soft text-accent-strong">{S.edits(edits)}</span>}
                {pending && <span className="badge bg-warn-soft text-warn">{S.pending}</span>}
                {down && <span className="badge bg-bad-soft text-bad">{S.unavailable}</span>}
              </NavLink>
            );
          })}
        </nav>

        <section aria-label={groupLabel} className="panel">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <h2 className="text-md font-semibold">{groupLabel}</h2>
            <span className="flex-1" />
            <span className="text-xs text-fg-2">{list.encryption ? S.encryptionOn : S.encryptionOff}</span>
          </div>
          {current === "features" && <FlagsPanel items={byGroup.get("features") ?? []} draft={draft} findings={findings} onDraft={onDraft} readOnly={!canEdit} />}
          {rows.map((item) => (
            <SettingRow
              key={item.key}
              item={item}
              draft={item.key in draft ? draft[item.key] : undefined}
              onDraft={onDraft}
              readOnly={!canEdit}
              encryption={list.encryption}
              probe={canEdit && PROBE_FOR[item.key] && !item.envOnly ? <ProbeButton upstream={PROBE_FOR[item.key]} values={probeValues(item, draft)} /> : undefined}
            />
          ))}
        </section>
      </div>

      {canEdit && <SaveBar count={draftCount} dangerCount={dangerCount} onReview={() => setReviewing(true)} onDiscard={() => setDraft({})} />}
      {reviewing && <ReviewDialog items={list.items} draft={draft} onSaved={(r) => afterSave(r)} onClose={() => setReviewing(false)} />}
      {drawer && <RevisionsDrawer canRevert={canEdit} onClose={() => setDrawer(false)} onReverted={(r) => afterSave(r, true)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onApplied={(r) => afterSave(r)} />}
    </Page>
  );
}
