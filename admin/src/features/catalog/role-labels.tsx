import { useEffect, useMemo, useState } from "react";
import { useAdminSession, hasRole } from "../../api/session";
import { errorText as apiErrorText } from "../../hooks/use-async";
import { fetchRoles, putRoles, suggestRoles, type CatalogSegment, type RolesState } from "./api";
import { S, errorText } from "./strings";

/** 角色标注(plan L5 A1):句子标 A–F 或无角色;角色名 ≤ 24 字。句子与角色名是内容,不进日志、console 或错误串。 */
const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
const NAME_MAX = 24;
const SUGGEST_BATCH = 40; // the server's per-request limit (ADMIN_SUGGEST_MAX_LINES)

type Labels = Record<number, string | null>;
type Names = Record<string, string>;

function labelsOf(state: RolesState): Labels {
  const out: Labels = {};
  for (const s of state.speakers) out[s.idx] = s.speaker;
  return out;
}

function namesOf(state: RolesState): Names {
  const out: Names = {};
  for (const n of state.names) out[n.key] = n.name;
  return out;
}

/** The letter after `current` in the cycle: none, A, B … F, none. */
function nextLetter(current: string | null): string | null {
  if (current === null) return LETTERS[0];
  const at = LETTERS.indexOf(current as (typeof LETTERS)[number]);
  return at < 0 || at === LETTERS.length - 1 ? null : LETTERS[at + 1];
}

export function RoleLabels({ id, lines, onError }: { id: string; lines: CatalogSegment[]; onError: (message: string) => void }) {
  const session = useAdminSession();
  const canEdit = hasRole(session, "operator");
  const [baseline, setBaseline] = useState<RolesState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Labels>({});
  const [names, setNames] = useState<Names>({});
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = (state: RolesState) => {
    setBaseline(state);
    setLabels(labelsOf(state));
    setNames(namesOf(state));
    setDraft(null);
  };

  useEffect(() => {
    let live = true;
    fetchRoles(id)
      .then((state) => { if (live) load(state); })
      .catch((e) => { if (live) setLoadError(errorText(apiErrorText(e))); });
    return () => { live = false; };
  }, [id]);

  const changedSpeakers = useMemo(() => {
    if (!baseline) return [];
    const before = labelsOf(baseline);
    return lines.filter((l) => (labels[l.idx] ?? null) !== (before[l.idx] ?? null))
      .map((l) => ({ idx: l.idx, speaker: labels[l.idx] ?? null }));
  }, [baseline, labels, lines]);

  const changedNames = useMemo(() => {
    if (!baseline) return {} as Record<string, string | null>;
    const before = namesOf(baseline);
    const out: Record<string, string | null> = {};
    for (const letter of LETTERS) {
      const now = (names[letter] ?? "").trim();
      if (now !== (before[letter] ?? "")) out[letter] = now === "" ? null : now;
    }
    return out;
  }, [baseline, names]);

  const dirty = changedSpeakers.length > 0 || Object.keys(changedNames).length > 0;

  const count = (letter: string) => lines.filter((l) => labels[l.idx] === letter).length;

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const saved = await putRoles(id, { names: changedNames, speakers: changedSpeakers });
      load(saved);
      setNote(S.roles.saved(saved.copies));
    } catch (e) {
      onError(errorText(apiErrorText(e)));
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    setNote(null);
    const next: Record<number, string> = {};
    try {
      for (let from = 0; from < lines.length; from += SUGGEST_BATCH) {
        const to = Math.min(from + SUGGEST_BATCH, lines.length) - 1;
        const out = await suggestRoles(id, lines[from].idx, lines[to].idx);
        for (const s of out.speakers) next[s.idx] = s.speaker;
      }
      setDraft(next);
    } catch (e) {
      onError(errorText(apiErrorText(e)));
    } finally {
      setSuggesting(false);
    }
  };

  const adopt = () => {
    if (!draft) return;
    setLabels((m) => ({ ...m, ...draft }));
    setDraft(null);
  };

  if (loadError) return <p role="alert" className="text-sm text-bad">{loadError}</p>;
  if (!baseline) return <p className="text-sm text-fg-2">{S.roles.loading}</p>;

  return (
    <section className="space-y-3" aria-label={S.roles.title}>
      <h3 className="text-sm font-semibold">{S.roles.title}</h3>
      <p className="text-xs text-fg-2">{S.roles.hint}</p>
      {!canEdit && <p className="text-xs text-fg-2">{S.roles.readonly}</p>}

      <div className="grid grid-cols-2 gap-2">
        {LETTERS.map((letter) => (
          <label key={letter} className="flex items-center gap-2 text-sm">
            <span className="w-6 font-semibold">{letter}</span>
            <span className="w-14 text-xs text-fg-2">{S.roles.lines(count(letter))}</span>
            {canEdit ? (
              <input className="field-sm flex-1" aria-label={`${S.roles.name} ${letter}`} placeholder={S.roles.namePlaceholder}
                maxLength={NAME_MAX} value={names[letter] ?? ""} disabled={busy}
                onChange={(e) => setNames((m) => ({ ...m, [letter]: e.target.value }))} />
            ) : (
              <span className="flex-1 truncate">{names[letter] ?? ""}</span>
            )}
          </label>
        ))}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={busy || suggesting || lines.length === 0} onClick={suggest}>
            {suggesting ? S.roles.suggesting : S.roles.suggest}
          </button>
          {draft && (
            <>
              <span className="text-xs text-fg-2">{S.roles.draft(Object.keys(draft).length)}</span>
              <button type="button" className="btn-primary btn-sm" onClick={adopt}>{S.roles.adopt}</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft(null)}>{S.roles.discard}</button>
            </>
          )}
          <button type="button" className="btn-primary btn-sm" disabled={busy || !dirty} onClick={save}>
            {busy ? S.roles.saving : S.roles.save}
          </button>
          {!dirty && <span className="text-xs text-fg-2">{S.roles.nothingChanged}</span>}
        </div>
      )}
      {note && <p className="text-xs text-fg-2">{note}</p>}

      <ol className="space-y-1">
        {lines.map((line) => {
          const letter = labels[line.idx] ?? null;
          const suggested = draft?.[line.idx];
          return (
            <li key={line.idx} className="flex items-center gap-2 text-sm">
              <span className="w-8 shrink-0 text-xs text-fg-2">{line.idx + 1}</span>
              {canEdit ? (
                <button type="button" className="btn-ghost btn-sm w-10 shrink-0" disabled={busy}
                  onClick={() => setLabels((m) => ({ ...m, [line.idx]: nextLetter(letter) }))}>
                  {letter ?? S.roles.none}
                </button>
              ) : (
                <span className="w-10 shrink-0 text-center font-semibold">{letter ?? S.roles.none}</span>
              )}
              {suggested && suggested !== letter && <span className="text-xs italic text-fg-2">{suggested}</span>}
              <span className="flex-1 truncate">{line.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
