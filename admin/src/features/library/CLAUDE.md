# admin/src/features/library/

## What lives here
管理后台「跟读库」页 `/admin/library`(spec 2026-10-13-video-import §12、E10;plan `docs/superpowers/plans/2026-10-13-video-import-admin.md`;
桌面 ≥ 1024px):`api.ts`(`/api/admin/library*`,snake → camel;`deletePhrase`)、`strings.ts`(zh-CN,也给 `components/layout.tsx`
的导航项用)、`library-page.tsx`(开关与版本、计数、占用排行、条目表:状态 / 种类筛选 + `?user=<id>` 所有者筛选;操作员可取消、删除、
清理失败项)、`user-library-usage.tsx`(用户详情页的占用条)、`library-icon.tsx`(导航图标)、`index.ts`。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不导入其他 feature(`camel` 复制了一份)。
`components/layout.tsx` 只导入这里的 `strings.ts` 与 `library-icon.tsx`;`pages/user-detail-page.tsx` 与 `app.tsx` 只从 `index.ts` 导入。

## Test
`cd admin && yarn vitest run src/features/library`(fetch 打桩,角色用 `session.setSession`)。

## Pitfalls
- 管理员看不到内容:类型里没有标题、网址、字幕与句子,**不要加**;服务端也不返回(`tests/test_admin_library.py` 的隐私测试)。
- 开关只显示不修改:改开关去「设置 → 跟读库」(唯一写入路径 settings_service,含危险确认与审计)。
- 删除要输入 `DELETE <id 前 8 位>`,清理失败项要输入总览给的 `purge_confirm`(数字变了旧短语失效,服务端 409 给新短语);都要理由。
- `running` 是本进程的数字;队列与处理中来自数据库。工具版本每进程缓存 10 分钟。
