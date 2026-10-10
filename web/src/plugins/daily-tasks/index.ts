// 联动插件 2 今日任务聚合卡(spec §6.2):卡片本身 + 四个 feature 提供方(各自在 feature 的 register-daily-tasks 里登记行)。
import "~/features/wordbook/register-daily-tasks";
import "~/features/practice/register-daily-tasks";
import "~/features/chat/register-daily-tasks";
import "~/features/rank/register-daily-tasks";
import { contribute } from "~/lib/extension-points";
import { DailyTasksCard } from "./daily-tasks-card";

contribute({ point: "practiceHome", id: "daily-tasks.card", link: "daily_tasks", component: DailyTasksCard });
