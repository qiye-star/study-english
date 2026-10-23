// 核心贡献(= 全关时的今天):加入生词本、选词朗读、更新日志入口。test/setup.ts 也导入本文件。
import "~/features/vocabulary/register";
import "~/features/chat/register-selection-actions";
import "~/features/changelog/register"; // 练习页顶栏的「更新日志」入口(计划 2026-10-14-changelog)
import "~/features/chat/register-chat-home"; // 对话主页的「打开」检测(计划 2026-10-23-chat-home-daily-greeting-web FR10)
import "~/features/dubbing/register"; // 练习首页的「影视配音」入口卡(计划 L5 R16,核心贡献:配置关闭时卡片不渲染)
