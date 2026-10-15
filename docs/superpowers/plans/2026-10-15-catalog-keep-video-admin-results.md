# 精选库 · 视频素材保留画面 — 管理端车道 A 结果

计划:`2026-10-15-catalog-keep-video.md`(Task A1、A2)· 分支 `feat/w5-a` · 日期 2026-10-15

## 已做
- A1 `feat(admin): catalog kind and media replacement API`:`CatalogKind`、`CatalogRow.kind`、`startReplace`、文案(媒体列、视频 / 音频、替换媒体、`unsupported_format`)。
- A2 `feat(admin): catalog media column, video preview and media replacement`:`replace-media.tsx`、列表「媒体」列、详情 `<video>` 试听、「替换媒体文件」按钮、上次替换失败提示、`CLAUDE.md`。

## 与真实服务端核对(`routers/admin_catalog.py`、`admin/catalog_admin.py`、`library/catalog_store.admin_out`)
- `POST /{id}/replace-media`,body `{filename, size}`,返回 `{catalog_id, chunk_bytes}`;`admin_out` 有 `kind`(`video` / `audio`)。与计划的客户端类型一致,无偏差。
- 服务端错误串 `Item is retired` / `Item is published` / `Item is not ready` / `Unsupported file type` / `File is too large` / `Media tools are not installed`
  在 `S.errors` 里都已有映射;`Subtitles cannot be changed now` 也已有。

## 裁定
- 站长裁定:只对未下架(未发布)条目显示替换入口,只支持上传(与计划 R-KV5 一致)。入口条件:`status=ready`、未发布、未退役、`segCount>0`、媒体未缺失。
- A1 的提交里同时给 `catalog-detail.test.tsx` 的 `ITEM` 加 `kind: "audio"`(计划写「A2 再改」,但 `as` 转换在类型检查下会报错,A1 要 `yarn typecheck` 绿)。
- `replace-media.test.tsx` 的拒绝用例给 `File` 补 `type: "video/mp4"`:`<input accept="video/*,audio/*">` 下 user-event 会过滤掉没有 MIME 类型的文件(测试数据问题,不是产品问题)。

## 测试
- `cd admin && yarn vitest run src/features/catalog src/api`:7 个文件、43 个用例通过;`yarn typecheck` 通过。

## 未验证
- 真实浏览器里的 `<video>` 试听与大文件分片上传(只在 jsdom 与 mock 的 `./api` 下测过)。
- 与真实服务端联调的替换流程(服务端车道 S 自有测试覆盖接口)。
- 没有跑全量管理端测试、构建与 E2E。
