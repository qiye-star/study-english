import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { SurfaceCard } from "~/components/surface-card";
import { ConfirmSheet } from "./confirm-sheet";
import {
  EXPORT_FILENAME, MEMORY_SERVER_ERRORS, clearMemory, exportMemory, fetchItems, fetchProfile, setMemoryEnabled,
  type PersonaCount, type PersonaRef,
} from "./memory-api";
import { ErrorNote, Loading } from "./status";
import { DANGER, FIELD, GHOST, NOTE } from "./ui";
import { useLoad } from "./use-load";

type Confirm = { scope: "all" } | { scope: "persona"; personaId: string; name: string };
const M = "web.agents.memory.manage";

export const REVOKE_DELAY_MS = 30_000;

/** 用临时链接下载一个文件(不经服务端第二次请求)。 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 马上回收会在 iOS Safari 上取消下载:等下载开始之后再回收
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function ManageTab() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const profile = useLoad((signal) => fetchProfile(api, signal), [api]);
  const items = useLoad((signal) => fetchItems(api, { limit: 1 }, signal), [api]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  if (profile.error) return <ErrorNote message={translateServerError(t, profile.error, MEMORY_SERVER_ERRORS)} onRetry={profile.retry} />;
  if (!profile.data) return <Loading />;
  const state = profile.data;
  const enabled = state.memoryEnabled;
  const deletedName = t("web.agents.memory.items.deletedPersona");
  const personas = (items.data?.personaCounts ?? []).filter(
    (p): p is PersonaCount & { persona: PersonaRef } => p.persona !== null,
  );
  const fail = (err: unknown) => setStatus(translateServerError(t, err, MEMORY_SERVER_ERRORS));
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await work();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => run(async () => {
    await setMemoryEnabled(api, !enabled);
    profile.setData({ ...state, memoryEnabled: !enabled });
    setStatus(t(enabled ? `${M}.paused` : `${M}.resumed`));
  });
  const doExport = () => run(async () => {
    saveBlob(await exportMemory(api), EXPORT_FILENAME);
    setStatus(t(`${M}.exported`));
  });
  const doClear = () => run(async () => {
    if (!confirm) return;
    try {
      const result = await clearMemory(api, confirm.scope, confirm.scope === "persona" ? confirm.personaId : undefined);
      setPersonaId("");
      items.refresh();
      if (confirm.scope === "all") profile.refresh(); // 保留当前内容重新取:标签页不闪成加载中,状态行不丢
      setStatus(t(`${M}.cleared`, { count: result.deleted.items, n: result.deleted.items }));
    } finally {
      setConfirm(null);
    }
  });
  const askPersona = () => {
    const chosen = personas.find((p) => p.persona.id === personaId);
    if (chosen) setConfirm({ scope: "persona", personaId, name: chosen.persona.name ?? deletedName });
  };

  return (
    <div className="flex flex-col gap-3">
      {!state.memoryAvailable ? <p className={`${NOTE} rounded-card bg-surface-2 p-3`}>{t(`${M}.unavailable`)}</p> : null}
      <SurfaceCard className="flex items-center gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p id="memory-remember-label" className="text-body font-semibold text-ink">{t(`${M}.remember`)}</p>
          <p className={NOTE}>{t(enabled ? `${M}.rememberOn` : `${M}.rememberOff`)}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-labelledby="memory-remember-label" disabled={busy}
          onClick={() => void toggle()}
          className={cn("hit-expand relative h-7 w-12 flex-none rounded-full transition-colors duration-fast",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", enabled ? "bg-blue" : "bg-surface-2 liquid:bg-wash-2")}>
          <span aria-hidden className={cn("absolute left-0 top-0.5 h-6 w-6 rounded-full bg-surface shadow-card transition-transform duration-fast",
            enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
        </button>
      </SurfaceCard>
      <SurfaceCard className="flex flex-col gap-2 p-3.5">
        <p className="text-body font-semibold text-ink">{t(`${M}.exportTitle`)}</p>
        <p className={NOTE}>{t(`${M}.exportHelp`)}</p>
        <button type="button" className={`${GHOST} h-11`} disabled={busy} onClick={() => void doExport()}>
          <DownloadIcon aria-hidden />{t(`${M}.export`)}
        </button>
      </SurfaceCard>
      <SurfaceCard className="flex flex-col gap-2 p-3.5">
        <p className="text-body font-semibold text-ink">{t(`${M}.clearPersonaTitle`)}</p>
        {personas.length === 0 ? <p className={NOTE}>{t(`${M}.noPersonaMemory`)}</p> : (
          <>
            <label className="block">
              <span className="sr-only">{t(`${M}.choosePersona`)}</span>
              <select className={FIELD} value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                <option value="">{t(`${M}.choosePersona`)}</option>
                {personas.map((p) => (
                  <option key={p.persona.id} value={p.persona.id}>
                    {t(`${M}.personaOption`, { name: p.persona.name ?? deletedName, count: p.count, n: p.count })}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={`${GHOST} h-11`} disabled={busy || !personaId} onClick={askPersona}>
              {t(`${M}.clearPersona`)}
            </button>
          </>
        )}
      </SurfaceCard>
      <SurfaceCard className="flex flex-col gap-2 p-3.5">
        <p className="text-body font-semibold text-ink">{t(`${M}.clearAllTitle`)}</p>
        <p className={NOTE}>{t(`${M}.clearAllHelp`)}</p>
        <button type="button" className={`${DANGER} h-11`} disabled={busy} onClick={() => setConfirm({ scope: "all" })}>
          {t(`${M}.clearAll`)}
        </button>
      </SurfaceCard>
      <p role="status" aria-live="polite" className={NOTE}>{status ?? ""}</p>
      <ConfirmSheet open={confirm !== null} busy={busy}
        title={confirm?.scope === "persona" ? t(`${M}.confirmPersonaTitle`, { name: confirm.name }) : t(`${M}.confirmAllTitle`)}
        description={t(`${M}.confirmBody`)} confirmLabel={t(`${M}.confirm`)}
        onConfirm={() => void doClear()} onCancel={() => setConfirm(null)} />
    </div>
  );
}
