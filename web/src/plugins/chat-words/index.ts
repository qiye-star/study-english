// 联动插件 5 对话用到今日词(spec §6.5):今日任务卡里的一行 + 词卡小标。两个组件都很轻,不懒加载。
import { contribute } from "~/lib/extension-points";
import { ChatWordsTask } from "./chat-words-task";
import { ChatWordsUsedBadge } from "./used-badge";

contribute({ point: "dailyTasks", id: "chat-words.task", order: 50, link: "chat_words", component: ChatWordsTask });
contribute({ point: "wordDetailSections", id: "chat-words.badge", link: "chat_words", component: ChatWordsUsedBadge });
