import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { LevelHint } from "~/components/level-hint";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { levelLabel } from "~/lib/levels";
import {
  CORRECTIONS, LEVELS, MEMORY_SERVER_ERRORS, PROFILE_KEYS, fetchProfile, patchProfile, type Profile, type ProfileKey,
  type ProfileValues,
} from "./memory-api";
import { ErrorNote, Loading } from "./status";
import { FIELD, GHOST, NOTE, PRIMARY } from "./ui";
import { useLoad } from "./use-load";

type Draft = Record<ProfileKey, string>;
const SPLIT = /[,,、;;]/;
const list = (value: string) => value.split(SPLIT).map((s) => s.trim()).filter(Boolean);
const P = "web.agents.memory.profile";

const toDraft = (p: Profile): Draft => ({
  level: p.level ?? "", goals: (p.goals ?? []).join(", "), interests: (p.interests ?? []).join(", "),
  native: p.native ?? "", correction: p.correction ?? "", schedule: p.schedule ?? "",
});

/** 与当前档案相比改了哪些键;清空 = null(服务端删除该键并记为「你改过」)。 */
export function changedValues(draft: Draft, profile: Profile): ProfileValues {
  const next: Record<ProfileKey, unknown> = {
    level: draft.level || null, goals: list(draft.goals), interests: list(draft.interests),
    native: draft.native.trim() || null, correction: draft.correction || null, schedule: draft.schedule.trim() || null,
  };
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    const after = Array.isArray(next[key]) && (next[key] as unknown[]).length === 0 ? null : next[key];
    if (JSON.stringify(profile[key] ?? null) !== JSON.stringify(after)) out[key] = after;
  }
  return out as ProfileValues;
}

export function ProfileTab() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { data, setData, error, retry } = useLoad((signal) => fetchProfile(api, signal), [api]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { if (data) setDraft(toDraft(data.profile)); }, [data]);

  if (error) return <ErrorNote message={translateServerError(t, error, MEMORY_SERVER_ERRORS)} onRetry={retry} />;
  if (!data || !draft) return <Loading />;
  const state = data;
  const changes = changedValues(draft, state.profile);
  const dirty = Object.keys(changes).length > 0;
  const label = (key: ProfileKey) => t(`${P}.${key}`);
  const show = (key: ProfileKey, value: unknown) =>
    key === "correction" ? t(`${P}.corrections.${String(value)}`) : key === "level" ? levelLabel(t, value) : Array.isArray(value) ? value.join(", ") : String(value);

  const send = async (input: Parameters<typeof patchProfile>[1], done: string) => {
    setBusy(true);
    setStatus(null);
    try {
      setData(await patchProfile(api, input));
      setStatus(done);
    } catch (err) {
      setStatus(translateServerError(t, err, MEMORY_SERVER_ERRORS));
    } finally {
      setBusy(false);
    }
  };
  const set = (key: ProfileKey) => (event: { target: { value: string } }) => setDraft({ ...draft, [key]: event.target.value });
  const field = (key: ProfileKey, control: ReactNode) => (
    <label key={key} className="block">
      <span className="mb-1 flex flex-wrap items-center gap-2 text-sub font-medium text-ink-2">
        {label(key)}
        {state.editedKeys.includes(key) ? <ToneBadge tone="gray">{t(`${P}.edited`)}</ToneBadge> : null}
      </span>
      {control}
    </label>
  );
  const proposals = PROFILE_KEYS.filter((key) => state.proposals[key] !== undefined);

  return (
    <div className="flex flex-col gap-3">
      {proposals.map((key) => (
        <SurfaceCard key={key} data-testid={`proposal-${key}`} className="flex flex-col gap-2 bg-amber-tint p-3.5">
          <p className="break-words text-sub text-amber">
            {t(`${P}.proposal`, { field: label(key), value: show(key, state.proposals[key]) })}
          </p>
          <div className="flex gap-2">
            <button type="button" className={`${GHOST} h-tap flex-1`} disabled={busy}
              onClick={() => void send({ values: { [key]: state.proposals[key] } as ProfileValues }, t(`${P}.saved`))}>
              {t(`${P}.accept`)}
            </button>
            <button type="button" className={`${GHOST} h-tap flex-1`} disabled={busy}
              onClick={() => void send({ dismiss: [key] }, t(`${P}.dismissed`))}>
              {t(`${P}.dismiss`)}
            </button>
          </div>
        </SurfaceCard>
      ))}
      <SurfaceCard className="flex flex-col gap-3 p-3.5">
        {field("level", (
          <>
            <select className={FIELD} value={draft.level} onChange={set("level")} aria-describedby="profile-level-hint">
              <option value="">{t(`${P}.unset`)}</option>
              {LEVELS.map((level) => <option key={level} value={level}>{levelLabel(t, level)}</option>)}
            </select>
            <LevelHint code={draft.level} fallback={t("web.level.scale")} id="profile-level-hint" testId="profile-level-hint" className="mt-1" />
          </>
        ))}
        {field("goals", <input className={FIELD} value={draft.goals} placeholder={t(`${P}.listHint`)} onChange={set("goals")} />)}
        {field("interests", <input className={FIELD} value={draft.interests} placeholder={t(`${P}.listHint`)} onChange={set("interests")} />)}
        {field("native", <input className={FIELD} value={draft.native} maxLength={20} onChange={set("native")} />)}
        {field("correction", (
          <select className={FIELD} value={draft.correction} onChange={set("correction")}>
            <option value="">{t(`${P}.unset`)}</option>
            {CORRECTIONS.map((c) => <option key={c} value={c}>{t(`${P}.corrections.${c}`)}</option>)}
          </select>
        ))}
        {field("schedule", <input className={FIELD} value={draft.schedule} maxLength={40} onChange={set("schedule")} />)}
      </SurfaceCard>
      <p className={NOTE}>{t(`${P}.help`)}</p>
      <button type="button" className={`${PRIMARY} h-11`} disabled={!dirty || busy}
        onClick={() => void send({ values: changes }, t(`${P}.saved`))}>
        {t(`${P}.save`)}
      </button>
      <p role="status" aria-live="polite" className={NOTE}>{status ?? ""}</p>
    </div>
  );
}
