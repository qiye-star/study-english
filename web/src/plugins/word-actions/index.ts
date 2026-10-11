// 联动插件 1 单词操作位置(spec §6.1):「更多」按钮 + 面板里三个模块登记的四行。
import "~/features/vocabulary/register-word-actions";
import "~/features/wordbook/register-word-actions";
import "~/features/practice/register-word-actions";
import { contribute } from "~/lib/extension-points";
import { MoreWordActions } from "./more-button";

contribute({ point: "wordActions", id: "word-actions.more", order: 100, link: "word_actions", component: MoreWordActions });
