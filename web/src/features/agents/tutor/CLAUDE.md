# web/src/features/agents/tutor/

「带我学」UI(plan `docs/superpowers/plans/2026-10-12-agents-tutor.md` W1–W7)。整块懒加载:对话页只经 `agents/chat-parts.tsx` 的 `TUTOR_SLOTS`(各一行 `lazy(import())`)接入。

## What lives here
- `tutor-api.ts`(类型、REST 调用、`TUTOR_SERVER_ERRORS`)、`tutor-model.ts`(纯函数:`parseTutorMeta`、`applyMeta`、`scoreBars`、`needsAgentTurn`)
- `use-tutor-session.ts`(按对话页给的会话 id 取会话,回合 `meta` 推进本地副本,提示 / 跳过 / 结束,最后一题答完自动结束一次)
- `tutor-start-sheet.tsx`(`TutorStartSheet` = `TUTOR_SLOTS.StartSheet`,含 `POST /start`;`TutorStartSheetView` 是纯展示)
- `tutor-bar.tsx`(`TutorBar` 纯展示)、`tutor-bar-panel.tsx`(`TutorBarPanel` = `TUTOR_SLOTS.Bar`:带学条 + 总结抽屉)、`tutor-recap-card.tsx`
- `locales.ts` + `locales/{en,zh-CN}.json`(`web.agents.tutor.*`,经 `registerAgentsLocales` 并入;不在主包的 `**/i18n/*.json` glob 里)
- `tutor-fixtures.ts`(测试数据,生产代码不导入)

## Allowed dependencies
`lib/`、`api/`、`components/`、`auth/`、`@renderer/*`、本目录文件,以及 `../locales`(文案注册入口)。不导入别的 feature、不导入 agents 的其他文件:
单词只经 `<WordActions>`(`~/lib/extension-points-react`)进生词本,从不导入 `features/vocabulary` / `features/wordbook`(`src/architecture.test.ts`)。

## Test
`cd web && yarn vitest run src/features/agents/tutor src/features/chat/conversation-page.agent.test.tsx src/architecture.test.ts`
`tutor-contract.test.ts` 逐键核对服务端 `server/tests/fixtures/agents_tutor_contract.json`。

## Pitfalls
- 对话页持有导师状态(会话 id + 最近一次 meta);面板不自己发回合。要智能体开口时调 `onContinue()`(对话页发 `text = null`、`mode = "tutor"` 的回合)。
- `text = null` 只在阶段 `opening` / `ask` 合法:续上等待回答的会话 `speakFirst = false`,不要再发。
- 语音回答复用对话页「按住说话 → 转写」,转写文字就是回合文本;面板从不录音。
- 总结抽屉关闭才调 `onEnd()`(对话页退出导师模式),这样总结可见期间不会在已结束的会话上再发回合。
- 服务端 `meta` 省略 null 键:一律经 `parseTutorMeta`,缺省当作 null。
- 回答、题目、提示、词不进 URL、日志、错误对象;不自动重试。
