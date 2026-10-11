import type { TFunction } from "i18next";
import { CircleCheckIcon, TrophyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { contribute } from "~/lib/extension-points";
import { fetchRankConfig, type StageTask } from "./rank-api";
import { loadRankMe } from "./rank-me";

/** `/api/rank/me` 会触发同步:同一个 ApiClient 30 秒内复用一次结果(spec §6.2)。段位关或失败 → null。 */
const REUSE_MS = 30_000;
const cache = new WeakMap<ApiClient, { at: number; promise: Promise<StageTask[] | null> }>();

function stageTasks(api: ApiClient, t: TFunction): Promise<StageTask[] | null> {
  const hit = cache.get(api);
  if (hit && Date.now() - hit.at < REUSE_MS) return hit.promise;
  // loadRankMe:新成就只返回一次,谁先拉到谁提示(同练习页的段位卡)
  const promise = fetchRankConfig(api)
    .then((c) => (c.enabled ? loadRankMe(api, t).then((me) => me.stageTasks) : null))
    .catch((): null => {
      if (cache.get(api)?.promise === promise) cache.delete(api); // 一次失败不缓存
      return null;
    });
  cache.set(api, { at: Date.now(), promise });
  return promise;
}

/**
 * 今日任务卡的「段位阶段任务」行(联动 daily_tasks,spec §6.2):全部阶段任务完成即完成;段位关闭或没有阶段任务时不出现。
 * 只被 plugins/daily-tasks 导入;文案在插件 i18n(web.links.dailyTasks.*)。
 */
function RankTask() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [tasks, setTasks] = useState<StageTask[] | null>(null);
  useEffect(() => {
    let alive = true;
    void stageTasks(api, tRef.current).then((value) => { if (alive) setTasks(value); });
    return () => { alive = false; };
  }, [api]);
  if (!tasks || tasks.length === 0) return null;
  const doneCount = tasks.filter((x) => x.complete).length;
  const done = doneCount === tasks.length;
  const title = t("web.links.dailyTasks.rank");
  const progress = `${doneCount}/${tasks.length}`;
  const label = done ? t("web.links.dailyTasks.doneLabel", { title }) : t("web.links.dailyTasks.todoLabel", { title, progress });
  return (
    <div data-testid="daily-task-rank.stage" data-state={done ? "done" : "todo"}>
      <ListRow icon={<IconChip tone="amber" icon={TrophyIcon} />}
        title={<><span aria-hidden className={done ? "text-ink-2" : undefined}>{title}</span><span className="sr-only">{label}</span></>}
        subtitle={<span className="tabular-nums">{t("web.links.dailyTasks.rankDetail", { done: doneCount, total: tasks.length })}</span>}
        value={done ? undefined : <span aria-hidden className="tabular-nums">{progress}</span>}
        trailing={done ? <CircleCheckIcon aria-hidden className="size-5 flex-none text-green" /> : undefined}
        chevron={!done} to="/rank" />
    </div>
  );
}

contribute({ point: "dailyTasks", id: "rank.stage", order: 40, link: "daily_tasks", component: RankTask });
