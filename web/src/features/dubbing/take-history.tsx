import "./locales";
import { useTranslation } from "react-i18next";
import type { DubbingTake, RoleKey } from "./dubbing-api";
import { RoleTag } from "./role-identity";
import type { TakeResult } from "./take-runner";

/**
 * 打开旧录音的结果:服务端记录里已经有分数与逐句结果。本机的「我的」录音不会留下来,所以结果页里的「我的」按钮保持禁用。
 */
export function reopenedResult(take: DubbingTake): TakeResult {
  return { take, outcomes: [], urls: new Map() };
}

/** 本人之前的录音(服务端 `GET /api/dubbing/items/{id}/takes`,最近 20 条)。只列出已完成的可以打开。 */
export function TakeHistory({
  takes, names, onOpen,
}: {
  takes: readonly DubbingTake[];
  /** 用户保存的角色名(没有就用默认名)。 */
  names?: Partial<Record<RoleKey, string>>;
  onOpen(take: DubbingTake): void;
}) {
  const { t } = useTranslation();
  if (takes.length === 0) return null;
  return (
    <section aria-label={t("web.dubbing.takes.title")} className="space-y-2">
      <h2 className="text-[14px] font-semibold">{t("web.dubbing.takes.title")}</h2>
      <ul className="space-y-1.5">
        {takes.map((take) => (
          <li key={take.id} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-[13px]">
            <RoleTag role={take.role} custom={names?.[take.role]} />
            <span className="flex-1 opacity-80">{new Date(take.createdAt).toLocaleString()}</span>
            {take.status === "done" ? (
              <>
                {take.totalScore !== null ? (
                  <span className="tabular-nums">{t("web.dubbing.takes.score", { score: Math.round(take.totalScore) })}</span>
                ) : null}
                <button type="button" onClick={() => onOpen(take)} className="rounded-lg bg-white/15 px-3 py-1">
                  {t("web.dubbing.takes.open")}
                </button>
              </>
            ) : (
              <span className="opacity-70">{t("web.dubbing.takes.unfinished")}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
