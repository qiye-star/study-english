import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable } from "../../components/data-table";
import { Dialog } from "../../components/dialog";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { errorText, useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { S as Shell } from "../../strings";
import { AdjustDialog } from "./adjust-dialog";
import * as api from "./api";
import type { MatchRow, UserRank } from "./api";
import { MatchStatusBadge, VOIDABLE } from "./match-status";
import { ResetDialog, type ResetBody } from "./reset-dialog";
import { ACHIEVEMENTS, EVENT_KINDS, STAGE_KINDS, S, achievementName, tierLabel, tierName } from "./strings";
import { TierIcon } from "./tier-icons";

type Open = "attempts" | "adjust" | "achievements" | "reset" | null;

function minutesLeft(iso: string | null, now = Date.now()): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.ceil((t - now) / 60_000));
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-l border-line pl-4">
      <span className="text-2xs text-fg-2">{label}</span>
      <span className="flex items-center gap-2 text-sm font-medium">{children}</span>
    </div>
  );
}

function AttemptsDialog({ open, day, onSubmit, onClose }: { open: boolean; day: string; onSubmit: (day: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(day);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue(day);
      setError(null);
    }
  }, [open, day]);
  return (
    <Dialog
      open={open}
      title={S.panel.resetAttemptsTitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {Shell.dialogs.cancel}
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!value}
            onClick={async () => {
              try {
                await onSubmit(value);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {Shell.dialogs.confirm}
          </button>
        </>
      }
    >
      <p className="text-fg-2">{S.panel.resetAttemptsBody}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{S.panel.day}</span>
        <input type="date" className="field-sm num" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-bad">{error}</p>}
    </Dialog>
  );
}

function AchievementsDialog({ open, data, onSubmit, onClose }: { open: boolean; data: UserRank; onSubmit: (changes: [string, boolean][]) => Promise<void>; onClose: () => void }) {
  const owned = new Set(data.achievements.filter((a) => a.unlockedAt).map((a) => a.key));
  const keys = Array.from(new Set([...Object.keys(ACHIEVEMENTS), ...data.achievements.map((a) => a.key)]));
  const [picked, setPicked] = useState<Set<string>>(owned);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPicked(new Set(data.achievements.filter((a) => a.unlockedAt).map((a) => a.key)));
      setError(null);
    }
  }, [open, data]);
  const changes = keys.filter((k) => picked.has(k) !== owned.has(k)).map((k) => [k, picked.has(k)] as [string, boolean]);
  return (
    <Dialog
      open={open}
      title={S.panel.achievementsAction}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {Shell.dialogs.cancel}
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={changes.length === 0}
            onClick={async () => {
              try {
                await onSubmit(changes);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {Shell.dialogs.confirm}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.has(k)}
              onChange={(e) =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (e.target.checked) next.add(k);
                  else next.delete(k);
                  return next;
                })
              }
            />
            {achievementName(k)}
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-bad">{error}</p>}
    </Dialog>
  );
}

