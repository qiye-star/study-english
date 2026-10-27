# admin/src/features/catalog/

## What lives here
管理后台「精选库」页 `/admin/catalog`(spec `docs/superpowers/specs/2026-10-14-curated-library-design.md` §11;plan
`docs/superpowers/plans/2026-10-14-curated-library-admin-ui.md`;桌面 ≥ 1024px):`api.ts`(`/api/admin/library/catalog*`,snake → camel,
`deletePhrase` / `purgePhrase` / `mediaUrl`)、`upload.ts`(8 MiB 分片串行、每片重试 2 次、可中止)、`strings.ts`(zh-CN,含备份提示;
导航用 `S.title`)、`catalog-page.tsx`(状态条、表格、发布开关、3 秒轮询)、`import-dialog.tsx`、`upload-dialog.tsx`、`meta-fields.tsx`
(两个对话框共用的元数据表单)、`catalog-detail.tsx`(试听、句子编辑、元数据、动作、删除 / 强制删除)、`replace-media.tsx`(同一条目重新上传媒体、保留句子;plan 2026-10-15-catalog-keep-video)、`role-labels.tsx`(句子说话人 A–F 与角色名;智能建议每次最多 40 句、只出草稿,「采用」后才随保存提交;L5 A1,接口 `/roles*`)、`catalog-icon.tsx`、`index.ts`。
**导入包**(plan `docs/superpowers/plans/2026-10-27-library-local-export-cloud-import.md` A 车道):`package-model.ts`(zip 内 manifest v1 / meta v1 逐键校验,单条问题记在该条 `skip` 上;预览分类 `categorize`)、`package-runner.ts`(批次执行器:一次一条、队列背压 ≥ 2 条在排队时等待、503 / 401 / 网络暂停整批、单条失败隔离、覆盖走 `startReplace`、停止不 cancel)、`package-dialog.tsx`(工具栏「导入包」,operator)、`package-preview.tsx`(计数 + 跳过 / 覆盖 + 勾选列表)、`package-fixture.ts`(仅测试用的包构造器)、`package-interop.test.ts`(按规格手写的包,黄金样例合并后另验)。
通用逻辑在 `admin/src/lib/`:`zip-reader.ts`(中央目录读取,只读 EOCD / ZIP64 / 中央目录 / 命中条目的本地头)、`md5.ts`(增量 MD5)、`test-zip.ts`(仅测试用的 zip 构造器)。

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
- 导入包:媒体条目只收 STORE(DEFLATE 的媒体判 `media_compressed`);包内容从不写进文件系统(只切 `Blob` 视图);md5 与标题不进 URL、不写 `localStorage` / `sessionStorage` / `console`,批次状态只在内存里。
- 导入包覆盖只对未发布、未退役、有句子的条目(`exists`);已发布的条目跳过并提示「先下架才能覆盖」。覆盖不删除任何东西,失败时 `cancel` 把条目放回 ready。
- 导入包的 `source_md5` 只出现在上传开始的 POST 体与包检查的请求 / 回包里;不要把它放进 `admin_out` 展示或日志。
- 包检查 `POST /packages/check` 每批最多 1000 个 md5;单文件上限来自 `state.maxUploadMb`,超过在本地判 `too_large`,不发请求。

## 导入包未验证清单(实现后仍需在真机 / 真服务器上做)
- 黄金样例互通:`fixtures/enjoy-export-v1.zip` 由导出脚本生成后,用 `package-golden` 类测试读取;当前只有按规格手写的 `package-interop.test.ts`。
- 真实浏览器对数 GB zip 的 `Blob.slice` / FileReader 行为与内存占用;浏览器里 md5 的速度。
- `DecompressionStream("deflate-raw")` 在 Safari 16.4+ / Firefox 113+ 上的可用性(仅影响 DEFLATE 的小文本)。
- 真实服务器上的批量导入:转码 + 翻译排队时长、翻译费用、反向代理对连续分片的表现、背压等待期间会话是否保持(空闲 30 分钟过期)、跨天重新选包续传。
- 覆盖(`replace` + 字幕)在真实 ffmpeg 下的时长差是否在 2% 以内(R-KV7)。
