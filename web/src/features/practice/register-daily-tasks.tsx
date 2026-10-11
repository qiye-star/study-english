import { CircleCheckIcon, MicIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { contribute, type PointProps } from "~/lib/extension-points";

/**
 * 今日任务卡的「跟读一句」行(联动 daily_tasks,spec §6.2):今天在练习页跟读过 ≥ 1 句即完成;点按滚到跟读区。
 * 只被 plugins/daily-tasks 导入;文案在插件 i18n(web.links.dailyTasks.*)。
 */
function ShadowTask({ today }: PointProps["dailyTasks"]) {
  const { t } = useTranslation();
  const count = today?.practiceToday ?? null;
  const done = count !== null && count >= 1;
  const title = t("web.links.dailyTasks.shadow");
  const progress = count === null ? "—" : `${Math.min(count, 1)}/1`;
  const label = done ? t("web.links.dailyTasks.doneLabel", { title }) : t("web.links.dailyTasks.todoLabel", { title, progress });
  // 链接到 /practice#shadowing(路由不会自己滚动):外层接住点按,把跟读区滚进视口
  const scroll = () => document.getElementById("shadowing")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  return (
    <div data-testid="daily-task-practice.shadow" data-state={done ? "done" : "todo"} onClick={scroll}>
      <ListRow icon={<IconChip tone="blue" icon={MicIcon} />}
        title={<><span aria-hidden className={done ? "text-ink-2" : undefined}>{title}</span><span className="sr-only">{label}</span></>}
        subtitle={done ? t("web.links.dailyTasks.shadowDetail", { count }) : undefined}
        value={done ? undefined : <span aria-hidden className="tabular-nums">{progress}</span>}
        trailing={done ? <CircleCheckIcon aria-hidden className="size-5 flex-none text-green" /> : undefined}
        chevron={!done} to="/practice#shadowing" />
    </div>
  );
}

contribute({ point: "dailyTasks", id: "practice.shadow", order: 20, link: "daily_tasks", component: ShadowTask });
