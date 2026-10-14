# 精选库 · 管理端界面(车道 AU)· 结果

- 日期:2026-10-14 · 分支 `feat/curated-cl-adm` · 计划 `2026-10-14-curated-library-admin-ui.md`(Task 0–5)
- INDEX 的名字、路由、形状、签名**未改动**。对照 `server/app/routers/admin_catalog.py`、`app/admin/catalog_admin.py`、`catalog_store.admin_out / segment_admin_out` 核对过客户端类型,与 INDEX §6 一致。

## 已做

| 任务 | 提交主题 |
|---|---|
| 1 | `feat(admin): FormData bodies in the API client` |
| 2 | `feat(admin): catalog API client, strings and chunked upload` |
| 3 | `feat(admin): catalog page with import and upload dialogs` |
| 4 | `feat(admin): catalog detail drawer (listen, edit, publish, delete)` |
| 5 | `feat(admin): catalog navigation and route` |

测试(仅定向):`src/api/client.test.ts` 11;`src/features/catalog` 19(api 5、upload 3、page 5、detail 6);
加 `components/layout.test.tsx`、`features/library`、`app.test.tsx`、`src/api` 共 11 个文件 63 条通过;`yarn typecheck` 通过。
管理端没有单独的架构测试(`web/src/architecture.test.ts` 只管网页),按计划的依赖规则手工遵守:catalog 不导入其他 feature,`layout.tsx` 只导入 `catalog/strings.ts` 与 `catalog-icon.tsx`,`app.tsx` 只从 `index.ts` 导入。

## 裁定与偏差

1. 署名用 `Co-Authored-By: Claude Sonnet 5.5`(派发指令),不是计划里的 Opus 5.5。
2. **R-AU7(新增)错误映射补全**:服务端实际还会返回计划 `S.errors` 没列的英文串(`Sentence not found`、`No changes`、`Confirmation required`、`Upload is not in progress`、`Upload expired`、`Unexpected chunk`、`Wrong chunk size`、`Upload is incomplete`、`Subtitles cannot be changed now`、`Invalid subtitle file`、`File is required`、`Invalid title`),已加中文映射(只改 `strings.ts`,不影响接口)。
3. 计划的文案表补了几个界面串:`S.empty`、`S.form.tooLarge`、`S.detail.{text,zh,startMs,endMs,close,saveMeta}`。元数据「保存」按钮叫 `saveMeta` 且仅在有改动时出现,避免与句子编辑的「保存」同名(测试按名字点击)。
4. 新增 `meta-fields.tsx`(导入 / 上传两个对话框共用的元数据表单与 `metaOf`),计划文件清单未列,但在 `features/catalog/*` 归属内。
5. 导航「内容」组加了 `/catalog`(R-AU1);`admin/README.md` 功能表里本来没有「跟读库」一行,只加了 catalog 一行。
6. `features/library/strings.ts` 的 `S.source` 没有 `catalog` 键(归属不在 AU),跟读库页遇到 `source: "catalog"` 的行会显示原文 `catalog`;若要中文「精选」需在后续改动里补一个键。
7. 新文件用 Write(LF),改旧文件保持 CRLF;Git 提示 LF/CRLF 转换警告,无内容影响。
8. 先写测试再实现的节奏:Task 1 严格先红后绿;Task 2–4 测试与实现同批写出后一并运行(均一次绿)。
9. 本计划未包含「失败且 `no_subtitles` 时补传字幕」的界面(服务端 `PUT /uploads/{id}/subtitles` 支持),`errorKinds.no_subtitles` 文案提到补传;目前只能走重新导入。

## 未验证

- 真实浏览器上传数百 MB 文件的耗时与稳定性;`<audio>` 在各桌面浏览器对 m4a 的 Range 播放;与真实服务端联调(导入 → 处理 → 审核 → 发布 → 学习端可见 → 删除 / 退役);强制删除触发 Step-up 对话框并重放(只依赖现有 `client.ts` 机制,未专门测试)。
- 页面不可见时停止轮询、恢复时续上:逻辑已写,未写自动化测试。
- 视觉(浅 / 深色、列宽)没有在浏览器里看过;未跑 E2E、未重建容器、未跑全量测试。
