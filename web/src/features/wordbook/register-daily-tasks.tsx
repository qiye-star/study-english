import { BookOpenIcon, CircleCheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { contribute } from "~/lib/extension-points";
import { useWordbookToday } from "./use-today";
import { useWordbookEnabled } from "./use-wordbook-config";

/**
 * 今日任务卡的「背单词」行(联动 daily_tasks,spec §6.2、INDEX R-T1)。背单词关闭、暂停或未选书(`plan` 为 null)时不出现。
 * 完成 = B 的达标口径 `goalMet`(不含加练,加练后不会退回未完成);旧服务端没有 `goal_met` 时只看新词与复习都已清零。
 * 只被 plugins/daily-tasks 导入;文案在插件 i18n(web.links.dailyTasks.*)。
 */
function WordbookTask() {
  const { t } = useTranslation();
  const enabled = useWordbookEnabled();
  const plan = useWordbookToday(enabled).today?.plan ?? null;
  if (!enabled || !plan) return null;
  const done = plan.goalMet === true || (plan.newLeft === 0 && plan.reviewLeft === 0);
  const title = t("web.links.dailyTasks.wordbook");
  const progress = `${plan.newDone + plan.reviewDone}/${plan.newTarget + plan.reviewDue}`;
  const label = done ? t("web.links.dailyTasks.doneLabel", { title }) : t("web.links.dailyTasks.todoLabel", { title, progress });
  return (
    <div data-testid="daily-task-wordbook.today" data-state={done ? "done" : "todo"}>
      <ListRow icon={<IconChip tone="teal" icon={BookOpenIcon} />}
        title={<><span aria-hidden className={done ? "text-ink-2" : undefined}>{title}</span><span className="sr-only">{label}</span></>}
        subtitle={<span className="tabular-nums">{t("web.links.dailyTasks.wordbookDetail", {
          newDone: plan.newDone, newTarget: plan.newTarget, reviewDone: plan.reviewDone, reviewDue: plan.reviewDue })}</span>}
        value={done ? undefined : <span aria-hidden className="tabular-nums">{progress}</span>}
        trailing={done ? <CircleCheckIcon aria-hidden className="size-5 flex-none text-green" /> : undefined}
        chevron={!done} to="/wordbook" />
    </div>
  );
}

contribute({ point: "dailyTasks", id: "wordbook.today", order: 10, link: "daily_tasks", component: WordbookTask });
