# web/src/plugins/pron-shadow/

发音弱词 ↔ 跟读(spec §6.4,视觉稿帧 01 来源条、帧 04 弱词页):跟读来源条两片、今日新词例句面板、生词本入口、弱词页。
服务端 `server/app/links/pron_shadow.py`(`/api/links/weak-words`、`/weak-words/dismiss`、`/today-words`)。

## What lives here
- `pron-api.ts`:`WeakWordItem`、`WeakWordsPage`、`TodayWord`、`fetchWeakWords`、`dismissWeakWord`、`fetchTodayWords`(带本地 `offset`)
- `sources-strip.tsx`:`learningSources` 两个独立贡献 `pron.weak`(琥珀链接片 → `/links/weak-words`)与 `pron.today`(青按钮片,
  打开懒加载的 `today-words-sheet.tsx`,点例句 `pick(example.en)`);没有内容或请求失败 → `null`
- `weak-words-row.tsx`:`notebookViews/pron.row`(order 20,易错词之后)
- `weak-words-page.tsx`:路由 `/links/weak-words`(懒加载);「跟读」/「连读这 5 个」= `navigate("/practice", { state: { reference } })`
- `index.ts`:登记(全部 `link: "pron_shadow"`);`i18n/`:`web.links.pron.*`

## Allowed dependencies
同 `../CLAUDE.md`;`LINKS_SERVER_ERRORS` 取自 `~/plugins/links/links-api`;测试里经 `~/features/practice`(index)渲染练习页。

## Test
`cd web && yarn vitest run src/plugins/pron-shadow`(含 `pron-shadow-contract.test.ts`,读
`server/tests/fixtures/links_pron_shadow_contract.json`;`practice-integration.test.tsx` 走真实练习页)。测试自己 `import "./index"`
并 `setLinkFlags(...)`。

## Pitfalls
- 本插件从不发评测请求:跟读仍走练习页现有评测接口与配额(xfyun),这里只交参考文本。
- 弱词只来自跟读评测(`source="practice"`);聊天 / 语音对话的低分词不算(所有者裁定,L-R3)。
- 联动关闭时贡献不渲染也不取数,跟读区与今天完全一样(`practice-integration.test.tsx` 断言)。
- 视觉稿里的「拼写」按钮未做:接口不返回「词是否在当前词书」(计划 L4 接口未包含);词卡入口由 L1 的单词操作提供。
