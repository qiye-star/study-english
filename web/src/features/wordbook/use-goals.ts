import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { previewPlan } from "./goals-math";
import {
  WORDBOOK_SERVER_ERRORS, grantBonus, patchEnrollment, pauseEnrollment, resetProgress, resumeEnrollment,
  type BookId, type GoalLimits, type GoalsPatch, type Today,
} from "./wordbook-api";

/** 乐观更新(GP-4):把 patch 套到 today 上并用 previewPlan 重算今天;服务端结果回来后 reload 覆盖。 */
export function optimistic(today: Today, patch: GoalsPatch, limits: GoalLimits): Today {
  if (!today.enrollment || !today.plan) return today;
  const unlimited = patch.reviewUnlimited === true ? true : patch.reviewCap !== undefined ? false : today.enrollment.reviewUnlimited;
  const enrollment = {
    ...today.enrollment,
    dailyNew: patch.dailyNew ?? today.enrollment.dailyNew,
    reviewCap: unlimited ? 0 : patch.reviewCap ?? today.enrollment.reviewCap,
    reviewUnlimited: unlimited,
    orderMode: patch.orderMode ?? today.enrollment.orderMode,
  };
  const plan = previewPlan({
    dailyNew: enrollment.dailyNew, reviewCap: unlimited ? null : enrollment.reviewCap, newDone: today.plan.newDone,
    reviewDone: today.plan.reviewDone, reviewDue: today.plan.reviewDue, bonus: today.plan.bonus,
    guardThreshold: limits.reviewCap.max, remaining: today.progress?.remaining ?? null,
  });
  return { ...today, enrollment, plan };
}

type Busy = null | "bonus" | "pause" | "resume" | "reset";

/**
 * 面板与首页共用的变更(spec §12.2)。只有 patch 乐观更新;每次 patch 带递增序号,只有最后一次的成功 / 失败改状态
 * (失败退回该次改动前的快照)。不依赖「已挂载」标记,StrictMode 的双挂载不影响它。
 */
export function useGoals({ today, setToday, reload, limits }: {
  today: Today | null;
  setToday: (today: Today) => void;
  reload: () => void;
  limits: GoalLimits;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const seq = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const explain = useCallback((err: unknown) => setError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS)), [t]);

  const patch = useCallback(async (input: GoalsPatch): Promise<boolean> => {
    if (!today?.enrollment) return false;
    const before = today;
    const id = ++seq.current;
    setToday(optimistic(today, input, limits));
    setSaving(true);
    setError(null);
    try {
      await patchEnrollment(api, input);
      if (id === seq.current) reload();
      return true;
    } catch (err) {
      if (id === seq.current) {
        setToday(before);
        explain(err);
      }
      return false;
    } finally {
      if (id === seq.current) setSaving(false);
    }
  }, [api, today, setToday, reload, limits, explain]);

  const run = useCallback(async <T,>(kind: Exclude<Busy, null>, call: () => Promise<T>): Promise<T | null> => {
    setBusy(kind);
    setError(null);
    try {
      const value = await call();
      reload();
      return value;
    } catch (err) {
      explain(err);
      return null;
    } finally {
      setBusy(null);
    }
  }, [reload, explain]);

  return {
    saving, error, busy, patch,
    bonus: (size: number) => run("bonus", () => grantBonus(api, size)),
    pause: () => run("pause", () => pauseEnrollment(api)),
    resume: (bookId: BookId) => run("resume", () => resumeEnrollment(api, bookId)),
    reset: (bookId: BookId, confirm: string) => run("reset", () => resetProgress(api, bookId, confirm)),
  };
}

export type GoalsApi = ReturnType<typeof useGoals>;
