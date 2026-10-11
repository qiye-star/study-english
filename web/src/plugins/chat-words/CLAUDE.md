# web/src/plugins/chat-words/

对话用到今日词(spec `docs/superpowers/specs/2026-10-11-learning-links-design.md` §6.5;计划 L5-3)。服务端在
`server/app/links/chat_words.py` 按词形还原检测(无大模型);本目录只展示结果。

## What lives here
- `index.ts`:登记 `dailyTasks/chat-words.task`(order 50)与 `wordDetailSections/chat-words.badge`,都 `link: "chat_words"`
- `chat-words-api.ts`:`fetchChatWords(api, signal?)`(`GET /api/links/chat-words?offset=`,同一 ApiClient 30 秒复用、失败不缓存)、
  `useChatWords()`(加载中 / 失败 = `null`)
- `chat-words-task.tsx`:任务行「对话用今日词 used/target」,目标 `min(3, 今日词数)`,今日词为 0 不渲染;`to="/chat"`;
  行外包 `data-testid="daily-task-chat-words.task"` + `data-state="done"|"todo"`(今日任务卡按它计数)
- `used-badge.tsx`:词卡青色小标「今天在对话里用过」
- `i18n/`:`web.links.chatWords.*`

## Allowed dependencies
同 `../CLAUDE.md`(`lib/`、`api/`、`auth/`、`components/`、`i18n/`);不导入任何 feature。

## Test
`cd web && yarn vitest run src/plugins/chat-words`;测试 `import "./index"` 并 `setLinkFlags(...)`;
`chat-words-contract.test.ts` 核对 `server/tests/fixtures/links_chat_words_contract.json`。

## Pitfalls
- `dailyTasks` 插槽由今日任务卡(`plugins/daily-tasks`,L2)渲染,所以任务行实际需要 `daily_tasks` 与 `chat_words` 都开。
- 今日词是滚动 24 小时内的 `learn`(不含 `relearn`),与本地日无关;`offset` 参数只为将来预留。
- 失败一律静默(不 toast):联动是尽力而为。
