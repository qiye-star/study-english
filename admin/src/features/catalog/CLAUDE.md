# admin/src/features/catalog/

## What lives here
管理后台「精选库」页 `/admin/catalog`(spec `docs/superpowers/specs/2026-10-14-curated-library-design.md` §11;plan
`docs/superpowers/plans/2026-10-14-curated-library-admin-ui.md`;桌面 ≥ 1024px):`api.ts`(`/api/admin/library/catalog*`,snake → camel,
`deletePhrase` / `purgePhrase` / `mediaUrl`)、`upload.ts`(8 MiB 分片串行、每片重试 2 次、可中止)、`strings.ts`(zh-CN,含备份提示;
导航用 `S.title`)、`catalog-page.tsx`(状态条、表格、发布开关、3 秒轮询)、`import-dialog.tsx`、`upload-dialog.tsx`、`meta-fields.tsx`
(两个对话框共用的元数据表单)、`catalog-detail.tsx`(试听、句子编辑、元数据、动作、删除 / 强制删除)、`replace-media.tsx`(同一条目重新上传媒体、保留句子;plan 2026-10-15-catalog-keep-video)、`role-labels.tsx`(句子说话人 A–F 与角色名;智能建议每次最多 40 句、只出草稿,「采用」后才随保存提交;L5 A1,接口 `/roles*`)、`catalog-icon.tsx`、`index.ts`。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不导入其他 feature(`camel` 复制了一份)。

## Test
`cd admin && yarn vitest run src/features/catalog`(mock `./api`)。

## Pitfalls
- 目录是系统内容:这里可以显示标题与句子(spec R5);但不要把它们写进 `console` 或错误上报。
- 已发布的条目不能改句子(服务端 409 `Item is published`);改元数据不受限。已加入的学习者副本不随目录更新。
- 删除:无副本即删;有副本则退役(`retired`)。强制删除会删掉学习者的副本,只给超级管理员,服务端要求二次验证。
- 试听直接用 `<audio src>` / 视频用 `<video src>`(同源 Cookie);不要改成 blob 下载整段。
- 服务端错误串是英文,经 `strings.ts` 的 `S.errors` 映射;新增服务端错误要同步加映射(映射不到的显示原文)。
