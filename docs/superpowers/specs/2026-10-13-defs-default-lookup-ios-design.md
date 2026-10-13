# 英英默认 · 选词词典与生词本 · iOS 键盘跳页修复 · 设计

- 日期:2026-10-13 · 状态:用户已确认(见 §1),本文是三份计划的唯一依据
- 前置:`2026-10-12-wordbook-definitions-design.md`、`2026-10-10-wordbook-design.md`
- 「核对」处:计划作者必须读真实代码确认,不得凭本文推断。视频导入(第 3 件)另有设计文档,不在本文范围。

## 1. 用户已确认的决定

| # | 决定 |
|---|---|
| D1 | 释义显示默认改为「仅英文」;卡片右上角有「中」小开关临时显示该卡中文;短语默认展开可在设置里改 |
| D2 | 默认值只影响没存过偏好的用户;没有英文释义的词(约 135 个,国家 / 城市等)在「仅英文」下**自动补显中文** |
| D3 | 选择题 / 拼写题 / 快速回忆题面仍用中文,不做英英题型 |
| D4 | 不新建生词本:**沿用现有词汇本**(`features/vocabulary`,`WordActions` 插槽) |
| D5 | 不自写长按手势:iOS 长按单词本来就会选中,沿用 `use-text-selection` 的选中流程 |
| D6 | 选中后的底部按钮改成一排小操作条:**查词 · 朗读 · 加入生词本** |
| D7 | 查词**先查本地词典,查不到再问大模型**,界面标注来源;命中后仍可点「AI 结合语境讲解」 |
| D8 | iOS Safari(非主屏幕应用),1 对 1 对话和联机都有,点击输入框时页面就跳到顶部;由用户真机验证 |

## 2. 第 1 件:英英默认与短语开关

### 2.1 现状(已核对)
- 服务端:`server/app/wordbook/store.py` 的 `DEF_LANGS = ("both","zh","en")`、`DEFAULT_DEF_LANG = "both"`;偏好存 `wordbook_events` kind `defpref`;`GET /api/wordbook/config` 返回 `def_lang`,`PATCH /api/wordbook/enrollment {def_lang}` 写入。
- 网页:`web/src/features/wordbook/def-lang.ts`、`use-def-lang.ts`、`def-lang-setting.tsx`(分段控件,在每日目标面板里)、`word-card.tsx` 的 `groupDefs`;短语区偏好仅存本机 `phrases-pref.ts`(`WORDBOOK_PREFS_KEY`)。

### 2.2 改动
1. **默认值**:`DEFAULT_DEF_LANG` 改为 `"en"`;网页里所有写死 `"both"` 的回退(未加载 / 出错时)一并改;已有 `defpref` 事件的用户不受影响。
2. **缺英文释义回退**:卡片在有效偏好为 `"en"` 且该卡 `defs_en` 为空时按中文显示(含词性标签),不出现空卡;判定写成纯函数并单测。
3. **「中」小开关**:`word-card.tsx` 右上角一个小按钮(`aria-pressed`,触控区 ≥ 44 px);仅在有效偏好为 `"en"` 且卡片已翻开时出现;只影响这一张卡的当前显示,不写服务端、不写本机;遮罩状态下不渲染(中文释义本来就不在 DOM 里)。
4. **短语开关**:`def-lang-setting.tsx` 同一面板增加「短语:自动展开 / 收起」开关,读写 `phrases-pref.ts`(仍是设备级偏好,不上服务端);文案走懒加载文案文件。
5. 复习页、已学词页的行为不变(短语默认折叠),设置里的开关只管学新词页。

### 2.3 测试
服务端:默认值、旧用户保持、PATCH 校验不变、契约夹具 `wordbook_contract.json` 的 `def_lang` 默认值同步重录。网页:回退纯函数、小开关显隐与单卡切换、设置开关写本机、快照更新。

## 3. 第 2 件:选词操作条、本地词典、生词本

### 3.1 现状(已核对)
- 选中 300 ms 后 `lookup-layer.tsx` 在底部弹出一个按钮(查词 / 翻译),点开是底部抽屉;`cachedLookup` / `cachedTranslate` 经 `completeChat` 调大模型;抽屉里的「加入词汇本」是 `WordActions` 插槽(`register-word-actions.tsx`)。
- 服务端 `app/wordbook/` 有 `index.py`(`BookIndex`)、`definitions.py`(英文释义,键为小写单词)、`entry.py`、`textnorm.py`;`routers/vocabulary.py` 管词汇本。

### 3.2 服务端:本地词典查询
- 新端点 `POST /api/dictionary/lookup`(**单词只放请求体**,不进 URL、不进日志;需登录):请求 `{text}`,响应 `{hit: bool, word, lemma?, phonetic?, defs_zh: [...], defs_en: [...], phrases?: [...], source: "dict"}`;`hit=false` 时只回 `{hit:false}`,由网页再走大模型。
- 查找顺序(计划「核对」):规范化(小写、去首尾标点)→ 直接命中 `BookIndex` / 定义表 → 词形还原命中。**词形还原**:ECDICT 的 `exchange` 词形表只在构建时用、没进仓库;本轮把它压缩成「词形 → 原形」小表(仅限 7 本书里出现的原形的变形,预计几百 KB 到几 MB)提交进 `server/dictionaries/wordbook-definitions/`,更新 `SOURCE.json`、`CLAUDE.md`、校验和测试;构建脚本新增子命令生成它,输出必须确定性。输入超过 3 个词或 40 字符的不查词典(直接 `hit=false`)。短语只在词典已有短语表里精确命中才算命中。
- 不新增迁移,不记录查询内容;限流沿用现有 AI 路由的做法(「核对」)。

