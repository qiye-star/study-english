# 对话里的跟读弹窗 · 设计

- 日期:2026-10-14 · 状态:用户已确认(见 §1),本文是计划的唯一依据
- 视觉依据:`docs/superpowers/design/shadow-sheet-v1/mockup-glass.html`(Opus 设计的玻璃版,深色优先;结构与状态见同目录 `mockup.html`)。两份稿冲突时以玻璃版为准;玻璃与动效规则见 `2026-10-13-video-import-design.md` §11.4a
- 「核对」处:计划作者必须读真实代码确认,不得凭本文推断

## 1. 用户已确认的决定

| # | 决定 |
|---|---|
| D1 | 对话模块里点「跟读」不再跳到练习页,改为**底部弹窗**:在原地练习并查看成绩 |
| D2 | **全部入口**都改成弹窗(对话提示、语法纠正、复盘、转写详情、句子列表面板、选词查词里的「跟读」),行为一致 |
| D3 | 弹窗里的逐词着色用**简化版**(行内着色 + 点词查词),不带波形;波形留给完整详情页 |
| D4 | 「下一句」连续练只在**多句列表入口**出现;不做「自动播范读后立刻录音」模式 |
| D5 | 视觉用玻璃风格,参考跟读库;**彩色极光背景只在弹窗打开时淡入,关闭后淡出,对话页平时不变**(深色优先,浅色同样支持;一屏模糊 ≤ 3;降级沿用 `glass-quality` 的 `.lite`) |
| D6 | 练习页本身不动(自由输入、历史、列表),只是上述入口不再跳去那里;成绩仍然保存进练习历史 |

## 2. 现状(已核对)

- `goPractice(navigate, text)`(`web/src/features/practice/save-practice-item.ts`)= `navigate("/practice", {state:{reference}})`;调用点:`features/chat/{conversation-page.tsx(onPractice)、grammar-details.tsx、recap-sheet.tsx、sentence-practice-sheet.tsx、turn-detail-sheet.tsx}`、`features/lookup/lookup-layer.tsx`(「跟读这段」)。
- 练习页(`practice-page.tsx`)内联了完整流程:`useRecorder` → `toAssessmentWav` → `assessPronunciation(save:true)` → 跳转 `/practice/assessments/:id`;范读用 `useTtsPlayer`(`~/features/chat`);结果页(`assessment-page.tsx`)用 `MobileScoreResult`、wavesurfer 波形、`PronunciationAssessmentFulltextResult`。
- 项目已记录的陷阱:**嵌套弹层会让两套 Radix 焦点陷阱互相递归**(`web/src/features/wordbook/CLAUDE.md`);`LookupLayer` 已是全局单例、「先关自己的面板再导航」的做法。

## 3. 设计

### 3.1 架构
- **全局单例弹窗** `ShadowSheetHost`:挂在 `layout/app-shell.tsx`(与 `LookupLayer` 并列),内部懒加载(`React.lazy` + `Suspense`),对话页首屏体积不增加。
- 打开方式:`useShadowSheet().open({ text, list?, index?, source })`(`~/features/practice` 的公共出口;context 在应用壳里提供)。**调用方先关闭自己的面板再 `open`**(不叠加两层弹窗)。`goPractice` 保留给练习页自己与深链使用,六个入口改用 `open`。
- **共享钩子** `useShadowSession(reference, options)`:把练习页里「录音 → WAV → 评测 → 保存」的状态机抽出来(状态:`idle | recording | assessing | result | error`,保留录音以便失败重试),**练习页与弹窗共用**;抽取必须由练习页现有测试(`practice-page.test.tsx`)兜住行为不变。
- 结果展示:弹窗内的简化结果组件 `ShadowResult`(评分环 + 三条分数条 + 行内逐词着色 + 提示 + 我的录音 / 标准发音 / 收藏 + 再练一次 / 下一句 / 完成 + 「查看完整详情」跳完整页);评分颜色语义沿用 `score-tone`(≥85 绿 / 70–84 琥珀 / <70 灰)。
- 范读与「我的录音」播放用 `useTtsPlayer` / 普通 `<audio>`(录音时停止范读,iOS 音频路由);**不引入 wavesurfer**。

### 3.2 行为
- 多句入口(句子列表面板)传 `list` 与 `index`:显示「第 n / m 句」、上一句 / 下一句;单句入口不显示。
- 录音与评测中,下拉关闭 / 点遮罩 / 点 × → 先确认「放弃这次录音?」。
- 错误(麦克风被拒、评测失败、额度满):显示在弹窗内,保留录音可重试,文案沿用 `PRACTICE_SERVER_ERRORS` / `describeAudioError`。
- 参考句可长按选词(沿用选词操作条);录音中暂停选词操作条,避免误触;操作条与弹窗底部按钮的叠放位置在真机上确认。
- 弹窗高度 ≤ 85 dvh,内部滚动;受已合并的视口锁影响(html/body 固定),弹窗内容区自己滚动。
- 成绩 `save: true` 照常保存;「查看完整详情」才 `navigate('/practice/assessments/:id')`(先关弹窗)。

### 3.3 视觉
- 玻璃面板悬浮(四周留边、大圆角),后面的聊天模糊透出;深色优先,浅色同样支持(跟随 `html.dark`);按钮、评分环、波形、状态动画按玻璃版设计稿;`.lite` 与 `prefers-reduced-motion` 降级;样式随懒加载块进入,不进主包,不改全局 `theme.css`。

## 4. 隐私、验证与不做
- 参考句、录音、评测文本不进日志与 URL;错误经 `translateServerError` 映射成固定文案。
- 测试:`useShadowSession` 状态机(假录音机 / 假评测)、弹窗各状态、六个入口各有一条「点跟读 → 弹窗出现且不导航」的测试、关闭确认、架构测试(`architecture.test.ts` 不放宽)。
- **未验证(须真机)**:iOS 麦克风授权与音频路由切换、玻璃模糊性能、选词操作条叠放、弹窗在软键盘 / 视口锁下的表现。
- 不做:自动跟读模式、弹窗内波形、改练习页的页面结构、改评测服务端。

## 5. 计划
| 计划 | 文件 | 内容 |
|---|---|---|
| 跟读弹窗 | `plans/2026-10-14-shadow-sheet.md` | 钩子抽取(练习页不变行为)→ 弹窗宿主与上下文 → 结果组件 → 玻璃样式 → 六个入口改造 → 测试与真机清单 |
单一网页计划,无服务端改动。
