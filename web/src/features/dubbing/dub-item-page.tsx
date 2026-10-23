import "./locales";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import type { DubbingKit } from "~/features/library";
import { ClipPicker, clipReadiness, type PickSeg } from "./clip-picker";
import type { ClipSelection } from "./clip";
import { useDubbingConfig } from "./config";
import { type DubbingTake, getRoles, getTake, listTakes, putRoles, type RoleKey, type RolesState, ROLE_KEYS } from "./dubbing-api";
import { reopenedResult, TakeHistory } from "./take-history";
import { useDubKit } from "./kit-context";
import { DubResults } from "./dub-results";
import { DubSession } from "./dub-session";
import { RoleLabels } from "./role-labels";
import { RolePicker } from "./role-picker";
import { RoleTag, roleLabel } from "./role-identity";
import type { TakeResult } from "./take-runner";

/** `/dub/:itemId`:选片段 → 选角色 → 彩排 → 录制(会话在 dub-session.tsx)。 */
type ItemDetail = Awaited<ReturnType<DubbingKit["getItem"]>>;

/** 配置没到时的占位限值(服务端的数值为准,见 config)。 */
const FALLBACK_LIMITS = {
  maxLines: 12, maxMs: 90_000, windowBeforeMs: 300, windowAfterMs: 600, syncToleranceMs: 400,
  weights: { pronunciation: 60, fluency: 20, sync: 20 }, maxRoles: 6,
};

export function DubItemPage() {
  const { itemId = "" } = useParams();
  const { t } = useTranslation();
  const { api } = useAuth();
  const kit = useDubKit();
  const config = useDubbingConfig();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const poster = kit.usePosterUrl(itemId, Boolean(detail?.hasPoster));
  const [roles, setRoles] = useState<RolesState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [names, setNames] = useState<Partial<Record<RoleKey, string>>>({});
  const [selection, setSelection] = useState<ClipSelection | null>(null);
  const [role, setRole] = useState<RoleKey | null>(null);
  const [inSession, setInSession] = useState(false);
  const [done, setDone] = useState<TakeResult | null>(null);
  const [takes, setTakes] = useState<DubbingTake[]>([]);

  // 之前的录音:每次结束一遍录制后刷新;列表失败就不显示,不挡住选片段。
  useEffect(() => {
    let alive = true;
    listTakes(api, itemId).then(
      (rows) => { if (alive) setTakes(rows); },
      () => { if (alive) setTakes([]); },
    );
    return () => { alive = false; };
  }, [api, itemId, done]);

  const openTake = (take: DubbingTake) => {
    void getTake(api, take.id).catch(() => take).then((full) => {
      setSelection({ from: take.segFrom, to: take.segTo });
      setRole(take.role);
      setDone(reopenedResult(full));
    });
  };

  useEffect(() => {
    let alive = true;
    setFailed(null);
    void Promise.all([kit.getItem(api, itemId), getRoles(api, itemId)]).then(
      ([d, r]) => {
        if (!alive) return;
        setDetail(d);
        setRoles(r);
        setNames(Object.fromEntries(r.names.map((n) => [n.key, n.name])) as Partial<Record<RoleKey, string>>);
      },
      () => { if (alive) setFailed(t("web.dubbing.errors.notFound")); },
    );
    return () => { alive = false; };
  }, [api, kit, itemId, t]);

  const limits = useMemo(() => config?.limits ?? FALLBACK_LIMITS, [config]);
  if (config && !config.enabled) return <Navigate to="/practice" replace />;

  const rename = (key: RoleKey, name: string | null) => {
    setNames((prev) => {
      const next = { ...prev };
      if (name === null) delete next[key];
      else next[key] = name;
      return next;
    });
    void putRoles(api, itemId, { names: { [key]: name } }).catch(() => setFailed(t("web.dubbing.errors.badRoles")));
  };

  return (
    <div className="dub-root min-h-dvh px-4 pb-24 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <Link to="/dub" className="text-[13px] opacity-80">{t("web.dubbing.home.back")}</Link>
        <h1 className="max-w-[60%] truncate text-[16px] font-semibold">{detail?.title ?? ""}</h1>
        <span className="w-10" />
      </header>

      {failed ? <p role="alert" className="mb-3 text-[13px]">{failed}</p> : null}
      {!detail || !roles ? null : (
        <RoleLabels
          itemId={itemId}
          initial={roles.speakers}
          editable={roles.editable}
          suggest={config?.suggest === true}
          clip={selection && selection.to !== null ? { segFrom: selection.from, segTo: selection.to } : null}
        >
          {({ speakerOf, cycle, readOnly }) => {
            const segs: PickSeg[] = detail.segments.map((s) => ({
              idx: s.idx, startMs: s.startMs, endMs: s.endMs, speaker: speakerOf(s.idx), text: s.text,
            }));
            const readiness = clipReadiness(segs, selection, role, limits);
            if (done && selection && selection.to !== null) {
              return (
                <DubResults
                  itemId={itemId}
                  segs={segs}
                  result={done}
                  onRetry={() => { setDone(null); setInSession(true); }}
                  onExit={() => { setDone(null); setInSession(false); }}
                />
              );
            }
            if (inSession && selection && selection.to !== null && role !== null) {
              const roleName = roleLabel(t, role, names[role]);
              return (
                <DubSession
                  itemId={itemId}
                  segs={segs}
                  from={selection.from}
                  to={selection.to}
                  role={role}
                  roleName={roleName}
                  beforeMs={limits.windowBeforeMs}
                  afterMs={limits.windowAfterMs}
                  onExit={() => setInSession(false)}
                  onDone={setDone}
                />
              );
            }
            const counts = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0])) as Record<RoleKey, number>;
            if (selection && selection.to !== null) {
              for (let i = selection.from; i <= selection.to; i++) {
                const sp = segs[i]?.speaker;
                if (sp) counts[sp] += 1;
              }
            }
            return (
              <div className="space-y-4">
                <ClipPicker
                  segments={segs}
                  selection={selection}
                  role={role}
                  limits={limits}
                  poster={poster}
                  onSelect={setSelection}
                  renderMarker={(idx) => {
                    const sp = speakerOf(idx);
                    return (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => cycle(idx)}
                        aria-label={t("web.dubbing.roles.sentenceRole", {
                          n: idx + 1, role: sp ? roleLabel(t, sp, names[sp]) : t("web.dubbing.roles.unassigned"),
                        })}
                        className="flex min-h-tap min-w-[2.25rem] items-center justify-center rounded-lg bg-white/20 px-1.5 text-[12px] font-semibold"
                      >
                        {sp ? <RoleTag role={sp} custom={names[sp]} /> : "·"}
                      </button>
                    );
                  }}
                />
                <section>
                  <h2 className="mb-2 text-[14px] font-semibold">{t("web.dubbing.roles.heading")}</h2>
                  <RolePicker
                    names={names}
                    counts={counts}
                    selected={role}
                    editable={roles.locked === null && roles.editable}
                    onSelect={setRole}
                    onRename={rename}
                  />
                </section>
                <button
                  type="button"
                  disabled={!readiness.ok || role === null}
                  onClick={() => setInSession(true)}
                  className="w-full rounded-2xl bg-white/30 py-3 text-[15px] font-semibold disabled:opacity-40"
                >
                  {t("web.dubbing.clip.start")}
                </button>
                <TakeHistory takes={takes} names={names} onOpen={openTake} />
              </div>
            );
          }}
        </RoleLabels>
      )}
    </div>
  );
}
