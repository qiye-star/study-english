import { CheckIcon, MessageSquareTextIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { useChatWords } from "./chat-words-api";

export const TASK_TARGET_MAX = 3;

/**
 * dailyTasks 贡献(link: chat_words):「对话用今日词 used/target」,目标 = min(3, 今日词数);今日词为 0 时不渲染
 * (spec §6.2 表格)。外观同今日任务卡的其他行:完成 = 尾部绿色对勾 + ink-2 标题。
 */
export function ChatWordsTask() {
  const { t } = useTranslation();
  const data = useChatWords();
  if (!data || data.today.length === 0) return null;
  const target = Math.min(TASK_TARGET_MAX, data.today.length);
  const used = Math.min(data.usedCount, target);
  const done = data.usedCount >= target;
  const title = t("web.links.chatWords.task");
  return (
    <div data-testid="daily-task-chat-words.task" data-state={done ? "done" : "todo"}>
      <ListRow
        icon={<IconChip tone="teal" icon={MessageSquareTextIcon} />}
        title={<span className={done ? "text-ink-2" : undefined}>{title}</span>}
        subtitle={t("web.links.chatWords.taskDetail", { used, target })}
        to="/chat"
        trailing={done ? (
          <span className="flex flex-none items-center text-green">
            <CheckIcon role="img" aria-label={t("web.links.chatWords.done")} className="h-[18px] w-[18px]" />
          </span>
        ) : undefined}
      />
    </div>
  );
}
