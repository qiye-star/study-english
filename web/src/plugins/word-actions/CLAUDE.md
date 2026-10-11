# web/src/plugins/word-actions/

单词操作位置(spec §6.1,联动键 `word_actions`):核心「加入词汇本」按钮旁的「更多」与「单词操作」面板。

## What lives here
- `index.ts`:导入三个 feature 的 `register-word-actions`,登记 `wordActions/word-actions.more`(order 100,`link: "word_actions"`)。
- `more-button.tsx`:`MoreWordActions` — 44×44 图标按钮,`data-testid="<testId>-more"`,无障碍名「更多操作:<词>」;
  面板 `lazy()` 加载,关闭后焦点回到按钮。
- `word-actions-sheet.tsx`:`WordActionsSheet` — 底部面板「单词操作」+ `<Slot point="wordActionsMenu">`。行由各 feature 登记:
  `vocabulary.add`(0)、`wordbook.adopt`(10)、`practice.shadow`(20)、`wordbook.card`(30),都带 `link: "word_actions"`;
  两行词书动作在背单词关闭时不渲染(`features/wordbook/register-word-actions.tsx`)。
- `i18n/{zh-CN,en}.json`:`web.links.wordActions.*`(包括 feature 登记的行用到的文案)。
- 测试:`parity.test.tsx`(四种用法与直接渲染 `AddVocabularyButton` 逐字节相同:全关、除本联动外全开;本联动开时只多一个兄弟按钮)、
  `more-button.test.tsx`(面板、加入词书学习、加入词汇本、跟读、焦点)、`word-actions-contract.test.ts`(对照
  `server/tests/fixtures/links_word_actions_contract.json`)。

## Allowed dependencies
同 `../CLAUDE.md`;feature 只经 `~/features/<x>` 或 `~/features/<x>/register*`。服务端接口:`POST /api/links/wordbook/adopt`、
`POST /api/links/wordbook/card`(body `{"word"}`,词不进 URL;由 `features/wordbook/link-actions.tsx` 调用)。

## Test
`cd web && yarn vitest run src/plugins/word-actions src/features/wordbook/link-actions.test.tsx`;测试自己 `import "./index"` 并
`setLinkFlags(...)` 打开本联动(`test/setup.ts` 只登记核心按钮)。

## Pitfalls
- 核心按钮是 vocabulary 的 `wordActions/vocabulary.add`(无联动键);不要在本插件里再渲染一个「加入词汇本」按钮,也不要给插槽加包裹元素
  ——全关时 DOM 必须与今天逐字节相同。
- 「加入词书学习」不受每日新词目标限制、不写 learn 事件、不得段位点(服务端 `app/links/word_actions.py`)。
- 面板与词卡都是懒加载;主包只多「更多」按钮和几行登记代码。
