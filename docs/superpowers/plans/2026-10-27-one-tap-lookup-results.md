# 单击查词 · 结果与未验证清单(2026-10-27)

计划:`docs/superpowers/plans/2026-10-27-word-spell-tap-lookup-simple-defs.md` 车道 T(T1–T3)。
分支:`worktree-agent-a50f9a0baef277693`(基于 `main` @ `c6936aa6`)。

## 提交

| 提交 | 内容 |
|---|---|
| `21e34aad` feat(web): one tap on a word opens the lookup bar | 触屏 / 手写笔一下即选中词并出操作条;删除横线标记(`pending-mark.ts` 及其测试、`::highlight(lookup-pending)` 规则、测试用 `installHighlightStub`);用户自己的选区只由点按清除 |
| `f2b84e51` feat(web): desktop mouse single click also looks up a word | 桌面鼠标左键单击也查词(用户拍板) |
| `f531c484` feat(web): tap-lookup hint says one tap is enough | 提示改为「点一下单词就能查词」,新本机字段 `tapLookupOnceHintSeen`(老用户再看一次,旧字段忽略) |
| (本提交) docs: one-tap lookup results and unverified checklist | 本文 |

## 行为

- 单击(触屏、手写笔、桌面鼠标左键)在可查词的英文单词上:选中该词,操作条立即出现;抽屉仍要点操作条上的「查词」才打开。
- 手势边界(逐条有测试,`use-tap-lookup.test.tsx`):移动超过 8 px 不算;按住超过 450 ms 不算;两指不算;右键 / 中键不算;双击的第二下(`detail > 1`)交给浏览器;`<button>`、`<a>`、`<input>`、`role=button` 等不触发;固定皮肤页(资料库、更新日志)不触发。
- 选区判断在**按下时**读取(桌面 mousedown 会先收起选区):按下时存在用户自己的选区,这一下只清除选区,不查词。上一次单击选出的词不算用户选区,所以连续点另一个词直接查。
- 同一个词连点只发一次 `POST /api/dictionary/lookup`(`lookup-layer.test.tsx`,R-T4;限流未改)。
- 不调用 `preventDefault`,不改 `user-select` / `touch-action`,不记日志,不注册 CSS Highlight。

## 与计划的偏离

1. **桌面鼠标改为单击即查**(计划默认不改,用户拍板改)。Q-T2 不再待定。
2. **状态机删除**:计划 R-T2 保留 `stepTap`。实现后只剩「点按即查」一个分支,改为无状态纯函数(`isTap`、`sameRange`、`isUserSelection`,在 `features/lookup/tap-lookup.ts`),`stepTap`、`TAP_MARK_TTL_MS`、`expired`、`PendingMark` 全部删除。
3. **提示字段**:计划 R-T5 的新字段名 `tapLookupOnceHintSeen` 按计划使用;文件注释与 `web/README.md` 同步。
4. **E2E 规格**:计划 T1.2 要求把 `e2e/lookup.spec.ts`、`e2e/vocabulary.spec.ts` 的「点两下」改成一下。核对后两份规格都通过选区 API 选词,没有两下点按步骤,因此未改。E2E 未运行(要真上游、花钱)。
5. **依赖安装**:主检出没有 `node_modules`,符号链接无处可指;在 worktree 内用 `node .yarn/releases/yarn-4.6.0.cjs workspaces focus web` 装了 web 依赖(根 `node_modules` 为 hoist 结果,未重装其它工作区)。
6. **计划文件**:`docs/superpowers/plans/2026-10-27-word-spell-tap-lookup-simple-defs.md` 是主检出里未提交的文件,在 worktree 中不存在,实现时直接读的主检出那份。

## Task 0.4 冲突清单(R-T3 第 4 条)

扫描方法:列出含 `lookupContext` / `data-lookup-context` 的非测试文件(约 50 个),对其中的 `div` / `li` / `span` / `p` / `td` 等非按钮容器逐个查 `onClick` / `onPointer*` / `onTouch*` / `onMouse*`,并人工看了关键文件的点击处理。这是启发式扫描(单行正则 + 人工),**不保证穷尽**。

- **有冲突(未改,需要用户决定):** `src/features/rooms/room-message-list.tsx` 的 `selectable()`(约 214 行):整个聊天气泡(含可查词的英文)点击会切换操作行。现在点气泡里的词,会**同时**切换操作行并出查词操作条。两者都不破坏数据,但体验叠在一起。可选方案:① 气泡文字加 `lookupTapOff`(房间里的词不能一下查);② 保持现状并接受叠加;③ 操作行只由「更多」按钮打开,去掉气泡点击。按计划的做法是加 `lookupTapOff` 并加回归测试,但它会关掉房间里的点词查词,属于产品决定,所以本次没改。
- 其余命中都是 `<button>`、`<Button>`、`IconButton` 或 `role` 已被 `lookupTapContext` 排除的元素(如 `choice-question.tsx`、`typing-question.tsx`、`word-card.tsx` 的「中」按钮与发音键、`vocabulary/review-card.tsx`、`progress-page.tsx` 的图标按钮)。
- `shadow-sheet.tsx` 的触摸拖拽区与 `library/segment-list.tsx` 的段落点击:后者在资料库(固定皮肤页)内不参与查词;前者的拖拽区不含可查词文字。
- `room-message-list.tsx` 第 219 行的「更多」按钮是 `<button>`,无冲突。

## 测试结果

- `yarn web:typecheck`:通过(每个提交后都跑过)。
- `yarn web:test`(全量,在 `21e34aad` 之后跑的):534 个文件中 533 通过;**3 个失败**,都在 `src/layout/feature-flags.test.tsx`(`off: 3 tabs ...`、`on: 4 tabs ... rank card` 两条)。**这 3 个在干净基线上同样失败**(临时 stash 工作区后单独运行验证,之后已恢复并删除 stash),与本车道无关,未修。
- 相关测试集:`src/features/lookup`、`src/features/wordbook`、`src/i18n` 在 `f531c484` 之前有过一轮,其中 2 个文案断言(旧提示文案)当时失败,已改成新文案后两个文件单独重跑通过。`f531c484` 之后未再跑全量,下方「全量复跑」一行为最终结果。
- 全量复跑(`f531c484` 之后的最终树):534 个文件中 533 通过,5025 个用例中 5021 通过、1 跳过、3 失败(同上 feature-flags 的 3 条,基线同样失败)。
- 注意:计划要求「先写失败测试」。本次是先改写测试、再改实现;鼠标用例是在实现之后才第一次运行(实现前未单独跑红)。

## 未验证(需要真机 / 真上游)

以下均**未在真机验证**,未在任何真设备或真浏览器上运行:

- iOS Safari:一下点按是否直接选中词、是否弹出系统选词工具栏(复制 / 全选 / 查询),操作条是否被压住。
- Android Chrome:点按后浏览器的兼容 `click` 是否折叠选区(代码里有 500 ms 回填,需真机确认);连续点不同的词是否稳定。
- 滚动中误触:滑动阅读时的误查率(8 px 阈值是否合适)。
- 桌面 Chrome / Firefox / Safari:单击查词后,拖选、双击选词、三击选段、Shift 扩选是否与原来一致;单击后是否有选区闪烁。
- 桌面鼠标在操作条出现后再点操作条按钮是否仍正常(操作条不是 lookup context,应不受影响,未在浏览器里验证)。
- 读屏用户:一下即出操作条是否会打断读屏(未做 `aria-live`)。
- 房间气泡的冲突(见上)的处理决定。
- 老用户看到新提示一次(`tapLookupOnceHintSeen`)的体验是否合适。
