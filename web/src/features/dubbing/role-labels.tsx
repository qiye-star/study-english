import "./locales";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { isAiLimited, isAiUnavailable, putRoles, ROLE_KEYS, type RoleKey, type SpeakerEntry, suggestRoles } from "./dubbing-api";

/** 角色改动的合并保存时间(计划 L5 W8:防抖 600 ms,离开页面前提交)。 */
export const SAVE_DEBOUNCE_MS = 600;

/** 角色循环:无 → A → B → … → F → 无。 */
export function nextRole(current: RoleKey | null): RoleKey | null {
  if (current === null) return ROLE_KEYS[0];
  const i = ROLE_KEYS.indexOf(current);
  return i + 1 < ROLE_KEYS.length ? ROLE_KEYS[i + 1] : null;
}

export interface RoleLabelsApi {
  speakerOf(idx: number): RoleKey | null;
  cycle(idx: number): void;
  readOnly: boolean;
}

/**
 * 句子的角色标注(计划 L5 W8):循环改角色、防抖合并保存、AI 建议只是草稿(用户采用后才进入保存)。
 * 精选副本(editable=false)只读:不能循环,也没有建议按钮。
 */
export function RoleLabels({
  itemId, initial, editable, suggest, clip, children,
}: {
  itemId: string;
  initial: SpeakerEntry[];
  editable: boolean;
  suggest: boolean;
  clip: { segFrom: number; segTo: number } | null;
  children(api: RoleLabelsApi): ReactNode;
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [speakers, setSpeakers] = useState<Record<number, RoleKey | null>>(() =>
    Object.fromEntries(initial.map((s) => [s.idx, s.speaker])));
  const [draft, setDraft] = useState<Record<number, RoleKey> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 最新值放在 ref 里,保存与卸载时读取(不闭包旧状态)。
  const latest = useRef(speakers);
  latest.current = speakers;
  const dirty = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deps = useRef({ api, itemId });
  deps.current = { api, itemId };
  const failedText = useRef(t("web.dubbing.errors.badRoles"));
  failedText.current = t("web.dubbing.errors.badRoles");

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const ids = [...dirty.current];
    if (ids.length === 0) return;
    dirty.current.clear();
    const body = ids.sort((a, b) => a - b).map((idx) => ({ idx, speaker: latest.current[idx] ?? null }));
    void putRoles(deps.current.api, deps.current.itemId, { speakers: body }).catch(() => setError(failedText.current));
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // 离开页面前提交,不丢最后一次改动。
  useEffect(() => () => flush(), [flush]);

  const readOnly = !editable;

  const cycle = (idx: number) => {
    if (readOnly) return;
    setSpeakers((prev) => ({ ...prev, [idx]: nextRole(prev[idx] ?? null) }));
    dirty.current.add(idx);
    schedule();
  };

  const runSuggest = async () => {
    if (!clip) return;
    setBusy(true);
    setError(null);
    try {
      const r = await suggestRoles(api, itemId, clip);
      const next: Record<number, RoleKey> = {};
      for (const s of r.speakers) if (s.speaker) next[s.idx] = s.speaker;
      setDraft(next);
    } catch (err) {
      setError(isAiLimited(err)
        ? t("web.dubbing.errors.aiUserCap")
        : isAiUnavailable(err) ? t("web.dubbing.errors.aiUnavailable") : t("web.dubbing.errors.unknown"));
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    if (!draft) return;
    setSpeakers((prev) => {
      const merged = { ...prev };
      for (const [idx, role] of Object.entries(draft)) {
        merged[Number(idx)] = role;
        dirty.current.add(Number(idx));
      }
      return merged;
    });
    setDraft(null);
    schedule();
  };

  return (
    <div>
      {readOnly ? <p className="mb-2 text-[13px] opacity-80">{t("web.dubbing.labels.readOnly")}</p> : null}
      {!readOnly && suggest && clip ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void runSuggest()}
          className="mb-2 rounded-xl bg-white/15 px-3 py-1.5 text-[13px]"
        >
          {t("web.dubbing.labels.suggest")}
        </button>
      ) : null}
      {draft ? (
        <div role="status" className="mb-2 rounded-xl bg-white/10 p-3 text-[13px]">
          <p>{t("web.dubbing.labels.draft", { count: Object.keys(draft).length })}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={accept} className="rounded-lg bg-white/25 px-3 py-1">{t("web.dubbing.labels.accept")}</button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-1">{t("web.dubbing.labels.discard")}</button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mb-2 text-[13px]">{error}</p> : null}
      {children({
        speakerOf: (idx) => speakers[idx] ?? null,
        cycle,
        readOnly,
      })}
    </div>
  );
}
