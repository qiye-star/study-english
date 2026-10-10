import { CircleCheckIcon, MessagesSquareIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { contribute, type PointProps } from "~/lib/extension-points";

/**
 * 今日任务卡的「对话一次」行(联动 daily_tasks,spec §6.2):今天在对话里发过 ≥ 1 条消息即完成;点按进 /chat。
 * 只被 plugins/daily-tasks 导入;文案在插件 i18n(web.links.dailyTasks.*)。
 */
function TalkTask({ today }: PointProps["dailyTasks"]) {
  const { t } = useTranslation();
  const count = today?.chatMessagesToday ?? null;
  const done = count !== null && count >= 1;
  const title = t("web.links.dailyTasks.talk");
  const progress = count === null ? "—" : `${Math.min(count, 1)}/1`;
  const label = done ? t("web.links.dailyTasks.doneLabel", { title }) : t("web.links.dailyTasks.todoLabel", { title, progress });
  return (
    <div data-testid="daily-task-chat.talk" data-state={done ? "done" : "todo"}>
      <ListRow icon={<IconChip tone="blue" icon={MessagesSquareIcon} />}
        title={<><span aria-hidden className={done ? "text-ink-2" : undefined}>{title}</span><span className="sr-only">{label}</span></>}
        subtitle={done ? t("web.links.dailyTasks.talkDetail", { count }) : undefined}
        value={done ? undefined : <span aria-hidden className="tabular-nums">{progress}</span>}
        trailing={done ? <CircleCheckIcon aria-hidden className="size-5 flex-none text-green" /> : undefined}
        chevron={!done} to="/chat" />
    </div>
  );
}

contribute({ point: "dailyTasks", id: "chat.talk", order: 30, link: "daily_tasks", component: TalkTask });
