# 跟读库 · 网页库与播放器(W1)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 本计划是 spec §15 表中的 **W1 网页 库与播放器** 车道(含「D8 增补的归属」里 W1 的部分,以及 E9 入口标签与 D12 外观设置)。合并顺序以 spec §15 为准:**S1 →(S2 ‖ A 服务端 ‖ W1)→ W2 → A 网页 → Z**。若之后出现 `plans/2026-10-13-video-import-INDEX.md`,冲突以 INDEX 为准。**文末「Addendum (2026-10-13)」的裁定(R-L24 起)覆盖正文里与之冲突的旧文字**:入口卡 / `practiceHome` 作废,改为底部标签;新增全站外观设置、库内玻璃视觉层、译文行与「译」开关。正文的任务已就地改写,Addendum 逐条列出改动、裁定、对其他计划的接口与风险。

**Goal:** 在 `web/src/features/library/` 建立跟读库的网页端:**底部标签「跟读库」**(`/library`,受 `GET /api/library/config.enabled` 控制,排在联机与「我的」之间,取代原先的练习页入口卡;spec E9)、`/library` 列表页(封面、时长、句数、字幕来源、大小、处理阶段步骤条与进度 3 秒轮询、失败原因与「重试 / 补传字幕 / 删除」、「已用 X / 配额 Y」、「添加」主按钮)、添加素材底部弹层(上传页签:分片 8 MiB、逐片串行、每片自动重试 3 次、可取消、同会话续传、刷新后「重新选择同一个文件继续」;链接页签:开关关时只显示说明,DRM 文案常驻)、`/library/:id` 播放器(视频 `playsInline` / 音频图标、句子列表高亮与自动滚动、上一句 / 播放 / 下一句、单句循环 关 / 无限 / 3 / 5、速度 0.5 / 0.75 / 1 / 1.25 用弹性滑块吸附并存 `rate_pct`、盲听、点句子跳播、**每句译文行与「译」开关(D8)**、续播位置 5 秒节流 + `keepalive`、媒体票据过期自动换票),**全站外观设置「跟随系统 / 浅色 / 深色」(D12:`settings/`、`layout/color-scheme.ts`、「我的」里的一行)**,**库内玻璃视觉层(D11 / spec §11.4a:`library.css` + 12 个自写小效果,深浅色跟随 `html.dark`,只用在跟读库页面)**,以及给 W2 的两个占位 `shadow-panel.tsx` 与 `use-translations.ts`。主包净增量 ≤ 1.5 kB gzip(外观设置另计,见 R-L35)。

**Architecture:** `features/library` 是新 feature,对外的 `index.ts` 只导出两个 `React.lazy` 页面与小钩子 `useLibraryEnabled`(只读 `GET /api/library/config`,E9);底部标签由 `layout/bottom-nav.tsx` 经 `~/features/library` 读它(与「联机」读 `useRoomsEnabled` 同一做法,不新增跨 feature 边,不再有 `practiceHome` 贡献、`register.tsx` 与入口卡)。主包里只有:`config.ts`(开关请求)、`use-library-enabled.ts`、`lazy-pages.tsx`、`page-status.tsx`、`index.ts` 与一条标签文案 `web.nav.library`(`i18n/`);其余文案在 `locales/`(懒加载,`addResourceBundle`,同 agents R-W3 / wordbook R-DW1)。视觉层 `library.css`(变量只定义在 `.library-root` 上)、`library-root.tsx` 与 `fx/` 下 12 个自写小效果全部在懒块里,没有新 npm 依赖(R-L27)。外观设置落在 `settings/color-scheme-pref.ts`(类型与存储读取)、`settings/settings-context.tsx`(`colorScheme`)、`layout/color-scheme.ts`(应用到 `html.dark`)与 `layout/color-scheme-sync.tsx`,是主包代码(R-L25)。HTTP 全部经 `ApiClient`(Bearer);`<video>/<audio>` 发不了头,所以媒体走服务端签发的同源票据 URL(spec E4)。播放逻辑是一个与 React 无关的 `PlayerController`(可注入假的媒体元素与 `requestAnimationFrame`),`useMediaPlayer` 只做接线;视觉动效里需要 JS 的(CountUp、BlurText、ClickSpark)同样可注入假帧。上传是模块级 `upload-store`(在应用内切页时继续上传),逻辑在纯函数 `uploadFile` 里。译文由 W2 的 `use-translations.ts` 批量取、W1 的播放器合并进句子并渲染译文行(R-L32)。不新增任何跨 feature 边(`library->practice` 归 W2)。

**Tech Stack:** React 18 + TypeScript(`noImplicitAny`)+ Tailwind 3(redesign v3 令牌)+ 一份库内作用域的纯 CSS(`library.css`)+ lucide-react 0.479 + Radix(经 `~/components/bottom-sheet`、`@renderer/components/ui/alert-dialog`)+ i18next + sonner;vitest 3 + Testing Library + jsdom 26(`test.css = false`,CSS 只能做源码断言)。**不新增依赖**(不引入 reactbits、GSAP、three.js)。

**Spec:** `docs/superpowers/specs/2026-10-13-video-import-design.md`(**有约束力**;§1 D2/D4/D5/D6/D8/D9/D11/D12、§2.1 E4/E9/E11/E12、§2.2、§4 `library_segments` 的 `zh` / `zh_lang` / `analysis` / `analysis_lang`、§5.2、§6.6、§7.4、§8、§9、§10、§11.1–§11.5 含 §11.4a、§13、§15 含「D8 增补的归属」、§16)。开放问题 1–5 按推荐默认值执行(1:`LIBRARY_ENABLED` 等默认关 → 底部标签默认不出现;2:容量默认值只影响服务端返回的 `limits`;3:接受 B 档估算边界,微调归 W2;4、5:只影响服务端,网页只显示对应错误文案)。D10 第二期清单不在任何本期计划里,本计划不做。

## Global Constraints

- **只改本车道的文件**(spec §15 W1 行与「D8 增补的归属」):`web/src/features/library/` 下除 W2 文件(`shadow-panel.tsx` 的后续实现、`use-shadowing`、`attempts-api`、`word-tap`、`save-sentence`、`segment-editor`、`segment-menu`、`analysis-card`、`use-translations` 的后续实现)以外的全部;`web/src/app.tsx`(路由 + `<ColorSchemeSync />`);`web/src/layout/{bottom-nav.tsx,bottom-nav.test.tsx,feature-flags.test.tsx,color-scheme.ts,color-scheme-sync.tsx,color-scheme.test.ts,color-scheme-sync.test.tsx,CLAUDE.md}`;`web/src/settings/*`(含 `CLAUDE.md`);`web/src/pages/{me-page.tsx,me-page.test.tsx,CLAUDE.md}` 与 `pages/i18n/{en,zh-CN}.json`;`web/README.md`;`web/scripts/main-bundle-baseline.json`(L0 与 LA 重录)。**不再改 `web/src/plugins/`**(入口卡作废,R-L24)。不改 `features/practice/*`、`architecture.test.ts`、`features/CLAUDE.md`、`components/*`、`index.css`、`styles/theme.css`、`auth/*`、`main.tsx`、`server/`、`admin/`、`enjoy/`。
- **隐私**:URL 路径里只有条目 uuid、分片序号与句序号(`…/segments/{idx}/analysis`),查询串里只有列表的不透明 `cursor` 与服务端签发的 `ticket`;标题、文件名、链接、句子文字、译文只在 POST / PATCH / multipart 体与响应体里;multipart 的文件名用中性名(分片 `chunk`,字幕 `subtitles.srt|vtt`),只有 `POST /uploads` 的 JSON 体带原文件名(spec §8 需要它取扩展名与默认标题);代码里不 `console.*` 任何 URL、票据、标题、句子或译文;网页不请求第三方主机(链接导入只是把用户输入的链接作为 JSON 交给自己的服务端;译文与分析由服务端调大模型,网页只和自己的服务端说话);本机存储里只有条目 id 与布尔值(`enjoy-web.library.translate.<id>`),没有内容。测试断言请求的 `search` 为空(列表与票据除外)。
- **视觉(D11,spec §11.4a;R-L26–R-L30)**:库页面的玻璃与动效只来自 `library.css`(随懒块),变量只定义在 `.library-root` 上,不动 `theme.css` 的全局令牌;文字颜色、字号、触控沿用 `theme.css` 令牌与现有组件;蓝 = 操作 / 进行中,灰 = 中性,琥珀 = 提示;失败原因用中性次要色,不用红色(红色只给表单校验错误一行);触控 ≥ 44px(`h-tap`、`min-h-tap`、`min-w-[44px]`,视觉小于 44 的用 `::before` 扩命中区);界面不用 emoji;输入框字号 16px(防 iOS 缩放)。**一屏模糊层 ≤ 3**(R-L26);**动画只用 transform / opacity / background-position**(两处有记录的例外,R-L29);`html.lite`、`prefers-reduced-motion`、`prefers-reduced-transparency` 与不支持 `backdrop-filter` 全部有降级(R-L28),有源码断言;iOS Safari 需 `-webkit-backdrop-filter`。底部标签栏沿用 `GlassTabBar`、不改;不改任何现有页面的外观(外观开关只切 `html.dark`,全站本来就有 `.dark` 变量)。
- **i18n**:库的键前缀 `web.library.*`;主包(eager,`features/library/i18n/`)里**只有 `web.nav.library` 一个键**(spec E9,R-L3),其余在 `locales/`(懒加载);外观设置的文案在 `pages/i18n/`(`web.me.colorScheme*`)。en 与 zh-CN 键集相同、占位符相同(`locales.test.ts` 与 `i18n/i18n.test.ts` 的逐目录检查);英文复数用 `_one` / `_other`,中文两份同文。**页面测试里的中文断言一律用 `test-i18n.ts` 的 `setUiLanguage("zh-CN")`**(写 `enjoy-web.settings` 再切语言):`SettingsProvider` 的初始化器会按存储或 `navigator.language`(jsdom 里是 `en-US`)重设语言,只调 `i18n.changeLanguage("zh-CN")` 会被它改回 `en`(R-L36)。
- **体积**:主包(入口块 + modulepreload 块)gzip 净增量 ≤ **1.5 kB**(spec §11.5),以 L0 / LA 重录的 `main-bundle-baseline.json` 为准,用 `node scripts/check-main-bundle.mjs --max-delta=1.5` 检查;**外观设置(LA)的主包增量单独报告,并在 LA 末尾重录基线**,这样库自己的预算不被它占用(R-L35);库内样式 + 小组件 gzip 目标 ≤ 6 kB(spec §11.4a,非实测目标)、懒块合计 gzip 目标 ≤ 40 kB,实数写进结果文档。
- **每个任务**:先写失败测试 → 跑 → 实现 → 跑通过 → 提交;只跑任务列出的目标测试 + `src/architecture.test.ts` + `yarn web:typecheck`。全量 `yarn web:test` / `yarn web:build` / E2E / 容器重建**只在用户要求时**(LA 与 L16 的构建与体积检查除外,它们是本车道的验收项,各需要构建一次)。
- **提交**:conventional(`feat(web): …`、`test(web): …`、`chore(web): …`、`docs: …`),一个任务一个提交,信息末行 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。
- **写计划时的实跑(2026-10-13 更新)**:除了真机与真实上游,本计划里 LA、L1、L2、L7–L9、L13–L15、LV1–LV3 的代码与测试已在一份临时副本里跑过(把计划里的文件抽出来放进 `web/` 的副本:`vitest run src/settings src/layout src/pages src/i18n src/architecture.test.ts src/features/library src/features/lookup src/styles src/components` 全绿,73 个文件、483 个用例、3 个跳过;`tsc --noEmit` 只剩副本缺依赖造成的两个无关错误;L3 的契约测试对着一份**按 spec 形状手写的假夹具**跑过,不是 S1 的真夹具)。**没有跑过**:构建与体积(L0、LA、L16)、浏览器渲染、真机、`yarn web:test` 全量。运行中发现并已改正的旧问题见 Addendum 的「核对中修正的问题」。执行者第一次运行仍以真实结果为准修正选择器与断言细节,但不得改动本计划的裁定、文件名与导出名。
- **未验证**:凡需要真机(iOS Safari / 安卓 Chrome / 主屏 PWA)或真实上游的行为,一律在结果文档写「未验证」,不编造数字(清单见 L16)。

---

## 文件结构

```
web/src/features/library/
  CLAUDE.md                     新(L16)
  index.ts                      公开面:两个懒页面 + useLibraryEnabled(L1 占位 → L15)
  lazy-pages.tsx                React.lazy + Suspense(主包)
  use-library-enabled.ts        底部标签用的开关钩子(主包)
  config.ts                     GET /api/library/config + useLibraryConfig(主包)
  page-status.tsx               PageLoading / PageError / PageNote(主包)
  i18n/en.json  i18n/zh-CN.json 只有 web.nav.library 一个键(主包,eager)
  locales.ts  locales/en.json  locales/zh-CN.json  其余文案(懒加载;W2 的 web.library.shadow.* 子树也在这里)
  library.css                   库内视觉层样式(懒块;LV1)
  library-root.tsx              LibraryRoot:.library-root 作用域、页面底色、极光(LV1)
  fx/                           12 个自写效果,各一个小文件 + 测试(LV1–LV3;无新依赖)
    motion.ts                   motionAllowed()、可注入的帧(JS 驱动的效果用)
    glass-surface.tsx  soft-aurora.tsx                                  (LV1)
    spotlight-card.tsx  specular-button.tsx  shiny-text.tsx  stepper.tsx  border-glow.ts   (LV2)
    elastic-slider.tsx  count-up.tsx(含 GradientText)  click-spark.tsx  blur-text.tsx  gradual-blur.tsx  index.ts   (LV3)
  library-api.ts                类型 + 全部 REST 调用(含 translate / analysis)+ LIBRARY_SERVER_ERRORS
  translation-state.ts          zhFor / needsTranslation / mergeTranslations(译文的纯函数,W2 也用)
  use-translate-toggle.ts       「译」开关(按条目,存本机)
  use-translations.ts           W2 的占位(之后归 W2;签名见 R-L32)
  error-kinds.ts                error_kind 常量、文案键、失败卡可用动作
  format.ts                     字节、时长格式化
  ui.ts                         按钮 / 输入框类
  upload-client.ts              uploadFile:分片、重试、续传、409 重新对齐
  upload-store.ts               模块级上传任务表 + useUploads + beforeunload
  use-library-items.ts          列表、分页、3 s 轮询(页面隐藏时停)
  use-poster.ts                 封面 blob(进入视口才取)
  item-card.tsx                 列表卡片(各状态;SpotlightCard / ShinyText / Stepper)
  upload-form.tsx  import-form.tsx  add-sheet.tsx
  library-list-page.tsx         /library(标签根页:无返回键)
  use-media-player.ts           PlayerController + useMediaPlayer
  resume.ts                     续播保存(节流 + keepalive)
  use-media-source.ts           媒体票据 + 过期换票
  segment-list.tsx              句子列表(自带滚动容器、译文行、当前句描边)
  shadow-panel.tsx              W2 的占位(之后归 W2)
  player-page.tsx               /library/:id(玻璃顶栏胶囊、控制胶囊、速度滑块、译开关)
  test-fixtures.ts  test-i18n.ts  仅测试
  *.test.ts(x)、library-contract.test.ts、library-lazy.test.ts、library-css.test.ts
web/src/app.tsx                 两条路由 + <ColorSchemeSync />
web/src/layout/                 bottom-nav.tsx(+「跟读库」标签)、color-scheme.ts(读设置)、color-scheme-sync.tsx、测试、CLAUDE.md
web/src/settings/               color-scheme-pref.ts(新)、settings-context.tsx(+colorScheme)、测试、CLAUDE.md
web/src/pages/                  me-page.tsx(「外观」行)、me-page.test.tsx、i18n/{en,zh-CN}.json(web.me.colorScheme*)、CLAUDE.md
web/README.md                   「跟读库(计划 2026-10-13)」一节 + 外观设置一句
web/scripts/main-bundle-baseline.json   L0 重录、LA 末尾重录
docs/superpowers/plans/2026-10-13-video-import-results.md   追加「W1」一节(不覆盖)
```

| 共享文件 | 本计划的插入点 |
|---|---|
| `web/src/app.tsx` | `import { … } from "~/features/wordbook";` 那组导入之后一行 `import { LibraryListPage, LibraryPlayerPage } from "~/features/library";`;`import { AppShell } from "~/layout/app-shell";` 之后一行 `import { ColorSchemeSync } from "~/layout/color-scheme-sync";`;`<Route path="/wordbook/learned" …/>` 之后两条路由;`App()` 里 `<SettingsProvider>` 的第一个子节点 `<ColorSchemeSync />`(LA、L15) |
| `web/src/layout/bottom-nav.tsx` | `LIBRARY` 标签与 `useLibraryEnabled()`(L15);其测试 `bottom-nav.test.tsx` 整文件替换、`feature-flags.test.tsx` 三处小改(L15) |
| `web/src/layout/color-scheme.ts` | 整文件替换(LA);`layout.test.tsx` 里现有的 prefers-color-scheme 用例不改,仍应通过 |
| `web/src/settings/settings-context.tsx` | 整文件替换(LA);`settings-context.test.tsx` 与 `pages/me-page.test.tsx` 里整个存储对象的 `toEqual` 同步改(LA) |
| `web/src/pages/me-page.tsx` | 「通用」组里语言行之前加外观行(LA) |
| `web/src/features/library/locales/{en,zh-CN}.json` | W1 建立并预置 `web.library.shadow.*`;**该子树归 W2**(R-L4),W1 之后不再动它 |
| `web/src/features/library/shadow-panel.tsx`、`use-translations.ts` | W1 建占位(导出名与签名见 R-L16、R-L32),W2 替换实现 |
| `docs/superpowers/plans/2026-10-13-video-import-results.md` | 文件不存在则建立(标题行 `# 跟读库 · 实测结果`);在末尾追加 `## W1 网页库与播放器` 一节,不改别人的节 |

## 跨计划假设(依赖的接口;S1 计划写成后若有出入,以 S1 录制的契约夹具为准,本计划只改类型与映射表,不改裁定)

spec §9(引):「`GET /api/library/config` → `{enabled, link_import, asr, limits:{max_upload_mb, max_duration_minutes, quota_mb, used_bytes, max_items, chunk_bytes, formats[]}}`」「`GET /api/library/items?cursor=` 列表:`{id, kind, source, title, status, stage, progress, error_kind, duration_ms, seg_count, library_bytes, sub_source, resume_ms, rate_pct, created_at, last_opened_at}`」「`GET /api/library/items/{id}` 详情 + 全部句子 `[{idx,start_ms,end_ms,text}]`」「`POST …/media-ticket` → `{url, expires_in}`;仅 `ready`」。spec §8:上传 5 个端点。本计划假设的确切形状(服务端 snake_case,网页经 `ApiClient` 深度 camelCase):

| 调用 | 假设的请求 / 响应 |
|---|---|
| `GET /api/library/config` | 关:`{enabled:false, link_import:false, asr:false, limits:null}` 或整条 404(旧服务端)→ 都按关闭 |
| `GET /api/library/items?cursor=<opaque>` | `{items: Item[], next_cursor: string \| null}` |
| `GET /api/library/items/{id}` | `Item + {resume_idx: int, segments: [{idx, start_ms, end_ms, text}]}` |
| `PATCH /api/library/items/{id}` | 体 `{title?, resume_ms?, resume_idx?, rate_pct?}` → `Item` |
| `DELETE /api/library/items/{id}` | 204 或 `{}` |
| `POST /api/library/items/{id}/retry`、`/cancel` | → `Item` |
| `PUT /api/library/items/{id}/subtitles` | multipart 字段 `file` → `Item`(状态回到 `queued`) |
| `POST /api/library/items/{id}/media-ticket` | → `{url: "/api/library/items/<id>/media?ticket=<t>", expires_in: 1800}` |
| `GET /api/library/items/{id}/poster` | `image/jpeg`(Bearer) |
| `POST /api/library/uploads` | 体 `{filename, size, title?}` → `{item_id, chunk_bytes: 8388608}` |
| `GET /api/library/uploads/{id}` | → `{upload_received, upload_total}` |
| `PUT /api/library/uploads/{id}/chunks/{n}` | multipart 字段 `chunk` → `{upload_received, upload_total}`;次序不对 → **409**(R-L8) |
| `PUT /api/library/uploads/{id}/subtitles` | multipart 字段 `file` → 任意 JSON |
| `POST /api/library/uploads/{id}/complete` | → `Item`(`status: "queued"`) |
| `POST /api/library/imports`(S2) | 体 `{url, title?}` → `Item`;开关关 404 |

- **契约夹具** `server/tests/fixtures/library_contract.json`(S1 的 `test_library_contract.py` 录制,spec §9)。本计划读取的顶层键:`config`(含 D8 的 `ai`)、`items`、`item_detail`(句子含 D8 的 `zh`、`zh_lang`、`analysis`、`analysis_lang`)、`item_patch`、`upload_start`、`upload_status`、`upload_complete`、`media_ticket`;可选键(缺省时对应用例 `skipIf`,Z 车道负责补齐并去掉跳过):`import`(S2 追加)、`translate`、`analysis`(D8 两个端点的回包)、`error_texts`(全部固定英文错误文本的数组)、`error_kinds`(服务端 `error_kind` 常量数组)。
- **服务端固定错误文本**(spec §9「错误文本是固定的英文字符串」,S1 未定稿;本计划假设如下,`LIBRARY_SERVER_ERRORS` 未命中的一律走通用提示):`Library item not found`、`Not Found`、`Quota exceeded`、`Too many items`、`File too large`、`Unsupported format`、`Daily import limit reached`、`Too many uploads in progress`、`Chunk out of order`、`Chunk too large`、`Upload incomplete`、`Invalid subtitle file`、`Invalid URL`、`Item not ready`、`Invalid state`;D8 追加(同样是假设):`Daily AI limit reached`(分析额度满的 429,spec §9)。限流的通用文本 `Too many requests, please try again later` 由 `~/api/error-messages` 的通用映射处理,不进本表。
- **D8 的端点形状(假设,以 S1 的契约夹具为准;spec §9 引文:「`POST /api/library/items/{id}/translate` D8:`{indices: [int, ≤ 20], native_language}` → `[{idx, zh}]` … 超额度时已有的照常返回、缺的不生成并带 `limited: true`;`library_ai_enabled` 关 404」「`POST …/segments/{idx}/analysis` D8:`{native_language}` → `{analysis, cached}`;额度满 429(固定英文文案)」「`GET config` 的 `ai` 字段」)**:

| 调用 | 假设的请求 / 响应 |
|---|---|
| `GET /api/library/config` | 开:`{enabled:true, link_import, asr, ai, limits}`;`ai` = `library_ai_enabled` 为真(spec §5.2) |
| `GET /api/library/items/{id}` 的句子 | `{idx, start_ms, end_ms, text, zh, zh_lang, analysis, analysis_lang}`,后四个可空(spec §4 的四列;`analysis` 可能很长,网页列表不显示它) |
| `POST /api/library/items/{id}/translate` | 体 `{indices: int[≤20], native_language}` → `{items: [{idx, zh}], limited?: boolean}`;网页同时容忍裸数组 `[{idx, zh}]`(spec 的箭头写法);`library_ai_enabled` 关 404 |
| `POST /api/library/items/{id}/segments/{idx}/analysis` | 体 `{native_language}` → `{analysis: string, cached: boolean}`;额度满 429;AI 关 404 |

`native_language` 用 `settings` 的 `nativeLanguageCode(language)`(`en-US` / `zh-CN` / `es-ES`);服务端只接受白名单语言码(spec E11),白名单若与这三个码不同,以 S1 为准,只改 `translation-state.ts` 的一处映射。
- **W2**(spec §15):接管 `shadow-panel.tsx`(保持 R-L16 的导出名与 props),拥有 `locales/*.json` 的 `web.library.shadow` 子树(R-L4),在 `architecture.test.ts` 加 `library->practice`;**D8 增补**:新文件 `segment-menu.tsx`(⋯ 菜单与复制)、`analysis-card.tsx`、并用真实实现替换 W1 的占位 `use-translations.ts`(**保持 R-L32 的导出名与签名**;批量取、去重、失败处理)。W2 使用 W1 的视觉层:`fx/count-up.tsx`(`CountUp`、`GradientText`、`useCountUp`)、`fx/click-spark.tsx`(`ClickSpark`)、`fx/blur-text.tsx`(`BlurText`)、`fx/glass-surface.tsx`(`GlassSurface`)、`library.css` 里的类;W2 自己的样式放它自己的新文件(例如 `shadow.css`),**不改 `library.css`**。W1 不导入任何别的 feature。
- **Z**(spec §15):`features/CLAUDE.md` 的 feature 清单加 library、`main-bundle-baseline.json` 终录、根 README 的功能与未验证一节(R-L22);登出时清本机的 `enjoy-web.library.translate.*`(`auth/device-data.ts` 不是本车道的文件,键里只有条目 id 与布尔值,清不清由编排者定)。底部导航的「练习」**不再**需要给 `/library` 加 `also`(跟读库有自己的标签)。

## 并行与合并顺序(本计划内)

全部串行:L0 → LA → L1 → L2 → L3 → LV1 → LV2 → LV3 → L4 → L5 → L6 → L7 → L8 → L9 → L10 → L11 → L12 → L13 → L14 → L15 → L16。LA(外观设置)只改主包代码、与库其余任务互不依赖,可在 L0 之后由另一个执行者先做;LV1–LV3(视觉层)在 L7 之前完成(L7 起的页面直接用它们);L10–L12(播放逻辑)与 L4–L9(列表与上传)互不依赖,若用两个执行者可在 L3 之后分两路,L13 起汇合。共 21 个任务(L0、LA、L1–L16、LV1–LV3)。

**评审波**:L9 之后与 L15 之后各一次 `/code-review high`;L16 前 `security-review`(URL / 日志 / 错误里没有标题、链接、文字、译文、票据;multipart 文件名中性)。视觉对照只在用户要求时(浏览器窗格 375×812 与 360×740,浅色 + 深色 + 外观三档 + 低端机 `.lite` + 系统「减少动态效果」)。

## 本计划的裁定

- **R-L1 已核对的事实(读真实代码,2026-10-13)。**
  - `web/src/api/client.ts`:只发 `Authorization: Bearer`;`request()` 默认超时 60 s、响应深度 camelCase、请求 JSON 深度 snake_case;`as:"blob"` 取二进制;没有 `keepalive` 选项。→ 媒体用票据(E4),续播卸载时自己 `fetch(…, {keepalive:true})`(R-L14),分片用 `timeoutMs: 180_000`(R-L8)。
  - `web/public/sw.js`:只拦截同源 `/assets/*` 与 `/vad/*`,媒体与 API 不经缓存。✔ 与 spec §2.2 一致。
  - `web/src/i18n/index.ts`:`import.meta.glob("../**/i18n/*.json", {eager:true})`,所有 `i18n/` 文案进主包。→ R-L3。
  - `web/src/architecture.test.ts`:`CROSS_FEATURE_BASELINE.size` 当前为 **18**(spec §2.2 写的「只多一条 `library->practice`」由 W2 加,W1 不加边);`register*.ts(x)` 只能被 `plugins/` 导入且不得导入别的 feature;每个 feature 目录必须有 `index.ts`(所以 L1 先放占位 `index.ts`)。
  - (已作废,见 R-L24)`practiceHome` 扩展点与 `plugins/links-matrix.test.tsx` 的精确列表不再受本计划影响:入口改为底部标签,不再有 `practiceHome` 贡献。
  - `web/src/lib/playback-rate.ts`:全局 `PLAYBACK_RATES = [0.75, 1, 1.25]` 给 TTS 用;库不碰它,自己设 `preservesPitch`(spec §11.4)。
  - `web/scripts/check-main-bundle.mjs`:支持 `--record` 与 `--max-delta=<kB>`;当前基线 396.86 kB(2026-10-12)。
  - `web/src/test/fetch-mock.ts`:按 `"METHOD /path"` 精确匹配,未匹配 404 `{"error":"Not Found"}`,**不理会 `signal`**(所以中止行为在纯函数层测)。
  - jsdom `HTMLMediaElement`:`play()` / `pause()` / `load()` 未实现(只打印),`currentTime` 是可写的普通属性,`paused` 只读 → 播放逻辑用假的媒体对象测,页面测试里 `vi.spyOn(HTMLMediaElement.prototype, "play")`。
  - `web/src/components/bottom-sheet.tsx`、`segmented-control.tsx`(`testId` 选项)、`icon-button.tsx`(其余 props 透传)、`layout/page-header.tsx`(`back`、`subtitle`、`actions`)、`GlassTopBar`(`sticky top-0`,高 52px + 安全区);enjoy `alert-dialog` 导出 `AlertDialogDescription`(`features/wordbook/CLAUDE.md`:不要把它嵌进 `BottomSheet`)。
  - `web/src/layout/bottom-nav.tsx`:`Tab` 数组 + `useRoomsEnabled()` 决定 3 或 4 项(`items`),`<GlassTabBar columns={items.length}>`,`active` 判定是 `[to, ...also].some((base) => under(pathname, base))`(`under` = 等于或以 `base/` 开头,所以 `/library/i1` 高亮、`/libraryx` 不高亮);`components/glass-tab-bar.tsx`:`ul` 的 `grid-template-columns: repeat(N, minmax(0, 1fr))`,项高 `h-14`、11px 标签、24px 图标、无水平内边距 → 360 px 宽 5 列每列 72 px。`layout/bottom-nav.test.tsx` 现有三处 `waitFor(() => expect(mock.calls).toHaveLength(1))` 在多一个 `/api/library/config` 请求后会变成 2 次 → 必须改成只数 `/api/rooms/config`(R-L24)。
  - `web/src/layout/color-scheme.ts`:`initColorScheme(win)` 只读 `prefers-color-scheme` 并切 `html.dark`(没有手动开关);`useIsDark` 用 MutationObserver 跟随 `html.class`;`main.tsx` 在渲染前调用 `initColorScheme()`;`web/index.html` 有两条带 `media` 的 `theme-color`;`styles/theme.css` 有 `:root` 与 `.dark` 两套令牌。`settings/settings-context.tsx`:存储键 `enjoy-web.settings`、逐项校验、写任一项带上其余项的当前值;`settings-context.test.tsx` 有 3 处、`pages/me-page.test.tsx` 有 1 处对**整个存储对象**的 `toEqual`,加字段后必须同步改(R-L25)。`app.tsx` 的 `ThemedToaster` 在测试里不带 `SettingsProvider` 渲染,所以同步逻辑不能放进它里面。
  - `web/src/layout/glass-quality.ts`:低内存设备给 `html` 加 `.lite`;`index.css` 里 `.glass` 的 `@supports` / `html.lite` / `prefers-reduced-transparency` 三层写法是本计划降级段的先例;`index.css` 文档注释的规则:「每屏最多 3 层模糊;模糊元素的祖先不得有 opacity<1 / filter / overflow:hidden+transform;不对模糊元素本身做动画」(R-L26、R-L28)。
  - `web/src/layout/app-shell.tsx`:`<main>` 是 `overflow-y-auto` 的唯一滚动区,底部 `pb-[calc(3.5rem+env(safe-area-inset-bottom))]` 给玻璃底栏留位;`index.css` 把 `html` / `body` 固定(`styles/viewport-lock.test.ts` 守着),文档不滚。`position: sticky; bottom: 0` 的元素贴的是滚动区(含内边距)的下沿,会被底栏盖住 → 旧版 L14 的 `sticky bottom-0` 控制条会落在底栏后面,R-L33 改版。
  - `web/src/features/lookup/lookup-bar.tsx`(**已合并**):选词操作条 `absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40`,挂在 `AppShell` 根(`relative`)下,在底栏之上、`z-40`;所以播放器的控制胶囊 `z-index ≤ 30`,句子文字区必须可选(`user-select: text`),选区稳定 300 ms 后查词层才开(R-L33;与 `2026-10-13-lookup-dictionary.md` 的操作条一致)。
  - `web/src/features/chat/conversation-page.tsx:189` 的先例:`canTranslate = native !== "en-US"`(英文界面没有可译的目标语言);`nativeLanguageCode(language)` 在 `settings/settings-context.tsx`(R-L32)。
  - `web/src/settings/settings-context.tsx` 的初始化器:`readStored().language ?? detectLanguage(navigator.language)`,再 `i18n.changeLanguage(initial)`;jsdom 的 `navigator.language` 是 `en-US` → `renderWithProviders` 会把测试里手动设的 `zh-CN` 改回 `en`;仓库里别处的中文页面测试都先写 `localStorage["enjoy-web.settings"]`(见 `features/rooms/CLAUDE.md`)→ 旧版本计划里「只调 `i18n.changeLanguage("zh-CN")`」的写法第一次运行就会失败(R-L36)。
  - `web/vite.config.ts`:`test.css = false`,测试里 `import "./library.css"` 是空模块;样式只能靠读源码文件断言(`library-css.test.ts`),真实渲染标「未验证」。
- **R-L2 Task 0 只有体积基线。** spec §15 的 spike S0 / S1 / S2 都属于服务端车道,W1 没有点名的 spike;§11.5 要求「基线以计划 P0 用 `--record` 重录」,所以 L0 = 前置核对 + 重录基线 + 在结果文档追加 W1 一节。
- **R-L3 文案拆两处(偏离 spec §11.5 的文件位置,不偏离预算)。** spec 写「文案 `features/library/i18n/{en,zh-CN}.json`」同时给主包文案预算 ≤ 1.0 kB gzip,并在 E9 指定 `web.nav.library` 进主包;库的界面文案(约 170 个键 × 2 种语言,含 DRM 长句与 24 种错误原因)放进 eager 的 `i18n/` 会远超 1.0 kB。裁定:`i18n/{en,zh-CN}.json` 只放 `web.nav.library`(`Library` / `跟读库`,标签文字 ≤ 8 个英文字符 / ≤ 4 个汉字,E9),其余放 `locales/`,由懒块里每个用到它们的模块 `import "./locales"`(`addResourceBundle`,深合并、不覆盖)。先例:agents R-W3、wordbook R-DW1。`library-lazy.test.ts` 守住「主包模块不导入 `./locales`」。`i18n/index.ts` 对同名对象做 `deepMerge`,所以 `web.nav` 在 `src/i18n/*.json` 与 `features/library/i18n/*.json` 两处各写一部分不会互相覆盖;西语没有 `web.*` 键,回落英文(`Library`)。
- **R-L4 W2 的文案子树。** W2 的文件清单里没有 json,而它的跟读面板需要文案。W1 在 `locales/*.json` 预置 `web.library.shadow.*`(录音 / 停止 / 评测中 / 听我的 / 听原句 / 加入练习清单 / 已加入 / 微调 / 起点终点 ±0.2 s / 文字 / 保存 / 取消 / 最好成绩 / 次数 / 不可用);**该子树归 W2**,W2 可增删改其中的键(en 与 zh-CN 同步),W1 之后不再动。这是对「一个文件一个所有者」的唯一例外,写在共享文件表里。
- **R-L5(作废,2026-10-13 起由 R-L24 取代)** 入口卡 / `practiceHome` 贡献 / `register.tsx` / `plugins/index.ts` 与 `links-matrix.test.tsx` 的改动全部不做;`web/src/plugins/` 不再是本车道的文件。
- **R-L6 路由写在 `app.tsx`(spec §11.1),不用 `contributeRoute`。** 页面自己按开关处理:开关未到 → 转圈;到了且关闭 → `<Navigate to="/practice" replace />`(与 `LinkRoute` 的行为一致);旧服务端 404 = 关闭。列表页每次进入重新取一次 config(要最新的 `used_bytes`),底部标签(`useLibraryEnabled`)与播放页用按 `ApiClient` 缓存的 `useLibraryConfig`(同 `useWordbookConfig`、`useRoomsEnabled`)。列表页是标签的根页,**没有返回按钮**(R-L34)。
- **R-L7 上传流程。** ① `POST /uploads`(JSON 带原文件名、大小、可选标题)② **若带字幕,紧接着 `PUT /uploads/{id}/subtitles`**(spec §8 把字幕列为第 3 步,只要求在 `complete` 之前;提前到分片之前是为了字幕格式不对时立即失败,不必先传几百 MB)③ 分片逐片串行 ④ `complete`。续传(同会话失败后「重试」或刷新后「继续上传」)先 `GET /uploads/{id}` 取 `upload_received`,大小与 `upload_total` 不同 → `UploadMismatchError`,不传任何分片;续传不再传字幕。
- **R-L8 分片重试与重新对齐。** 可重试 = `ApiError.status` 为 0(网络 / 超时,且不是用户中止)、429、≥ 500;每片最多重试 3 次(共 4 次),间隔 1 s / 2 s / 4 s;其他 4xx 立即失败。409(假设的「次序不对」状态码)→ 查 `GET /uploads/{id}` 后从服务端的 `upload_received` 继续,最多 3 次。同一片重复发送由服务端按幂等处理(spec §8)。分片请求超时 180 s(8 MiB 在慢速手机网络上可能超过默认 60 s)。multipart 文件名中性(`chunk`、`subtitles.srt|vtt`)。
- **R-L9 上传任务的生命周期。** 任务表是模块级单例(`upload-store.ts`),在应用内切页时上传继续;有进行中的任务时挂 `beforeunload` 提示,没有就摘掉(spec §11.3「离开页面前提示」)。用户点「取消」= 中止请求 + `DELETE` 该条目(spec §6.5「删除隐含取消」;上传中的条目没有值得保留的东西)。上传失败(重试用尽、非可重试错误)保留服务端的 `uploading` 条目与本地失败卡:「重试」用同一个 `File` 续传,「关闭」只去掉本地卡(服务端那条仍显示「上传未完成」)。
- **R-L10 刷新后续传的「同一个文件」判定。** 服务端不保存文件名(spec §8「不落盘、不记日志」),所以:`file.size === upload_total` 必须成立(由 `uploadFile` 检查);若本标签页的 `sessionStorage`(`enjoy-web.library.upload.<item_id>`,开始上传时写、完成或取消时删,读写都包 try/catch)记得原文件名,则文件名也必须相同。不满足 → toast「这不是同一个文件」。`sessionStorage` 只在本机本标签页,不进任何请求。
- **R-L11 列表轮询。** 有 `queued` / `processing` 条目时每 3 s 重新取**第一页**并按 id 合并(更新已有的、把新出现的放到最前、保留已加载的后续页);页面不可见时停,回到可见时立即取一次再恢复;`uploading` 状态由本地上传驱动,不触发轮询;轮询出错静默,下一轮再试。
- **R-L12 失败卡的动作。** 显示 `error_kind` 的本地化原因(24 种 + 未知);「补传字幕」只给 `no_subtitles`、`bad_subtitle`;「重试」给除下列以外的全部:`too_large`、`too_long`、`corrupt`、`no_audio`、`bad_subtitle`、`no_subtitles`、`unsupported_format`、`upload_expired`、`link_disabled`、`bad_url`、`drm`、`private`、`playlist_unsupported`、`live_unsupported`、`unsupported_site`(重试必然再失败);「删除」总是有。`drm` 与 `blocked` 用 spec §7.3 / §7.4 的专门文案(`blocked` 把「本机下载后上传」列第一)。`canceled` 只有删除。删除要二次确认(enjoy `AlertDialog`,不在抽屉里)。
- **R-L13 播放器语义。** ① 不显示原生 `controls`,只用自己的控制条;视频 `playsInline`、`preload="metadata"`。② 播放中用 `requestAnimationFrame` 轮询 `currentTime`(spec §11.4),只在播放时排帧,暂停即取消。③ 循环:「关」= 自然播放、当前句随时间推进;「无限」= 到 `end + 250 ms` 回到 `start − 150 ms`(不小于 0);「3 / 5」= 每句各播 N 遍后自然进入下一句,下一句同样播 N 遍;一句的 N 遍播完后若与下一句之间有空隙,不再回跳(`released` 标记)。④ 点句子 / 上一句 / 下一句 = 跳到 `start − 150 ms` 并播放。⑤ 速度 0.5 / 0.75 / 1 / 1.25,同时设 `playbackRate`、`defaultPlaybackRate`(换 src 后不丢)与 `preservesPitch` / `webkitPreservesPitch`;改速度立即 `PATCH rate_pct`(50 / 75 / 100 / 125);条目上的 `rate_pct` 取最接近的档位;**界面是点「1×」芯片弹出的弹性滑块,吸附四档(R-L31)**,`nextRate` 保留并测试但播放页不再调用。⑥ 「只播这一句」(`playOnce`,给 W2 的「听原句」)到 `end + 250 ms` 暂停。⑦ `play()` 被拒(iOS 无手势)不抛,状态保持暂停。
- **R-L14 续播保存。** 播放中每 1 s 采样一次位置,距上次保存 ≥ 5 s 才 `PATCH {resume_ms, resume_idx}`(spec §11.4);暂停时立即普通 `PATCH`;页面隐藏(`visibilitychange` → hidden)、`pagehide` 与卸载时用 `fetch(…, {method:"PATCH", keepalive:true, headers:{Authorization:"Bearer …"}})`(`sendBeacon` 带不了头),令牌取自 `~/api/auth-storage` 的 `loadAuth()`;位置与上次保存的相同则不发。进入播放页时在 `loadedmetadata` 后 `restore(resume_ms, resume_idx)` 一次。
- **R-L15 票据换新。** 进入就绪条目时取一次票据;`<video>/<audio>` 触发 `error` 时记下 `currentTime` 与是否在播,重新取票并设新 `src`,`loadedmetadata` 后恢复位置与播放;连续失败 2 次(中间没有 `playing`)就停止换票,显示「媒体加载失败」+「重试」。不做定时预换(票据多次可用、30 分钟,spec §10)。票据 URL 只放在 `src`,不打印、不进错误。
- **R-L16 W2 的接缝:`shadow-panel.tsx`。** W1 建立占位,导出且只导出:
  `export interface ShadowPanelProps { itemId: string; segment: LibrarySegment; active: boolean; durationMs: number; prevEndMs: number | null; nextStartMs: number | null; player: PlayerHandle | null; onSegmentSaved(next: LibrarySegment): void }`、
  `export function ShadowPanel(props: ShadowPanelProps): ReactElement | null`(占位返回 `null`)、
  `export interface SegmentTextProps { segment: LibrarySegment; active: boolean }`、
  `export function SegmentText(props: SegmentTextProps): ReactElement`(占位渲染纯文本)。
  `segment-list.tsx` 在每一行渲染 `<SegmentText>`(句子文字,W2 换成逐词 `span` + `data-lookup-context`)与 `<ShadowPanel>`(句子下方,W2 放麦克风 / 星标 / 微调 / 成绩)。`PlayerHandle = Pick<PlayerController, "pause" | "playOnce" | "seekTo" | "getState">`。W2 保存微调后调 `onSegmentSaved(next)`,播放器用新的起止时间。句子文字区的点击 = 跳播,**当前有文本选区时不跳播**(给长按选词留路);W2 的逐词点击应 `stopPropagation()`。
  **增补(D8 / D11,不改上面的签名)**:`segment-list.tsx` 另在句子文字下渲染译文行(只读 `segment.zh` / `zhLang`,R-L32)并给当前句加 `.lib-glow` 描边;`ShadowPanel` 仍在每行的句子下方。W2 的 ⋯ 菜单与 AI 分析卡也挂在行内(spec §11.4:⋯ 在话筒旁)。**行容器对非当前句启用 `content-visibility: auto`,它带 paint containment:行内的弹出层必须走 portal 或只在当前句出现**(R-L17)。
- **R-L17 句子列表。** `SegmentList` **自带滚动容器**(`.lib-segments`,`flex: 1; min-height: 0; overflow-y: auto`;播放器根是自己的 flex 列,不靠 `<main>` 或文档滚动,R-L33);当前句高亮(`aria-current` + 玻璃底 + `.lib-glow` 流动描边,R-L29)并 `scrollIntoView({block:"center"})`(系统「减少动态效果」或 `.lite` 时 `behavior: "auto"`);用户在列表上 `wheel` / `touchmove` 后 3 s 内不抢滚动;**非当前行** `content-visibility: auto` + `contain-intrinsic-size: auto 72px`(spec §11.5,不引虚拟列表库;当前行不用,否则 paint containment 会裁掉它的投影与描边);盲听时文字与译文都不在 DOM 里(只有「显示这句」按钮),点一下只显示那一句,切换盲听时清空已显示集合。
- **R-L18 列表卡片。** 封面只给 `ready` 的视频,进入视口(`IntersectionObserver`,`rootMargin: 200px`)才用 Bearer 取 blob,卸载时 `revokeObjectURL`;音频与未就绪显示图标。卡片的元信息:时长 · 句数(仅 ready)· 大小(> 0 时);字幕来源用灰色徽标。`ready` 卡整行是链接,其他卡不可点。大小以 MiB 计(`MIB = 1024²`)、≥ 1024 MiB 显示 GB;客户端的大小 / 配额预检同样按 MiB,服务端为准。
- **R-L19 添加素材弹层。** 底部抽屉 + 分段控件(上传 / 链接),不单独路由(spec §11.1)。上传页签:文件(`accept` = `audio/*,video/*` + 白名单扩展名)、可选字幕(`.srt,.vtt`,≤ 2 MiB)、可选标题(≤ 200 字);提交前预检扩展名 / 空文件 / 单文件上限 / 剩余配额 / 字幕;`asr === false` 且没选字幕时显示琥珀色提示「没有字幕时本服务器无法自动转写」。提交即关闭抽屉,上传在列表顶部的本地卡上进行。链接页签:DRM 文案常驻(spec §7.4);`link_import === false` 时只显示「管理员没有开启链接导入」;客户端只校验 http(s)、无用户信息、≤ 2000 字,其余(SSRF、站点)由服务端判定;导入时的 404 译为「管理员没有开启链接导入」。
- **R-L20 未做的界面(spec §11 没有要求的)。** 改标题、给 `ready` 条目替换字幕的入口不做;`patchItem({title})` 与 `putItemSubtitles` 已在 API 层提供(后者被失败卡使用)。记入 `features/library/CLAUDE.md`。
- **R-L21 契约测试。** `library-contract.test.ts` 读 S1 的夹具(W1 在 S1 之后合并,所以「夹具存在」这一条从不跳过);逐键比对类型键表;票据 URL 必须是同源路径且查询串只有 `ticket`;可选键 `import`、`error_texts`、`error_kinds` 缺省时对应用例 `it.skipIf` 并在测试名写明「Z 补齐」。
- **R-L22 不在本车道的跟进(2026-10-13 修订)。** `features/CLAUDE.md` 的 feature 清单、`web/e2e` 的守卫与用例、`auth/device-data.ts` 登出清理 `enjoy-web.library.translate.*` 都不是 W1 的文件(spec §15),交给 Z;L16 在结果文档里列为「未做(归 Z)」。**底部导航「练习」在 `/library/*` 高亮不再需要**:跟读库有自己的标签(R-L24)。
- **R-L23 体积。** 主包只多:`config.ts`、`use-library-enabled.ts`、`lazy-pages.tsx`、`page-status.tsx`、`index.ts`、一条标签文案 `web.nav.library`、`layout/bottom-nav.tsx` 的一个标签与 `app.tsx` 的两条路由(外观设置另计,R-L35)。`library-lazy.test.ts` 静态检查这些模块不导入 `./locales`、`./library-api`、`./library-root`、`./library.css`、`./fx/*` 与页面模块。L16 用 `--max-delta=1.5` 检查并把前后数字与懒块实数、`library.css` 的 gzip 大小写进结果文档;超了不放宽,先把超出的部分挪进懒块。
- **R-L24 至 R-L36(2026-10-13 增补)** 见文末「Addendum (2026-10-13)」:入口 = 底部标签(取代 R-L5)、外观设置、模糊层预算、视觉层作用域与降级、动画属性例外、极光范围、弹性速度滑块、译文接缝、播放器版式与视口锁、列表页、体积记账、契约键、测试语言。它们覆盖正文里与之冲突的旧文字。

---
## Task L0: 前置核对与主包基线(R-L2)

**Files:**
- Modify: `web/scripts/main-bundle-baseline.json`(脚本生成)
- Create or append: `docs/superpowers/plans/2026-10-13-video-import-results.md`

- [ ] **Step 1: 确认 S1 已合并** — W1 读 S1 录制的契约夹具,必须在 S1 之后开工:

```bash
cd /e/workspace/everyone-can-use-english
test -f server/tests/fixtures/library_contract.json && echo "S1 fixture present" || echo "STOP: S1 not merged"
git log --oneline -3 -- server/tests/fixtures/library_contract.json
```

输出 `STOP` 就停下,回报「S1 未合并」,不要继续。

- [ ] **Step 2: 复核 R-L1 的事实**(任何一条不成立都停下回报,不要改别人的文件):

```bash
cd /e/workspace/everyone-can-use-english/web
grep -n "Authorization" src/api/client.ts
grep -n 'startsWith("/assets/")' public/sw.js
grep -n 'import.meta.glob' src/i18n/index.ts
grep -n "CROSS_FEATURE_BASELINE.size).toBe(" src/architecture.test.ts
grep -n "GlassTabBar" src/layout/bottom-nav.tsx
grep -n "useRoomsEnabled" src/layout/bottom-nav.tsx
grep -n "prefers-color-scheme" src/layout/color-scheme.ts
grep -n "roomVoiceAutoText" src/settings/settings-context.tsx
grep -n "html.lite" src/index.css
grep -n 'bottom-\[calc(4.5rem' src/features/lookup/lookup-bar.tsx
grep -n "max-delta" scripts/check-main-bundle.mjs
ls src/features | grep -x library && echo "STOP: features/library already exists" || echo "ok: no library dir yet"
```

若 `CROSS_FEATURE_BASELINE.size` 已不是 18(别的计划先合并了),只记录实际数字,W1 不改它。

- [ ] **Step 3: 重录基线** — 在 S1 已合并、W1 尚无代码的提交上:

```bash
cd /e/workspace/everyone-can-use-english
yarn web:build
cd web && node scripts/check-main-bundle.mjs --record
```

- [ ] **Step 4: 结果文档追加 W1 一节** — 若 `docs/superpowers/plans/2026-10-13-video-import-results.md` 不存在,先写一行标题 `# 跟读库 · 实测结果` 与一个空行;然后在**文件末尾**追加(不改别的节),把 Step 3 的输出原样填进去:

```markdown
## W1 网页库与播放器(计划 2026-10-13-video-import-web-library)

### L0 主包基线
- 提交:<git rev-parse --short HEAD 的输出>
- `node scripts/check-main-bundle.mjs --record`:
  - `main bundle: <x> kB gzip (...)`
  - `baseline recorded: ...`
- R-L1 核对:全部成立 / <不成立的条目与实际值>

### LA 外观设置的主包增量(R-L35)
(LA 填写)

### L16 合并前实测
(L16 填写)

### 未验证(W1)
(L16 填写)
```

- [ ] **Step 5: 提交**

```bash
git add web/scripts/main-bundle-baseline.json docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "chore(web): record main bundle baseline before the library feature

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task LA: 全站外观设置「跟随系统 / 浅色 / 深色」(D12;R-L25、R-L35)

**Files:**
- Create: `web/src/settings/color-scheme-pref.ts`、`web/src/settings/color-scheme-pref.test.ts`、`web/src/layout/color-scheme-sync.tsx`、`web/src/layout/color-scheme-sync.test.tsx`、`web/src/layout/color-scheme.test.ts`
- Modify: `web/src/settings/settings-context.tsx`(整文件)、`web/src/settings/settings-context.test.tsx`、`web/src/settings/CLAUDE.md`;`web/src/layout/color-scheme.ts`(整文件)、`web/src/layout/CLAUDE.md`;`web/src/app.tsx`(两处);`web/src/pages/me-page.tsx`、`web/src/pages/me-page.test.tsx`、`web/src/pages/i18n/en.json`、`web/src/pages/i18n/zh-CN.json`、`web/src/pages/CLAUDE.md`;`web/scripts/main-bundle-baseline.json`(末尾重录)

**Interfaces:**
- Produces:`COLOR_SCHEMES`、`ColorScheme`、`DEFAULT_COLOR_SCHEME`、`SETTINGS_KEY`、`isColorScheme`、`readStoredColorScheme()`(`settings/color-scheme-pref.ts`);`useSettings()` 多出 `colorScheme` 与 `setColorScheme`;`resolveDark(scheme, systemDark)`、`applyColorScheme(scheme, win?)`、`initColorScheme(win?, scheme?)`、`useApplyColorScheme(scheme)`(`layout/color-scheme.ts`;`useIsDark` 不变);`ColorSchemeSync`(`layout/color-scheme-sync.tsx`)
- 不改 `main.tsx`:`initColorScheme()` 的第二个参数默认读存储,渲染前就应用,首屏不闪。

- [ ] **Step 1: 写失败测试**

`web/src/settings/color-scheme-pref.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, SETTINGS_KEY, isColorScheme, readStoredColorScheme } from "./color-scheme-pref";

describe("stored colour scheme (D12, R-L25)", () => {
  beforeEach(() => localStorage.clear());

  it("offers system, light and dark and defaults to system", () => {
    expect([...COLOR_SCHEMES]).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_COLOR_SCHEME).toBe("system");
    expect(isColorScheme("dark")).toBe(true);
    expect(isColorScheme("sepia")).toBe(false);
    expect(isColorScheme(undefined)).toBe(false);
  });

  it("reads a valid stored value and ignores everything else", () => {
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "zh-CN", colorScheme: "dark" }));
    expect(readStoredColorScheme()).toBe("dark");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ colorScheme: "sepia" }));
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "en" }));
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, "not json");
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(["dark"]));
    expect(readStoredColorScheme()).toBe("system");
  });
});
```

`web/src/settings/settings-context.test.tsx` —— 三处现有断言先改(加了字段,整个对象的 `toEqual` 不再成立):
1. 第 27 行 `expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toEqual({ language: "zh-CN", roomVoiceAutoText: false });` → `…toEqual({ language: "zh-CN", roomVoiceAutoText: false, colorScheme: "system" });`
2. `stored()` 的两处:`expect(stored()).toEqual({ language: "zh-CN", roomVoiceAutoText: true });` → `{ language: "zh-CN", roomVoiceAutoText: true, colorScheme: "system" }`;`expect(stored()).toEqual({ language: "en", roomVoiceAutoText: true });` → `{ language: "en", roomVoiceAutoText: true, colorScheme: "system" }`。

然后在顶层 `describe("settings", …)` 里、`roomVoiceAutoText` 的 `describe` 之后加:

```tsx
  describe("colorScheme (D12)", () => {
    function SchemeProbe() {
      const { colorScheme, setColorScheme, setLanguage, setRoomVoiceAutoText } = useSettings();
      return (
        <>
          <span data-testid="scheme">{colorScheme}</span>
          <button onClick={() => setColorScheme("dark")}>dark</button>
          <button onClick={() => setLanguage("en")}>en</button>
          <button onClick={() => setRoomVoiceAutoText(true)}>auto</button>
        </>
      );
    }
    const stored = () => JSON.parse(localStorage.getItem("enjoy-web.settings")!);

    it("defaults to system for old storage and keeps the other preferences when it changes", async () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN", roomVoiceAutoText: true }));
      render(<SettingsProvider><SchemeProbe /></SettingsProvider>);
      expect(screen.getByTestId("scheme")).toHaveTextContent("system");
      await act(async () => screen.getByRole("button", { name: "dark" }).click());
      expect(screen.getByTestId("scheme")).toHaveTextContent("dark");
      expect(stored()).toEqual({ language: "zh-CN", roomVoiceAutoText: true, colorScheme: "dark" });
      await act(async () => screen.getByRole("button", { name: "en" }).click());
      expect(stored()).toEqual({ language: "en", roomVoiceAutoText: true, colorScheme: "dark" });
      await act(async () => { await i18n.changeLanguage("en"); });
    });

    it("falls back to system for a corrupt value without touching the other fields", () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en", roomVoiceAutoText: true, colorScheme: 3 }));
      render(<SettingsProvider><SchemeProbe /></SettingsProvider>);
      expect(screen.getByTestId("scheme")).toHaveTextContent("system");
    });

    it("keeps the colour scheme when the room voice switch is turned on", async () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en", colorScheme: "light" }));
      render(<SettingsProvider><SchemeProbe /></SettingsProvider>);
      await act(async () => screen.getByRole("button", { name: "auto" }).click());
      expect(stored()).toEqual({ language: "en", roomVoiceAutoText: true, colorScheme: "light" });
    });
  });
```

`web/src/layout/color-scheme.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyColorScheme, initColorScheme, resolveDark } from "./color-scheme";

const html = document.documentElement;

/** 假的 window:系统是否深色、以及触发「系统主题变了」。 */
function fakeWindow(systemDark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: systemDark,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  const win = Object.assign(Object.create(window), { matchMedia: () => mq, document }) as Window;
  return { win, mq, fire: () => listeners.forEach((f) => f()), listeners };
}

const metas = () => [...document.querySelectorAll("meta[name='theme-color']")];

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#0F1013" media="(prefers-color-scheme: dark)">';
});
afterEach(() => {
  html.classList.remove("dark");
  document.head.innerHTML = "";
});

describe("resolveDark (D12)", () => {
  it.each([
    ["system", true, true], ["system", false, false], ["light", true, false], ["light", false, false],
    ["dark", true, true], ["dark", false, true],
  ] as const)("%s with a dark system = %s → %s", (scheme, systemDark, expected) => {
    expect(resolveDark(scheme, systemDark)).toBe(expected);
  });
});

describe("applyColorScheme / initColorScheme", () => {
  it("follows the system while the scheme is system, including live changes", () => {
    const { win, mq, fire } = fakeWindow(true);
    const stop = initColorScheme(win, "system");
    expect(html.classList.contains("dark")).toBe(true);
    mq.matches = false;
    fire();
    expect(html.classList.contains("dark")).toBe(false);
    stop();
  });

  it("ignores the system when the scheme is fixed, and a later choice wins over earlier ones", () => {
    const { win, mq, fire } = fakeWindow(false);
    const stop = initColorScheme(win, "dark");
    expect(html.classList.contains("dark")).toBe(true);
    mq.matches = false;
    fire();
    expect(html.classList.contains("dark")).toBe(true);
    mq.matches = true;
    applyColorScheme("light", win);
    expect(html.classList.contains("dark")).toBe(false);
    fire(); // 系统主题变化后仍保持「浅色」(偏好是模块级的,不是 init 时的快照)
    expect(html.classList.contains("dark")).toBe(false);
    applyColorScheme("system", win);
    expect(html.classList.contains("dark")).toBe(true);
    stop();
  });

  it("reads the stored preference at start-up when none is passed", () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ colorScheme: "dark" }));
    const { win } = fakeWindow(false);
    const stop = initColorScheme(win);
    expect(html.classList.contains("dark")).toBe(true);
    stop();
    localStorage.removeItem("enjoy-web.settings");
  });

  it("stops listening to the system once cleaned up", () => {
    const { win, listeners } = fakeWindow(false);
    const stop = initColorScheme(win, "system");
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("gives both theme-color metas one colour while fixed and restores them for system", () => {
    const { win } = fakeWindow(false);
    applyColorScheme("dark", win);
    expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#0F1013", "#0F1013"]);
    expect(metas().every((m) => !m.hasAttribute("media"))).toBe(true);
    applyColorScheme("light", win);
    expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#ffffff", "#ffffff"]);
    applyColorScheme("system", win);
    expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#ffffff", "#0F1013"]);
    expect(metas().map((m) => m.getAttribute("media"))).toEqual(["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]);
  });

  it("works on a page without theme-color metas and on a window without matchMedia", () => {
    document.head.innerHTML = "";
    const bare = Object.assign(Object.create(window), { matchMedia: undefined, document }) as Window;
    expect(() => applyColorScheme("dark", bare)).not.toThrow();
    expect(html.classList.contains("dark")).toBe(true);
    expect(() => applyColorScheme("system", bare)).not.toThrow();
    expect(html.classList.contains("dark")).toBe(false);
  });
});
```

`web/src/layout/color-scheme-sync.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsProvider, useSettings } from "~/settings/settings-context";
import { ColorSchemeSync } from "./color-scheme-sync";

const html = document.documentElement;

function Probe() {
  const { colorScheme, setColorScheme } = useSettings();
  return <button onClick={() => setColorScheme("dark")}>{colorScheme}</button>;
}

afterEach(() => {
  html.classList.remove("dark");
  localStorage.clear();
});

describe("ColorSchemeSync (D12)", () => {
  it("applies the stored scheme on mount and follows changes made in 我的", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ colorScheme: "light" }));
    html.classList.add("dark");
    render(<SettingsProvider><ColorSchemeSync /><Probe /></SettingsProvider>);
    expect(html.classList.contains("dark")).toBe(false);
    await act(async () => screen.getByRole("button").click());
    expect(html.classList.contains("dark")).toBe(true);
  });

  it("is mounted inside SettingsProvider in app.tsx", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const app = readFileSync(path.resolve(here, "../app.tsx"), "utf8");
    expect(app).toMatch(/<SettingsProvider>\s*<ColorSchemeSync \/>/);
  });
});
```

`web/src/pages/me-page.test.tsx` —— 先把第 100 行(现有的整个存储对象断言)改成:`expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toEqual({ language: "zh-CN", roomVoiceAutoText: true, colorScheme: "system" });`;第 1 行的导入改为 `import { screen, waitFor, within } from "@testing-library/react";`;再在 `describe("MePage", …)` 里加:

```tsx
  it("switches the appearance between system, light and dark and remembers it (D12)", async () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    const select = screen.getByTestId("me-color-scheme");
    expect(select).toHaveValue("system");
    expect(within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["system", "light", "dark"]);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Follow system", { selector: "span.num" })).toBeInTheDocument(); // 行右侧的当前值(<option> 里也有同名文字,所以限定选择器)
    await userEvent.selectOptions(select, "dark");
    expect(select).toHaveValue("dark");
    expect(screen.getByText("Dark", { selector: "span.num" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toMatchObject({ colorScheme: "dark" });
    await userEvent.selectOptions(select, "system");
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toMatchObject({ colorScheme: "system" });
  });

  it("has the appearance copy in both languages", () => {
    for (const [lang, title, dark] of [["en", "Appearance", "Dark"], ["zh-CN", "外观", "深色"]] as const) {
      expect(i18n.getFixedT(lang)("web.me.colorScheme")).toBe(title);
      expect(i18n.getFixedT(lang)("web.me.colorSchemeOptions.dark")).toBe(dark);
    }
  });
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/settings src/layout/color-scheme.test.ts src/layout/color-scheme-sync.test.tsx src/pages/me-page.test.tsx`(模块与字段不存在 / 断言不符)。

- [ ] **Step 3: 实现**

`web/src/settings/color-scheme-pref.ts`:

```ts
import { readJson } from "~/lib/storage";

/** 本机偏好的存储键(与 settings-context 共用同一个对象:语言、联机语音自动转文字、外观)。 */
export const SETTINGS_KEY = "enjoy-web.settings";

/** 「我的 → 外观」(spec D12):跟随系统(默认)/ 浅色 / 深色。只存在本机,不上传。 */
export const COLOR_SCHEMES = ["system", "light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];
export const DEFAULT_COLOR_SCHEME: ColorScheme = "system";

export const isColorScheme = (value: unknown): value is ColorScheme => (COLOR_SCHEMES as readonly unknown[]).includes(value);

const isObject = (value: unknown): value is { colorScheme?: unknown } => typeof value === "object" && value !== null && !Array.isArray(value);

/** 读存储里的外观;缺失、损坏、非法值一律回落「跟随系统」。不依赖 React 与 i18n,main.tsx 渲染前就能用。 */
export function readStoredColorScheme(): ColorScheme {
  const value = readJson(SETTINGS_KEY, isObject)?.colorScheme;
  return isColorScheme(value) ? value : DEFAULT_COLOR_SCHEME;
}
```

`web/src/settings/settings-context.tsx`(整文件替换):

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import i18n, { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { readJson, writeJson } from "~/lib/storage";
import { DEFAULT_COLOR_SCHEME, SETTINGS_KEY, isColorScheme, type ColorScheme } from "./color-scheme-pref";

interface SettingsValue {
  language: UiLanguage;
  setLanguage(language: UiLanguage): void;
  /** 「我的 → 联机语音自动转文字」(spec 2026-10-10 §4.7,R2-9:存在本设备,默认关) */
  roomVoiceAutoText: boolean;
  setRoomVoiceAutoText(value: boolean): void;
  /** 「我的 → 外观」(spec 2026-10-13 D12:存在本设备,默认跟随系统);应用到 html.dark 由 layout/color-scheme-sync 负责 */
  colorScheme: ColorScheme;
  setColorScheme(value: ColorScheme): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

interface StoredSettings { language?: unknown; roomVoiceAutoText?: unknown; colorScheme?: unknown }
const isObject = (v: unknown): v is StoredSettings => typeof v === "object" && v !== null && !Array.isArray(v);

interface Stored { language: UiLanguage | null; roomVoiceAutoText: boolean; colorScheme: ColorScheme }

/** 逐项校验存储(旧版本只有 language;损坏的项各自回落默认值,不连累其他项)。 */
function readStored(): Stored {
  const raw = readJson(SETTINGS_KEY, isObject);
  const language = SUPPORTED_LANGUAGES.includes(raw?.language as UiLanguage) ? (raw?.language as UiLanguage) : null;
  const scheme = raw?.colorScheme;
  return {
    language,
    roomVoiceAutoText: raw?.roomVoiceAutoText === true,
    colorScheme: isColorScheme(scheme) ? scheme : DEFAULT_COLOR_SCHEME,
  };
}

export function detectLanguage(navLang?: string): UiLanguage {
  const lang = (navLang ?? "").toLowerCase();
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("es")) return "es";
  return "en";
}

export function nativeLanguageCode(language: UiLanguage): "en-US" | "zh-CN" | "es-ES" {
  return language === "zh-CN" ? "zh-CN" : language === "es" ? "es-ES" : "en-US";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>(() => {
    const initial = readStored().language ?? detectLanguage(typeof navigator === "undefined" ? undefined : navigator.language);
    // 资源是内联的,changeLanguage 同步生效;放在初始化器里避免首屏先闪一下默认语言。
    if (i18n.language !== initial) void i18n.changeLanguage(initial);
    return initial;
  });
  const [roomVoiceAutoText, setAutoTextState] = useState(() => readStored().roomVoiceAutoText);
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(() => readStored().colorScheme);
  // 三项共用一个存储键:写一项时带上其余项的当前值
  const current = useRef({ language, roomVoiceAutoText, colorScheme });
  current.current = { language, roomVoiceAutoText, colorScheme };
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);
  const persist = useCallback((patch: Partial<typeof current.current>) => {
    current.current = { ...current.current, ...patch };
    writeJson(SETTINGS_KEY, current.current);
  }, []);
  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next);
    persist({ language: next });
  }, [persist]);
  const setRoomVoiceAutoText = useCallback((next: boolean) => {
    setAutoTextState(next);
    persist({ roomVoiceAutoText: next });
  }, [persist]);
  const setColorScheme = useCallback((next: ColorScheme) => {
    setColorSchemeState(next);
    persist({ colorScheme: next });
  }, [persist]);
  const value = useMemo(
    () => ({ language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText, colorScheme, setColorScheme }),
    [language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText, colorScheme, setColorScheme],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
```

`web/src/layout/color-scheme.ts`(整文件替换;`useIsDark` 与 `subscribeDarkClass` 原样保留):

```ts
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_COLOR_SCHEME, readStoredColorScheme, type ColorScheme } from "~/settings/color-scheme-pref";

/**
 * 暗色模式沿用桌面端的 .dark 主题变量。外观偏好(spec D12):system = 跟随系统(默认),light / dark = 固定。
 * 偏好是模块级的:系统主题变化的监听用的是「当前」偏好,而不是 init 时的快照。
 */
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** 与 web/index.html 的两条 theme-color 一致 */
const THEME_COLOR = { light: "#ffffff", dark: "#0F1013" } as const;

let preference: ColorScheme = DEFAULT_COLOR_SCHEME;

export function resolveDark(scheme: ColorScheme, systemDark: boolean): boolean {
  return scheme === "dark" || (scheme === "system" && systemDark);
}

/**
 * index.html 的两条 theme-color 带 media,固定为浅 / 深时系统主题与之相反就会染错状态栏:
 * 固定时让两条都给同一个颜色并去掉 media,回到「跟随系统」时还原(原值存在 data-enjoy-original)。
 * iOS 主屏应用的状态栏 / 地址栏表现未在真机验证。
 */
function syncThemeColor(doc: Document, scheme: ColorScheme, dark: boolean): void {
  doc.querySelectorAll("meta[name='theme-color']").forEach((meta) => {
    if (!meta.hasAttribute("data-enjoy-original")) {
      meta.setAttribute("data-enjoy-original", JSON.stringify({ content: meta.getAttribute("content"), media: meta.getAttribute("media") }));
    }
    const original = JSON.parse(meta.getAttribute("data-enjoy-original") ?? "{}") as { content?: string | null; media?: string | null };
    if (scheme === "system") {
      if (original.content != null) meta.setAttribute("content", original.content);
      if (original.media != null) meta.setAttribute("media", original.media);
      else meta.removeAttribute("media");
    } else {
      meta.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
      meta.removeAttribute("media");
    }
  });
}

/** 把偏好应用到 html:.dark 类、原生控件的 color-scheme、theme-color。 */
export function applyColorScheme(scheme: ColorScheme, win: Window = window): void {
  preference = scheme;
  const systemDark = !!win.matchMedia?.(DARK_QUERY).matches;
  const dark = resolveDark(scheme, systemDark);
  const root = win.document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.setProperty("color-scheme", scheme === "system" ? "" : dark ? "dark" : "light");
  syncThemeColor(win.document, scheme, dark);
}

/** main.tsx 渲染前调用:读存储里的偏好并应用,同时监听系统主题变化。返回清理函数。 */
export function initColorScheme(win: Window = window, scheme: ColorScheme = readStoredColorScheme()): () => void {
  const query = win.matchMedia ? win.matchMedia(DARK_QUERY) : null;
  applyColorScheme(scheme, win);
  const onChange = () => applyColorScheme(preference, win);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** 偏好变了就重新应用(由 ColorSchemeSync 在 SettingsProvider 里调用)。 */
export function useApplyColorScheme(scheme: ColorScheme): void {
  useEffect(() => {
    applyColorScheme(scheme);
  }, [scheme]);
}

function subscribeDarkClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** 跟随 html.dark(由 applyColorScheme 维护),供 Toaster 等第三方组件使用。 */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribeDarkClass,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}
```

`web/src/layout/color-scheme-sync.tsx`:

```tsx
import { useSettings } from "~/settings/settings-context";
import { useApplyColorScheme } from "./color-scheme";

/** 把「我的 → 外观」的选择应用到 html.dark(D12)。放在 SettingsProvider 里面,什么也不渲染。 */
export function ColorSchemeSync(): null {
  useApplyColorScheme(useSettings().colorScheme);
  return null;
}
```

`web/src/app.tsx` —— 两处(L15 再加库的导入与路由):在 `import { AppShell } from "~/layout/app-shell";` 之后加一行 `import { ColorSchemeSync } from "~/layout/color-scheme-sync";`;`App()` 里:

```tsx
      <SettingsProvider>
        <ColorSchemeSync />
        <AuthProvider>
```

`web/src/pages/me-page.tsx` —— 四处:
1. lucide 导入那一行 `LanguagesIcon, LogOutIcon, SmartphoneIcon, type LucideIcon,` → `LanguagesIcon, LogOutIcon, SmartphoneIcon, SunMoonIcon, type LucideIcon,`;
2. `import { useSettings } from "~/settings/settings-context";` 之后加 `import { COLOR_SCHEMES, type ColorScheme } from "~/settings/color-scheme-pref";`;
3. `const { language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText } = useSettings();` → `const { language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText, colorScheme, setColorScheme } = useSettings();`;
4. 「通用」组里,在语言行 `<SelectRow id={\`${id}-language\`} …` 之前加一行外观(同样的 `SelectRow`,整行覆盖一个透明原生 `<select>`,行高 ≥ 56):

```tsx
            <SelectRow id={`${id}-color-scheme`} testId="me-color-scheme" icon={SunMoonIcon} title={t("web.me.colorScheme")}
              hint={t("web.me.colorSchemeHint")} display={t(`web.me.colorSchemeOptions.${colorScheme}`)} value={colorScheme}
              onChange={(v) => setColorScheme(v as ColorScheme)}>
              {COLOR_SCHEMES.map((s) => <option key={s} value={s}>{t(`web.me.colorSchemeOptions.${s}`)}</option>)}
            </SelectRow>
```

`web/src/pages/i18n/en.json` —— 把 `roomVoiceAutoText…` 那一行(`me` 对象的最后一项)改为两行:

```json
      "roomVoiceAutoText": "Auto-show room voice text", "roomVoiceAutoTextHint": "Show the text and translation of voice messages in rooms automatically",
      "colorScheme": "Appearance", "colorSchemeHint": "Follow the system, or always use light or dark",
      "colorSchemeOptions": { "system": "Follow system", "light": "Light", "dark": "Dark" }
```

`web/src/pages/i18n/zh-CN.json`:

```json
      "roomVoiceAutoText": "联机语音自动转文字", "roomVoiceAutoTextHint": "收到语音消息时自动显示文字和翻译",
      "colorScheme": "外观", "colorSchemeHint": "跟随系统,或固定为浅色、深色",
      "colorSchemeOptions": { "system": "跟随系统", "light": "浅色", "dark": "深色" }
```

文档(各一两句,写进现有「What lives here」/「Pitfalls」风格里):
- `web/src/settings/CLAUDE.md`:第一段把存储对象改为 `{ language, roomVoiceAutoText, colorScheme }`(`colorScheme` = `system | light | dark`,默认 `system`,来自 `color-scheme-pref.ts`);「What lives here」加 `color-scheme-pref.ts`(类型、`readStoredColorScheme`,不依赖 React,`layout/color-scheme.ts` 渲染前读它);Pitfalls 加「整个存储对象有 `toEqual` 断言的测试(settings-context、me-page)加字段要同步改」。
- `web/src/layout/CLAUDE.md`:`color-scheme.ts` 一行改为「(`initColorScheme` 渲染前按存储的外观偏好应用 `html.dark` 并监听系统;`applyColorScheme`、`useApplyColorScheme`、`useIsDark`)」,加 `color-scheme-sync.tsx`(`ColorSchemeSync`,在 `SettingsProvider` 里把「我的 → 外观」应用到 `html.dark`);Pitfalls 加「固定为浅 / 深时两条 `theme-color` 被改成同色并在回到跟随系统时还原;iOS 主屏表现未在真机验证」。
- `web/src/pages/CLAUDE.md`:第一行 `me-page.tsx` 的括号里加「appearance」。

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/settings src/layout src/pages/me-page.test.tsx src/i18n src/architecture.test.ts && cd .. && yarn web:typecheck`,全部通过(`layout.test.tsx` 里现有的 prefers-color-scheme 用例不改,仍应通过;`feature-flags.test.tsx` 与 `bottom-nav.test.tsx` 此时不受影响)。

- [ ] **Step 5: 主包增量与基线(R-L35)** —— 外观设置是主包代码,不算库的 1.5 kB 预算:

```bash
cd /e/workspace/everyone-can-use-english
yarn web:build
cd web && node scripts/check-main-bundle.mjs --max-delta=1000
```

把输出的两行(基线 → 现在、净增量)原样写进结果文档「LA 外观设置的主包增量」一节,**然后**重录基线,让后面库自己的 `--max-delta=1.5` 只量库:`node scripts/check-main-bundle.mjs --record`。

- [ ] **Step 6: 提交**

```bash
git add web/src/settings web/src/layout web/src/pages web/src/app.tsx web/scripts/main-bundle-baseline.json docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "feat(web): app-wide appearance setting (system, light, dark)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L1: 类型、开关、REST 客户端与错误种类

**Files:**
- Create: `web/src/features/library/index.ts`(占位)、`test-fixtures.ts`、`test-i18n.ts`、`test-i18n.test.tsx`、`config.ts`、`config.test.tsx`、`library-api.ts`、`library-api.test.ts`、`error-kinds.ts`、`error-kinds.test.ts`、`translation-state.ts`、`translation-state.test.ts`

**Interfaces:**
- Produces:`LibraryLimits`、`LibraryConfig`(含 D8 的 `ai`)、`LIBRARY_DISABLED`、`fetchLibraryConfig(api)`、`useLibraryConfig()`;`LIBRARY_FORMATS`、`SUBTITLE_FORMATS`、`MIB`、`CHUNK_BYTES`、`MAX_SUBTITLE_BYTES`、`MAX_URL_CHARS`、`MAX_TITLE_CHARS`、`CHUNK_TIMEOUT_MS`、`MAX_TRANSLATE_BATCH`、`LibraryKind`、`LibrarySource`、`LibraryStatus`、`LibraryStage`、`SubSource`、`LibraryItem`、`LibrarySegment`(含 D8 的可选 `zh` / `zhLang` / `analysis` / `analysisLang`)、`LibraryItemDetail`、`ItemPage`、`ItemPatch`、`MediaTicket`、`UploadStart`、`UploadStatus`、`TranslatedSegment`、`TranslateResult`、`AnalysisResult`、`extOf`、`stemOf`、`limitsOrDefault`、`listItems`、`getItem`、`patchItem`、`deleteItem`、`retryItem`、`cancelItem`、`putItemSubtitles`、`mediaTicket`、`fetchPoster`、`startUpload`、`uploadStatus`、`putChunk`、`putUploadSubtitles`、`completeUpload`、`importLink`、`translateSegments`、`analyzeSegment`、`isAiLimited`、`LIBRARY_SERVER_ERRORS`;`ERROR_KINDS`、`ErrorKind`、`isErrorKind`、`errorKindKey`、`failedActions`;`zhFor`、`needsTranslation`、`mergeTranslations`;测试辅助 `setUiLanguage`、`resetUiLanguage`(R-L36);测试样例 `FORMATS`、`CONFIG_RAW`、`CONFIG_OFF_RAW`、`itemRaw`、`SEGMENTS_RAW`、`detailRaw`

- [ ] **Step 1: 写测试样例与失败测试**

`web/src/features/library/test-fixtures.ts`:

```ts
/**
 * 服务端形状(snake_case)的样例,只给测试用;形状与 server/tests/fixtures/library_contract.json 一致
 * (类型键表由 library-contract.test.ts 对真实夹具核对)。产品代码不得导入本文件。
 */
export const FORMATS = ["mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"];

export const CONFIG_RAW = {
  enabled: true,
  link_import: true,
  asr: true,
  ai: true,
  limits: {
    max_upload_mb: 500, max_duration_minutes: 90, quota_mb: 2000, used_bytes: 10 * 1024 * 1024,
    max_items: 100, chunk_bytes: 8388608, formats: FORMATS,
  },
};

export const CONFIG_OFF_RAW: Record<string, unknown> = { enabled: false, link_import: false, asr: false, ai: false, limits: null };

export function itemRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "i1", kind: "video", source: "upload", title: "Lecture 1", status: "ready", stage: null, progress: 100,
    error_kind: null, duration_ms: 125_000, seg_count: 3, library_bytes: 5 * 1024 * 1024, sub_source: "uploaded",
    resume_ms: 0, rate_pct: 100, created_at: "2026-10-13T08:00:00Z", last_opened_at: null, ...over,
  };
}

export const SEGMENTS_RAW: Record<string, unknown>[] = [
  { idx: 0, start_ms: 1000, end_ms: 3000, text: "Hello there.", zh: null, zh_lang: null, analysis: null, analysis_lang: null },
  { idx: 1, start_ms: 3200, end_ms: 6000, text: "How are you today?", zh: "你今天好吗?", zh_lang: "zh-CN", analysis: null, analysis_lang: null },
  { idx: 2, start_ms: 9000, end_ms: 11000, text: "I am fine, thanks.", zh: null, zh_lang: null, analysis: null, analysis_lang: null },
];

export function detailRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...itemRaw(), resume_idx: 0, segments: SEGMENTS_RAW, ...over };
}
```

`web/src/features/library/config.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { LIBRARY_DISABLED, fetchLibraryConfig, useLibraryConfig } from "./config";
import { CONFIG_RAW } from "./test-fixtures";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("library config (spec §9, R-L6)", () => {
  it("camelCases the config", async () => {
    const { api } = client({ "GET /api/library/config": () => json(CONFIG_RAW) });
    const config = await fetchLibraryConfig(api);
    expect(config.enabled).toBe(true);
    expect(config.linkImport).toBe(true);
    expect(config.ai).toBe(true);
    expect(config.limits?.chunkBytes).toBe(8388608);
    expect(config.limits?.usedBytes).toBe(10 * 1024 * 1024);
  });

  it("treats a 404 (server without the library) as disabled and rethrows other errors", async () => {
    expect(await fetchLibraryConfig(client({}).api)).toEqual(LIBRARY_DISABLED);
    const { api } = client({ "GET /api/library/config": () => json({ error: "boom" }, 500) });
    await expect(fetchLibraryConfig(api)).rejects.toMatchObject({ status: 500 });
  });

  it("caches one successful answer per ApiClient", async () => {
    const { mock, api } = client({ "GET /api/library/config": () => json(CONFIG_RAW) });
    const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
    const first = renderHook(() => useLibraryConfig(), { wrapper });
    await waitFor(() => expect(first.result.current?.enabled).toBe(true));
    const second = renderHook(() => useLibraryConfig(), { wrapper });
    await waitFor(() => expect(second.result.current?.enabled).toBe(true));
    expect(mock.calls).toHaveLength(1);
  });
});
```

`web/src/features/library/library-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import {
  CHUNK_TIMEOUT_MS, LIBRARY_SERVER_ERRORS, MAX_TRANSLATE_BATCH, analyzeSegment, cancelItem, completeUpload, deleteItem, extOf, fetchPoster,
  getItem, importLink, isAiLimited, limitsOrDefault, listItems, mediaTicket, patchItem, putChunk, putItemSubtitles, putUploadSubtitles,
  retryItem, startUpload, stemOf, translateSegments, uploadStatus,
} from "./library-api";
import { detailRaw, itemRaw } from "./test-fixtures";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
const formOf = (c: RecordedCall) => c.body as FormData;

describe("library api (spec §8, §9)", () => {
  it("lists items with an opaque cursor in the query and nothing else", async () => {
    const { mock, api } = client({
      "GET /api/library/items": (c) => json(c.url.searchParams.get("cursor") ? { items: [], next_cursor: null } : { items: [itemRaw()], next_cursor: "c2" }),
    });
    const first = await listItems(api);
    expect(first.items[0]).toMatchObject({ id: "i1", segCount: 3, libraryBytes: 5 * 1024 * 1024, ratePct: 100, errorKind: null });
    expect(first.nextCursor).toBe("c2");
    expect(mock.calls[0].url.search).toBe("");
    const next = await listItems(api, "c2");
    expect(next).toEqual({ items: [], nextCursor: null });
    expect(mock.calls[1].url.search).toBe("?cursor=c2");
  });

  it("encodes ids in the path, camelCases the detail and keeps sentence text untouched", async () => {
    const { mock, api } = client({ "GET /api/library/items/a%2Fb": () => json(detailRaw({ id: "a/b", resume_idx: 2 })) });
    const detail = await getItem(api, "a/b");
    expect(detail.resumeIdx).toBe(2);
    expect(detail.segments[1]).toEqual({
      idx: 1, startMs: 3200, endMs: 6000, text: "How are you today?", zh: "你今天好吗?", zhLang: "zh-CN", analysis: null, analysisLang: null,
    });
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer t");
  });

  it("sends patches, retries, cancels and deletes without a query string", async () => {
    const { mock, api } = client({
      "PATCH /api/library/items/i1": () => json(itemRaw({ rate_pct: 75 })),
      "POST /api/library/items/i1/retry": () => json(itemRaw({ status: "queued" })),
      "POST /api/library/items/i1/cancel": () => json(itemRaw({ status: "canceled" })),
      "DELETE /api/library/items/i1": () => new Response(null, { status: 204 }),
    });
    expect((await patchItem(api, "i1", { ratePct: 75 })).ratePct).toBe(75);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ rate_pct: 75 });
    await patchItem(api, "i1", { resumeMs: 12_000, resumeIdx: 3 });
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ resume_ms: 12_000, resume_idx: 3 });
    expect((await retryItem(api, "i1")).status).toBe("queued");
    expect((await cancelItem(api, "i1")).status).toBe("canceled");
    await deleteItem(api, "i1");
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("starts uploads with the filename only in the JSON body and sends chunks with a neutral multipart name", async () => {
    const { mock, api } = client({
      "POST /api/library/uploads": () => json({ item_id: "u1", chunk_bytes: 8388608 }),
      "GET /api/library/uploads/u1": () => json({ upload_received: 4, upload_total: 10 }),
      "PUT /api/library/uploads/u1/chunks/3": () => json({ upload_received: 10, upload_total: 10 }),
      "PUT /api/library/uploads/u1/subtitles": () => json({}),
      "POST /api/library/uploads/u1/complete": () => json(itemRaw({ id: "u1", status: "queued" })),
    });
    expect(await startUpload(api, { filename: "My Talk.mp4", size: 10, title: undefined })).toEqual({ itemId: "u1", chunkBytes: 8388608 });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ filename: "My Talk.mp4", size: 10 });
    expect(await uploadStatus(api, "u1")).toEqual({ uploadReceived: 4, uploadTotal: 10 });
    await putChunk(api, "u1", 3, new Blob([new Uint8Array(6)]));
    const chunk = formOf(mock.calls[2]).get("chunk") as File;
    expect(chunk.name).toBe("chunk");
    expect(chunk.size).toBe(6);
    await putUploadSubtitles(api, "u1", new Blob(["WEBVTT\n"]), "My Talk.en.VTT");
    expect((formOf(mock.calls[3]).get("file") as File).name).toBe("subtitles.vtt");
    expect((await completeUpload(api, "u1")).status).toBe("queued");
    expect(mock.calls.map((c) => c.url.pathname).join(" ")).not.toContain("Talk");
    expect(CHUNK_TIMEOUT_MS).toBe(180_000);
  });

  it("replaces subtitles, issues tickets, fetches posters as blobs and imports links in the body", async () => {
    const { mock, api } = client({
      "PUT /api/library/items/f1/subtitles": () => json(itemRaw({ id: "f1", status: "queued" })),
      "POST /api/library/items/i1/media-ticket": () => json({ url: "/api/library/items/i1/media?ticket=abc", expires_in: 1800 }),
      // Response 要给字节而不是 jsdom 的 Blob(Node 的 Response 认不出 jsdom 的 Blob,会把它转成字符串 "[object Blob]")
      "GET /api/library/items/i1/poster": () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/jpeg" } }),
      "POST /api/library/imports": () => json(itemRaw({ id: "l1", source: "link", status: "queued" })),
    });
    await putItemSubtitles(api, "f1", new Blob(["1\n"]), "whatever.srt");
    expect((formOf(mock.calls[0]).get("file") as File).name).toBe("subtitles.srt");
    expect(await mediaTicket(api, "i1")).toEqual({ url: "/api/library/items/i1/media?ticket=abc", expiresIn: 1800 });
    expect((await fetchPoster(api, "i1")).size).toBe(2);
    const item = await importLink(api, { url: "https://www.youtube.com/watch?v=x", title: "T" });
    expect(item.source).toBe("link");
    expect(mock.calls[3].url.search).toBe("");
    expect(JSON.parse(String(mock.calls[3].body))).toEqual({ url: "https://www.youtube.com/watch?v=x", title: "T" });
  });

  it("asks for translations with the language in the body only and accepts both reply shapes (D8, E12)", async () => {
    const { mock, api } = client({
      "POST /api/library/items/i1/translate": (c) =>
        json(JSON.parse(String(c.body)).indices.length === 1
          ? [{ idx: 0, zh: "你好。" }]
          : { items: [{ idx: 0, zh: "你好。" }, { idx: 1, zh: "你今天好吗?" }], limited: true }),
    });
    expect(await translateSegments(api, "i1", [0], "zh-CN")).toEqual({ items: [{ idx: 0, zh: "你好。" }], limited: false });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ indices: [0], native_language: "zh-CN" });
    expect(mock.calls[0].url.pathname).toBe("/api/library/items/i1/translate");
    expect(mock.calls[0].url.search).toBe("");
    const second = await translateSegments(api, "i1", [0, 1], "zh-CN");
    expect(second.limited).toBe(true);
    expect(second.items).toHaveLength(2);
  });

  it("refuses more than 20 sentences per translate call and sends nothing", async () => {
    const { mock, api } = client({});
    await expect(translateSegments(api, "i1", Array.from({ length: 21 }, (_, i) => i), "zh-CN")).rejects.toBeInstanceOf(RangeError);
    expect(mock.calls).toHaveLength(0);
    expect(MAX_TRANSLATE_BATCH).toBe(20);
  });

  it("asks for one analysis by sentence number and recognises a spent allowance (D8)", async () => {
    let status = 200;
    const { mock, api } = client({
      "POST /api/library/items/i1/segments/4/analysis": () =>
        (status === 200 ? json({ analysis: "Structure: ...", cached: false }) : json({ error: "Daily AI limit reached" }, 429)),
    });
    expect(await analyzeSegment(api, "i1", 4, "zh-CN")).toEqual({ analysis: "Structure: ...", cached: false });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ native_language: "zh-CN" });
    expect(mock.calls[0].url.search).toBe("");
    status = 429;
    const err = await analyzeSegment(api, "i1", 4, "zh-CN").catch((e: unknown) => e);
    expect(isAiLimited(err)).toBe(true);
    expect(isAiLimited(new Error("x"))).toBe(false);
    expect(LIBRARY_SERVER_ERRORS["Daily AI limit reached"]).toBe("web.library.errors.aiLimited");
  });

  it("derives extensions and default titles from file names", () => {
    expect(extOf("Talk.MP4")).toBe("mp4");
    expect(extOf("no-extension")).toBe("");
    expect(stemOf("C:\\videos\\Lesson 3.final.mkv")).toBe("Lesson 3.final");
    expect(stemOf(".hidden")).toBe(".hidden");
    expect(stemOf(`${"a".repeat(300)}.mp3`)).toHaveLength(200);
  });

  it("falls back to the spec defaults when the server sends no limits", () => {
    expect(limitsOrDefault(null)).toMatchObject({ maxUploadMb: 500, quotaMb: 2000, chunkBytes: 8388608, usedBytes: 0 });
  });

  it("maps the fixed server error texts to library keys", () => {
    expect(LIBRARY_SERVER_ERRORS["Quota exceeded"]).toBe("web.library.errors.quota");
    expect(LIBRARY_SERVER_ERRORS["Invalid URL"]).toBe("web.library.errors.badUrl");
    expect(Object.values(LIBRARY_SERVER_ERRORS).every((k) => k.startsWith("web.library.errors."))).toBe(true);
  });
});
```

`web/src/features/library/error-kinds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ERROR_KINDS, errorKindKey, failedActions, isErrorKind } from "./error-kinds";

describe("error kinds (spec §6.6, R-L12)", () => {
  it("lists the 24 spec kinds", () => {
    expect(ERROR_KINDS).toHaveLength(24);
    expect(new Set(ERROR_KINDS).size).toBe(24);
    expect(isErrorKind("drm")).toBe(true);
    expect(isErrorKind("nope")).toBe(false);
  });

  it("maps unknown or missing kinds to the generic key", () => {
    expect(errorKindKey("blocked")).toBe("web.library.errors.kind.blocked");
    expect(errorKindKey("something_new")).toBe("web.library.errors.kind.unknown");
    expect(errorKindKey(null)).toBe("web.library.errors.kind.unknown");
  });

  it("offers retry only where it can help and subtitles only where they are missing", () => {
    expect(failedActions("upstream")).toEqual({ retry: true, subtitles: false });
    expect(failedActions("blocked")).toEqual({ retry: true, subtitles: false });
    expect(failedActions(null)).toEqual({ retry: true, subtitles: false });
    expect(failedActions("no_subtitles")).toEqual({ retry: false, subtitles: true });
    expect(failedActions("bad_subtitle")).toEqual({ retry: false, subtitles: true });
    for (const kind of ["too_large", "too_long", "drm", "private", "upload_expired", "unsupported_site"]) {
      expect(failedActions(kind).retry, kind).toBe(false);
    }
  });
});
```

`web/src/features/library/translation-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LibrarySegment } from "./library-api";
import { mergeTranslations, needsTranslation, zhFor } from "./translation-state";

const seg = (over: Partial<LibrarySegment> = {}): LibrarySegment => ({ idx: 0, startMs: 0, endMs: 1000, text: "Hi.", zh: null, zhLang: null, ...over });

describe("translation state (spec E11, R-L32)", () => {
  it("shows a translation only in the language it was made for", () => {
    expect(zhFor(seg({ zh: "你好。", zhLang: "zh-CN" }), "zh-CN")).toBe("你好。");
    expect(zhFor(seg({ zh: "你好。", zhLang: "zh-CN" }), "es-ES")).toBeNull();
    expect(zhFor(seg({ zh: "你好。", zhLang: null }), "zh-CN")).toBe("你好。");
    expect(zhFor(seg({ zh: "", zhLang: "zh-CN" }), "zh-CN")).toBeNull();
    expect(zhFor(seg(), "zh-CN")).toBeNull();
    expect(zhFor({}, "zh-CN")).toBeNull(); // 旧服务端 / 旧夹具没有这两个键
  });

  it("asks again for sentences whose translation is missing or in another language", () => {
    expect(needsTranslation(seg(), "zh-CN")).toBe(true);
    expect(needsTranslation(seg({ zh: "旧", zhLang: "es-ES" }), "zh-CN")).toBe(true);
    expect(needsTranslation(seg({ zh: "好", zhLang: "zh-CN" }), "zh-CN")).toBe(false);
  });

  it("merges fresh translations by index and keeps object identity when nothing changes", () => {
    const list = [seg({ idx: 0 }), seg({ idx: 1, zh: "旧", zhLang: "es-ES" })];
    const next = mergeTranslations(list, [{ idx: 1, zh: "新" }, { idx: 9, zh: "没有这一句" }], "zh-CN");
    expect(next).not.toBe(list);
    expect(next[0]).toBe(list[0]);
    expect(next[1]).toEqual({ ...list[1], zh: "新", zhLang: "zh-CN" });
    expect(list[1].zh).toBe("旧");
    expect(mergeTranslations(next, [{ idx: 1, zh: "新" }], "zh-CN")).toBe(next);
    expect(mergeTranslations(next, [], "zh-CN")).toBe(next);
  });
});
```

`web/src/features/library/test-i18n.test.tsx`(R-L36:证明只调 `i18n.changeLanguage` 不够):

```tsx
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { resetUiLanguage, setUiLanguage } from "./test-i18n";

function Probe() {
  return <p data-testid="lang">{i18n.language}</p>;
}

afterEach(async () => {
  await resetUiLanguage();
});

describe("test-i18n (R-L36)", () => {
  it("keeps the language across SettingsProvider's initialiser", async () => {
    await setUiLanguage("zh-CN");
    renderWithProviders(<Probe />);
    expect(screen.getByTestId("lang")).toHaveTextContent("zh-CN");
  });

  it("is needed: a bare changeLanguage is put back by the provider (jsdom's navigator.language is en-US)", async () => {
    localStorage.clear();
    await i18n.changeLanguage("zh-CN");
    renderWithProviders(<Probe />);
    // 若这条失败,说明 SettingsProvider 不再重设语言:R-L36 可以放宽,但 setUiLanguage 仍是正确写法
    expect(i18n.language).toBe("en");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/config.test.tsx src/features/library/library-api.test.ts src/features/library/error-kinds.test.ts src/features/library/translation-state.test.ts src/features/library/test-i18n.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现**

`web/src/features/library/index.ts`(占位;`architecture.test.ts` 要求每个 feature 目录有 `index.ts`,L15 换成真正的公开面):

```ts
// library 的公共接口(spec 2026-10-13-video-import §11.1)。L15 之前没有对外导出。
export {};
```

`web/src/features/library/config.ts`:

```ts
import { useEffect, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";

/**
 * 跟读库的开关与限额(spec 2026-10-13-video-import §9 `GET /api/library/config`)。本模块在主包里(入口卡要用),
 * 所以只放开关请求与类型,不导入 library-api 与懒加载文案(计划 R-L3、R-L23)。
 */
export interface LibraryLimits {
  maxUploadMb: number;
  maxDurationMinutes: number;
  quotaMb: number;
  usedBytes: number;
  maxItems: number;
  chunkBytes: number;
  formats: string[];
}

export interface LibraryConfig {
  enabled: boolean;
  linkImport: boolean;
  asr: boolean;
  /** D8:是否允许生成译文与句子分析(spec §5.2 `library_ai_enabled`);关 = 网页不显示「译」与「分析」 */
  ai: boolean;
  limits: LibraryLimits | null;
}

export const LIBRARY_DISABLED: LibraryConfig = Object.freeze({ enabled: false, linkImport: false, asr: false, ai: false, limits: null });

/** 404 = 没装跟读库的旧服务端,按关闭处理;其他错误照抛,由调用方决定重试(R-L6)。 */
export async function fetchLibraryConfig(api: ApiClient): Promise<LibraryConfig> {
  try {
    const c = await api.request<Partial<LibraryConfig>>("GET", "/api/library/config");
    return { enabled: c.enabled === true, linkImport: c.linkImport === true, asr: c.asr === true, ai: c.ai === true, limits: c.limits ?? null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return LIBRARY_DISABLED;
    throw err;
  }
}

const cache = new WeakMap<ApiClient, Promise<LibraryConfig | null>>();

/** 入口卡与播放页用的开关:每个 ApiClient 只缓存一次成功结果;失败为 null,下次挂载重试(同 useWordbookConfig)。拿到前为 null。 */
export function useLibraryConfig(): LibraryConfig | null {
  const { api } = useAuth();
  const [config, setConfig] = useState<LibraryConfig | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = cache.get(api);
    if (!pending) {
      pending = fetchLibraryConfig(api).catch((): null => {
        cache.delete(api);
        return null;
      });
      cache.set(api, pending);
    }
    void pending.then((value) => { if (alive) setConfig(value); });
    return () => { alive = false; };
  }, [api]);
  return config;
}
```

`web/src/features/library/library-api.ts`:

```ts
import { ApiError, type ApiClient } from "~/api/client";
import type { LibraryLimits } from "./config";

export type { LibraryConfig, LibraryLimits } from "./config";

/** spec §8 的扩展名白名单(服务端为准;有 config.limits.formats 时用它)。 */
export const LIBRARY_FORMATS = ["mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"] as const;
export const SUBTITLE_FORMATS = ["srt", "vtt"] as const;
export const MIB = 1024 * 1024;
export const CHUNK_BYTES = 8 * MIB;
export const MAX_SUBTITLE_BYTES = 2 * MIB;
export const MAX_URL_CHARS = 2000;
export const MAX_TITLE_CHARS = 200;
/** 单片 8 MiB 在慢速手机网络上可能超过 ApiClient 默认的 60 s(R-L8)。 */
export const CHUNK_TIMEOUT_MS = 180_000;

export type LibraryKind = "audio" | "video";
export type LibrarySource = "upload" | "link";
export type LibraryStatus = "uploading" | "queued" | "processing" | "ready" | "failed" | "canceled";
export type LibraryStage = "probe" | "fetch" | "transcode" | "subtitles" | "transcribe" | "segment";
export type SubSource = "uploaded" | "platform" | "asr";

/** 列表项(spec §9;ApiClient 已把键转成 camelCase)。 */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  source: LibrarySource;
  title: string;
  status: LibraryStatus;
  stage: LibraryStage | null;
  progress: number;
  errorKind: string | null;
  durationMs: number | null;
  segCount: number;
  libraryBytes: number;
  subSource: SubSource | null;
  resumeMs: number;
  ratePct: number;
  createdAt: string;
  lastOpenedAt: string | null;
}

/** 句子:原始起止毫秒(播放时再加缓冲,spec §6.3 第 6 条)。 */
export interface LibrarySegment {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
  /**
   * D8:译文与它译成的语言(可空)。用户改了母语后旧译文视为失效 → 显示前一律经 translation-state.zhFor。
   * 可选:旧服务端 / 旧夹具没有这几个键;W2 的测试里构造句子也不必带上它们。
   */
  zh?: string | null;
  zhLang?: string | null;
  /** D8:AI 分析的原文与语言(可空;W2 的分析卡使用,本车道的列表不显示) */
  analysis?: string | null;
  analysisLang?: string | null;
}

export interface LibraryItemDetail extends LibraryItem {
  resumeIdx: number;
  segments: LibrarySegment[];
}

export interface ItemPage { items: LibraryItem[]; nextCursor: string | null }
export interface ItemPatch { title?: string; resumeMs?: number; resumeIdx?: number; ratePct?: number }
export interface MediaTicket { url: string; expiresIn: number }
export interface UploadStart { itemId: string; chunkBytes: number }
export interface UploadStatus { uploadReceived: number; uploadTotal: number }

const BASE = "/api/library";
const itemPath = (id: string) => `${BASE}/items/${encodeURIComponent(id)}`;
const uploadPath = (id: string) => `${BASE}/uploads/${encodeURIComponent(id)}`;

/** 小写扩展名(不含点);没有则为空串。 */
export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** 默认标题 = 文件名主干(去掉目录与最后一个扩展名),最多 200 字。 */
export function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).slice(0, MAX_TITLE_CHARS);
}

/** 开关打开时服务端总会给 limits;万一缺省,按 spec §5.2 的默认值预检(服务端仍是最终裁判)。 */
export function limitsOrDefault(limits: LibraryLimits | null): LibraryLimits {
  return limits ?? {
    maxUploadMb: 500, maxDurationMinutes: 90, quotaMb: 2000, usedBytes: 0, maxItems: 100, chunkBytes: CHUNK_BYTES,
    formats: [...LIBRARY_FORMATS],
  };
}

function subtitleForm(file: Blob, filename: string): FormData {
  const form = new FormData();
  form.append("file", file, `subtitles.${extOf(filename) === "vtt" ? "vtt" : "srt"}`); // 中性文件名(R-L8)
  return form;
}

export async function listItems(api: ApiClient, cursor?: string | null, signal?: AbortSignal): Promise<ItemPage> {
  const page = await api.request<{ items?: LibraryItem[]; nextCursor?: string | null }>("GET", `${BASE}/items`, {
    query: { cursor: cursor ?? undefined }, signal,
  });
  return { items: page.items ?? [], nextCursor: page.nextCursor ?? null };
}

export function getItem(api: ApiClient, id: string, signal?: AbortSignal): Promise<LibraryItemDetail> {
  return api.request<LibraryItemDetail>("GET", itemPath(id), { signal });
}

export function patchItem(api: ApiClient, id: string, patch: ItemPatch): Promise<LibraryItem> {
  return api.request<LibraryItem>("PATCH", itemPath(id), { json: patch });
}

export async function deleteItem(api: ApiClient, id: string): Promise<void> {
  await api.request("DELETE", itemPath(id));
}

export function retryItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${itemPath(id)}/retry`);
}

export function cancelItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${itemPath(id)}/cancel`);
}

export function putItemSubtitles(api: ApiClient, id: string, file: Blob, filename: string): Promise<LibraryItem> {
  return api.request<LibraryItem>("PUT", `${itemPath(id)}/subtitles`, { form: subtitleForm(file, filename) });
}

export function mediaTicket(api: ApiClient, id: string): Promise<MediaTicket> {
  return api.request<MediaTicket>("POST", `${itemPath(id)}/media-ticket`);
}

export function fetchPoster(api: ApiClient, id: string, signal?: AbortSignal): Promise<Blob> {
  return api.request<Blob>("GET", `${itemPath(id)}/poster`, { as: "blob", signal });
}

export function startUpload(api: ApiClient, body: { filename: string; size: number; title?: string }, signal?: AbortSignal): Promise<UploadStart> {
  return api.request<UploadStart>("POST", `${BASE}/uploads`, { json: body, signal });
}

export function uploadStatus(api: ApiClient, id: string, signal?: AbortSignal): Promise<UploadStatus> {
  return api.request<UploadStatus>("GET", uploadPath(id), { signal });
}

export function putChunk(api: ApiClient, id: string, n: number, chunk: Blob, signal?: AbortSignal): Promise<UploadStatus> {
  const form = new FormData();
  form.append("chunk", chunk, "chunk");
  return api.request<UploadStatus>("PUT", `${uploadPath(id)}/chunks/${n}`, { form, signal, timeoutMs: CHUNK_TIMEOUT_MS });
}

export async function putUploadSubtitles(api: ApiClient, id: string, file: Blob, filename: string, signal?: AbortSignal): Promise<void> {
  await api.request("PUT", `${uploadPath(id)}/subtitles`, { form: subtitleForm(file, filename), signal });
}

export function completeUpload(api: ApiClient, id: string, signal?: AbortSignal): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${uploadPath(id)}/complete`, { signal });
}

/** 链接只在 JSON 体里(隐私规则);开关关时服务端 404。 */
export function importLink(api: ApiClient, body: { url: string; title?: string }): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${BASE}/imports`, { json: body });
}

/** D8:一次最多取这么多句的译文(spec §9)。 */
export const MAX_TRANSLATE_BATCH = 20;

/** `translate` 回包里的一句:idx + 译文(译成哪种语言由请求的 native_language 决定)。 */
export interface TranslatedSegment { idx: number; zh: string }
export interface TranslateResult { items: TranslatedSegment[]; limited: boolean }
export interface AnalysisResult { analysis: string; cached: boolean }

/**
 * D8 / E12:批量取译文(≤ 20 句)。句子文字不在请求里(服务端从库里读),URL 里只有条目 id。回包形状 S1 未定稿:
 * 接受 `{items, limited}` 与裸数组两种(计划「跨计划假设」)。`limited` = 额度满,已有的照常返回、缺的没有生成。
 */
export async function translateSegments(
  api: ApiClient, id: string, indices: readonly number[], nativeLanguage: string, signal?: AbortSignal,
): Promise<TranslateResult> {
  if (indices.length > MAX_TRANSLATE_BATCH) throw new RangeError(`at most ${MAX_TRANSLATE_BATCH} sentences per translate call`);
  const reply = await api.request<TranslatedSegment[] | { items?: TranslatedSegment[]; limited?: boolean }>(
    "POST", `${itemPath(id)}/translate`, { json: { indices, nativeLanguage }, signal },
  );
  if (Array.isArray(reply)) return { items: reply, limited: false };
  return { items: reply.items ?? [], limited: reply.limited === true };
}

/** D8:某一句的 AI 分析(只在用户点「分析」时调用,不预取;额度满 → 429,见 isAiLimited)。URL 里只有条目 id 与句序号。 */
export function analyzeSegment(api: ApiClient, id: string, idx: number, nativeLanguage: string, signal?: AbortSignal): Promise<AnalysisResult> {
  return api.request<AnalysisResult>("POST", `${itemPath(id)}/segments/${idx}/analysis`, { json: { nativeLanguage }, signal });
}

/** 额度满(429)。调用方显示一次固定提示,不逐句报错;播放与跟读不受影响。 */
export function isAiLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

/** 服务端固定英文错误文本 → 文案键(计划「跨计划假设」;未命中走通用提示)。 */
export const LIBRARY_SERVER_ERRORS: Record<string, string> = {
  "Library item not found": "web.library.errors.notFound",
  "Not Found": "web.library.errors.notFound",
  "Quota exceeded": "web.library.errors.quota",
  "Too many items": "web.library.errors.maxItems",
  "File too large": "web.library.errors.tooLarge",
  "Unsupported format": "web.library.errors.unsupportedFormat",
  "Daily import limit reached": "web.library.errors.dailyLimit",
  "Too many uploads in progress": "web.library.errors.concurrentUploads",
  "Chunk out of order": "web.library.errors.chunkOrder",
  "Chunk too large": "web.library.errors.chunkTooLarge",
  "Upload incomplete": "web.library.errors.uploadIncomplete",
  "Invalid subtitle file": "web.library.errors.badSubtitle",
  "Invalid URL": "web.library.errors.badUrl",
  "Item not ready": "web.library.errors.notReady",
  "Invalid state": "web.library.errors.invalidState",
  "Daily AI limit reached": "web.library.errors.aiLimited",
};
```

`web/src/features/library/error-kinds.ts`:

```ts
/** 处理失败的种类(spec §6.6;英文常量由服务端存在 error_kind)。网页只显示本地化原因,从不显示上游文本。 */
export const ERROR_KINDS = [
  "too_large", "too_long", "quota", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "disk_full", "unsupported_format",
  "upload_expired", "link_disabled", "bad_url", "drm", "private", "geo_blocked", "login_required", "blocked",
  "playlist_unsupported", "live_unsupported", "unsupported_site", "ytdlp_failed", "upstream", "network", "ytdlp_transient",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** 重试必然再失败的种类(R-L12)。 */
const NO_RETRY: ReadonlySet<string> = new Set([
  "too_large", "too_long", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "unsupported_format", "upload_expired",
  "link_disabled", "bad_url", "drm", "private", "playlist_unsupported", "live_unsupported", "unsupported_site",
]);
const NEEDS_SUBTITLES: ReadonlySet<string> = new Set(["no_subtitles", "bad_subtitle"]);

export function isErrorKind(kind: unknown): kind is ErrorKind {
  return typeof kind === "string" && (ERROR_KINDS as readonly string[]).includes(kind);
}

export function errorKindKey(kind: string | null | undefined): string {
  return `web.library.errors.kind.${isErrorKind(kind) ? kind : "unknown"}`;
}

/** 失败卡上的动作:「重试」与「补传字幕」(「删除」总是有)。 */
export function failedActions(kind: string | null | undefined): { retry: boolean; subtitles: boolean } {
  const k = kind ?? "";
  return { retry: !NO_RETRY.has(k), subtitles: NEEDS_SUBTITLES.has(k) };
}
```

`web/src/features/library/translation-state.ts`(译文的纯函数;W2 的 `use-translations` 也用它):

```ts
import type { LibrarySegment, TranslatedSegment } from "./library-api";

/**
 * 显示用的译文(spec E11):有文字,且(没记语言,或与当前母语一致)才算有效;用户改了母语后旧译文视为失效,
 * 由 `translate` 端点按语言重新生成。`native` 是 `nativeLanguageCode(language)` 的值(`en-US` / `zh-CN` / `es-ES`)。
 */
export function zhFor(seg: Pick<LibrarySegment, "zh" | "zhLang">, native: string): string | null {
  if (!seg.zh) return null;
  return seg.zhLang && seg.zhLang !== native ? null : seg.zh;
}

/** 这一句需要(重新)取译文。 */
export const needsTranslation = (seg: Pick<LibrarySegment, "zh" | "zhLang">, native: string): boolean => zhFor(seg, native) === null;

/** 把 `translate` 回包按 idx 合进句子表;没有变化时原样返回同一个数组(给 setState 省一次渲染)。 */
export function mergeTranslations(segments: LibrarySegment[], items: readonly TranslatedSegment[], native: string): LibrarySegment[] {
  if (items.length === 0) return segments;
  const byIdx = new Map(items.map((i) => [i.idx, i.zh]));
  let changed = false;
  const next = segments.map((s) => {
    const zh = byIdx.get(s.idx);
    if (zh === undefined || (s.zh === zh && s.zhLang === native)) return s;
    changed = true;
    return { ...s, zh, zhLang: native };
  });
  return changed ? next : segments;
}
```

`web/src/features/library/test-i18n.ts`(仅测试;R-L36):

```ts
import i18n from "~/i18n";

const KEY = "enjoy-web.settings";

/**
 * 页面测试里切界面语言。`SettingsProvider` 的初始化器按 localStorage 或 `navigator.language`(jsdom 里是 en-US)重设语言,
 * 只调 `i18n.changeLanguage("zh-CN")` 会在 `renderWithProviders` 里被改回 `en`;所以先写 `enjoy-web.settings` 再切语言。
 * 注意:先 `localStorage.clear()` 再调它,不要反过来。
 */
export async function setUiLanguage(language: "en" | "zh-CN"): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify({ language }));
  await i18n.changeLanguage(language);
}

export async function resetUiLanguage(): Promise<void> {
  localStorage.removeItem(KEY);
  await i18n.changeLanguage("en");
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library src/architecture.test.ts && cd .. && yarn web:typecheck`,全部通过。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library types, config and REST client

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L2: 文案(`web.nav.library` 一个键 eager,其余懒加载;R-L3、R-L4)

**Files:**
- Create: `web/src/features/library/i18n/en.json`、`i18n/zh-CN.json`、`locales.ts`、`locales/en.json`、`locales/zh-CN.json`、`locales.test.ts`

**Interfaces:**
- Produces:`ensureLibraryI18n()`;键 `web.nav.library`(eager,E9 的标签文字)与全部 `web.library.*`(懒加载,含译文 / 速度滑块 / 已用空间的文案与归 W2 的 `web.library.shadow.*`)

- [ ] **Step 1: 写失败测试** — `web/src/features/library/locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ERROR_KINDS } from "./error-kinds";
import eagerEn from "./i18n/en.json";
import eagerZh from "./i18n/zh-CN.json";
import { ensureLibraryI18n } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const flatten = (d: unknown, prefix = ""): Record<string, string> =>
  d && typeof d === "object"
    ? Object.entries(d as Dict).reduce<Record<string, string>>((acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }), {})
    : { [prefix]: String(d) };
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const a = flatten(en);
const b = flatten(zh);

describe("library locales (R-L3: lazy, outside the eager i18n glob)", () => {
  it("has the same keys and placeholders in en and zh-CN, all under web.library", () => {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a).every((k) => k.startsWith("web.library."))).toBe(true);
    for (const k of Object.keys(a)) expect(placeholders(a[k]), k).toEqual(placeholders(b[k]));
    for (const [k, v] of [...Object.entries(a), ...Object.entries(b)]) {
      expect(v.trim(), k).not.toBe("");
      expect(v, k).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("covers every error kind, status, stage, subtitle source and loop mode", () => {
    for (const kind of [...ERROR_KINDS, "unknown"]) expect(a, kind).toHaveProperty([`web.library.errors.kind.${kind}`]);
    for (const s of ["uploading", "queued", "processing", "ready", "failed", "canceled"]) expect(a).toHaveProperty([`web.library.status.${s}`]);
    for (const s of ["probe", "fetch", "transcode", "subtitles", "transcribe", "segment"]) expect(a).toHaveProperty([`web.library.stage.${s}`]);
    for (const s of ["uploaded", "platform", "asr"]) expect(a).toHaveProperty([`web.library.sub.${s}`]);
    for (const s of ["off", "infinite", "3", "5"]) expect(a).toHaveProperty([`web.library.player.loop.${s}`]);
  });

  it("keeps the spec §7.4 DRM notice and the §6.2 no-subtitles text word for word in Chinese", () => {
    expect(b["web.library.link.drm"]).toBe(
      "支持 yt-dlp 能直接下载的公开视频页面(如 YouTube 等)。受 DRM 保护的流媒体服务(Netflix、Disney+、爱奇艺、腾讯视频、优酷、Spotify 等)无法导入,请使用你自己拥有的文件上传。",
    );
    expect(b["web.library.errors.kind.no_subtitles"]).toBe("这条没有字幕,管理员也没有开启自动转写;可以上传一份字幕后重新导入");
  });

  it("pre-seeds the W2 shadowing subtree (R-L4)", () => {
    for (const k of ["record", "stop", "assessing", "listenMine", "listenOriginal", "addToList", "added", "edit", "save", "cancel"]) {
      expect(a).toHaveProperty([`web.library.shadow.${k}`]);
    }
  });

  it("keeps the eager bundle to the single nav label (spec E9, R-L3)", () => {
    expect(flatten(eagerEn)).toEqual({ "web.nav.library": "Library" });
    expect(flatten(eagerZh)).toEqual({ "web.nav.library": "跟读库" });
    // 标签文字 ≤ 8 个英文字符 / ≤ 4 个汉字(E9):360 px 宽 5 列每列约 72 px
    expect([...flatten(eagerEn)["web.nav.library"]].length).toBeLessThanOrEqual(8);
    expect([...flatten(eagerZh)["web.nav.library"]].length).toBeLessThanOrEqual(4);
  });

  it("merges into i18next once loaded and pluralises English counts", () => {
    ensureLibraryI18n();
    expect(i18n.getFixedT("en")("web.library.sentences", { count: 1 })).toBe("1 sentence");
    expect(i18n.getFixedT("en")("web.library.sentences", { count: 3 })).toBe("3 sentences");
    expect(i18n.getFixedT("zh-CN")("web.library.sentences", { count: 3 })).toBe("3 句");
    expect(i18n.getFixedT("zh-CN")("web.nav.library")).toBe("跟读库");
    expect(i18n.getFixedT("en")("web.nav.library")).toBe("Library");
    expect(i18n.getFixedT("en")("web.nav.practice")).toBe("Practice"); // 深合并没有吃掉别处写的 web.nav
  });

  it("has the translation, speed-slider, chip and quota copy (D8, D11)", () => {
    for (const k of [
      "translateShort", "translateOn", "translateOff", "translateLimited", "translateFailed", "translateRetry", "chipLoop", "chipBlind", "rateSlider",
    ]) {
      expect(a).toHaveProperty([`web.library.player.${k}`]);
    }
    expect(a).toHaveProperty(["web.library.errors.aiLimited"]);
    expect(a).toHaveProperty(["web.library.usedLabel"]);
    expect(a).toHaveProperty(["web.library.addShort"]);
    expect(b["web.library.player.translateOn"]).toBe("隐藏译文");
    expect(b["web.library.player.translateOff"]).toBe("显示译文");
    expect(b["web.library.player.chipBlind"]).toBe("盲听");
    expect(b["web.library.player.rateSlider"]).toBe("播放速度");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/locales.test.ts`。

- [ ] **Step 3: 实现**

`web/src/features/library/i18n/en.json`:

```json
{
  "web": {
    "nav": {
      "library": "Library"
    }
  }
}
```

`web/src/features/library/i18n/zh-CN.json`:

```json
{
  "web": {
    "nav": {
      "library": "跟读库"
    }
  }
}
```

`web/src/features/library/locales.ts`:

```ts
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 跟读库的界面文案不进主包(计划 R-L3):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 懒加载块里每个用到 web.library.* 的模块都 `import "./locales"`,求值时并入 i18next(深合并,不覆盖已有键)。
 * `web.library.shadow.*` 子树归 W2(R-L4)。
 */
let loaded = false;
export function ensureLibraryI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureLibraryI18n();
```

`web/src/features/library/locales/en.json`:

```json
{
  "web": {
    "library": {
      "title": "Shadowing library",
      "usedLabel": "Used",
      "add": "Add material",
      "addShort": "Add",
      "empty": "Nothing here yet. Upload an audio or video file, or import a link, then shadow it sentence by sentence.",
      "kind": { "audio": "Audio", "video": "Video" },
      "sub": { "uploaded": "Your subtitles", "platform": "Site subtitles", "asr": "Auto transcript" },
      "sentences_one": "{{count}} sentence",
      "sentences_other": "{{count}} sentences",
      "status": {
        "uploading": "Upload not finished",
        "queued": "Waiting",
        "processing": "Processing",
        "ready": "Ready",
        "failed": "Failed",
        "canceled": "Canceled"
      },
      "stage": {
        "probe": "Checking the file",
        "fetch": "Downloading",
        "transcode": "Converting",
        "subtitles": "Reading subtitles",
        "transcribe": "Transcribing",
        "segment": "Splitting sentences"
      },
      "progress": "{{stage}} · {{pct}}%",
      "card": {
        "retry": "Retry",
        "addSubtitles": "Add subtitles",
        "delete": "Delete",
        "resumeUpload": "Continue upload",
        "cancelUpload": "Cancel",
        "dismiss": "Dismiss",
        "uploading": "Uploading {{pct}}%",
        "uploadFailed": "Upload stopped: {{reason}}"
      },
      "confirmDelete": {
        "title": "Delete this item?",
        "body": "The media and its sentences are removed. Your recordings and scores stay in your history.",
        "confirm": "Delete"
      },
      "resume": { "mismatch": "That is not the same file. Choose the file you started uploading." },
      "toast": {
        "deleted": "Deleted",
        "uploadDone": "Upload finished. Processing now.",
        "imported": "Link added. Processing now.",
        "subtitlesSaved": "Subtitles added. Processing again.",
        "retrying": "Trying again."
      },
      "sheet": { "title": "Add material", "tabs": "Source", "upload": "Upload", "link": "Link" },
      "upload": {
        "file": "Audio or video file",
        "limits": "Up to {{mb}} MB and {{minutes}} minutes",
        "subtitles": "Subtitles (optional, .srt or .vtt)",
        "titleLabel": "Title (optional)",
        "submit": "Upload",
        "badType": "This file type is not supported.",
        "empty": "This file is empty.",
        "tooLarge": "This file is larger than {{mb}} MB.",
        "overQuota": "Not enough space left in your library.",
        "subtitleBadType": "Subtitles must be a .srt or .vtt file.",
        "subtitleTooLarge": "Subtitle files can be at most 2 MB.",
        "noAsr": "Without subtitles this server cannot transcribe the audio, so add a subtitle file."
      },
      "link": {
        "url": "Video page link",
        "placeholder": "https://",
        "titleLabel": "Title (optional)",
        "submit": "Import",
        "badUrl": "Enter a full link that starts with http:// or https://.",
        "disabled": "The administrator has not turned on link import.",
        "drm": "Works with public video pages that yt-dlp can download directly (such as YouTube). DRM-protected streaming services (Netflix, Disney+, iQIYI, Tencent Video, Youku, Spotify and similar) cannot be imported; upload a file you own instead.",
        "note": "The server downloads the video. This can take a few minutes."
      },
      "player": {
        "notReady": "This item is still being processed.",
        "failed": "This item could not be processed.",
        "back": "Back to library",
        "prev": "Previous sentence",
        "next": "Next sentence",
        "play": "Play",
        "pause": "Pause",
        "loop": {
          "off": "Loop off",
          "infinite": "Loop this sentence",
          "3": "Loop each sentence 3 times",
          "5": "Loop each sentence 5 times"
        },
        "rate": "Speed {{rate}}x",
        "blind": "Hide text",
        "blindOff": "Show text",
        "reveal": "Show",
        "playSentence": "Play sentence {{n}}",
        "mediaError": "Could not load the media.",
        "audio": "Audio only",
        "noSegments": "No sentences yet.",
        "translateShort": "Translate",
        "translateOn": "Hide translation",
        "translateOff": "Show translation",
        "translateLimited": "Today's translation allowance is used up. Playback and shadowing still work.",
        "translateFailed": "Translation is unavailable right now.",
        "translateRetry": "Try again",
        "chipLoop": "Loop",
        "chipBlind": "Blind",
        "rateSlider": "Playback speed"
      },
      "errors": {
        "notFound": "This item no longer exists.",
        "quota": "Your library is out of space.",
        "aiLimited": "Today's AI allowance is used up.",
        "maxItems": "Your library is full. Delete something first.",
        "tooLarge": "The file is larger than the upload limit.",
        "unsupportedFormat": "This file type is not supported.",
        "dailyLimit": "You have added as much as you can today. Come back tomorrow.",
        "concurrentUploads": "Too many uploads at once. Wait for one to finish.",
        "chunkOrder": "The upload got out of step. Try again.",
        "chunkTooLarge": "An upload part was too large.",
        "uploadIncomplete": "The file has not been fully uploaded yet. Continue the upload.",
        "badSubtitle": "The subtitle file could not be read.",
        "badUrl": "This link is not valid or not allowed.",
        "notReady": "This item is not ready yet.",
        "invalidState": "That is not possible right now.",
        "kind": {
          "too_large": "The file is larger than the upload limit.",
          "too_long": "It is longer than the allowed length.",
          "quota": "Today's transcription allowance is used up. Try again tomorrow.",
          "corrupt": "The file could not be read. It may be damaged.",
          "no_audio": "The file has no audio.",
          "bad_subtitle": "The subtitle file could not be read. Upload a .srt or .vtt file.",
          "no_subtitles": "This item has no subtitles and the administrator has not turned on automatic transcription. Upload a subtitle file to process it again.",
          "disk_full": "The server is out of disk space. Contact the administrator.",
          "unsupported_format": "This file type is not supported.",
          "upload_expired": "The upload was not finished within 24 hours. Delete it and upload again.",
          "link_disabled": "The administrator has not turned on link import.",
          "bad_url": "This link is not valid or not allowed.",
          "drm": "This site's content is protected by DRM and cannot be imported. Upload a file you own instead.",
          "private": "The video is private, so the server cannot open it.",
          "geo_blocked": "The video is not available where the server is.",
          "login_required": "The site requires signing in to watch this.",
          "blocked": "The site refused the server (common for data-centre addresses). The most reliable way: download it on your own device and upload the file. Or ask the administrator to set up cookies or a proxy.",
          "playlist_unsupported": "Playlists are not supported. Import the link of a single video.",
          "live_unsupported": "Live streams are not supported.",
          "unsupported_site": "This site is not supported.",
          "ytdlp_failed": "The download failed.",
          "upstream": "The transcription service is unavailable right now.",
          "network": "A network error occurred.",
          "ytdlp_transient": "The download failed for now.",
          "unknown": "Processing failed."
        }
      },
      "shadow": {
        "record": "Record",
        "stop": "Stop",
        "assessing": "Scoring…",
        "listenMine": "My recording",
        "listenOriginal": "Original",
        "addToList": "Add to practice list",
        "added": "Added to your practice list",
        "edit": "Adjust",
        "startEarlier": "Start 0.2 s earlier",
        "startLater": "Start 0.2 s later",
        "endEarlier": "End 0.2 s earlier",
        "endLater": "End 0.2 s later",
        "text": "Sentence text",
        "save": "Save",
        "cancel": "Cancel",
        "best": "Best {{score}}",
        "attempts_one": "{{count}} try",
        "attempts_other": "{{count}} tries",
        "unavailable": "Scoring is not available right now."
      }
    }
  }
}
```

`web/src/features/library/locales/zh-CN.json`:

```json
{
  "web": {
    "library": {
      "title": "跟读库",
      "usedLabel": "已用",
      "add": "添加素材",
      "addShort": "添加",
      "empty": "还没有素材。上传音视频文件或导入链接,然后逐句跟读。",
      "kind": { "audio": "音频", "video": "视频" },
      "sub": { "uploaded": "上传字幕", "platform": "平台字幕", "asr": "自动识别" },
      "sentences_one": "{{count}} 句",
      "sentences_other": "{{count}} 句",
      "status": {
        "uploading": "上传未完成",
        "queued": "排队中",
        "processing": "处理中",
        "ready": "可以跟读",
        "failed": "处理失败",
        "canceled": "已取消"
      },
      "stage": {
        "probe": "检查文件",
        "fetch": "下载中",
        "transcode": "转码中",
        "subtitles": "读取字幕",
        "transcribe": "转写中",
        "segment": "分句中"
      },
      "progress": "{{stage}} · {{pct}}%",
      "card": {
        "retry": "重试",
        "addSubtitles": "补传字幕",
        "delete": "删除",
        "resumeUpload": "继续上传",
        "cancelUpload": "取消",
        "dismiss": "关闭",
        "uploading": "上传中 {{pct}}%",
        "uploadFailed": "上传中断:{{reason}}"
      },
      "confirmDelete": {
        "title": "删除这条素材?",
        "body": "媒体文件和句子会被删除。你的录音和成绩仍保留在练习记录里。",
        "confirm": "删除"
      },
      "resume": { "mismatch": "这不是同一个文件。请选择开始上传时的那个文件。" },
      "toast": {
        "deleted": "已删除",
        "uploadDone": "上传完成,正在处理。",
        "imported": "链接已添加,正在处理。",
        "subtitlesSaved": "字幕已添加,正在重新处理。",
        "retrying": "正在重试。"
      },
      "sheet": { "title": "添加素材", "tabs": "来源", "upload": "上传", "link": "链接" },
      "upload": {
        "file": "音频或视频文件",
        "limits": "单个最大 {{mb}} MB,最长 {{minutes}} 分钟",
        "subtitles": "字幕(可选,.srt 或 .vtt)",
        "titleLabel": "标题(可选)",
        "submit": "上传",
        "badType": "不支持这种文件类型。",
        "empty": "这是一个空文件。",
        "tooLarge": "文件超过了 {{mb}} MB。",
        "overQuota": "库的剩余空间不够。",
        "subtitleBadType": "字幕必须是 .srt 或 .vtt 文件。",
        "subtitleTooLarge": "字幕文件最大 2 MB。",
        "noAsr": "没有字幕时本服务器无法自动转写,请同时上传字幕文件。"
      },
      "link": {
        "url": "视频页面链接",
        "placeholder": "https://",
        "titleLabel": "标题(可选)",
        "submit": "导入",
        "badUrl": "请输入以 http:// 或 https:// 开头的完整链接。",
        "disabled": "管理员没有开启链接导入。",
        "drm": "支持 yt-dlp 能直接下载的公开视频页面(如 YouTube 等)。受 DRM 保护的流媒体服务(Netflix、Disney+、爱奇艺、腾讯视频、优酷、Spotify 等)无法导入,请使用你自己拥有的文件上传。",
        "note": "由服务器下载视频,可能需要几分钟。"
      },
      "player": {
        "notReady": "这条素材还在处理中。",
        "failed": "这条素材处理失败。",
        "back": "回到跟读库",
        "prev": "上一句",
        "next": "下一句",
        "play": "播放",
        "pause": "暂停",
        "loop": {
          "off": "关闭循环",
          "infinite": "单句循环",
          "3": "每句循环 3 遍",
          "5": "每句循环 5 遍"
        },
        "rate": "速度 {{rate}} 倍",
        "blind": "隐藏文字",
        "blindOff": "显示文字",
        "reveal": "显示这句",
        "playSentence": "播放第 {{n}} 句",
        "mediaError": "媒体加载失败。",
        "audio": "音频",
        "noSegments": "还没有句子。",
        "translateShort": "译",
        "translateOn": "隐藏译文",
        "translateOff": "显示译文",
        "translateLimited": "今天的译文额度已用完,播放和跟读不受影响。",
        "translateFailed": "暂时无法生成译文。",
        "translateRetry": "重试",
        "chipLoop": "循环",
        "chipBlind": "盲听",
        "rateSlider": "播放速度"
      },
      "errors": {
        "notFound": "素材不存在或已删除。",
        "quota": "库的空间不够了。",
        "aiLimited": "今天的 AI 额度已用完。",
        "maxItems": "素材条数已达上限,请先删除一些。",
        "tooLarge": "文件超过了单个文件的大小上限。",
        "unsupportedFormat": "不支持这种文件格式。",
        "dailyLimit": "今天添加素材的次数已用完,明天再来。",
        "concurrentUploads": "同时上传的文件太多,请等当前上传完成。",
        "chunkOrder": "上传进度不一致,请重试。",
        "chunkTooLarge": "上传的分片过大。",
        "uploadIncomplete": "文件还没有上传完整,请继续上传。",
        "badSubtitle": "字幕文件无法解析。",
        "badUrl": "链接无效或不允许访问。",
        "notReady": "这条素材还没有处理完。",
        "invalidState": "当前状态下不能这样操作。",
        "kind": {
          "too_large": "文件超过了单个文件的大小上限。",
          "too_long": "时长超过了单条上限。",
          "quota": "今天的自动转写额度已用完,明天可以重试。",
          "corrupt": "文件无法读取,可能已损坏。",
          "no_audio": "文件里没有音频。",
          "bad_subtitle": "字幕文件无法解析,请重新上传 .srt 或 .vtt 文件。",
          "no_subtitles": "这条没有字幕,管理员也没有开启自动转写;可以上传一份字幕后重新导入",
          "disk_full": "服务器磁盘空间不足,请联系管理员。",
          "unsupported_format": "不支持这种文件格式。",
          "upload_expired": "上传超过 24 小时没有完成,已过期。请删除后重新上传。",
          "link_disabled": "管理员没有开启链接导入。",
          "bad_url": "链接无效或不允许访问。",
          "drm": "这个网站的内容受 DRM 保护,无法导入。请使用你自己拥有的文件上传。",
          "private": "视频是私密的,服务器无法访问。",
          "geo_blocked": "视频在服务器所在地区不可用。",
          "login_required": "网站要求登录后才能观看。",
          "blocked": "网站拒绝了服务器的访问(机房 IP 常见)。最稳的办法:在你自己的设备上下载后上传文件;或请管理员配置 cookies 或代理。",
          "playlist_unsupported": "不支持播放列表,请导入单个视频的链接。",
          "live_unsupported": "不支持直播。",
          "unsupported_site": "不支持这个网站。",
          "ytdlp_failed": "下载失败。",
          "upstream": "转写服务暂时不可用。",
          "network": "网络出错。",
          "ytdlp_transient": "下载暂时失败。",
          "unknown": "处理失败。"
        }
      },
      "shadow": {
        "record": "录音",
        "stop": "停止",
        "assessing": "评测中…",
        "listenMine": "听我的",
        "listenOriginal": "听原句",
        "addToList": "加入练习清单",
        "added": "已加入练习清单",
        "edit": "微调",
        "startEarlier": "起点提前 0.2 秒",
        "startLater": "起点推后 0.2 秒",
        "endEarlier": "终点提前 0.2 秒",
        "endLater": "终点推后 0.2 秒",
        "text": "句子文字",
        "save": "保存",
        "cancel": "取消",
        "best": "最好 {{score}}",
        "attempts_one": "{{count}} 次",
        "attempts_other": "{{count}} 次",
        "unavailable": "评测暂时不可用。"
      }
    }
  }
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/locales.test.ts src/i18n src/architecture.test.ts && cd .. && yarn web:typecheck`(`src/i18n` 的逐目录键一致检查会扫到新的 `i18n/` 目录)。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library copy (entry strings eager, the rest lazy)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L3: 契约测试(R-L21)

**Files:**
- Create: `web/src/features/library/library-contract.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import type { LibraryConfig, LibraryLimits } from "./config";
import { ERROR_KINDS } from "./error-kinds";
import {
  LIBRARY_SERVER_ERRORS, type LibraryItem, type LibraryItemDetail, type LibrarySegment, type MediaTicket, type UploadStart,
  type UploadStatus,
} from "./library-api";

/**
 * 契约(spec 2026-10-13-video-import §9):`server/tests/fixtures/library_contract.json` 由 S1 的 test_library_contract.py
 * 对真实应用录制(CONTRACT_UPDATE=1)。`Record<keyof T, true>` 在编译期把键表绑定到 library-api.ts 的类型。
 * W1 在 S1 之后合并,夹具必须存在(不跳过);`import` / `error_texts` / `error_kinds` 由 S2 / Z 补齐前跳过(计划 R-L21)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/library_contract.json");
const contract: Record<string, unknown> | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
const c = contract ?? {};
const has = (key: string) => contract !== null && key in contract;
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const keysOf = (o: object) => Object.keys(o).sort();
const cc = <T>(v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as T;

const CONFIG: Record<keyof LibraryConfig, true> = { enabled: true, linkImport: true, asr: true, ai: true, limits: true };
const LIMITS: Record<keyof LibraryLimits, true> = {
  maxUploadMb: true, maxDurationMinutes: true, quotaMb: true, usedBytes: true, maxItems: true, chunkBytes: true, formats: true,
};
const ITEM: Record<keyof LibraryItem, true> = {
  id: true, kind: true, source: true, title: true, status: true, stage: true, progress: true, errorKind: true, durationMs: true,
  segCount: true, libraryBytes: true, subSource: true, resumeMs: true, ratePct: true, createdAt: true, lastOpenedAt: true,
};
const DETAIL: Record<keyof LibraryItemDetail, true> = { ...ITEM, resumeIdx: true, segments: true };
const SEGMENT: Record<keyof LibrarySegment, true> = {
  idx: true, startMs: true, endMs: true, text: true, zh: true, zhLang: true, analysis: true, analysisLang: true,
};
const START: Record<keyof UploadStart, true> = { itemId: true, chunkBytes: true };
const STATUS: Record<keyof UploadStatus, true> = { uploadReceived: true, uploadTotal: true };
const TICKET: Record<keyof MediaTicket, true> = { url: true, expiresIn: true };
const STATUSES = ["uploading", "queued", "processing", "ready", "failed", "canceled"];

describe("library contract (server fixture)", () => {
  it("has the server-recorded fixture (S1 merged before W1; never skipped)", () => {
    expect(contract).not.toBeNull();
  });

  it("config matches", () => {
    const config = cc<LibraryConfig>(c.config);
    expect(keysOf(config)).toEqual(keys(CONFIG));
    expect(config.enabled).toBe(true);
    expect(keysOf(config.limits as LibraryLimits)).toEqual(keys(LIMITS));
    expect(config.limits?.chunkBytes).toBe(8388608);
    expect(config.limits?.formats.every((f) => typeof f === "string")).toBe(true);
  });

  it("list items and the detail match", () => {
    const page = cc<{ items: LibraryItem[]; nextCursor: string | null }>(c.items);
    expect(keysOf(page)).toEqual(["items", "nextCursor"]);
    expect(keysOf(page.items[0])).toEqual(keys(ITEM));
    expect(STATUSES).toContain(page.items[0].status);
    const detail = cc<LibraryItemDetail>(c.item_detail);
    expect(keysOf(detail)).toEqual(keys(DETAIL));
    expect(keysOf(detail.segments[0])).toEqual(keys(SEGMENT));
    expect(detail.segments[0].endMs).toBeGreaterThan(detail.segments[0].startMs);
    expect(keysOf(cc<LibraryItem>(c.item_patch))).toEqual(keys(ITEM));
  });

  it("upload payloads match", () => {
    const start = cc<UploadStart>(c.upload_start);
    expect(keysOf(start)).toEqual(keys(START));
    expect(start.chunkBytes).toBe(8388608);
    expect(keysOf(cc<UploadStatus>(c.upload_status))).toEqual(keys(STATUS));
    const done = cc<LibraryItem>(c.upload_complete);
    expect(keysOf(done)).toEqual(keys(ITEM));
    expect(done.status).toBe("queued");
  });

  it("the media ticket is a same-origin path whose only query parameter is ticket", () => {
    const ticket = cc<MediaTicket>(c.media_ticket);
    expect(keysOf(ticket)).toEqual(keys(TICKET));
    expect(ticket.url).toMatch(/^\/api\/library\/items\/[^/?#]+\/media\?ticket=[^&#]+$/);
    expect(ticket.expiresIn).toBeGreaterThan(0);
  });

  it.skipIf(!has("import"))("link import returns an item (recorded by S2; Z removes the skip)", () => {
    expect(keysOf(cc<LibraryItem>(c.import))).toEqual(keys(ITEM));
  });

  it("segments carry the D8 translation and analysis columns (S1's D8 addendum)", () => {
    const detail = cc<LibraryItemDetail>(c.item_detail);
    expect(detail.segments.length).toBeGreaterThan(0);
    for (const seg of detail.segments) {
      expect(keysOf(seg)).toEqual(keys(SEGMENT));
      expect(seg.zh === null || typeof seg.zh === "string").toBe(true);
      expect(seg.zhLang === null || typeof seg.zhLang === "string").toBe(true);
      expect(seg.analysis === null || typeof seg.analysis === "string").toBe(true);
    }
  });

  it.skipIf(!has("translate"))("translate returns [{idx, zh}] items, bare or wrapped (S1 records it; Z removes the skip)", () => {
    const reply = cc<{ items?: { idx: number; zh: string }[]; limited?: boolean } | { idx: number; zh: string }[]>(c.translate);
    const items = Array.isArray(reply) ? reply : (reply.items ?? []);
    expect(items.length).toBeGreaterThan(0);
    for (const row of items) expect(keysOf(row)).toEqual(["idx", "zh"]);
  });

  it.skipIf(!has("analysis"))("analysis returns {analysis, cached} (S1 records it; Z removes the skip)", () => {
    expect(keysOf(cc<{ analysis: string; cached: boolean }>(c.analysis))).toEqual(["analysis", "cached"]);
  });

  it.skipIf(!has("error_texts"))("every fixed server error text is translated (Z removes the skip)", () => {
    for (const text of c.error_texts as string[]) expect(LIBRARY_SERVER_ERRORS, text).toHaveProperty([text]);
  });

  it.skipIf(!has("error_kinds"))("the server's error kinds equal the web list (Z removes the skip)", () => {
    expect([...(c.error_kinds as string[])].sort()).toEqual([...ERROR_KINDS].sort());
  });
});
```

- [ ] **Step 2: 跑测试** — `cd web && yarn vitest run src/features/library/library-contract.test.ts`。若某键与 S1 的夹具不一致:以夹具为准**改 `library-api.ts` 的类型与本文件的键表**(并同步 `test-fixtures.ts`),不要改夹具;改动写进提交说明。若 `error_texts` 里有未翻译的文本,把它加进 `LIBRARY_SERVER_ERRORS`,并在两份 `locales/*.json` 的 `web.library.errors` 下加对应键。
  - 若 `config` 没有 `ai`、或句子没有 `zh` / `zh_lang` / `analysis` / `analysis_lang` 键,说明 S1 的 D8 增补(spec §15「D8 增补的归属」S1 行)还没合并:**停下回报「S1 D8 未合并」**,不要改键表去迎合旧夹具。
- [ ] **Step 3: 提交**

```bash
git add web/src/features/library
git commit -m "test(web): pin the library contract against the server fixture

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task LV1: 库内视觉层(一):样式、LibraryRoot、动效开关、GlassSurface、SoftAurora(D11;R-L26–R-L30)

**Files:**
- Create: `web/src/features/library/library.css`、`library-css.test.ts`、`library-root.tsx`、`library-root.test.tsx`、`fx/motion.ts`、`fx/motion.test.ts`、`fx/glass-surface.tsx`、`fx/glass-surface.test.tsx`、`fx/soft-aurora.tsx`、`fx/soft-aurora.test.tsx`

**Interfaces:**
- Produces:`library.css`(所有 `.lib-*` 类与 `.library-root` 令牌,**后面 LV2、LV3、L7–L14 用到的类都在这里一次写全**);`LibraryRoot({aurora?, className?, ...div})`;`FrameSource`、`browserFrames`、`motionAllowed(win?)`;`GlassSurface({as?, strong?, ...})`;`SoftAurora()`
- 依据:`docs/superpowers/design/video-import-v1/mockup-glass.html`(玻璃参数:模糊 34px、饱和 200%、深色填充 `rgba(150,170,255,.10)` / 强面 `.17` / 内高光边 `.26`,浅色填充 `.38` / `.55`)。数值取自稿;与稿不同的地方在文件里写了注释并记在 Addendum(R-L26 的顶栏无模糊、R-L29 的动画属性、R-L30 的极光范围)。

- [ ] **Step 1: 写失败测试**

`web/src/features/library/library-css.test.ts`(读源码文件断言:`test.css = false`,jsdom 不会解析样式,R-L1):

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "library.css"), "utf8");

/** 取 `header {` 之后配对大括号里的内容。 */
function blockOf(source: string, header: RegExp): string {
  const m = header.exec(source);
  if (!m) throw new Error(`missing block: ${header}`);
  const open = source.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${header}`);
}
/** 从某个分节注释开始到下一个分节注释(或文件末尾)。 */
function sectionAfter(source: string, title: string): string {
  const start = source.indexOf(title);
  if (start < 0) throw new Error(`missing section: ${title}`);
  const next = source.indexOf("/* =====", start + title.length);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("library.css (spec §11.4a, D11)", () => {
  it("defines the glass tokens from the mockup on .library-root, light and dark", () => {
    const light = blockOf(css, /^\.library-root\s*\{/m);
    expect(light).toContain("--lib-blur: 34px;");
    expect(light).toContain("--lib-glass-bg: rgba(255, 255, 255, 0.38);");
    expect(light).toContain("--lib-glass-strong: rgba(255, 255, 255, 0.55);");
    const dark = blockOf(css, /^\.dark \.library-root\s*\{/m);
    expect(dark).toContain("--lib-glass-bg: rgba(150, 170, 255, 0.1);");
    expect(dark).toContain("--lib-glass-strong: rgba(120, 140, 230, 0.17);");
    expect(dark).toContain("--lib-glass-bd: rgba(255, 255, 255, 0.26);");
  });

  it("makes the glass surface blur 34px with saturate 200% and keeps the iOS prefix", () => {
    const glass = blockOf(css, /^\.lib-glass\s*\{/m);
    expect(glass).toContain("-webkit-backdrop-filter: blur(var(--lib-blur)) saturate(2);");
    expect(glass).toContain("backdrop-filter: blur(var(--lib-blur)) saturate(2);");
  });

  it("limits blur to three surfaces: .lib-glass, .lib-gblur and the add sheet (R-L26)", () => {
    expect((css.match(/^\s+-webkit-backdrop-filter:\s*blur/gm) ?? []).length).toBe(3); // 只数声明(缩进的行),不数 @supports 的条件
    expect(blockOf(css, /^\.lib-gblur\s*\{/m)).toContain("-webkit-backdrop-filter: blur(7px);");
    expect(blockOf(css, /^\.library-root\.lib-sheet\s*\{/m)).toContain("-webkit-backdrop-filter: blur(var(--lib-blur)) saturate(2);");
    // 列表卡片与顶栏胶囊只用半透明填充 + 高光边
    expect(blockOf(css, /^\.lib-tint\s*\{/m)).not.toContain("backdrop-filter");
    expect(blockOf(css, /^\.lib-bar\s*\{/m)).not.toContain("backdrop-filter");
    expect(blockOf(css, /^\.lib-speed\s*\{/m)).not.toContain("backdrop-filter");
  });

  it("is scoped: no rule styles html, body, :root or * outside the lite fallbacks", () => {
    expect(css).not.toMatch(/^(body|:root|\*)\s*[,{]/m);
    expect(css).not.toMatch(/^html\s*[,{]/m);
    for (const line of css.split("\n").filter((l) => l.startsWith("html.lite"))) expect(line, line).toMatch(/^html\.lite \.(lib-|library-root)/);
  });

  it("animates only transform, opacity and background-position (two documented exceptions)", () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(6);
    const allowed: Record<string, string[]> = { "lib-spin": ["--lib-a"], "lib-bw": ["opacity", "filter", "transform"] };
    for (const name of names) {
      const body = blockOf(css, new RegExp(`@keyframes\\s+${name}\\s*\\{`));
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      const ok = allowed[name] ?? ["transform", "opacity", "background-position"];
      for (const p of props) expect(ok, `${name} animates ${p}`).toContain(p);
    }
    // BorderGlow:@property 不被支持时退化为静态描边(var 有回退值,不会让整条 background 失效)
    expect(css).toContain("@property --lib-a");
    expect(css).toContain("from var(--lib-a, 0deg)");
  });

  it("stills every animation under prefers-reduced-motion and on low-end devices (R-L28)", () => {
    const reduced = blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/);
    const lite = sectionAfter(css, "降级:低端机");
    for (const selector of [
      ".lib-aurora i", ".lib-shiny", ".library-root .lib-spec::after", ".lib-glow::after", '.lib-step[data-state="now"]::after',
      ".lib-zh-skeleton", ".lib-rise", ".lib-bw",
    ]) {
      expect(reduced, `reduced-motion: ${selector}`).toContain(selector);
      expect(lite, `lite: ${selector}`).toContain(selector);
    }
    expect(reduced).toContain("animation: none;");
    expect(lite).toContain("animation: none;");
    expect(blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/)).toContain("transition: none;");
  });

  it("falls back to solid surfaces without backdrop-filter, on low-end devices and with reduced transparency", () => {
    const unsupported = blockOf(css, /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)\s*\{/);
    expect(unsupported).toContain(".lib-glass");
    expect(unsupported).toContain("var(--lib-solid)");
    const lite = sectionAfter(css, "降级:低端机");
    expect(lite).toContain("html.lite .lib-glass");
    expect(lite).toMatch(/backdrop-filter: none;/);
    expect(lite).toContain("background: var(--lib-solid);");
    const transparency = blockOf(css, /@media \(prefers-reduced-transparency: reduce\)\s*\{/);
    expect(transparency).toContain(".lib-glass");
    expect(transparency).toContain("backdrop-filter: none;");
  });

  it("only paints text with a gradient where background-clip: text exists (otherwise the text would vanish)", () => {
    const guarded = blockOf(css, /@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\)\s*\{/);
    expect(guarded).toContain(".lib-shiny");
    expect(guarded).toContain(".lib-gt");
    expect(guarded).toContain("color: transparent;");
    expect(css.replace(guarded, "")).not.toContain("color: transparent;");
  });

  it("keeps every floating layer below the lookup bar (z-index 40) and the global tab bar (z-index 30 sits later in the DOM)", () => {
    const z = (re: RegExp) => Number(/z-index:\s*(\d+);/.exec(blockOf(css, re))?.[1]);
    expect(z(/^\.lib-ctrl\s*\{/m)).toBeLessThanOrEqual(30);
    expect(z(/^\.lib-gblur\s*\{/m)).toBeLessThan(30);
    expect(z(/^\.lib-speed\s*\{/m)).toBeLessThan(40);
    expect(z(/^\.lib-fab\s*\{/m)).toBeLessThanOrEqual(30);
  });

  it("keeps the sentence text selectable so the lookup bar still works (R-L33)", () => {
    const text = blockOf(css, /^\.lib-seg-text\s*\{/m);
    expect(text).toContain("-webkit-user-select: text;");
    expect(text).toContain("user-select: text;");
  });

  it("stays small (target: library styles + effects ≤ 6 kB gzip in total, measured in L16)", () => {
    expect(css.length).toBeLessThan(22_000);
  });
});
```

`web/src/features/library/fx/motion.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { browserFrames, motionAllowed } from "./motion";

const html = document.documentElement;
const win = (reduce: boolean) =>
  Object.assign(Object.create(window), { document, matchMedia: (q: string) => ({ matches: reduce && q.includes("reduce") }) }) as Window;

afterEach(() => html.classList.remove("lite"));

describe("motionAllowed (R-L28)", () => {
  it("is true by default", () => {
    expect(motionAllowed(win(false))).toBe(true);
  });

  it("is false with prefers-reduced-motion", () => {
    expect(motionAllowed(win(true))).toBe(false);
  });

  it("is false on low-end devices (html.lite, layout/glass-quality.ts)", () => {
    html.classList.add("lite");
    expect(motionAllowed(win(false))).toBe(false);
  });

  it("survives a window without matchMedia", () => {
    const bare = Object.assign(Object.create(window), { document, matchMedia: undefined }) as Window;
    expect(motionAllowed(bare)).toBe(true);
  });

  it("exposes the browser frame source", () => {
    expect(typeof browserFrames.now()).toBe("number");
    const id = browserFrames.request(() => {});
    expect(typeof id).toBe("number");
    browserFrames.cancel(id);
  });
});
```

`web/src/features/library/fx/glass-surface.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlassSurface } from "./glass-surface";

describe("GlassSurface (spec §11.4a)", () => {
  it("renders the glass class, the strong variant and passes props through", () => {
    render(<><GlassSurface data-testid="a">x</GlassSurface><GlassSurface strong as="section" data-testid="b" className="extra">y</GlassSurface></>);
    expect(screen.getByTestId("a").className).toBe("lib-glass");
    expect(screen.getByTestId("a").tagName).toBe("DIV");
    expect(screen.getByTestId("b").tagName).toBe("SECTION");
    expect(screen.getByTestId("b").className).toMatch(/\blib-glass\b/);
    expect(screen.getByTestId("b").className).toMatch(/\blib-glass--strong\b/);
    expect(screen.getByTestId("b").className).toMatch(/\bextra\b/);
  });
});
```

`web/src/features/library/fx/soft-aurora.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SoftAurora } from "./soft-aurora";

describe("SoftAurora (spec §11.4a, R-L30)", () => {
  it("is three pure-CSS blobs, hidden from assistive tech, with no canvas or WebGL", () => {
    const { container } = render(<SoftAurora />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("lib-aurora");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.querySelectorAll("i")).toHaveLength(3);
    expect(container.querySelector("canvas")).toBeNull();
  });
});
```

`web/src/features/library/library-root.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LibraryRoot } from "./library-root";

describe("LibraryRoot (R-L27)", () => {
  it("scopes the library tokens, lays the page out and puts the aurora behind the content", () => {
    const { container } = render(<LibraryRoot data-testid="root"><p>hello</p></LibraryRoot>);
    const root = screen.getByTestId("root");
    expect(root.className).toMatch(/\blibrary-root\b/);
    expect(root.className).toMatch(/\blib-page\b/);
    expect(container.querySelector(".lib-aurora")).not.toBeNull();
    expect(root.firstElementChild?.className).toBe("lib-aurora");
    expect(root.lastElementChild?.className).toBe("lib-content");
    expect(screen.getByText("hello").parentElement?.className).toBe("lib-content");
  });

  it("can drop the aurora and takes extra classes", () => {
    const { container } = render(<LibraryRoot aurora={false} className="lib-player" data-testid="root">x</LibraryRoot>);
    expect(container.querySelector(".lib-aurora")).toBeNull();
    expect(screen.getByTestId("root").className).toMatch(/\blib-player\b/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/library-css.test.ts src/features/library/library-root.test.tsx src/features/library/fx`。

- [ ] **Step 3: 实现**

`web/src/features/library/library.css`:

```css
/*
 * 跟读库视觉层(计划 2026-10-13-video-import-web-library:LV1–LV3;spec §11.4a、D11;R-L26–R-L30)。
 * 依据 docs/superpowers/design/video-import-v1/mockup-glass.html:模糊 34px、饱和 200%、深色填充 .10 / 强面 .17 / 内高光边 .26,
 * 浅色填充 .38 / .55。只在 .library-root 内生效,不动 theme.css;文字颜色沿用全站令牌 rgb(var(--ink));深浅色跟随 html.dark(D12)。
 * 规则(library-css.test.ts 守着):一屏模糊层 ≤ 3(只有 .lib-glass、.lib-gblur、.library-root.lib-sheet 写了 backdrop-filter;
 * 全站底栏是第三层,所以播放器顶栏胶囊不模糊);动画只用 transform / opacity / background-position(例外:.lib-glow 的 --lib-a
 * 只重绘、.lib-bw 的 filter 一次性);文末是低端机 html.lite、prefers-reduced-motion、prefers-reduced-transparency 的降级。
 */

/* ===== 令牌 ===== */
.library-root {
  --lib-page: #eef1f8;
  --lib-solid: #ffffff;
  --lib-pop: rgba(255, 255, 255, 0.92);
  --lib-glass-bg: rgba(255, 255, 255, 0.38);
  --lib-glass-strong: rgba(255, 255, 255, 0.55);
  --lib-glass-bd: rgba(255, 255, 255, 0.85);
  --lib-glass-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(255, 255, 255, 0.25);
  --lib-glass-sh: 0 10px 30px -8px rgba(36, 56, 110, 0.28);
  --lib-card-sh: 0 6px 18px -10px rgba(36, 56, 110, 0.3);
  --lib-chip: rgba(255, 255, 255, 0.6);
  --lib-hair: rgba(17, 19, 24, 0.1);
  --lib-blue-tint: rgba(36, 86, 219, 0.12);
  --lib-blob1: #9db8ff;
  --lib-blob2: #b9f0e6;
  --lib-blob3: #ffd7b0;
  --lib-blur: 34px;
  /* 全站底栏的高度(glass-tab-bar 的 TAB_BAR_HEIGHT)+ 安全区:页面延伸到底栏下面,浮层贴着底栏上沿 */
  --lib-tab: calc(3.5rem + env(safe-area-inset-bottom));
}
.dark .library-root {
  --lib-page: #0b0d14;
  --lib-solid: #1a1d25;
  --lib-pop: rgba(26, 29, 37, 0.92);
  --lib-glass-bg: rgba(150, 170, 255, 0.1);
  --lib-glass-strong: rgba(120, 140, 230, 0.17);
  --lib-glass-bd: rgba(255, 255, 255, 0.26);
  --lib-glass-hi: inset 0 1px 0 rgba(255, 255, 255, 0.38), inset 0 0 22px rgba(255, 255, 255, 0.05), inset 0 -1px 0 rgba(255, 255, 255, 0.08);
  --lib-glass-sh: 0 14px 38px -8px rgba(0, 0, 0, 0.65);
  --lib-card-sh: 0 6px 18px -10px rgba(0, 0, 0, 0.6);
  --lib-chip: rgba(255, 255, 255, 0.1);
  --lib-hair: rgba(255, 255, 255, 0.12);
  --lib-blue-tint: rgba(143, 176, 255, 0.18);
  --lib-blob1: #4f6dff;
  --lib-blob2: #12b3a2;
  --lib-blob3: #8f5a3a;
}

/* ===== 页面 ===== */
/* 页面底色延伸到全站底栏下面(负外边距 + 等量内边距),底栏的玻璃才不会透出别的底色 */
.lib-page {
  position: relative;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-height: 0;
  color: rgb(var(--ink));
  background: var(--lib-page);
  padding-bottom: var(--lib-tab);
  margin-bottom: calc(-1 * var(--lib-tab));
}
/* 播放器:自己是一个不滚动的 flex 列(滚动在 .lib-segments 里,R-L33) */
.lib-player {
  flex: 1 1 0;
  overflow: hidden;
}
.lib-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* ===== SoftAurora:三团慢速漂移的色块(纯 CSS,不用 WebGL);R-L30 只覆盖页面第一屏 ===== */
.lib-aurora {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: min(100%, 100dvh);
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.lib-aurora i {
  position: absolute;
  width: 320px;
  height: 320px;
  border-radius: 50%;
  filter: blur(50px);
  opacity: 0.9;
  animation: lib-drift 18s ease-in-out infinite alternate;
}
.lib-aurora i:nth-child(1) { left: -80px; top: 40px; background: var(--lib-blob1); }
.lib-aurora i:nth-child(2) { right: -100px; top: 280px; background: var(--lib-blob2); animation-duration: 23s; }
.lib-aurora i:nth-child(3) { left: 20px; bottom: -100px; background: var(--lib-blob3); animation-duration: 27s; }
@keyframes lib-drift {
  to { transform: translate(40px, -50px) scale(1.15); }
}

/* ===== GlassSurface:模糊 + 饱和 + 内高光边 + 外阴影 ===== */
.lib-glass {
  background: var(--lib-glass-bg);
  -webkit-backdrop-filter: blur(var(--lib-blur)) saturate(2);
  backdrop-filter: blur(var(--lib-blur)) saturate(2);
  border: 1px solid var(--lib-glass-bd);
  box-shadow: var(--lib-glass-hi), var(--lib-glass-sh);
}
.lib-glass--strong { background: var(--lib-glass-strong); }
/* 列表卡片等:只用半透明填充 + 高光边,不加 backdrop-filter(一屏最多 3 层模糊) */
.lib-tint {
  background: var(--lib-glass-bg);
  border: 1px solid var(--lib-glass-bd);
  box-shadow: var(--lib-glass-hi), var(--lib-card-sh);
}
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .lib-glass,
  .library-root.lib-sheet { background: var(--lib-solid); }
  .lib-gblur { display: none; }
}

/* ===== SpotlightCard:手指 / 鼠标所在位置的跟随高光 ===== */
.lib-spot { position: relative; overflow: hidden; }
.lib-spot::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s;
  background: radial-gradient(160px circle at var(--mx, 50%) var(--my, 50%), rgba(255, 255, 255, 0.55), transparent 70%);
}
.dark .lib-spot::before {
  background: radial-gradient(160px circle at var(--mx, 50%) var(--my, 50%), rgba(143, 176, 255, 0.28), transparent 70%);
}
.lib-spot[data-press]::before { opacity: 1; }
@media (hover: hover) {
  .lib-spot:hover::before { opacity: 1; }
}
/* 卡片依次浮入(一次性);--lib-delay 由 ItemCard 按序号给 */
.lib-rise {
  opacity: 0;
  animation: lib-rise 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  animation-delay: var(--lib-delay, 0s);
}
@keyframes lib-rise {
  from { opacity: 0; transform: translateY(14px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

/* ===== 列表页:已用空间条、「添加」主按钮 ===== */
.lib-quota {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 18px;
  font-size: 12px;
  color: rgb(var(--ink-2));
}
.lib-quota-bar { flex: 1; height: 5px; border-radius: 3px; background: var(--lib-hair); overflow: hidden; }
.lib-quota-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, rgb(var(--blue)), rgb(var(--teal)));
  transform-origin: left center;
  transform: scaleX(var(--p, 0));
}
/* 贴着底栏上沿的悬浮按钮:sticky 的下沿算的是滚动区(含内边距)的下沿,所以要把底栏高度算进去(R-L33) */
.lib-fab {
  position: sticky;
  bottom: calc(var(--lib-tab) + 12px);
  z-index: 30;
  align-self: flex-end;
  margin: auto 16px 12px 0;
}

/* ===== ShinyText:处理中的文字流光;GradientText:高分渐变字(回退色在前,@supports 里再覆盖) ===== */
.lib-shiny { color: rgb(var(--ink-2)); }
.lib-gt { color: #18a058; font-weight: 700; }
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .lib-shiny {
    background: linear-gradient(110deg, rgb(var(--ink-2)) 35%, rgb(var(--ink)) 50%, rgb(var(--ink-2)) 65%);
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation: lib-shine 2.4s linear infinite;
  }
  .lib-gt {
    background: linear-gradient(90deg, #18a058, #2cc7b0 60%, #4b78f0);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
  }
}
@keyframes lib-shine {
  from { background-position: 130% 0; }
  to { background-position: -90% 0; }
}

/* ===== Stepper:处理阶段(圆点 + 连线,当前阶段脉冲) ===== */
.lib-steps { display: flex; align-items: center; margin-top: 9px; }
.lib-step {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--lib-hair);
  color: rgb(var(--ink-3));
}
.lib-step[data-state="done"] { background: rgb(var(--blue)); color: rgb(var(--on-blue)); }
.lib-step[data-state="now"] { background: var(--lib-solid); border: 2px solid rgb(var(--blue)); }
.lib-step[data-state="now"]::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid rgb(var(--blue));
  animation: lib-pulse 1.6s ease-out infinite;
}
.lib-step-line { flex: 1; height: 2px; background: var(--lib-hair); }
.lib-step-line[data-state="done"] { background: rgb(var(--blue)); }
.lib-step-labels { display: flex; justify-content: space-between; margin-top: 3px; font-size: 9.5px; color: rgb(var(--ink-3)); }
@keyframes lib-pulse {
  from { transform: scale(0.7); opacity: 0.7; }
  to { transform: scale(1.5); opacity: 0; }
}

/* ===== SpecularButton:主按钮,斜向高光扫过 ===== */
.library-root .lib-spec {
  position: relative;
  overflow: hidden;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(180deg, #4b78f0, #2456db);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 10px 24px -8px rgba(36, 86, 219, 0.65);
}
.dark .library-root .lib-spec { background: linear-gradient(180deg, #6d93ff, #3a63e0); }
.library-root .lib-spec::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 46%;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  transform: translateX(-130%) skewX(-22deg);
  animation: lib-sweep 3.2s ease-in-out infinite;
}
.library-root .lib-spec:active { transform: scale(0.97); }
@keyframes lib-sweep {
  0%, 55% { transform: translateX(-130%) skewX(-22deg); }
  100% { transform: translateX(285%) skewX(-22deg); }
}

/* ===== 添加素材弹层(BottomSheetContent 经 Portal 在 body 下,所以它自己带 .library-root):悬浮的强玻璃板 ===== */
.library-root.lib-sheet {
  left: 8px;
  right: 8px;
  bottom: calc(8px + env(safe-area-inset-bottom));
  width: auto;
  max-width: min(640px, calc(100% - 16px));
  border-radius: 28px;
  background: var(--lib-glass-strong);
  -webkit-backdrop-filter: blur(var(--lib-blur)) saturate(2);
  backdrop-filter: blur(var(--lib-blur)) saturate(2);
  border: 1px solid var(--lib-glass-bd);
  box-shadow: var(--lib-glass-hi), var(--lib-glass-sh);
}
.library-root .lib-field {
  background: var(--lib-chip);
  border: 0.5px solid var(--lib-hair);
  border-radius: 14px;
}

/* ===== 播放器:顶栏胶囊、媒体区、句子列表 ===== */
.lib-stage { position: relative; flex: none; padding-top: env(safe-area-inset-top); background: #000; }
.lib-stage-audio {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: 3 / 1;
  background: linear-gradient(160deg, #1c2540, #3a2a55 55%, #124a52);
  color: rgba(255, 255, 255, 0.85);
}
/* 压在视频上的顶栏:半透明填充 + 高光边,不模糊(视频上做 backdrop-filter 很贵,且全站底栏已占第三层,R-L26) */
.lib-bar {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 8px);
  left: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 6px;
  border-radius: 22px;
  color: #fff;
  background: rgba(0, 0, 0, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 8px 24px -8px rgba(0, 0, 0, 0.5);
}
.lib-bar-btn { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; color: inherit; }
.lib-bar-btn svg { width: 22px; height: 22px; }
.lib-bar-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 600; }
.lib-stage-alert {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 14px;
  font-size: 13px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}
/* 句子列表是圆角抽屉,自己滚动(文档与 <main> 都不滚,R-L33) */
.lib-segments {
  position: relative;
  z-index: 2;
  flex: 1 1 0;
  min-height: 0;
  margin-top: -14px;
  padding: 8px 10px 160px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 26px 26px 0 0;
  background: var(--lib-page);
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.18);
}
.lib-row { position: relative; margin: 2px 0; padding: 4px 6px 4px 8px; border-radius: 18px; }
/* 非当前行跳过屏幕外的布局与绘制(不引虚拟列表库,spec §11.5);当前行不用,否则 paint containment 会裁掉它的投影与描边 */
.lib-row:not([aria-current="true"]) { content-visibility: auto; contain-intrinsic-size: auto 72px; }
.lib-row[aria-current="true"] { background: var(--lib-glass-strong); box-shadow: var(--lib-glass-hi), 0 8px 22px -10px rgba(36, 86, 219, 0.5); }
.lib-row-play {
  display: inline-flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: rgb(var(--ink-2));
}
.lib-row[aria-current="true"] .lib-row-play { color: rgb(var(--blue)); }
.lib-seg-text {
  flex: 1;
  min-width: 0;
  padding: 10px 0;
  font-size: 17px;
  line-height: 1.5;
  -webkit-user-select: text;
  user-select: text;
}
.lib-zh { margin-top: 2px; font-size: 13px; line-height: 1.5; color: rgb(var(--ink-2)); }
.lib-zh-skeleton {
  display: block;
  width: min(70%, 16rem);
  height: 12px;
  margin-top: 6px;
  border-radius: 6px;
  background: var(--lib-hair);
  animation: lib-skel 1.4s ease-in-out infinite;
}
@keyframes lib-skel {
  50% { opacity: 0.45; }
}

/* ===== BorderGlow:当前句的流动描边(只描 1.5px;@property 不被支持时是静态描边) ===== */
@property --lib-a {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}
.lib-glow { position: relative; }
.lib-glow::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1.5px;
  pointer-events: none;
  background: conic-gradient(from var(--lib-a, 0deg), transparent 0 55%, rgb(var(--blue)) 78%, #7fe3d6 90%, transparent 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: lib-spin 3.6s linear infinite;
}
@keyframes lib-spin {
  to { --lib-a: 360deg; }
}

/* ===== GradualBlur:列表底部渐进模糊,文字滑入控制条时自然淡出(算一层模糊) ===== */
.lib-gblur {
  position: absolute;
  left: 0;
  right: 0;
  bottom: var(--lib-tab);
  height: 190px;
  z-index: 20;
  pointer-events: none;
  -webkit-backdrop-filter: blur(7px);
  backdrop-filter: blur(7px);
  -webkit-mask-image: linear-gradient(transparent, #000 70%);
  mask-image: linear-gradient(transparent, #000 70%);
}

/* ===== 控制胶囊与芯片(z-index ≤ 30:选词操作条是 z-40,会盖在它上面,R-L33) ===== */
.lib-ctrl {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: calc(var(--lib-tab) + 10px);
  z-index: 30;
  padding: 10px 12px 12px;
  border-radius: 30px;
}
.lib-ctrl-main { display: flex; align-items: center; justify-content: center; gap: 22px; }
.lib-ctrl-btn { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: rgb(var(--ink)); }
.lib-ctrl-btn:disabled { opacity: 0.4; }
.lib-ctrl-btn svg { width: 24px; height: 24px; }
.lib-ctrl-play { width: 48px; height: 48px; }
.lib-chips { display: flex; justify-content: center; gap: 7px; margin-top: 8px; }
.lib-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 12px;
  border-radius: 17px;
  font-size: 12.5px;
  color: rgb(var(--ink));
  background: var(--lib-chip);
  border: 0.5px solid var(--lib-hair);
}
.lib-chip::before { content: ""; position: absolute; inset: -5px -2px; } /* 视觉 34px,命中区 44px */
.lib-chip:disabled { opacity: 0.4; }
.lib-chip svg { width: 15px; height: 15px; }
.lib-chip[aria-pressed="true"] { color: rgb(var(--blue)); font-weight: 600; background: var(--lib-blue-tint); }
.lib-notice { margin: 0 4px 6px; font-size: 12px; text-align: center; color: rgb(var(--ink-2)); }
.lib-notice-btn { margin-left: 6px; min-height: 44px; padding: 0 6px; font-weight: 600; color: rgb(var(--blue)); }

/* ===== ElasticSlider:速度滑块(弹性手感,吸附档位);只动 transform ===== */
.lib-speed {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: calc(var(--lib-tab) + 150px);
  z-index: 35;
  padding: 12px 16px;
  border-radius: 24px;
  background: var(--lib-pop);
  border: 1px solid var(--lib-glass-bd);
  box-shadow: var(--lib-glass-hi), var(--lib-glass-sh);
}
.lib-speed-top { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12.5px; color: rgb(var(--ink-2)); }
.lib-speed-top b { font-size: 15px; color: rgb(var(--ink)); }
.lib-slider-track { position: relative; height: 36px; touch-action: none; cursor: pointer; }
.lib-slider-track:focus-visible { outline: 2px solid rgb(var(--ring)); outline-offset: 2px; border-radius: 10px; }
.lib-slider-rail { position: absolute; left: 0; right: 0; top: 15px; height: 6px; border-radius: 3px; background: var(--lib-hair); overflow: hidden; }
.lib-slider-fill {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgb(var(--blue)), rgb(var(--teal)));
  transform-origin: left center;
  transform: scaleX(var(--p, 0));
  transition: transform 0.18s cubic-bezier(0.3, 1.6, 0.5, 1);
}
.lib-slider-knob {
  position: absolute;
  left: 0;
  top: 7px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: transform 0.18s cubic-bezier(0.3, 1.6, 0.5, 1);
}
.lib-slider-ticks { display: flex; justify-content: space-between; margin-top: -2px; padding: 0 2px; font-size: 10.5px; color: rgb(var(--ink-3)); }

/* ===== ClickSpark / BlurText ===== */
.lib-spark-host { position: relative; display: inline-flex; }
.lib-spark {
  position: absolute;
  z-index: 90;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  pointer-events: none;
  animation: lib-spk 0.55s ease-out forwards;
}
@keyframes lib-spk {
  from { opacity: 1; transform: translate(0, 0) scale(1); }
  to { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.3); }
}
.lib-bw {
  display: inline-block;
  opacity: 0;
  filter: blur(8px);
  transform: translateY(6px);
  animation: lib-bw 0.5s ease forwards;
  animation-delay: var(--d, 0ms);
}
@keyframes lib-bw {
  to { opacity: 1; filter: none; transform: none; }
}

/* ===== 降级:低端机 html.lite(layout/glass-quality.ts):去模糊、去动画、玻璃退为实色 ===== */
html.lite .lib-glass,
html.lite .library-root.lib-sheet {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: var(--lib-solid);
}
html.lite .lib-gblur {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  -webkit-mask-image: none;
  mask-image: none;
  background: linear-gradient(transparent, var(--lib-page) 80%);
}
html.lite .lib-aurora { opacity: 0.5; }
html.lite .lib-aurora i,
html.lite .lib-shiny,
html.lite .library-root .lib-spec::after,
html.lite .lib-glow::after,
html.lite .lib-step[data-state="now"]::after,
html.lite .lib-zh-skeleton {
  animation: none;
}
html.lite .lib-rise { animation: none; opacity: 1; }
html.lite .lib-bw { animation: none; opacity: 1; filter: none; transform: none; }

/* ===== 降级:系统「减少动态效果」:全部静止 ===== */
@media (prefers-reduced-motion: reduce) {
  .lib-aurora i,
  .lib-shiny,
  .library-root .lib-spec::after,
  .lib-glow::after,
  .lib-step[data-state="now"]::after,
  .lib-zh-skeleton,
  .lib-spark {
    animation: none;
  }
  .lib-rise { animation: none; opacity: 1; }
  .lib-bw { animation: none; opacity: 1; filter: none; transform: none; }
  .lib-slider-fill,
  .lib-slider-knob { transition: none; }
}

/* ===== 降级:系统「减少透明度」:玻璃一律实心 ===== */
@media (prefers-reduced-transparency: reduce) {
  .lib-glass,
  .library-root.lib-sheet {
    background: var(--lib-solid);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .lib-gblur { display: none; }
}
```

注意 `library-css.test.ts` 的「分节」断言用文件里的 `/* ===== 降级:低端机` 注释切片;不要改这个注释的写法。

`web/src/features/library/fx/motion.ts`:

```ts
/**
 * 库内动效的开关与帧源(spec §11.4a、R-L28)。CSS 动画靠 library.css 末尾的降级段;用 JS 驱动的效果
 * (CountUp、BlurText、ClickSpark)在这里判断,并可注入假的帧源做测试。
 */
export interface FrameSource {
  request(cb: (now: number) => void): number;
  cancel(id: number): void;
  now(): number;
}

export const browserFrames: FrameSource = {
  request: (cb) => window.requestAnimationFrame(cb),
  cancel: (id) => window.cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** 低端机(html.lite)或系统开了「减少动态效果」时为 false:JS 驱动的效果直接给终态,不动画。 */
export function motionAllowed(win: Window = window): boolean {
  if (win.document.documentElement.classList.contains("lite")) return false;
  try {
    return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}
```

`web/src/features/library/fx/glass-surface.tsx`:

```tsx
import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 玻璃面(GlassSurface):模糊 + 饱和 + 内高光边 + 外阴影,样式是 library.css 的 `.lib-glass`。
 * 一屏最多 3 层模糊(R-L26):播放器里只有控制胶囊用它;`strong` = 强面(更不透明)。
 */
export function GlassSurface({ as: Tag = "div", strong = false, className, ...rest }: HTMLAttributes<HTMLElement> & { as?: ElementType; strong?: boolean }) {
  return <Tag className={cn("lib-glass", strong && "lib-glass--strong", className)} {...rest} />;
}
```

`web/src/features/library/fx/soft-aurora.tsx`:

```tsx
/** 页面背景(SoftAurora):三团模糊色块缓慢漂移,纯 CSS(不用 WebGL)。让玻璃「后面有东西」;样式在 library.css 的 `.lib-aurora`(R-L30)。 */
export function SoftAurora() {
  return (
    <div aria-hidden className="lib-aurora">
      <i />
      <i />
      <i />
    </div>
  );
}
```

`web/src/features/library/library-root.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { SoftAurora } from "./fx/soft-aurora";
import "./library.css";

/**
 * 跟读库页面的根(R-L27):`.library-root` 是库内 CSS 变量的作用域(深浅色跟随 html.dark),`.lib-page` 给页面底色并延伸到全站底栏下面,
 * 极光在内容后面。只由懒块里的页面使用(library.css 随懒块进入,不进主包)。播放器再加 `lib-player`。
 */
export function LibraryRoot({ aurora = true, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { aurora?: boolean }) {
  return (
    <div className={cn("library-root lib-page", className)} {...rest}>
      {aurora ? <SoftAurora /> : null}
      <div className="lib-content">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/library-css.test.ts src/features/library/library-root.test.tsx src/features/library/fx src/architecture.test.ts && cd .. && yarn web:typecheck`。`library-css.test.ts` 若有一条失败,**改 `library.css` 去满足它**(这些规则就是 spec §11.4a 的硬规则),不要放宽测试。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library visual layer (scoped css, root, glass surface, soft aurora)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task LV2: 库内视觉层(二):SpotlightCard、SpecularButton、ShinyText、Stepper、BorderGlow(D11)

**Files:**
- Create: `web/src/features/library/fx/spotlight-card.tsx`、`spotlight-card.test.tsx`、`specular-button.tsx`、`specular-button.test.tsx`、`shiny-text.tsx`、`shiny-text.test.tsx`、`stepper.tsx`、`stepper.test.tsx`、`border-glow.ts`、`border-glow.test.ts`

**Interfaces:**
- Produces:`pointerOffset(rect, x, y)`、`SpotlightCard`;`SPECULAR_CLASS`、`SpecularButton`;`ShinyText`;`StepperStep`、`stepIndex(steps, current)`、`Stepper({steps, current, className?})`;`borderGlowClass(active)`

- [ ] **Step 1: 写失败测试**

`web/src/features/library/fx/spotlight-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpotlightCard, pointerOffset } from "./spotlight-card";

/** jsdom 26 没有 PointerEvent 构造函数:`fireEvent.pointerDown(el, { clientX })` 传不进坐标。用 MouseEvent 派发同名事件(React 按事件类型分发)。 */
const pointer = (el: Element, type: string, x = 0, y = 0) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));

describe("SpotlightCard (spec §11.4a)", () => {
  it("computes the pointer offset inside the card", () => {
    expect(pointerOffset({ left: 10, top: 20 }, 55, 30)).toEqual({ x: 45, y: 10 });
  });

  it("writes the highlight position to CSS variables without re-rendering and marks a press", () => {
    const onPointerDown = vi.fn();
    render(<SpotlightCard data-testid="card" onPointerDown={onPointerDown}>x</SpotlightCard>);
    const card = screen.getByTestId("card");
    card.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 80, right: 300, bottom: 130, x: 100, y: 50, toJSON() {} }) as DOMRect;
    pointer(card, "pointerdown", 130, 70);
    expect(card.style.getPropertyValue("--mx")).toBe("30px");
    expect(card.style.getPropertyValue("--my")).toBe("20px");
    expect(card).toHaveAttribute("data-press");
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    pointer(card, "pointermove", 150, 90);
    expect(card.style.getPropertyValue("--mx")).toBe("50px");
    pointer(card, "pointerup");
    expect(card).not.toHaveAttribute("data-press");
  });

  it("releases the press when the pointer leaves or the gesture is cancelled", () => {
    render(<SpotlightCard data-testid="card">x</SpotlightCard>);
    const card = screen.getByTestId("card");
    for (const release of [fireEvent.pointerLeave, fireEvent.pointerCancel]) {
      pointer(card, "pointerdown", 1, 1);
      expect(card).toHaveAttribute("data-press");
      release(card);
      expect(card).not.toHaveAttribute("data-press");
    }
  });

  it("is a tinted spot surface that keeps extra classes", () => {
    render(<SpotlightCard data-testid="card" className="p-3">x</SpotlightCard>);
    expect(screen.getByTestId("card").className).toMatch(/\blib-spot\b/);
    expect(screen.getByTestId("card").className).toMatch(/\blib-tint\b/);
    expect(screen.getByTestId("card").className).toMatch(/\bp-3\b/);
  });
});
```

`web/src/features/library/fx/specular-button.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SPECULAR_CLASS, SpecularButton } from "./specular-button";

describe("SpecularButton (spec §11.4a)", () => {
  it("is a 44px-high button with the specular class that does not submit forms by default", () => {
    const onClick = vi.fn();
    render(<SpecularButton onClick={onClick}>Go</SpecularButton>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain(SPECULAR_CLASS);
    expect(button.className).toMatch(/\bmin-h-tap\b/);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("can be disabled and keeps a caller's type and classes", () => {
    render(<SpecularButton type="submit" disabled className="h-12">Send</SpecularButton>);
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "submit");
    expect(button.className).toMatch(/\bh-12\b/);
  });
});
```

`web/src/features/library/fx/shiny-text.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShinyText } from "./shiny-text";

describe("ShinyText (spec §11.4a)", () => {
  it("renders its text with the shine class", () => {
    render(<ShinyText className="num">Transcribing 62%</ShinyText>);
    const el = screen.getByText("Transcribing 62%");
    expect(el.className).toMatch(/\blib-shiny\b/);
    expect(el.className).toMatch(/\bnum\b/);
  });
});
```

`web/src/features/library/fx/stepper.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper, stepIndex, type StepperStep } from "./stepper";

const STEPS: StepperStep[] = [
  { key: "probe", label: "Check" }, { key: "transcode", label: "Convert" }, { key: "transcribe", label: "Transcribe" }, { key: "segment", label: "Split" },
];
const states = (el: Element) => [...el.querySelectorAll(".lib-step")].map((s) => s.getAttribute("data-state"));
const lines = (el: Element) => [...el.querySelectorAll(".lib-step-line")].map((s) => s.getAttribute("data-state"));

describe("Stepper (spec §11.4a)", () => {
  it("finds the current stage and treats unknown or missing stages as not started", () => {
    expect(stepIndex(STEPS, "transcode")).toBe(1);
    expect(stepIndex(STEPS, "nope")).toBe(-1);
    expect(stepIndex(STEPS, null)).toBe(-1);
  });

  it("marks stages before the current one done, the current one now and the rest todo", () => {
    const { container } = render(<Stepper steps={STEPS} current="transcribe" />);
    expect(states(container)).toEqual(["done", "done", "now", "todo"]);
    expect(lines(container)).toEqual(["done", "done", "todo"]);
    expect([...container.querySelectorAll(".lib-step-labels span")].map((s) => s.textContent)).toEqual(["Check", "Convert", "Transcribe", "Split"]);
  });

  it("shows nothing done before the first stage starts", () => {
    const { container } = render(<Stepper steps={STEPS} current={null} />);
    expect(states(container)).toEqual(["todo", "todo", "todo", "todo"]);
    expect(lines(container)).toEqual(["todo", "todo", "todo"]);
  });

  it("is decorative: the card's progress bar carries the semantics", () => {
    const { container } = render(<Stepper steps={STEPS} current="probe" className="mt-1" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.className).toMatch(/\bmt-1\b/);
  });
});
```

`web/src/features/library/fx/border-glow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { borderGlowClass } from "./border-glow";

describe("BorderGlow (spec §11.4a, R-L29)", () => {
  it("is the flowing-border class only for the active item", () => {
    expect(borderGlowClass(true)).toBe("lib-glow");
    expect(borderGlowClass(false)).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/fx`。

- [ ] **Step 3: 实现**

`web/src/features/library/fx/spotlight-card.tsx`:

```tsx
import type { HTMLAttributes, PointerEvent } from "react";
import { cn } from "@renderer/lib/utils";

export function pointerOffset(rect: { left: number; top: number }, clientX: number, clientY: number): { x: number; y: number } {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * 卡片(SpotlightCard):按住 / 悬停时高光跟随手指(spec §11.4a)。`pointermove` 只写两个 CSS 变量(--mx / --my),
 * 不触发 React 渲染;按住时给 `data-press`。半透明填充 + 高光边(`.lib-tint`),不加模糊。
 */
export function SpotlightCard({ className, onPointerMove, onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const { x, y } = pointerOffset(el.getBoundingClientRect(), e.clientX, e.clientY);
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
  };
  const release = (e: PointerEvent<HTMLDivElement>) => e.currentTarget.removeAttribute("data-press");
  return (
    <div
      className={cn("lib-spot lib-tint", className)}
      onPointerMove={(e) => { move(e); onPointerMove?.(e); }}
      onPointerDown={(e) => { move(e); e.currentTarget.setAttribute("data-press", ""); onPointerDown?.(e); }}
      onPointerUp={(e) => { release(e); onPointerUp?.(e); }}
      onPointerLeave={(e) => { release(e); onPointerLeave?.(e); }}
      onPointerCancel={(e) => { release(e); onPointerCancel?.(e); }}
      {...rest}
    />
  );
}
```

`web/src/features/library/fx/specular-button.tsx`:

```tsx
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@renderer/lib/utils";

/** 主按钮的玻璃光带样式类(SpecularButton):渐变底 + 内高光 + 斜向光带周期性扫过。只在 `.library-root` 内生效(library.css)。 */
export const SPECULAR_CLASS = "lib-spec";

export const SpecularButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function SpecularButton(
  { className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex min-h-tap min-w-0 items-center justify-center gap-2 px-5 text-body font-semibold",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
        SPECULAR_CLASS,
        className,
      )}
      {...rest}
    />
  );
});
```

`web/src/features/library/fx/shiny-text.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

/** 处理中的文字流光(ShinyText):`background-clip: text` + 流光渐变;不支持时是普通次要色文字(library.css 的 @supports 守卫)。 */
export function ShinyText({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("lib-shiny", className)} {...rest} />;
}
```

`web/src/features/library/fx/stepper.tsx`:

```tsx
import { CheckIcon } from "lucide-react";
import { Fragment } from "react";

export interface StepperStep { key: string; label: string }

/** 当前阶段在步骤里的位置;未知或没有(排队中)为 -1。 */
export function stepIndex(steps: readonly StepperStep[], current: string | null): number {
  return current === null ? -1 : steps.findIndex((s) => s.key === current);
}

/**
 * 处理阶段(Stepper):圆点 + 连线,已完成实心蓝 + 勾,当前阶段脉冲圈(只动 transform / opacity),其余灰。
 * 纯装饰(aria-hidden):语义由卡片上的 role="progressbar" 承担。
 */
export function Stepper({ steps, current, className }: { steps: readonly StepperStep[]; current: string | null; className?: string }) {
  const at = stepIndex(steps, current);
  return (
    <div aria-hidden className={className}>
      <div className="lib-steps">
        {steps.map((step, i) => {
          const state = at < 0 ? "todo" : i < at ? "done" : i === at ? "now" : "todo";
          return (
            <Fragment key={step.key}>
              {i > 0 ? <span className="lib-step-line" data-state={at >= 0 && i <= at ? "done" : "todo"} /> : null}
              <span className="lib-step" data-state={state}>
                {state === "done" ? <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} /> : null}
              </span>
            </Fragment>
          );
        })}
      </div>
      <div className="lib-step-labels">
        {steps.map((step) => <span key={step.key}>{step.label}</span>)}
      </div>
    </div>
  );
}
```

`web/src/features/library/fx/border-glow.ts`:

```ts
/**
 * 当前句的流动描边(BorderGlow):`.lib-glow::after` 是 conic-gradient 旋转描边(只描 1.5px;`@property --lib-a`,
 * 不支持的浏览器退化为静态描边,R-L29)。每屏只有当前一句在动。
 */
export function borderGlowClass(active: boolean): string {
  return active ? "lib-glow" : "";
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/fx src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library/fx
git commit -m "feat(web): library effects (spotlight card, specular button, shiny text, stepper, border glow)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task LV3: 库内视觉层(三):ElasticSlider、CountUp + GradientText、ClickSpark、BlurText、GradualBlur(D11)

**Files:**
- Create: `web/src/features/library/fx/elastic-slider.tsx`、`elastic-slider.test.tsx`、`count-up.tsx`、`count-up.test.tsx`、`click-spark.tsx`、`click-spark.test.tsx`、`blur-text.tsx`、`blur-text.test.tsx`、`gradual-blur.tsx`、`gradual-blur.test.tsx`、`index.ts`

**Interfaces:**
- Produces:`snapIndex(x, left, width, count)`、`ElasticSlider<T extends number>({steps, value, onChange, label, format?, className?})`;`countUpValue(progress, to)`、`useCountUp(to, opts?)`、`CountUp({to, format?, className?, durationMs?, frames?, enabled?})`、`GradientText`;`SPARK_COUNT`、`SPARK_MS`、`sparkBurst(origin, count?)`、`ClickSpark({children, className?, disabled?})`;`BLUR_TEXT_MAX_TOKENS`、`splitBlurTokens(text)`、`BlurText({text, stepMs?, className?, enabled?})`;`GradualBlur`;`fx/index.ts`(桶,给 W2 用)
- 给 W2:`CountUp`(评分数字滚动)、`GradientText`(高分渐变字)、`ClickSpark`(点「加入练习」迸火花)、`BlurText`(AI 分析逐词浮现);这四个不在 W1 的页面里用(spec D11 把它们画在 W2 的评分与分析画面上),W1 只用 `CountUp` 显示已用空间。

- [ ] **Step 1: 写失败测试**

`web/src/features/library/fx/elastic-slider.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ElasticSlider, snapIndex } from "./elastic-slider";

const STEPS = [0.5, 0.75, 1, 1.25] as const;
type Step = (typeof STEPS)[number];
const rect = (width: number) => ({ left: 0, top: 0, width, height: 36, right: width, bottom: 36, x: 0, y: 0, toJSON() {} }) as DOMRect;
/** jsdom 26 没有 PointerEvent 构造函数:用 MouseEvent 派发同名事件才带得上 clientX(React 按事件类型分发)。 */
const pointer = (el: Element, type: string, x = 0) => fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }));

describe("snapIndex", () => {
  it("snaps a pointer position to the nearest of N steps and clamps outside the track", () => {
    expect(snapIndex(0, 0, 300, 4)).toBe(0);
    expect(snapIndex(60, 0, 300, 4)).toBe(1); // 60 / 300 × 3 = 0.6 → 最近的档是 1
    expect(snapIndex(149, 0, 300, 4)).toBe(1);
    expect(snapIndex(150, 0, 300, 4)).toBe(2);
    expect(snapIndex(300, 0, 300, 4)).toBe(3);
    expect(snapIndex(-50, 0, 300, 4)).toBe(0);
    expect(snapIndex(900, 0, 300, 4)).toBe(3);
    expect(snapIndex(10, 0, 0, 4)).toBe(0);
    expect(snapIndex(10, 0, 300, 1)).toBe(0);
  });
});

describe("ElasticSlider (spec §11.4a, R-L31)", () => {
  function setup(value: Step = 1) {
    const onChange = vi.fn();
    const view = render(<ElasticSlider steps={STEPS} value={value} onChange={onChange} label="Speed" format={(v) => `${v}x`} />);
    const track = screen.getByRole("slider", { name: "Speed" });
    track.getBoundingClientRect = () => rect(300);
    return { onChange, track, ...view };
  }

  it("is an accessible slider showing the current step", () => {
    const { track } = setup(0.75);
    expect(track).toHaveAttribute("aria-valuemin", "0.5");
    expect(track).toHaveAttribute("aria-valuemax", "1.25");
    expect(track).toHaveAttribute("aria-valuenow", "0.75");
    expect(track).toHaveAttribute("aria-valuetext", "0.75x");
    expect(screen.getAllByText(/x$/).map((s) => s.textContent)).toEqual(["0.5x", "0.75x", "1x", "1.25x"]);
  });

  it("moves between steps with the arrow keys", () => {
    const { track, onChange } = setup(1);
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(1.25);
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(0.75);
  });

  it("stops at the ends and ignores other keys", () => {
    const { track, onChange } = setup(1.25);
    fireEvent.keyDown(track, { key: "ArrowRight" });
    fireEvent.keyDown(track, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("snaps to the pressed position, follows a drag and marks the dragging state", () => {
    const { track, onChange, container } = setup(1);
    pointer(track, "pointerdown", 300);
    expect(onChange).toHaveBeenLastCalledWith(1.25);
    expect(container.firstElementChild).toHaveAttribute("data-drag", "true");
    pointer(track, "pointermove", 10);
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    pointer(track, "pointerup");
    expect(container.firstElementChild).not.toHaveAttribute("data-drag");
    onChange.mockClear();
    pointer(track, "pointermove", 150);
    expect(onChange).not.toHaveBeenCalled(); // 松手后移动不再改值
  });

  it("only moves transforms: the fill scales and the knob translates", () => {
    const { track } = setup(1);
    expect(track.style.getPropertyValue("--p")).toBe("0.6666666666666666");
    const knob = track.querySelector(".lib-slider-knob") as HTMLElement;
    expect(knob.style.transform).toMatch(/^translateX\(.*px\) scale\(1\)$/);
    expect(track.querySelector(".lib-slider-fill")).not.toBeNull();
  });
});
```

`web/src/features/library/fx/count-up.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountUp, GradientText, countUpValue, useCountUp } from "./count-up";
import type { FrameSource } from "./motion";

function fakeFrames() {
  const pending = new Map<number, (t: number) => void>();
  let next = 1;
  let t = 0;
  const frames: FrameSource = {
    request: (cb) => { const id = next++; pending.set(id, cb); return id; },
    cancel: (id) => { pending.delete(id); },
    now: () => t,
  };
  return {
    frames,
    pendingCount: () => pending.size,
    advance(ms: number) {
      t += ms;
      const run = [...pending.values()];
      pending.clear();
      act(() => run.forEach((cb) => cb(t)));
    },
  };
}

describe("countUpValue", () => {
  it("eases out from 0 to the target", () => {
    expect(countUpValue(0, 86)).toBe(0);
    expect(countUpValue(1, 86)).toBe(86);
    expect(countUpValue(0.5, 100)).toBeGreaterThan(50); // 先快后慢
    expect(countUpValue(0.5, 100)).toBeLessThan(100);
  });
});

describe("CountUp (spec §11.4a)", () => {
  it("starts at zero, rolls up to the target and keeps the final value for assistive tech", () => {
    const f = fakeFrames();
    const { container } = render(<CountUp to={86} frames={f.frames} enabled />);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("0");
    expect(container.querySelector(".sr-only")).toHaveTextContent("86");
    f.advance(16); // 第一帧只记起点
    f.advance(550);
    const mid = Number(container.querySelector("[aria-hidden]")?.textContent);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(86);
    f.advance(1200);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("86");
    expect(f.pendingCount()).toBe(0);
  });

  it("formats the animated value and the final value with the same function", () => {
    const f = fakeFrames();
    const { container } = render(<CountUp to={1536} format={(n) => `${Math.round(n)} MB`} frames={f.frames} enabled />);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("0 MB");
    expect(container.querySelector(".sr-only")).toHaveTextContent("1536 MB");
  });

  it("shows the final value at once when motion is off (reduced motion or low-end device)", () => {
    const { container } = render(<CountUp to={86} enabled={false} />);
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("86");
  });

  it("stops asking for frames when unmounted", () => {
    const f = fakeFrames();
    const { unmount } = render(<CountUp to={86} frames={f.frames} enabled />);
    expect(f.pendingCount()).toBe(1);
    unmount();
    expect(f.pendingCount()).toBe(0);
  });

  it("rolls on from the previous value when the target changes", () => {
    const f = fakeFrames();
    function Probe({ to }: { to: number }) {
      return <p data-testid="v">{useCountUp(to, { frames: f.frames, enabled: true, durationMs: 100 })}</p>;
    }
    const { rerender } = render(<Probe to={10} />);
    f.advance(16);
    f.advance(200);
    expect(screen.getByTestId("v")).toHaveTextContent("10");
    rerender(<Probe to={20} />);
    expect(Number(screen.getByTestId("v").textContent)).toBe(10); // 不是回到 0
    f.advance(16);
    f.advance(200);
    expect(screen.getByTestId("v")).toHaveTextContent("20");
  });
});

describe("GradientText", () => {
  it("renders its children with the gradient class", () => {
    render(<GradientText className="x">Great</GradientText>);
    expect(screen.getByText("Great").className).toMatch(/\blib-gt\b/);
  });
});
```

`web/src/features/library/fx/click-spark.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickSpark, SPARK_COUNT, SPARK_MS, sparkBurst } from "./click-spark";

describe("sparkBurst", () => {
  it("makes SPARK_COUNT sparks spread around the origin with distinct directions", () => {
    const burst = sparkBurst({ x: 10, y: 20 });
    expect(burst).toHaveLength(SPARK_COUNT);
    expect(new Set(burst.map((s) => `${s.dx.toFixed(1)},${s.dy.toFixed(1)}`)).size).toBe(SPARK_COUNT);
    expect(burst.every((s) => s.x === 10 && s.y === 20)).toBe(true);
    expect(sparkBurst({ x: 0, y: 0 }, 3)).toHaveLength(3);
  });
});

describe("ClickSpark (spec §11.4a)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("bursts at the click, passes the click through and cleans up after SPARK_MS", () => {
    const onClick = vi.fn();
    const { container } = render(<ClickSpark><button onClick={onClick}>star</button></ClickSpark>);
    fireEvent.click(screen.getByRole("button", { name: "star" }), { clientX: 5, clientY: 6 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(SPARK_COUNT);
    act(() => { vi.advanceTimersByTime(SPARK_MS); });
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(0);
  });

  it("does nothing when disabled or when motion is reduced", () => {
    const { container, rerender } = render(<ClickSpark disabled><button>star</button></ClickSpark>);
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(0);
    rerender(<ClickSpark><button>star</button></ClickSpark>);
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    expect(container.querySelectorAll(".lib-spark")).toHaveLength(0);
  });

  it("clears its pending timers on unmount", () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<ClickSpark><button>star</button></ClickSpark>);
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    clear.mockClear();
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
```

`web/src/features/library/fx/blur-text.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLUR_TEXT_MAX_TOKENS, BlurText, splitBlurTokens } from "./blur-text";

afterEach(() => vi.restoreAllMocks());

describe("splitBlurTokens", () => {
  it("splits English into words, keeps spaces as plain tokens and splits CJK per character", () => {
    expect(splitBlurTokens("Hi there")).toEqual(["Hi", " ", "there"]);
    expect(splitBlurTokens("你好 world")).toEqual(["你", "好", " ", "world"]);
    expect(splitBlurTokens("")).toEqual([]);
  });
});

describe("BlurText (spec §11.4a)", () => {
  it("fades each word in turn and keeps the whole text for assistive tech", () => {
    const { container } = render(<BlurText text="So what now" stepMs={40} />);
    const words = [...container.querySelectorAll(".lib-bw")];
    expect(words.map((w) => w.textContent)).toEqual(["So", "what", "now"]);
    expect(words.map((w) => (w as HTMLElement).style.getPropertyValue("--d"))).toEqual(["0ms", "40ms", "80ms"]);
    expect(container.querySelector(".sr-only")).toHaveTextContent("So what now");
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("caps the delay so a long answer does not take seconds to appear", () => {
    const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    const { container } = render(<BlurText text={text} stepMs={100} />);
    const last = [...container.querySelectorAll(".lib-bw")].pop() as HTMLElement;
    expect(last.style.getPropertyValue("--d")).toBe("2400ms");
  });

  it("renders plain text when there are too many tokens", () => {
    const text = Array.from({ length: BLUR_TEXT_MAX_TOKENS + 5 }, (_, i) => `w${i}`).join(" ");
    const { container } = render(<BlurText text={text} />);
    expect(container.querySelectorAll(".lib-bw")).toHaveLength(0);
    expect(container).toHaveTextContent("w0 w1");
  });

  it("renders plain text when motion is off (reduced motion, low-end device or enabled={false})", () => {
    const { container, rerender } = render(<BlurText text="So what now" enabled={false} />);
    expect(container.querySelectorAll(".lib-bw")).toHaveLength(0);
    expect(screen.getByText("So what now")).toBeInTheDocument();
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    rerender(<BlurText text="So what now" />);
    expect(container.querySelectorAll(".lib-bw")).toHaveLength(0);
  });
});
```

`web/src/features/library/fx/gradual-blur.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GradualBlur } from "./gradual-blur";

describe("GradualBlur (spec §11.4a, R-L26)", () => {
  it("is a decorative, click-through blur layer", () => {
    const { container } = render(<GradualBlur className="extra" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toMatch(/\blib-gblur\b/);
    expect(el.className).toMatch(/\bextra\b/);
    expect(el).toHaveAttribute("aria-hidden", "true");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/fx`。

- [ ] **Step 3: 实现**

`web/src/features/library/fx/elastic-slider.tsx`:

```tsx
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";

const KNOB_PX = 22;

/** 指针位置 → 最近的档位序号(轨道外夹在两端;轨道宽度为 0 或只有一档时为 0)。 */
export function snapIndex(x: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const p = Math.min(1, Math.max(0, (x - left) / width));
  return Math.round(p * (count - 1));
}

/**
 * 弹性滑块(ElasticSlider):拖动 / 点按吸附到 `steps` 的某一档,弹性手感来自 transform 的回弹缓动(只动 transform,不触发布局;
 * 减少动态效果时 transition 关闭,见 library.css)。可键盘操作(← → ↑ ↓)。播放速度用它(R-L31)。
 */
export function ElasticSlider<T extends number>({ steps, value, onChange, label, format = String, className }: {
  steps: readonly T[];
  value: T;
  onChange(next: T): void;
  label: string;
  format?: (v: T) => string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [width, setWidth] = useState(0);
  const index = Math.max(0, steps.indexOf(value));
  const p = steps.length > 1 ? index / (steps.length - 1) : 0;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const choose = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = steps[snapIndex(clientX, rect.left, rect.width, steps.length)];
    if (next !== undefined && next !== value) onChange(next);
  };
  const step = (delta: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, index + delta))];
    if (next !== undefined && next !== value) onChange(next);
  };

  return (
    <div className={cn("lib-slider", className)} data-drag={drag || undefined}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={steps[0]}
        aria-valuemax={steps[steps.length - 1]}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="lib-slider-track"
        style={{ "--p": p } as CSSProperties}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag(true);
          choose(e.clientX);
        }}
        onPointerMove={(e) => { if (drag) choose(e.clientX); }}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
          if (!delta) return;
          e.preventDefault();
          step(delta);
        }}
      >
        <div className="lib-slider-rail"><div className="lib-slider-fill" /></div>
        <div className="lib-slider-knob" style={{ transform: `translateX(${p * Math.max(0, width - KNOB_PX)}px) scale(${drag ? 1.25 : 1})` }} />
      </div>
      <div aria-hidden className="lib-slider-ticks">
        {steps.map((s) => <span key={s}>{format(s)}</span>)}
      </div>
    </div>
  );
}
```

`web/src/features/library/fx/count-up.tsx`:

```tsx
import { type HTMLAttributes, useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { type FrameSource, browserFrames, motionAllowed } from "./motion";

/** 数字滚动的缓动:ease-out cubic,progress ∈ [0, 1]。 */
export function countUpValue(progress: number, to: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return to * (1 - Math.pow(1 - p, 3));
}

/**
 * 数字从当前值滚到 `to`(CountUp)。动效关闭(`enabled === false`,或系统减少动态效果 / 低端机)时直接给终值;
 * 目标变了从上一个值接着滚(不回到 0)。帧源可注入,测试用假的。
 */
export function useCountUp(to: number, opts: { durationMs?: number; frames?: FrameSource; enabled?: boolean } = {}): number {
  const { durationMs = 1100, frames = browserFrames } = opts;
  const animate = opts.enabled ?? motionAllowed();
  const [value, setValue] = useState(animate ? 0 : to);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!animate) {
      setValue(to);
      return;
    }
    const from = latest.current;
    let id = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const p = Math.min(1, (now - start) / durationMs);
      setValue(from + (to - from) * (countUpValue(p, 1)));
      if (p < 1) id = frames.request(step);
    };
    id = frames.request(step);
    return () => frames.cancel(id);
  }, [to, durationMs, animate, frames]);

  return value;
}

/** 数字滚动:可见的数字是动画值(aria-hidden),终值放在 sr-only 里给读屏与测试。 */
export function CountUp({ to, format = (n) => String(Math.round(n)), className, durationMs, frames, enabled }: {
  to: number;
  format?: (n: number) => string;
  className?: string;
  durationMs?: number;
  frames?: FrameSource;
  enabled?: boolean;
}) {
  const value = useCountUp(to, { durationMs, frames, enabled });
  return (
    <span className={className}>
      <span aria-hidden>{format(value)}</span>
      <span className="sr-only">{format(to)}</span>
    </span>
  );
}

/** 高分渐变字(GradientText):不支持 background-clip: text 时是纯色(library.css 的 @supports 守卫)。 */
export function GradientText({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("lib-gt", className)} {...rest} />;
}
```

`web/src/features/library/fx/click-spark.tsx`:

```tsx
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { motionAllowed } from "./motion";

export const SPARK_COUNT = 8;
export const SPARK_MS = 600;
const COLORS = ["#f2b056", "#2cc7b0", "#4b78f0", "#ff7a84"];

export interface Spark { id: number; x: number; y: number; dx: number; dy: number; color: string }

let nextId = 1;

/** 一次迸发:count 颗火花从 origin 向四周散开(半径 26–40 px,方向均分,确定性,不用随机数)。 */
export function sparkBurst(origin: { x: number; y: number }, count = SPARK_COUNT): Spark[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const radius = 26 + (i % 3) * 7;
    return { id: nextId++, x: origin.x, y: origin.y, dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius, color: COLORS[i % COLORS.length] };
  });
}

/**
 * 点击处迸出小火花(ClickSpark):包住一个按钮,点击(捕获阶段,不拦截)时在点击位置生成火花,SPARK_MS 后清掉。
 * 动效关闭(减少动态效果 / 低端机 / disabled)时什么都不做;卸载时清掉定时器。
 */
export function ClickSpark({ children, className, disabled = false }: { children: ReactNode; className?: string; disabled?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [sparks, setSparks] = useState<Spark[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const burst = (e: MouseEvent<HTMLSpanElement>) => {
    if (disabled || !motionAllowed()) return;
    const rect = hostRef.current?.getBoundingClientRect();
    const fresh = sparkBurst({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
    setSparks((list) => [...list, ...fresh]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setSparks((list) => list.filter((s) => !fresh.includes(s)));
    }, SPARK_MS);
    timers.current.add(timer);
  };

  return (
    <span ref={hostRef} className={cn("lib-spark-host", className)} onClickCapture={burst}>
      {children}
      {sparks.map((s) => (
        <i key={s.id} aria-hidden className="lib-spark"
          style={{ left: s.x - 3, top: s.y - 3, background: s.color, "--dx": `${s.dx}px`, "--dy": `${s.dy}px` } as CSSProperties} />
      ))}
    </span>
  );
}
```

`web/src/features/library/fx/blur-text.tsx`:

```tsx
import type { CSSProperties } from "react";
import { motionAllowed } from "./motion";

/** 超过这么多个词 / 字就不逐个动画(一整段只淡入),避免几百个 inline-block 同时动画。 */
export const BLUR_TEXT_MAX_TOKENS = 120;
const MAX_DELAY_MS = 2400;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

/** 英文按词、中日韩按字;空白单独成段(不动画)。 */
export function splitBlurTokens(text: string): string[] {
  const out: string[] = [];
  for (const part of text.match(/\s+|\S+/g) ?? []) {
    if (/^\s+$/.test(part)) out.push(part);
    else if (CJK.test(part)) out.push(...Array.from(part));
    else out.push(part);
  }
  return out;
}

/**
 * AI 分析逐词浮现(BlurText):每个词从模糊到清晰依次出现,只在生成完成的那一次播放(spec §11.4a)。
 * 动效关闭(减少动态效果 / 低端机 / enabled === false)或词太多时直接显示整段文字;完整文字始终在 sr-only 里。
 */
export function BlurText({ text, stepMs = 40, className, enabled }: { text: string; stepMs?: number; className?: string; enabled?: boolean }) {
  const tokens = splitBlurTokens(text);
  const words = tokens.filter((t) => t.trim() !== "").length;
  if (!(enabled ?? motionAllowed()) || words > BLUR_TEXT_MAX_TOKENS) return <span className={className}>{text}</span>;
  let k = 0;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="whitespace-pre-wrap">
        {tokens.map((token, i) =>
          token.trim() === "" ? (
            token
          ) : (
            <span key={i} className="lib-bw" style={{ "--d": `${Math.min(k++ * stepMs, MAX_DELAY_MS)}ms` } as CSSProperties}>{token}</span>
          ),
        )}
      </span>
    </span>
  );
}
```

`web/src/features/library/fx/gradual-blur.tsx`:

```tsx
import { cn } from "@renderer/lib/utils";

/** 列表底部渐进模糊(GradualBlur):一层带遮罩的 backdrop-filter,文字滑入控制胶囊时自然淡出;点击穿透,算一层模糊(R-L26)。 */
export function GradualBlur({ className }: { className?: string }) {
  return <div aria-hidden className={cn("lib-gblur", className)} />;
}
```

`web/src/features/library/fx/index.ts`(桶:给 W2 用;只在懒块里被导入):

```ts
export { BlurText, splitBlurTokens } from "./blur-text";
export { borderGlowClass } from "./border-glow";
export { ClickSpark, sparkBurst } from "./click-spark";
export { CountUp, GradientText, countUpValue, useCountUp } from "./count-up";
export { ElasticSlider, snapIndex } from "./elastic-slider";
export { GlassSurface } from "./glass-surface";
export { GradualBlur } from "./gradual-blur";
export { motionAllowed, browserFrames, type FrameSource } from "./motion";
export { ShinyText } from "./shiny-text";
export { SoftAurora } from "./soft-aurora";
export { SPECULAR_CLASS, SpecularButton } from "./specular-button";
export { SpotlightCard } from "./spotlight-card";
export { Stepper, stepIndex, type StepperStep } from "./stepper";
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/fx src/features/library/library-css.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck`。
  - jsdom 26 没有 `PointerEvent` 构造函数(`fireEvent.pointerDown(el, { clientX })` 传不进坐标,测试里 `clientX` 会是 `undefined`),所以指针用例用 `MouseEvent` 派发同名事件;`setPointerCapture` 也没有,组件里是可选调用。指针手感写进「未验证」。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library/fx
git commit -m "feat(web): library effects (elastic slider, count up, click spark, blur text, gradual blur)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L4: 分片上传客户端(R-L7、R-L8)

**Files:**
- Create: `web/src/features/library/upload-client.ts`、`upload-client.test.ts`

**Interfaces:**
- Consumes:L1 的 `startUpload`、`uploadStatus`、`putChunk`、`putUploadSubtitles`、`completeUpload`、`CHUNK_BYTES`
- Produces:`CHUNK_RETRIES`、`RETRY_DELAYS_MS`、`MAX_RESYNCS`、`UploadInput`、`UploadOptions`、`UploadMismatchError`、`isRetryable(err, signal?)`、`sleepFor(ms, signal?)`、`uploadFile(api, input, opts?) → Promise<LibraryItem>`

- [ ] **Step 1: 写失败测试** — `web/src/features/library/upload-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json, type Handler, type RecordedCall } from "~/test/fetch-mock";
import { itemRaw } from "./test-fixtures";
import { UploadMismatchError, isRetryable, sleepFor, uploadFile } from "./upload-client";

const FILE = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]);
const BASE = "/api/library/uploads/u1";

function setup(extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "POST /api/library/uploads": () => json({ item_id: "u1", chunk_bytes: 4 }),
    [`PUT ${BASE}/chunks/0`]: () => json({ upload_received: 4, upload_total: 10 }),
    [`PUT ${BASE}/chunks/1`]: () => json({ upload_received: 8, upload_total: 10 }),
    [`PUT ${BASE}/chunks/2`]: () => json({ upload_received: 10, upload_total: 10 }),
    [`PUT ${BASE}/subtitles`]: () => json({}),
    [`POST ${BASE}/complete`]: () => json(itemRaw({ id: "u1", status: "queued" })),
    ...extra,
  });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}
const route = (c: RecordedCall) => `${c.method} ${c.url.pathname}`;
const chunkSize = (c: RecordedCall) => ((c.body as FormData).get("chunk") as File).size;
const calls = (mock: { calls: RecordedCall[] }, suffix: string) => mock.calls.filter((c) => c.url.pathname.endsWith(suffix));

describe("uploadFile (spec §8, R-L7, R-L8)", () => {
  it("starts, sends subtitles first, then every chunk in order and completes", async () => {
    const { mock, api } = setup();
    const progress: number[] = [];
    const onItem = vi.fn();
    const item = await uploadFile(api, {
      file: FILE, filename: "talk.mp4", title: " Talk ", subtitles: { file: new Blob(["WEBVTT\n"]), filename: "talk.en.vtt" },
    }, { onItem, onProgress: (sent) => progress.push(sent), sleep: vi.fn(async () => {}) });
    expect(item).toMatchObject({ id: "u1", status: "queued" });
    expect(mock.calls.map(route)).toEqual([
      "POST /api/library/uploads", `PUT ${BASE}/subtitles`, `PUT ${BASE}/chunks/0`, `PUT ${BASE}/chunks/1`, `PUT ${BASE}/chunks/2`,
      `POST ${BASE}/complete`,
    ]);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ filename: "talk.mp4", size: 10, title: "Talk" });
    expect(mock.calls.slice(2, 5).map(chunkSize)).toEqual([4, 4, 2]);
    expect(progress).toEqual([0, 4, 8, 10]);
    expect(onItem).toHaveBeenCalledWith("u1");
  });

  it("retries the same chunk after 5xx with 1 s / 2 s back-off", async () => {
    let n = 0;
    const sleep = vi.fn(async (_ms: number) => {});
    const { mock, api } = setup({
      [`PUT ${BASE}/chunks/1`]: () => (++n < 3 ? json({ error: "Service Unavailable" }, 503) : json({ upload_received: 8, upload_total: 10 })),
    });
    await uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep });
    expect(calls(mock, "/chunks/1")).toHaveLength(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after three retries and never completes", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const { mock, api } = setup({ [`PUT ${BASE}/chunks/0`]: () => json({ error: "boom" }, 500) });
    await expect(uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep })).rejects.toMatchObject({ status: 500 });
    expect(calls(mock, "/chunks/0")).toHaveLength(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    expect(calls(mock, "/complete")).toHaveLength(0);
  });

  it("does not retry other client errors", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const { mock, api } = setup({ [`PUT ${BASE}/chunks/0`]: () => json({ error: "Chunk too large" }, 413) });
    await expect(uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep })).rejects.toMatchObject({ status: 413 });
    expect(calls(mock, "/chunks/0")).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("resumes from the server's received count without starting again or resending subtitles", async () => {
    const { mock, api } = setup({ [`GET ${BASE}`]: () => json({ upload_received: 4, upload_total: 10 }) });
    const progress: number[] = [];
    await uploadFile(api, { file: FILE, filename: "a.mp3", subtitles: { file: new Blob(["x"]), filename: "a.srt" } },
      { resumeItemId: "u1", chunkBytes: 4, onProgress: (s) => progress.push(s), sleep: vi.fn(async () => {}) });
    expect(mock.calls.map(route)).toEqual([`GET ${BASE}`, `PUT ${BASE}/chunks/1`, `PUT ${BASE}/chunks/2`, `POST ${BASE}/complete`]);
    expect(progress).toEqual([4, 8, 10]);
  });

  it("refuses to resume with a file of another size", async () => {
    const { mock, api } = setup({ [`GET ${BASE}`]: () => json({ upload_received: 4, upload_total: 11 }) });
    await expect(uploadFile(api, { file: FILE, filename: "a.mp3" }, { resumeItemId: "u1", chunkBytes: 4 }))
      .rejects.toBeInstanceOf(UploadMismatchError);
    expect(mock.calls.map(route)).toEqual([`GET ${BASE}`]);
  });

  it("re-aligns with the server after a 409 out-of-order answer", async () => {
    const { mock, api } = setup({
      [`PUT ${BASE}/chunks/1`]: () => json({ error: "Chunk out of order" }, 409),
      [`GET ${BASE}`]: () => json({ upload_received: 8, upload_total: 10 }),
    });
    await uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep: vi.fn(async () => {}) });
    expect(mock.calls.map(route)).toEqual([
      "POST /api/library/uploads", `PUT ${BASE}/chunks/0`, `PUT ${BASE}/chunks/1`, `GET ${BASE}`, `PUT ${BASE}/chunks/2`,
      `POST ${BASE}/complete`,
    ]);
  });

  it("classifies retryable errors and never retries a user abort", () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(isRetryable(new ApiError(0, "Network error"))).toBe(true);
    expect(isRetryable(new ApiError(0, "Request timed out"))).toBe(true);
    expect(isRetryable(new ApiError(429, "Too many requests, please try again later"))).toBe(true);
    expect(isRetryable(new ApiError(502, "HTTP 502"))).toBe(true);
    expect(isRetryable(new ApiError(404, "Not Found"))).toBe(false);
    expect(isRetryable(new ApiError(0, "Request aborted"), aborted.signal)).toBe(false);
    expect(isRetryable(new Error("x"))).toBe(false);
  });

  it("sleepFor rejects as soon as the upload is aborted", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const waiting = sleepFor(4000, ctl.signal);
    ctl.abort();
    await expect(waiting).rejects.toMatchObject({ status: 0, message: "Request aborted" });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/upload-client.test.ts`。

- [ ] **Step 3: 实现** — `web/src/features/library/upload-client.ts`:

```ts
import { ApiError, type ApiClient } from "~/api/client";
import {
  CHUNK_BYTES, completeUpload, putChunk, putUploadSubtitles, startUpload, uploadStatus, type LibraryItem,
} from "./library-api";

/** 每片失败后自动重试 3 次(spec §11.3),间隔 1 s / 2 s / 4 s(R-L8)。 */
export const CHUNK_RETRIES = 3;
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
/** 409(次序不对)后按服务端进度重新对齐的最多次数。 */
export const MAX_RESYNCS = 3;

export interface UploadInput {
  file: Blob;
  /** 原文件名:只进 POST /uploads 的 JSON 体(取扩展名与默认标题),不进 URL、不进 multipart。 */
  filename: string;
  title?: string;
  subtitles?: { file: Blob; filename: string } | null;
}

export interface UploadOptions {
  /** 续传:已有的条目 id(R-L7、R-L10)。 */
  resumeItemId?: string;
  /** 续传时的分片大小(新上传以服务端返回的为准)。 */
  chunkBytes?: number;
  signal?: AbortSignal;
  onItem?: (itemId: string) => void;
  onProgress?: (sent: number, total: number) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class UploadMismatchError extends Error {
  constructor() {
    super("Upload size mismatch");
    this.name = "UploadMismatchError";
  }
}

/** 网络 / 超时(不是用户中止)、429、5xx 可重试;其他 4xx 立即失败(R-L8)。 */
export function isRetryable(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || !(err instanceof ApiError)) return false;
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

const aborted = () => new ApiError(0, "Request aborted");

export function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withRetries<T>(fn: () => Promise<T>, signal: AbortSignal | undefined, sleep: NonNullable<UploadOptions["sleep"]>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= CHUNK_RETRIES || !isRetryable(err, signal)) throw err;
      await sleep(RETRY_DELAYS_MS[attempt], signal);
    }
  }
}

/**
 * 分片上传一个文件(spec §8):开始 → (字幕)→ 逐片串行 → 完成。续传时先问服务端已收多少。
 * 中止由 signal 传到每个请求;失败时条目留在服务端的 uploading 状态,可续传(R-L9)。
 */
export async function uploadFile(api: ApiClient, input: UploadInput, opts: UploadOptions = {}): Promise<LibraryItem> {
  const { signal } = opts;
  const sleep = opts.sleep ?? sleepFor;
  const total = input.file.size;
  let itemId: string;
  let chunkBytes = opts.chunkBytes ?? CHUNK_BYTES;
  let received = 0;
  if (opts.resumeItemId) {
    const id = opts.resumeItemId;
    itemId = id;
    const status = await withRetries(() => uploadStatus(api, id, signal), signal, sleep);
    if (status.uploadTotal !== total) throw new UploadMismatchError();
    received = status.uploadReceived;
    opts.onItem?.(itemId);
  } else {
    const started = await startUpload(api, { filename: input.filename, size: total, title: input.title?.trim() || undefined }, signal);
    const id = started.itemId;
    itemId = id;
    if (started.chunkBytes > 0) chunkBytes = started.chunkBytes;
    opts.onItem?.(itemId);
    const subs = input.subtitles;
    if (subs) await withRetries(() => putUploadSubtitles(api, id, subs.file, subs.filename, signal), signal, sleep);
  }
  opts.onProgress?.(received, total);
  let n = Math.floor(received / chunkBytes);
  let resyncs = 0;
  while (n * chunkBytes < total) {
    const start = n * chunkBytes;
    const chunk = input.file.slice(start, Math.min(total, start + chunkBytes));
    const index = n;
    try {
      await withRetries(() => putChunk(api, itemId, index, chunk, signal), signal, sleep);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409) || resyncs >= MAX_RESYNCS) throw err;
      resyncs += 1;
      const status = await withRetries(() => uploadStatus(api, itemId, signal), signal, sleep);
      n = Math.floor(status.uploadReceived / chunkBytes);
      opts.onProgress?.(Math.min(total, status.uploadReceived), total);
      continue;
    }
    n += 1;
    opts.onProgress?.(Math.min(total, start + chunk.size), total);
  }
  return withRetries(() => completeUpload(api, itemId, signal), signal, sleep);
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/upload-client.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): chunked, resumable library uploads with retries

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L5: 上传任务表(R-L9、R-L10)

**Files:**
- Create: `web/src/features/library/upload-store.ts`、`upload-store.test.ts`

**Interfaces:**
- Consumes:L4 `uploadFile`、`UploadInput`;L1 `deleteItem`、`stemOf`
- Produces:`UploadJob`、`StartOptions`、`createUploadStore(deps?)`、`UploadStore`(`snapshot`、`subscribe`、`start`、`retry`、`cancel`、`dismiss`、`rememberedName`)、`uploads`(单例)、`useUploads(store?)`

- [ ] **Step 1: 写失败测试** — `web/src/features/library/upload-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import type { LibraryItem } from "./library-api";
import type { UploadInput, UploadOptions } from "./upload-client";
import { createUploadStore } from "./upload-store";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function fakeStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const api = new ApiClient({ getToken: () => "t" });
const INPUT: UploadInput = { file: new Blob([new Uint8Array(10)]), filename: "Talk.mp4" };
const ITEM = { id: "u1", status: "queued" } as LibraryItem;

function setup() {
  const runs: { input: UploadInput; opts: UploadOptions; d: ReturnType<typeof deferred<LibraryItem>> }[] = [];
  const upload = vi.fn((_api: ApiClient, input: UploadInput, opts: UploadOptions = {}) => {
    const d = deferred<LibraryItem>();
    runs.push({ input, opts, d });
    return d.promise;
  });
  const remove = vi.fn(async () => {});
  const storage = fakeStorage();
  const win = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const store = createUploadStore({ upload, remove, storage: () => storage, win: () => win });
  return { store, runs, upload, remove, storage, win };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("upload store (R-L9, R-L10)", () => {
  it("tracks a job from start to done, remembers the file name meanwhile and guards page unload", async () => {
    const { store, runs, storage, win } = setup();
    const onDone = vi.fn();
    const key = store.start(api, { ...INPUT, title: "" }, { onDone });
    expect(store.snapshot()).toMatchObject([{ key, itemId: null, title: "Talk", size: 10, sent: 0, state: "uploading" }]);
    expect(win.addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    runs[0].opts.onItem?.("u1");
    runs[0].opts.onProgress?.(4, 10);
    expect(store.snapshot()[0]).toMatchObject({ itemId: "u1", sent: 4 });
    expect(storage.m.get("enjoy-web.library.upload.u1")).toBe("Talk.mp4");
    expect(store.rememberedName("u1")).toBe("Talk.mp4");
    runs[0].d.resolve(ITEM);
    await flush();
    expect(store.snapshot()).toEqual([]);
    expect(onDone).toHaveBeenCalledWith(ITEM);
    expect(storage.m.size).toBe(0);
    expect(win.removeEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("keeps a failed job with its error and stops guarding unload", async () => {
    const { store, runs, win } = setup();
    const onError = vi.fn();
    store.start(api, INPUT, { onError });
    runs[0].opts.onItem?.("u1");
    const err = new ApiError(500, "boom");
    runs[0].d.reject(err);
    await flush();
    expect(store.snapshot()[0]).toMatchObject({ itemId: "u1", state: "failed", error: err });
    expect(onError).toHaveBeenCalledWith(err);
    expect(win.removeEventListener).toHaveBeenCalled();
  });

  it("retries a failed job as a resume of the same item with the same file", async () => {
    const { store, runs } = setup();
    const key = store.start(api, INPUT, { chunkBytes: 4 });
    runs[0].opts.onItem?.("u1");
    runs[0].d.reject(new ApiError(0, "Network error"));
    await flush();
    const next = store.retry(api, key);
    expect(next).not.toBeNull();
    expect(runs[1].input).toBe(runs[0].input);
    expect(runs[1].opts).toMatchObject({ resumeItemId: "u1", chunkBytes: 4 });
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0].state).toBe("uploading");
  });

  it("cancel aborts the upload, deletes the item and ignores the late rejection", async () => {
    const { store, runs, remove, storage } = setup();
    const onError = vi.fn();
    const key = store.start(api, INPUT, { onError });
    runs[0].opts.onItem?.("u1");
    await store.cancel(api, key);
    expect(runs[0].opts.signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith(api, "u1");
    expect(store.snapshot()).toEqual([]);
    expect(storage.m.size).toBe(0);
    runs[0].d.reject(new ApiError(0, "Request aborted"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual([]);
  });

  it("dismiss only drops the local card", async () => {
    const { store, runs, remove } = setup();
    const key = store.start(api, INPUT);
    runs[0].d.reject(new ApiError(500, "boom"));
    await flush();
    store.dismiss(key);
    expect(store.snapshot()).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("survives a storage that throws", () => {
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    const store = createUploadStore({ upload: vi.fn(() => new Promise<LibraryItem>(() => {})), storage: () => throwing, win: () => null });
    store.start(api, INPUT);
    expect(store.rememberedName("u1")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/upload-store.test.ts`。

- [ ] **Step 3: 实现** — `web/src/features/library/upload-store.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { ApiClient } from "~/api/client";
import { deleteItem, stemOf, type LibraryItem } from "./library-api";
import { uploadFile, type UploadInput } from "./upload-client";

/** 一个本地上传任务(只在本标签页内存里;刷新后只剩服务端的 uploading 条目,R-L10)。 */
export interface UploadJob {
  key: string;
  itemId: string | null;
  filename: string;
  title: string;
  size: number;
  sent: number;
  state: "uploading" | "failed";
  error: unknown;
  input: UploadInput;
  chunkBytes?: number;
}

export interface StartOptions {
  resumeItemId?: string;
  chunkBytes?: number;
  onDone?: (item: LibraryItem) => void;
  onError?: (err: unknown) => void;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Win = Pick<Window, "addEventListener" | "removeEventListener">;
interface Deps {
  upload: typeof uploadFile;
  remove: typeof deleteItem;
  storage: () => KV | null;
  win: () => Win | null;
}

const nameKey = (itemId: string) => `enjoy-web.library.upload.${itemId}`;
const sessionKV = (): KV | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};
const browserWin = (): Win | null => (typeof window === "undefined" ? null : window);

/**
 * 模块级上传任务表(R-L9):应用内切页时上传继续;有进行中的任务时挂 beforeunload 提示。
 * 取消 = 中止 + 删除条目;失败保留本地卡(可「重试」= 用同一个文件续传,或「关闭」)。
 */
export function createUploadStore(over: Partial<Deps> = {}) {
  const deps: Deps = { upload: uploadFile, remove: deleteItem, storage: sessionKV, win: browserWin, ...over };
  let jobs: readonly UploadJob[] = [];
  let seq = 0;
  let guarded = false;
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const onBeforeUnload = (e: Event) => {
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = "";
  };

  const emit = () => {
    const active = jobs.some((j) => j.state === "uploading");
    const win = deps.win();
    if (win && active !== guarded) {
      if (active) win.addEventListener("beforeunload", onBeforeUnload);
      else win.removeEventListener("beforeunload", onBeforeUnload);
      guarded = active;
    }
    for (const l of [...listeners]) l();
  };
  const update = (key: string, patch: Partial<UploadJob>) => {
    jobs = jobs.map((j) => (j.key === key ? { ...j, ...patch } : j));
    emit();
  };
  const drop = (key: string) => {
    controllers.delete(key);
    jobs = jobs.filter((j) => j.key !== key);
    emit();
  };
  const remember = (itemId: string, name: string) => {
    try { deps.storage()?.setItem(nameKey(itemId), name); } catch { /* 本机存储不可用:只是少了文件名核对 */ }
  };
  const forget = (itemId: string) => {
    try { deps.storage()?.removeItem(nameKey(itemId)); } catch { /* 同上 */ }
  };

  function start(api: ApiClient, input: UploadInput, opts: StartOptions = {}): string {
    seq += 1;
    const key = `upload-${seq}`;
    const ctl = new AbortController();
    controllers.set(key, ctl);
    const job: UploadJob = {
      key, itemId: opts.resumeItemId ?? null, filename: input.filename, title: input.title?.trim() || stemOf(input.filename),
      size: input.file.size, sent: 0, state: "uploading", error: null, input, chunkBytes: opts.chunkBytes,
    };
    jobs = [job, ...jobs];
    emit();
    deps.upload(api, input, {
      resumeItemId: opts.resumeItemId,
      chunkBytes: opts.chunkBytes,
      signal: ctl.signal,
      onItem: (itemId) => {
        remember(itemId, input.filename);
        update(key, { itemId });
      },
      onProgress: (sent) => update(key, { sent }),
    }).then(
      (item) => {
        forget(item.id);
        drop(key);
        opts.onDone?.(item);
      },
      (err: unknown) => {
        if (ctl.signal.aborted) return;
        controllers.delete(key);
        update(key, { state: "failed", error: err });
        opts.onError?.(err);
      },
    );
    return key;
  }

  return {
    snapshot: (): readonly UploadJob[] => jobs,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    rememberedName(itemId: string): string | null {
      try {
        return deps.storage()?.getItem(nameKey(itemId)) ?? null;
      } catch {
        return null;
      }
    },
    start,
    /** 失败的任务用同一个文件续传(没有条目 id 时从头开始)。 */
    retry(api: ApiClient, key: string, opts: StartOptions = {}): string | null {
      const job = jobs.find((j) => j.key === key);
      if (!job || job.state !== "failed") return null;
      drop(key);
      return start(api, job.input, { ...opts, resumeItemId: job.itemId ?? undefined, chunkBytes: job.chunkBytes });
    },
    async cancel(api: ApiClient, key: string): Promise<void> {
      const job = jobs.find((j) => j.key === key);
      controllers.get(key)?.abort();
      drop(key);
      if (!job?.itemId) return;
      forget(job.itemId);
      try {
        await deps.remove(api, job.itemId);
      } catch {
        /* 删除失败:列表里仍有那条「上传未完成」,用户可以再删 */
      }
    },
    dismiss(key: string): void {
      drop(key);
    },
  };
}

export type UploadStore = ReturnType<typeof createUploadStore>;

/** 应用内唯一的上传任务表。 */
export const uploads: UploadStore = createUploadStore();

export function useUploads(store: UploadStore = uploads): readonly UploadJob[] {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/upload-store.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library upload job store with unload guard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L6: 列表数据、轮询与格式化(R-L11、R-L18)

**Files:**
- Create: `web/src/features/library/format.ts`、`format.test.ts`、`use-library-items.ts`、`use-library-items.test.tsx`

**Interfaces:**
- Produces:`formatBytes(n)`、`formatDuration(ms)`;`POLL_MS`、`isActive(item)`、`mergeFirstPage(prev, fresh)`、`usePolling(active, fn, ms?, doc?)`、`useLibraryItems(enabled) → { items, nextCursor, loading, loadingMore, error, reload, refresh, loadMore, replace, remove }`

- [ ] **Step 1: 写失败测试**

`web/src/features/library/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./format";

describe("library formatting (R-L18)", () => {
  it("formats sizes in MiB with one decimal below 100 and GB from 1024 MiB", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(2000 * 1024 * 1024)).toBe("2.0 GB");
    expect(formatBytes(0)).toBe("0.0 MB");
  });

  it("formats durations as m:ss or h:mm:ss", () => {
    expect(formatDuration(125_000)).toBe("2:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(999)).toBe("0:00");
    expect(formatDuration(null)).toBe("--:--");
  });
});
```

`web/src/features/library/use-library-items.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import type { LibraryItem } from "./library-api";
import { itemRaw } from "./test-fixtures";
import { mergeFirstPage, useLibraryItems } from "./use-library-items";

const item = (id: string, status = "ready") => ({ id, status } as LibraryItem);
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(status: { value: string }) {
  const mock = createFetchMock({
    "GET /api/library/items": () => json({ items: [itemRaw({ status: status.value, progress: 40 })], next_cursor: null }),
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  return { mock, ...renderHook(() => useLibraryItems(true), { wrapper }) };
}

describe("mergeFirstPage (R-L11)", () => {
  it("updates known items, puts new ones first and keeps later pages", () => {
    const prev = [item("b", "processing"), item("c"), item("old")];
    const fresh = [item("a", "queued"), item("b", "ready"), item("c")];
    expect(mergeFirstPage(prev, fresh).map((i) => `${i.id}:${i.status}`)).toEqual(["a:queued", "b:ready", "c:ready", "old:ready"]);
  });
});

describe("useLibraryItems polling (R-L11)", () => {
  it("polls every 3 s only while something is queued or processing", async () => {
    const status = { value: "processing" };
    const { mock, result } = setup(status);
    await tick(0);
    expect(result.current.items[0].status).toBe("processing");
    expect(mock.calls).toHaveLength(1);
    await tick(3000);
    expect(mock.calls).toHaveLength(2);
    status.value = "ready";
    await tick(3000);
    expect(mock.calls).toHaveLength(3);
    expect(result.current.items[0].status).toBe("ready");
    await tick(9000);
    expect(mock.calls).toHaveLength(3);
  });

  it("stops while the page is hidden and refreshes at once when it is visible again", async () => {
    const { mock } = setup({ value: "queued" });
    await tick(0);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(9000);
    expect(mock.calls).toHaveLength(1);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(0);
    expect(mock.calls).toHaveLength(2);
    await tick(3000);
    expect(mock.calls).toHaveLength(3);
  });

  it("does not poll for items that are only uploading", async () => {
    const { mock } = setup({ value: "uploading" });
    await tick(0);
    await tick(9000);
    expect(mock.calls).toHaveLength(1);
  });

  it("replaces and removes items locally", async () => {
    const { result } = setup({ value: "ready" });
    await tick(0);
    act(() => result.current.replace({ ...result.current.items[0], status: "queued" }));
    expect(result.current.items[0].status).toBe("queued");
    act(() => result.current.replace({ ...result.current.items[0], id: "new" }));
    expect(result.current.items.map((i) => i.id)).toEqual(["new", "i1"]);
    act(() => result.current.remove("i1"));
    expect(result.current.items.map((i) => i.id)).toEqual(["new"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/format.test.ts src/features/library/use-library-items.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/library/format.ts`:

```ts
const MIB = 1024 * 1024;

/** 字节 → "5.0 MB" / "150 MB" / "2.0 GB"(MiB 计,R-L18)。 */
export function formatBytes(bytes: number): string {
  const mb = Math.max(0, bytes) / MIB;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** 毫秒 → "m:ss" 或 "h:mm:ss";未知为 "--:--"。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
```

`web/src/features/library/use-library-items.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { listItems, type LibraryItem } from "./library-api";

export const POLL_MS = 3000;

export const isActive = (item: Pick<LibraryItem, "status">): boolean => item.status === "queued" || item.status === "processing";

/** 用新取的第一页更新列表:已有的就地更新,新出现的放最前,已加载的后续页保留(R-L11)。 */
export function mergeFirstPage(prev: readonly LibraryItem[], fresh: readonly LibraryItem[]): LibraryItem[] {
  const byId = new Map(fresh.map((i) => [i.id, i]));
  const known = new Set(prev.map((i) => i.id));
  return [...fresh.filter((i) => !known.has(i.id)), ...prev.map((i) => byId.get(i.id) ?? i)];
}

/** active 时每 ms 调一次 fn;页面隐藏时停,回到可见时先调一次再恢复。fn 的错误被吞掉(下一轮再试)。 */
export function usePolling(active: boolean, fn: () => Promise<unknown> | void, ms = POLL_MS, doc: Document = document): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => {
      try {
        void Promise.resolve(fnRef.current()).catch(() => {});
      } catch {
        /* 同上 */
      }
    };
    const start = () => {
      if (timer === null && doc.visibilityState !== "hidden") timer = setInterval(run, ms);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (doc.visibilityState === "hidden") {
        stop();
      } else if (timer === null) {
        run();
        start();
      }
    };
    start();
    doc.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      doc.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, ms, doc]);
}

export interface LibraryItemsState {
  items: LibraryItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
}

const INITIAL: LibraryItemsState = { items: [], nextCursor: null, loading: true, loadingMore: false, error: null };

export function useLibraryItems(enabled: boolean) {
  const { api } = useAuth();
  const [state, setState] = useState<LibraryItemsState>(INITIAL);
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = state.nextCursor;

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await listItems(api);
      setState({ items: page.items, nextCursor: page.nextCursor, loading: false, loadingMore: false, error: null });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }, [api]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const refresh = useCallback(async () => {
    const page = await listItems(api);
    setState((s) => ({ ...s, items: mergeFirstPage(s.items, page.items) }));
  }, [api]);

  usePolling(enabled && state.items.some(isActive), refresh);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const page = await listItems(api, cursor);
      setState((s) => {
        const known = new Set(s.items.map((i) => i.id));
        return { ...s, items: [...s.items, ...page.items.filter((i) => !known.has(i.id))], nextCursor: page.nextCursor, loadingMore: false };
      });
    } catch (error) {
      setState((s) => ({ ...s, loadingMore: false, error }));
    }
  }, [api]);

  const replace = useCallback((item: LibraryItem) => {
    setState((s) => ({
      ...s,
      items: s.items.some((i) => i.id === item.id) ? s.items.map((i) => (i.id === item.id ? item : i)) : [item, ...s.items],
    }));
  }, []);

  const remove = useCallback((id: string) => {
    setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
  }, []);

  return { ...state, reload, refresh, loadMore, replace, remove };
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/format.test.ts src/features/library/use-library-items.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library list data with visibility-aware polling

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L7: 封面、页面状态与列表卡片(R-L12、R-L18)

**Files:**
- Create: `web/src/features/library/ui.ts`、`ui.test.ts`、`page-status.tsx`、`use-poster.ts`、`use-poster.test.tsx`、`item-card.tsx`、`item-card.test.tsx`

**Interfaces:**
- Produces:`PRIMARY`(玻璃光带主按钮)、`GHOST`、`TEXT_BUTTON`、`CONTROL`、`FIELD`;`PageLoading`、`PageError({message, onRetry?})`、`PageNote`;`usePosterUrl(itemId, enabled, target?) → string | null`;`UPLOAD_STAGES`、`LINK_STAGES`、`stagesFor(source)`、`ItemCardHandlers`、`ItemCard({item, job?, index?, ...handlers})`(用 `SpotlightCard`、`ShinyText`、`Stepper`)
- Consumes:LV1–LV3 的 `fx/spotlight-card`、`fx/shiny-text`、`fx/stepper`、`fx/specular-button`、`library.css`

- [ ] **Step 1: 写失败测试**

`web/src/features/library/use-poster.test.tsx`:

```tsx
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { usePosterUrl } from "./use-poster";

let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
class FakeIO {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { observed = cb; }
  observe() {}
  disconnect() {}
}
const original = { IO: globalThis.IntersectionObserver, create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  observed = null;
  globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
  URL.createObjectURL = vi.fn(() => "blob:poster-1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup(); // 先卸载组件(它的清理会调 URL.revokeObjectURL),再还原全局;否则 RTL 的自动清理晚于本钩子,会碰到已还原成 undefined 的 revokeObjectURL
  globalThis.IntersectionObserver = original.IO;
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

function setup(enabled: boolean, withTarget: boolean) {
  const mock = createFetchMock({ "GET /api/library/items/i1/poster": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } }) });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const target = createRef<HTMLDivElement>();
  if (withTarget) (target as { current: HTMLDivElement | null }).current = document.createElement("div");
  return { mock, ...renderHook(() => usePosterUrl("i1", enabled, withTarget ? target : undefined), { wrapper }) };
}

describe("usePosterUrl (R-L18)", () => {
  it("fetches with Bearer at once without a target and revokes on unmount", async () => {
    const { mock, result, unmount } = setup(true, false);
    await waitFor(() => expect(result.current).toBe("blob:poster-1"));
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer t");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:poster-1");
  });

  it("waits until the card scrolls into view", async () => {
    const { mock, result } = setup(true, true);
    expect(mock.calls).toHaveLength(0);
    act(() => observed?.([{ isIntersecting: true }]));
    await waitFor(() => expect(result.current).toBe("blob:poster-1"));
  });

  it("does nothing when disabled", () => {
    const { mock, result } = setup(false, false);
    expect(result.current).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });
});
```

`web/src/features/library/item-card.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/api/client";
import { setUiLanguage } from "./test-i18n";
import { renderWithProviders } from "~/test/render";
import { ItemCard, type ItemCardHandlers } from "./item-card";
import type { LibraryItem } from "./library-api";
import type { UploadJob } from "./upload-store";

const base: LibraryItem = {
  id: "i1", kind: "video", source: "upload", title: "Lecture 1", status: "ready", stage: null, progress: 100, errorKind: null,
  durationMs: 125_000, segCount: 3, libraryBytes: 5 * 1024 * 1024, subSource: "uploaded", resumeMs: 0, ratePct: 100,
  createdAt: "2026-10-13T08:00:00Z", lastOpenedAt: null,
};
const handlers = (): ItemCardHandlers => ({
  onDelete: vi.fn(), onRetry: vi.fn(), onAddSubtitles: vi.fn(), onResumeUpload: vi.fn(), onCancelUpload: vi.fn(),
  onRetryUpload: vi.fn(), onDismissUpload: vi.fn(),
});
const job = (over: Partial<UploadJob> = {}): UploadJob => ({
  key: "upload-1", itemId: "u1", filename: "Talk.mp4", title: "Talk", size: 10 * 1024 * 1024, sent: 4 * 1024 * 1024,
  state: "uploading", error: null, input: { file: new Blob(), filename: "Talk.mp4" }, ...over,
});
const card = (ui: Parameters<typeof ItemCard>[0]) => renderWithProviders(<ul><ItemCard {...ui} /></ul>);

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("ItemCard (spec §11.2, R-L12)", () => {
  it("links a ready item to its player and shows duration, sentences, size and subtitle source", () => {
    card({ item: base, ...handlers() });
    expect(screen.getByRole("link", { name: /Lecture 1/ })).toHaveAttribute("href", "/library/i1");
    expect(screen.getByText("2:05 · 3 句 · 5.0 MB")).toBeInTheDocument();
    expect(screen.getByText("上传字幕")).toBeInTheDocument();
  });

  it("shows stage and progress while processing, with no link", () => {
    card({ item: { ...base, status: "processing", stage: "transcode", progress: 40 }, ...handlers() });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "转码中" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("转码中 · 40%")).toBeInTheDocument();
  });

  it("explains a missing-subtitles failure and offers subtitles but not retry", () => {
    const h = handlers();
    card({ item: { ...base, status: "failed", errorKind: "no_subtitles" }, ...h });
    expect(screen.getByTestId("library-item-reason")).toHaveTextContent("这条没有字幕");
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "补传字幕" }));
    expect(h.onAddSubtitles).toHaveBeenCalled();
  });

  it("puts 'download and upload' first for blocked links and offers retry", () => {
    const h = handlers();
    card({ item: { ...base, source: "link", status: "failed", errorKind: "blocked" }, ...h });
    expect(screen.getByTestId("library-item-reason").textContent).toMatch(/^网站拒绝了服务器的访问.*最稳的办法:在你自己的设备上下载后上传文件/);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(h.onRetry).toHaveBeenCalled();
  });

  it("offers to continue an unfinished upload from another session", () => {
    const h = handlers();
    card({ item: { ...base, status: "uploading", durationMs: null, libraryBytes: 0 }, ...h });
    fireEvent.click(screen.getByRole("button", { name: "继续上传" }));
    expect(h.onResumeUpload).toHaveBeenCalled();
  });

  it("shows local upload progress with cancel instead of delete", () => {
    const h = handlers();
    card({ item: null, job: job(), ...h });
    expect(screen.getByText("上传中 40%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(h.onCancelUpload).toHaveBeenCalled();
  });

  it("shows a failed local upload with a translated reason, retry and dismiss", () => {
    const h = handlers();
    card({ item: null, job: job({ state: "failed", error: new ApiError(0, "Network error") }), ...h });
    expect(screen.getByRole("alert")).toHaveTextContent("上传中断:");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(h.onRetryUpload).toHaveBeenCalled();
    expect(h.onDismissUpload).toHaveBeenCalled();
  });

  it("deletes through the handler", () => {
    const h = handlers();
    card({ item: { ...base, status: "canceled" }, ...h });
    expect(screen.getByText("已取消")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(h.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
  });

  it("shows the processing stages as a stepper with the current stage marked and a shiny status line (D11)", () => {
    card({ item: { ...base, status: "processing", stage: "transcribe", progress: 62 }, ...handlers() });
    const steps = [...document.querySelectorAll(".lib-step")].map((el) => el.getAttribute("data-state"));
    expect(steps).toEqual(["done", "done", "done", "now", "todo"]);
    expect(document.querySelector(".lib-shiny")).toHaveTextContent("转写中 · 62%");
    expect(screen.getByRole("progressbar", { name: "转写中" })).toHaveAttribute("aria-valuenow", "62");
  });

  it("uses the six-stage stepper for links, with the download step second", () => {
    card({ item: { ...base, source: "link", status: "processing", stage: "fetch", progress: 20 }, ...handlers() });
    expect([...document.querySelectorAll(".lib-step")].map((el) => el.getAttribute("data-state"))).toEqual(["done", "now", "todo", "todo", "todo", "todo"]);
  });

  it("shows a queued item with no stage as not started", () => {
    card({ item: { ...base, status: "queued", stage: null, progress: 0 }, ...handlers() });
    expect([...document.querySelectorAll(".lib-step")].every((el) => el.getAttribute("data-state") === "todo")).toBe(true);
    expect(screen.getByRole("progressbar", { name: "排队中" })).toBeInTheDocument();
  });

  it("is a spotlight card that rises in with a staggered delay, capped so a long list does not wait seconds", () => {
    const first = card({ item: base, index: 3, ...handlers() });
    const surface = screen.getByTestId("library-item-i1").firstElementChild as HTMLElement;
    expect(surface.className).toMatch(/\blib-rise\b/);
    expect(surface.className).toMatch(/\blib-spot\b/);
    expect(surface.style.getPropertyValue("--lib-delay")).toBe("0.21s");
    first.unmount();
    card({ item: base, index: 40, ...handlers() });
    expect((screen.getByTestId("library-item-i1").firstElementChild as HTMLElement).style.getPropertyValue("--lib-delay")).toBe("0.56s");
  });

  it("labels a ready item with a status badge next to the subtitle source", () => {
    card({ item: base, ...handlers() });
    expect(screen.getByText("可以跟读")).toBeInTheDocument();
    expect(screen.getByText("上传字幕")).toBeInTheDocument();
  });

  it("draws local upload progress with the quota-bar styles", () => {
    card({ item: null, job: job(), ...handlers() });
    const bar = screen.getByRole("progressbar", { name: "上传中 40%" });
    expect(bar.className).toMatch(/\blib-quota-bar\b/);
    expect((bar.firstElementChild as HTMLElement).style.getPropertyValue("--p")).toBe("0.4");
  });
});
```

`web/src/features/library/ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIELD, GHOST, PRIMARY } from "./ui";

describe("library button and field classes (D11)", () => {
  it("makes the primary button the specular glass button, not a flat blue one", () => {
    expect(PRIMARY).toContain("lib-spec");
    expect(PRIMARY).not.toContain("bg-blue");
    expect(PRIMARY).toContain("rounded-button");
  });

  it("keeps the ghost button solid and the field 16px so iOS does not zoom, with the glass-sheet field class", () => {
    expect(GHOST).toContain("bg-surface");
    expect(FIELD).toContain("text-[16px]");
    expect(FIELD).toContain("lib-field");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/use-poster.test.tsx src/features/library/item-card.test.tsx src/features/library/ui.test.ts`。

- [ ] **Step 3: 实现**

`web/src/features/library/ui.ts`:

```ts
import { cn } from "@renderer/lib/utils";
import { SPECULAR_CLASS } from "./fx/specular-button";

// 跟读库共用的按钮 / 输入框类(12px 圆角、15px 半粗;蓝 = 操作)。主按钮是玻璃光带按钮(.lib-spec,library.css,D11)。
// 用模板字符串拼颜色:cn 会把 text-body 当颜色类与 text-ink 合并掉。
const BASE = cn(
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-button px-4 text-body font-semibold tracking-[-0.005em]",
  "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

/** 主按钮:渐变底 + 内高光 + 光带扫过(`.lib-spec` 自带底色、白字与胶囊圆角,只在 `.library-root` 内生效);高度由调用方给。 */
export const PRIMARY = `${BASE} ${SPECULAR_CLASS}`;
/** 次按钮(surface + 发丝线)。 */
export const GHOST = `${BASE} border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2`;
/** 卡片里的文字按钮(蓝字,44px 命中高)。 */
export const TEXT_BUTTON = cn(
  "inline-flex min-h-tap items-center gap-1.5 rounded-button px-3 text-sub font-semibold text-blue transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4",
);
/** 播放器控制条的 44px 按钮(W2 的面板也可用;播放页自己的控制胶囊用 `.lib-ctrl-btn`)。 */
export const CONTROL = cn(
  "inline-flex h-tap min-w-[44px] items-center justify-center gap-1 rounded-button px-2 text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
  "aria-pressed:text-blue [&_svg]:h-[22px] [&_svg]:w-[22px]",
);
/** 输入框:16px 字号防 iOS 缩放;`lib-field` 在 `.library-root`(含玻璃弹层)里换成半透明底(library.css)。 */
export const FIELD = cn(
  "lib-field h-11 w-full rounded-button border-0 bg-surface-2 px-3 text-[16px] text-ink placeholder:text-ink-3",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);
```

`web/src/features/library/page-status.tsx`:

```tsx
import { LoaderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PAGE_NOTE } from "~/components/list-card";

/** 页面加载中(居中转圈)。只用主包文案,懒加载包装也用它。 */
export function PageLoading() {
  const { t } = useTranslation();
  return (
    <div data-testid="library-loading" className="flex justify-center py-16 text-ink-2">
      <LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} />
    </div>
  );
}

/** 页面内的错误说明(已翻译)+ 可选重试。 */
export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" data-testid="library-error" className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sub text-ink-2">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}
          className="min-h-tap rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("web.common.retry")}
        </button>
      ) : null}
    </div>
  );
}

/** 页面内的提示 / 空状态文字。 */
export function PageNote({ children }: { children: ReactNode }) {
  return <p className={PAGE_NOTE}>{children}</p>;
}
```

`web/src/features/library/use-poster.ts`:

```ts
import { type RefObject, useEffect, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { fetchPoster } from "./library-api";

/**
 * 视频封面(R-L18):`<img>` 发不了 Bearer,所以用 ApiClient 取 blob 再 createObjectURL;给了 target 且有
 * IntersectionObserver 时,进入视口(提前 200px)才取;卸载或换条目时撤销 URL。失败 = 没有封面(显示图标)。
 */
export function usePosterUrl(itemId: string, enabled: boolean, target?: RefObject<Element | null>): string | null {
  const { api } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(!target);

  useEffect(() => {
    if (!enabled || visible) return;
    const el = target?.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, visible, target]);

  useEffect(() => {
    if (!enabled || !visible || !itemId || typeof URL.createObjectURL !== "function") return;
    const ctl = new AbortController();
    let made: string | null = null;
    fetchPoster(api, itemId, ctl.signal).then((blob) => {
      if (ctl.signal.aborted) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }, () => { /* 没有封面就显示图标 */ });
    return () => {
      ctl.abort();
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [api, itemId, enabled, visible]);

  return url;
}
```

`web/src/features/library/item-card.tsx`:

```tsx
import { ChevronRightIcon, ClapperboardIcon, FileTextIcon, MusicIcon, RotateCcwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { IconButton } from "~/components/icon-button";
import { ToneBadge } from "~/components/tone-badge";
import { errorKindKey, failedActions } from "./error-kinds";
import { ShinyText } from "./fx/shiny-text";
import { SpotlightCard } from "./fx/spotlight-card";
import { Stepper, type StepperStep } from "./fx/stepper";
import { formatBytes, formatDuration } from "./format";
import { LIBRARY_SERVER_ERRORS, type LibraryItem, type LibrarySource } from "./library-api";
import "./locales";
import { TEXT_BUTTON } from "./ui";
import type { UploadJob } from "./upload-store";
import { usePosterUrl } from "./use-poster";

export interface ItemCardHandlers {
  onDelete(item: LibraryItem): void;
  onRetry(item: LibraryItem): void;
  onAddSubtitles(item: LibraryItem): void;
  onResumeUpload(item: LibraryItem): void;
  onCancelUpload(job: UploadJob): void;
  onRetryUpload(job: UploadJob): void;
  onDismissUpload(job: UploadJob): void;
}

/** 处理阶段的步骤(spec §6.2):上传类没有「取回」,链接有。 */
export const UPLOAD_STAGES = ["probe", "transcode", "subtitles", "transcribe", "segment"] as const;
export const LINK_STAGES = ["probe", "fetch", "transcode", "subtitles", "transcribe", "segment"] as const;
export const stagesFor = (source: LibrarySource): readonly string[] => (source === "link" ? LINK_STAGES : UPLOAD_STAGES);

const clampPct = (pct: number) => Math.max(0, Math.min(100, Math.round(pct)));

/** 上传进度条:沿用「已用空间」条的样式(.lib-quota-bar / .lib-quota-fill,用 transform: scaleX,不动布局)。 */
function ProgressBar({ pct, label }: { pct: number; label: string }) {
  const value = clampPct(pct);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="lib-quota-bar mt-2.5">
      <div className="lib-quota-fill" style={{ "--p": value / 100 } as CSSProperties} />
    </div>
  );
}

/**
 * 跟读库列表的一张卡(spec §11.2、§11.4a):ready 整行是链接;处理中显示流光状态行 + 阶段步骤条;失败显示原因与可用动作(R-L12);
 * 本地上传任务(job)优先于服务端状态显示。卡片是 SpotlightCard(按住高光、半透明 + 高光边、不加模糊)并依次浮入(`index` 决定延迟,最多 8 档)。
 * 颜色:蓝 = 进行中 / 操作,原因用中性次要色。
 */
export function ItemCard({ item, job, index = 0, ...h }: { item: LibraryItem | null; job?: UploadJob; index?: number } & ItemCardHandlers) {
  const { t } = useTranslation();
  const ref = useRef<HTMLLIElement>(null);
  const ready = item?.status === "ready";
  const poster = usePosterUrl(item?.id ?? "", !!item && ready && item.kind === "video", ref);
  const title = item?.title ?? job?.title ?? "";
  const state = job ? (job.state === "uploading" ? "upload-local" : "upload-failed") : (item?.status ?? "uploading");
  const meta = item
    ? [
      item.durationMs ? formatDuration(item.durationMs) : null,
      ready ? t("web.library.sentences", { count: item.segCount }) : null,
      item.libraryBytes > 0 ? formatBytes(item.libraryBytes) : null,
    ].filter(Boolean).join(" · ")
    : formatBytes(job?.size ?? 0);

  const head = (
    <>
      <span aria-hidden className="flex h-[54px] w-24 flex-none items-center justify-center overflow-hidden rounded-[12px] bg-surface-2 text-ink-2">
        {poster ? <img src={poster} alt="" className="h-full w-full object-cover" />
          : item?.kind === "audio" ? <MusicIcon className="h-6 w-6" /> : <ClapperboardIcon className="h-6 w-6" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold tracking-[-0.01em]">{title}</span>
        {ready && item ? (
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            <ToneBadge tone="green">{t("web.library.status.ready")}</ToneBadge>
            {item.subSource ? <ToneBadge tone="gray">{t(`web.library.sub.${item.subSource}`)}</ToneBadge> : null}
          </span>
        ) : null}
        {meta ? <span className="num mt-[3px] block truncate text-meta text-ink-2">{meta}</span> : null}
      </span>
    </>
  );

  let body: ReactNode = null;
  if (job?.state === "uploading") {
    const pct = job.size > 0 ? Math.round((job.sent / job.size) * 100) : 0;
    const label = t("web.library.card.uploading", { pct });
    body = (
      <>
        <ProgressBar pct={pct} label={label} />
        <div className="mt-1 flex items-center justify-between gap-2 text-meta text-ink-2">
          <span className="num">{label}</span>
          <button type="button" className={TEXT_BUTTON} onClick={() => h.onCancelUpload(job)}>
            <XIcon aria-hidden />{t("web.library.card.cancelUpload")}
          </button>
        </div>
      </>
    );
  } else if (job) {
    body = (
      <>
        <p role="alert" className="mt-2 text-meta text-ink-2">
          {t("web.library.card.uploadFailed", { reason: translateServerError(t, job.error, LIBRARY_SERVER_ERRORS) })}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <button type="button" className={TEXT_BUTTON} onClick={() => h.onRetryUpload(job)}>
            <RotateCcwIcon aria-hidden />{t("web.library.card.retry")}
          </button>
          <button type="button" className={TEXT_BUTTON} onClick={() => h.onDismissUpload(job)}>{t("web.library.card.dismiss")}</button>
        </div>
      </>
    );
  } else if (item?.status === "queued" || item?.status === "processing") {
    const stage = item.stage ? t(`web.library.stage.${item.stage}`) : t(`web.library.status.${item.status}`);
    const steps: StepperStep[] = stagesFor(item.source).map((key) => ({ key, label: t(`web.library.stage.${key}`) }));
    body = (
      <div role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clampPct(item.progress)} className="mt-2.5">
        <p className="num text-meta"><ShinyText>{t("web.library.progress", { stage, pct: item.progress })}</ShinyText></p>
        <Stepper steps={steps} current={item.status === "processing" ? item.stage : null} />
      </div>
    );
  } else if (item?.status === "failed") {
    const actions = failedActions(item.errorKind);
    body = (
      <>
        <p data-testid="library-item-reason" className="mt-2 text-meta text-ink-2">{t(errorKindKey(item.errorKind))}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {actions.retry ? (
            <button type="button" className={TEXT_BUTTON} onClick={() => h.onRetry(item)}>
              <RotateCcwIcon aria-hidden />{t("web.library.card.retry")}
            </button>
          ) : null}
          {actions.subtitles ? (
            <button type="button" className={TEXT_BUTTON} onClick={() => h.onAddSubtitles(item)}>
              <FileTextIcon aria-hidden />{t("web.library.card.addSubtitles")}
            </button>
          ) : null}
        </div>
      </>
    );
  } else if (item?.status === "uploading") {
    body = (
      <div className="mt-1 flex items-center justify-between gap-2 text-meta text-ink-2">
        <span>{t("web.library.status.uploading")}</span>
        <button type="button" className={TEXT_BUTTON} onClick={() => h.onResumeUpload(item)}>
          <UploadIcon aria-hidden />{t("web.library.card.resumeUpload")}
        </button>
      </div>
    );
  } else if (item?.status === "canceled") {
    body = <p className="mt-2 text-meta text-ink-2">{t("web.library.status.canceled")}</p>;
  }

  return (
    <li ref={ref} data-testid={`library-item-${item?.id ?? job?.key ?? ""}`} data-state={state}>
      <SpotlightCard className={cn("lib-rise rounded-[18px] p-3")} style={{ "--lib-delay": `${(Math.min(index, 8) * 0.07).toFixed(2)}s` } as CSSProperties}>
        <div className="flex items-center gap-2">
          {ready && item ? (
            <Link to={`/library/${encodeURIComponent(item.id)}`}
              className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-button p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {head}
              <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
            </Link>
          ) : <div className="flex min-w-0 flex-1 items-center gap-3">{head}</div>}
          {item && job?.state !== "uploading" ? (
            <IconButton label={t("web.library.card.delete")} onClick={() => h.onDelete(item)} className="text-ink-2">
              <Trash2Icon aria-hidden />
            </IconButton>
          ) : null}
        </div>
        {body}
      </SpotlightCard>
    </li>
  );
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/use-poster.test.tsx src/features/library/item-card.test.tsx src/features/library/ui.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck`。`ToneBadge` 的 `tone` 取值以 `components/tone.ts` 为准(`green`、`gray` 都是现有色相)。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library item cards with poster, progress and failure actions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L8: 添加素材弹层(上传 / 链接,R-L19)

**Files:**
- Create: `web/src/features/library/upload-form.tsx`、`upload-form.test.tsx`、`import-form.tsx`、`import-form.test.tsx`、`add-sheet.tsx`、`add-sheet.test.tsx`

**Interfaces:**
- Produces:`UploadProblem`、`checkUpload(file, limits, subtitles)`、`UploadForm({limits, asr, onSubmit})`;`isHttpUrl(value)`、`ImportForm({linkImport, onImported})`;`AddSheet({open, onOpenChange, config, onUpload, onImported})`

- [ ] **Step 1: 写失败测试**

`web/src/features/library/upload-form.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "./test-i18n";
import { renderWithProviders } from "~/test/render";
import { limitsOrDefault, type LibraryLimits } from "./library-api";
import { UploadForm, checkUpload } from "./upload-form";

const MIB = 1024 * 1024;
const LIMITS: LibraryLimits = { ...limitsOrDefault(null), maxUploadMb: 10, quotaMb: 20, usedBytes: 15 * MIB };
const f = (name: string, size: number) => ({ name, size });
const file = (name: string, size: number) => new File([new Uint8Array(size)], name);

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("checkUpload (R-L19)", () => {
  it("checks type, emptiness, size, quota and subtitles in that order", () => {
    expect(checkUpload(f("a.exe", 1), LIMITS, null)).toBe("badType");
    expect(checkUpload(f("a.mp4", 0), LIMITS, null)).toBe("empty");
    expect(checkUpload(f("a.mp4", 11 * MIB), LIMITS, null)).toBe("tooLarge");
    expect(checkUpload(f("a.MP4", 6 * MIB), LIMITS, null)).toBe("overQuota");
    expect(checkUpload(f("a.mp3", MIB), LIMITS, f("a.ass", 1))).toBe("subtitleBadType");
    expect(checkUpload(f("a.mp3", MIB), LIMITS, f("a.srt", 3 * MIB))).toBe("subtitleTooLarge");
    expect(checkUpload(f("a.mp3", MIB), LIMITS, f("a.vtt", 100))).toBeNull();
  });
});

describe("UploadForm", () => {
  it("submits the file, trimmed title and subtitles", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    const media = file("Talk.mp4", 100);
    const subs = file("Talk.srt", 10);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [media] } });
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [subs] } });
    fireEvent.change(screen.getByLabelText("标题(可选)"), { target: { value: "  My talk " } });
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledWith({ file: media, filename: "Talk.mp4", title: "My talk", subtitles: { file: subs, filename: "Talk.srt" } });
  });

  it("shows the problem and blocks submit", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("a.mp4", 11 * MIB)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("文件超过了 10 MB。");
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("warns that subtitles are needed when the server cannot transcribe", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr={false} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("library-upload-noasr")).toHaveTextContent("没有字幕时本服务器无法自动转写");
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [file("a.vtt", 10)] } });
    expect(screen.queryByTestId("library-upload-noasr")).toBeNull();
  });
});
```

`web/src/features/library/import-form.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { setUiLanguage } from "./test-i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ImportForm, isHttpUrl } from "./import-form";
import { itemRaw } from "./test-fixtures";

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

const DRM = "支持 yt-dlp 能直接下载的公开视频页面(如 YouTube 等)。受 DRM 保护的流媒体服务(Netflix、Disney+、爱奇艺、腾讯视频、优酷、Spotify 等)无法导入,请使用你自己拥有的文件上传。";

describe("isHttpUrl (R-L19)", () => {
  it("accepts only full http(s) links without credentials", () => {
    expect(isHttpUrl("https://www.youtube.com/watch?v=x")).toBe(true);
    expect(isHttpUrl(" http://example.com/a ")).toBe(true);
    expect(isHttpUrl("ftp://example.com/a")).toBe(false);
    expect(isHttpUrl("youtube.com/watch?v=x")).toBe(false);
    expect(isHttpUrl("https://user:pw@example.com/")).toBe(false);
    expect(isHttpUrl(`https://example.com/${"a".repeat(2000)}`)).toBe(false);
  });
});

describe("ImportForm (spec §7.4)", () => {
  it("only explains when link import is off, and always shows the DRM notice", () => {
    renderWithProviders(<ImportForm linkImport={false} onImported={vi.fn()} />);
    expect(screen.getByTestId("library-drm-note")).toHaveTextContent(DRM);
    expect(screen.getByTestId("library-link-disabled")).toHaveTextContent("管理员没有开启链接导入。");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("validates locally without a request", () => {
    const mock = createFetchMock({});
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "not a link" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入以 http:// 或 https:// 开头的完整链接。");
    expect(mock.calls).toHaveLength(0);
  });

  it("posts the link in the body and hands back the new item", async () => {
    const mock = createFetchMock({ "POST /api/library/imports": () => json(itemRaw({ id: "l1", source: "link", status: "queued" })) });
    const onImported = vi.fn();
    renderWithProviders(<ImportForm linkImport onImported={onImported} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: " https://www.youtube.com/watch?v=x " } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: "l1" })));
    expect(mock.calls[0].url.search).toBe("");
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ url: "https://www.youtube.com/watch?v=x" });
  });

  it("translates server refusals, and a 404 means the switch was turned off", async () => {
    let status = 400;
    const mock = createFetchMock({ "POST /api/library/imports": () => json({ error: status === 400 ? "Invalid URL" : "Not Found" }, status) });
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "http://10.0.0.1/x" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("链接无效或不允许访问。");
    status = 404;
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("管理员没有开启链接导入。"));
  });
});
```

`web/src/features/library/add-sheet.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "./test-i18n";
import { renderWithProviders } from "~/test/render";
import { AddSheet } from "./add-sheet";
import type { LibraryConfig } from "./library-api";

const CONFIG: LibraryConfig = {
  enabled: true, linkImport: false, asr: true, ai: false,
  limits: { maxUploadMb: 500, maxDurationMinutes: 90, quotaMb: 2000, usedBytes: 0, maxItems: 100, chunkBytes: 8388608, formats: ["mp4", "mp3"] },
};

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("AddSheet (spec §11.3)", () => {
  it("opens on the upload tab and switches to the link tab", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "添加素材" })).toBeInTheDocument();
    expect(screen.getByTestId("library-upload-form")).toBeInTheDocument();
    expect(screen.getByTestId("library-upload-file")).toHaveAttribute("accept", "audio/*,video/*,.mp4,.mp3");
    expect(screen.getByText("单个最大 500 MB,最长 90 分钟")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("library-tab-link"));
    expect(screen.getByTestId("library-link-disabled")).toBeInTheDocument();
  });

  it("is a floating glass sheet scoped to the library tokens, so the portal still gets the variables (D11)", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/\blibrary-root\b/);
    expect(dialog.className).toMatch(/\blib-sheet\b/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/upload-form.test.tsx src/features/library/import-form.test.tsx src/features/library/add-sheet.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/library/upload-form.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LIBRARY_FORMATS, MAX_SUBTITLE_BYTES, MAX_TITLE_CHARS, MIB, SUBTITLE_FORMATS, extOf, type LibraryLimits,
} from "./library-api";
import "./locales";
import { FIELD, PRIMARY } from "./ui";
import type { UploadInput } from "./upload-client";

export type UploadProblem = "badType" | "empty" | "tooLarge" | "overQuota" | "subtitleBadType" | "subtitleTooLarge";

const formatsOf = (limits: LibraryLimits): readonly string[] => (limits.formats.length ? limits.formats : LIBRARY_FORMATS);

/** 客户端预检(R-L19;服务端仍是最终裁判):扩展名、空文件、单文件上限、剩余配额、字幕。 */
export function checkUpload(
  file: { name: string; size: number }, limits: LibraryLimits, subtitles: { name: string; size: number } | null,
): UploadProblem | null {
  if (!formatsOf(limits).includes(extOf(file.name))) return "badType";
  if (file.size <= 0) return "empty";
  if (file.size > limits.maxUploadMb * MIB) return "tooLarge";
  if (limits.usedBytes + file.size > limits.quotaMb * MIB) return "overQuota";
  if (subtitles) {
    if (!(SUBTITLE_FORMATS as readonly string[]).includes(extOf(subtitles.name))) return "subtitleBadType";
    if (subtitles.size > MAX_SUBTITLE_BYTES) return "subtitleTooLarge";
  }
  return null;
}

/** 上传页签(spec §11.3):文件、可选字幕、可选标题;提交即交给上传任务表,弹层由调用方关闭。 */
export function UploadForm({ limits, asr, onSubmit }: { limits: LibraryLimits; asr: boolean; onSubmit: (input: UploadInput) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [subs, setSubs] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const problem = file ? checkUpload(file, limits, subs) : null;
  const accept = ["audio/*", "video/*", ...formatsOf(limits).map((f) => `.${f}`)].join(",");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || problem) return;
    onSubmit({
      file, filename: file.name, title: title.trim() || undefined,
      subtitles: subs ? { file: subs, filename: subs.name } : null,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="library-upload-form">
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("web.library.upload.file")}</span>
        <input type="file" accept={accept} data-testid="library-upload-file" className="min-h-tap text-sub text-ink"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <p className="text-meta text-ink-2">{t("web.library.upload.limits", { mb: limits.maxUploadMb, minutes: limits.maxDurationMinutes })}</p>
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("web.library.upload.subtitles")}</span>
        <input type="file" accept=".srt,.vtt" data-testid="library-upload-subtitles" className="min-h-tap text-sub text-ink"
          onChange={(e) => setSubs(e.target.files?.[0] ?? null)} />
      </label>
      {!asr && !subs ? <p data-testid="library-upload-noasr" className="text-meta text-amber">{t("web.library.upload.noAsr")}</p> : null}
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("web.library.upload.titleLabel")}</span>
        <input type="text" value={title} maxLength={MAX_TITLE_CHARS} className={FIELD} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {problem ? <p role="alert" className="text-meta text-red">{t(`web.library.upload.${problem}`, { mb: limits.maxUploadMb })}</p> : null}
      <button type="submit" disabled={!file || !!problem} className={`${PRIMARY} h-12`}>{t("web.library.upload.submit")}</button>
    </form>
  );
}
```

`web/src/features/library/import-form.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { LIBRARY_SERVER_ERRORS, MAX_TITLE_CHARS, MAX_URL_CHARS, importLink, type LibraryItem } from "./library-api";
import "./locales";
import { FIELD, PRIMARY } from "./ui";

/** 只做形状检查:http(s)、有主机、无用户信息、≤ 2000 字;能否访问由服务端判定(spec §7.2)。 */
export function isHttpUrl(value: string): boolean {
  const s = value.trim();
  if (!s || s.length > MAX_URL_CHARS) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

// 导入时的 404 = 管理员刚关掉链接导入(spec §9),不是「素材不存在」
const IMPORT_ERRORS: Record<string, string> = { ...LIBRARY_SERVER_ERRORS, "Not Found": "web.library.link.disabled" };

/** 链接页签(spec §7.4、§11.3):DRM 文案常驻;开关关时只显示说明。链接只放在 POST 体里。 */
export function ImportForm({ linkImport, onImported }: { linkImport: boolean; onImported: (item: LibraryItem) => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isHttpUrl(url)) {
      setError(t("web.library.link.badUrl"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await importLink(api, { url: url.trim(), title: title.trim() || undefined });
      setUrl("");
      setTitle("");
      onImported(item);
    } catch (err) {
      setError(translateServerError(t, err, IMPORT_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="library-import">
      <p data-testid="library-drm-note" className="rounded-card bg-surface-2 p-3 text-meta text-ink-2">{t("web.library.link.drm")}</p>
      {!linkImport ? (
        <p data-testid="library-link-disabled" className="text-sub text-ink-2">{t("web.library.link.disabled")}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">{t("web.library.link.url")}</span>
            <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={MAX_URL_CHARS}
              placeholder={t("web.library.link.placeholder")} value={url} className={FIELD} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">{t("web.library.link.titleLabel")}</span>
            <input type="text" value={title} maxLength={MAX_TITLE_CHARS} className={FIELD} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {error ? <p role="alert" className="text-meta text-red">{error}</p> : null}
          <p className="text-meta text-ink-2">{t("web.library.link.note")}</p>
          <button type="submit" disabled={busy || !url.trim()} className={`${PRIMARY} h-12`}>{t("web.library.link.submit")}</button>
        </form>
      )}
    </div>
  );
}
```

`web/src/features/library/add-sheet.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SegmentedControl } from "~/components/segmented-control";
import { ImportForm } from "./import-form";
import { limitsOrDefault, type LibraryConfig, type LibraryItem } from "./library-api";
import "./locales";
import "./library.css";
import type { UploadInput } from "./upload-client";
import { UploadForm } from "./upload-form";

type Tab = "upload" | "link";

/** 添加素材的底部弹层(spec §11.1:不单独路由;R-L19)。 */
export function AddSheet({ open, onOpenChange, config, onUpload, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: LibraryConfig;
  onUpload: (input: UploadInput) => void;
  onImported: (item: LibraryItem) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("upload");
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="library-root lib-sheet max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <BottomSheetHeader title={t("web.library.sheet.title")} />
        <SegmentedControl<Tab> label={t("web.library.sheet.tabs")} value={tab} onChange={setTab}
          options={[
            { value: "upload", label: t("web.library.sheet.upload"), testId: "library-tab-upload" },
            { value: "link", label: t("web.library.sheet.link"), testId: "library-tab-link" },
          ]} />
        <div className="mt-3">
          {tab === "upload"
            ? <UploadForm limits={limitsOrDefault(config.limits)} asr={config.asr} onSubmit={onUpload} />
            : <ImportForm linkImport={config.linkImport} onImported={onImported} />}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/upload-form.test.tsx src/features/library/import-form.test.tsx src/features/library/add-sheet.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck`。抽屉标题若不是 heading 角色(Radix `Dialog.Title` 渲染 `h2`),按实际改断言为 `getByText("添加素材")`。`ImportForm` 的 `<form>` 带 `noValidate`:`type="url"` 的原生校验会先拦住提交(jsdom 和浏览器都会),我们自己的 `isHttpUrl` 校验与本地化文案就永远出不来了。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library add sheet with upload and link tabs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L9: 列表页 `/library`(spec §11.2、R-L6、R-L9、R-L10、R-L12)

**Files:**
- Create: `web/src/features/library/library-list-page.tsx`、`library-list-page.test.tsx`

**Interfaces:**
- Consumes:L1–L8
- Produces:`LibraryListPage`

- [ ] **Step 1: 写失败测试** — `web/src/features/library/library-list-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { setUiLanguage } from "./test-i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LibraryListPage } from "./library-list-page";
import { CONFIG_OFF_RAW, CONFIG_RAW, itemRaw } from "./test-fixtures";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

function render(items: Record<string, unknown>[], extra: Record<string, Handler> = {}, config: unknown = CONFIG_RAW) {
  const mock = createFetchMock({
    "GET /api/library/config": () => json(config),
    "GET /api/library/items": () => json({ items, next_cursor: null }),
    ...extra,
  });
  renderWithProviders(<LibraryListPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/library", path: "/library" });
  return mock;
}

describe("LibraryListPage (spec §11.2)", () => {
  it("goes back to the practice page when the library is off", async () => {
    render([], {}, CONFIG_OFF_RAW);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
  });

  it("shows usage, an empty state and the add button", async () => {
    render([]);
    expect(await screen.findByText("还没有素材。上传音视频文件或导入链接,然后逐句跟读。")).toBeInTheDocument();
    const usage = screen.getByTestId("library-usage");
    expect(usage).toHaveTextContent("已用");
    expect(usage).toHaveTextContent("10.0 MB"); // CountUp 的 sr-only 终值;可见的数字是滚动中的 aria-hidden 值
    expect(usage).toHaveTextContent("2.0 GB");
    fireEvent.click(screen.getByTestId("library-add"));
    expect(await screen.findByTestId("library-upload-form")).toBeInTheDocument();
  });

  it("is a tab root on the library surface: no back button, a specular add button and the aurora", async () => {
    render([]);
    await screen.findByTestId("library-add");
    expect(document.querySelector("header")?.querySelector("button")).toBeNull();
    expect(screen.getByTestId("library-add").className).toMatch(/\blib-spec\b/);
    expect(document.querySelector(".library-root.lib-page")).not.toBeNull();
    expect(document.querySelector(".lib-aurora")).not.toBeNull();
  });

  it("fills the usage bar to the used share of the quota", async () => {
    render([]);
    await screen.findByTestId("library-add");
    const fill = document.querySelector(".lib-quota-fill") as HTMLElement;
    expect(Number(fill.style.getPropertyValue("--p"))).toBeCloseTo(10 / 2000, 5);
  });

  it("lists ready, processing and failed items", async () => {
    render([
      itemRaw(),
      itemRaw({ id: "p1", title: "Pod", kind: "audio", status: "processing", stage: "transcribe", progress: 70 }),
      itemRaw({ id: "f1", title: "Broken", status: "failed", error_kind: "no_subtitles" }),
    ]);
    expect(await screen.findByRole("link", { name: /Lecture 1/ })).toHaveAttribute("href", "/library/i1");
    expect(screen.getByText("转写中 · 70%")).toBeInTheDocument();
    expect(within(screen.getByTestId("library-item-f1")).getByRole("button", { name: "补传字幕" })).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    const mock = render([itemRaw()], { "DELETE /api/library/items/i1": () => new Response(null, { status: 204 }) });
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("删除这条素材?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.queryByTestId("library-item-i1")).toBeNull());
    expect(mock.calls.some((c) => c.method === "DELETE" && c.url.pathname === "/api/library/items/i1")).toBe(true);
  });

  it("retries a failed item and shows it queued", async () => {
    render([itemRaw({ id: "f1", status: "failed", error_kind: "upstream" })], {
      "POST /api/library/items/f1/retry": () => json(itemRaw({ id: "f1", status: "queued", stage: null, progress: 0 })),
    });
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByTestId("library-item-f1")).toHaveAttribute("data-state", "queued"));
  });

  it("adds subtitles to a failed item through the hidden picker", async () => {
    const mock = render([itemRaw({ id: "f1", status: "failed", error_kind: "no_subtitles" })], {
      "PUT /api/library/items/f1/subtitles": () => json(itemRaw({ id: "f1", status: "queued", progress: 0 })),
    });
    fireEvent.click(await screen.findByRole("button", { name: "补传字幕" }));
    fireEvent.change(screen.getByTestId("library-subtitles-input"), { target: { files: [new File(["1\n"], "fix.srt")] } });
    await waitFor(() => expect(screen.getByTestId("library-item-f1")).toHaveAttribute("data-state", "queued"));
    expect(mock.calls.find((c) => c.method === "PUT")?.url.pathname).toBe("/api/library/items/f1/subtitles");
  });

  it("refuses to continue an upload with a different file name remembered in this tab", async () => {
    sessionStorage.setItem("enjoy-web.library.upload.u1", "original.mp4");
    const mock = render([itemRaw({ id: "u1", status: "uploading", duration_ms: null, library_bytes: 0 })]);
    fireEvent.click(await screen.findByRole("button", { name: "继续上传" }));
    fireEvent.change(screen.getByTestId("library-resume-input"), { target: { files: [new File(["x"], "other.mp4")] } });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("这不是同一个文件。请选择开始上传时的那个文件。"));
    expect(mock.calls.some((c) => c.url.pathname.startsWith("/api/library/uploads"))).toBe(false);
    sessionStorage.clear();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/library-list-page.test.tsx`。

- [ ] **Step 3: 实现** — `web/src/features/library/library-list-page.tsx`:

```tsx
import { PlusIcon } from "lucide-react";
import { type ChangeEvent, type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { AddSheet } from "./add-sheet";
import { fetchLibraryConfig, type LibraryConfig } from "./config";
import { CountUp } from "./fx/count-up";
import { formatBytes } from "./format";
import { ItemCard } from "./item-card";
import {
  LIBRARY_FORMATS, LIBRARY_SERVER_ERRORS, MAX_SUBTITLE_BYTES, MIB, SUBTITLE_FORMATS, deleteItem, extOf, limitsOrDefault,
  putItemSubtitles, retryItem, type LibraryItem,
} from "./library-api";
import { LibraryRoot } from "./library-root";
import "./locales";
import { PageError, PageLoading, PageNote } from "./page-status";
import { GHOST, PRIMARY } from "./ui";
import { UploadMismatchError, type UploadInput } from "./upload-client";
import { type UploadJob, uploads, useUploads } from "./upload-store";
import { useLibraryItems } from "./use-library-items";

/** `/library`(spec §11.2):每次进入重新取 config(要最新的已用空间,R-L6)。 */
export function LibraryListPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [config, setConfig] = useState<LibraryConfig | null>(null);
  const [configError, setConfigError] = useState<unknown>(null);
  const loadConfig = useCallback(() => {
    fetchLibraryConfig(api).then((c) => {
      setConfig(c);
      setConfigError(null);
    }, setConfigError);
  }, [api]);
  useEffect(loadConfig, [loadConfig]);

  const enabled = config?.enabled === true;
  const list = useLibraryItems(enabled);
  const jobs = useUploads();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  const subsInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const target = useRef<LibraryItem | null>(null);
  const limits = limitsOrDefault(config?.limits ?? null);

  const fail = useCallback((err: unknown) => {
    toast.error(translateServerError(t, err, LIBRARY_SERVER_ERRORS));
  }, [t]);
  const { refresh } = list;
  const startOptions = useCallback(() => ({
    chunkBytes: limits.chunkBytes,
    onDone: () => {
      toast.success(t("web.library.toast.uploadDone"));
      void refresh().catch(() => {});
      loadConfig();
    },
  }), [limits.chunkBytes, t, refresh, loadConfig]);

  if (configError && !config) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title={t("web.library.title")} />
        <PageError message={translateServerError(t, configError, LIBRARY_SERVER_ERRORS)} onRetry={loadConfig} />
      </div>
    );
  }
  if (!config) return <PageLoading />;
  if (!enabled) return <Navigate to="/practice" replace />;

  const onUpload = (input: UploadInput) => {
    setSheetOpen(false);
    uploads.start(api, input, startOptions());
  };
  const onImported = (item: LibraryItem) => {
    setSheetOpen(false);
    list.replace(item);
    toast.success(t("web.library.toast.imported"));
  };
  const confirmDelete = async () => {
    const item = pendingDelete;
    setPendingDelete(null);
    if (!item) return;
    try {
      await deleteItem(api, item.id);
      list.remove(item.id);
      toast.success(t("web.library.toast.deleted"));
      loadConfig();
    } catch (err) {
      fail(err);
    }
  };
  const onRetry = (item: LibraryItem) => {
    retryItem(api, item.id).then((next) => {
      list.replace(next);
      toast(t("web.library.toast.retrying"));
    }, fail);
  };
  const onAddSubtitles = (item: LibraryItem) => {
    target.current = item;
    subsInput.current?.click();
  };
  const onSubtitlesChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const item = target.current;
    if (!file || !item) return;
    if (!(SUBTITLE_FORMATS as readonly string[]).includes(extOf(file.name))) {
      toast.error(t("web.library.upload.subtitleBadType"));
      return;
    }
    if (file.size > MAX_SUBTITLE_BYTES) {
      toast.error(t("web.library.upload.subtitleTooLarge"));
      return;
    }
    putItemSubtitles(api, item.id, file, file.name).then((next) => {
      list.replace(next);
      toast.success(t("web.library.toast.subtitlesSaved"));
    }, fail);
  };
  const onResumeUpload = (item: LibraryItem) => {
    target.current = item;
    resumeInput.current?.click();
  };
  const onResumeChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const item = target.current;
    if (!file || !item) return;
    const remembered = uploads.rememberedName(item.id);
    if (remembered && remembered !== file.name) {
      toast.error(t("web.library.resume.mismatch"));
      return;
    }
    let key = "";
    key = uploads.start(api, { file, filename: file.name, title: item.title }, {
      ...startOptions(),
      resumeItemId: item.id,
      onError: (err) => {
        if (err instanceof UploadMismatchError) {
          uploads.dismiss(key);
          toast.error(t("web.library.resume.mismatch"));
        }
      },
    });
  };
  const onCancelUpload = (job: UploadJob) => {
    void uploads.cancel(api, job.key).then(() => {
      if (job.itemId) list.remove(job.itemId);
      loadConfig();
    });
  };

  const handlers = {
    onDelete: setPendingDelete,
    onRetry,
    onAddSubtitles,
    onResumeUpload,
    onCancelUpload,
    onRetryUpload: (job: UploadJob) => { uploads.retry(api, job.key, startOptions()); },
    onDismissUpload: (job: UploadJob) => uploads.dismiss(job.key),
  };
  const shownIds = new Set(list.items.map((i) => i.id));
  const jobByItem = new Map(jobs.filter((j) => j.itemId).map((j) => [j.itemId as string, j]));
  const looseJobs = jobs.filter((j) => !j.itemId || !shownIds.has(j.itemId));
  const formats = limits.formats.length ? limits.formats : [...LIBRARY_FORMATS];
  const usedBytes = limits.usedBytes;
  const quotaBytes = limits.quotaMb * MIB;
  const usedShare = quotaBytes > 0 ? Math.min(1, usedBytes / quotaBytes) : 0;
  const empty = list.items.length === 0 && jobs.length === 0;

  return (
    <LibraryRoot>
      {/* 标签根页:没有返回键(R-L34);顶栏沿用全站 PageHeader(滚动后才变玻璃) */}
      <PageHeader title={t("web.library.title")} />
      <div data-testid="library-usage" className="lib-quota">
        <span className="num">
          {t("web.library.usedLabel")} <CountUp to={usedBytes} format={formatBytes} /> / {formatBytes(quotaBytes)}
        </span>
        <div aria-hidden className="lib-quota-bar"><div className="lib-quota-fill" style={{ "--p": usedShare } as CSSProperties} /></div>
      </div>
      <div className="px-gutter pb-24">
        {list.error && empty ? (
          <PageError message={translateServerError(t, list.error, LIBRARY_SERVER_ERRORS)} onRetry={() => void list.reload()} />
        ) : list.loading && empty ? (
          <PageLoading />
        ) : empty ? (
          <PageNote>{t("web.library.empty")}</PageNote>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="library-list">
            {looseJobs.map((job, i) => <ItemCard key={job.key} item={null} job={job} index={i} {...handlers} />)}
            {list.items.map((item, i) => <ItemCard key={item.id} item={item} job={jobByItem.get(item.id)} index={looseJobs.length + i} {...handlers} />)}
          </ul>
        )}
        {list.nextCursor ? (
          <button type="button" disabled={list.loadingMore} onClick={() => void list.loadMore()} className={`${GHOST} mt-3 h-11 w-full`}>
            {t("web.common.loadMore")}
          </button>
        ) : null}
      </div>
      <div className="lib-fab">
        <button type="button" data-testid="library-add" aria-label={t("web.library.add")} className={`${PRIMARY} h-12 px-5`} onClick={() => setSheetOpen(true)}>
          <PlusIcon aria-hidden />{t("web.library.addShort")}
        </button>
      </div>
      <input ref={subsInput} type="file" accept=".srt,.vtt" hidden data-testid="library-subtitles-input" onChange={onSubtitlesChosen} />
      <input ref={resumeInput} type="file" accept={["audio/*", "video/*", ...formats.map((f) => `.${f}`)].join(",")} hidden
        data-testid="library-resume-input" onChange={onResumeChosen} />
      <AddSheet open={sheetOpen} onOpenChange={setSheetOpen} config={config} onUpload={onUpload} onImported={onImported} />
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sub text-ink-2">{t("web.library.confirmDelete.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 rounded-button" onClick={() => void confirmDelete()}>
              {t("web.library.confirmDelete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LibraryRoot>
  );
}
```

注意 hooks 顺序:所有 hook(含 `useCallback` 的 `startOptions`)都在三个提前 `return` 之前。

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/library-list-page.test.tsx src/features/library/item-card.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library list page with uploads, retry, subtitles and delete

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 评审波** — `/code-review high`(L4–L9 的改动);修复后单独提交 `fix(web): …`。

---

## Task L10: 播放控制器(循环、速度、跳句;R-L13)

**Files:**
- Create: `web/src/features/library/use-media-player.ts`、`use-media-player.test.ts`

**Interfaces:**
- Produces:`PAD_BEFORE_MS`(150)、`PAD_AFTER_MS`(250)、`RATES`、`Rate`、`LoopMode`、`LOOP_MODES`、`Seg`、`MediaLike`、`Frames`、`PlayerState`、`segmentIndexAt(segs, ms)`、`rateFromPct(pct)`、`pctFromRate(rate)`、`nextLoop(mode)`、`nextRate(rate)`、`applyRate(media, rate)`、`PlayerController`(`getState`、`subscribe`、`setSegments`、`seekTo(idx, play?)`、`playOnce(idx)`、`play()`、`pause()`、`toggle()`、`prev()`、`next()`、`setLoop(mode)`、`setRate(rate)`、`restore(ms, idx)`、`currentMs()`、`tick()`、`destroy()`)、`PlayerHandle`、`useMediaPlayer(media, segments, init) → { controller, state }`

- [ ] **Step 1: 写失败测试** — `web/src/features/library/use-media-player.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  PAD_AFTER_MS, PlayerController, nextLoop, nextRate, pctFromRate, rateFromPct, segmentIndexAt, type Frames,
} from "./use-media-player";

const SEGS = [
  { idx: 0, startMs: 1000, endMs: 3000 },
  { idx: 1, startMs: 3200, endMs: 6000 },
  { idx: 2, startMs: 9000, endMs: 11000 },
];

/** 假的媒体元素:currentTime 的写入记为一次 seek;advanceTo 模拟播放推进(不算 seek)。 */
class FakeMedia extends EventTarget {
  private t = 0;
  seeks: number[] = [];
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
  get currentTime() { return this.t; }
  set currentTime(v: number) { this.t = v; this.seeks.push(v); }
  advanceTo(ms: number) { this.t = ms / 1000; }
  play = vi.fn((): Promise<void> => {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
}

function manualFrames() {
  const queue = new Map<number, () => void>();
  let id = 0;
  const frames: Frames & { flush(): void; size(): number } = {
    request: (fn) => { id += 1; queue.set(id, fn); return id; },
    cancel: (n) => { queue.delete(n); },
    flush: () => { const fns = [...queue.values()]; queue.clear(); fns.forEach((f) => f()); },
    size: () => queue.size,
  };
  return frames;
}

function setup(init: { rate?: 0.5 | 0.75 | 1 | 1.25; index?: number } = {}) {
  const media = new FakeMedia();
  const frames = manualFrames();
  const c = new PlayerController(media, SEGS, frames, init);
  const at = (ms: number) => { media.advanceTo(ms); frames.flush(); };
  return { media, frames, c, at };
}

describe("pure helpers", () => {
  it("finds the sentence whose start is the last one at or before the time", () => {
    expect(segmentIndexAt(SEGS, 0)).toBe(-1);
    expect(segmentIndexAt(SEGS, 1000)).toBe(0);
    expect(segmentIndexAt(SEGS, 3100)).toBe(0);
    expect(segmentIndexAt(SEGS, 3200)).toBe(1);
    expect(segmentIndexAt(SEGS, 99_999)).toBe(2);
    expect(segmentIndexAt([], 5)).toBe(-1);
  });

  it("maps rate_pct to the nearest rate and cycles loops and rates", () => {
    expect(rateFromPct(100)).toBe(1);
    expect(rateFromPct(50)).toBe(0.5);
    expect(rateFromPct(80)).toBe(0.75);
    expect(rateFromPct(200)).toBe(1.25);
    expect(rateFromPct(null)).toBe(1);
    expect(pctFromRate(0.75)).toBe(75);
    expect(["off", "infinite", 3, 5, "off"].slice(1)).toEqual([nextLoop("off"), nextLoop("infinite"), nextLoop(3), nextLoop(5)]);
    expect([nextRate(0.5), nextRate(0.75), nextRate(1), nextRate(1.25)]).toEqual([0.75, 1, 1.25, 0.5]);
  });
});

describe("PlayerController (spec §11.4, R-L13)", () => {
  it("applies the initial rate with pitch preserved and changes it later", () => {
    const { media, c } = setup({ rate: 0.75 });
    expect(media.playbackRate).toBe(0.75);
    expect(media.defaultPlaybackRate).toBe(0.75);
    expect(media.preservesPitch).toBe(true);
    expect(media.webkitPreservesPitch).toBe(true);
    c.setRate(1.25);
    expect(media.playbackRate).toBe(1.25);
    expect(c.getState().rate).toBe(1.25);
  });

  it("seeks 150 ms before a sentence (never below 0) and plays", () => {
    const { media, c } = setup();
    c.seekTo(1);
    expect(media.seeks).toEqual([3.05]);
    expect(media.play).toHaveBeenCalled();
    expect(c.getState()).toMatchObject({ index: 1, playing: true });
    c.seekTo(0, false);
    expect(media.seeks.at(-1)).toBeCloseTo(0.85);
    c.seekTo(99);
    expect(media.seeks).toHaveLength(2);
  });

  it("with loop off follows the time naturally", () => {
    const { c, at } = setup();
    c.seekTo(0);
    at(2000);
    expect(c.getState().index).toBe(0);
    at(3300);
    expect(c.getState().index).toBe(1);
    at(9500);
    expect(c.getState().index).toBe(2);
  });

  it("loops one sentence forever 250 ms after its end", () => {
    const { media, c, at } = setup();
    c.setLoop("infinite");
    c.seekTo(0);
    at(3000 + PAD_AFTER_MS - 1);
    expect(media.seeks).toHaveLength(1);
    for (let i = 1; i <= 3; i += 1) {
      at(3000 + PAD_AFTER_MS);
      expect(media.seeks).toHaveLength(1 + i);
      expect(media.seeks.at(-1)).toBeCloseTo(0.85);
      expect(c.getState()).toMatchObject({ index: 0, repeats: i });
    }
  });

  it("plays each sentence 3 times, then moves on and repeats the next one too", () => {
    const { media, c, at } = setup();
    c.setLoop(3);
    c.seekTo(0);
    at(3250);
    at(3250);
    expect(media.seeks).toHaveLength(3);
    at(3300);
    expect(c.getState()).toMatchObject({ index: 1, repeats: 0 });
    expect(media.seeks).toHaveLength(3);
    at(6250);
    expect(media.seeks.at(-1)).toBeCloseTo(3.05);
    expect(c.getState()).toMatchObject({ index: 1, repeats: 1 });
  });

  it("does not jump back again inside the gap after a loop has finished", () => {
    const { media, c, at } = setup();
    c.setLoop(3);
    c.seekTo(1);
    at(6250);
    at(6250);
    at(6250);
    const seeks = media.seeks.length;
    at(7000);
    at(8000);
    expect(media.seeks).toHaveLength(seeks);
    expect(c.getState().index).toBe(1);
    at(9100);
    expect(c.getState().index).toBe(2);
  });

  it("plays one sentence once and pauses after it (W2's 'original')", () => {
    const { media, c, at } = setup();
    c.playOnce(1);
    expect(c.getState().once).toBe(true);
    at(6249);
    expect(media.pause).not.toHaveBeenCalled();
    at(6250);
    expect(media.pause).toHaveBeenCalled();
    expect(c.getState()).toMatchObject({ once: false, playing: false });
  });

  it("schedules frames only while playing", () => {
    const { frames, c } = setup();
    expect(frames.size()).toBe(0);
    c.seekTo(0);
    expect(frames.size()).toBe(1);
    c.pause();
    expect(frames.size()).toBe(0);
  });

  it("stays paused when the browser refuses to play", async () => {
    const { media, c } = setup();
    media.play.mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")));
    c.seekTo(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState().playing).toBe(false);
  });

  it("restores a saved position and guards prev / next at the ends", () => {
    const { media, c } = setup();
    c.restore(4000, 1);
    expect(media.currentTime).toBe(4);
    expect(c.getState().index).toBe(1);
    c.restore(9500, 99);
    expect(c.getState().index).toBe(2);
    c.next();
    expect(c.getState().index).toBe(2);
    c.seekTo(0, false);
    c.prev();
    expect(c.getState().index).toBe(0);
    expect(c.currentMs()).toBe(850);
  });

  it("notifies subscribers and stops listening after destroy", () => {
    const { media, c } = setup();
    const fn = vi.fn();
    const off = c.subscribe(fn);
    c.setLoop(5);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    c.destroy();
    media.dispatchEvent(new Event("play"));
    expect(c.getState().playing).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/use-media-player.test.ts`。

- [ ] **Step 3: 实现** — `web/src/features/library/use-media-player.ts`:

```ts
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** 播放缓冲(spec §6.3 第 6 条):提前 150 ms 开始,延后 250 ms 才算这句结束。只在网页端,不进库。 */
export const PAD_BEFORE_MS = 150;
export const PAD_AFTER_MS = 250;
/** 库自己的速度档位(不碰全局 PLAYBACK_RATES,那是给 TTS 的;spec §11.4)。 */
export const RATES = [0.5, 0.75, 1, 1.25] as const;
export type Rate = (typeof RATES)[number];
export type LoopMode = "off" | "infinite" | 3 | 5;
export const LOOP_MODES: readonly LoopMode[] = ["off", "infinite", 3, 5];

export interface Seg { idx: number; startMs: number; endMs: number }

/** 控制器需要的媒体元素能力;HTMLMediaElement 天然满足,测试用假的。 */
export interface MediaLike {
  currentTime: number;
  readonly paused: boolean;
  playbackRate: number;
  defaultPlaybackRate: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface Frames { request(fn: () => void): number; cancel(id: number): void }

export interface PlayerState {
  index: number;
  playing: boolean;
  loop: LoopMode;
  rate: Rate;
  /** 当前句已经回跳的次数(N 遍循环 = 首播 + N−1 次回跳)。 */
  repeats: number;
  /** 只播这一句,播完暂停(W2 的「听原句」)。 */
  once: boolean;
}

/** 起点 ≤ ms 的最后一句;都在 ms 之后则 −1。 */
export function segmentIndexAt(segs: readonly Seg[], ms: number): number {
  let lo = 0;
  let hi = segs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function rateFromPct(pct: number | null | undefined): Rate {
  const want = (pct ?? 100) / 100;
  return RATES.reduce<Rate>((best, r) => (Math.abs(r - want) < Math.abs(best - want) ? r : best), 1);
}

export const pctFromRate = (rate: Rate): number => Math.round(rate * 100);

export function nextLoop(mode: LoopMode): LoopMode {
  return LOOP_MODES[(LOOP_MODES.indexOf(mode) + 1) % LOOP_MODES.length];
}

export function nextRate(rate: Rate): Rate {
  return RATES[(RATES.indexOf(rate) + 1) % RATES.length];
}

/** 速度:playbackRate 与 defaultPlaybackRate 都设(换 src 后 load 会回到 default),并保持音高。 */
export function applyRate(media: MediaLike, rate: Rate): void {
  const m = media as MediaLike & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
  try {
    m.preservesPitch = true;
    m.webkitPreservesPitch = true;
    media.defaultPlaybackRate = rate;
    media.playbackRate = rate;
  } catch {
    /* 浏览器不支持该倍速:保持原速 */
  }
}

const startOf = (seg: Seg) => Math.max(0, seg.startMs - PAD_BEFORE_MS) / 1000;

/**
 * 与 React 无关的播放控制器(R-L13):播放中用 requestAnimationFrame 轮询 currentTime(timeupdate 只有约 250 ms 粒度),
 * 实现单句循环 / N 遍循环 / 只播一句,并跟踪当前句。
 */
export class PlayerController {
  private state: PlayerState;
  private frame: number | null = null;
  /** 循环已结束的那一句:在它与下一句之间的空隙里不再回跳。 */
  private released = -1;
  private readonly listeners = new Set<() => void>();
  private readonly onPlay = () => {
    this.patch({ playing: true });
    this.schedule();
  };
  private readonly onPause = () => {
    this.patch({ playing: false });
    this.stopFrames();
  };

  constructor(private readonly media: MediaLike, private segs: readonly Seg[], private readonly frames: Frames,
    init: { rate?: Rate; index?: number } = {}) {
    const index = init.index !== undefined && segs[init.index] ? init.index : segs.length ? 0 : -1;
    this.state = { index, playing: !media.paused, loop: "off", rate: init.rate ?? 1, repeats: 0, once: false };
    applyRate(media, this.state.rate);
    media.addEventListener("play", this.onPlay);
    media.addEventListener("pause", this.onPause);
    media.addEventListener("ended", this.onPause);
    if (!media.paused) this.schedule();
  }

  readonly getState = (): PlayerState => this.state;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  destroy(): void {
    this.stopFrames();
    this.media.removeEventListener("play", this.onPlay);
    this.media.removeEventListener("pause", this.onPause);
    this.media.removeEventListener("ended", this.onPause);
    this.listeners.clear();
  }

  /** 句子起止被 W2 微调后换上新的列表。 */
  setSegments(segs: readonly Seg[]): void {
    this.segs = segs;
  }

  currentMs(): number {
    return Math.round(this.media.currentTime * 1000);
  }

  private patch(p: Partial<PlayerState>): void {
    this.state = { ...this.state, ...p };
    for (const l of [...this.listeners]) l();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = this.frames.request(() => {
      this.frame = null;
      this.tick();
      if (!this.media.paused) this.schedule();
    });
  }

  private stopFrames(): void {
    if (this.frame !== null) this.frames.cancel(this.frame);
    this.frame = null;
  }

  /** 每帧一次:先处理当前句的循环 / 只播一句,再按时间推进当前句。 */
  tick(): void {
    const ms = this.media.currentTime * 1000;
    const { index, loop, once, repeats } = this.state;
    const seg = this.segs[index];
    const pinned = !!seg && (once || (loop !== "off" && this.released !== index));
    if (pinned && seg) {
      if (ms < seg.endMs + PAD_AFTER_MS) return;
      if (once) {
        this.patch({ once: false });
        this.media.pause();
        return;
      }
      const total = loop === "infinite" ? Number.POSITIVE_INFINITY : (loop as number);
      if (repeats + 1 < total) {
        this.patch({ repeats: repeats + 1 });
        this.media.currentTime = startOf(seg);
        return;
      }
      this.released = index;
    }
    const natural = segmentIndexAt(this.segs, ms);
    if (natural !== -1 && natural !== index) {
      this.released = -1;
      this.patch({ index: natural, repeats: 0 });
    }
  }

  play(): void {
    try {
      const result = this.media.play();
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => this.patch({ playing: false }));
      }
    } catch {
      this.patch({ playing: false });
    }
  }

  pause(): void {
    this.media.pause();
  }

  toggle(): void {
    if (this.media.paused) this.play();
    else this.pause();
  }

  seekTo(idx: number, play = true): void {
    const seg = this.segs[idx];
    if (!seg) return;
    this.released = -1;
    this.patch({ index: idx, repeats: 0, once: false });
    this.media.currentTime = startOf(seg);
    if (play) this.play();
  }

  playOnce(idx: number): void {
    if (!this.segs[idx]) return;
    this.seekTo(idx, false);
    this.patch({ once: true });
    this.play();
  }

  prev(): void {
    this.seekTo(Math.max(0, this.state.index - 1));
  }

  next(): void {
    this.seekTo(Math.min(this.segs.length - 1, this.state.index + 1));
  }

  setLoop(loop: LoopMode): void {
    this.released = -1;
    this.patch({ loop, repeats: 0 });
  }

  setRate(rate: Rate): void {
    applyRate(this.media, rate);
    this.patch({ rate });
  }

  /** 续播(R-L14):跳到保存的位置;保存的句号无效时按时间找。 */
  restore(ms: number, idx: number): void {
    this.media.currentTime = Math.max(0, ms) / 1000;
    const byTime = segmentIndexAt(this.segs, ms);
    const index = this.segs[idx] && idx >= byTime ? idx : byTime >= 0 ? byTime : this.segs.length ? 0 : -1;
    this.released = -1;
    this.patch({ index, repeats: 0 });
  }
}

/** W2 的跟读面板能用的播放能力(R-L16)。 */
export type PlayerHandle = Pick<PlayerController, "pause" | "playOnce" | "seekTo" | "getState">;

const browserFrames: Frames = {
  request: (fn) => requestAnimationFrame(() => fn()),
  cancel: (id) => cancelAnimationFrame(id),
};
const NO_SUBSCRIBE = () => () => {};
const NO_STATE = (): PlayerState | null => null;

/** 把控制器接到真实的 <video>/<audio>(callback ref 得到的元素)。 */
export function useMediaPlayer(media: MediaLike | null, segments: readonly Seg[], init: { rate: Rate; index: number }) {
  const [controller, setController] = useState<PlayerController | null>(null);
  const initRef = useRef(init);
  initRef.current = init;
  const segRef = useRef(segments);
  segRef.current = segments;
  useEffect(() => {
    if (!media) return;
    const c = new PlayerController(media, segRef.current, browserFrames, initRef.current);
    setController(c);
    return () => {
      c.destroy();
      setController(null);
    };
  }, [media]);
  useEffect(() => {
    controller?.setSegments(segments);
  }, [controller, segments]);
  const state = useSyncExternalStore<PlayerState | null>(
    controller ? controller.subscribe : NO_SUBSCRIBE,
    controller ? controller.getState : NO_STATE,
    controller ? controller.getState : NO_STATE,
  );
  return { controller, state };
}
```

`restore(9500, 99)`:按时间 = 2;`restore(4000, 1)`:按时间 = 1、保存的 1 ≥ 1 → 1。保存的句号比按时间算的更早(用户在句间空隙暂停过)时以时间为准。

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/use-media-player.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library player controller with sentence loops and rates

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L11: 续播保存(R-L14)

**Files:**
- Create: `web/src/features/library/resume.ts`、`resume.test.tsx`

**Interfaces:**
- Consumes:L1 `patchItem`;`~/api/auth-storage` 的 `loadAuth`
- Produces:`RESUME_INTERVAL_MS`、`ResumePoint`、`createResumeSaver(save, opts?)`、`sendResumeKeepalive(itemId, point, token, fetchImpl?)`、`ResumeSource`、`useResume(itemId, player, opts?)`

- [ ] **Step 1: 写失败测试** — `web/src/features/library/resume.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { createResumeSaver, sendResumeKeepalive, useResume, type ResumeSource } from "./resume";
import type { PlayerState } from "./use-media-player";

describe("createResumeSaver", () => {
  it("saves at most every 5 s and never right after opening", () => {
    let now = 0;
    const save = vi.fn();
    const saver = createResumeSaver(save, { now: () => now, initial: { resumeMs: 0, resumeIdx: 0 } });
    now = 1000;
    saver.note({ resumeMs: 1000, resumeIdx: 0 });
    expect(save).not.toHaveBeenCalled();
    now = 5000;
    saver.note({ resumeMs: 5000, resumeIdx: 1 });
    expect(save).toHaveBeenCalledWith({ resumeMs: 5000, resumeIdx: 1 }, false);
    now = 6000;
    saver.note({ resumeMs: 6000.4, resumeIdx: 1 });
    expect(save).toHaveBeenCalledTimes(1);
    saver.flush(true);
    expect(save).toHaveBeenLastCalledWith({ resumeMs: 6000, resumeIdx: 1 }, true);
    saver.flush(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not resend the position it was opened with", () => {
    const save = vi.fn();
    const saver = createResumeSaver(save, { initial: { resumeMs: 4000, resumeIdx: 2 } });
    saver.note({ resumeMs: 4000, resumeIdx: 2 });
    saver.flush(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("sendResumeKeepalive", () => {
  it("PATCHes with keepalive and the bearer token, nothing in the query", () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    sendResumeKeepalive("a/b", { resumeMs: 12_000, resumeIdx: 3 }, "tok", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/library/items/a%2Fb");
    expect(init).toMatchObject({ method: "PATCH", keepalive: true });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ resume_ms: 12_000, resume_idx: 3 });
  });

  it("does nothing without a token and swallows a throwing fetch", () => {
    const fetchImpl = vi.fn(() => { throw new Error("boom"); });
    sendResumeKeepalive("i1", { resumeMs: 1, resumeIdx: 0 }, null, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => sendResumeKeepalive("i1", { resumeMs: 1, resumeIdx: 0 }, "tok", fetchImpl as unknown as typeof fetch)).not.toThrow();
  });
});

describe("useResume (R-L14)", () => {
  let state: PlayerState;
  let ms: number;
  const subs = new Set<() => void>();
  const player: ResumeSource = { getState: () => state, subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, currentMs: () => ms };
  const emit = () => subs.forEach((fn) => fn());

  beforeEach(() => {
    vi.useFakeTimers();
    state = { index: 0, playing: false, loop: "off", rate: 1, repeats: 0, once: false };
    ms = 0;
    subs.clear();
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const mock = createFetchMock({ "PATCH /api/library/items/i1": () => json({}) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const keep = vi.fn(async () => new Response(null));
    const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
    const hook = renderHook(() => useResume("i1", player, {
      initial: { resumeMs: 0, resumeIdx: 0 }, getToken: () => "tok", fetchImpl: keep as unknown as typeof fetch,
    }), { wrapper });
    return { mock, keep, ...hook };
  }

  it("saves every 5 s while playing and at once on pause", async () => {
    const { mock } = setup();
    state = { ...state, playing: true };
    emit();
    ms = 4000;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mock.calls).toHaveLength(1);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ resume_ms: 4000, resume_idx: 0 });
    ms = 7000;
    state = { ...state, playing: false, index: 1 };
    await act(async () => { emit(); await vi.advanceTimersByTimeAsync(0); });
    expect(mock.calls).toHaveLength(2);
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ resume_ms: 7000, resume_idx: 1 });
  });

  it("uses keepalive when the page is hidden and when leaving", () => {
    const { keep, unmount } = setup();
    ms = 3000;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(keep).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    ms = 3500;
    unmount();
    expect(keep).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/resume.test.tsx`。

- [ ] **Step 3: 实现** — `web/src/features/library/resume.ts`:

```ts
import { useEffect, useRef } from "react";
import { loadAuth } from "~/api/auth-storage";
import { useAuth } from "~/auth/auth-context";
import { patchItem } from "./library-api";
import type { PlayerState } from "./use-media-player";

/** 播放中保存续播位置的最短间隔(spec §11.4)。 */
export const RESUME_INTERVAL_MS = 5000;

export interface ResumePoint { resumeMs: number; resumeIdx: number }

const same = (a: ResumePoint | null, b: ResumePoint | null) => !!a && !!b && a.resumeMs === b.resumeMs && a.resumeIdx === b.resumeIdx;

/** 节流的保存器:note 记录最新位置,距上次保存 ≥ 间隔才发;flush 立即发(位置没变则不发)。 */
export function createResumeSaver(
  save: (point: ResumePoint, keepalive: boolean) => void,
  opts: { now?: () => number; intervalMs?: number; initial?: ResumePoint } = {},
) {
  const now = opts.now ?? Date.now;
  const interval = opts.intervalMs ?? RESUME_INTERVAL_MS;
  let latest: ResumePoint | null = null;
  let sent: ResumePoint | null = opts.initial ?? null;
  let lastAt = now();
  const send = (keepalive: boolean) => {
    if (!latest || same(latest, sent)) return;
    sent = latest;
    lastAt = now();
    save(latest, keepalive);
  };
  return {
    note(point: ResumePoint): void {
      latest = { resumeMs: Math.max(0, Math.round(point.resumeMs)), resumeIdx: Math.max(0, Math.round(point.resumeIdx)) };
      if (now() - lastAt >= interval) send(false);
    },
    flush(keepalive = false): void {
      send(keepalive);
    },
  };
}

/** 页面隐藏 / 离开时的保存:ApiClient 没有 keepalive,sendBeacon 带不了 Bearer,所以直接 fetch(R-L14)。 */
export function sendResumeKeepalive(itemId: string, point: ResumePoint, token: string | null, fetchImpl: typeof fetch = fetch): void {
  if (!token) return;
  try {
    void fetchImpl(`/api/library/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ resume_ms: point.resumeMs, resume_idx: point.resumeIdx }),
    }).catch(() => {});
  } catch {
    /* 离开页面时的尽力而为 */
  }
}

export type ResumeSource = { getState(): PlayerState; subscribe(fn: () => void): () => void; currentMs(): number };

/** 接线:每秒采样,播放中 ≥ 5 s 保存一次;暂停立即保存;隐藏 / pagehide / 卸载用 keepalive。 */
export function useResume(itemId: string, player: ResumeSource | null, opts: {
  initial?: ResumePoint; getToken?: () => string | null; fetchImpl?: typeof fetch; sampleMs?: number;
} = {}): void {
  const { api } = useAuth();
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!player) return;
    const o = optsRef.current;
    const getToken = o.getToken ?? (() => loadAuth()?.token ?? null);
    const saver = createResumeSaver((point, keepalive) => {
      if (keepalive) sendResumeKeepalive(itemId, point, getToken(), o.fetchImpl);
      else void patchItem(api, itemId, point).catch(() => {});
    }, { initial: o.initial });
    const point = (): ResumePoint => ({ resumeMs: player.currentMs(), resumeIdx: Math.max(0, player.getState().index) });
    let wasPlaying = player.getState().playing;
    const unsubscribe = player.subscribe(() => {
      const playing = player.getState().playing;
      if (wasPlaying && !playing) {
        saver.note(point());
        saver.flush(false);
      }
      wasPlaying = playing;
    });
    const timer = setInterval(() => {
      if (player.getState().playing) saver.note(point());
    }, o.sampleMs ?? 1000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        saver.note(point());
        saver.flush(true);
      }
    };
    const onPageHide = () => {
      saver.note(point());
      saver.flush(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      saver.note(point());
      saver.flush(true);
    };
  }, [api, itemId, player]);
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/resume.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): throttled resume position saving with keepalive on leave

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L12: 媒体票据与过期换票(R-L15)

**Files:**
- Create: `web/src/features/library/use-media-source.ts`、`use-media-source.test.tsx`

**Interfaces:**
- Consumes:L1 `mediaTicket`
- Produces:`MAX_TICKET_REFRESHES`(2)、`MediaSourceTarget`、`useMediaSource(itemId, enabled, media) → { url, error, retry }`

- [ ] **Step 1: 写失败测试** — `web/src/features/library/use-media-source.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { useMediaSource, type MediaSourceTarget } from "./use-media-source";

class FakeEl extends EventTarget {
  currentTime = 0;
  paused = true;
  play = vi.fn(async () => { this.paused = false; });
}

function setup(enabled = true) {
  let n = 0;
  const mock = createFetchMock({
    "POST /api/library/items/i1/media-ticket": () => { n += 1; return json({ url: `/api/library/items/i1/media?ticket=t${n}`, expires_in: 1800 }); },
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const el = new FakeEl();
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const hook = renderHook(({ on }) => useMediaSource("i1", on, el as unknown as MediaSourceTarget), { wrapper, initialProps: { on: enabled } });
  return { mock, el, ...hook };
}

describe("useMediaSource (spec §10, R-L15)", () => {
  it("asks for a ticket only when enabled", async () => {
    const { mock, result, rerender } = setup(false);
    expect(result.current.url).toBeNull();
    expect(mock.calls).toHaveLength(0);
    rerender({ on: true });
    await waitFor(() => expect(result.current.url).toBe("/api/library/items/i1/media?ticket=t1"));
  });

  it("gets a fresh ticket after a media error and restores time and playback", async () => {
    const { el, result } = setup();
    await waitFor(() => expect(result.current.url).toContain("t1"));
    el.currentTime = 12.5;
    el.paused = false;
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.url).toContain("t2"));
    el.currentTime = 0;
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    expect(el.currentTime).toBe(12.5);
    expect(el.play).toHaveBeenCalled();
  });

  it("gives up after two refreshes without playback in between, and retry starts over", async () => {
    const { el, mock, result } = setup();
    await waitFor(() => expect(result.current.url).toContain("t1"));
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.url).toContain("t2"));
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.url).toContain("t3"));
    act(() => { el.dispatchEvent(new Event("error")); });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(mock.calls).toHaveLength(3);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.url).toContain("t4"));
    expect(result.current.error).toBeNull();
  });

  it("a successful 'playing' resets the refresh budget", async () => {
    const { el, mock, result } = setup();
    await waitFor(() => expect(result.current.url).toContain("t1"));
    for (let i = 0; i < 3; i += 1) {
      act(() => { el.dispatchEvent(new Event("error")); });
      await waitFor(() => expect(mock.calls).toHaveLength(i + 2));
      act(() => { el.dispatchEvent(new Event("playing")); });
    }
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/use-media-source.test.tsx`。

- [ ] **Step 3: 实现** — `web/src/features/library/use-media-source.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { mediaTicket } from "./library-api";

/** 连续换票的上限(中间没有成功播放就停,R-L15)。 */
export const MAX_TICKET_REFRESHES = 2;

export type MediaSourceTarget = Pick<HTMLMediaElement, "currentTime" | "paused" | "play" | "addEventListener" | "removeEventListener">;

/**
 * 媒体地址 = 服务端签发的同源票据 URL(spec E4;`<video>` 发不了 Bearer)。媒体元素报 error(多半是票据过期)
 * 时重新取票,新地址加载出元数据后恢复时间与播放状态。票据 URL 只交给 src,不打印。
 */
export function useMediaSource(itemId: string, enabled: boolean, media: MediaSourceTarget | null) {
  const { api } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refreshes = useRef(0);
  const pending = useRef<{ at: number; play: boolean } | null>(null);

  const fetchTicket = useCallback(async () => {
    try {
      const ticket = await mediaTicket(api, itemId);
      setError(null);
      setUrl(ticket.url);
    } catch (err) {
      setError(err);
    }
  }, [api, itemId]);

  useEffect(() => {
    if (enabled) void fetchTicket();
  }, [enabled, fetchTicket]);

  useEffect(() => {
    if (!media) return;
    const onError = () => {
      if (refreshes.current >= MAX_TICKET_REFRESHES) {
        setError(new Error("media"));
        return;
      }
      refreshes.current += 1;
      pending.current = { at: media.currentTime, play: !media.paused };
      void fetchTicket();
    };
    const onLoaded = () => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      media.currentTime = p.at;
      if (p.play) void Promise.resolve(media.play()).catch(() => {});
    };
    const onPlaying = () => {
      refreshes.current = 0;
    };
    media.addEventListener("error", onError);
    media.addEventListener("loadedmetadata", onLoaded);
    media.addEventListener("playing", onPlaying);
    return () => {
      media.removeEventListener("error", onError);
      media.removeEventListener("loadedmetadata", onLoaded);
      media.removeEventListener("playing", onPlaying);
    };
  }, [media, fetchTicket]);

  const retry = useCallback(() => {
    refreshes.current = 0;
    setError(null);
    void fetchTicket();
  }, [fetchTicket]);

  return { url, error, retry };
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/use-media-source.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library media tickets with refresh on media errors

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L13: 句子列表、译文行与 W2 占位(R-L16、R-L17、R-L32)

**Files:**
- Create: `web/src/features/library/shadow-panel.tsx`(占位,之后归 W2)、`use-translations.ts`(占位,之后归 W2)、`use-translations.test.ts`、`use-translate-toggle.ts`、`use-translate-toggle.test.ts`、`segment-list.tsx`、`segment-list.test.tsx`

**Interfaces:**
- Produces:`ShadowPanelProps`、`ShadowPanel`、`SegmentTextProps`、`SegmentText`(R-L16 的确切签名);`UseTranslationsArgs`、`TranslationsState`、`useTranslations`(R-L32 的确切签名,占位);`translateKey`、`readTranslateOn`、`writeTranslateOn`、`useTranslateToggle`;`MANUAL_SCROLL_GRACE_MS`、`SegmentListProps`、`SegmentList`
- Consumes:L1 的 `LibrarySegment`、`zhFor`;LV 的 `fx/border-glow`、`fx/motion`;`library.css` 的 `.lib-segments` / `.lib-row` / `.lib-zh*`

- [ ] **Step 1: 写失败测试**

`web/src/features/library/segment-list.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "~/test/render";
import type { LibrarySegment } from "./library-api";
import { SegmentList } from "./segment-list";
import { setUiLanguage } from "./test-i18n";

const SEGS: LibrarySegment[] = [
  { idx: 0, startMs: 1000, endMs: 3000, text: "Hello there.", zh: "你好。", zhLang: "zh-CN" },
  { idx: 1, startMs: 3200, endMs: 6000, text: "How are you today?", zh: null, zhLang: null },
  { idx: 2, startMs: 9000, endMs: 11000, text: "Old note.", zh: "旧译文", zhLang: "es-ES" },
];
const NONE: ReadonlySet<number> = new Set();
const scrolls = vi.fn();

beforeEach(async () => {
  await setUiLanguage("zh-CN");
  scrolls.mockClear();
  Element.prototype.scrollIntoView = scrolls;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

type Props = Partial<Parameters<typeof SegmentList>[0]>;
function render(props: Props = {}) {
  const onSelect = vi.fn();
  const view = renderWithProviders(
    <SegmentList itemId="i1" segments={SEGS} current={0} blind={false} durationMs={12_000} player={null} native="zh-CN"
      showTranslation={false} pending={NONE} onSelect={onSelect} onSegmentSaved={vi.fn()} {...props} />,
  );
  return { onSelect, ...view };
}

describe("SegmentList (spec §11.4, R-L17)", () => {
  it("marks the current sentence, gives it the flowing border and scrolls it into view", () => {
    render({ current: 1 });
    expect(screen.getByTestId("segment-1")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("segment-1").className).toMatch(/\blib-glow\b/);
    expect(screen.getByTestId("segment-0")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("segment-0").className).not.toMatch(/lib-glow/);
    expect(scrolls).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("scrolls without animation when the system asks for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    render({ current: 1 });
    expect(scrolls).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("owns its scroll container, so the document and <main> never scroll (R-L33)", () => {
    render();
    const scroller = screen.getByTestId("library-segments");
    expect(scroller.className).toMatch(/\blib-segments\b/);
    expect(scroller.querySelector("ol")).not.toBeNull();
  });

  it("plays a sentence from its button or its text, but not while text is selected", () => {
    const { onSelect } = render();
    fireEvent.click(screen.getByRole("button", { name: "播放第 2 句" }));
    expect(onSelect).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByText("Hello there."));
    expect(onSelect).toHaveBeenLastCalledWith(0);
    const spy = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Hello" } as Selection);
    fireEvent.click(screen.getByText("Hello there."));
    expect(onSelect).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("keeps the sentence text selectable for the lookup bar", () => {
    render();
    expect(screen.getByText("Hello there.").closest(".lib-seg-text")).not.toBeNull();
  });

  it("hides the text in blind mode and reveals one sentence on tap", () => {
    render({ blind: true });
    expect(screen.queryByText("Hello there.")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "显示这句" })[0]);
    expect(screen.getByText("Hello there.")).toBeInTheDocument();
    expect(screen.queryByText("How are you today?")).toBeNull();
  });

  it("does not steal the scroll for 3 s after the user scrolls the list", () => {
    let now = 10_000;
    function Harness() {
      const [current, setCurrent] = useState(0);
      return (
        <>
          <button onClick={() => setCurrent((c) => (c === 0 ? 1 : 0))}>toggle</button>
          <SegmentList itemId="i1" segments={SEGS} current={current} blind={false} durationMs={12_000} player={null} native="zh-CN"
            showTranslation={false} pending={NONE} onSelect={vi.fn()} onSegmentSaved={vi.fn()} now={() => now} />
        </>
      );
    }
    renderWithProviders(<Harness />);
    scrolls.mockClear();
    fireEvent.wheel(screen.getByTestId("library-segments"));
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(scrolls).not.toHaveBeenCalled();
    now += 3001;
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(scrolls).toHaveBeenCalled();
  });

  it("renders the W2 placeholder panel as nothing and says so when there are no sentences", () => {
    render({ segments: [] });
    expect(screen.getByText("还没有句子。")).toBeInTheDocument();
  });
});

describe("translation line (D8, E11, E12, R-L32)", () => {
  it("shows nothing when the translate switch is off", () => {
    render();
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
  });

  it("shows a stored translation under its sentence in the learner's language, as small secondary text", () => {
    render({ showTranslation: true });
    const zh = screen.getByTestId("segment-zh-0");
    expect(zh).toHaveTextContent("你好。");
    expect(zh).toHaveAttribute("lang", "zh-CN");
    expect(zh.className).toMatch(/\blib-zh\b/);
    expect(screen.getByText("Hello there.").compareDocumentPosition(zh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("treats a translation made for another language as missing (E11)", () => {
    render({ showTranslation: true });
    expect(screen.queryByTestId("segment-zh-2")).toBeNull(); // 旧译文是西语的
    expect(screen.queryByTestId("segment-zh-skeleton-2")).toBeNull(); // 没在取,就什么也不画
  });

  it("shows a skeleton line for sentences being fetched", () => {
    render({ showTranslation: true, pending: new Set([1]) });
    expect(screen.getByTestId("segment-zh-skeleton-1").className).toMatch(/\blib-zh-skeleton\b/);
    expect(screen.queryByTestId("segment-zh-skeleton-0")).toBeNull(); // 已有译文的不画骨架
  });

  it("hides translations and skeletons in blind mode, and shows the translation again when a sentence is revealed", () => {
    render({ showTranslation: true, blind: true, pending: new Set([1]) });
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
    expect(screen.queryByTestId("segment-zh-skeleton-1")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "显示这句" })[0]);
    expect(screen.getByTestId("segment-zh-0")).toBeInTheDocument();
  });

  it("clicking the translation plays the sentence like clicking its text", () => {
    const { onSelect } = render({ showTranslation: true });
    fireEvent.click(screen.getByTestId("segment-zh-0"));
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });
});
```

`web/src/features/library/use-translate-toggle.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTranslateOn, translateKey, useTranslateToggle, writeTranslateOn } from "./use-translate-toggle";

beforeEach(() => localStorage.clear());

describe("translation toggle (D8, R-L32)", () => {
  it("is off by default and remembered per item on this device", () => {
    expect(readTranslateOn("a")).toBe(false);
    writeTranslateOn("a", true);
    expect(readTranslateOn("a")).toBe(true);
    expect(readTranslateOn("b")).toBe(false);
    expect(localStorage.getItem(translateKey("a"))).toBe("true");
    writeTranslateOn("a", false);
    expect(localStorage.getItem(translateKey("a"))).toBeNull();
  });

  it("stores nothing but the item id in the key and a boolean as the value", () => {
    writeTranslateOn("item-1", true);
    expect(Object.keys(localStorage)).toEqual(["enjoy-web.library.translate.item-1"]);
  });

  it("ignores a corrupt stored value", () => {
    localStorage.setItem(translateKey("a"), "banana");
    expect(readTranslateOn("a")).toBe(false);
  });

  it("works through a hook and survives unavailable storage", () => {
    const { result } = renderHook(() => useTranslateToggle("x"));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(readTranslateOn("x")).toBe(true);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => act(() => result.current[1](false))).not.toThrow();
    expect(result.current[0]).toBe(false);
    spy.mockRestore();
  });
});
```

`web/src/features/library/use-translations.test.ts`(占位的测试;W2 替换实现时连同它一起替换):

```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTranslations } from "./use-translations";

describe("use-translations placeholder (W2 replaces it, R-L32)", () => {
  it("is idle: nothing pending, no notice, and retry does nothing", () => {
    const { result } = renderHook(() =>
      useTranslations({ itemId: "i1", enabled: true, segments: [], anchorIdx: 0, native: "zh-CN", onTranslated: () => {} }));
    expect(result.current.pending.size).toBe(0);
    expect(result.current.notice).toBeNull();
    expect(() => result.current.retry()).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/segment-list.test.tsx src/features/library/use-translate-toggle.test.ts src/features/library/use-translations.test.ts`。

- [ ] **Step 3: 实现**

`web/src/features/library/shadow-panel.tsx`(与旧版相同,签名不变):

```tsx
import type { ReactElement } from "react";
import type { LibrarySegment } from "./library-api";
import type { PlayerHandle } from "./use-media-player";

/**
 * W2(跟读与评测)的接缝(spec §15;计划 R-L16)。W1 只放占位:`ShadowPanel` 不渲染任何东西,`SegmentText` 渲染纯文本。
 * **本文件之后归 W2**:W2 替换实现,但保持导出名与 props 不变(segment-list.tsx 依赖它们)。
 * - `ShadowPanel`:每句下方的跟读区(麦克风 / ⋯ 菜单 / 加入练习清单 / 微调 / 成绩 / 分析卡);`active` = 当前句。
 * - `SegmentText`:句子文字(W2 改为逐词 span + data-lookup-context;词的点击应 stopPropagation,否则会触发跳播)。
 * - 微调保存后调 `onSegmentSaved(next)`;`prevEndMs` / `nextStartMs` 是相邻句的边界(不允许重叠)。
 * - 行容器对非当前句启用 `content-visibility: auto`(paint containment):行内的弹出层要走 portal(R-L16、R-L17)。
 */
export interface ShadowPanelProps {
  itemId: string;
  segment: LibrarySegment;
  active: boolean;
  durationMs: number;
  prevEndMs: number | null;
  nextStartMs: number | null;
  player: PlayerHandle | null;
  onSegmentSaved(next: LibrarySegment): void;
}

export function ShadowPanel(_props: ShadowPanelProps): ReactElement | null {
  return null;
}

export interface SegmentTextProps {
  segment: LibrarySegment;
  active: boolean;
}

export function SegmentText({ segment }: SegmentTextProps): ReactElement {
  return <>{segment.text}</>;
}
```

`web/src/features/library/use-translations.ts`(W2 的占位;**之后归 W2,保持导出名与签名**):

```ts
import type { LibrarySegment, TranslatedSegment } from "./library-api";

/**
 * W2 的接缝(spec §15「D8 增补的归属」W2 行;计划 R-L32)。W2 用真实实现替换本文件:按 E12 批量取译文
 * (锚点句前后各 10 句里还没有有效译文的句子〔`needsTranslation`〕,每次 ≤ 20 句〔`MAX_TRANSLATE_BATCH`〕,去重、取消、失败处理),
 * 取到后调 `onTranslated`(播放器用 `mergeTranslations` 合进句子表);额度满 → `notice: "limited"`,其他失败 → `notice: "failed"`
 * (固定文案,不逐句报错);取的过程中 `pending` 里是正在取的句序号(那些行画骨架)。`enabled` 为 false 时什么也不请求。
 * W1 的占位永远空闲。
 */
export interface UseTranslationsArgs {
  itemId: string;
  enabled: boolean;
  segments: readonly LibrarySegment[];
  /** 当前句序号:取它前后各 10 句(自动滚动保证当前句附近就是视野;W2 可以改用 IntersectionObserver 精确到视野) */
  anchorIdx: number;
  /** `nativeLanguageCode(language)` 的值(`zh-CN` / `es-ES`;英文界面不会 enabled) */
  native: string;
  onTranslated(items: TranslatedSegment[]): void;
}

export interface TranslationsState {
  pending: ReadonlySet<number>;
  notice: "limited" | "failed" | null;
  retry(): void;
}

const IDLE: TranslationsState = Object.freeze({ pending: new Set<number>(), notice: null, retry: () => {} });

export function useTranslations(_args: UseTranslationsArgs): TranslationsState {
  return IDLE;
}
```

`web/src/features/library/use-translate-toggle.ts`:

```ts
import { useCallback, useState } from "react";
import { readJson, removeKey, writeJson } from "~/lib/storage";

/** 「译」开关按条目记在本机(spec §11.4):键里只有条目 id,值只有布尔,没有任何内容(隐私);存储不可用时本次不记。 */
export const translateKey = (itemId: string) => `enjoy-web.library.translate.${itemId}`;
const isBool = (value: unknown): value is boolean => typeof value === "boolean";

export function readTranslateOn(itemId: string): boolean {
  return readJson(translateKey(itemId), isBool) === true;
}

export function writeTranslateOn(itemId: string, on: boolean): void {
  if (on) writeJson(translateKey(itemId), true);
  else removeKey(translateKey(itemId));
}

export function useTranslateToggle(itemId: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readTranslateOn(itemId));
  const set = useCallback((next: boolean) => {
    setOn(next);
    writeTranslateOn(itemId, next);
  }, [itemId]);
  return [on, set];
}
```

`web/src/features/library/segment-list.tsx`:

```tsx
import { PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { borderGlowClass } from "./fx/border-glow";
import { motionAllowed } from "./fx/motion";
import { formatDuration } from "./format";
import type { LibrarySegment } from "./library-api";
import "./locales";
import { SegmentText, ShadowPanel } from "./shadow-panel";
import { zhFor } from "./translation-state";
import type { PlayerHandle } from "./use-media-player";

/** 用户手动滚动后这么久内不自动滚到当前句(spec §11.4)。 */
export const MANUAL_SCROLL_GRACE_MS = 3000;

export interface SegmentListProps {
  itemId: string;
  segments: readonly LibrarySegment[];
  current: number;
  blind: boolean;
  durationMs: number;
  player: PlayerHandle | null;
  /** 母语码(`nativeLanguageCode`):译文只在语言一致时显示(E11) */
  native: string;
  /** 「译」是否打开(播放器已把「AI 开关 ∧ 有目标语言」算进去) */
  showTranslation: boolean;
  /** 正在取译文的句子序号(W2 的 use-translations 给):这些行显示骨架 */
  pending: ReadonlySet<number>;
  onSelect(idx: number): void;
  onSegmentSaved(next: LibrarySegment): void;
  now?: () => number;
}

/**
 * 句子列表(R-L17、R-L32):自带滚动容器(播放器是一个不滚动的 flex 列,文档与 <main> 都不滚,R-L33);当前句高亮 + 流动描边并滚到中间;
 * 盲听时文字与译文都不在 DOM 里;点句子文字或译文 = 跳到该句并播放(有文本选区时不跳,给查词让路)。
 */
export function SegmentList({
  itemId, segments, current, blind, durationMs, player, native, showTranslation, pending, onSelect, onSegmentSaved, now = Date.now,
}: SegmentListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  const manualAt = useRef(Number.NEGATIVE_INFINITY);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    setRevealed(new Set());
  }, [blind]);

  useEffect(() => {
    if (current < 0 || now() - manualAt.current < MANUAL_SCROLL_GRACE_MS) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${current}"]`);
    row?.scrollIntoView?.({ block: "center", behavior: motionAllowed() ? "smooth" : "auto" });
  }, [current, now]);

  const markManual = () => {
    manualAt.current = now();
  };
  const selectFromText = (idx: number) => {
    if (window.getSelection?.()?.toString()) return; // 有选区 = 用户在选词查词(R-L16)
    onSelect(idx);
  };

  return (
    <div data-testid="library-segments" onWheel={markManual} onTouchMove={markManual} className="lib-segments">
      {segments.length === 0 ? (
        <p className="px-6 py-10 text-center text-sub text-ink-2">{t("web.library.player.noSegments")}</p>
      ) : (
        <ol ref={listRef} className="flex flex-col">
          {segments.map((seg, i) => {
            const active = seg.idx === current;
            const hidden = blind && !revealed.has(seg.idx);
            const zh = showTranslation ? zhFor(seg, native) : null;
            return (
              <li key={seg.idx} data-idx={seg.idx} data-testid={`segment-${seg.idx}`} aria-current={active ? "true" : undefined}
                className={cn("lib-row", borderGlowClass(active))}>
                <div className="flex items-start gap-1.5">
                  <button type="button" onClick={() => onSelect(seg.idx)} aria-label={t("web.library.player.playSentence", { n: i + 1 })}
                    className="lib-row-play focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <PlayIcon aria-hidden className="h-4 w-4" />
                    <span className="num text-[11px] leading-none">{formatDuration(seg.startMs)}</span>
                  </button>
                  <div className="lib-seg-text" onClick={hidden ? undefined : () => selectFromText(seg.idx)}>
                    {hidden ? (
                      <button type="button" onClick={() => setRevealed((prev) => new Set(prev).add(seg.idx))}
                        className="min-h-tap rounded-button px-2 text-sub text-ink-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t("web.library.player.reveal")}
                      </button>
                    ) : (
                      <>
                        <div className={active ? "text-ink" : "text-ink-2"}><SegmentText segment={seg} active={active} /></div>
                        {showTranslation && zh ? (
                          <p lang={native} data-testid={`segment-zh-${seg.idx}`} className="lib-zh">{zh}</p>
                        ) : showTranslation && pending.has(seg.idx) ? (
                          <span aria-hidden data-testid={`segment-zh-skeleton-${seg.idx}`} className="lib-zh-skeleton" />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                <ShadowPanel itemId={itemId} segment={seg} active={active} durationMs={durationMs}
                  prevEndMs={segments[i - 1]?.endMs ?? null} nextStartMs={segments[i + 1]?.startMs ?? null}
                  player={player} onSegmentSaved={onSegmentSaved} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/segment-list.test.tsx src/features/library/use-translate-toggle.test.ts src/features/library/use-translations.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck`。`<p>` 里不能放 `<div>`:译文行是 `<p>`,句子文字行是 `<div>`,二者同级,没有嵌套。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library sentence list with translation line, glow and the W2 seams

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L14: 播放页 `/library/:id`(spec §11.4、§11.4a、R-L13–R-L15、R-L26、R-L31–R-L33)

**Files:**
- Create: `web/src/features/library/player-page.tsx`、`player-page.test.tsx`

**Interfaces:**
- Consumes:L1、L10–L13、LV1–LV3;`~/settings/settings-context` 的 `useSettings`、`nativeLanguageCode`
- Produces:`LibraryPlayerPage`
- 版式(R-L33):播放器根是 `LibraryRoot.lib-player`(一个不滚动的 flex 列,`overflow: hidden`),自上而下:媒体区(视频 16:9 / 音频图标,上面压着**不模糊**的顶栏胶囊)→ `SegmentList`(圆角抽屉,自己滚动)→ `GradualBlur` → 速度弹出层(`ElasticSlider`)→ 控制胶囊(`GlassSurface`,绝对定位在底栏上沿之上)。一屏模糊层:`GradualBlur` + 控制胶囊 + 全站底栏 = 3(R-L26)。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/player-page.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LibraryPlayerPage } from "./player-page";
import { CONFIG_OFF_RAW, CONFIG_RAW, detailRaw } from "./test-fixtures";
import { resetUiLanguage, setUiLanguage } from "./test-i18n";
import type { UseTranslationsArgs } from "./use-translations";

const TICKET = "/api/library/items/i1/media?ticket=secret-ticket";
const ON_KEY = "enjoy-web.library.translate.i1";

// 译文由 W2 的 use-translations 取;这里换成可控的假实现,只测 W1 的接线与渲染(R-L32)
const tr = vi.hoisted(() => ({
  state: { pending: new Set<number>(), notice: null as null | "limited" | "failed", retry: vi.fn() },
  args: null as null | UseTranslationsArgs,
}));
vi.mock("./use-translations", () => ({
  useTranslations: (args: UseTranslationsArgs) => {
    tr.args = args;
    return tr.state;
  },
}));

beforeEach(async () => {
  localStorage.clear();
  await setUiLanguage("zh-CN");
  tr.state.pending = new Set();
  tr.state.notice = null;
  tr.state.retry.mockClear();
  tr.args = null;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetUiLanguage();
});

function render(detail: Record<string, unknown> | null, extra: Record<string, Handler> = {}, config: unknown = CONFIG_RAW) {
  const mock = createFetchMock({
    "GET /api/library/config": () => json(config),
    "GET /api/library/items/i1": () => (detail ? json(detail) : json({ error: "Library item not found" }, 404)),
    "POST /api/library/items/i1/media-ticket": () => json({ url: TICKET, expires_in: 1800 }),
    "PATCH /api/library/items/i1": () => json({}),
    ...extra,
  });
  renderWithProviders(<LibraryPlayerPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/library/i1", path: "/library/:id" });
  return mock;
}

describe("LibraryPlayerPage (spec §11.4)", () => {
  it("goes back to the practice page when the library is off", async () => {
    render(detailRaw(), {}, CONFIG_OFF_RAW);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
  });

  it("only explains an item that is not ready, without asking for a ticket", async () => {
    const mock = render(detailRaw({ status: "processing", segments: [] }));
    expect(await screen.findByText("这条素材还在处理中。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到跟读库" })).toHaveAttribute("href", "/library");
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/media-ticket"))).toBe(false);
  });

  it("shows a translated error for a missing item", async () => {
    render(null);
    expect(await screen.findByText("素材不存在或已删除。")).toBeInTheDocument();
  });

  it("plays a ready video inline from the ticket URL with its sentences and restores the position", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    render(detailRaw({ resume_ms: 4000, resume_idx: 1 }));
    const video = await screen.findByTestId("library-media");
    await waitFor(() => expect(video).toHaveAttribute("src", TICKET));
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("controls");
    expect(screen.getByText("How are you today?")).toBeInTheDocument();
    fireEvent(video, new Event("loadedmetadata"));
    await waitFor(() => expect((video as HTMLVideoElement).currentTime).toBe(4));
    expect(screen.getByTestId("segment-1")).toHaveAttribute("aria-current", "true");
    expect(consoleSpy.mock.calls.flat().join(" ")).not.toContain("secret-ticket");
  });

  it("is a library surface with a tint top bar and exactly two library blur layers (R-L26, R-L33)", async () => {
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(document.querySelector(".library-root.lib-page.lib-player")).not.toBeNull();
    // 控制胶囊 + 渐进模糊 = 2 层;全站底栏是第 3 层;压在视频上的顶栏胶囊不模糊
    expect(document.querySelectorAll(".lib-glass, .lib-gblur")).toHaveLength(2);
    expect(screen.getByTestId("library-controls").className).toMatch(/\blib-glass\b/);
    const bar = document.querySelector(".lib-bar") as HTMLElement;
    expect(bar.className).not.toMatch(/lib-glass/);
    expect(bar.querySelector("a")).toHaveAttribute("href", "/library");
    expect(within(bar).getByRole("heading", { name: "Lecture 1" })).toBeInTheDocument();
    expect(screen.getByTestId("library-segments").className).toMatch(/\blib-segments\b/);
  });

  it("puts the controls inside the player root, over the list, as a floating capsule (R-L33)", async () => {
    render(detailRaw());
    await screen.findByTestId("library-media");
    const controls = screen.getByTestId("library-controls");
    expect(controls.className).toMatch(/\blib-ctrl\b/);
    expect(controls.closest(".lib-player")).not.toBeNull();
  });

  it("opens an elastic speed slider that snaps to four steps and saves rate_pct", async () => {
    const mock = render(detailRaw());
    const chip = await screen.findByTestId("library-rate");
    await waitFor(() => expect(chip).not.toBeDisabled());
    expect(chip).toHaveAccessibleName("速度 1 倍");
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(chip);
    const slider = screen.getByRole("slider", { name: "播放速度" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "1.25");
    expect(chip).toHaveAccessibleName("速度 1.25 倍");
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH" && JSON.parse(String(c.body)).rate_pct === 125)).toBe(true));
    fireEvent.keyDown(slider, { key: "ArrowRight" }); // 已在最高档,不再改
    expect(slider).toHaveAttribute("aria-valuenow", "1.25");
    fireEvent.click(chip);
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("closes the speed slider with Escape or a tap elsewhere", async () => {
    render(detailRaw());
    const chip = await screen.findByTestId("library-rate");
    await waitFor(() => expect(chip).not.toBeDisabled());
    fireEvent.click(chip);
    expect(screen.getByRole("slider")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(chip);
    fireEvent.pointerDown(screen.getByTestId("library-segments"));
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("cycles the loop modes and toggles blind listening", async () => {
    render(detailRaw());
    const loop = await screen.findByTestId("library-loop");
    await waitFor(() => expect(loop).not.toBeDisabled());
    expect(loop).toHaveAccessibleName("关闭循环");
    fireEvent.click(loop);
    expect(loop).toHaveAccessibleName("单句循环");
    expect(loop).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(loop);
    expect(loop).toHaveAccessibleName("每句循环 3 遍");
    fireEvent.click(screen.getByTestId("library-blind"));
    expect(screen.queryByText("Hello there.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "显示这句" })).toHaveLength(3);
  });

  it("shows audio items with an icon and a hidden audio element", async () => {
    render(detailRaw({ kind: "audio" }));
    const audio = await screen.findByTestId("library-media");
    expect(audio.tagName).toBe("AUDIO");
    expect(screen.getByText("音频")).toBeInTheDocument();
  });
});

describe("translation line and switch (D8, E12, R-L32)", () => {
  it("offers the switch when the server has AI on and the UI language has a native target", async () => {
    render(detailRaw());
    const chip = await screen.findByTestId("library-translate");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAccessibleName("显示译文");
  });

  it("hides the switch when the administrator turned AI off", async () => {
    render(detailRaw(), {}, { ...CONFIG_RAW, ai: false });
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-translate")).toBeNull();
  });

  it("hides the switch in the English UI (nothing to translate into, like chat R16)", async () => {
    await setUiLanguage("en");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-translate")).toBeNull();
  });

  it("turns the translation on, remembers it per item and starts fetching around the current sentence", async () => {
    render(detailRaw({ resume_idx: 1 }));
    const chip = await screen.findByTestId("library-translate");
    expect(tr.args).toMatchObject({ itemId: "i1", enabled: false, native: "zh-CN" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAccessibleName("隐藏译文");
    expect(tr.args).toMatchObject({ enabled: true, anchorIdx: 1 });
    expect(JSON.parse(localStorage.getItem(ON_KEY)!)).toBe(true);
    fireEvent.click(chip);
    expect(localStorage.getItem(ON_KEY)).toBeNull();
  });

  it("starts with the remembered switch and shows stored translations under their sentences", async () => {
    localStorage.setItem(ON_KEY, "true");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(tr.args?.enabled).toBe(true);
    expect(screen.getByTestId("segment-zh-1")).toHaveTextContent("你今天好吗?");
    expect(screen.getByTestId("segment-zh-1")).toHaveAttribute("lang", "zh-CN");
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
    fireEvent.click(screen.getByTestId("library-translate"));
    expect(screen.queryByTestId("segment-zh-1")).toBeNull();
  });

  it("merges freshly fetched translations into the sentences", async () => {
    localStorage.setItem(ON_KEY, "true");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
    act(() => tr.args!.onTranslated([{ idx: 0, zh: "你好。" }, { idx: 2, zh: "我很好,谢谢。" }]));
    expect(screen.getByTestId("segment-zh-0")).toHaveTextContent("你好。");
    expect(screen.getByTestId("segment-zh-2")).toHaveTextContent("我很好,谢谢。");
    expect(screen.getByTestId("segment-zh-1")).toHaveTextContent("你今天好吗?");
  });

  it("shows a skeleton for sentences being fetched and hides translations in blind mode", async () => {
    localStorage.setItem(ON_KEY, "true");
    tr.state.pending = new Set([0]);
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.getByTestId("segment-zh-skeleton-0")).toBeInTheDocument();
    expect(screen.queryByTestId("segment-zh-skeleton-2")).toBeNull();
    fireEvent.click(screen.getByTestId("library-blind"));
    expect(screen.queryByTestId("segment-zh-1")).toBeNull();
    expect(screen.queryByTestId("segment-zh-skeleton-0")).toBeNull();
  });

  it("shows one fixed note when the allowance is spent or a fetch failed, and retry reaches the fetcher", async () => {
    localStorage.setItem(ON_KEY, "true");
    tr.state.notice = "limited";
    render(detailRaw());
    expect(await screen.findByTestId("library-translate-notice")).toHaveTextContent("今天的译文额度已用完,播放和跟读不受影响。");
    cleanup();
    tr.state.notice = "failed";
    render(detailRaw());
    const notice = await screen.findByTestId("library-translate-notice");
    expect(notice).toHaveTextContent("暂时无法生成译文。");
    fireEvent.click(within(notice).getByRole("button", { name: "重试" }));
    expect(tr.state.retry).toHaveBeenCalledTimes(1);
  });

  it("does not show the note while the translation switch is off", async () => {
    tr.state.notice = "limited";
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-translate-notice")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/player-page.test.tsx`。

- [ ] **Step 3: 实现** — `web/src/features/library/player-page.tsx`:

```tsx
import {
  ChevronLeftIcon, EyeIcon, EyeOffIcon, LanguagesIcon, MusicIcon, PauseIcon, PlayIcon, Repeat1Icon, RepeatIcon, SkipBackIcon, SkipForwardIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { useLibraryConfig } from "./config";
import { ElasticSlider } from "./fx/elastic-slider";
import { GlassSurface } from "./fx/glass-surface";
import { GradualBlur } from "./fx/gradual-blur";
import { LIBRARY_SERVER_ERRORS, getItem, patchItem, type LibraryItemDetail, type LibrarySegment, type TranslatedSegment } from "./library-api";
import { LibraryRoot } from "./library-root";
import "./locales";
import { PageError, PageLoading } from "./page-status";
import { useResume } from "./resume";
import { SegmentList } from "./segment-list";
import { mergeTranslations } from "./translation-state";
import { RATES, nextLoop, pctFromRate, rateFromPct, useMediaPlayer, type Rate } from "./use-media-player";
import { useMediaSource } from "./use-media-source";
import { usePosterUrl } from "./use-poster";
import { useTranslateToggle } from "./use-translate-toggle";
import { useTranslations } from "./use-translations";

/** `/library/:id`(spec §11.4):开关未到转圈,关闭回练习页(R-L6)。 */
export function LibraryPlayerPage() {
  const { id = "" } = useParams<{ id: string }>();
  const config = useLibraryConfig();
  if (config === null) return <PageLoading />;
  if (!config.enabled) return <Navigate to="/practice" replace />;
  return <PlayerScreen key={id} id={id} ai={config.ai} />;
}

function PlayerScreen({ id, ai }: { id: string; ai: boolean }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [detail, setDetail] = useState<LibraryItemDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    getItem(api, id).then(setDetail, setError);
  }, [api, id]);
  useEffect(load, [load]);

  if (error) {
    return (
      <LibraryRoot>
        <PageHeader title={t("web.library.title")} back="/library" />
        <PageError message={translateServerError(t, error, LIBRARY_SERVER_ERRORS)} onRetry={load} />
      </LibraryRoot>
    );
  }
  if (!detail) return <PageLoading />;
  if (detail.status !== "ready") {
    // 处理中的条目只显示进度说明;失败的不进播放器(spec §11.4)
    const failed = detail.status === "failed" || detail.status === "canceled";
    return (
      <LibraryRoot>
        <PageHeader title={detail.title} back="/library" />
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sub text-ink-2">
          <p data-testid="library-not-ready">{t(failed ? "web.library.player.failed" : "web.library.player.notReady")}</p>
          <Link to="/library"
            className="inline-flex min-h-tap items-center rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.library.player.back")}
          </Link>
        </div>
      </LibraryRoot>
    );
  }
  return <Player detail={detail} ai={ai} />;
}

function Player({ detail, ai }: { detail: LibraryItemDetail; ai: boolean }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const canTranslate = ai && native !== "en-US"; // R-L32:英文界面没有可译的目标语言(同 chat 的 R16)
  const [segments, setSegments] = useState<LibrarySegment[]>(detail.segments);
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const { controller, state } = useMediaPlayer(media, segments, { rate: rateFromPct(detail.ratePct), index: detail.resumeIdx });
  const source = useMediaSource(detail.id, true, media);
  const poster = usePosterUrl(detail.id, detail.kind === "video");
  useResume(detail.id, controller, { initial: { resumeMs: detail.resumeMs, resumeIdx: detail.resumeIdx } });
  const [blind, setBlind] = useState(false);
  const [translateOn, setTranslateOn] = useTranslateToggle(detail.id);
  const showTranslation = canTranslate && translateOn;
  const [rateOpen, setRateOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);
  const rateButton = useRef<HTMLButtonElement>(null);

  // 续播:元数据就绪后跳到上次的位置,只做一次(R-L14)
  const restored = useRef(false);
  useEffect(() => {
    if (!controller || !media || restored.current) return;
    const go = () => {
      if (restored.current) return;
      restored.current = true;
      controller.restore(detail.resumeMs, detail.resumeIdx);
    };
    if (media.readyState >= 1) {
      go();
      return;
    }
    media.addEventListener("loadedmetadata", go, { once: true });
    return () => media.removeEventListener("loadedmetadata", go);
  }, [controller, media, detail.resumeMs, detail.resumeIdx]);

  // 速度弹出层:Esc 或点别处关闭
  useEffect(() => {
    if (!rateOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (speedRef.current?.contains(target) || rateButton.current?.contains(target)) return;
      setRateOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRateOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [rateOpen]);

  const rate = state?.rate ?? rateFromPct(detail.ratePct);
  const loop = state?.loop ?? "off";
  const playing = state?.playing ?? false;
  const current = state?.index ?? detail.resumeIdx;
  const changeRate = (next: Rate) => {
    if (!controller || next === rate) return;
    controller.setRate(next);
    void patchItem(api, detail.id, { ratePct: pctFromRate(next) }).catch(() => {});
  };
  const onSegmentSaved = useCallback((next: LibrarySegment) => {
    setSegments((list) => list.map((s) => (s.idx === next.idx ? next : s)));
  }, []);
  const onTranslated = useCallback((items: TranslatedSegment[]) => {
    setSegments((list) => mergeTranslations(list, items, native));
  }, [native]);
  const translations = useTranslations({ itemId: detail.id, enabled: showTranslation, segments, anchorIdx: current, native, onTranslated });
  const mediaProps = { ref: setMedia, src: source.url ?? undefined, preload: "metadata" as const, "data-testid": "library-media" };

  return (
    <LibraryRoot className="lib-player">
      <div className="lib-stage">
        {detail.kind === "video" ? (
          <video {...mediaProps} poster={poster ?? undefined} playsInline className="aspect-video w-full bg-black" />
        ) : (
          <div className="lib-stage-audio">
            <MusicIcon aria-hidden className="h-8 w-8" />
            <span className="text-sub">{t("web.library.player.audio")}</span>
            <audio {...mediaProps} />
          </div>
        )}
        {/* 压在视频上的顶栏胶囊:半透明 + 高光边,不模糊(R-L26) */}
        <div className="lib-bar">
          <Link to="/library" aria-label={t("web.common.back")} className="lib-bar-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronLeftIcon aria-hidden />
          </Link>
          <h1 className="lib-bar-title">{detail.title}</h1>
        </div>
        {source.error ? (
          <div role="alert" className="lib-stage-alert">
            <span>{t("web.library.player.mediaError")}</span>
            <button type="button" onClick={source.retry}
              className="min-h-tap rounded-button px-3 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("web.common.retry")}
            </button>
          </div>
        ) : null}
      </div>
      <SegmentList itemId={detail.id} segments={segments} current={current} blind={blind} durationMs={detail.durationMs ?? 0}
        player={controller} native={native} showTranslation={showTranslation} pending={translations.pending}
        onSelect={(idx) => controller?.seekTo(idx, true)} onSegmentSaved={onSegmentSaved} />
      <GradualBlur />
      {rateOpen ? (
        <div ref={speedRef} role="group" aria-label={t("web.library.player.rateSlider")} data-testid="library-speed" className="lib-speed">
          <div className="lib-speed-top">
            <span>{t("web.library.player.rateSlider")}</span>
            <b className="num">{rate.toFixed(2)}×</b>
          </div>
          <ElasticSlider steps={RATES} value={rate} onChange={changeRate} label={t("web.library.player.rateSlider")} />
        </div>
      ) : null}
      <GlassSurface data-testid="library-controls" className="lib-ctrl">
        {showTranslation && translations.notice ? (
          <p role="status" data-testid="library-translate-notice" className="lib-notice">
            {t(translations.notice === "limited" ? "web.library.player.translateLimited" : "web.library.player.translateFailed")}
            {translations.notice === "failed" ? (
              <button type="button" className="lib-notice-btn" onClick={translations.retry}>{t("web.library.player.translateRetry")}</button>
            ) : null}
          </p>
        ) : null}
        <div className="lib-ctrl-main">
          <button type="button" className="lib-ctrl-btn" disabled={!controller} aria-label={t("web.library.player.prev")} onClick={() => controller?.prev()}>
            <SkipBackIcon aria-hidden />
          </button>
          <button type="button" className="lib-ctrl-btn lib-ctrl-play lib-spec" disabled={!controller}
            aria-label={t(playing ? "web.library.player.pause" : "web.library.player.play")} onClick={() => controller?.toggle()}>
            {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
          </button>
          <button type="button" className="lib-ctrl-btn" disabled={!controller} aria-label={t("web.library.player.next")} onClick={() => controller?.next()}>
            <SkipForwardIcon aria-hidden />
          </button>
        </div>
        <div className="lib-chips">
          {canTranslate ? (
            <button type="button" data-testid="library-translate" className="lib-chip" aria-pressed={translateOn}
              aria-label={t(translateOn ? "web.library.player.translateOn" : "web.library.player.translateOff")}
              onClick={() => setTranslateOn(!translateOn)}>
              <LanguagesIcon aria-hidden /><span aria-hidden>{t("web.library.player.translateShort")}</span>
            </button>
          ) : null}
          <button type="button" data-testid="library-loop" className="lib-chip" disabled={!controller} aria-pressed={loop !== "off"}
            aria-label={t(`web.library.player.loop.${loop}`)} onClick={() => controller?.setLoop(nextLoop(loop))}>
            {loop === 3 || loop === 5 ? <Repeat1Icon aria-hidden /> : <RepeatIcon aria-hidden />}
            <span aria-hidden className="num">{loop === "infinite" ? "∞" : loop === "off" ? t("web.library.player.chipLoop") : `×${loop}`}</span>
          </button>
          <button type="button" ref={rateButton} data-testid="library-rate" className="lib-chip" disabled={!controller} aria-expanded={rateOpen}
            aria-label={t("web.library.player.rate", { rate })} onClick={() => setRateOpen((open) => !open)}>
            <span aria-hidden className="num">{rate}×</span>
          </button>
          <button type="button" data-testid="library-blind" className="lib-chip" aria-pressed={blind}
            aria-label={t(blind ? "web.library.player.blindOff" : "web.library.player.blind")} onClick={() => setBlind((b) => !b)}>
            {blind ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
            <span aria-hidden>{t("web.library.player.chipBlind")}</span>
          </button>
        </div>
      </GlassSurface>
    </LibraryRoot>
  );
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library/player-page.test.tsx src/features/library/segment-list.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck`。jsdom 的 `readyState` 恒为 0,所以测试里靠手动派发 `loadedmetadata` 触发续播。`aria-pressed` 的循环芯片在 `loop !== "off"` 时为真。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library
git commit -m "feat(web): library player page with glass controls, elastic speed, translation line and resume

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task L15: 底部标签入口、懒加载页面与路由(E9;R-L24、R-L6、R-L23)

**Files:**
- Create: `web/src/features/library/use-library-enabled.ts`、`use-library-enabled.test.tsx`、`lazy-pages.tsx`、`library-lazy.test.ts`
- Modify: `web/src/features/library/index.ts`(换成真正的公开面)、`web/src/app.tsx`(一行导入 + 两条路由)、`web/src/layout/bottom-nav.tsx`、`web/src/layout/bottom-nav.test.tsx`(整文件替换)、`web/src/layout/feature-flags.test.tsx`(三处)、`web/src/layout/CLAUDE.md`
- **不再创建** `entry-card.tsx`、`register.tsx`、`register.test.tsx`,**不再改** `plugins/index.ts`、`links-matrix.test.tsx`(R-L5 作废)

**Interfaces:**
- Produces:`useLibraryEnabled()`;`LibraryListPage`、`LibraryPlayerPage`(懒包装,经 `~/features/library`);底部标签 `LIBRARY`(`/library`,testId `nav-library`,图标 `ClapperboardIcon`,文案 `web.nav.library`)

- [ ] **Step 1: 写失败测试**

`web/src/features/library/use-library-enabled.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CONFIG_OFF_RAW, CONFIG_RAW } from "./test-fixtures";
import { useLibraryEnabled } from "./use-library-enabled";

function Probe() {
  return <p data-testid="enabled">{String(useLibraryEnabled())}</p>;
}
const api = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

describe("useLibraryEnabled (spec E9)", () => {
  it("is false until the config says the library is on, then true", async () => {
    const mock = createFetchMock({ "GET /api/library/config": () => json(CONFIG_RAW) });
    renderWithProviders(<Probe />, { api: api(mock) });
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
  });

  it.each([
    ["switched off", { "GET /api/library/config": () => json(CONFIG_OFF_RAW) }],
    ["an old server (404)", {}],
  ] as const)("stays false when %s", async (_name, routes) => {
    const mock = createFetchMock(routes);
    renderWithProviders(<Probe />, { api: api(mock) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });

  it("asks once per client and retries on the next mount after a transient failure", async () => {
    let calls = 0;
    const mock = createFetchMock({
      "GET /api/library/config": () => (++calls === 1 ? json({ error: "Upstream unavailable" }, 502) : json(CONFIG_RAW)),
    });
    const client = api(mock);
    const first = renderWithProviders(<Probe />, { api: client });
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
    first.unmount();
    renderWithProviders(<Probe />, { api: client });
    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
    expect(calls).toBe(2);
  });
});
```

`web/src/features/library/library-lazy.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 主包守卫(计划 R-L23):这些模块在主包里,不得静态导入懒模块、懒加载文案、视觉层或动效。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const MAIN = ["index.ts", "lazy-pages.tsx", "use-library-enabled.ts", "config.ts", "page-status.tsx"];
const LAZY_ONLY = [
  "locales", "library-api", "library-list-page", "player-page", "upload-store", "upload-client", "use-media-player", "library-root", "library.css",
];
const staticImports = (s: string) =>
  [...s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']\.\/([^"']+)["']|(?:^|\n)\s*import\s*["']\.\/([^"']+)["']/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\.(ts|tsx)$/, ""));

describe("library stays out of the main bundle (R-L23)", () => {
  it("main-bundle modules never statically import lazy modules, the lazy copy, the visual layer or effects", () => {
    for (const f of MAIN) {
      for (const target of staticImports(src(f))) {
        expect(LAZY_ONLY, `${f} -> ./${target}`).not.toContain(target);
        expect(target.startsWith("fx/"), `${f} -> ./${target}`).toBe(false);
      }
    }
  });

  it("pages are reached only through import()", () => {
    const lazy = src("lazy-pages.tsx");
    expect(lazy).toContain('import("./library-list-page")');
    expect(lazy).toContain('import("./player-page")');
    expect(src("index.ts")).toContain('from "./lazy-pages"');
    expect(src("index.ts")).toContain('from "./use-library-enabled"');
  });

  it("app.tsx mounts both routes", () => {
    const app = readFileSync(path.resolve(here, "../../app.tsx"), "utf8");
    expect(app).toContain('path="/library"');
    expect(app).toContain('path="/library/:id"');
  });

  it("the entry is the bottom tab: no practiceHome card, no plugin registration (spec E9, R-L24)", () => {
    expect(existsSync(path.join(here, "register.tsx"))).toBe(false);
    expect(existsSync(path.join(here, "entry-card.tsx"))).toBe(false);
    expect(readFileSync(path.resolve(here, "../../plugins/index.ts"), "utf8")).not.toContain("features/library");
    const nav = readFileSync(path.resolve(here, "../../layout/bottom-nav.tsx"), "utf8");
    expect(nav).toContain('from "~/features/library"');
    expect(nav).toContain("useLibraryEnabled");
  });
});
```

`web/src/layout/bottom-nav.test.tsx`(**整文件替换**;原先三处 `waitFor(() => expect(mock.calls).toHaveLength(1))` 在多一个配置请求后会变成 2,所以改为只数 `/api/rooms/config`):

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { BottomNav } from "./bottom-nav";

const rooms = (enabled: boolean) => ({ "GET /api/rooms/config": () => json({ enabled, ai_available: enabled, max_members: 8, max_text: 500 }) });
const library = (enabled: boolean) => ({ "GET /api/library/config": () => json({ enabled, link_import: false, asr: false, ai: false, limits: null }) });
const callsTo = (mock: ReturnType<typeof createFetchMock>, path: string) => mock.calls.filter((c) => c.url.pathname === path);
const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function mount(roomsOn: boolean, libraryOn: boolean, route = "/practice") {
  const mock = createFetchMock({ ...rooms(roomsOn), ...library(libraryOn) });
  const view = renderWithProviders(<BottomNav />, { route, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  await waitFor(() => expect(callsTo(mock, "/api/rooms/config")).toHaveLength(1));
  await waitFor(() => expect(callsTo(mock, "/api/library/config")).toHaveLength(1));
  await settle();
  return { mock, ...view };
}

describe("BottomNav", () => {
  it("shows four tabs when only rooms are enabled", async () => {
    await mount(true, false);
    expect(hrefs()).toEqual(["/practice", "/chat", "/rooms", "/me"]);
  });

  it("shows four tabs when only the library is enabled, between 对话 and 我的 (spec E9)", async () => {
    await mount(false, true);
    expect(hrefs()).toEqual(["/practice", "/chat", "/library", "/me"]);
  });

  it("shows five tabs in the order 练习 · 对话 · 联机 · 跟读库 · 我的 when both are enabled", async () => {
    await mount(true, true);
    expect(hrefs()).toEqual(["/practice", "/chat", "/rooms", "/library", "/me"]);
    expect(screen.getByTestId("nav-library")).toHaveTextContent("Library");
    expect(screen.getByTestId("nav-library").className).toMatch(/\bmin-h-14\b/);
  });

  it("keeps three tabs when both are disabled, or the library is missing (old server)", async () => {
    await mount(false, false);
    expect(screen.queryByTestId("nav-rooms")).toBeNull();
    expect(screen.queryByTestId("nav-library")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("sizes five columns for the glass bar and keeps every label short enough for a 360 px phone (E9)", async () => {
    await mount(true, true);
    expect(screen.getByRole("list").style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    // 360 px / 5 = 72 px per tab:标签 ≤ 8 个英文字符 / ≤ 4 个汉字(spec E9)
    for (const key of ["practice", "chat", "rooms", "library", "me"]) {
      expect([...i18n.getFixedT("en")(`web.nav.${key}`)].length, `en ${key}`).toBeLessThanOrEqual(8);
      expect([...i18n.getFixedT("zh-CN")(`web.nav.${key}`)].length, `zh-CN ${key}`).toBeLessThanOrEqual(4);
    }
  });

  it("highlights the library tab on /library and below, and only there", async () => {
    for (const route of ["/library", "/library/i1"]) {
      const { unmount } = await mount(true, true, route);
      expect(screen.getByTestId("nav-library")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
      unmount();
    }
    await mount(true, true, "/libraryx");
    expect(screen.getByTestId("nav-library")).not.toHaveAttribute("aria-current");
  });

  it("highlights 练习 on wordbook pages (they are entered from the practice tab)", async () => {
    for (const route of ["/wordbook", "/wordbook/learn", "/wordbook/spell"]) {
      const { unmount } = await mount(false, false, route);
      expect(screen.getByTestId("nav-practice")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("nav-me")).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("does not highlight 练习 for look-alike paths", async () => {
    await mount(false, false, "/wordbooks");
    expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
  });
});
```

`web/src/layout/feature-flags.test.tsx` —— 三处小改(跟读库与联机一样,关 = 原样的 3 个标签,开 = 多一个标签):
1. `setup` 里的 `createFetchMock({ … })`,在 `"GET /api/rooms/config": …` 那一行之后加:
   `"GET /api/library/config": () => json({ enabled, link_import: false, asr: false, ai: false, limits: null }),`
2. 「off」用例:`await waitFor(() => expect(called(mock, "/api/rank/config") && called(mock, "/api/rooms/config")).toBe(true));` → 在 `&& called(mock, "/api/rooms/config")` 之后加 `&& called(mock, "/api/library/config")`;并在 `expect(screen.queryByTestId("nav-rooms")).toBeNull();` 之后加 `expect(screen.queryByTestId("nav-library")).toBeNull();`;标题 `"off: 3 tabs and no rank or rooms entry on %s"` 改为 `"off: 3 tabs and no rank, rooms or library entry on %s"`。
3. 「on」用例:标题 `"on: 4 tabs and the rank card on %s"` → `"on: 5 tabs and the rank card on %s"`;`expect(await screen.findByTestId("nav-rooms")).toBeTruthy();` 之后加 `expect(await screen.findByTestId("nav-library")).toBeTruthy();`;`for (const id of ["nav-practice", "nav-chat", "nav-rooms", "nav-me"])` → `["nav-practice", "nav-chat", "nav-rooms", "nav-library", "nav-me"]`。

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/use-library-enabled.test.tsx src/features/library/library-lazy.test.ts src/layout/bottom-nav.test.tsx src/layout/feature-flags.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/library/use-library-enabled.ts`:

```ts
import { useLibraryConfig } from "./config";

/**
 * 底部标签「跟读库」是否出现(spec E9):只读 `GET /api/library/config`(按 ApiClient 缓存一次成功结果,同 `useRoomsEnabled`);
 * 拿到配置前、关闭、旧服务端(404)、失败(下次挂载再试)都是 false。主包模块,不得导入懒模块(library-lazy.test.ts)。
 */
export function useLibraryEnabled(): boolean {
  return useLibraryConfig()?.enabled === true;
}
```

`web/src/features/library/lazy-pages.tsx`:

```tsx
import { type ComponentType, lazy, Suspense } from "react";
import { PageLoading } from "./page-status";

/** 跟读库两页按路由懒加载(R-L23,同 wordbook/lazy-pages.tsx):每页自带 Suspense,app.tsx 的路由写法不变。 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ComponentType {
  const Page = lazy(async (): Promise<{ default: ComponentType }> => ({ default: (await load())[name] }));
  function LazyPage() {
    return (
      <Suspense fallback={<PageLoading />}>
        <Page />
      </Suspense>
    );
  }
  LazyPage.displayName = name;
  return LazyPage;
}

export const LibraryListPage = lazyPage(() => import("./library-list-page"), "LibraryListPage");
export const LibraryPlayerPage = lazyPage(() => import("./player-page"), "LibraryPlayerPage");
```

`web/src/features/library/index.ts`(整文件替换):

```ts
// library 的公共接口(spec 2026-10-13-video-import §11.1、E9):其他目录只能从这里引入 library(src/architecture.test.ts 约束)。
// 页面按路由懒加载(lazy-pages.tsx);`useLibraryEnabled` 给底部标签用(layout/bottom-nav.tsx,与 useRoomsEnabled 同一做法)。
// 不要在这里静态导出页面模块、library-api、视觉层或动效。
export { LibraryListPage, LibraryPlayerPage } from "./lazy-pages";
export { useLibraryEnabled } from "./use-library-enabled";
```

`web/src/layout/bottom-nav.tsx`(整文件替换):

```tsx
import { ClapperboardIcon, type LucideIcon, MessagesSquareIcon, MicIcon, UserIcon, UsersRoundIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { GlassTabBar, tabBarItemClass } from "~/components/glass-tab-bar";
import { useLibraryEnabled } from "~/features/library";
import { useRoomsEnabled } from "~/features/rooms";

interface Tab {
  to: string;
  icon: LucideIcon;
  label: string;
  testId: string;
  /** 属于这个 tab 的其他页面(背单词从练习页进入,停留其中时仍高亮「练习」) */
  also?: string[];
}

const PRACTICE: Tab = { to: "/practice", icon: MicIcon, label: "web.nav.practice", testId: "nav-practice", also: ["/wordbook"] };
const CHAT: Tab = { to: "/chat", icon: MessagesSquareIcon, label: "web.nav.chat", testId: "nav-chat" };
const ROOMS: Tab = { to: "/rooms", icon: UsersRoundIcon, label: "web.nav.rooms", testId: "nav-rooms" };
// 跟读库(spec E9):独立标签,`/library` 与 `/library/:id` 下保持高亮;关闭时不出现
const LIBRARY: Tab = { to: "/library", icon: ClapperboardIcon, label: "web.nav.library", testId: "nav-library" };
const ME: Tab = { to: "/me", icon: UserIcon, label: "web.nav.me", testId: "nav-me" };

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const roomsOn = useRoomsEnabled();
  const libraryOn = useLibraryEnabled();
  // 练习 · 对话 · 联机 · 跟读库 · 我的(联机或跟读库任一关闭时对应少一个;最多 5 个,360 px 下每个约 72 px)
  const items = [PRACTICE, CHAT, ...(roomsOn ? [ROOMS] : []), ...(libraryOn ? [LIBRARY] : []), ME];
  return (
    <GlassTabBar label={t("web.nav.label")} columns={items.length}>
      {items.map(({ to, icon: Icon, label, testId, also = [] }) => {
        const active = [to, ...also].some((base) => under(pathname, base));
        return (
          <li key={to}>
            <Link to={to} data-testid={testId} aria-current={active ? "page" : undefined} className={tabBarItemClass(active)}>
              <Icon aria-hidden />
              {t(label)}
            </Link>
          </li>
        );
      })}
    </GlassTabBar>
  );
}
```

`web/src/app.tsx` —— 在
`} from "~/features/wordbook";` 那组导入之后加一行 `import { LibraryListPage, LibraryPlayerPage } from "~/features/library";`;在 `<Route path="/wordbook/learned" element={<WordbookLearnedPage />} />` 之后加两行(同样的缩进):

```tsx
            <Route path="/library" element={<LibraryListPage />} />
            <Route path="/library/:id" element={<LibraryPlayerPage />} />
```

`web/src/layout/CLAUDE.md`:`bottom-nav.tsx` 一行改为「`bottom-nav.tsx`(练习 · 对话 · 联机 · 跟读库 · 我的;联机与跟读库各由 `useRoomsEnabled()` / `useLibraryEnabled()` 控制,最多 5 个标签)」;「Allowed dependencies」不变(layout 经 `~/features/<name>` 导入 feature 是现有做法);Pitfalls 加「5 个标签在 360 px 宽下每个约 72 px:标签文字 ≤ 8 个英文字符 / ≤ 4 个汉字(`bottom-nav.test.tsx` 守着);改标签文案要同步那条测试」。

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/library src/layout src/architecture.test.ts && cd .. && yarn web:typecheck`。`library-lazy.test.ts` 若报 `plugins/index.ts` 含 `features/library`,说明有人又加了入口卡注册:删掉它(R-L24)。`feature-flags.test.tsx` 与 `layout.test.tsx` 里没提到的断言(三个 56px 目标、玻璃底栏)不应受影响;若有测试因为多了一个 `/api/library/config` 请求而计数失败,把计数改成只数它关心的路径,不要在 `bottom-nav.tsx` 里藏掉这个请求。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/library web/src/layout web/src/app.tsx
git commit -m "feat(web): library bottom tab, lazy routes and the enabled hook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 评审波** — `/code-review high`(L10–L15 与 LV1–LV3 的改动);修复后单独提交 `fix(web): …`。

---

## Task L16: 文档、体积验收与结果

**Files:**
- Create: `web/src/features/library/CLAUDE.md`
- Modify: `web/README.md`、`docs/superpowers/plans/2026-10-13-video-import-results.md`(只改 W1 一节)

- [ ] **Step 1: `web/src/features/library/CLAUDE.md`**

```markdown
# web/src/features/library/

跟读库(spec `docs/superpowers/specs/2026-10-13-video-import-design.md` §11;计划 `2026-10-13-video-import-web-library.md`(W1)、
`2026-10-13-video-import-web-shadow.md`(W2)):每个用户的私有素材库(上传音视频 / 链接导入)+ 逐句播放器,深色优先的玻璃外观
(D11,只在本目录)。入口是**底部标签「跟读库」**(`/library`,在联机与「我的」之间):`layout/bottom-nav.tsx` 经 `useLibraryEnabled()` 读
`GET /api/library/config`(404 / 关 = 标签不出现,直达路由跳回 `/practice`)。没有 `practiceHome` 入口卡。

## What lives here
- 主包(保持很小):`index.ts`(两个懒页面 + `useLibraryEnabled`)、`lazy-pages.tsx`、`use-library-enabled.ts`、`config.ts`、`page-status.tsx`、
  `i18n/`(只有 `web.nav.library`)。
- 懒块:`library-api.ts`(类型、REST、`translateSegments` / `analyzeSegment`、`LIBRARY_SERVER_ERRORS`)、`error-kinds.ts`、`format.ts`、`ui.ts`、
  `translation-state.ts`(`zhFor` / `mergeTranslations`)、`locales.ts` + `locales/`(其余文案)。
- 视觉层(D11):`library.css`(所有 `.lib-*` 类,变量在 `.library-root` 上)、`library-root.tsx`、`fx/`(12 个自写小效果:GlassSurface、SoftAurora、
  SpotlightCard、SpecularButton、ShinyText、Stepper、BorderGlow、GradualBlur、ElasticSlider、CountUp + GradientText、ClickSpark、BlurText;
  `fx/index.ts` 是给 W2 的桶)。无新 npm 依赖。
- 列表:`library-list-page.tsx`、`item-card.tsx`、`use-library-items.ts`(3 s 轮询,页面隐藏时停)、`use-poster.ts`、`add-sheet.tsx`、`upload-form.tsx`、`import-form.tsx`。
- 上传:`upload-client.ts`(`uploadFile`:8 MiB 分片串行、每片重试 3 次、续传、409 后按服务端进度对齐)、`upload-store.ts`(模块级任务表、beforeunload 提示、取消 = 删除条目)。
- 播放:`player-page.tsx`、`use-media-player.ts`(`PlayerController`:rAF 轮询、循环、速度)、`use-media-source.ts`(票据与换票)、`resume.ts`(续播:5 s 节流 + keepalive)、
  `segment-list.tsx`(自带滚动容器、译文行、当前句描边)、`use-translate-toggle.ts`(「译」开关,按条目存本机)。
- W2 的接缝(占位,之后归 W2,**导出名与签名是 W1 / W2 的接口**):`shadow-panel.tsx`、`use-translations.ts`。
- 测试:`test-fixtures.ts`(snake_case 样例)、`test-i18n.ts`(`setUiLanguage`)、`library-contract.test.ts`(对 `server/tests/fixtures/library_contract.json`)、
  `library-lazy.test.ts`(主包守卫)、`library-css.test.ts`(样式源码断言)。

## Public surface
`index.ts`:`LibraryListPage`、`LibraryPlayerPage`(懒包装)、`useLibraryEnabled`。其他目录不导入 library 的内部文件。

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`settings/`、`i18n/`、`@renderer/*`。W1 不导入任何别的 feature;W2 加的 `library->practice` 写在 `src/architecture.test.ts` 的基线里。

## Test
`cd web && yarn vitest run src/features/library`。播放逻辑用假的媒体对象与手动帧测(jsdom 的 `play()` / `pause()` 未实现);页面测试里 `vi.spyOn(HTMLMediaElement.prototype, "play")`。
假对象只证明逻辑,不代表 iOS / 安卓上的行为。`test.css = false`:样式只能读源码断言。

## Pitfalls
- 隐私:URL 里只有 uuid、分片序号与句序号(查询串只有列表 `cursor` 与服务端给的 `ticket`);标题、文件名、链接、句子、译文只在请求体 / 响应体里;multipart 文件名中性;
  不 `console.*` 票据 URL、标题或文字;本机存储里只有条目 id 与布尔值。
- 媒体只能用票据 URL(`<video>` 发不了 Bearer);封面用 Bearer 取 blob 再 `createObjectURL`,卸载时撤销。
- 主包预算 +1.5 kB gzip:主包模块不得静态导入懒模块、`./locales`、`./library-root`、`./library.css` 或 `./fx/*`(`library-lazy.test.ts`)。
- 页面测试里的中文断言用 `setUiLanguage("zh-CN")`,不要只调 `i18n.changeLanguage`(`SettingsProvider` 会把语言改回去)。
- 新文案放 `locales/`(不是 `i18n/`),en 与 zh-CN 同步;`web.library.shadow.*` 子树归 W2。
- 视觉规则(`library-css.test.ts` 守着):变量只在 `.library-root` 上(Portal 里的内容,如 `BottomSheetContent`,自己带 `library-root` 类);一屏模糊层 ≤ 3
  (播放器 = `GradualBlur` + 控制胶囊 + 全站底栏,压在视频上的顶栏胶囊不模糊);动画只用 transform / opacity / background-position(例外:`.lib-glow` 的 `--lib-a`、`.lib-bw` 的 filter);
  `html.lite`、`prefers-reduced-motion`、`prefers-reduced-transparency` 都有降级;JS 驱动的效果先问 `fx/motion.ts` 的 `motionAllowed()`。W2 的样式放它自己的文件,不改 `library.css`。
- 播放器版式:根是不滚动的 flex 列,滚动只在 `SegmentList` 的 `.lib-segments` 里;控制胶囊 `z-index ≤ 30`(选词操作条是 `z-40`,会盖住它);`sticky` 的下沿要把底栏高度算进去。
  非当前行用 `content-visibility: auto`(paint containment):行内弹出层必须走 portal。
- 速度用本目录的 `RATES` 并设 `preservesPitch`,不要用全局 `PLAYBACK_RATES`(那是 TTS 的)。
- `shadow-panel.tsx` 与 `use-translations.ts` 的导出名与签名是 W1 / W2 的接口,改它们要两边同改。
- 失败原因只显示 `error_kind` 的本地化文案,从不显示服务端或上游的原文;`drm`、`blocked` 用专门文案。
- 未做:改标题、给 ready 条目替换字幕的界面(API `patchItem({title})`、`putItemSubtitles` 已有);`auth/device-data.ts` 登出时不清 `enjoy-web.library.translate.*`(归 Z)。
```

- [ ] **Step 2: `web/README.md`** —— 在「## 智能体导师模式「带我学」」一节之后、「## E2E(Playwright,真实上游)」之前插入:

```markdown
## 跟读库(计划 2026-10-13)

服务端开关 `LIBRARY_ENABLED`(默认关,见 `server/README.md`「跟读库」)。关闭时网页与原来一样:底部没有「跟读库」标签,页面加载只多一次 `GET /api/library/config`;直接打开 `/library` 回练习页。

- **入口与路由**(`src/features/library`):底部标签「跟读库」(练习 · 对话 · 联机 · 跟读库 · 我的,最多 5 个)→ `/library` 列表(封面、时长、句数、字幕来源、大小;处理中的阶段步骤条与进度每 3 秒刷新,页面在后台时停;失败原因与「重试 / 补传字幕 / 删除」;已用空间)→ `/library/:id` 播放器。两页都懒加载。
- **添加素材**:上传(8 MiB 分片串行,每片自动重试 3 次,可取消;同一会话内失败可重试续传,刷新后在「上传未完成」卡上重新选择同一个文件继续;上传中离开页面会提示)与链接(管理员开启 `LIBRARY_LINK_IMPORT_ENABLED` 后可用;受 DRM 保护的流媒体服务无法导入,链接页签常驻说明)。
- **播放器**:句子列表(当前句流动描边并自动滚动,手动滚动后 3 秒内不抢)、上一句 / 播放 / 下一句、单句循环(关 / 无限 / 每句 3 遍 / 5 遍)、速度 0.5–1.25(弹性滑块吸附四档,每条素材记住,保持音高)、盲听、点句子跳播、续播位置(播放中每 5 秒、暂停、切到后台与离开时保存)。服务端开了 AI(`LIBRARY_AI_ENABLED`)且界面语言不是英文时,控制条有「译」开关:每句下面一行译文(按条目记在本机)。媒体经短期票据地址播放,过期自动换新。跟读录音与评测、点词查词、加入练习清单、句子微调、AI 分析由计划 W2 加入。
- **外观**:「我的 → 外观」可选跟随系统(默认)/ 浅色 / 深色,只存本机;跟读库页面是深色优先的玻璃外观(只在跟读库,浅色同样支持);系统开了「减少动态效果」或低端机(`html.lite`)时动效静止、玻璃退为实色。
- **隐私**:地址里只有条目 id、分片序号与句序号;标题、文件名、链接、句子、译文只在请求体 / 响应体里;网页不请求任何第三方,链接由服务器下载,译文由服务器调大模型。
- 契约:`src/features/library/library-contract.test.ts` 逐键核对 `server/tests/fixtures/library_contract.json`。主包净增量见 `docs/superpowers/plans/2026-10-13-video-import-results.md`「W1」。
- **未验证**(同上结果文档「W1 · 未验证」):iOS Safari / 安卓 Chrome 上的拖动定位与 Range、单句循环精度(rAF 轮询)、`playsInline`、倍速保持音高、切后台与锁屏时循环是否继续、`keepalive` 保存、文件选择器对扩展名 `accept` 的表现、数百 MB 文件在手机网络上的分片上传、反向代理下的分片与 Range;玻璃模糊的真机性能与耗电、旋转描边与极光的表现、5 个标签在 360 px 宽下的版式、固定为浅 / 深时 iOS 主屏的状态栏颜色、选词操作条盖在控制胶囊上的表现;读屏。
```

- [ ] **Step 3: 构建与体积验收**(本车道的验收项,需要构建一次):

```bash
cd /e/workspace/everyone-can-use-english
yarn web:typecheck
yarn web:build
cd web && node scripts/check-main-bundle.mjs --max-delta=1.5
node -e "const fs=require('fs'),z=require('zlib'),d='dist/assets';let t=0;for(const f of fs.readdirSync(d).filter((f)=>f.endsWith('.js'))){const b=fs.readFileSync(d+'/'+f);const s=b.toString();if(/^(library-list-page|player-page)-/.test(f)||s.includes('/api/library/uploads')||s.includes('Loop each sentence')){const k=z.gzipSync(b,{level:9}).length/1000;t+=k;console.log(f,k.toFixed(2),'kB')}}console.log('library lazy js total',t.toFixed(2),'kB')"
node -e "const fs=require('fs'),z=require('zlib'),d='dist/assets';for(const f of fs.readdirSync(d).filter((f)=>f.endsWith('.css'))){const s=fs.readFileSync(d+'/'+f);if(s.toString().includes('library-root')){console.log(f,(z.gzipSync(s,{level:9}).length/1000).toFixed(2),'kB gzip (library.css)')}}"
```

`check-main-bundle` 失败(相对 LA 末尾重录的基线,净增量 > 1.5 kB)就停下:找出进了主包的库代码(通常是某个主包模块静态导入了懒模块,或 `bottom-nav.tsx` 拉进了不该进的东西),挪进懒块后重测;**不放宽预算、不重录基线**(终录归 Z)。懒块合计 > 40 kB、`library.css` + 效果 > 6 kB 只记录、不阻塞(spec 写的是目标;效果的 JS 部分混在懒块里,无法单独量,只报 CSS 的实数并注明)。

- [ ] **Step 4: 结果文档** —— 在 `docs/superpowers/plans/2026-10-13-video-import-results.md` 的「W1」一节里,把「L16 合并前实测」与「未验证(W1)」两小节替换为:

```markdown
### L16 合并前实测
- 提交:<git rev-parse --short HEAD 的输出>
- 主包(库自己的预算,基线是 LA 末尾重录的):`check-main-bundle --max-delta=1.5` 原样输出两行(基线 → 现在,净增量);外观设置的增量见上面「LA」一节
- 懒块:上面 `node -e` 的逐行输出与合计(目标 ≤ 40 kB gzip);`library.css` 的 gzip 大小(spec §11.4a 的「样式 + 小组件 ≤ 6 kB」目标只能量到 CSS 这一半)
- 目标测试:`yarn vitest run src/features/library src/layout src/settings src/pages/me-page.test.tsx src/architecture.test.ts` 的通过数(全量 `yarn web:test` 未跑,按用户要求再跑)
- 契约测试里被跳过的用例:<列出 import / translate / analysis / error_texts / error_kinds 中缺省的键>(归 Z)

### 未验证(W1)
没有在真机 / 真实上游运行过,以下全部未验证:
- iOS Safari(含主屏 PWA)与安卓 Chrome:`playsInline`、拖动定位(依赖服务端 206)、单句循环的回跳精度与卡顿、倍速下 `preservesPitch`、锁屏 / 切后台时 rAF 停止后循环不再生效(句子会自然播下去)、`visibilitychange` / `pagehide` 时 `keepalive` 的 PATCH 是否送达、票据过期(30 分钟)后的自动换票
- 文件选择器:iOS「文件」与相册对 `accept="audio/*,video/*,.mp4,…"` 的表现;数百 MB 文件在手机网络上的分片上传(超时、切网、锁屏)
- 反向代理(Nginx / Caddy / Cloudflare)下的分片请求体上限与 Range 透传
- 视觉(只有源码断言与 jsdom,没有任何真实渲染):玻璃模糊(34px / 饱和 200%)在真机上的性能与耗电、`@property` 旋转描边(iOS Safari 的支持情况)、极光色块的漂移与首屏范围、卡片依次浮入、速度滑块的弹性手感与指针拖动、`content-visibility: auto` 行与当前行投影、页面底色延伸到底栏下面(负外边距)与 `sticky` 悬浮按钮的位置、`env(safe-area-inset-*)` 写在自定义属性里的表现、`.lite` 与 `prefers-reduced-motion` / `prefers-reduced-transparency` 下的实际观感、深色 / 浅色两套数值的对比度
- 5 个底部标签在 360 px 与 375 px 宽下是否溢出(按 72 px 每列只做了字数与算术核对);选词操作条(`z-40`)盖在控制胶囊上的表现与 iOS 程序化选区触发查词
- 外观设置:固定为浅 / 深时 `theme-color` 的改写在 iOS 主屏 PWA 的状态栏上的表现;`color-scheme` 对原生控件(滚动条、`<select>`)的影响
- 译文:译文开关 + `translate` 的真实调用要等 W2 的 `use-translations` 与 S1 的端点;本车道只验证了合并与渲染(用假实现)
- 读屏(VoiceOver / TalkBack)读控制胶囊、速度滑块、进度条与盲听按钮;360 px 宽下控制胶囊四个芯片与英文标签
- 未做(归 Z,R-L22):`features/CLAUDE.md` 的 feature 清单、`web/e2e` 的守卫与用例、登出时清 `enjoy-web.library.translate.*`
```

- [ ] **Step 5: 安全评审** —— `security-review`(重点:URL / 日志 / 错误 / toast 里没有标题、文件名、链接、句子、译文与票据;multipart 文件名中性;keepalive 只发往同源;没有第三方请求;本机存储只有条目 id 与布尔值)。修复后单独提交。
- [ ] **Step 6: 提交**

```bash
git add web/src/features/library/CLAUDE.md web/README.md docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "docs: library web lane notes, README section and measured bundle numbers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## 自查(写计划时)

- spec §11.1:路由 `/library`、`/library/:id` 懒加载(L15);添加素材是底部弹层不是路由(L8);入口 = 底部标签 `LIBRARY`,由 `useLibraryEnabled()` 控制,关闭时标签不出现、直达路由跳回 `/practice`(L15、L9、L14;E9)。
- spec E9:标签顺序、最多 5 个、标签文字 ≤ 4 汉字 / 8 英文字符(L2 的文案测试、L15 的 `bottom-nav.test.tsx`);layout 导入 feature 的 `index.ts`、不新增跨 feature 边、不新增 `practiceHome` 扩展点(L15 的 `library-lazy.test.ts` 守着);`glass-tab-bar` 5 列算术核对(R-L1、R-L24)。
- spec §11.2:封面经 blob 懒取、音频图标、标题、时长、句数、字幕来源徽标、大小(L7);阶段与进度、3 s 轮询、不可见时停(L6、L7);失败原因与重试 / 补传字幕 / 删除,`drm` / `blocked` 专门文案(L2、L7);删除二次确认(L9);已用空间(L9,CountUp)。
- spec §11.3:上传页签 accept 白名单、可选字幕、标题、进度 + 取消、分片串行、每片重试 3 次、离开前提示(L4、L5、L8、L9);刷新后「重新选择同一个文件继续」(L9、R-L10);链接页签 DRM 文案常驻、开关关只显示说明(L8)。
- spec §11.4(W1 部分):视频 16:9 `playsInline`、音频图标(L14);句子列表高亮与 3 s 不抢滚动(L13);上一句 / 播放 / 下一句、循环 关 / 无限 / 3 / 5、速度 0.5–1.25 存 `rate_pct`、`preservesPitch`、盲听、点句子跳播(L10、L13、L14);rAF 精确循环(L10);续播(L11);票据换票、处理中只显示进度、失败不进播放器(L12、L14);**双语(D8):「译」开关 + 每句译文行 + 骨架 + 固定提示,盲听时同样隐藏(L1、L13、L14、R-L32)**。跟读、点词、加入练习清单、微调、⋯ 菜单、AI 分析卡归 W2(接缝 R-L16、R-L32)。
- spec §11.4a(D11):12 个效果全部自写、无新依赖、只在跟读库(LV1–LV3);一屏模糊层 ≤ 3(R-L26,有测试);降级与减少动态效果有样式源码断言(`library-css.test.ts`);组件逻辑有单元测试(ElasticSlider 吸附、CountUp 终值、BlurText 逐字、ClickSpark 清理);真机表现标「未验证」(L16)。
- spec D12:全站外观设置(LA):`settings/` 的 `colorScheme`、`layout/color-scheme.ts` 读设置并切 `html.dark`、「我的」里一行、文案与测试;库页面不另设开关。
- spec §11.5:文案、体积、测试(L2、L16;文案位置偏离见 R-L3)。spec §15:只碰 W1 的文件(含 D8 / D12 增补);`shadow-panel.tsx`、`use-translations.ts` 先放占位;`main-bundle-baseline.json` 在 L0 与 LA 重录。
- 偏离 spec 的地方(都写了理由,见 Addendum「与 spec 的偏差」):R-L3(文案大部分放 `locales/`)、R-L4(W2 的文案子树)、R-L26(播放器顶栏胶囊不模糊)、R-L29(两处动画属性例外)、R-L30(极光只覆盖第一屏)。

---

## Addendum (2026-10-13)

> 本节记录 2026-10-13 对本计划的更新(spec 当天修订:D8 译文与分析、D9 入口 = 独立底部标签、D11 深色优先强玻璃、D12 外观开关)。**这里的裁定(R-L24 起)覆盖正文里与之冲突的旧文字**;正文的任务已就地改写。验证口径见文首「写计划时的实跑」:目标测试与类型检查在一份临时副本里跑过,构建 / 体积 / 渲染 / 真机没有。

### 一、改动清单(按任务)

| 任务 | 改动 |
|---|---|
| 文件头 / Goal / Architecture / Spec / Global Constraints | 入口由「练习页入口卡」改为底部标签;加外观设置、视觉层、译文行;文件归属改写(不再碰 `plugins/`,新增 `layout/`、`settings/`、`pages/`);隐私补译文与句序号;视觉与 i18n 约束重写;体积记账分开 |
| 文件结构 / 共享文件 / 跨计划假设 | 树与表按新文件重写;加 D8 的端点形状与契约键;W2 的 D8 增补与对 `fx/` 的使用;Z 不再需要给「练习」加 `also` |
| L0 | 核对清单换成底部栏、色彩方案、设置、`.lite`、选词操作条;结果文档模板加「LA」一节 |
| **LA(新)** | 全站外观设置:`settings/color-scheme-pref.ts`、`settings-context.tsx` 加 `colorScheme`、`layout/color-scheme.ts` 读设置并改 `theme-color`、`color-scheme-sync.tsx`、`app.tsx`、「我的」外观行、文案、测试(含对整个存储对象的三处旧断言)、末尾记主包增量并重录基线 |
| L1 | `LibraryConfig.ai`;`LibrarySegment` 的可选 `zh` / `zhLang` / `analysis` / `analysisLang`;`translateSegments`、`analyzeSegment`、`isAiLimited`、`MAX_TRANSLATE_BATCH` 与类型;`translation-state.ts`;`test-i18n.ts`(修复旧测试的语言写法);夹具与测试同步 |
| L2 | eager 文案只剩 `web.nav.library`;懒文案加译文 / 芯片 / 速度滑块 / 已用空间 / 额度键;`usage` 键换成 `usedLabel` |
| L3 | 键表加 `ai` 与句子的四个 D8 键;可选 `translate`、`analysis` 夹具键;S1 D8 未合并时停下 |
| **LV1–LV3(新)** | `library.css`(令牌、全部 `.lib-*` 类、降级段)、`library-root.tsx`、`fx/` 12 个效果与测试、`library-css.test.ts` 的硬规则断言 |
| L7 | `ItemCard` 改用 `SpotlightCard` / `ShinyText` / `Stepper`、依次浮入、绿色就绪徽标;`PRIMARY` 改为玻璃光带按钮、`FIELD` 加 `lib-field`;测试加阶段步骤条等;修正语言写法 |
| L8 | `AddSheet` 内容带 `library-root lib-sheet`(Portal 里也得到变量);修正语言写法 |
| L9 | 页面套 `LibraryRoot`;去掉返回键(标签根页);「已用空间」条 + `CountUp`;「添加」改为贴底栏的光带悬浮按钮;修正语言写法 |
| L10–L12 | 不变(`nextRate` 保留不用) |
| L13 | `SegmentList` 重写:自带滚动容器、译文行与骨架、当前句 `.lib-glow`、`pending` / `native` / `showTranslation` 入参、减少动态效果时 `behavior: "auto"`;新增 `use-translations.ts`(W2 占位)与 `use-translate-toggle.ts` |
| L14 | 播放页重写:`LibraryRoot.lib-player` 的不滚动 flex 列、顶栏胶囊(不模糊)、`GradualBlur`、玻璃控制胶囊、`ElasticSlider` 速度弹出层、「译」芯片与固定提示;修掉旧版 `sticky bottom-0` 控制条会落在底栏后面的缺陷 |
| L15 | 入口卡 / `register.tsx` / `plugins` 全部作废;改为 `use-library-enabled.ts`、`bottom-nav.tsx` 的 `LIBRARY` 标签、`bottom-nav.test.tsx` 整文件替换、`feature-flags.test.tsx` 三处、`layout/CLAUDE.md`;`library-lazy.test.ts` 守住主包模块与「没有入口卡」 |
| L16 | `CLAUDE.md` 与 README 按新入口 / 外观 / 视觉 / 译文重写;体积验收加 `library.css` 的 gzip;结果文档加视觉、标签、外观、译文的「未验证」 |

### 二、新裁定

- **R-L24 入口 = 底部标签(spec E9,取代 R-L5)。** 读真实代码:`layout/bottom-nav.tsx` 的 `Tab` 数组 + `useRoomsEnabled()` 决定标签数,`GlassTabBar columns={items.length}` 用 `repeat(N, minmax(0, 1fr))`;每项 `h-14`、11px 标签、24px 图标、无水平内边距;`under()` 让 `/library/i1` 高亮、`/libraryx` 不高亮。裁定:`LIBRARY` 标签(`/library`、`nav-library`、`ClapperboardIcon`、`web.nav.library`)排在「联机」之后、「我的」之前;`useLibraryEnabled()` 放在 `features/library/use-library-enabled.ts`(只包 `useLibraryConfig`,按 `ApiClient` 缓存),由 `index.ts` 导出;layout 经 `~/features/library` 导入它是现有做法(rooms 同理),`architecture.test.ts` 的 `CROSS_FEATURE_BASELINE` 不变、不新增 `practiceHome`。**360 px 核对**:每列 72 px;标签文字限定 ≤ 8 个英文字符 / ≤ 4 个汉字(en:`Practice` 8、`Library` 7;zh:`跟读库` 3),按 11px 字号英文最长约 50 px,汉字 4 个约 44 px,都小于 72 px;这是算术与字数核对,**真机版式未验证**。`src/architecture.test.ts` 已在带本计划文件的临时副本里跑过(11 个用例全绿:layout 经 `~/features/library` 导入不算跨 feature 边)。`bottom-nav.test.tsx` 现有三处 `calls.toHaveLength(1)` 会因多一个请求而失败,所以整文件替换并改成只数 `/api/rooms/config`;`feature-flags.test.tsx` 的 off / on 断言同步(关 = 原样 3 个标签)。`/library/*` 高亮由跟读库自己的标签承担,「练习」的 `also` 不动,Z 不再有这件事。
- **R-L25 外观设置(spec D12)。** 读真实代码:`initColorScheme` 只读 `prefers-color-scheme`;`useIsDark` 靠 MutationObserver 跟随 `html.class`;`settings-context` 把 `{language, roomVoiceAutoText}` 存在 `enjoy-web.settings`、逐项校验、写一项带上其余项;`index.html` 有两条带 `media` 的 `theme-color`;`ThemedToaster` 在测试里不带 `SettingsProvider`。裁定:`ColorScheme = "system" | "light" | "dark"`(默认 `system`,字段缺失 / 非法回落默认),类型与 `readStoredColorScheme()` 放 `settings/color-scheme-pref.ts`(不依赖 React 与 i18n,所以 `layout/color-scheme.ts` 可以在 `main.tsx` 渲染前读它,首屏不闪;`main.tsx` 不改);`applyColorScheme` 把偏好存成**模块级变量**,系统主题变化的监听用「当前」偏好;应用 = 切 `html.dark`、设 `color-scheme`(原生控件)、改写两条 `theme-color`(固定时两条同色并去掉 `media`,回到系统时还原);偏好变化由 `layout/color-scheme-sync.tsx` 的 `ColorSchemeSync` 在 `SettingsProvider` 里应用(不放进 `ThemedToaster`,它的测试没有 Provider)。入口:「我的 → 通用」里语言行之前的一行 `SelectRow`(`me-color-scheme`)。库页面不另设开关;不改任何其他页面(全站本来就有 `.dark` 变量)。三处整个存储对象的 `toEqual`(`settings-context.test.tsx` ×3、`me-page.test.tsx` ×1)同步改。iOS 主屏状态栏表现**未验证**。
- **R-L26 模糊层预算(spec §11.4a,「核对」)。** 规则:一屏模糊层 ≤ 3(`index.css` 的注释同一条)。读真实代码:全站底栏 `GlassTabBar` 是 `.glass`(模糊 20px),在播放器里一直在;spec 写「播放器:顶栏、渐进模糊、控制条」三层,再加底栏就是 4 层。裁定:**播放器的顶栏胶囊不模糊**(半透明填充 + 高光边,`.lib-bar`),因为它压在 `<video>` 上(视频上做 `backdrop-filter` 在手机上很贵),于是播放器 = `GradualBlur` + 控制胶囊(`.lib-glass`)+ 全站底栏 = 3;速度弹出层用接近不透明的 `--lib-pop` 填充、不模糊。列表页 = 顶栏(滚动后)+ 底栏(+ 添加弹层打开时的 `.lib-sheet`)≤ 3。`library-css.test.ts` 数 `-webkit-backdrop-filter: blur` 恰好 3 处(`.lib-glass`、`.lib-gblur`、`.library-root.lib-sheet`);`player-page.test.tsx` 数播放器里 `.lib-glass, .lib-gblur` 恰好 2 个。
- **R-L27 视觉层的文件与作用域。** `library.css` 由 `library-root.tsx` 与 `add-sheet.tsx` 导入,只在懒块里(主包守卫测试拒绝主包模块导入 `./library-root`、`./library.css`、`./fx/*`);变量只在 `.library-root` 上定义(light 默认,`.dark .library-root` 覆盖);文字颜色沿用全站令牌 `rgb(var(--ink))`。`BottomSheetContent` 经 Radix Portal 渲染在 `body` 下,不在页面根里,所以 `AddSheet` 给它自己加 `library-root lib-sheet`(`.library-root.lib-sheet` 特异性高于 Tailwind 的 `bg-surface`、`rounded-t-sheet`、`w-full`、`inset-x-0`,用 `width: auto` + `left/right: 8px` 做成悬浮板)。`.lib-page` 把页面底色延伸到全站底栏下面(`padding-bottom` 与等量负 `margin-bottom` 取 `--lib-tab = 3.5rem + safe-area`),让底栏玻璃后面是库的底色而不是全站底色。`vite.config.ts` 的 `test.css = false`:样式只能读源码断言,真实渲染未验证。
- **R-L28 降级(「核对」`glass-quality.ts`)。** 读真实代码:低内存设备给 `<html>` 加 `.lite`,`index.css` 的 `.glass` 用 `@supports` + `html.lite` + `prefers-reduced-transparency` 三层。库照这个写法:`@supports not (backdrop-filter)` 与 `prefers-reduced-transparency` → 玻璃实色、渐进模糊隐藏;`html.lite` → 去模糊、去动画、玻璃退为 `--lib-solid`、极光半透明;`prefers-reduced-motion` → 全部 `animation: none` 并关 transition;`background-clip: text` 不支持时文字不能变透明(`@supports` 守卫,回退纯色)。JS 驱动的效果(CountUp、BlurText、ClickSpark)先问 `fx/motion.ts` 的 `motionAllowed()`(`html.lite` 或 `prefers-reduced-motion`),帧源可注入。`library-css.test.ts` 逐项断言。
- **R-L29 动画属性与两处例外。** 规则:动画只用 `transform` / `opacity` / `background-position`。比样稿更严:样稿里的 `box-shadow` 脉冲、`width` / `left` 过渡都改成 `::after` 的 `transform` + `opacity`、`scaleX` 与 `translateX`(包括 `ElasticSlider` 的填充与旋钮、光带扫过)。两处例外:`.lib-glow` 的 `--lib-a`(`@property` 注册的角度,只重绘不触发布局;不支持 `@property` 的浏览器里 `var(--lib-a, 0deg)` 保证 `background` 仍然有效,退化为静态描边)与 `.lib-bw` 的 `filter: blur`(`BlurText` 一次性,超过 120 个词就整段淡入)。`library-css.test.ts` 解析每个 `@keyframes` 的属性并只放行这些。
- **R-L30 极光范围。** `SoftAurora` 是 `.lib-page` 里的绝对定位层,高度 `min(100%, 100dvh)`:播放器里铺满根,列表页只覆盖**第一屏**,往下滚后是纯页面底色(随内容滚走)。理由:`position: sticky` / `fixed` 的整页极光会遇到 `overflow`、`<main>` 滚动区与公告横幅的叠放问题(固定层会盖住横幅;sticky 受 `overflow` 祖先约束),代价与风险都大于收益;卡片只用半透明填充,不依赖背后一定有色块。**偏离样稿**,真机观感未验证。
- **R-L31 弹性速度滑块。** `ElasticSlider` 吸附 `RATES = [0.5, 0.75, 1, 1.25]`(不碰全局 `PLAYBACK_RATES`),替代原来的循环按钮;点「1×」芯片弹出、Esc 或点别处收起;键盘 ← → ↑ ↓ 可用,`role="slider"` 带 `aria-valuetext`。弹性手感只来自 transform 的回弹缓动。`nextRate` 与它的测试保留(L10 不动),播放页不再调用。
- **R-L32 译文接缝(spec D8 / E11 / E12,§15「D8 增补的归属」)。** 读真实代码:`features/chat/conversation-page.tsx:189` 的先例 `canTranslate = native !== "en-US"`;`nativeLanguageCode(language)` 在 `settings`。裁定:`LibrarySegment` 加可选的 `zh` / `zhLang` / `analysis` / `analysisLang`;`translation-state.ts` 的 `zhFor`(语言不一致的旧译文视为失效,E11)、`needsTranslation`、`mergeTranslations`;`library-api.ts` 的 `translateSegments`(≤ 20 句,`{items, limited}` 或裸数组两种回包)、`analyzeSegment`、`isAiLimited`(429)。「译」芯片只在 `config.ai` 为真**且**母语不是 `en-US` 时出现(英文界面没有可译的目标语言,同 chat R16),开关按条目存本机(`enjoy-web.library.translate.<id>`,键里只有 id,值是布尔)。**W1 / W2 的分工**:W1 渲染译文行 / 骨架 / 固定提示并把 `onTranslated` 合进句子表;W2 用真实实现替换 `use-translations.ts` 去批量取(锚点 = 当前句前后各 10 句,spec E12 的「视野」用当前句近似,W2 可改用 `IntersectionObserver`)。**签名(W2 必须保持)**:`useTranslations(args: { itemId: string; enabled: boolean; segments: readonly LibrarySegment[]; anchorIdx: number; native: string; onTranslated(items: { idx: number; zh: string }[]): void }): { pending: ReadonlySet<number>; notice: "limited" | "failed" | null; retry(): void }`。盲听时译文与骨架同样不渲染(spec §11.4)。W2 的 `segment-menu.tsx` / `analysis-card.tsx` 挂在行内,**非当前行的 `content-visibility: auto` 带 paint containment,行内弹出层要走 portal**。
- **R-L33 播放器版式、视口锁与选词操作条。** 读真实代码:`html` / `body` 已固定(`index.css`),`AppShell` 的 `<main>` 是唯一滚动区且底部留出底栏高度;`position: sticky; bottom: 0` 贴的是滚动区(含内边距)的下沿,会被底栏盖住 → 旧版 L14 的控制条有这个缺陷。裁定:播放器根是 `.lib-player`(`flex: 1 1 0; overflow: hidden`)的不滚动 flex 列,滚动只发生在 `SegmentList` 的 `.lib-segments` 里;控制胶囊 `position: absolute; bottom: calc(var(--lib-tab) + 10px)`;列表页的「添加」悬浮按钮用 `sticky` 且 `bottom` 里把 `--lib-tab` 算进去。**已合并的选词操作条**(`features/lookup/lookup-bar.tsx`:`absolute bottom-[calc(4.5rem+safe)] z-40`,挂在 `AppShell` 根下)会在选区稳定后盖在控制胶囊上,所以胶囊 `z-index ≤ 30`、渐进模糊 20、速度层 35;句子文字区 `user-select: text`(`library-css.test.ts` 断言),点击在有选区时不跳播(R-L16)。真机表现未验证。
- **R-L34 列表页是标签根页。** 去掉返回键与 `PageHeader` 的 `subtitle`;「已用 X / 配额 Y」改为 `lib-quota` 条(`CountUp` + `scaleX` 的填充条);「添加」是贴底栏上沿的 `PRIMARY` 光带悬浮按钮(`data-testid="library-add"` 不变);`ItemCard` 带 `index`,浮入延迟最多 8 档(`0.07 s` 一档)。
- **R-L35 体积记账。** 外观设置(`color-scheme-pref`、`settings-context` 多一个字段、`color-scheme` 多几十行、「我的」一行与文案)是主包代码,不属于库的 1.5 kB 预算。LA 末尾构建并把增量写进结果文档,然后重录基线;L16 的 `--max-delta=1.5` 量的是库自己的主包增量(`use-library-enabled`、`bottom-nav` 一个标签、一条文案、两条路由、`index.ts` 多一个导出)。库内样式 + 小组件 ≤ 6 kB gzip 是目标:CSS 能量到实数,效果的 JS 混在懒块里量不出来,只报总数。`index.ts` 现在从 `use-library-enabled` 导出,仍不得静态导入懒模块(`library-lazy.test.ts`)。
- **R-L36 页面测试的语言写法(修旧计划缺陷)。** 读真实代码:`SettingsProvider` 的 `useState` 初始化器 `readStored().language ?? detectLanguage(navigator.language)` 之后调 `i18n.changeLanguage(initial)`;jsdom 的 `navigator.language` 是 `en-US` → `renderWithProviders` 会把测试里手动设的 `zh-CN` 改回 `en`;仓库里别处的中文页面测试都先写 `localStorage["enjoy-web.settings"]`(`features/rooms/CLAUDE.md`)。所以旧版本计划里 L7 / L8 / L9 / L13 / L14 的「`beforeEach` 只调 `i18n.changeLanguage("zh-CN")`」第一次运行就会失败。裁定:新增 `test-i18n.ts` 的 `setUiLanguage` / `resetUiLanguage`,所有页面测试改用它;`test-i18n.test.tsx` 用一个对照用例证明「只调 `changeLanguage` 会被改回」(该用例若失败,说明 provider 不再重设语言,可以放宽,但 `setUiLanguage` 仍是正确写法)。

### 三、对其他计划的接口(「核对」处引 spec 原文)

- **S1**(spec §15「D8 增补的归属」S1 行与 §9):本计划假设 `GET config` 的 `ai`、句子的 `zh` / `zh_lang` / `analysis` / `analysis_lang`、`translate` 回 `{items:[{idx,zh}], limited?}`(或裸数组)、`analysis` 回 `{analysis, cached}` 且额度满 429、`native_language` 是 `en-US` / `zh-CN` / `es-ES`。S1 的契约夹具有出入时只改 `library-api.ts` 的类型、`translation-state.ts` 的一处映射与 L3 的键表。
- **W2**(spec §15 W2 行与「D8 增补」):接管 `shadow-panel.tsx`(R-L16 的签名)、`use-translations.ts`(R-L32 的签名),新增 `segment-menu.tsx`、`analysis-card.tsx`;可用 `fx/index.ts` 里的 `CountUp`、`GradientText`、`ClickSpark`、`BlurText`、`GlassSurface`、`useCountUp`、`motionAllowed` 与 `library.css` 的类;自己的样式放自己的文件,不改 `library.css`;`web.library.shadow.*` 文案子树仍归 W2。W2 的 R-SH02 假设「W1 渲染 `ShadowPanel` 一次、媒体区与控制条之间」,而 W1 按 R-L16 在**每一行**渲染它(spec §15 W1 行只说「`player-page.tsx` 引用 `shadow-panel.tsx`」)——W2 写明「W1 的真实名字优先」,以本计划 R-L16 为准。
- **Z**:`features/CLAUDE.md` 清单、`main-bundle-baseline.json` 终录、根 README、E2E 守卫、登出清 `enjoy-web.library.translate.*`;**不再需要**给「练习」加 `also`。
- **A 管理端**:无变化(`overview` 的译文 / 分析句数由 S1 / A 处理)。

### 四、与 spec 的偏差(都有理由)

1. **文案大部分放 `locales/` 而不是 `i18n/`(R-L3,沿用)**:约 170 个键放进 eager 会远超 spec 给的 1.0 kB 文案预算;E9 指定的 `web.nav.library` 仍在主包 `i18n/`。
2. **播放器顶栏胶囊不模糊(R-L26)**:spec 的三层 + 全站底栏 = 4 层,超出「≤ 3」;压在视频上做模糊也最贵。
3. **极光只覆盖列表页第一屏(R-L30)**:整页极光在 `<main>` 滚动区与横幅下不可靠。
4. **两处动画属性例外(R-L29)**:`--lib-a` 与 `filter`,都有降级与上限。
5. **列表页顶栏沿用全站 `PageHeader`(滚动后变玻璃),不是样稿的悬浮胶囊**:避免重写全站滚动联动的顶栏,并保持「不改现有页面外观」;列表页因此少一层常驻模糊。
6. **「译」芯片需要 `config.ai` 且母语 ≠ `en-US`**:spec 没写英文界面怎么办;沿用 chat 的 R16。
7. **译文取数的锚点用「当前句」近似「视野」(E12)**:自动滚动保证当前句附近就是视野;W2 可改。
8. **页面底色 `--lib-page` 与全站底色不同**:这是 D11「深色优先、强玻璃」的一部分,只在库页面。

### 五、核对中修正的问题(在临时副本里实跑发现的,都已改在正文里)

1. **页面测试的语言写法**(R-L36):旧测试只调 `i18n.changeLanguage("zh-CN")`,会被 `SettingsProvider` 改回 `en`。
2. **`ImportForm` 的 `<form>` 缺 `noValidate`**:`type="url"` 的原生校验先拦住提交(jsdom 与浏览器都会),本地校验与文案永远出不来。
3. **`library-api.test.ts` 的封面用例**:`new Response(new Blob(...))` 里的 jsdom `Blob` 被 Node 的 `Response` 转成字符串 `"[object Blob]"`(13 字节);改成给字节。`use-poster.test.tsx` 同。
4. **`use-poster.test.tsx` 的清理顺序**:自己的 `afterEach` 先于 RTL 的自动清理(vitest 的 after 钩子是栈序),把 `URL.revokeObjectURL` 还原成 `undefined` 后组件卸载再调它;先 `cleanup()` 再还原。
5. **`test-fixtures.ts`**:`limits: null` / `analysis: null` 的字面量在 `noImplicitAny` 下是隐式 any(TS7018),加了类型标注;`upload-client.test.ts` 里 `vi.fn(async () => {})` 的 `mock.calls[0]` 是空元组,改成 `vi.fn(async (_ms: number) => {})`。
6. **jsdom 26 没有 `PointerEvent` 构造函数**:`fireEvent.pointerDown(el, { clientX })` 传不进坐标(会得到 `NaN`);指针用例改用 `MouseEvent` 派发同名事件。
7. **`library-css.test.ts`** 的「3 处模糊」计数最初把 `@supports` 条件里的 `-webkit-backdrop-filter: blur(1px)` 也数进去了(得到 4);改成只数缩进的声明行。
8. **`bottom-nav.test.tsx` 三处 `calls.toHaveLength(1)`**(R-L24)与 **`add-sheet.test.tsx` 的 `LibraryConfig` 字面量**(缺 `ai`)是加字段 / 加请求带来的连带修改,已写进 L15 / L8。

### 六、风险与未验证

- **UNVERIFIED(真机)**:玻璃模糊性能 / 耗电;`@property` 旋转描边;极光;`content-visibility` 行;`sticky` 悬浮按钮与负外边距延伸;`env()` 写在自定义属性里的表现;5 个标签在 360 px 的版式;选词操作条盖在控制胶囊上;固定浅 / 深时 iOS 主屏状态栏;速度滑块的指针拖动手感。以上都只有源码断言与 jsdom 测试。
- **体积(粗略核对,不是构建实测)**:`library.css` 原文件 18.7 kB、gzip 6.1 kB;粗略去掉注释与空白后 gzip 约 3.6 kB(用 `zlib` 压缩文本得到,真实构建里还会过 PostCSS / Tailwind 与 esbuild 的 CSS 压缩,数字以 L16 为准);`fx/` 源码(不含测试)约 16 k 字符,压缩后大小没有量。两者加起来可能接近 spec §11.4a 的「样式 + 小组件 ≤ 6 kB gzip」目标上沿;L16 只能量到 CSS 的实数,超了只记录,先删 `.lib-*` 里最少用的规则,不放宽目标。构建与主包增量(L0、LA、L16)没有跑过。
- **风险**:(a) W2 的 `ShadowPanel` 假设与 R-L16 不同(见上),以 R-L16 为准,但 W2 要读 W1 合并后的代码确认;(b) S1 的 D8 端点形状未定稿,L3 在 S1 D8 未合并时会停下;(c) `bottom-nav` 多一次配置请求,依赖「请求计数」的其他现有测试若有遗漏,会在 L15 的目标测试里暴露,按「只数关心的路径」修;(d) `library.css` 的 `.lib-page` 负外边距与 `AppShell` 的内边距耦合,若 `GlassTabBar` 高度变了要同步 `--lib-tab`;(e) 外观设置改了 `settings-context` 的存储形状,旧版本只有 `language` 的存储仍能读(逐项回落)。
- 任务数:21(L0、LA、L1–L16、LV1–LV3)。
