import { useCallback, useEffect, useMemo, useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { errorText, useAsync } from "../../hooks/use-async";
import * as api from "./api";
import type { Impact, RankRules } from "./api";
import { DraftBar } from "./draft-bar";
import type { TabProps } from "./fields";
import { PublishDialog } from "./publish-dialog";
import { MatchTab } from "./rules-tabs/match-tab";
import { PromptsTab } from "./rules-tabs/prompts-tab";
import { ScenariosTab } from "./rules-tabs/scenarios-tab";
import { SeasonTab } from "./rules-tabs/season-tab";
import { StageTab } from "./rules-tabs/stage-tab";
import { TiersTab } from "./rules-tabs/tiers-tab";
import { cloneRules, diffPaths, outOfRange, weightsTotal } from "./rules-schema";
import { RULES_TABS, S, rulesError, type RulesTab } from "./strings";
import { SimulatePanel } from "./simulate-panel";
import { VersionsList } from "./versions-list";

/** /rank/rules:草稿 → 校验 → 预演 → 发布(spec §5.2,视觉稿第 2 屏)。 */
export function RulesPage() {
  const session = useAdminSession();
  const isOperator = hasRole(session, "operator");
  const overview = useAsync(() => api.getRules(), []);
  const [local, setLocal] = useState<RankRules | null>(null);
  const [saved, setSaved] = useState<RankRules | null>(null);
  const [tab, setTab] = useState<RulesTab>("tiers");
  const [errors, setErrors] = useState<string[] | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const data = overview.data;
  const draft = data?.draft ?? null;
  const base: RankRules | null = data?.published?.rules ?? data?.v0 ?? draft?.rules ?? null;

  const validate = useCallback(async () => {
    try {
      const r = await api.validateDraft();
      setErrors(r?.errors ?? []);
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    if (data.draft) {
      setLocal(cloneRules(data.draft.rules));
      setSaved(cloneRules(data.draft.rules));
      setErrors(null);
      void validate();
    } else {
      setLocal(null);
      setSaved(null);
      setErrors(null);
      setImpact(null);
    }
  }, [data, validate]);

  const unsaved = useMemo(() => (local && saved ? diffPaths(saved, local).length : 0), [local, saved]);
  const changes = useMemo(() => (local && base ? diffPaths(base, local).length : 0), [local, base]);
  const localProblems = useMemo(() => {
    if (!local) return [] as string[];
    const out: string[] = [];
    const total = weightsTotal(local);
    if (total !== 100) out.push(S.weightsTotal(total));
    if (outOfRange(local).length) out.push(S.outOfRange);
    return out;
  }, [local]);
  const canEdit = isOperator && !!draft;
  const canSave = canEdit && unsaved > 0 && localProblems.length === 0;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  /** 有未保存修改时先保存(校验、预演、发布都基于服务端的草稿) */
  const saveIfDirty = async () => {
    if (!local || unsaved === 0) return;
    if (localProblems.length) throw new Error(localProblems[0]);
    await api.saveDraft(local, draft?.note ?? "");
    setSaved(cloneRules(local));
  };

  const edit = (mutate: (d: RankRules) => void) => {
    setLocal((cur) => {
      if (!cur) return cur;
      const next = cloneRules(cur);
      mutate(next);
      return next;
    });
  };

  const onSave = () =>
    run(async () => {
      await saveIfDirty();
      setMessage({ tone: "ok", text: S.draftBar.saved });
      await validate();
    });
  const onValidate = () =>
    run(async () => {
      await saveIfDirty();
      await validate();
    });
  const onSimulate = async () => {
    setSimLoading(true);
    setSimError(null);
    try {
      await saveIfDirty();
      setImpact((await api.simulateDraft()) ?? null);
    } catch (e) {
      setSimError(errorText(e));
    } finally {
      setSimLoading(false);
    }
  };
  const onNew = (from?: number) =>
    run(async () => {
      await api.createDraft(from ?? null);
      overview.reload();
    });
  const onDiscard = async () => {
    await api.deleteDraft();
    setDiscarding(false);
    overview.reload();
  };
  const onPublish = async (reason: string) => {
    await saveIfDirty();
    const r = await api.publishDraft(reason);
    setPublishing(false);
    setMessage({ tone: "ok", text: r ? `v${r.version}` : S.draftBar.publish });
    overview.reload();
  };

  if (overview.loading && !data) {
    return (
      <Page title={S.rankRulesPage}>
        <Skeleton variant="blocks" rows={3} />
      </Page>
    );
  }
  if (overview.error || !data || !base) {
    return (
      <Page title={S.rankRulesPage}>
        <ErrorState message={overview.error ?? "—"} onRetry={overview.reload} />
      </Page>
    );
  }

  const shown = local ?? base;
  const problems = (errors ?? []).map(rulesError);
  // the match tab shows the weights total next to the sliders already
  const listedLocal = localProblems.filter((text) => !(tab === "match" && text.startsWith(S.weightsTotal(0).slice(0, 4))));
  const tabProps: TabProps = { rules: shown, base, edit, disabled: !canEdit };
  const baseLabel = data.published ? `v${data.published.version}` : "v0";

  return (
    <Page title={S.rankRulesPage}>
      <DraftBar
        overview={data}
        changes={changes}
        unsaved={unsaved}
        errors={errors}
        canEdit={isOperator}
        canSave={canSave}
        busy={busy}
        onNew={() => onNew()}
        onSave={onSave}
        onDiscard={() => setDiscarding(true)}
        onValidate={onValidate}
        onSimulate={onSimulate}
        onPublish={() => setPublishing(true)}
      />
      {message && (
        <p role={message.tone === "bad" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${message.tone === "bad" ? "bg-bad-soft text-bad" : "bg-good-soft text-fg"}`}>
          {message.text}
        </p>
      )}
      {(problems.length > 0 || listedLocal.length > 0) && (
        <ul className="panel space-y-1 px-4 py-3 text-sm" aria-label={S.draftBar.validate}>
          {listedLocal.map((text) => (
            <li key={text} className="text-bad">
              {text}
            </li>
          ))}
          {problems.map((p, i) => (
            <li key={`${p.text}-${i}`} className="flex items-center gap-2 text-bad">
              <span>{p.text}</span>
              <button type="button" className="btn-quiet btn-sm min-h-[24px] px-2 text-xs" onClick={() => setTab(p.tab)}>
                {RULES_TABS.find((t) => t.value === p.tab)?.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isOperator && <p className="text-xs text-fg-2">{S.draftBar.viewerReadOnly}</p>}
      {isOperator && !draft && <p className="text-xs text-fg-2">{S.draftBar.readOnly}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4">
        <div className="space-y-4">
          <section className="panel">
            <div role="tablist" aria-label={S.rankRulesPage} className="flex gap-1 border-b border-line px-2">
              {RULES_TABS.map((t) => {
                const count = problems.filter((p) => p.tab === t.value).length;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.value}
                    className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${tab === t.value ? "border-accent font-medium text-fg" : "border-transparent text-fg-2 hover:text-fg"}`}
                    onClick={() => setTab(t.value)}
                  >
                    {t.label}
                    {count > 0 && (
                      <span aria-hidden="true" className="badge num bg-bad-soft text-bad">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" className="px-4 py-4">
              {tab === "tiers" && <TiersTab {...tabProps} />}
              {tab === "stage" && <StageTab {...tabProps} />}
              {tab === "match" && <MatchTab {...tabProps} />}
              {tab === "scenarios" && <ScenariosTab {...tabProps} />}
              {tab === "prompts" && <PromptsTab {...tabProps} />}
              {tab === "season" && <SeasonTab {...tabProps} started={!!data.seasonStarted} />}
            </div>
          </section>
          <VersionsList
            versions={data.versions}
            current={data.published?.version ?? null}
            effective={base}
            hasDraft={!!draft}
            busy={busy}
            onFork={(v) => onNew(v)}
          />
        </div>
        <SimulatePanel
          impact={impact}
          loading={simLoading}
          error={simError}
          dirty={unsaved > 0}
          baseLabel={baseLabel}
          canRun={canEdit}
          onRun={onSimulate}
        />
      </div>
      {local && (
        <PublishDialog open={publishing} base={base} draft={local} onConfirm={onPublish} onClose={() => setPublishing(false)} />
      )}
      <ConfirmDialog
        open={discarding}
        title={S.draftBar.discardTitle}
        body={S.draftBar.discardBody}
        danger
        confirmText={S.draftBar.discard}
        onConfirm={onDiscard}
        onClose={() => setDiscarding(false)}
      />
    </Page>
  );
}