### 3.3 网页
- `lookup-layer.tsx` 的触发按钮改为操作条(查词 / 翻译 · 朗读 · 加入生词本);朗读沿用现有 TTS 播放器,**在点击手势里调用**(iOS);加入生词本直接走 `WordActions` 的同一个保存函数(不新增跨 feature 依赖,走插槽 / 扩展点)。
- 查词流程:先调本地词典,`hit` 则立即显示(标「词典」),并给「AI 结合语境讲解」按钮,点了才调现有大模型查询;未命中则自动走大模型并标「AI 查询」;翻译(长句)路径不变。
- 抽屉在词典命中时显示中文释义、英文释义(遵守 `def_lang`)、音标、最多 3 条短语;不加载额外依赖,主包增量要报告数字。
- 离线 / 出错:词典请求失败时回退到大模型路径,错误经 `translateServerError`。

### 3.4 测试
服务端:规范化、直接命中、词形还原、未命中、长输入、日志不含查询内容(`caplog`)、数据文件校验和、构建确定性。网页:操作条三个动作、命中 / 未命中分支、AI 讲解按钮、朗读在手势内调用、`WordActions` 不引入新跨 feature 边(`architecture.test.ts` 不放宽)。

## 4. 第 4 件:iOS Safari 点输入框页面跳到顶部

### 4.1 现状与假设(**未在真机复现**)
`web/src/layout/use-app-height.ts` 只把 `visualViewport.height` 写进 `--app-height`;`app-shell.tsx`、`app.tsx` 的外壳用 `height: var(--app-height, 100dvh)`;没有任何地方处理 Safari 在输入框聚焦时对布局视口的上推(`window.scrollY` / `visualViewport.offsetTop`)。输入框字号若 < 16 px,iOS 还会自动放大页面,同样造成偏移。

### 4.2 改动(计划里每项先读代码确认再改)
1. `use-app-height.ts`:`visualViewport` 的 `resize` / `scroll` 以及 `focusin` / `focusout` 后,若 `window.scrollY !== 0` 或 `visualViewport.offsetTop > 0`,调用 `window.scrollTo(0, 0)`(用 `requestAnimationFrame` 合并,不在每次事件里强制布局);键盘收起后再复位一次。
2. 最外层固定:`html` / `body` 设 `position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none`(「核对」不破坏独立滚动区、登录页、安装页;滚动只发生在内部容器)。
3. 1 对 1 对话输入框、联机 `room-composer.tsx` 输入框、其它 `<textarea>` / `<input>` 的字号 ≥ 16 px(只改 iOS 触屏、不改桌面外观,例如 `@media (pointer: coarse)`);列出所有受影响输入框并逐个确认。
4. 与 `rooms/assist/use-soft-keyboard.ts`、`dock-snap.ts` 的键盘判定不冲突(不改它们的判定,只确认 `scrollTo` 不触发其 `vv.scroll` 监听的抖动)。

### 4.3 验证与诚实说明
- 单元测试:`use-app-height` 在模拟 `visualViewport` 偏移时调用 `scrollTo(0,0)`、无偏移不调用、卸载移除监听;字号规则用样式源码断言。
- **无法自动验证**:Playwright WebKit 不模拟 iOS 软键盘。计划交付一份真机验证清单(Safari,1 对 1 与联机,点击输入框、键盘收起、横竖屏、聊天长列表滚动后点击),文档里标注「未在真机验证」,由用户验证后再勾选。

## 5. 隐私、规范与不做

- 日志、URL、错误里不出现查询的单词或用户内容;新目录 / 新文件同步 `CLAUDE.md`;架构测试不放宽;提交遵循约定式提交;只在用户要求时重建容器、跑全量测试。
- 不做:英英题型、自建长按手势、新的生词本页、把词典 API 开放给第三方、iOS 主屏幕应用专项(用户确认只在 Safari)。

## 6. 计划与合并顺序

| 计划 | 文件 | 内容 |
|---|---|---|
| A 英英默认 | `plans/2026-10-13-defs-default.md` | §2:服务端默认值 + 契约夹具,网页回退 / 小开关 / 短语设置 |
| B 选词词典 | `plans/2026-10-13-lookup-dictionary.md` | §3:服务端词形表与端点,网页操作条与查词流程 |
| C iOS 修复 | `plans/2026-10-13-ios-keyboard-scroll.md` | §4 |

三份计划文件所有权互不重叠(A:`wordbook/` 与 `def_lang` 相关;B:`lookup/` + 服务端新模块;C:`layout/` + 输入框样式),可并行;合并顺序 A → B → C(C 与 A、B 无文件冲突,放最后便于真机验证单独回滚)。