/** 用户详情页的「段位」页签(视觉稿第 3 屏):段位头部、阶段练习、点数流水、比赛表、成就;operator 可操作。 */
export function UserRankPanel({ userId }: { userId: number | string }) {
  const id = Number(userId);
  const state = useAsync(() => api.getUserRank(id), [id]);
  const [open, setOpen] = useState<Open>(null);
  const [pendingMatch, setPendingMatch] = useState<{ match: MatchRow; action: "void" | "regrade" } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const closeMatch = useCallback(() => setPendingMatch(null), []);

  const after = () => {
    setOpen(null);
    setPendingMatch(null);
    state.reload();
  };
  const act = async (fn: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await fn();
      state.reload();
    } catch (e) {
      setNotice({ tone: "bad", text: errorText(e) });
    }
  };

  if (state.loading && !state.data) return <Skeleton variant="blocks" rows={2} />;
  if (state.error || !state.data) return <ErrorState message={state.error ?? "—"} onRetry={state.reload} />;
  const data = state.data;
  const p = data.profile;
  const cooldown = minutesLeft(p?.cooldownUntil ?? null);
  const tasksDone = data.stageTasks.filter((t) => t.complete).length;

  return (
    <div className="space-y-4" aria-label={S.userRankPanel}>
      {notice && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {notice.text}
        </p>
      )}
      <section className="panel">
        {p ? (
          <div className="flex items-center gap-5 px-4 py-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-sunken text-fg">
              <TierIcon tier={p.tierKey} width={28} height={28} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <b className="text-md font-semibold">{tierLabel(p.tier, p.division)}</b>
                {p.stars > 0 && <span className="num text-xs text-fg-2">{S.panel.stars(p.stars)}</span>}
                {p.atGate && <span className="badge bg-accent-soft text-fg">{S.panel.gate}</span>}
              </div>
              <div className="mt-2 h-1.5 w-60 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (p.rp / Math.max(1, p.divisionRp)) * 100)}%` }} />
              </div>
              <p className="num mt-1 text-xs text-fg-2">{S.panel.rpLine(p.rp, p.divisionRp, tasksDone, data.stageTasks.length)}</p>
            </div>
            <Stat label={S.panel.best}>{tierName(p.bestTierKey)}</Stat>
            <Stat label={S.panel.cooldown}>
              {cooldown > 0 ? <span className="num text-warn">{S.panel.cooldownLeft(cooldown)}</span> : <span className="text-fg-2">{S.panel.none}</span>}
            </Stat>
            <Stat label={S.panel.attemptsToday}>
              <span className="num">
                {data.attemptsToday.left} / {data.attemptsToday.limit}
              </span>
              {data.quotaOverride !== null && <span className="badge bg-sunken text-fg-2">{S.panel.overridden(data.quotaOverride)}</span>}
            </Stat>
          </div>
        ) : (
          <p className="px-4 py-6 text-sm text-fg-2">{S.panel.noProfile}</p>
        )}
        <RoleGate min="operator">
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            <button type="button" className="btn-ghost btn-sm" disabled={!p?.cooldownUntil || cooldown === 0} onClick={() => act(() => api.clearCooldown(id))}>
              {S.panel.clearCooldown}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen("attempts")}>
              {S.panel.resetAttempts}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen("adjust")}>
              {S.panel.adjust}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen("achievements")}>
              {S.panel.achievementsAction}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setOpen("reset")}>
              {S.panel.reset}
            </button>
          </div>
        </RoleGate>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <section className="panel">
          <div className="panel-head">
            <h3 className="text-sm font-semibold">{S.panel.stageTasks}</h3>
          </div>
          <ul className="space-y-2 px-4 pb-4">
            {data.stageTasks.map((t) => (
              <li key={t.key} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>
                    {STAGE_KINDS[t.kind] ?? t.kind}
                    {t.minScore !== null ? ` ≥${t.minScore}` : ""}
                  </span>
                  <span className={`num ${t.complete ? "text-fg" : "text-fg-2"}`}>
                    {t.done}/{t.target}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (t.done / Math.max(1, t.target)) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3 className="text-sm font-semibold">{S.panel.events}</h3>
          </div>
          <ul className="divide-rows">
            {data.recentEvents.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className={`num w-12 text-right font-medium ${e.points < 0 ? "text-fg-2" : ""}`}>{e.points > 0 ? `+${e.points}` : e.points}</span>
                <span className="min-w-0 flex-1 truncate">
                  {EVENT_KINDS[e.kind] ?? e.kind}
                  {e.kind === "admin_adjust" && e.actor && (
                    <span className="ml-2 text-xs text-fg-2">
                      {S.panel.by(e.actor)}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </span>
                  )}
                </span>
                <span className="num text-xs text-fg-2">{e.day}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3 className="text-sm font-semibold">{S.panel.matches}</h3>
        </div>
        <DataTable<MatchRow>
          rows={data.matches}
          rowKey={(m) => m.id}
          empty="—"
          columns={[
            { key: "time", header: S.panel.time, render: (m) => <span className="num">{formatDateTime(m.startedAt)}</span> },
            { key: "target", header: S.panel.target, render: (m) => tierName(m.toTier) },
            { key: "scenario", header: S.panel.scenario, render: (m) => m.scenarioTitleZh },
            { key: "status", header: S.panel.status, render: (m) => <MatchStatusBadge match={m} /> },
            { key: "score", header: S.panel.score, numeric: true, render: (m) => `${m.total ?? "—"} / ${m.threshold}` },
            { key: "rules", header: S.panel.rules, render: (m) => <span className="font-mono text-xs">{m.rulesVersion === null ? "v0" : `v${m.rulesVersion}`}</span> },
            {
              key: "actions",
              header: "",
              align: "right",
              render: (m) => (
                <span className="inline-flex gap-1">
                  <Link to={`/rank/matches/${encodeURIComponent(m.id)}`} className="btn-quiet btn-sm">
                    {S.panel.view}
                  </Link>
                  <RoleGate min="operator">
                    {VOIDABLE.has(m.status) && (
                      <button type="button" className="btn-quiet btn-sm" onClick={() => setPendingMatch({ match: m, action: "void" })}>
                        {S.panel.void}
                      </button>
                    )}
                    {m.status === "grading_failed" && (
                      <button type="button" className="btn-quiet btn-sm" onClick={() => setPendingMatch({ match: m, action: "regrade" })}>
                        {S.panel.regrade}
                      </button>
                    )}
                  </RoleGate>
                </span>
              ),
            },
          ]}
        />
      </section>

      <section className="panel px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold">{S.panel.achievements}</h3>
        <div className="flex flex-wrap gap-1.5">
          {data.achievements.map((a) => (
            <span key={a.key} className={`badge ${a.unlockedAt ? "bg-good-soft text-fg" : "bg-sunken text-fg-2"}`} title={a.unlockedAt ? S.panel.unlocked : S.panel.locked}>
              {achievementName(a.key)}
            </span>
          ))}
        </div>
      </section>

      <AttemptsDialog
        open={open === "attempts"}
        day={data.attemptsToday.day}
        onClose={close}
        onSubmit={async (day) => {
          await api.resetAttempts(id, day);
          after();
        }}
      />
      <AdjustDialog
        open={open === "adjust"}
        onClose={close}
        onSubmit={async (delta, reason) => {
          await api.adjustPoints(id, delta, reason);
          after();
        }}
      />
      <AchievementsDialog
        open={open === "achievements"}
        data={data}
        onClose={close}
        onSubmit={async (changes) => {
          for (const [key, granted] of changes) await api.setAchievement(id, key, granted);
          after();
        }}
      />
      <ResetDialog
        open={open === "reset"}
        current={p ? `${S.panel.best} ${tierName(p.bestTierKey)} · ${tierLabel(p.tier, p.division)} · ${p.rp}` : S.panel.noProfile}
        divisionRps={data.divisionRps}
        onClose={close}
        onSubmit={async (body: ResetBody) => {
          await api.resetUserRank(id, body);
          after();
        }}
      />
      <ConfirmDialog
        open={pendingMatch?.action === "void"}
        title={S.panel.voidTitle}
        body={S.panel.voidBody}
        reasonRequired
        onConfirm={async (reason) => {
          if (pendingMatch) await api.voidMatch(pendingMatch.match.id, reason);
          after();
        }}
        onClose={closeMatch}
      />
      <ConfirmDialog
        open={pendingMatch?.action === "regrade"}
        title={S.panel.regradeTitle}
        body={S.panel.regradeBody}
        onConfirm={async () => {
          if (pendingMatch) await api.regradeMatch(pendingMatch.match.id);
          after();
        }}
        onClose={closeMatch}
      />
    </div>
  );
}
