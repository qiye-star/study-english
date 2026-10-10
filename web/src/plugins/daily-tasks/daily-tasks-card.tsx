import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { SurfaceCard } from "~/components/surface-card";
import type { TodayCounts } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { fetchTodayCounts } from "./today-api";

interface Tally { done: number; total: number }

function tally(list: HTMLElement): Tally {
  const rows = [...list.querySelectorAll("[data-testid^=daily-task-]")];
  return { done: rows.filter((r) => r.getAttribute("data-state") === "done").length, total: rows.length };
}

/**
 * practiceHome 贡献(`daily_tasks`,spec §6.2):标题「今日任务」+「n/m 完成」,行来自 `dailyTasks` 插槽(各 feature 的提供方)。
 * 提供方各自取数、不向卡片回报:卡片观察行容器里 `[data-testid^=daily-task-]` 的 `data-state` 重新计数;没有行时整卡隐藏。
 */
export function DailyTasksCard() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const titleId = useId();
  const [today, setToday] = useState<TodayCounts | null>(null);
  const [count, setCount] = useState<Tally>({ done: 0, total: 0 });
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchTodayCounts(api, undefined, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setToday(value); },
      (): void => undefined, // 失败:依赖它的行显示「—」
    );
    return () => controller.abort();
  }, [api]);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const recount = () => {
      const next = tally(el);
      setCount((prev) => (prev.done === next.done && prev.total === next.total ? prev : next));
    };
    recount();
    const observer = new MutationObserver(recount);
    observer.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
    return () => observer.disconnect();
  }, []);

  return (
    <SurfaceCard as="section" aria-labelledby={titleId} data-testid="daily-tasks-card" hidden={count.total === 0}
      className="mt-2 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 pb-1 pt-3">
        <h2 id={titleId} className="text-body font-semibold tracking-heading text-ink">{t("web.links.dailyTasks.title")}</h2>
        <span className="text-meta tabular-nums text-ink-2">{t("web.links.dailyTasks.done", { done: count.done, total: count.total })}</span>
      </div>
      <div ref={list} className="divide-y-[0.5px] divide-hair-2">
        <Slot point="dailyTasks" props={{ today }} />
      </div>
    </SurfaceCard>
  );
}
