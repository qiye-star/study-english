# admin/src/features/changelog/

管理后台「更新日志」页 `/admin/changelog`(spec 2026-10-14-changelog-design D6;plan `docs/superpowers/plans/2026-10-14-changelog.md`;桌面 ≥ 1024px):`api.ts`(`/api/admin/changelog`,snake → camel)、`strings.ts`(zh-CN,也给 `components/layout.tsx` 的导航项用 `S.title`)、`changelog-page.tsx`(左列表:全部 / 草稿 / 已发布;右编辑器)、`entry-editor.tsx`(日期、可选版本号、中英文标题、「类型 + 一句话」条目、预览、保存 / 发布 / 下架 / 删除)、`entry-preview.tsx`(手机卡片预览,取文规则同网页:英文为空回退中文)、`changelog-icon.tsx`、`index.ts`。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不导入其他 feature。`components/layout.tsx` 只导入这里的 `strings.ts` 与 `changelog-icon.tsx`;`app.tsx` 只从 `index.ts` 导入。

## Test
`cd admin && yarn vitest run src/features/changelog`(`api.test.ts` 读 `server/tests/fixtures/changelog_contract.json`;页面测试用 `vi.mock("./api", importOriginal …)` 保留 `TAGS`,角色用 `vi.spyOn(session, "useAdminSession")`)。

## Pitfalls
- 校验规则与服务端 `app/admin/changelog.py::validate` 保持一致(标题 ≤ 80、版本 ≤ 24、条目 1–20 条、每条 ≤ 200 字);服务端仍会再校验,这里只是提前提示。服务端 422 `{error, fields}` 目前不逐字段解析,编辑器显示客户端规则文案与通用错误。
- 「发布」= 有改动(或新建)就先保存再发布;父组件用 `key = id:updatedAt` 在条目变化时重新挂载编辑器,所以编辑器里没有「同步 props」的逻辑。
- 删除是软删除(服务端 `archived_at`),导入命令不会复活被删的草稿。
- 审计只记条目 id 与动作:界面文案里不要承诺「审计里能看到改了什么」。
